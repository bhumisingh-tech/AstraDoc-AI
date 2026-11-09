import { useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FileText, FileType2, FileUp, Plus, Trash2, AlertCircle, CheckCircle2, Layers3 } from 'lucide-react';
import type { DocumentStat } from '../../lib/api';

const DEFAULT_LIMIT = 25 * 1024 * 1024;
const formats = new Set(['pdf', 'docx', 'txt']);
const readableSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

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
      return setValidation('Two files have the same name. Rename the duplicate before uploading.');
    }
    const sum = files.reduce((total, file) => total + file.size, 0);
    if (sum > remaining) return setValidation(`Only ${readableSize(remaining)} remains of the ${readableSize(limit)} session limit. Remove a file or split large documents. Very large/GB files need a production setup with persistent storage.`);
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
  return <section className="flex h-full min-h-0 flex-col gap-5" aria-label="Document library">
    <div className="flex items-start justify-between gap-2">
      <div><p className="eyebrow">YOUR ARCHIVE</p><h2 className="mt-1 font-display text-xl font-bold tracking-tight">Document library</h2></div>
      <span className="rounded-xl border px-2 py-1 font-mono text-[10px]" style={{ borderColor:'var(--border)',color:'var(--muted)' }}>{documents.length} FILES</span>
    </div>
    <input ref={input} aria-label="Choose PDF DOCX or TXT documents" className="sr-only" type="file" multiple accept=".pdf,.docx,.txt" onChange={browse} disabled={busy}/>
    <motion.div
      className={`portal relative flex min-h-[225px] shrink-0 flex-col items-center justify-center overflow-hidden rounded-[24px] border border-dashed px-4 py-6 text-center ${dragging ? 'portal-active' : ''}`}
      role="button" tabIndex={busy ? -1 : 0} aria-disabled={busy} aria-label="Upload documents. Press Enter or Space to browse, or drag files here"
      onClick={() => { if (!busy) input.current?.click(); }} onKeyDown={browseFromKey}
      onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
      onDrop={drop} whileHover={busy ? undefined : { scale: 1.012 }} transition={{ type:'spring', stiffness:230,damping:24 }}
    >
      <span className="portal-orbit" aria-hidden="true"/>
      <div className="portal-core relative mb-5 flex h-16 w-16 items-center justify-center rounded-[22px]">{busy ? <Layers3 size={28}/> : <FileUp size={28}/>}</div>
      <p className="relative font-display text-lg font-semibold">{busy ? 'Mapping your knowledge…' : dragging ? 'Release to form a constellation' : 'Open the portal'}</p>
      <p className="relative mt-2 max-w-[240px] text-xs leading-5" style={{ color:'var(--muted)' }}>{busy ? 'Uploading and indexing documents. Text extraction may take a moment.' : 'Drop files here, or click to browse. In-memory demo sessions have size limits; split very large files.'}</p>
      <span className="relative mt-4 rounded-full border px-3 py-1.5 font-mono text-[10px]" style={{ color:'var(--muted)',borderColor:'var(--border)' }}>PDF · DOCX · TXT</span>
      {busy && <div className="absolute bottom-0 left-0 h-1 w-full" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Upload transfer progress" style={{ background:'var(--border)' }}><div className="h-full transition-[width] duration-200" style={{ background:'var(--violet)',width:`${progress}%` }}/></div>}
    </motion.div>
    {busy && <p className="-mt-3 text-center font-mono text-[11px]" style={{ color:'var(--muted)' }}>{progress < 100 ? `Transferring ${progress}%` : 'Transfer complete · indexing text…'}</p>}
    {(validation || error) && <p role="alert" className="flex items-start gap-2 rounded-xl border p-3 text-xs leading-5" style={{ borderColor:'var(--border-strong)', color:'var(--amber)' }}><AlertCircle className="mt-0.5 shrink-0" size={15}/>{validation || error}</p>}
    <div className="flex items-center justify-between gap-2"><p className="eyebrow">INDEXED DOCUMENTS</p><button className="micro-button" type="button" disabled={busy || remaining === 0} onClick={() => input.current?.click()}><Plus size={14}/> Add files</button></div>
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1" aria-live="polite">
      <AnimatePresence initial={false}>
        {documents.map(doc => <motion.article layout initial={{ opacity:0,y:10 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0,x:-20 }} key={doc.name} className="document-item group flex items-center gap-3 rounded-2xl p-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ color:'var(--cyan)',background:'var(--ring)' }}>{doc.type === 'txt' ? <FileType2 size={20}/> : <FileText size={20}/>}</div>
          <div className="min-w-0 flex-1"><p title={doc.name} className="truncate text-sm font-semibold">{doc.name}</p><p className="mt-1 font-mono text-[10px]" style={{ color:'var(--muted)' }}>{doc.type.toUpperCase()} · {readableSize(doc.size_bytes)} · {doc.pages ? `${doc.pages} pages · ` : ''}{doc.passages} passages</p></div>
          <button className="quiet-button !p-2" title={`Remove ${doc.name}`} aria-label={`Remove ${doc.name}`} type="button" disabled={busy} onClick={() => onRemove(doc.name)}><Trash2 size={15}/></button>
        </motion.article>)}
      </AnimatePresence>
      {!documents.length && <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-5 text-center text-xs" style={{ borderColor:'var(--border)',color:'var(--muted)' }}><CheckCircle2 size={19}/>Your library is empty. Your uploaded documents stay in this server session.</div>}
    </div>
    <div className="border-t pt-4" style={{ borderColor:'var(--border)' }}><div className="mb-2 flex justify-between font-mono text-[10px]" style={{ color:'var(--muted)' }}><span>STORAGE USED</span><span>{readableSize(existingBytes)} / {readableSize(limit)}</span></div><div className="h-1.5 overflow-hidden rounded-full" style={{ background:'var(--border)' }}><div className="h-full rounded-full transition-all" style={{ background:'var(--cyan)',width:`${Math.min(existingBytes/limit*100,100)}%` }}/></div></div>
  </section>;
}
