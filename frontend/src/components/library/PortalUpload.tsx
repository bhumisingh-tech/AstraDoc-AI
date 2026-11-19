import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FileText, FileType2, FileUp, Plus, Trash2, AlertCircle, CheckCircle2, Layers3 } from 'lucide-react';
import type { DocumentStat } from '../../lib/api';
import { uploadLargeFile } from '../../lib/api';

const DEFAULT_LIMIT = 25 * 1024 * 1024;
const formats = new Set(['pdf', 'docx', 'txt']);
const readableSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1024 ** 3 ? `${(bytes / (1024 ** 2)).toFixed(2)} MB` : `${(bytes / (1024 ** 3)).toFixed(2)} GiB`;

interface Props {
  documents: DocumentStat[];
  busy: boolean;
  progress: number;
  error: string | null;
  limitBytes?: number;
  onUpload: (files: File[]) => void;
  onRemove: (filename: string) => void;
}

/** Browser drag/drop offers an accessible file input as an equivalent keyboard path. */
export function PortalUpload({ documents, busy, progress, error, limitBytes, onUpload, onRemove }: Props) {
  const [dragging, setDragging] = useState(false);
  const [largeBusy, setLargeBusy] = useState(false);
  const [cloudEnabled, setCloudEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    fetch('/api/large-uploads/config').then(response => response.ok ? response.json() : null)
      .then(config => { if (active) setCloudEnabled(Boolean(config?.enabled)); })
      .catch(() => { if (active) setCloudEnabled(false); });
    return () => { active = false; };
  }, []);
  const [largeProgress, setLargeProgress] = useState(0);
  const [largeStatus, setLargeStatus] = useState('');
  const largeInput = useRef<HTMLInputElement>(null);
  const handleLargeFile = async (file?: File) => {
    if (!file) return;
    if (!cloudEnabled) { setLargeStatus('Cloud storage is not configured yet. Ask the administrator to connect S3 or R2.'); return; }
    if (file.size > 5 * 1024 ** 3) { setLargeStatus('Maximum supported large file size is 5 GiB.'); return; }
    const token = window.prompt('Enter the large-upload access token provided by the administrator:');
    if (!token) return;
    setLargeBusy(true); setLargeProgress(0); setLargeStatus('');
    try {
      const result = await uploadLargeFile(file, token, setLargeProgress);
      setLargeStatus(`${file.name}: ${result.message}`);
    } catch (error) {
      setLargeStatus(error instanceof Error ? error.message : 'Upload failed.');
    } finally { setLargeBusy(false); if (largeInput.current) largeInput.current.value = ''; }
  };
  const [validation, setValidation] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const limit = limitBytes || DEFAULT_LIMIT;
  const existingBytes = documents.reduce((sum, file) => sum + file.size_bytes, 0);
  const remaining = Math.max(0, limit - existingBytes);

  const accept = (files: File[]) => {
    setValidation(null);
    if (!files.length || busy) return;
    const invalid = files.find(file => !formats.has(file.name.split('.').pop()?.toLowerCase() ?? ''));
    if (invalid) return setValidation(`${invalid.name} is not supported. Choose PDF, DOCX or TXT.`);
    const empty = files.find(file => file.size === 0);
    if (empty) return setValidation(`${empty.name} is empty. Please choose a file containing text.`);
    const names = files.map(file => file.name);
    if (new Set(names).size !== names.length || names.some(name => documents.some(doc => doc.name === name))) {
      return setValidation('Duplicate filename detected. Rename it before uploading.');
    }
    const sum = files.reduce((total, file) => total + file.size, 0);
    if (sum > remaining) return setValidation(`Only ${readableSize(remaining)} remains of the ${readableSize(limit)} session limit. Remove a file or split large documents. Use the separate cloud-upload option for larger files.`);
    onUpload(files);
  };
  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault(); setDragging(false);
    accept(Array.from(event.dataTransfer.files));
  };
  const browse = (event: ChangeEvent<HTMLInputElement>) => {
    accept(Array.from(event.target.files ?? []));
    event.target.value = ''; // Selecting the same file again should still fire onChange.
  };
  const browseFromKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.current?.click(); }
  };
  return <section className="flex h-full min-h-0 flex-col gap-3" aria-label="Document library">
    <div className="flex items-start justify-between gap-2">
      <div><p className="eyebrow">YOUR ARCHIVE</p><h2 className="mt-1 font-display text-lg font-bold tracking-tight">Document library</h2></div>
      <span className="rounded-xl border px-2 py-1 font-mono text-[10px]" style={{ borderColor:'var(--border)',color:'var(--muted)' }}>{documents.length} FILES</span>
    </div>
    <input ref={input} aria-label="Choose PDF DOCX or TXT documents" className="sr-only" type="file" multiple accept=".pdf,.docx,.txt" onChange={browse} disabled={busy}/>
    <motion.div
      className={`portal relative flex min-h-[155px] shrink-0 flex-col items-center justify-center overflow-hidden rounded-[18px] border border-dashed px-3 py-4 text-center ${dragging ? 'portal-active' : ''}`}
      role="button" tabIndex={busy ? -1 : 0} aria-disabled={busy} aria-label="Upload documents. Press Enter or Space to browse, or drag files here"
      onClick={() => { if (!busy) input.current?.click(); }} onKeyDown={browseFromKey}
      onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
      onDrop={drop} whileHover={busy ? undefined : { scale: 1.012 }} transition={{ type:'spring', stiffness:230,damping:24 }}
    >
      
      <div className="portal-core relative mb-2 flex h-11 w-11 items-center justify-center rounded-[14px]">{busy ? <Layers3 size={20}/> : <FileUp size={28}/>}</div>
      <p className="relative font-display text-sm font-semibold">{busy ? 'Mapping your knowledge…' : dragging ? 'Release to upload files' : 'Drop or browse documents'}</p>
      <p className="relative mt-1 max-w-[250px] text-[11px] leading-4" style={{ color:'var(--muted)' }}>{busy ? 'Uploading and indexing documents. Text extraction may take a moment.' : 'PDF, DOCX or TXT · Indexed for AI chat'}</p>
      
      <div className="relative mt-2 flex flex-col items-center gap-1">
        <input ref={largeInput} type="file" accept=".pdf,.docx,.txt" className="hidden" onChange={event => void handleLargeFile(event.target.files?.[0])}/>
        <button type="button" disabled={largeBusy || busy} onClick={event => { event.stopPropagation(); largeInput.current?.click(); }}
          className="rounded-lg border px-3 py-2 text-xs font-semibold" style={{ borderColor: 'var(--border-strong)', color: 'var(--text)' }}>
          {largeBusy ? `Uploading large file… ${largeProgress}%` : 'Upload to cloud (up to 5 GiB)'}
        </button>
        <p className="max-w-[260px] text-center text-[10px] leading-4" style={{ color: 'var(--muted)' }}>{cloudEnabled ? 'Cloud storage ready · Requires access token · Stored files are not yet searchable.' : 'Cloud storage not connected · 5 GiB uploads unavailable until S3/R2 is configured.'}</p>
        {largeBusy && <progress max={100} value={largeProgress} className="w-full" aria-label="Large file upload progress"/>}
        {largeStatus && <p role="status" className="max-w-[280px] break-words text-xs" style={{ color: 'var(--muted)' }}>{largeStatus}</p>}
      </div>
      {busy && <div className="absolute bottom-0 left-0 h-1 w-full" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Upload transfer progress" style={{ background:'var(--border)' }}><div className="h-full transition-[width] duration-200" style={{ background:'var(--violet)',width:`${progress}%` }}/></div>}
    </motion.div>
    {busy && <p className="-mt-3 text-center font-mono text-[11px]" style={{ color:'var(--muted)' }}>{progress < 100 ? `Transferring ${progress}%` : 'Transfer complete · indexing text…'}</p>}
    {(validation || error) && <p role="alert" className="flex items-start gap-2 rounded-xl border p-3 text-xs leading-5" style={{ borderColor:'var(--border-strong)', color:'var(--amber)' }}><AlertCircle className="mt-0.5 shrink-0" size={15}/>{validation || error}</p>}
    <div className="flex items-center justify-between gap-2"><p className="eyebrow">INDEXED DOCUMENTS</p><button className="micro-button" type="button" disabled={busy || remaining === 0} onClick={() => input.current?.click()}><Plus size={14}/> Add files</button></div>
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1" aria-live="polite">
      <AnimatePresence initial={false}>
        {documents.map(doc => <motion.article layout initial={{ opacity:0,y:10 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0,x:-20 }} key={doc.name} className="document-item group flex items-center gap-2 rounded-xl p-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ color:'var(--cyan)',background:'var(--ring)' }}>{doc.type === 'txt' ? <FileType2 size={20}/> : <FileText size={20}/>}</div>
          <div className="min-w-0 flex-1"><p title={doc.name} className="truncate text-sm font-semibold">{doc.name}</p><p className="mt-0.5 font-mono text-[10px]" style={{ color:'var(--muted)' }}>{doc.type.toUpperCase()} · {readableSize(doc.size_bytes)} · {doc.pages ? `${doc.pages} pages · ` : ''}{doc.passages} passages</p></div>
          <button className="quiet-button !p-2" title={`Remove ${doc.name}`} aria-label={`Remove ${doc.name}`} type="button" disabled={busy} onClick={() => onRemove(doc.name)}><Trash2 size={15}/></button>
        </motion.article>)}
      </AnimatePresence>
      {!documents.length && <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-5 text-center text-xs" style={{ borderColor:'var(--border)',color:'var(--muted)' }}><CheckCircle2 size={19}/>No indexed documents yet. Drop a file above to start a cited conversation.</div>}
    </div>
    <div className="border-t pt-3 space-y-2" style={{ borderColor:'var(--border)' }}>
      <div><div className="mb-2 flex justify-between gap-2 font-mono text-[10px]" style={{ color:'var(--muted)' }}><span>AI CHAT LIBRARY</span><span>{readableSize(existingBytes)} / {readableSize(limit)}</span></div><div className="h-1.5 overflow-hidden rounded-full" style={{ background:'var(--border)' }}><div className="h-full rounded-full transition-all" style={{ background:'var(--cyan)',width:`${Math.min(existingBytes/limit*100,100)}%` }}/></div><p className="mt-1 text-[10px]" style={{color:'var(--muted)'}}>Files indexed for questions and answers</p></div>
      <div><div className="flex justify-between gap-2 font-mono text-[10px]" style={{ color:'var(--muted)' }}><span>CLOUD FILE UPLOAD</span><span>UP TO 5 GiB / FILE</span></div><p className="mt-1 text-[10px]" style={{color: cloudEnabled ? 'var(--cyan)' : 'var(--muted)'}}>{cloudEnabled ? 'Storage connected · upload only, AI indexing pending' : 'Not configured · connect S3 or R2 to enable'}</p></div>
    </div>
  </section>;
}
