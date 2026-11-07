import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, Files, Hash, RefreshCw, ScanText, Timer, WandSparkles, AlertCircle } from 'lucide-react';
import { api, type Insights } from '../../lib/api';

type Props = { sessionId: string | null; revision: number; disabled: boolean; onAsk: (question: string) => void };

/** All figures and keywords come from FastAPI's real TF-IDF index. */
export function DocumentInsights({ sessionId, revision, disabled, onAsk }: Props) {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setInsights(null); setError(null);
    if (!sessionId) return;
    const controller = new AbortController();
    setLoading(true);
    api.insights(sessionId, controller.signal).then(setInsights).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load insights.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [sessionId, revision, retry]);
  const maxWeight = useMemo(() => Math.max(1, ...((insights?.keywords ?? []).map(term => term.weight))), [insights]);
  if (!sessionId) return <section className="flex h-full flex-col items-center justify-center gap-3 p-7 text-center" aria-label="Document insights"><WandSparkles size={32} style={{color:'var(--violet)'}}/><h2 className="font-display text-lg font-semibold">Discover what matters.</h2><p className="text-sm" style={{color:'var(--muted)'}}>Upload a document and its ideas will come into focus.</p></section>;
  if (loading) return <section className="space-y-4 p-2" aria-busy="true" aria-label="Loading document insights"><div className="skeleton h-8 rounded-lg"/><div className="skeleton h-24 rounded-xl"/><div className="skeleton h-16 rounded-xl"/><div className="skeleton h-24 rounded-xl"/></section>;
  if (error) return <section role="alert" className="space-y-3 p-3"><AlertCircle size={22} style={{color:'var(--amber)'}}/><p className="text-sm">{error}</p><button className="micro-button" onClick={() => setRetry(v => v + 1)}><RefreshCw size={14}/> Retry insights</button></section>;
  if (!insights) return null;
  const metrics = [
    { label:'Files', value:insights.stats.files, icon:Files },
    { label:'Pages', value:insights.stats.pages, icon:BookOpen },
    { label:'Passages', value:insights.stats.passages, icon:ScanText },
    { label:'Words', value:insights.stats.words.toLocaleString(), icon:Hash },
    { label:'Read time', value:`${insights.stats.reading_minutes} min`, icon:Timer },
  ];
  return <section className="insights-panel space-y-5 overflow-y-auto" aria-label="Document insights">
    <header><p className="eyebrow">DOCUMENT INTELLIGENCE</p><h2 className="mt-2 font-display text-xl font-semibold">Insights <span className="gradient-text">at a glance</span></h2></header>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{metrics.map(({ label, value, icon: Icon }) => <div key={label} className="insight-stat"><Icon size={15} style={{color:'var(--violet)'}} aria-hidden="true"/><strong>{value}</strong><span>{label}</span></div>)}</div>
    <div className="insight-block"><div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-display text-sm font-semibold">Document overview</h3><span className="insight-tag">Extractive</span></div><p className="whitespace-pre-line text-sm leading-relaxed" style={{color:'var(--muted)'}}>{insights.summary || 'No readable document text is available.'}</p><p className="mt-3 text-[11px]" style={{color:'var(--muted)'}}>This preview consists of document passages, not an AI-generated summary.</p></div>
    <div className="insight-block"><h3 className="mb-1 font-display text-sm font-semibold">Topics in orbit</h3><p className="mb-4 text-xs" style={{color:'var(--muted)'}}>TF-IDF terms · Select a topic to ask about it</p><div className="flex flex-wrap gap-2">{insights.keywords.map((keyword, index) => <motion.button key={keyword.term} type="button" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:Math.min(index*.035,.4)}} disabled={disabled} onClick={() => onAsk(`What does the document say about ${keyword.term}?`)} className="keyword-chip" style={{opacity:disabled?.65:1}} title={`TF-IDF weight ${keyword.weight.toFixed(3)}`}><span className="keyword-signal" style={{opacity:Math.max(.35,keyword.weight/maxWeight)}}/>{keyword.term}</motion.button>)}</div></div>
    <div className="insight-block"><h3 className="mb-3 font-display text-sm font-semibold">By document</h3><div className="space-y-2">{insights.documents.map(file => <div key={file.name} className="flex items-start justify-between gap-3 text-xs"><span className="min-w-0 flex-1 break-words" title={file.name}>{file.name}</span><span className="shrink-0 font-mono" style={{color:'var(--muted)'}}>{file.passages} passages · {file.words.toLocaleString()} words</span></div>)}</div></div>
  </section>;
}
