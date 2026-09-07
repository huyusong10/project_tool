import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Handle, Position, BaseEdge, useNodesState, useNodesInitialized,
  useReactFlow, useUpdateNodeInternals, useViewport, useStoreApi, type Node, type NodeProps, type EdgeProps,
  type Edge, type Viewport, type Connection } from '@xyflow/react';
import ELK from 'elkjs/lib/elk-api';
import workerUrl from 'elkjs/lib/elk-worker.min.js?url';
import '@xyflow/react/dist/style.css';
import { flushSync } from 'react-dom';
import { inputPort, outputPort, portsFor, type RoutedLayout } from '../path-layout';
import { stableGraphLayout } from '../graph-layout';
import type { GraphCard, GraphLink } from '../path-projection';
import { requirementStatusLabels, riskLabels } from '../../shared/domain';

type CardData = GraphCard & { input: string[]; output: string[]; vertical: boolean; editing: boolean; highlighted: boolean; invalid: boolean };
type CardNode = Node<CardData, 'delivery'>;
type RouteEdge = Edge<{ route?: RoutedLayout['edges'][string]; critical: boolean; labelText: string }, 'delivery'>;
export type GraphConnectionIssue = { message: string; nodeIds?: string[]; edgeIds?: string[] };
export type DependencyGraphProps = {
  cards: GraphCard[]; links: GraphLink[]; selected: string; onSelect: (id: string) => void; viewKey: string;
  children?: ReactNode; editing?: boolean; selectedEdge?: string; onEdgeSelect?: (id: string) => void;
  onConnect?: (source: string, target: string) => void;
  validateConnection?: (source: string, target: string) => GraphConnectionIssue | null;
  onInvalid?: (issue: GraphConnectionIssue) => void; onDropEmpty?: (source: string) => void;
  highlighted?: string[]; invalidNodes?: string[]; locate?: { id: string; sequence: number };
  focusId?:string; onUndo?:()=>void; onRedo?:()=>void;
};
const viewports = new Map<string, Viewport>();
function readViewport(key: string): Viewport | undefined {
  try { return viewports.get(key) || JSON.parse(sessionStorage.getItem('pm-graph-view:' + key) || 'null') || undefined; } catch { return undefined; }
}
function saveViewport(key: string, value: Viewport) {
  viewports.set(key, value); try { sessionStorage.setItem('pm-graph-view:' + key, JSON.stringify(value)); } catch { /* Current view remains usable. */ }
}
const Card = memo(function Card({ id, data, selected }: NodeProps<CardNode>) {
  const update = useUpdateNodeInternals(), key = JSON.stringify([data.input, data.output, data.vertical, data.editing]);
  const previous = useRef(key);
  useEffect(() => { if (previous.current !== key) { previous.current = key; update(id); } }, [id, key, update]);
  const side = (input: boolean) => data.vertical ? input ? Position.Top : Position.Bottom : input ? Position.Left : Position.Right;
  const canInput = !['completed', 'cancelled'].includes(data.status) && data.kind !== 'acceptance';
  return <div className={'dependency-card' + (selected ? ' selected' : '') + (data.external ? ' external' : '') +
    (data.critical ? ' critical' : '') + (data.highlighted ? ' search-match' : '') + (data.invalid ? ' invalid' : '') +
    (['start', 'acceptance'].includes(data.kind) ? ' gate-card' : '')}>
    {data.input.map((edge, i) => <Handle key={edge} id={inputPort(edge)} type="target" position={side(true)} className="route-handle"
      style={data.vertical ? { left: (i + 1) * 100 / (data.input.length + 1) + '%' } : { top: (i + 1) * 100 / (data.input.length + 1) + '%' }} isConnectable={false}/>)}
    <div className="dependency-card-top"><span>{data.kind==='template'?'流程工作':data.external ? '外部交付' : data.critical ? '关键路径' : requirementStatusLabels[data.status as keyof typeof requirementStatusLabels] || '交付条件'}</span>
      {data.kind!=='template'&&<span className={'risk-badge risk-' + data.risk}>{['completed', 'cancelled'].includes(data.status) ? '已结束' : riskLabels[data.risk as keyof typeof riskLabels] || '待评估'}</span>}</div>
    <strong title={data.title}>{data.title}</strong><small title={data.subtitle}>{data.subtitle}</small>
    <div className="dependency-card-bottom"><span>{data.forecast || '交付待确认'}</span>{data.kind!=='template'&&<span>{data.floatDays === null ? '余量待确认' : '余量 ' + data.floatDays + ' 天'}</span>}</div>
    <small>{data.unknown ? '交付条件待确认' : data.hiddenCount ? '另有 ' + data.hiddenCount + ' 条关系' : '\u00a0'}</small>
    {data.output.map((edge, i) => <Handle key={edge} id={outputPort(edge)} type="source" position={side(false)} className="route-handle"
      style={data.vertical ? { left: (i + 1) * 100 / (data.output.length + 1) + '%' } : { top: (i + 1) * 100 / (data.output.length + 1) + '%' }} isConnectable={false}/>)}
    {data.editing && canInput && <Handle id="business-in" type="target" position={side(true)} className="business-handle" aria-label={data.title + '的开始入口'}/>}
    {data.editing && data.kind !== 'start' && <Handle id="business-out" type="source" position={side(false)} className="business-handle" aria-label={'从' + data.title + '的完成出口建立依赖'}/>}
  </div>;
});
function RoutedEdge({ id, data, selected }: EdgeProps<RouteEdge>) {
  const markerId = useId().replace(/:/g, '_'), { zoom } = useViewport();
  if (!data?.route) return null;
  const points = data.route.points.map(p => ({ ...p })), last = points.at(-1)!, previous = points.at(-2)!;
  const length = Math.hypot(last.x - previous.x, last.y - previous.y), gap = Math.min(6 / zoom,10, length / 3);
  if (length) { last.x -= (last.x - previous.x) / length * gap; last.y -= (last.y - previous.y) / length * gap; }
  const path = points.map((p, i) => (i ? 'L' : 'M') + ' ' + p.x + ' ' + p.y).join(' ');
  const color = selected ? 'var(--danger)' : data.critical ? 'var(--accent)' : 'var(--text-faint)', label = data.route.label;
  return <><defs><marker id={markerId} viewBox="0 0 8 8" refX="8" refY="4" markerWidth={Math.min(14,8 / zoom)} markerHeight={Math.min(14,8 / zoom)} markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill={color}/></marker></defs>
    <BaseEdge id={id} path={path} markerEnd={'url(#' + markerId + ')'} interactionWidth={20} style={{ stroke: color, strokeWidth: selected ? 2.8 : data.critical ? 2.2 : 1.3, vectorEffect: 'non-scaling-stroke' }}/>
    {label && <g className="dependency-edge-label"><rect x={label.x - 3} y={label.y} width={label.width + 6} height={20} rx={4}/><text x={label.x} y={label.y + 14}>{data.labelText}</text></g>}</>;
}
const nodeTypes = { delivery: Card }, edgeTypes = { delivery: RoutedEdge };
function Graph(props: DependencyGraphProps) {
  const { cards, links, selected, onSelect, viewKey, editing = false } = props;
  const container = useRef<HTMLDivElement>(null), [vertical, setVertical] = useState(false), [error, setError] = useState('');
  const [active, setActive] = useState(false), [busy, setBusy] = useState(true), [arrange, setArrange] = useState(0);
  const [rendered,setRendered]=useState(false);
  const flow = useReactFlow<CardNode>(), store = useStoreApi(), currentViewport = useViewport(), { zoom } = currentViewport;
  const viewportRef=useRef(currentViewport); viewportRef.current=currentViewport;
  const [nodes, setNodes, onNodesChange] = useNodesState<CardNode>([]);
  const [routes, setRoutes] = useState<RoutedLayout | null>(null), initialized = useNodesInitialized();
  const engine = useRef<InstanceType<typeof ELK> | null>(null), layoutRef = useRef<RoutedLayout | null>(null);
  const first = useRef(true), generation = useRef(0), anchor = useRef<string | undefined>(undefined), lastArrange = useRef(0), lastDirection = useRef(false);
  const located = useRef(0), cancelledConnection = useRef(false);
  const viewportKey = viewKey + (vertical ? ':down' : ':right');
  const previousFocus=useRef(props.focusId||'');
  useEffect(()=>{
    const next=props.focusId||'',key='pm-graph-branch:'+viewportKey;
    if(next&&!previousFocus.current){try{sessionStorage.setItem(key,JSON.stringify(viewportRef.current));}catch{/* View remains usable without storage. */}}
    if(!next&&previousFocus.current){try{const saved=JSON.parse(sessionStorage.getItem(key)||'null') as Viewport|null;if(saved)void flow.setViewport(saved);}catch{/* No saved branch viewport. */}}
    previousFocus.current=next;
  },[props.focusId,viewportKey,flow]);
  useEffect(()=>()=>{if(!first.current)saveViewport(viewportKey,viewportRef.current);},[viewportKey]);
  useEffect(() => { const worker = new ELK({ workerUrl }); engine.current = worker; return () => worker.terminateWorker(); }, []);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setVertical(entries[0].contentRect.width < 650));
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const down = (event: PointerEvent) => { if (!container.current?.contains(event.target as HTMLElement)) setActive(false); };
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, []);
  useEffect(() => { setNodes(previous => cards.map(card => {
    const old = previous.find(n => n.id === card.id), ports = portsFor(card.id, links);
    return { id: card.id, type: 'delivery', position: old?.position || { x: 0, y: 0 }, measured: old?.measured,
      selected: card.id === selected, data: { ...card, input: ports.input.map(e => e.id), output: ports.output.map(e => e.id), vertical, editing,
        highlighted: !!props.highlighted?.includes(card.id), invalid: !!props.invalidNodes?.includes(card.id) },
      style: { width: ['start', 'acceptance'].includes(card.kind) ? 184 : 244,opacity:layoutRef.current?.nodes[card.id]?1:0 } };
  })); }, [cards, links, selected, vertical, editing, props.highlighted, props.invalidNodes, setNodes]);
  const measuredLinks = useMemo(() => {
    const context = document.createElement('canvas').getContext('2d');
    if (context) context.font = '12px ' + getComputedStyle(document.body).fontFamily;
    return links.map(e => ({ ...e, labelWidth: e.label ? Math.ceil(context?.measureText(e.label).width || 44) + 8 : undefined }));
  }, [links]);
  const fitAvailable=useCallback(async(avoidPanels=false)=>{
    const element=container.current;if(!element)return;
    const rectangle=element.getBoundingClientRect(),layout=layoutRef.current;if(!layout)return;
    const boxes=Object.entries(layout.nodes).map(([id,p])=>{const n=flow.getNode(id);return {...p,width:n?.measured?.width||244,height:n?.measured?.height||154};});if(!boxes.length)return;
    const x=Math.min(...boxes.map(n=>n.x)),y=Math.min(...boxes.map(n=>n.y));
    const bounds={x,y,width:Math.max(...boxes.map(n=>n.x+n.width))-x,height:Math.max(...boxes.map(n=>n.y+n.height))-y};
    let left=20,right=rectangle.width-20,top=20,bottom=rectangle.height-110;
    for(const panel of element.querySelectorAll<HTMLElement>('[data-graph-panel]')){const p=panel.getBoundingClientRect();
      if(panel.dataset.graphPanel==='top')top=Math.max(top,p.bottom-rectangle.top+16);
      if(avoidPanels&&panel.dataset.graphPanel==='left'&&p.width<rectangle.width*.6)left=Math.max(left,p.right-rectangle.left+16);
      if(avoidPanels&&panel.dataset.graphPanel==='right'&&p.width<rectangle.width*.6)right=Math.min(right,p.left-rectangle.left-16);
      if(avoidPanels&&['left','right'].includes(panel.dataset.graphPanel||'')&&p.width>=rectangle.width*.6)bottom=Math.min(bottom,p.top-rectangle.top-16);
    }
    if(right-left<120){left=20;right=rectangle.width-20;}
    const z=Math.max(.02,Math.min(1,(right-left)/bounds.width*.92,(bottom-top)/bounds.height*.92));
    await flow.setViewport({x:(left+right)/2-(bounds.x+bounds.width/2)*z,y:(top+bottom)/2-(bounds.y+bounds.height/2)*z,zoom:z});
  },[flow]);
  const structure = JSON.stringify([nodes.map(n => [n.id, n.measured?.width, n.measured?.height]), measuredLinks.map(e => [e.id, e.source, e.target, e.label, e.labelWidth]), vertical, arrange]);
  useEffect(() => {
    if (!initialized || !engine.current || !nodes.length || nodes.some(n => !n.measured?.width || !n.measured?.height)) { if (!cards.length) setBusy(false); return; }
    let cancelled = false; const id = ++generation.current, started = performance.now();
    setBusy(true); setError('');
    const directionChanged=lastDirection.current!==vertical;
    const reset = lastArrange.current !== arrange || directionChanged;
    const old = layoutRef.current, anchorId = anchor.current || selected;
    void stableGraphLayout(engine.current, nodes.map(n => ({ id: n.id, width: n.measured!.width!, height: n.measured!.height! })), measuredLinks, vertical, reset ? null : old, anchorId, reset).then(layout => {
      if (cancelled || id !== generation.current) return;
      performance.measure('pm-path-layout', { start: started, end: performance.now() });
      setNodes(current => current.map(n => ({ ...n, position: layout.nodes[n.id] || n.position,style:{...n.style,opacity:1} })));
      setRoutes(layout); layoutRef.current = layout;
      if (first.current || reset) {
        const initial = first.current; first.current = false;
        requestAnimationFrame(() => { if(cancelled||id!==generation.current)return; const saved = (initial||directionChanged) && readViewport(viewportKey); void (saved ? flow.setViewport(saved) : fitAvailable()).then(()=>{if(!cancelled&&id===generation.current){setBusy(false);setRendered(true);}}); });
      } else if (anchorId && old?.nodes[anchorId] && layout.nodes[anchorId]) {
        const v = flow.getViewport(), before = old.nodes[anchorId], after = layout.nodes[anchorId];
        if (before.x !== after.x || before.y !== after.y) void flow.setViewport({ ...v, x: v.x + (before.x - after.x) * v.zoom, y: v.y + (before.y - after.y) * v.zoom });
        setBusy(false);
      } else {
        setBusy(false);
      }
      lastArrange.current = arrange; lastDirection.current = vertical;
    }).catch(caught => { if (!cancelled) { setError(caught.message); setBusy(false); } });
    return () => { cancelled = true; };
    // Layout identity contains measured geometry and topology; selection and decoration never trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structure, initialized, setNodes]);
  const locate = useCallback((id: string) => {
    const node = flow.getNode(id), element = container.current;
    if (!node || !element) return;
    const bounds = element.getBoundingClientRect(), v = flow.getViewport();
    let left = 20, right = bounds.width - 20, top = 100, bottom = bounds.height - 85;
    for (const panel of element.querySelectorAll<HTMLElement>('[data-graph-panel]')) {
      const p = panel.getBoundingClientRect(); if (!p.width || !p.height) continue;
      if (panel.dataset.graphPanel === 'right') { if (p.width > bounds.width * .6) bottom = Math.min(bottom, p.top - bounds.top - 12); else right = Math.min(right, p.left - bounds.left - 12); }
      if (panel.dataset.graphPanel === 'left') { if (p.width > bounds.width * .6) bottom = Math.min(bottom, p.top - bounds.top - 12); else left = Math.max(left, p.right - bounds.left + 12); }
      if (panel.dataset.graphPanel === 'top') top = Math.max(top, p.bottom - bounds.top + 12);
    }
    if (right - left < 120) { left = 20; right = bounds.width - 20; }
    void flow.setViewport({ zoom: v.zoom, x: (left + right) / 2 - (node.position.x + (node.measured?.width || 244) / 2) * v.zoom,
      y: (top + bottom) / 2 - (node.position.y + (node.measured?.height || 154) / 2) * v.zoom });
  }, [flow]);
  useEffect(() => { if (props.locate && !busy && located.current !== props.locate.sequence) { located.current=props.locate.sequence; locate(props.locate.id); } }, [props.locate, busy, locate]);
  const edges = useMemo<RouteEdge[]>(() => links.map(e => ({ ...e, type: 'delivery', sourceHandle: outputPort(e.id), targetHandle: inputPort(e.id),
    label: undefined, selected: e.id === props.selectedEdge, reconnectable: false,
    data: { route: routes?.edges[e.id], critical: e.critical, labelText: e.label || '' } })), [links, routes, props.selectedEdge]);
  const validate = (source: string, target: string) => props.validateConnection?.(source, target) || null;
  const connect = (connection: Connection) => {
    const issue = validate(connection.source, connection.target);
    if (issue) { setError(issue.message); props.onInvalid?.(issue); return; }
    setError(''); anchor.current = connection.source; props.onConnect?.(connection.source, connection.target);
  };
  return <div className={'dependency-canvas' + (active ? ' is-active' : '')} ref={container} role="region" tabIndex={0}
    aria-label="动态交付依赖图" data-layout-ready={!busy} data-canvas-active={active} data-rendered-layout={rendered}
    onPointerDownCapture={event => {
      if ((event.target as HTMLElement).closest('.graph-view-controls')) return;
      if ((event.target as HTMLElement).closest('.graph-overlay')) { setActive(false); return; }
      flushSync(()=>setActive(true)); if (!(event.target as HTMLElement).closest('input,button,select,textarea')) event.currentTarget.focus({ preventScroll: true });
    }}
    onMouseDownCapture={event=>{if(event.button===1)event.preventDefault();}}
    onAuxClick={event=>{if(event.button===1)event.preventDefault();}}
    onKeyDownCapture={event => {
      if ((event.target as HTMLElement).closest('.graph-overlay,input,textarea,select')) return;
      if(active&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&(props.onUndo||props.onRedo)){event.preventDefault();if(event.shiftKey)props.onRedo?.();else props.onUndo?.();}
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (store.getState().connection.inProgress) { cancelledConnection.current=true; store.getState().cancelConnection(); } else setActive(false); }
    }}>
    {busy && <div className="dependency-layout-notice" role="status">正在自动排布…</div>}
    {error && <div className="dependency-layout-notice warning-banner" role="alert">{error}<button onClick={() => setError('')}>关闭</button></div>}
    <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      nodesDraggable={false} nodesConnectable={editing} deleteKeyCode={null} autoPanOnNodeFocus={false} autoPanOnConnect={active}
      zoomOnScroll={false} panOnScroll={active} zoomOnPinch={active} zoomOnDoubleClick={false} preventScrolling={active}
      zoomActivationKeyCode={active ? ['Control', 'Meta'] : null} panActivationKeyCode={active ? 'Space' : null}
      panOnDrag={[1]} selectionKeyCode={null} multiSelectionKeyCode={null} connectOnClick={editing}
      onConnectStart={()=>{cancelledConnection.current=false;}} onConnect={connect} isValidConnection={connection => !!editing && !validate(connection.source, connection.target)}
      onConnectEnd={(_, connection) => {
        if(cancelledConnection.current)return;
        if (!connection.fromNode || connection.isValid) return;
        if (connection.toNode) { const issue = validate(connection.fromNode.id, connection.toNode.id); if (issue) { setError(issue.message); props.onInvalid?.(issue); } }
        else if (connection.fromHandle?.type === 'source') props.onDropEmpty?.(connection.fromNode.id);
      }}
      onNodeClick={(_, node) => onSelect(node.id)} onEdgeClick={(_, edge) => props.onEdgeSelect?.(edge.id)}
      onMoveEnd={(_, v) => {if(!busy&&!first.current)saveViewport(viewportKey, v);}} minZoom={.02} maxZoom={1.5} fitView={false}>
      <Background gap={24} size={1}/>
    </ReactFlow>
    {props.children}
    <div className="graph-view-controls nopan nodrag nowheel">
      <button className="ghost-button" aria-pressed={active} onClick={() => { setActive(!active); if (!active) container.current?.focus({ preventScroll: true }); }}>{active ? '退出画布' : '操作画布'}</button>
      <button className="ghost-button" aria-label="缩小画布" onClick={() => void flow.zoomOut()}>−</button><span>{Math.round(zoom * 100)}%</span>
      <button className="ghost-button" aria-label="放大画布" onClick={() => void flow.zoomIn()}>＋</button>
      <button className="ghost-button" onClick={() => void fitAvailable(true)}>总览</button>
      <button className="ghost-button" onClick={() => setArrange(value => value + 1)}>自动整理</button>
    </div>
  </div>;
}
export function DependencyGraph(props: DependencyGraphProps) {
  return <ReactFlowProvider><Graph key={props.viewKey} {...props}/></ReactFlowProvider>;
}
