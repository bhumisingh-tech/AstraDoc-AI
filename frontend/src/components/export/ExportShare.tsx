import { useState } from 'react';
import { ClipboardCopy, Download, FileDown, Printer, Check, AlertCircle } from 'lucide-react';
import { api } from '../../lib/api';
import type { ChatMessage } from '../chat/StreamingChat';

type Props = { sessionId: string | null; messages: ChatMessage[]; disabled: boolean };
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Markdown comes from the server's saved chat history (including citations). */
export function ExportShare({sessionId,messages,disabled}:Props) {
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState<string|null>(null);
  const [copied,setCopied] = useState(false);
  const allowed = Boolean(sessionId && messages.some(message=>message.answer.trim()) && !disabled);
  async function downloadMarkdown() {
    if (!sessionId || !allowed) return;
    setBusy(true);setNotice(null);
    try { saveBlob(await api.exportMarkdown(sessionId),'docchat-bhumi-conversation.md'); }
    catch(error){setNotice(error instanceof Error?error.message:'Could not download Markdown.');}
    finally{setBusy(false);}
  }
  async function copyConversation() {
    if(!allowed) return;
    const text = messages.filter(message=>message.answer.trim()).map(msg=> `## Question\n\n${msg.question}\n\n## Answer\n\n${msg.answer}\n\n${msg.sources.map(src=>`[Source ${src.citation}]: ${src.source} (${src.score.toFixed(3)})`).join('\n')}`).join('\n\n---\n\n');
    try { await navigator.clipboard.writeText(`# DocChat Bhumi — Conversation\n\n${text}`);setCopied(true);setNotice('Conversation copied to clipboard.');window.setTimeout(()=>setCopied(false),1800); }
    catch {setNotice('Clipboard access was blocked. Try Markdown export instead.');}
  }
  function savePDF() {
    if(!allowed) return;
    setNotice('In the print dialog, choose “Save as PDF” as the destination.');
    window.print(); // Built-in browser PDF printer; preserves print stylesheet without a JS PDF bundle.
  }
  return <section className="export-panel space-y-4" aria-label="Export and share conversation">
    <header><p className="eyebrow">TAKE YOUR KNOWLEDGE</p><h2 className="mt-2 font-display text-xl font-semibold">Export & share</h2><p className="mt-2 text-sm" style={{color:'var(--muted)'}}>Keep a portable copy of your grounded answers and their citations.</p></header>
    <div className="space-y-2">
      <button className="export-action" disabled={!allowed||busy} type="button" onClick={()=>void downloadMarkdown()}><Download size={19}/><span><strong>Download Markdown</strong><small>Full server conversation, source text and scores</small></span><FileDown size={16}/></button>
      <button className="export-action" disabled={!allowed} type="button" onClick={savePDF}><Printer size={19}/><span><strong>Save as PDF</strong><small>Opens your browser’s print-to-PDF dialog</small></span><FileDown size={16}/></button>
      <button className="export-action" disabled={!allowed} type="button" onClick={()=>void copyConversation()}>{copied?<Check size={19}/>:<ClipboardCopy size={19}/>}<span><strong>{copied?'Copied':'Copy conversation'}</strong><small>Answers plus source names and relevance</small></span></button>
    </div>
    {notice&&<p role="status" className="flex items-start gap-2 text-xs" style={{color:'var(--muted)'}}><AlertCircle size={14}/>{notice}</p>}
    {!allowed&&<p className="text-xs" style={{color:'var(--muted)'}}>Ask a question to enable conversation export.</p>}
  </section>;
}

/** The print-only article ensures PDF output contains the *full* conversation even if chat scrolled. */
export function PrintableConversation({messages}: {messages:ChatMessage[]}) {
  const valid = messages.filter(msg=>msg.answer.trim());
  return <article className="print-conversation" aria-hidden="true"><h1>DocChat Bhumi — Conversation</h1><p>Document-grounded answers with evidence references</p>{valid.map((message,index)=><section key={message.id}><h2>Question {index+1}</h2><p>{message.question}</p><h3>Answer</h3><div className="print-answer">{message.answer}</div>{message.sources.length>0&&<><h3>Sources</h3><ol>{message.sources.map(source=><li key={`${source.id}-${source.citation}`}><strong>[Source {source.citation}] {source.source}</strong> — relevance {source.score.toFixed(3)}<blockquote>{source.text}</blockquote></li>)}</ol></>}</section>)}</article>;
}
