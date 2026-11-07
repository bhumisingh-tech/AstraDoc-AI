import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, FileText, X } from 'lucide-react';
import type { Source } from '../../lib/api';

function tokens(question: string): Set<string> {
  const ignore = new Set(['what','which','where','when','why','how','this','that','with','from','about','your','were','have','does','into','the','and','for','are','was','can','its','who','all']);
  return new Set((question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter(word => !ignore.has(word)));
}
function Highlight({ text, query }: { text: string; query: string }) {
  const words = tokens(query);
  return <>{text.split(/([\p{L}\p{N}]+)/gu).map((part, index) => words.has(part.toLowerCase()) ? <mark key={index} className="source-highlight">{part}</mark> : <span key={index}>{part}</span>)}</>;
}

export function CitationChip({ number, source, onOpen }: { number: number; source?: Source; onOpen: (source: Source) => void }) {
  if (!source) return <span className="font-mono text-xs">[Source {number}]</span>;
  return <span className="citation-anchor"><button type="button" className="citation-chip" onClick={() => onOpen(source)} aria-label={`Open source ${number}, ${source.source}`}>
    ✦ Source {number}
  </button><span className="citation-preview" role="tooltip"><strong>{source.source}</strong><span>{source.text.slice(0, 240)}{source.text.length > 240 ? '…' : ''}</span><small>{Math.round(source.score * 100)}% relevance · Click for evidence</small></span></span>;
}

export function CitationCards({ sources, query, onOpen }: { sources: Source[]; query: string; onOpen: (source: Source) => void }) {
  if (!sources.length) return null;
  return <details className="citation-list mt-4" aria-label="Retrieved citation cards"><summary className="eyebrow mb-2 cursor-pointer select-none rounded-lg py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">View supporting evidence · {sources.length} passages</summary><div className="flex flex-wrap gap-2">{sources.map(source => <button className="citation-card" key={`${source.citation}-${source.id}`} type="button" onClick={() => onOpen(source)} aria-label={`Read source ${source.citation} from ${source.source}`}>
    <span className="flex items-center gap-2"><FileText size={14}/><strong className="truncate">{source.source}</strong><ArrowUpRight size={12}/></span>
    <span className="mt-2 block line-clamp-2 text-left text-xs leading-5" style={{color:'var(--muted)'}}><Highlight text={source.text} query={query}/></span>
    <span className="mt-2 flex items-center gap-2 text-[10px] font-mono"><span className="relevance-track"><span style={{width:`${Math.max(0,Math.min(100,source.score*100))}%`}}/></span>{Math.round(source.score*100)}%</span>
  </button>)}</div></details>;
}

export function SourceDrawer({ source, query, onClose, onLocate }: { source: Source | null; query: string; onClose: () => void; onLocate: (source: Source) => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!source) return;
    setCopied(false);
    const oldFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); oldFocus?.focus(); };
  }, [source, onClose]);
  if (!source) return null;
  return <div className="source-overlay no-print" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><aside className="source-drawer glass" role="dialog" aria-modal="true" aria-label={`Source ${source.citation} details`} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled])'));
    if (event.shiftKey && document.activeElement === nodes[0]) {event.preventDefault();nodes.at(-1)?.focus();}
    if (!event.shiftKey && document.activeElement === nodes.at(-1)) {event.preventDefault();nodes[0]?.focus();}
  }}>
    <div className="flex items-center justify-between gap-2"><p className="eyebrow">SOURCE {source.citation} / PASSAGE {source.id + 1}</p><button ref={closeRef} type="button" className="quiet-button" onClick={onClose} aria-label="Close source drawer"><X size={18}/></button></div>
    <h2 className="mt-5 break-words font-display text-xl font-semibold">{source.source}</h2>
    <p className="mt-1 break-all text-xs" style={{color:'var(--muted)'}}>Document: {source.file}</p>
    <p className="mt-6 text-xs font-mono">Cosine relevance · {Math.round(source.score*100)}%</p><div className="relevance-track mt-2 !h-2"><span style={{width:`${Math.max(0,Math.min(100,source.score*100))}%`}}/></div>
    <h3 className="mt-8 mb-3 text-sm font-semibold">Original passage</h3><div className="source-passage text-sm leading-7"><Highlight text={source.text} query={query}/></div>
    <div className="mt-5 flex flex-wrap gap-2"><button className="micro-button" type="button" onClick={() => { onLocate(source); onClose(); }}>Locate star</button><button className="micro-button" type="button" onClick={() => void navigator.clipboard.writeText(source.text).then(() => setCopied(true)).catch(() => setCopied(false))}>{copied ? 'Copied' : 'Copy passage'}</button></div>
  </aside></div>;
}
