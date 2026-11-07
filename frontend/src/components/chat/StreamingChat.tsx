import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MarkdownAnswer } from './MarkdownAnswer';
import { CitationCards } from '../citations/CitationCards';
import { ArrowUp, Bot, Check, Clipboard, RotateCcw, Sparkles, Square, UserRound, WandSparkles } from 'lucide-react';
import type { AnswerMode, Source } from '../../lib/api';

export interface ChatMessage {
  id: string;
  question: string;
  answer: string;
  sources: Source[];
  mode: AnswerMode | null;
  status: 'streaming' | 'done' | 'stopped' | 'error';
  warning?: string;
}
interface Props {
  messages: ChatMessage[];
  busy: boolean;
  enabled: boolean;
  suggested: string[];
  mode: AnswerMode;
  onAsk: (question: string) => void;
  onStop: () => void;
  onRegenerate: () => void;
  onOpenSource: (source: Source, query: string) => void;
}

export function StreamingChat({ messages, busy, enabled, suggested, mode, onAsk, onStop, onRegenerate, onOpenSource }: Props) {
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior:'smooth',block:'end' }); }, [messages]);
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const question = draft.trim();
    if (!enabled || busy || !question) return;
    setDraft(''); onAsk(question);
  };
  const copy = async (id: string, answer: string) => {
    try { await navigator.clipboard.writeText(answer); setCopied(id); window.setTimeout(() => setCopied(previous => previous === id ? null : previous), 1600); }
    catch { setCopied(null); }
  };
  return <section className="flex h-full min-h-0 flex-col" aria-label="Document conversation">
    <div className="mb-4 flex items-start justify-between gap-3 pr-8"><div><p className="eyebrow">THE CONVERSATION</p><h1 className="mt-1 font-display text-xl font-bold tracking-tight">Ask your documents</h1></div><span className="rounded-full border px-3 py-1.5 font-mono text-[10px]" style={{ color:'var(--cyan)',borderColor:'var(--border-strong)' }}>{mode === 'gemini' ? '✦ GEMINI AI' : '◉ EVIDENCE-ONLY'}</span></div>
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1 pb-5" role="log" aria-live="polite" aria-relevant="additions text">
      {!messages.length && <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} className="flex min-h-full flex-col items-center justify-center px-3 py-8 text-center"><div className="glass-gradient mb-5 flex h-20 w-20 items-center justify-center rounded-[27px]"><WandSparkles size={35} style={{ color:'var(--violet)' }}/></div><p className="font-display text-2xl font-semibold tracking-tight">Find the threads of meaning.</p><p className="mt-3 max-w-sm text-sm leading-6" style={{ color:'var(--muted)' }}>{enabled ? 'Your documents have been indexed. Ask anything; answers are grounded in passages from your files.' : 'Start by uploading a PDF, DOCX or TXT document into your library.'}</p>
        {enabled && suggested.length > 0 && <div className="mt-7 grid w-full max-w-lg gap-2 sm:grid-cols-2">{suggested.map(question => <button key={question} disabled={busy} type="button" onClick={() => onAsk(question)} className="starter-chip">{question}</button>)}</div>}
      </motion.div>}
      <AnimatePresence initial={false}>
        {messages.map(message => <motion.article key={message.id} initial={{ opacity:0,y:12 }} animate={{opacity:1,y:0}} className="space-y-4">
          <div className="flex items-start justify-end gap-3"><div className="max-w-[89%] rounded-[20px] rounded-tr-md px-4 py-3 text-sm leading-6" style={{ background:'var(--ring)' }}>{message.question}</div><div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl" style={{border:'1px solid var(--border)',color:'var(--muted)'}}><UserRound size={16}/></div></div>
          <div className="flex items-start gap-3"><div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{background:'var(--ring)',color:'var(--violet)'}}><Bot size={18}/></div><div className="min-w-0 flex-1"><div className="mb-2 flex items-center gap-2"><p className="text-sm font-semibold">Constellation</p><span className="font-mono text-[10px]" style={{color:'var(--muted)'}}>{message.mode === 'gemini' ? 'GEMINI AI' : message.mode === 'evidence' ? 'EVIDENCE-ONLY' : 'SEARCHING'}</span></div>
            {message.answer ? <MarkdownAnswer content={message.answer} sources={message.sources} onOpenSource={source => onOpenSource(source,message.question)}/> : message.status === 'streaming' ? <div className="space-y-3 py-2" aria-label="Retrieving relevant passages"><div className="skeleton h-3 w-5/6 rounded-full"/><div className="skeleton h-3 w-2/3 rounded-full"/><div className="skeleton h-3 w-3/4 rounded-full"/></div> : <p className="text-sm" style={{color:'var(--muted)'}}>No answer was received.</p>}
            {message.status === 'streaming' && message.answer && <span className="typing-caret" aria-label="Answer is streaming"/>}
            {message.warning && <p className="mt-2 text-xs" style={{color:'var(--amber)'}} role="status">{message.warning}</p>}
            {message.status === 'stopped' && <p className="mt-2 text-xs" style={{color:'var(--amber)'}}>Generation stopped. A partial answer may be shown.</p>}
            {message.status === 'error' && <p className="mt-2 text-xs" style={{color:'var(--amber)'}}>The answer could not be completed.</p>}
            <CitationCards sources={message.sources} query={message.question} onOpen={source=>onOpenSource(source,message.question)}/>
            {message.answer && <div className="no-print mt-3 flex flex-wrap items-center gap-2"><button className="micro-button" onClick={() => void copy(message.id,message.answer)} type="button">{copied === message.id ? <Check size={13}/> : <Clipboard size={13}/>} {copied === message.id ? 'Copied' : 'Copy answer'}</button>{message.status !== 'streaming' && message.id === messages[messages.length-1]?.id && <button className="micro-button" onClick={onRegenerate} disabled={busy} type="button"><RotateCcw size={13}/> Regenerate</button>}</div>}
          </div></div>
        </motion.article>)}
      </AnimatePresence>
      <div ref={bottom}/>
    </div>
    <form onSubmit={submit} className={`chat-composer no-print mt-4 shrink-0 ${busy ? 'composer-thinking' : ''}`}><textarea ref={textarea} aria-label="Ask a question about the uploaded documents" rows={2} className="w-full resize-none border-0 bg-transparent px-4 pb-2 pt-4 text-sm outline-none placeholder:opacity-70 focus:outline-none" placeholder={enabled ? 'Ask anything about your documents…' : 'Upload documents first to start asking…'} disabled={!enabled || busy} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {event.preventDefault();submit();} }}/><div className="flex items-center justify-between gap-3 px-3 pb-3"><p className="font-mono text-[10px]" style={{color:'var(--muted)'}}>ENTER TO SEND · SHIFT+ENTER FOR NEW LINE</p>{busy ? <button type="button" className="composer-send" style={{background:'var(--amber)'}} onClick={onStop} aria-label="Stop answer generation"><Square fill="currentColor" size={16}/></button> : <button type="submit" className="composer-send" disabled={!enabled || !draft.trim()} aria-label="Send question"><ArrowUp size={20}/></button>}</div></form>
    <p className="no-print mt-3 flex items-center justify-center gap-2 font-mono text-[10px]" style={{color:'var(--muted)'}}><Sparkles size={12}/> Answers rely on uploaded document evidence</p>
  </section>;
}
