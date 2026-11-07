import { useEffect, useRef } from 'react';
import { Check, Moon, SlidersHorizontal, Sun, Trash2, X, Zap, ShieldCheck, AlertTriangle } from 'lucide-react';
import type { Health } from '../../lib/api';
import type { Preferences } from '../../lib/preferences';

type Props = { open: boolean; onClose: () => void; preferences: Preferences; onChange: (update: (previous: Preferences) => Preferences) => void; health: Health | null; chatCount: number; busy: boolean; onClear: () => Promise<void> };

/** User settings persist through the existing preferences hook; the API key never reaches React. */
export function ControlPanel({ open, onClose, preferences, onChange, health, chatCount, busy, onClear }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab' && dialogRef.current) {
        const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)'));
        if (!items.length) return;
        const first = items[0], last = items[items.length-1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return <div className="source-overlay no-print" role="presentation" onMouseDown={event => { if(event.target===event.currentTarget) onClose(); }}>
    <div ref={dialogRef} className="source-drawer glass" role="dialog" aria-modal="true" aria-labelledby="control-title">
      <div className="flex items-start justify-between gap-2"><div><p className="eyebrow">MISSION CONTROL</p><h2 id="control-title" className="mt-1 font-display text-2xl font-semibold">Preferences</h2></div><button ref={closeRef} className="quiet-button" type="button" onClick={onClose} aria-label="Close control panel"><X size={18}/></button></div>
      <div className="mt-7 space-y-6">
        <section className="control-section"><label htmlFor="source-count" className="flex justify-between font-semibold"><span>Sources per answer</span><output htmlFor="source-count" className="font-mono" style={{color:'var(--cyan)'}}>{preferences.topK}</output></label><input id="source-count" className="mt-4 w-full accent-purple-400" type="range" min={2} max={8} step={1} value={preferences.topK} onChange={event => onChange(p => ({...p,topK:Number(event.target.value)}))}/><div className="mt-2 flex justify-between text-xs" style={{color:'var(--muted)'}}><span>2 · focused</span><span>8 · comprehensive</span></div></section>
        <section className="control-section"><h3 className="mb-3 font-semibold">Appearance</h3><div className="grid grid-cols-2 gap-2">{(['dark','light'] as const).map(theme => <button key={theme} type="button" aria-pressed={preferences.theme===theme} className={`control-choice ${preferences.theme===theme?'active':''}`} onClick={() => onChange(p => ({...p,theme}))}>{theme==='dark'?<Moon size={17}/>:<Sun size={17}/>}<span>{theme==='dark'?'Night sky':'Daylight'}</span>{preferences.theme===theme&&<Check size={13}/>}</button>)}</div></section>
        <section className="control-section"><h3 className="mb-3 font-semibold">Motion preferences</h3><div className="space-y-2">{([{value:'system',label:'Follow device preference'},{value:'reduced',label:'Reduce motion'},{value:'full',label:'Full animations'}] as const).map(option => <label key={option.value} className="control-radio"><input type="radio" name="motion" value={option.value} checked={preferences.motion===option.value} onChange={() => onChange(p => ({...p,motion:option.value}))}/>{option.label}</label>)}</div></section>
        <section className="control-section"><h3 className="mb-3 font-semibold">Answer engine</h3><div className="flex items-center gap-2"><Zap size={17} style={{color:'var(--violet)'}}/><strong>{health?.answer_mode==='gemini'?'Gemini AI':'Evidence-only'}</strong></div><p className="mt-2 text-xs leading-relaxed" style={{color:'var(--muted)'}}>{health?.gemini_configured ? `Server configured for ${health.model}. Answers remain grounded in uploaded passages.` : 'No Gemini API key detected on the server. The app cites retrieved evidence without generating an AI response.'}</p><p className="mt-2 flex items-center gap-2 text-[11px]" style={{color:'var(--muted)'}}><ShieldCheck size={14}/> API keys stay on the server.</p></section>
        <section className="control-section"><h3 className="mb-3 font-semibold">Conversation</h3><button disabled={busy||chatCount===0} type="button" className="micro-button" onClick={() => { if(window.confirm('Clear the current conversation? Your documents will remain uploaded.')) void onClear(); }}><Trash2 size={15}/> Clear chat ({chatCount})</button>{busy&&<p className="mt-2 text-xs" style={{color:'var(--muted)'}}>Finish the current action before clearing.</p>}</section>
        <p className="flex items-center gap-2 text-xs" style={{color:'var(--muted)'}}><SlidersHorizontal size={14}/> Preferences are saved in this browser. <AlertTriangle size={13}/> Document sessions are temporary.</p>
      </div>
    </div>
  </div>;
}
