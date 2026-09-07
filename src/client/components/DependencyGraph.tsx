import { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, Handle, Position, BaseEdge, useNodesState, useNodesInitialized, useReactFlow, useUpdateNodeInternals, useViewport, type Node, type NodeProps, type EdgeProps, type Edge, type Viewport } from '@xyflow/react';
import ELK from 'elkjs/lib/elk-api';
import workerUrl from 'elkjs/lib/elk-worker.min.js?url';
import '@xyflow/react/dist/style.css';
import { inputPort, outputPort, layoutDependencyGraph, portsFor, type RoutedLayout } from '../path-layout';
import type { GraphCard, GraphLink } from '../path-projection';
import { requirementStatusLabels, riskLabels } from '../../shared/domain';

type CardData=GraphCard&{input:string[];output:string[];vertical:boolean};
type CardNode=Node<CardData,'delivery'>;
type RouteEdge=Edge<{route?:RoutedLayout['edges'][string];critical:boolean;labelText:string},'delivery'>;
const viewports=new Map<string,Viewport>();
const cache=new Map<string,RoutedLayout>();
const Card=memo(function Card({id,data,selected}:NodeProps<CardNode>){
  const updateInternals=useUpdateNodeInternals(),portKey=JSON.stringify([data.input,data.output,data.vertical]);
  const previousPorts=useRef(portKey);
  useEffect(()=>{if(previousPorts.current!==portKey){previousPorts.current=portKey;updateInternals(id);}},[id,portKey,updateInternals]);
  const side=(isInput:boolean)=>data.vertical?(isInput?Position.Top:Position.Bottom):(isInput?Position.Left:Position.Right);
  return <div className={`dependency-card${selected?' selected':''}${data.external?' external':''}${data.critical?' critical':''}${['start','acceptance'].includes(data.kind)?' gate-card':''}`}>
    {data.input.map((id,i)=><Handle key={id} id={inputPort(id)} type="target" position={side(true)} style={data.vertical?{left:`${(i+1)*100/(data.input.length+1)}%`}:{top:`${(i+1)*100/(data.input.length+1)}%`}} isConnectable={false}/>)}
    <div className="dependency-card-top"><span>{data.external?'外部交付':data.critical?'关键路径':requirementStatusLabels[data.status as keyof typeof requirementStatusLabels]||'交付条件'}</span><span className={`risk-badge risk-${data.risk}`}>{['completed','cancelled'].includes(data.status)?'已结束':riskLabels[data.risk as keyof typeof riskLabels]||'待评估'}</span></div>
    <strong title={data.title}>{data.title}</strong><small title={data.subtitle}>{data.subtitle}</small>
    <div className="dependency-card-bottom"><span>{data.forecast||'交付待确认'}</span><span>{data.status==='completed'?'已交付':data.status==='cancelled'?'已取消':data.floatDays===null?'余量待确认':`余量 ${data.floatDays} 天`}</span></div>
    {(data.unknown||data.hiddenCount>0)&&<small>{data.unknown?'分析不完整':''}{data.hiddenCount>0?` · 另有 ${data.hiddenCount} 条外部关系`:''}</small>}
    {data.output.map((id,i)=><Handle key={id} id={outputPort(id)} type="source" position={side(false)} style={data.vertical?{left:`${(i+1)*100/(data.output.length+1)}%`}:{top:`${(i+1)*100/(data.output.length+1)}%`}} isConnectable={false}/>)}
  </div>;
});
function RoutedEdge({id,data}:EdgeProps<RouteEdge>){
  const markerId=useId().replace(/:/g,'_'), {zoom}=useViewport();
  if(!data?.route) return null;
  const points=data.route.points.map(p=>({...p}));
  const last=points.at(-1)!, previous=points.at(-2)!;
  const length=Math.hypot(last.x-previous.x,last.y-previous.y), gap=Math.min(6/zoom,length/3);
  if(length){last.x-=(last.x-previous.x)/length*gap;last.y-=(last.y-previous.y)/length*gap;}
  const path=points.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' '),color=data.critical?'var(--accent)':'var(--text-faint)';
  const label=data.route.label;
  return <><defs><marker id={markerId} viewBox="0 0 8 8" refX="8" refY="4" markerWidth={8/zoom} markerHeight={8/zoom} markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill={color}/></marker></defs>
    <BaseEdge id={id} path={path} markerEnd={`url(#${markerId})`} style={{stroke:color,strokeWidth:data.critical?2.2:1.3,vectorEffect:'non-scaling-stroke'}}/>
    {label&&<g className="dependency-edge-label"><rect x={label.x-3} y={label.y} width={label.width+6} height={20} rx={4}/><text x={label.x} y={label.y+14}>{data.labelText}</text></g>}</>;
}
const nodeTypes={delivery:Card},edgeTypes={delivery:RoutedEdge};
function Graph({cards,links,selected,onSelect,viewKey}:{cards:GraphCard[];links:GraphLink[];selected:string;onSelect:(id:string)=>void;viewKey:string}) {
  const container=useRef<HTMLDivElement>(null),[vertical,setVertical]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(true);
  const makeNodes=()=>cards.map(c=>({id:c.id,type:'delivery' as const,position:{x:0,y:0},selected:c.id===selected,data:{...c,input:portsFor(c.id,links).input.map(e=>e.id),output:portsFor(c.id,links).output.map(e=>e.id),vertical},style:{width:244}}));
  const [initialNodes]=useState(makeNodes);
  const [nodes,setNodes,onNodesChange]=useNodesState<CardNode>(initialNodes);
  const [routes,setRoutes]=useState<RoutedLayout|null>(null),initialized=useNodesInitialized(),flow=useReactFlow<CardNode>();
  const generation=useRef(0),engine=useRef<InstanceType<typeof ELK>|null>(null),first=useRef(true),lastDirection=useRef(vertical);
  useEffect(()=>{const worker=new ELK({workerUrl});engine.current=worker;return()=>{worker.terminateWorker();};},[]);
  useEffect(()=>{const observer=new ResizeObserver(entries=>setVertical(entries[0].contentRect.width<650));if(container.current)observer.observe(container.current);return()=>observer.disconnect();},[]);
  useEffect(()=>{setNodes(previous=>cards.map(c=>{
    const old=previous.find(n=>n.id===c.id); const ports=portsFor(c.id,links);
    return {id:c.id,type:'delivery',position:old?.position||{x:0,y:0},measured:old?.measured,selected:c.id===selected,data:{...c,input:ports.input.map(e=>e.id),output:ports.output.map(e=>e.id),vertical},style:{width:['start','acceptance'].includes(c.kind)?164:244}};
  }));},[cards,links,selected,vertical,setNodes]);
  const measuredLinks=useMemo(()=>{const context=document.createElement('canvas').getContext('2d');if(context)context.font=`12px ${getComputedStyle(document.body).fontFamily}`;return links.map(e=>({...e,labelWidth:e.label?Math.ceil(context?.measureText(e.label).width||44)+8:undefined}));},[links]);
  const focused=useRef(selected);
  useEffect(()=>{if(busy||focused.current===selected)return;focused.current=selected;if(selected&&flow.getNode(selected))void flow.fitView({nodes:[{id:selected}],padding:.5,maxZoom:1,duration:250});},[selected,busy,flow]);
  const structure=JSON.stringify([nodes.map(n=>[n.id,n.measured?.width,n.measured?.height]),measuredLinks.map(e=>[e.id,e.source,e.target,e.label,e.labelWidth]),vertical]);
  useEffect(()=>{
    if(!initialized||!engine.current||!nodes.length||nodes.some(n=>!n.measured?.width||!n.measured?.height))return;
    const id=++generation.current;let cancelled=false;setBusy(true);setError('');
    const dimensions=nodes.map(n=>({id:n.id,width:n.measured!.width!,height:n.measured!.height!}));
    const cached=cache.get(structure),layoutStarted=performance.now();
    const promise=cached?Promise.resolve(cached):layoutDependencyGraph(engine.current,dimensions,measuredLinks,vertical);
    void promise.then(layout=>{
      if(cancelled||id!==generation.current)return;
      if(!cached)performance.measure('pm-path-layout',{start:layoutStarted,end:performance.now()});
      cache.set(structure,layout);if(cache.size>20)cache.delete(cache.keys().next().value!);
      setNodes(current=>current.map(n=>({...n,position:layout.nodes[n.id]||n.position})));setRoutes(layout);setBusy(false);
      if(first.current||lastDirection.current!==vertical){const initial=first.current;first.current=false;lastDirection.current=vertical;requestAnimationFrame(()=>{const viewport=viewports.get(`${viewKey}:${vertical?'down':'right'}`);if(viewport)void flow.setViewport(viewport);else void flow.fitView({...(initial&&selected?{nodes:[{id:selected}]}:{}),padding:.15,maxZoom:1});});}
    }).catch(e=>{if(!cancelled&&id===generation.current){setError((e as Error).message);setBusy(false);}});
    return()=>{cancelled=true;};
    // Position and risk changes do not relayout; structure includes all measured geometry and endpoints.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[structure,initialized,setNodes]);
  const edges=useMemo<RouteEdge[]>(()=>links.map(e=>({...e,type:'delivery',sourceHandle:outputPort(e.id),targetHandle:inputPort(e.id),label:undefined,data:{route:routes?.edges[e.id],critical:e.critical,labelText:e.label||''}})),[links,routes]);
  return <div className="dependency-canvas" ref={container} aria-label="动态交付依赖图" data-layout-ready={!busy&&!error}>
    {busy&&<div className="dependency-layout-notice" role="status">正在自动排布…</div>}
    {error&&<div className="dependency-layout-notice warning-banner" role="alert">图布局失败：{error}。可通过下方列表继续查看。</div>}
    <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodesDraggable={false} nodesConnectable={false} deleteKeyCode={null}
      onNodeClick={(_,n)=>onSelect(n.id)} onMoveEnd={(_,v)=>viewports.set(`${viewKey}:${vertical?'down':'right'}`,v)} minZoom={.15} maxZoom={1.5} fitView={false} onlyRenderVisibleElements={false}>
      <Background gap={24} size={1}/><Controls showInteractive={false}/>
    </ReactFlow>
  </div>;
}
export function DependencyGraph(props:Parameters<typeof Graph>[0]) {return <ReactFlowProvider><Graph key={props.viewKey} {...props}/></ReactFlowProvider>;}
