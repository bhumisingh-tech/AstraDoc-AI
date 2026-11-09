import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { BookOpenText, ChevronLeft, ChevronRight, Moon, Orbit, PanelLeftClose, PanelLeftOpen, Sun, Trash2, WifiOff, Radar, SlidersHorizontal, Download, Sparkles } from 'lucide-react';
import { api, streamChat, uploadWithProgress, type AnswerMode, type Health, type SessionInfo, type Source } from './lib/api';
import { PortalUpload } from './components/library/PortalUpload';
import { StreamingChat, type ChatMessage } from './components/chat/StreamingChat';
import { SourceDrawer } from './components/citations/CitationCards';
const ConstellationMap = lazy(() => import('./components/constellation/ConstellationMap')); // Only downloaded when the map is visible.
import { usePreferences } from './hooks/usePreferences';
import { DocumentInsights } from './components/insights/DocumentInsights';
import { ControlPanel } from './components/controls/ControlPanel';
import { ExportShare, PrintableConversation } from './components/export/ExportShare';

const empty: SessionInfo = { session_id: null, documents: [], passage_count: 0, total_bytes: 0 };
const id = () => crypto.randomUUID();
const messageError = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please retry.';

/** The app never stores uploaded documents or the Gemini key in the browser. */
export default function App() {
  const { preferences, setPreferences, reducedMotion } = usePreferences();
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);
  const [session, setSession] = useState<SessionInfo>(empty);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [busyUpload, setBusyUpload] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [busyChat, setBusyChat] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [mobileTab, setMobileTab] = useState<'chat' | 'library' | 'map' | 'insights' | 'export'>('chat');
  const [rightTab, setRightTab] = useState<'map' | 'insights' | 'export'>('map');
  const [controlOpen, setControlOpen] = useState(false);
  const [documentRevision, setDocumentRevision] = useState(0);
  const [mapOpen, setMapOpen] = useState(true);
  const [mapOverlay, setMapOverlay] = useState(false);
  const [activeSource, setActiveSource] = useState<{source: Source; query:string} | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  const chatAbort = useRef<AbortController | null>(null);
  const activeRequest = useRef<string | null>(null);
  const currentSession = useRef<SessionInfo>(empty);
  const uploadInFlight = useRef(false);
  const chatInFlight = useRef(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    const controller = new AbortController();
    api.health(controller.signal).then(info => { setHealth(info); setOffline(false); }).catch(() => { if (!controller.signal.aborted) setOffline(true); });
    return () => { isMounted.current = false; controller.abort(); chatAbort.current?.abort(); };
  }, []);

  const refreshInsights = async (sessionId: string) => {
    try { const info = await api.insights(sessionId); if (currentSession.current.session_id === sessionId && isMounted.current) setSuggested(info.suggested_questions); }
    catch { if (isMounted.current) setSuggested([]); }
  };
  const upload = useCallback(async (files: File[]) => {
    if (uploadInFlight.current || chatInFlight.current) return;
    uploadInFlight.current = true; setBusyUpload(true); setUploadError(null); setUploadProgress(0);
    const { promise } = uploadWithProgress(files, currentSession.current.session_id ?? undefined, setUploadProgress);
    try {
      const result = await promise;
      currentSession.current = result; setSession(result); setMessages([]); setChatError(null); setDocumentRevision(value => value + 1);
      if (result.session_id) await refreshInsights(result.session_id);
      setMobileTab('chat');
    } catch (error) { setUploadError(messageError(error)); }
    finally { uploadInFlight.current = false; setBusyUpload(false); }
  }, []);
  const remove = async (name: string) => {
    const sid = currentSession.current.session_id; if (!sid || busyChat || busyUpload) return;
    setBusyUpload(true); setUploadError(null);
    try {
      const result = await api.removeFile(sid, name);
      currentSession.current = result; setSession(result); setMessages([]); setChatError(null); setDocumentRevision(value => value + 1);
      if (result.session_id) await refreshInsights(result.session_id); else setSuggested([]);
    } catch (error) { setUploadError(messageError(error)); }
    finally { setBusyUpload(false); }
  };
  const ask = async (question: string, regenerate = false) => {
    const sid = currentSession.current.session_id;
    if (!sid || chatInFlight.current || uploadInFlight.current || !question.trim()) return;
    const cleanQuestion = question.trim();
    const request = id(); activeRequest.current = request; chatInFlight.current = true;
    setBusyChat(true); setChatError(null); setMobileTab('chat');
    const controller = new AbortController(); chatAbort.current = controller;
    const item: ChatMessage = { id: request, question: cleanQuestion, answer: '', sources: [], mode: null, status: 'streaming' };
    setMessages(previous => regenerate ? [...previous.slice(0, -1), item] : [...previous, item]);
    const patch = (update: (msg: ChatMessage) => ChatMessage) => {
      if (activeRequest.current !== request || !isMounted.current) return;
      setMessages(previous => previous.map(msg => msg.id === request ? update(msg) : msg));
    };
    try {
      await streamChat({ sessionId: sid, question: cleanQuestion, topK: preferences.topK, regenerateLast: regenerate, signal: controller.signal }, event => {
        if (event.event === 'sources') patch(msg => ({ ...msg, sources: event.data.sources }));
        if (event.event === 'mode') patch(msg => ({ ...msg, mode: event.data.mode }));
        if (event.event === 'warning') patch(msg => ({ ...msg, warning: event.data.message }));
        if (event.event === 'token') patch(msg => ({ ...msg, answer: msg.answer + event.data.text }));
        if (event.event === 'done') patch(msg => ({ ...msg, status: 'done' }));
      });
    } catch (error) {
      if (controller.signal.aborted) patch(msg => ({ ...msg, status: 'stopped' }));
      else { patch(msg => ({ ...msg, status: 'error' })); setChatError(messageError(error)); }
    } finally {
      if (activeRequest.current === request) { chatInFlight.current = false; setBusyChat(false); activeRequest.current = null; chatAbort.current = null; }
    }
  };
  const stop = () => chatAbort.current?.abort();
  const regenerate = () => { const last = messages[messages.length - 1]; if (last) void ask(last.question, true); };
  const clear = async () => {
    const sid = session.session_id; if (!sid || busyChat || busyUpload || messages.length === 0) return;
    try { await api.clearChat(sid); setMessages([]); setChatError(null); }
    catch (error) { setChatError(messageError(error)); }
  };
  const enabled = Boolean(session.session_id && session.passage_count);
  const latest = messages[messages.length-1];
  const openSource = (source: Source, query: string) => setActiveSource({source,query});
  const locateSource = (source: Source) => { setFocusId(source.id); setMapOpen(true); setRightTab('map'); setMobileTab('map'); };
  const mapPanel = session.session_id && <Suspense fallback={<div className="skeleton h-64 rounded-xl" aria-label="Loading map"/>}><ConstellationMap sessionId={session.session_id} question={latest?.question} topK={preferences.topK} selectedIds={latest?.sources.map(src=>src.id)??[]} focusId={focusId} /></Suspense>;
  const mode: AnswerMode = health?.answer_mode ?? 'evidence';
  const insightPanel = <DocumentInsights sessionId={session.session_id} revision={documentRevision} disabled={busyChat || busyUpload} onAsk={question => void ask(question)}/>;
  const exportPanel = <ExportShare sessionId={session.session_id} messages={messages} disabled={busyChat || busyUpload}/>;
  const rightContent = rightTab === 'insights' ? insightPanel : rightTab === 'export' ? exportPanel : mapPanel || <div className="flex h-full flex-col justify-center gap-3 text-center"><Orbit className="mx-auto" size={36} style={{color:'var(--violet)'}}/><p className="font-display font-semibold">Your night sky awaits.</p><p className="text-sm" style={{color:'var(--muted)'}}>Upload documents to assemble the star map.</p></div>;
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ',') { event.preventDefault(); setControlOpen(true); }
    };
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, []);

  return <MotionConfig reducedMotion={reducedMotion ? 'always' : 'never'}>
    <div className="cosmos" aria-hidden="true"/>
    <div className="app-frame mx-auto flex min-h-dvh w-full max-w-[1700px] flex-col px-3 pb-3 pt-3 sm:px-5 lg:px-7">
      <header className="no-print mb-4 flex shrink-0 items-center justify-between gap-3 px-1 py-1" aria-label="Application header">
        <div className="flex min-w-0 items-center gap-3"><div className="glass-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"><Orbit size={23} style={{ color: 'var(--violet)' }}/></div><div className="min-w-0"><p className="truncate font-display text-lg font-bold tracking-[-.045em]">DocChat <span className="gradient-text">Bhumi</span></p><p className="eyebrow text-[9px]">CONSTELLATION</p></div></div>
        <div className="flex items-center gap-2"><span className="hidden items-center gap-2 rounded-full border px-3 py-2 text-xs sm:inline-flex" style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}>{offline ? <WifiOff size={13}/> : <span className="status-dot"/>}{offline ? 'Backend offline' : health ? mode === 'gemini' ? (health.gemini_streaming ? 'Gemini AI (streaming)' : 'Gemini AI ready') : 'Evidence-only mode' : 'Connecting…'}</span>
          <button type="button" className="quiet-button hidden md:inline-flex xl:hidden" aria-label="Open constellation map" onClick={()=>{setRightTab('map');setMapOverlay(true);}}><Radar size={18}/></button>
          <button type="button" className="quiet-button hidden md:inline-flex xl:hidden" aria-label="Open document insights" title="Insights" onClick={()=>{setRightTab('insights');setMapOverlay(true);}}><Sparkles size={18}/></button>
          <button type="button" className="quiet-button hidden md:inline-flex xl:hidden" aria-label="Open export options" title="Export" onClick={()=>{setRightTab('export');setMapOverlay(true);}}><Download size={18}/></button>
          <label className="hidden items-center gap-2 text-[10px] lg:flex" style={{color:'var(--muted)'}}>Sources: {preferences.topK}<input aria-label="Sources per answer" type="range" min="2" max="8" className="w-16" value={preferences.topK} onChange={e=>setPreferences(p=>({...p,topK:Number(e.target.value)}))}/></label>
          <button type="button" className="quiet-button" title="Open controls (Ctrl+,)" aria-label="Open control panel" onClick={()=>setControlOpen(true)}><SlidersHorizontal size={18}/></button>
          <button type="button" className="quiet-button" disabled={!messages.length || busyChat || busyUpload} onClick={() => void clear()} aria-label="Clear conversation" title="Clear conversation"><Trash2 size={18}/></button>
          <button type="button" className="quiet-button" onClick={() => setPreferences(p => ({ ...p, theme: p.theme === 'dark' ? 'light' : 'dark' }))} aria-label={`Switch to ${preferences.theme === 'dark' ? 'light' : 'dark'} theme`}>{preferences.theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button>
        </div>
      </header>
      <div className="workspace relative grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(0,1fr)]" style={{ gridTemplateColumns: undefined }}>
        <div className="hidden min-h-0 gap-3 md:flex">
          <AnimatePresence initial={false}>{leftOpen && <motion.aside initial={{ width: 0, opacity: 0 }} animate={{ width: 320, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: .2 }} className="glass min-h-0 max-w-[37%] shrink-0 overflow-hidden"><div className="h-full min-w-[260px] p-4 lg:p-5"><PortalUpload documents={session.documents} busy={busyUpload || busyChat} progress={uploadProgress} error={uploadError} limitBytes={session.limits?.max_upload_bytes ?? health?.limits?.max_upload_bytes} onUpload={upload} onRemove={remove}/></div></motion.aside>}</AnimatePresence>
          <main className="glass relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-4 sm:p-6"><button type="button" className="quiet-button absolute right-4 top-4 z-10 !p-1.5" title="Toggle library" aria-label={leftOpen ? 'Collapse document library' : 'Expand document library'} onClick={() => setLeftOpen(p => !p)}>{leftOpen ? <PanelLeftClose size={15}/> : <PanelLeftOpen size={15}/>}</button><div className="min-h-0 flex-1 pr-0"><StreamingChat messages={messages} busy={busyChat} enabled={enabled && !busyUpload} suggested={suggested} mode={mode} onAsk={question => void ask(question)} onStop={stop} onRegenerate={regenerate} onOpenSource={openSource}/></div></main>
          <div className="hidden shrink-0 xl:flex"><button type="button" className="quiet-button !p-2" onClick={()=>setMapOpen(v=>!v)} aria-label={mapOpen?'Collapse observatory':'Expand observatory'} title="Toggle constellation map"><Radar size={18}/></button></div>
          {mapOpen && <aside className="glass hidden w-[min(32vw,380px)] shrink-0 flex-col overflow-hidden p-4 xl:flex" aria-label="Observatory and insights"><div className="observatory-tabs no-print mb-3" role="tablist" aria-label="Right panel">{(['map','insights','export'] as const).map(tab=><button key={tab} role="tab" aria-selected={rightTab===tab} className={rightTab===tab?'active':''} onClick={()=>setRightTab(tab)}>{tab==='map'?'Stars':tab==='insights'?'Insights':'Export'}</button>)}</div><div className="min-h-0 flex-1 overflow-auto">{rightContent}</div></aside>}

        </div>
        <div className="flex min-h-0 flex-col md:hidden"><div className="glass min-h-0 flex-1 overflow-hidden p-4">{mobileTab === 'library' ? <PortalUpload documents={session.documents} busy={busyUpload || busyChat} progress={uploadProgress} error={uploadError} limitBytes={session.limits?.max_upload_bytes ?? health?.limits?.max_upload_bytes} onUpload={upload} onRemove={remove}/> : mobileTab === 'map' ? (mapPanel || <p className="p-8 text-center">Upload a document to see its stars.</p>) : mobileTab === 'insights' ? insightPanel : mobileTab === 'export' ? exportPanel : <StreamingChat messages={messages} busy={busyChat} enabled={enabled && !busyUpload} suggested={suggested} mode={mode} onAsk={question => void ask(question)} onStop={stop} onRegenerate={regenerate} onOpenSource={openSource}/>}</div><nav className="no-print mt-3 flex shrink-0 gap-2" aria-label="Mobile navigation"><button className={`mobile-tab ${mobileTab === 'library' ? 'selected' : ''}`} onClick={() => setMobileTab('library')} aria-current={mobileTab === 'library' ? 'page' : undefined}><BookOpenText size={17}/> Library</button><button className={`mobile-tab ${mobileTab === 'chat' ? 'selected' : ''}`} onClick={() => setMobileTab('chat')} aria-current={mobileTab === 'chat' ? 'page' : undefined}><ChevronLeft size={16}/> Chat <ChevronRight size={16}/></button><button className={`mobile-tab ${mobileTab === 'map' ? 'selected' : ''}`} onClick={() => setMobileTab('map')} aria-current={mobileTab === 'map' ? 'page' : undefined}><Radar size={16}/> Map</button><button className={`mobile-tab ${mobileTab === 'insights' ? 'selected' : ''}`} onClick={() => setMobileTab('insights')} aria-current={mobileTab === 'insights' ? 'page' : undefined}><Sparkles size={16}/> Insights</button><button className={`mobile-tab ${mobileTab === 'export' ? 'selected' : ''}`} onClick={() => setMobileTab('export')} aria-current={mobileTab === 'export' ? 'page' : undefined}><Download size={16}/> Export</button></nav></div>
      </div>
      {mapOverlay && <div role="dialog" aria-modal="true" aria-label="Constellation map" className="source-overlay no-print" onMouseDown={event=>{if(event.currentTarget===event.target)setMapOverlay(false);}}><div className="glass flex h-full w-full max-w-2xl flex-col p-5"><div className="mb-2 flex items-center justify-between gap-3"><div className="observatory-tabs no-print" role="tablist" aria-label="Insight drawer">{(['map','insights','export'] as const).map(tab=><button key={tab} role="tab" aria-selected={rightTab===tab} className={rightTab===tab?'active':''} onClick={()=>setRightTab(tab)}>{tab==='map'?'Stars':tab==='insights'?'Insights':'Export'}</button>)}</div><button type="button" className="quiet-button" onClick={()=>setMapOverlay(false)} aria-label="Close drawer">Close</button></div><div className="min-h-0 flex-1 overflow-auto">{rightContent}</div></div></div>}
      <ControlPanel open={controlOpen} onClose={()=>setControlOpen(false)} preferences={preferences} onChange={setPreferences} health={health} chatCount={messages.length} busy={busyChat || busyUpload} onClear={clear}/>
      <PrintableConversation messages={messages}/>
      <SourceDrawer source={activeSource?.source ?? null} query={activeSource?.query ?? ''} onClose={()=>setActiveSource(null)} onLocate={locateSource}/>
      {chatError && <div role="alert" className="mt-2 rounded-xl border px-4 py-2 text-xs" style={{ borderColor: 'var(--border-strong)', color: 'var(--amber)' }}>{chatError}</div>}
            <footer className="no-print mt-3 flex shrink-0 items-center justify-between gap-2 px-1 font-mono text-[10px]" style={{ color: 'var(--muted)' }}><span>DOCCHAT CONSTELLATION</span><span title="Gemini is optional: it generates grounded answers from retrieved excerpts. Evidence-only mode still shows cited passages.">{session.passage_count} STARS INDEXED · {mode === 'gemini' ? 'AI + EVIDENCE' : 'EVIDENCE-ONLY'}</span></footer>
    </div>
  </MotionConfig>;
}
