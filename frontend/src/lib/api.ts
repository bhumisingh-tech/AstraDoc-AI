/** Typed interface to the actual FastAPI routes (backend/main.py). */
const BASE = '/api';

export interface DocumentStat {
  name: string;
  size_bytes: number;
  type: 'pdf' | 'docx' | 'txt';
  pages: number | null;
  passages: number;
  words: number;
}
export interface SessionInfo {
  session_id: string | null;
  documents: DocumentStat[];
  passage_count: number;
  total_bytes: number;
  retrieval_mode?: string;
  persistent?: boolean;
  limits?: { max_upload_bytes: number; max_file_bytes: number; max_files: number };
}
export interface Health {
  status: 'ok';
  app?: string;
  gemini_configured: boolean;
  answer_mode: 'gemini' | 'evidence';
  gemini_streaming?: boolean;
  model: string;
  limits?: { max_upload_bytes: number; max_file_bytes: number; max_files: number };
}
export interface Source {
  id: number;
  citation: number;
  source: string;
  text: string;
  score: number;
  file: string;
}
export type AnswerMode = 'gemini' | 'evidence';
export interface Insights {
  summary: string;
  summary_type: 'extractive';
  keywords: { term: string; weight: number }[];
  suggested_questions: string[];
  stats: { files: number; pages: number; passages: number; words: number; reading_minutes: number };
  documents: DocumentStat[];
}
export interface MapPoint { id: number; x: number; y: number; source: string; text: string; file: string }
export interface PassageMap {
  points: MapPoint[];
  query_point: { x: number; y: number } | null;
  retrieved_ids: number[];
}
export type ChatEvent =
  | { event: 'sources'; data: { sources: Source[]; question: string } }
  | { event: 'token'; data: { text: string } }
  | { event: 'mode'; data: { mode: AnswerMode } }
  | { event: 'warning'; data: { message: string } }
  | { event: 'done'; data: { message_index: number } }
  | { event: 'error'; data: { message: string } };

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

function details(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(details).filter(Boolean).join('; ');
  if (value && typeof value === 'object' && 'msg' in value) return String(value.msg);
  return undefined;
}

async function check(response: Response): Promise<Response> {
  if (response.ok) return response;
  let message = `Request failed (${response.status}).`;
  try {
    const data: unknown = await response.json();
    if (data && typeof data === 'object' && 'detail' in data) {
      message = details(data.detail) || message;
    }
  } catch { /* Keep HTTP status when body is not JSON. */ }
  throw new ApiError(response.status, message);
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await check(await fetch(`${BASE}${path}`, init));
  return response.json() as Promise<T>;
}

const params = (values: Record<string, string | number | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return `?${search.toString()}`;
};

export const api = {
  health: (signal?: AbortSignal) => json<Health>('/health', { signal }),
  session: (id: string, signal?: AbortSignal) => json<SessionInfo & { history: Array<{ question: string; answer: string; sources: Source[]; mode: AnswerMode }> }>(`/session/${encodeURIComponent(id)}`, {signal}),
  upload: (files: File[], sessionId?: string, signal?: AbortSignal) => {
    const body = new FormData();
    files.forEach(file => body.append('files', file));
    if (sessionId) body.append('session_id', sessionId);
    // Do not set Content-Type: the browser adds the multipart boundary.
    return json<SessionInfo>('/upload', { method: 'POST', body, signal });
  },
  removeFile: (sessionId: string, filename: string) => json<SessionInfo>(
    `/files/${encodeURIComponent(filename)}${params({ session_id: sessionId })}`,
    { method: 'DELETE' },
  ),
  insights: (sessionId: string, signal?: AbortSignal) => json<Insights>(
    `/insights${params({ session_id: sessionId })}`, { signal },
  ),
  map: (sessionId: string, options?: { question?: string; topK?: number; signal?: AbortSignal }) => json<PassageMap>(
    `/map${params({ session_id: sessionId, question: options?.question, top_k: options?.topK })}`,
    { signal: options?.signal },
  ),
  clearChat: (sessionId: string) => json<{ cleared: boolean }>(
    `/chat${params({ session_id: sessionId })}`, { method: 'DELETE' },
  ),
  exportMarkdown: async (sessionId: string): Promise<Blob> => {
    const response = await check(await fetch(`${BASE}/export${params({ session_id: sessionId })}`));
    return response.blob();
  },
};

/**
 * SSE over fetch rather than EventSource: chat needs POST, JSON body and abort.
 * Handles network chunk boundaries, CRLF and multiple events in one chunk.
 * Async callback provides natural backpressure for React state updates.
 */
