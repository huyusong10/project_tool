import { memo, useCallback, useEffect, useLayoutEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Handle, Position, BaseEdge, useNodesState, useNodesInitialized,
  useReactFlow, useUpdateNodeInternals, useViewport, useStore, type Node, type NodeProps, type EdgeProps,
  type Edge, type Viewport } from '@xyflow/react';
import ELK from 'elkjs/lib/elk-api';
import workerUrl from 'elkjs/lib/elk-worker.min.js?url';
import '@xyflow/react/dist/style.css';
import { inputPort, outputPort, portsFor, type RoutedLayout, type Point } from '../path-layout';
import { stableGraphLayout } from '../graph-layout';
import {useGraphConnection,type ConnectionSide} from '../use-graph-connection';
import {graphMotion,graphMotionFrame} from '../graph-motion';
import type { GraphCard, GraphLink } from '../path-projection';
import { requirementStatusLabels, riskLabels } from '../../shared/domain';

type CardData = GraphCard & { input: string[]; output: string[]; vertical: boolean; editing: boolean; highlighted: boolean; invalid: boolean; retiring?:boolean; connection?:string };
type CardNode = Node<CardData, 'delivery'>;
type RouteEdge = Edge<{ route?: RoutedLayout['edges'][string]; critical: boolean; labelText: string; opacity:number }, 'delivery'>;
export type GraphConnectionIssue = { message: string; nodeIds?: string[]; edgeIds?: string[] };
export type DependencyGraphProps = {
  cards: GraphCard[]; links: GraphLink[]; selected: string; onSelect: (id: string) => void; viewKey: string;
  children?: ReactNode; visibleIds?:string[]; editing?: boolean; selectedEdge?: string; onEdgeSelect?: (id: string) => void;
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
  return <div className={'dependency-card' + (selected ? ' selected' : '') + (data.external ? ' external' : '') +
    (data.critical ? ' critical' : '') + (data.highlighted ? ' search-match' : '') + (data.invalid ? ' invalid' : '') +
    (['start', 'acceptance'].includes(data.kind) ? ' gate-card' : '')+(data.connection?' connection-'+data.connection:'')}>
    {data.input.map((edge, i) => <Handle key={edge} id={inputPort(edge)} type="target" position={side(true)} className="route-handle"
      style={data.vertical ? { left: (i + 1) * 100 / (data.input.length + 1) + '%' } : { top: (i + 1) * 100 / (data.input.length + 1) + '%' }} isConnectable={false}/>)}
    <div className="dependency-card-top"><span>{data.kind==='template'?'流程工作':data.external ? '外部交付' : data.critical ? '关键路径' : requirementStatusLabels[data.status as keyof typeof requirementStatusLabels] || '交付条件'}</span>
      {data.kind!=='template'&&<span className={'risk-badge risk-' + data.risk}>{['completed', 'cancelled'].includes(data.status) ? '已结束' : riskLabels[data.risk as keyof typeof riskLabels] || '待评估'}</span>}</div>
    <strong title={data.title}>{data.title}</strong><small title={data.subtitle}>{data.subtitle}</small>
    <div className="dependency-card-bottom"><span>{data.forecast || '交付待确认'}</span>{data.kind!=='template'&&<span>{data.floatDays === null ? '余量待确认' : '余量 ' + data.floatDays + ' 天'}</span>}</div>
    <small>{data.unknown ? '交付条件待确认' : data.hiddenCount ? '另有 ' + data.hiddenCount + ' 条关系' : '\u00a0'}</small>
    {data.output.map((edge, i) => <Handle key={edge} id={outputPort(edge)} type="source" position={side(false)} className="route-handle"
      style={data.vertical ? { left: (i + 1) * 100 / (data.output.length + 1) + '%' } : { top: (i + 1) * 100 / (data.output.length + 1) + '%' }} isConnectable={false}/>)}
    {data.editing && !data.retiring && data.kind !== 'start' && (['left','right','top','bottom'] as const).map(side=><button key={side} type="button" data-side={side} className="business-handle nopan nodrag" aria-label={'从'+data.title+'的'+{left:'左',right:'右',top:'上',bottom:'下'}[side]+'侧连接后续工作'}/>)}
  </div>;
});
const RoutedEdge=memo(function RoutedEdge({ id, data, selected }: EdgeProps<RouteEdge>) {
  const markerId = useId().replace(/:/g, '_'), zoom=useStore(state=>state.transform[2]);
  if (!data?.route) return null;
  const points = data.route.points.map(p => ({ ...p })), last = points.at(-1)!, previous = points.at(-2)!;
  const length = Math.hypot(last.x - previous.x, last.y - previous.y), gap = Math.min(6 / zoom,10, length / 3);
  if (length) { last.x -= (last.x - previous.x) / length * gap; last.y -= (last.y - previous.y) / length * gap; }
  const path = points.map((p, i) => (i ? 'L' : 'M') + ' ' + p.x + ' ' + p.y).join(' ');
  const color = selected ? 'var(--danger)' : data.critical ? 'var(--accent)' : 'var(--text-faint)', label = data.route.label;
  return <g className="graph-routed-edge" opacity={data.opacity} style={{pointerEvents:data.opacity===0?'none':undefined}}><defs><marker id={markerId} viewBox="0 0 8 8" refX="8" refY="4" markerWidth={Math.min(14,8 / zoom)} markerHeight={Math.min(14,8 / zoom)} markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill={color}/></marker></defs>
    <BaseEdge id={id} path={path} markerEnd={'url(#' + markerId + ')'} interactionWidth={20} style={{ stroke: color, strokeWidth: selected ? 2.8 : data.critical ? 2.2 : 1.3, vectorEffect: 'non-scaling-stroke' }}/>
    {label && <g className="dependency-edge-label"><rect x={label.x - 3} y={label.y} width={label.width + 6} height={20} rx={4}/><text x={label.x} y={label.y + 14}>{data.labelText}</text></g>}</g>;
});
const nodeTypes = { delivery: Card }, edgeTypes = { delivery: RoutedEdge };
function Graph(props: DependencyGraphProps) {
  const {cards,links,selected,onSelect,viewKey,editing=false}=props;
  const container=useRef<HTMLDivElement>(null),[vertical,setVertical]=useState(false),[error,setError]=useState('');
  const [phase,setPhase]=useState('initial'),[arrange,setArrange]=useState(0),[rendered,setRendered]=useState(false);
  const busy=phase!=='ready'&&phase!=='error',flow=useReactFlow<CardNode>(),viewport=useViewport();
  const [nodes,setNodes,onNodesChange]=useNodesState<CardNode>([]),initialized=useNodesInitialized();
  const [scene,setScene]=useState<{layout:RoutedLayout;links:GraphLink[]}|null>(null);
  const [edgeFade,setEdgeFade]=useState<{ids:Set<string>;opacity:number}>({ids:new Set(),opacity:1});
  const [feedback,setFeedback]=useState<{source:string;target:string;side:ConnectionSide}|null>(null);
  const engine=useRef<InstanceType<typeof ELK>|null>(null),layoutRef=useRef<RoutedLayout|null>(null);
  const sceneRef=useRef(scene);sceneRef.current=scene;
  const committedScene=useRef(scene),displayPositions=useRef(new Map<string,Point>()),displayOpacities=useRef(new Map<string,number>());
  useLayoutEffect(()=>{committedScene.current=scene;},[scene]);
  const generation=useRef(0),first=useRef(true),anchor=useRef<string|undefined>(undefined),lastArrange=useRef(0),lastDirection=useRef(false),located=useRef(0);
  const viewportRef=useRef(viewport);viewportRef.current=viewport;
  const visibleRef=useRef(props.visibleIds);visibleRef.current=props.visibleIds;
  const baseKey=viewKey+(vertical?':down':':right'),viewportKey=baseKey+(props.focusId?':focus:'+props.focusId:':full');
  const keyRef=useRef(viewportKey),restore=useRef<Viewport|null>(null);
  const previousKey=useRef(viewportKey);
  const validate=(source:string,target:string):GraphConnectionIssue|null=>{
    if(source===target)return {message:'不能依赖自身',nodeIds:[source]};
    const a=cards.find(c=>c.id===source),b=cards.find(c=>c.id===target);
    if(!a||!b)return {message:'交付端点已失效'};
    if(a.kind==='start'||b.kind==='acceptance')return {message:'请连接具体工作项或需求开始条件',nodeIds:[source,target]};
    return props.validateConnection?.(source,target)||null;
  };
  const connection=useGraphConnection({container,enabled:editing,validate,
    connect:(source,target,side)=>{anchor.current=source;setError('');setFeedback({source,target,side});props.onConnect?.(source,target);},
    invalid:issue=>{setError(issue.message);props.onInvalid?.(issue);},dropEmpty:props.onDropEmpty});
  const connectionRef=connection.current;
  const activeSource=connection.gesture?.source||feedback?.source,activeTarget=connection.gesture?.target||feedback?.target,invalidTarget=!!connection.gesture?.issue;
  useEffect(()=>{if(feedback&&!busy){const timer=setTimeout(()=>setFeedback(null),600);return()=>clearTimeout(timer);}},[feedback,busy]);
  useEffect(()=>{
    if(previousKey.current!==viewportKey){
      if(!first.current)saveViewport(previousKey.current,viewportRef.current);
      restore.current=readViewport(viewportKey)||(!props.focusId?readViewport(baseKey):undefined)||null;
      previousKey.current=viewportKey;keyRef.current=viewportKey;
    }
    if(!busy&&restore.current){const value=restore.current;restore.current=null;void flow.setViewport(value);}
  },[viewportKey,baseKey,props.focusId,busy,flow]);
  useEffect(()=>()=>{if(!first.current)saveViewport(keyRef.current,viewportRef.current);},[]);
  useEffect(()=>{const worker=new ELK({workerUrl});engine.current=worker;return()=>worker.terminateWorker();},[]);
  useEffect(()=>{
    const observer=new ResizeObserver(entries=>setVertical(entries[0].contentRect.width<650));
    if(container.current)observer.observe(container.current);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    setNodes(previous=>{
      const oldById=new Map(previous.map(n=>[n.id,n])),ids=new Set(cards.map(c=>c.id));
      const updated:CardNode[]=cards.map(card=>{
        const old=oldById.get(card.id),ports=portsFor(card.id,[...new Map([...(scene?.links||[]),...links].map(e=>[e.id,e])).values()]),visible=!props.visibleIds||props.visibleIds.includes(card.id);
        return {id:card.id,type:'delivery',position:displayPositions.current.get(card.id)||old?.position||{x:0,y:0},measured:old?.measured,selected:card.id===selected,
          className:visible?'':'graph-node-hidden',ariaLabel:card.title,
          data:{...card,input:ports.input.map(e=>e.id),output:ports.output.map(e=>e.id),vertical,editing,
            highlighted:!!props.highlighted?.includes(card.id),invalid:!!props.invalidNodes?.includes(card.id),
            connection:card.id===activeSource?'source':card.id===activeTarget?invalidTarget?'invalid':'target':undefined},
          style:{width:['start','acceptance'].includes(card.kind)?184:244,opacity:displayOpacities.current.get(card.id)??old?.style?.opacity??0,
            pointerEvents:(displayOpacities.current.get(card.id)??old?.style?.opacity??0)===0?'none':undefined}};
      });
      // Keep deleted cards until the outgoing frame has faded; exclude them from layout inputs.
      return [...updated,...previous.filter(n=>!ids.has(n.id)).map(n=>({...n,data:{...n.data,retiring:true,editing:false}}))];
    });
  },[cards,links,scene,selected,vertical,editing,props.visibleIds,props.highlighted,props.invalidNodes,activeSource,activeTarget,invalidTarget,setNodes]);
  const measuredLinks=useMemo(()=>{
    const context=document.createElement('canvas').getContext('2d');if(context)context.font='12px '+getComputedStyle(document.body).fontFamily;
    return links.map(e=>({...e,labelWidth:e.label?Math.ceil(context?.measureText(e.label).width||44)+8:undefined}));
  },[links]);
  const available=useCallback((avoidPanels=true)=>{
    const element=container.current!,rectangle=element.getBoundingClientRect();
    let left=20,right=rectangle.width-20,top=20,bottom=rectangle.height-20;
    for(const panel of element.querySelectorAll<HTMLElement>('[data-graph-panel],.graph-view-controls')){
      const p=panel.getBoundingClientRect(),side=panel.dataset.graphPanel;if(!p.width||!p.height)continue;
      if(side==='top')top=Math.max(top,p.bottom-rectangle.top+12);
      if(side==='bottom'||panel.classList.contains('graph-view-controls'))bottom=Math.min(bottom,p.top-rectangle.top-12);
      if(avoidPanels&&['left','right'].includes(side||'')){
        if(p.width>=rectangle.width*.6)bottom=Math.min(bottom,p.top-rectangle.top-12);
        else if(side==='left')left=Math.max(left,p.right-rectangle.left+12);
        else right=Math.min(right,p.left-rectangle.left-12);
      }
    }
    if(right-left<120){left=20;right=rectangle.width-20;}
    if(bottom-top<80)bottom=top+80;
    return {left,right,top,bottom};
  },[]);
  const fitAvailable=useCallback(async(avoidPanels=true,ids:string[]|undefined=visibleRef.current)=>{
    const layout=layoutRef.current;if(!layout||!container.current)return;
    const boxes=Object.entries(layout.nodes).filter(([id])=>!ids||ids.includes(id)).map(([id,p])=>{
      const n=flow.getNode(id);return {...p,width:n?.measured?.width||244,height:n?.measured?.height||154};
    });
    if(!boxes.length)return;
    const x=Math.min(...boxes.map(n=>n.x)),y=Math.min(...boxes.map(n=>n.y)),width=Math.max(...boxes.map(n=>n.x+n.width))-x,height=Math.max(...boxes.map(n=>n.y+n.height))-y;
    const {left,right,top,bottom}=available(avoidPanels),zoom=Math.max(.02,Math.min(1,(right-left)/width*.92,(bottom-top)/height*.92));
    await flow.setViewport({x:(left+right)/2-(x+width/2)*zoom,y:(top+bottom)/2-(y+height/2)*zoom,zoom});
  },[flow,available]);
  const geometry=nodes.filter(n=>!n.data.retiring).map(n=>[n.id,n.measured?.width,n.measured?.height]);
  const structure=JSON.stringify([geometry,measuredLinks.map(e=>[e.id,e.source,e.target,e.label,e.labelWidth]),vertical,arrange]);
  useEffect(()=>{
    const activeNodes=nodes.filter(n=>!n.data.retiring);
    if(!initialized||!engine.current||activeNodes.some(n=>!n.measured?.width||!n.measured?.height)){
      if(!cards.length){setNodes([]);setScene(null);layoutRef.current=null;setPhase('ready');}return;
    }
    let cancelled=false,frame=0,timer:ReturnType<typeof setTimeout>;
    const id=++generation.current,requested=performance.now(),initial=first.current,reset=lastArrange.current!==arrange||lastDirection.current!==vertical;
    const directionChanged=lastDirection.current!==vertical,anchorId=anchor.current||selected;
    setPhase(initial?'initial':'waiting');
    const run=async()=>{
      if(cancelled)return;
      const start=performance.now();performance.measure('pm-path-layout-wait',{start:requested,end:start});setPhase('layout');
      try{
        const layout=await stableGraphLayout(engine.current!,activeNodes.map(n=>({id:n.id,width:n.measured!.width!,height:n.measured!.height!})),measuredLinks,vertical,reset?null:layoutRef.current,anchorId,reset);
        if(cancelled||id!==generation.current)return;
        performance.measure('pm-path-layout',{start,end:performance.now()});
        const startNodes=flow.getNodes(),positions=new Map(startNodes.map(n=>[n.id,displayPositions.current.get(n.id)||n.position])),old=sceneRef.current;
        const moved=new Set(Object.keys(layout.nodes).filter(key=>positions.has(key)&&(positions.get(key)!.x!==layout.nodes[key].x||positions.get(key)!.y!==layout.nodes[key].y)));
        const affected=new Set([...(old?.links||[]),...links].filter(e=>moved.has(e.source)||moved.has(e.target)||JSON.stringify(old?.layout.edges[e.id])!==JSON.stringify(layout.edges[e.id])).map(e=>e.id));
        const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
        const finish=async()=>{
          if(cancelled)return;
          displayPositions.current=new Map(Object.entries(layout.nodes));
          displayOpacities.current=new Map(Object.keys(layout.nodes).map(key=>[key,1]));
          container.current?.querySelectorAll<HTMLElement>('.react-flow__node').forEach(element=>{const p=layout.nodes[element.dataset.id!];if(p){element.style.transform='translate('+p.x+'px, '+p.y+'px)';element.style.opacity='1';element.style.pointerEvents='';}});
          setNodes(current=>current.filter(n=>!!layout.nodes[n.id]).map(n=>({...n,position:layout.nodes[n.id],style:{...n.style,opacity:1,pointerEvents:undefined}})));
          setScene({layout,links});layoutRef.current=layout;setEdgeFade({ids:new Set(),opacity:1});setFeedback(null);
          lastArrange.current=arrange;lastDirection.current=vertical;first.current=false;
          if(initial||reset){
            if(initial&&props.focusId&&!readViewport(baseKey+':full')){await fitAvailable(true,Object.keys(layout.nodes));saveViewport(baseKey+':full',flow.getViewport());}
            const saved=(initial||directionChanged)&&(readViewport(keyRef.current)||(!props.focusId&&readViewport(baseKey)));
            await (saved?flow.setViewport(saved):fitAvailable(true));
          }
          if(!cancelled){setPhase('ready');setRendered(true);}
        };
        if(initial||reduced){await finish();return;}
        let elapsed=0,last=performance.now(),published=false,lastProgress=0;
        const elements=new Map([...container.current!.querySelectorAll<HTMLElement>('.react-flow__node')].map(element=>[element.dataset.id!,element]));
        let edgeElements=[...container.current!.querySelectorAll<SVGGElement>('.react-flow__edge')].filter(e=>affected.has(e.dataset.id!)).map(e=>e.querySelector<SVGGElement>('.graph-routed-edge')!);
        const edgeStartOpacity=new Map(edgeElements.filter(Boolean).map(element=>[element,Number(element.getAttribute('opacity')??1)]));
        const started=last;
        const before=anchorId&&positions.get(anchorId),after=anchorId&&layout.nodes[anchorId];
        const tick=(now:number)=>{
          if(cancelled||id!==generation.current)return;
          const delta=now-last;last=now;
          if(connectionRef.current||published&&committedScene.current?.layout!==layout){frame=requestAnimationFrame(tick);return;}
          elapsed+=delta;
          const state=graphMotionFrame(elapsed,moved.size>0);setPhase(state.phase);
          if(state.position===1&&!published){setScene({layout,links});setEdgeFade({ids:affected,opacity:0});published=true;}
          if(published&&committedScene.current?.layout===layout)edgeElements=[...container.current!.querySelectorAll<SVGGElement>('.react-flow__edge')].filter(e=>affected.has(e.dataset.id!)).map(e=>e.querySelector<SVGGElement>('.graph-routed-edge')!);
          for(const element of edgeElements)if(element){element.setAttribute('opacity',String(published?state.newOpacity:state.oldOpacity*(edgeStartOpacity.get(element)??1)));element.style.pointerEvents=published&&state.newOpacity>0?'':'none';}
          // Keep frame work outside React reconciliation. Hit tests use these displayed coordinates.
          for(const [key,element] of elements){
            const target=layout.nodes[key],origin=positions.get(key);
            if(!target){element.style.opacity=String(state.oldOpacity);displayOpacities.current.set(key,state.oldOpacity);element.style.pointerEvents='none';continue;}
            const added=!old?.layout.nodes[key];
            const position=origin&&!added?{x:origin.x+(target.x-origin.x)*state.position,y:origin.y+(target.y-origin.y)*state.position}:target;
            const opacity=added?state.newOpacity:1;
            displayPositions.current.set(key,position);displayOpacities.current.set(key,opacity);element.style.transform='translate('+position.x+'px, '+position.y+'px)';element.style.opacity=String(opacity);element.style.pointerEvents=opacity===0?'none':'';
          }
          if(before&&after&&(before.x!==after.x||before.y!==after.y)){
            const current=flow.getViewport(),progress=state.position-lastProgress;
            void flow.setViewport({...current,x:current.x+(before.x-after.x)*progress*current.zoom,y:current.y+(before.y-after.y)*progress*current.zoom});
          }
          lastProgress=state.position;
          if(state.done){performance.measure('pm-path-transition',{start:started,end:now});void finish();}
          else frame=requestAnimationFrame(tick);
        };
        frame=requestAnimationFrame(tick);
      }catch(caught){if(!cancelled){setError(caught instanceof Error?caught.message:String(caught));setPhase('error');setFeedback(null);}}
    };
    timer=setTimeout(()=>void run(),initial?0:graphMotion.wait);
    return()=>{cancelled=true;clearTimeout(timer);cancelAnimationFrame(frame);};
    // Geometry and topology alone schedule layouts. Decoration, visibility and selection are projections.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[structure,initialized,setNodes]);
  const locate=useCallback((id:string)=>{
    const node=flow.getNode(id);if(!node||!container.current)return;
    const {left,right,top,bottom}=available(),v=flow.getViewport();
    void flow.setViewport({zoom:v.zoom,x:(left+right)/2-(node.position.x+(node.measured?.width||244)/2)*v.zoom,y:(top+bottom)/2-(node.position.y+(node.measured?.height||154)/2)*v.zoom});
  },[flow,available]);
  useEffect(()=>{if(props.locate&&!busy&&located.current!==props.locate.sequence){located.current=props.locate.sequence;locate(props.locate.id);}},[props.locate,busy,locate]);
  const linkById=useMemo(()=>new Map(links.map(e=>[e.id,e])),[links]);
  const edges=useMemo<RouteEdge[]>(()=>(scene?.links||[]).map(e=>({...e,type:'delivery',sourceHandle:outputPort(e.id),targetHandle:inputPort(e.id),
    hidden:!!props.visibleIds&&(!props.visibleIds.includes(e.source)||!props.visibleIds.includes(e.target)),
    label:undefined,selected:e.id===props.selectedEdge,reconnectable:false,
    data:{route:scene?.layout.edges[e.id],critical:(linkById.get(e.id)||e).critical,labelText:e.label||'',opacity:edgeFade.ids.has(e.id)?edgeFade.opacity:1}
  })),[scene,linkById,props.selectedEdge,props.visibleIds,edgeFade]);
  const gesture=connection.gesture;
  const previewSource=gesture?.source||feedback?.source,previewSide=gesture?.side||feedback?.side||'right';
  const screenPoint=(id:string,side?:ConnectionSide)=>{
    const node=flow.getNode(id);if(!node)return null;
    const w=node.measured?.width||244,h=node.measured?.height||154;
    const position=displayPositions.current.get(id)||node.position;
    return flow.flowToScreenPosition({x:position.x+(side==='left'?0:side==='right'?w:w/2),y:position.y+(side==='top'?0:side==='bottom'?h:h/2)});
  };
  const from=previewSource?screenPoint(previewSource,previewSide):null,to=gesture?.point||(feedback?screenPoint(feedback.target):null),rect=container.current?.getBoundingClientRect();
  const showPreview=!!gesture||!!feedback&&['waiting','layout'].includes(phase);
  const hint=gesture?.issue?.message||(gesture?.target?cards.find(c=>c.id===gesture.source)?.title+' 完成后 '+cards.find(c=>c.id===gesture.target)?.title+' 开始':gesture?'拖到后续卡片，或点击卡片完成连接':feedback?'依赖已加入草稿'+(busy?'，正在调整布局':''):'');
  return <div className="dependency-canvas" ref={container} role="region" tabIndex={0} aria-label="动态交付依赖图"
    data-layout-ready={!busy} data-layout-phase={phase} data-rendered-layout={rendered} data-connection-active={!!gesture}
    onPointerDownCapture={event=>{
      connection.pointerDown(event);
      if(!event.isPropagationStopped()&&!(event.target as HTMLElement).closest('.graph-overlay,.graph-view-controls,input,button,select,textarea'))event.currentTarget.focus({preventScroll:true});
    }}
    onClickCapture={connection.click}
    onMouseDownCapture={event=>{if(event.button===1)event.preventDefault();}}
    onAuxClick={event=>{if(event.button===1)event.preventDefault();}}
    onKeyDownCapture={event=>{
      if((event.target as HTMLElement).closest('.graph-overlay,input,textarea,select'))return;
      if(connectionRef.current&&['Enter',' '].includes(event.key)&&!(event.target as HTMLElement).closest('.business-handle')){
        const node=(event.target as HTMLElement).closest<HTMLElement>('.react-flow__node:not(.graph-node-hidden)');
        if(node?.dataset.id){event.preventDefault();event.stopPropagation();connection.choose(node.dataset.id);return;}
      }
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&(props.onUndo||props.onRedo)){event.preventDefault();connection.cancel();if(event.shiftKey)props.onRedo?.();else props.onUndo?.();}
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();connection.cancel();setError('');}
    }}>
    {busy&&!hint&&<div className="dependency-layout-notice" role="status">{phase==='initial'?'正在自动排布…':phase==='waiting'||phase==='layout'?'正在计算布局…':'正在调整布局…'}</div>}
    {hint&&<div className={'dependency-layout-notice graph-connection-hint'+(gesture?.issue?' is-invalid':'')} role="status">{hint}</div>}
    {error&&<div className="dependency-layout-notice warning-banner" role="alert">{error}<button onClick={()=>setError('')}>关闭</button></div>}
    <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      nodesDraggable={false} nodesConnectable={false} deleteKeyCode={null} autoPanOnNodeFocus={false} autoPanOnConnect={false}
      zoomOnScroll zoomOnPinch zoomOnDoubleClick={false} panOnScroll={false} preventScrolling zoomActivationKeyCode={null}
      panActivationKeyCode="Space" panOnDrag={[0,1]} selectionKeyCode={null} multiSelectionKeyCode={null} connectOnClick={false}
      onNodeClick={(_,node)=>{if(!connection.choose(node.id))onSelect(node.id);}} onEdgeClick={(_,edge)=>props.onEdgeSelect?.(edge.id)}
      onMoveEnd={(_,v)=>{if(!busy&&!first.current)saveViewport(keyRef.current,v);}} minZoom={.02} maxZoom={1.5} fitView={false}>
      <Background gap={24} size={1}/>
    </ReactFlow>
    {showPreview&&from&&to&&rect&&<svg className={'graph-connection-preview'+(gesture?.issue?' is-invalid':'')} aria-hidden="true">
      <path d={'M '+(from.x-rect.left)+' '+(from.y-rect.top)+' L '+(to.x-rect.left)+' '+(to.y-rect.top)}/>
    </svg>}
    {props.children}
    <div className="graph-view-controls nopan nodrag nowheel">
      <button className="ghost-button" aria-label="缩小画布" onClick={()=>void flow.zoomOut()}>−</button><span>{Math.round(viewport.zoom*100)}%</span>
      <button className="ghost-button" aria-label="放大画布" onClick={()=>void flow.zoomIn()}>＋</button>
      <button className="ghost-button" onClick={()=>void fitAvailable(true)}>适配视图</button>
      <button className="ghost-button" disabled={!!gesture} onClick={()=>setArrange(value=>value+1)}>自动整理</button>
    </div>
  </div>;
}
export function DependencyGraph(props:DependencyGraphProps){
  return <ReactFlowProvider><Graph key={props.viewKey} {...props}/></ReactFlowProvider>;
}
