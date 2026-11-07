import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { Focus, Minus, Plus, Radar, X } from 'lucide-react';
import { api, type MapPoint, type PassageMap } from '../../lib/api';

interface Props {
  sessionId: string;
  question?: string;
  topK: number;
  selectedIds: number[];
  focusId?: number | null;
  onPin?: (point: MapPoint) => void;
}
const W = 860, H = 550;
const palette = ['#9B7CFF','#52DDF5','#F178D5','#FFCA8A','#7DE2B9','#FC8EAB','#8BB4FF','#E0BCF2'];
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

type View = { x: number; y: number; scale: number };
const initial: View = { x: 0, y: 0, scale: 1 };
export default function ConstellationMap({ sessionId, question, topK, selectedIds, focusId, onPin }: Props) {
  const [data, setData] = useState<PassageMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState('all');
  const [hover, setHover] = useState<number | null>(null);
  const [pin, setPin] = useState<number | null>(null);
  const [view, setView] = useState<View>(initial);
  const svg = useRef<SVGSVGElement>(null);
  const suppressClick = useRef(false);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setFile('all'); setHover(null); setPin(null); setView(initial);
    api.map(sessionId, { question, topK, signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) {setData(result);setLoading(false);}
    }).catch(err => { if (!controller.signal.aborted) {setError(err instanceof Error ? err.message : 'Unable to load the constellation.');setLoading(false);} });
    return () => controller.abort();
  }, [sessionId, question, topK]);

  useEffect(() => { if (focusId !== null && focusId !== undefined) { setFile('all'); setPin(focusId); } }, [focusId]);
  const files = useMemo(() => Array.from(new Set(data?.points.map(p => p.file) ?? [])), [data]);
  const colors = useMemo(() => new Map(files.map((name, index) => [name, palette[index % palette.length]])), [files]);
  const coords = useMemo(() => {
    const pts = data?.points ?? [];
    const valuesX = pts.map(p => p.x); const valuesY = pts.map(p => p.y);
    const minX = Math.min(...valuesX, 0), maxX = Math.max(...valuesX, 0), minY = Math.min(...valuesY, 0), maxY = Math.max(...valuesY, 0);
    const rangeX = Math.max(maxX-minX, .00001), rangeY = Math.max(maxY-minY, .00001);
    const project = (x:number, y:number) => ({ x: 75 + ((x-minX)/rangeX)*710, y: 65 + ((y-minY)/rangeY)*420 });
    const points = pts.map(p => ({ ...p, ...project(p.x, p.y) }));
    return { points, query: data?.query_point ? project(data.query_point.x, data.query_point.y) : null };
  }, [data]);
  const highlighted = new Set(selectedIds.length ? selectedIds : data?.retrieved_ids ?? []);
  const selected = coords.points.find(p => p.id === (pin ?? hover ?? focusId));
  const present = coords.points.filter(p => file === 'all' || p.file === file);
  const lines = present.filter(p => highlighted.has(p.id));
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const dx = event.clientX-drag.current.x, dy = event.clientY-drag.current.y;
    if (Math.abs(dx)+Math.abs(dy)>3) drag.current.moved = true;
    setView(v => ({...v, x:drag.current!.vx+dx * W / Math.max(1,svg.current!.getBoundingClientRect().width), y:drag.current!.vy+dy * H / Math.max(1,svg.current!.getBoundingClientRect().height)}));
  };
  const stopDrag = () => { suppressClick.current = Boolean(drag.current?.moved); drag.current = null; };
  const zoomAt = useCallback((factor: number, x = W/2, y = H/2) => setView(v => {
    const scale = clamp(v.scale*factor, .6, 9);
    const ratio = scale/v.scale;
    return { scale, x: x-(x-v.x)*ratio, y:y-(y-v.y)*ratio };
  }), []);
  const wheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    zoomAt(event.deltaY < 0 ? 1.13 : 1/1.13, (event.clientX-rect.left)*W/rect.width, (event.clientY-rect.top)*H/rect.height);
  };
  const pinStar = (p: MapPoint) => { setPin(old => old === p.id ? null : p.id); onPin?.(p); };

  return <section className="flex min-h-0 flex-1 flex-col" aria-label="Interactive constellation map">
    <div className="flex items-center justify-between gap-2"><div><p className="eyebrow">THE OBSERVATORY</p><h2 className="mt-1 font-display text-base font-semibold">Passage constellation</h2></div><Radar style={{color:'var(--violet)'}} size={22}/></div>
    <p className="mt-2 text-xs leading-5" style={{color:'var(--muted)'}}>Every star is an indexed passage. Glowing threads connect retrieved evidence to your question.</p>
    <div className="mt-3 flex flex-wrap items-center gap-2"><label htmlFor="map-filter" className="text-xs">Filter</label><select id="map-filter" className="constellation-select min-w-0 max-w-full flex-1" value={file} onChange={e=>setFile(e.target.value)}><option value="all">All documents ({data?.points.length ?? 0})</option>{files.map(name=><option value={name} key={name}>{name}</option>)}</select></div>
    <div className="star-map mt-3 relative min-h-[280px] flex-1 overflow-hidden rounded-2xl" aria-busy={loading}>
      {loading ? <div className="space-y-4 p-6" aria-label="Loading constellation"><div className="skeleton h-3 w-2/3 rounded-full"/><div className="skeleton h-40 rounded-2xl"/><div className="skeleton h-3 w-1/2 rounded-full"/></div> : error ? <div role="alert" className="p-5 text-sm">{error}</div> : <>
        <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="h-full w-full touch-none" role="img" aria-label={`Star map with ${present.length} passages; use buttons for zoom, drag to pan, select a star to pin it`} onWheel={wheel} onPointerDown={e => {if(e.button !== 0) return; drag.current={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y,moved:false};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={move} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
          <defs><radialGradient id="mapGlow"><stop offset="0%" stopColor="#9B7CFF" stopOpacity=".21"/><stop offset="100%" stopColor="#9B7CFF" stopOpacity="0"/></radialGradient><filter id="starHalo"><feGaussianBlur stdDeviation="5"/></filter></defs>
          <rect width={W} height={H} fill="url(#mapGlow)"/>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            {Array.from({length:24},(_,i)=><line key={`v${i}`} x1={i*42} y1="0" x2={i*42} y2={H} stroke="var(--border)" strokeWidth=".35"/>)}
            {Array.from({length:18},(_,i)=><line key={`h${i}`} y1={i*42} x1="0" y2={i*42} x2={W} stroke="var(--border)" strokeWidth=".35"/>)}
            {coords.query && <>{lines.map(p=><line className="constellation-thread" key={p.id} x1={coords.query!.x} y1={coords.query!.y} x2={p.x} y2={p.y} stroke={colors.get(p.file)} strokeWidth="1.5" strokeOpacity=".8"/>)}<circle cx={coords.query.x} cy={coords.query.y} r="25" fill="#9B7CFF" opacity=".16"/><circle cx={coords.query.x} cy={coords.query.y} r="8" fill="#FFCA8A" stroke="#fff" strokeWidth="1.5"><title>Current question</title></circle></>}
            {present.map(p=>{const lit=highlighted.has(p.id), active=pin===p.id || focusId===p.id; const color=colors.get(p.file) || palette[0]; return <g key={p.id} role="button" tabIndex={0} aria-label={`Passage ${p.id+1} from ${p.source}${lit?', retrieved':''}`} onFocus={()=>setHover(p.id)} onBlur={()=>setHover(null)} onMouseEnter={()=>setHover(p.id)} onMouseLeave={()=>setHover(null)} onClick={()=>{if(!suppressClick.current)pinStar(p); suppressClick.current = false}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pinStar(p);}}} style={{cursor:'pointer'}}>
              {lit && <circle className="star-pulse" cx={p.x} cy={p.y} r={active?18:13} fill={color} opacity=".28" filter="url(#starHalo)"/>}
              <circle cx={p.x} cy={p.y} r={active?8:lit?5.5:3.6} fill={color} stroke={active?'#fff':'none'} strokeWidth="2" opacity={lit||active?1:.68}/><circle cx={p.x} cy={p.y} r="12" fill="transparent"/>
              <title>{p.source}: {p.text.slice(0,180)}</title>
            </g>;})}
          </g>
        </svg>
        <div className="absolute right-2 top-2 flex flex-col gap-1"><button type="button" className="map-control" aria-label="Zoom in" onClick={()=>zoomAt(1.25)}><Plus size={17}/></button><button type="button" className="map-control" aria-label="Zoom out" onClick={()=>zoomAt(.8)}><Minus size={17}/></button><button type="button" className="map-control" aria-label="Reset map view" onClick={()=>setView(initial)}><Focus size={17}/></button></div>
        {selected && <div className="star-tooltip absolute bottom-2 left-2 right-2 max-h-44 overflow-y-auto rounded-xl p-3 text-xs shadow-xl"><div className="flex items-center justify-between gap-2"><strong className="break-all">{selected.source}</strong>{pin!==null&&<button type="button" aria-label="Unpin passage" onClick={()=>setPin(null)}><X size={14}/></button>}</div><p className="mt-1 line-clamp-4 leading-5">{selected.text}</p><p className="mt-2 font-mono" style={{color:'var(--cyan)'}}>{highlighted.has(selected.id)?'✦ RETRIEVED EVIDENCE':'PASSAGE'} · #{selected.id+1}</p></div>}
      </>}
    </div>
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2 text-[10px]" style={{color:'var(--muted)'}}>{files.map(name=><span key={name} className="flex min-w-0 items-center gap-1"><i className="h-2 w-2 shrink-0 rounded-full" style={{background:colors.get(name)}}/><span className="max-w-36 truncate" title={name}>{name}</span></span>)}</div>
    <p className="mt-3 font-mono text-[10px]" style={{color:'var(--muted)'}}>{present.length} stars · {lines.length} highlighted · Scroll to zoom · Drag to pan</p>
  </section>;
}