export async function streamChat(
  args: { sessionId: string; question: string; topK: number; regenerateLast?: boolean; signal?: AbortSignal },
  onEvent: (event: ChatEvent) => void | Promise<void>,
): Promise<void> {
  const response = await check(await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ session_id: args.sessionId, question: args.question, top_k: args.topK, regenerate_last: Boolean(args.regenerateLast) }),
    signal: args.signal,
  }));
  if (!response.body) throw new Error('Streaming is unavailable in this browser.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;

  const dispatch = async (block: string) => {
    let eventName = '';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (!eventName || !dataLines.length) return;
    const name = eventName as ChatEvent['event'];
    if (!['sources', 'token', 'mode', 'warning', 'done', 'error'].includes(name)) return;
    const data: unknown = JSON.parse(dataLines.join('\n'));
    await onEvent({ event: name, data } as ChatEvent);
    if (name === 'error') throw new Error((data as { message: string }).message);
    if (name === 'done') completed = true;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        await dispatch(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) await dispatch(buffer);
    if (!completed) throw new Error('The answer stream ended unexpectedly. Please try again.');
  } finally {
    reader.releaseLock();
  }
}

/** XHR supplies *real* multipart upload progress, unlike fetch without upload streaming. */
export function uploadWithProgress(
  files: File[], sessionId: string | undefined, progress: (percent: number) => void,
): { promise: Promise<SessionInfo>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const form = new FormData();
  for (const file of files) form.append('files', file);
  if (sessionId) form.append('session_id', sessionId);
  const promise = new Promise<SessionInfo>((resolve, reject) => {
    xhr.upload.addEventListener('progress', event => {
      if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100));
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText) as SessionInfo); }
        catch { reject(new Error('The server returned an invalid upload response.')); }
      } else {
        try { reject(new ApiError(xhr.status, details(JSON.parse(xhr.responseText).detail) || `Upload failed (${xhr.status}).`)); }
        catch (error) { reject(error instanceof ApiError ? error : new ApiError(xhr.status, `Upload failed (${xhr.status}).`)); }
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Could not connect to the server.')));
    xhr.addEventListener('abort', () => reject(new DOMException('Upload cancelled.', 'AbortError')));
    xhr.open('POST', `${BASE}/upload`);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

/** Direct multipart upload to S3/R2, never sending large file bytes through Render. */
export async function uploadLargeFile(
  file: File, token: string, onProgress: (percent: number) => void,
): Promise<{ key: string; size_bytes: number; status: string; indexed: boolean; message: string }> {
  const headers = { 'Content-Type': 'application/json', 'X-Large-Upload-Token': token };
  const request = async <T>(endpoint: string, body: object): Promise<T> => {
    const response = await fetch(`/api/large-uploads/${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(typeof error.detail === 'string' ? error.detail : `Large upload failed (HTTP ${response.status})`);
    }
    return response.json() as Promise<T>;
  };
  const start = await request<{ key: string; upload_id: string; part_bytes: number }>('start', { name: file.name, size: file.size });
  const parts: { PartNumber: number; ETag: string }[] = [];
  try {
    const total = Math.ceil(file.size / start.part_bytes);
    for (let number = 1; number <= total; number++) {
      const offset = (number - 1) * start.part_bytes;
      const slice = file.slice(offset, Math.min(offset + start.part_bytes, file.size));
      const { url } = await request<{ url: string }>('part', { key: start.key, upload_id: start.upload_id, number });
      let etag = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          etag = await new Promise<string>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', url);
            xhr.upload.onprogress = event => {
              if (event.lengthComputable) onProgress(Math.min(99, Math.floor((offset + event.loaded) / file.size * 100)));
            };
            xhr.onload = () => xhr.status >= 200 && xhr.status < 300
              ? resolve(xhr.getResponseHeader('ETag') || '')
              : reject(new Error(`Storage rejected upload part ${number} (HTTP ${xhr.status}).`));
            xhr.onerror = () => reject(new Error('Storage connection failed. Check bucket CORS and network access.'));
            xhr.send(slice);
          });
          if (!etag) throw new Error('Storage did not expose the ETag header. Add ETag to bucket CORS ExposeHeaders.');
          break;
        } catch (error) {
          if (attempt === 2) throw error;
        }
      }
      parts.push({ PartNumber: number, ETag: etag });
    }
    const finished = await request<{ key: string; size_bytes: number; status: string; indexed: boolean; message: string }>(
      'finish', { key: start.key, upload_id: start.upload_id, parts },
    );
    onProgress(100);
    return finished;
  } catch (error) {
    await request('abort', { key: start.key, upload_id: start.upload_id }).catch(() => {});
    throw error;
  }
}
