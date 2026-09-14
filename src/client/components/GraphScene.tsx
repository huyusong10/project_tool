import {PHASE_HEADER,PHASE_PADDING} from '../phase-layout';
import {PhaseStatusBadge} from './PhasePlanning';
import {nodeTypes,edgeTypes,type CardNode,type CardData,type RouteEdge} from './GraphElements';
import type {DependencyGraphProps,GraphConnectionIssue} from './DependencyGraph';
import {useWorkspaceRuntime} from '../workspace-runtime';
import {SceneRequests} from '../editor-interaction';
import { useCallback, useEffect, useLayoutEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ReactFlow, Background, useNodesState, useNodesInitialized,
  useReactFlow, useViewport,
  type Viewport, type NodeChange } from '@xyflow/react';
import ELK from 'elkjs/lib/elk-api';
import workerUrl from 'elkjs/lib/elk-worker.min.js?url';
import '@xyflow/react/dist/style.css';
import { type RoutedLayout, type Point } from '../path-layout';
import { stableGraphLayout } from '../graph-layout';
import {useGraphConnection,type ConnectionSide} from '../use-graph-connection';
import {graphMotion,graphMotionFrame} from '../graph-motion';
import type { GraphLink } from '../path-projection';
import {Minus,Plus,Scan,LayoutGrid,LocateFixed,X,LoaderCircle} from 'lucide-react';
import {vacantPosition,vacantGroup} from '../fixed-routing';
import {facingSide,previewCurve,staleRouteIds,type PreviewBox} from '../graph-preview';
import {validGraphViewport,viewportShowsNode} from '../graph-viewport';

const viewports = new Map<string, Viewport>();
function readViewport(key: string): Viewport | undefined {
  try {
    const base=key.replace(/:history:\d+$/,'');
    const saved=base!==key?sessionStorage.getItem('pm-graph-view:'+key):null;
    const value=viewports.get(key)||JSON.parse(saved||localStorage.getItem('pm-graph-view:'+base)||'null');
    return validGraphViewport(value)?value:undefined;
  } catch { return undefined; }
}
function saveViewport(key: string, value: Viewport) {
  if(!validGraphViewport(value))return;
  viewports.set(key, value);
  try {
    const base=key.replace(/:history:\d+$/,'');
    if(base!==key)sessionStorage.setItem('pm-graph-view:'+key,JSON.stringify(value));
    localStorage.setItem('pm-graph-view:'+base,JSON.stringify(value));
  } catch { /* Current view remains usable. */ }
}
export function GraphScene(props: DependencyGraphProps) {
  const {cards,links,viewKey,editing=false}=props;
  const allowRename=props.commands.allows('rename'),allowConnect=props.commands.allows('connect');
  const container=useRef<HTMLDivElement>(null),[vertical]=useState(false),[error,setError]=useState('');
  const [phase,setPhase]=useState('initial'),[arrange,setArrange]=useState(0),[retry,setRetry]=useState(0),[rendered,setRendered]=useState(false);
  const [slowBusy,setSlowBusy]=useState(false),[connectionIssue,setConnectionIssue]=useState<GraphConnectionIssue|null>(null),routingError=useRef(false);
  const busy=phase!=='ready'&&phase!=='error',flow=useReactFlow<CardNode>(),viewport=useViewport();
  useEffect(()=>{if(!busy){setSlowBusy(false);return;}const timer=setTimeout(()=>setSlowBusy(true),800);return()=>clearTimeout(timer);},[busy]);
  const dismissError=()=>{setError('');setConnectionIssue(null);props.onClearIssue?.();};
  useEffect(()=>{if(connectionIssue&&props.invalidNodes&&!props.invalidNodes.length){setConnectionIssue(null);setError('');}},[connectionIssue,props.invalidNodes]);
  const [nodes,setNodes,applyNodeChanges]=useNodesState<CardNode>([]),initialized=useNodesInitialized();
  const runtime=useWorkspaceRuntime(),interaction=props.interaction,selection=useSyncExternalStore(interaction.subscribe,interaction.snapshot);
  const selected=selection.kind==='nodes'?selection.primary:'',selectedEdge=selection.kind==='edge'?selection.id:undefined;
  useEffect(()=>()=>{interaction.cancel();},[interaction,viewKey]);
  const selectedIds=useMemo(()=>selection.kind==='nodes'?selection.ids:[],[selection]);
  const [dragTick,setDragTick]=useState(0);
  const setSelectedIds=(value:string[]|((old:string[])=>string[]))=>{const old=interaction.selection.kind==='nodes'?interaction.selection.ids:[];const next=typeof value==='function'?value(old):value;interaction.nodes(next,interaction.selection.kind==='nodes'?interaction.selection.primary:'');};
  const onNodesChange=(changes:NodeChange<CardNode>[])=>{
    const selectionChanges=changes.filter(c=>c.type==='select');
    if(selectionChanges.length){const ids=new Set(interaction.selection.kind==='nodes'?interaction.selection.ids:[]);for(const c of selectionChanges){if(c.selected)ids.add(c.id);else ids.delete(c.id);}setSelectedIds([...ids]);}
    applyNodeChanges(changes.map(change=>change.type==='position'&&change.position&&props.constrainPosition?{...change,position:props.constrainPosition(change.id,change.position)}:change));
  };
  const selectFromCanvas=(id:string)=>{const ids=interaction.selection.kind==='nodes'?interaction.selection.ids:[];interaction.nodes(id?ids.includes(id)?ids:[id]:[],id,true);};
  const drag=useRef<{ticket:number;ids:string[];original:Record<string,Point>;copy:boolean;cancelled?:boolean}|null>(null),manualPending=useRef(false),clipboard=useRef<{ids:string[];nodes:ReturnType<typeof positioned>;snapshot?:unknown}>({ids:[],nodes:[]}),latestProps=useRef(props);latestProps.current=props;
  const rename=useCallback((id:string,title:string)=>latestProps.current.commands.dispatch({type:'rename',id,title}),[]);

  const router=useRef<Worker|null>(null),requests=useRef(new Map<number,{resolve:(l:RoutedLayout)=>void;reject:(e:Error)=>void}>()),routeSequence=useRef(0);
  useEffect(()=>{const worker=new Worker(new URL('../fixed-routing.worker.ts',import.meta.url),{type:'module'});router.current=worker;worker.onmessage=e=>{const request=requests.current.get(e.data.id);if(request){requests.current.delete(e.data.id);if(e.data.error)request.reject(new Error(e.data.error));else request.resolve(e.data.layout);}};const pending=requests.current;worker.onerror=()=>{for(const request of pending.values())request.reject(new Error('连线路由暂不可用，请重试'));pending.clear();};return()=>{worker.terminate();for(const r of pending.values())r.reject(new Error('画布已关闭'));pending.clear();};},[retry]);
  const fixedRoute=(positions:Record<string,Point>,activeNodes:CardNode[])=>new Promise<RoutedLayout>((resolve,reject)=>{const id=++routeSequence.current;requests.current.set(id,{resolve,reject});router.current!.postMessage({id,nodes:activeNodes.map(n=>({id:n.id,width:n.measured!.width!,height:n.measured!.height!,...positions[n.id]})),edges:measuredLinks,obstacles:(props.regions||[]).map(r=>({left:r.x+8,right:r.x+r.width-8,top:r.y,bottom:r.y+PHASE_HEADER-12}))});});
  const [scene,setScene]=useState<{layout:RoutedLayout;links:GraphLink[]}|null>(null);
  const [edgeFade,setEdgeFade]=useState<{ids:Set<string>;opacity:number}>({ids:new Set(),opacity:1});
  const [feedback,setFeedback]=useState<{source:string;target:string;side:ConnectionSide}|null>(null);
  const engine=useRef<InstanceType<typeof ELK>|null>(null),layoutRef=useRef<RoutedLayout|null>(null);
  const sceneRef=useRef(scene);sceneRef.current=scene;
  const committedScene=useRef(scene),displayPositions=useRef(new Map<string,Point>()),displayOpacities=useRef(new Map<string,number>());
  useLayoutEffect(()=>{committedScene.current=scene;},[scene]);
  const sceneRequests=useRef(new SceneRequests());
  const generation=useRef(0),first=useRef(true),anchor=useRef<string|undefined>(undefined),lastArrange=useRef(0),lastDirection=useRef(false),located=useRef(0);
  const viewportRef=useRef(viewport);viewportRef.current=viewport;
  const visibleRef=useRef(props.visibleIds);visibleRef.current=props.visibleIds;
  const baseKey=viewKey+(vertical?':down':':right'),viewportKey=baseKey+':current'+(props.historyIndex===undefined?'':':history:'+props.historyIndex);
  // Unsaved diagrams need an origin for undoing their first move, including after
  // restoring a local draft. This display cache never becomes a formal layout.
  const layoutOrigin=useRef<Record<string,Point>>(structuredClone(props.originPositions||{})).current;
  if(props.originPositions)Object.assign(layoutOrigin,props.originPositions);
  if(!Object.keys(layoutOrigin).length)try{Object.assign(layoutOrigin,JSON.parse(localStorage.getItem('pm-graph-view:'+baseKey+':layout-origin')||'{}'));}catch{/* Legacy origin is optional. */}
  const focusWas=useRef(props.focusId||'');
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  const beforeFocus=useRef<Viewport|null>(readViewport(baseKey+':before-focus')||null);
  const keyRef=useRef(viewportKey),restore=useRef<Viewport|null>(null);
  const previousKey=useRef(viewportKey);
  const validate=(source:string,target:string,reconnectEnd?:'source'|'target'):GraphConnectionIssue|null=>{
    if(source===target)return {message:'不能依赖自身',nodeIds:[source]};
    const a=cards.find(c=>c.id===source),b=cards.find(c=>c.id===target);
    if(!a||!b)return {message:'交付端点已失效'};
    if(a.kind==='start'||b.kind==='acceptance')return {message:'请连接具体工作项或需求开始条件',nodeIds:[source,target]};
    return (reconnectEnd?props.validateReconnect?.(source,target):props.validateConnection?.(source,target))||null;
  };
  const connection=useGraphConnection({container,enabled:editing&&props.commands.allows('connect'),validate,interaction,runtime,
    connect:(source,target,side,reconnectEnd)=>{anchor.current=source;dismissError();setFeedback({source,target,side});if(reconnectEnd)props.commands.dispatch({type:'reconnect',source,target});else props.commands.dispatch({type:'connect',source,target});},
    invalid:issue=>{routingError.current=false;setError(issue.message);setConnectionIssue(issue);props.onInvalid?.(issue);},dropEmpty:(source,point)=>props.onDropEmpty?.(source,flow.screenToFlowPosition(point))});
  const connectionRef=connection.current;
  const activeSource=connection.gesture?.source||feedback?.source,activeTarget=connection.gesture?.target||feedback?.target,invalidTarget=!!connection.gesture?.issue;
  useEffect(()=>{if(feedback&&!busy){const timer=setTimeout(()=>setFeedback(null),600);return()=>clearTimeout(timer);}},[feedback,busy]);
  useEffect(()=>{
    if(previousKey.current!==viewportKey){if(props.focusId)beforeFocus.current=readViewport(baseKey+':before-focus')||null;if(!first.current)saveViewport(previousKey.current,viewportRef.current);restore.current=readViewport(viewportKey)||null;previousKey.current=viewportKey;keyRef.current=viewportKey;}
    if(!busy&&restore.current){const value=restore.current;restore.current=null;void flow.setViewport(value);}
    if(!focusWas.current&&props.focusId){beforeFocus.current=viewportRef.current;saveViewport(baseKey+':before-focus',viewportRef.current);}
    else if(focusWas.current&&!props.focusId&&beforeFocus.current){const saved=beforeFocus.current,current=viewportRef.current;if(Math.abs(saved.x-current.x)>.1||Math.abs(saved.y-current.y)>.1||Math.abs(saved.zoom-current.zoom)>.001)void flow.setViewport(saved,{duration:reduced()?0:260});beforeFocus.current=null;}
    focusWas.current=props.focusId||'';
  },[viewportKey,baseKey,props.focusId,busy,flow]);
  useEffect(()=>()=>{if(!first.current)saveViewport(keyRef.current,viewportRef.current);},[]);
  useEffect(()=>{const worker=new ELK({workerUrl});engine.current=worker;return()=>worker.terminateWorker();},[]);
  useEffect(()=>{
    setNodes(previous=>{
      const oldById=new Map(previous.map(n=>[n.id,n])),ids=new Set(cards.map(c=>c.id));
      const updated:CardNode[]=cards.map(card=>{
        const old=oldById.get(card.id),visible=!props.visibleIds||props.visibleIds.includes(card.id);
        const data:CardData={...card,selectedPhaseId:props.selectedPhaseId,onSelectPhase:props.onSelectPhase,vertical,editing,rename:allowRename?rename:undefined,connectable:allowConnect,retiring:false,context:props.contextIds?.includes(card.id),
          highlighted:!!props.highlighted?.includes(card.id),invalid:!!props.invalidNodes?.includes(card.id),
          connection:card.id===activeSource?'source':card.id===activeTarget?invalidTarget?'invalid':'target':undefined};
        const stableData=old&&Object.keys(data).every(key=>data[key as keyof CardData]===old.data[key as keyof CardData])?old.data:data;
        const next:CardNode={id:card.id,type:'delivery',position:displayPositions.current.get(card.id)||old?.position||props.positions?.[card.id]||{x:0,y:0},measured:old?.measured,selected:selectedIds.includes(card.id),
          className:visible?'':'graph-node-hidden',ariaLabel:card.title,
          data:stableData,
          style:{width:card.kind==='feature'?280:244,opacity:displayOpacities.current.get(card.id)??old?.style?.opacity??0,
            pointerEvents:(displayOpacities.current.get(card.id)??old?.style?.opacity??0)===0?'none':undefined}};
        return old&&old.data===next.data&&old.selected===next.selected&&old.className===next.className&&old.ariaLabel===next.ariaLabel&&old.position.x===next.position.x&&old.position.y===next.position.y&&old.style?.width===next.style?.width&&old.style?.opacity===next.style?.opacity&&old.style?.pointerEvents===next.style?.pointerEvents?old:next;
      });
      // Keep deleted cards until the outgoing frame has faded; exclude them from layout inputs.
      const next=[...updated,...previous.filter(n=>!ids.has(n.id)).map(n=>n.data.retiring?n:{...n,data:{...n.data,retiring:true,editing:false}})];
      return next.length===previous.length&&next.every((n,i)=>n===previous[i])?previous:next;
    });
  },[cards,links,scene,selected,selectedIds,vertical,editing,rename,allowRename,allowConnect,props.visibleIds,props.contextIds,props.highlighted,props.invalidNodes,props.positions,props.onSelectPhase,props.selectedPhaseId,activeSource,activeTarget,invalidTarget,setNodes]);
  const measuredLinks=useMemo(()=>{
    const context=document.createElement('canvas').getContext('2d');if(context)context.font='12px '+getComputedStyle(document.body).fontFamily;
    return links.map(e=>({...e,labelWidth:e.label?Math.ceil(context?.measureText(e.label).width||44)+8:undefined}));
  },[links]);
  const available=useCallback((avoidPanels=true)=>{
    const element=container.current!.closest<HTMLElement>('.graph-workspace')!,rectangle=container.current!.getBoundingClientRect();
    let left=20,right=rectangle.width-20,top=20,bottom=rectangle.height-20;
    for(const panel of element.querySelectorAll<HTMLElement>('[data-graph-panel],.graph-view-controls')){
      const p=panel.getBoundingClientRect(),side=panel.dataset.graphPanel;if(!p.width||!p.height||panel.getAttribute('aria-hidden')==='true'||p.left>=rectangle.right||p.right<=rectangle.left)continue;
      if(side==='top'||side==='finder')top=Math.max(top,p.bottom-rectangle.top+12);
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
  const viewportBoxes=useCallback((ids:string[]|undefined=visibleRef.current)=>{
    return [...(props.regions||[]).filter(r=>!props.focusRegionId||r.id===props.focusRegionId||r.nodeIds.some(id=>ids?.includes(id))),...Object.entries(layoutRef.current?.nodes||{}).filter(([id])=>!ids||ids.includes(id)).map(([id,p])=>{
      const n=flow.getNode(id);return {...p,width:n?.measured?.width||244,height:n?.measured?.height||154};
    })];
  },[flow,props.regions,props.focusRegionId]);
  const fitAvailable=useCallback(async(avoidPanels=true,ids:string[]|undefined=visibleRef.current,animate=false,readable=false)=>{
    if(!container.current)return;
    const boxes=viewportBoxes(ids);
    if(!boxes.length)return;
    const x=Math.min(...boxes.map(n=>n.x)),y=Math.min(...boxes.map(n=>n.y)),width=Math.max(...boxes.map(n=>n.x+n.width))-x,height=Math.max(...boxes.map(n=>n.y+n.height))-y;
    const {left,right,top,bottom}=available(avoidPanels),zoom=Math.max(readable?.85:.02,Math.min(1,(right-left)/width*.92,(bottom-top)/height*.92));
    await flow.setViewport({x:readable&&width*zoom>right-left?left+12-x*zoom:(left+right)/2-(x+width/2)*zoom,y:readable?top+12-y*zoom:(top+bottom)/2-(y+height/2)*zoom,zoom},{duration:animate&&!reduced()?260:0});
  },[flow,available,viewportBoxes]);
  const previousRegion=useRef(props.focusRegionId);useEffect(()=>{if(previousRegion.current!==props.focusRegionId&&!busy){previousRegion.current=props.focusRegionId;void fitAvailable(true,undefined,true,true);}},[props.focusRegionId,busy,fitAvailable]);
  useEffect(()=>{
    const element=container.current;if(!element)return;
    let previous=element.getBoundingClientRect(),frame=0;
    const observer=new ResizeObserver(()=>{const next=element.getBoundingClientRect();if(next.width===previous.width&&next.height===previous.height)return;previous=next;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(!first.current&&!viewportShowsNode(viewportRef.current,viewportBoxes(),available(false)))void fitAvailable(true,undefined,false,true);});});
    observer.observe(element);return()=>{observer.disconnect();cancelAnimationFrame(frame);};
  },[available,fitAvailable,viewportBoxes]);
  const geometry=nodes.filter(n=>!n.data.retiring).map(n=>[n.id,n.measured?.width,n.measured?.height]);
  const structure=JSON.stringify([geometry,measuredLinks.map(e=>[e.id,e.source,e.target,e.label,e.labelWidth]),vertical,arrange,retry,props.positions]);
  useEffect(()=>{
    const activeNodes=nodes.filter(n=>!n.data.retiring);
    if(!initialized||!engine.current||activeNodes.some(n=>!n.measured?.width||!n.measured?.height)){
      if(!cards.length){setNodes([]);setScene(null);layoutRef.current=null;setPhase('ready');}return;
    }
    const canvasElement=container.current;
    let cancelled=false,frame=0,timer:ReturnType<typeof setTimeout>;
    const ticket=sceneRequests.current.request(JSON.stringify([geometry,measuredLinks]),JSON.stringify(props.positions||{}));
    const id=++generation.current,requested=performance.now(),initial=first.current,reset=lastArrange.current!==arrange||lastDirection.current!==vertical;
    const directionChanged=lastDirection.current!==vertical,anchorId=anchor.current||selected;
    setPhase(initial?'initial':'waiting');
    const run=async()=>{
      if(cancelled)return;
      const start=performance.now();performance.measure('pm-path-layout-wait',{start:requested,end:start});setPhase('layout');
      try{
        const savedPositions={...(layoutRef.current?.nodes||{}),...(!initial?layoutOrigin:{}),...(props.positions||{})};
        let layout:RoutedLayout;
        if((!reset||props.regions)&&Object.keys(savedPositions).length){const positioned=activeNodes.filter(n=>savedPositions[n.id]).map(n=>({id:n.id,...savedPositions[n.id],width:n.measured!.width!,height:n.measured!.height!}));for(const n of activeNodes)if(!savedPositions[n.id]){const p=vacantPosition(positioned,n.id,{x:Math.max(0,...positioned.map(n=>n.x+n.width))+64,y:32},n.measured!.width!,n.measured!.height!);savedPositions[n.id]=p;positioned.push({id:n.id,...p,width:n.measured!.width!,height:n.measured!.height!});}layout=await fixedRoute(savedPositions,activeNodes);}
        else {
          const arranged=await stableGraphLayout(engine.current!,activeNodes.map(n=>({id:n.id,width:n.measured!.width!,height:n.measured!.height!})),measuredLinks,vertical,null,anchorId,true);
          layout=await fixedRoute(arranged.nodes,activeNodes);
        }
        if(links.some(e=>!layout.edges[e.id]?.points.length))throw new Error('部分连线尚未更新，请重试。');
        if(cancelled||id!==generation.current||!sceneRequests.current.accepts(ticket))return;
        performance.measure('pm-path-layout',{start,end:performance.now()});
        // Snapshot after the gesture ends. A result arriving during a drag must not
        // remember its intermediate position and replay it after Esc.
        while(connectionRef.current||drag.current&&!drag.current.cancelled){await new Promise(resolve=>setTimeout(resolve,16));if(cancelled||id!==generation.current||!sceneRequests.current.accepts(ticket))return;}
        const startNodes=flow.getNodes(),positions=new Map(startNodes.map(n=>[n.id,displayPositions.current.get(n.id)||n.position])),old=sceneRef.current;
        const moved=new Set(Object.keys(layout.nodes).filter(key=>positions.has(key)&&(positions.get(key)!.x!==layout.nodes[key].x||positions.get(key)!.y!==layout.nodes[key].y)));
        const affected=new Set([...(old?.links||[]),...links].filter(e=>moved.has(e.source)||moved.has(e.target)||JSON.stringify(old?.layout.edges[e.id])!==JSON.stringify(layout.edges[e.id])).map(e=>e.id));
        const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
        const finish=async()=>{
          if(cancelled)return;
          container.current?.querySelectorAll<SVGGElement>('.graph-routed-edge').forEach(e=>{e.setAttribute('opacity','1');e.style.pointerEvents='';});
          if(routingError.current){routingError.current=false;setError('');}
          displayPositions.current=new Map(Object.entries(layout.nodes));
          displayOpacities.current=new Map(Object.keys(layout.nodes).map(key=>[key,1]));
          container.current?.querySelectorAll<HTMLElement>('.react-flow__node').forEach(element=>{const p=layout.nodes[element.dataset.id!];if(p){element.style.transform='translate('+p.x+'px, '+p.y+'px)';element.style.opacity='1';element.style.pointerEvents='';element.style.willChange='';}});
          setNodes(current=>current.filter(n=>!!layout.nodes[n.id]).map(n=>({...n,position:layout.nodes[n.id],style:{...n.style,opacity:1,pointerEvents:undefined}})));
          setScene({layout,links});layoutRef.current=layout;manualPending.current=false;setEdgeFade({ids:new Set(),opacity:1});setFeedback(null);
          let captured=false;for(const [key,point] of Object.entries(layout.nodes))if(!layoutOrigin[key]||initial&&!Object.keys(props.positions||{}).length){layoutOrigin[key]={x:point.x,y:point.y};captured=true;}
          if(captured)latestProps.current.onOrigin?.({...layoutOrigin});
          latestProps.current.onLayoutReady?.(layout.nodes);lastArrange.current=arrange;lastDirection.current=vertical;first.current=false;if(reset&&editing)latestProps.current.commands.dispatch({type:'move',positions:layout.nodes});
          if(initial){

            const saved=(initial||directionChanged)&&(readViewport(keyRef.current)||readViewport(baseKey+(props.focusId?':focus:'+props.focusId:':full'))||readViewport(baseKey));
            // Re-entering after a layout or screen change must not restore an empty canvas.
            // Floating panels alone do not invalidate a user's otherwise visible viewport.
            await (saved&&saved.zoom>=.7&&viewportShowsNode(saved,viewportBoxes(),available(false))?flow.setViewport(saved):fitAvailable(true,undefined,false,true));
            if(!cancelled)saveViewport(keyRef.current,flow.getViewport());
          }
          if(!cancelled){setPhase('ready');setRendered(true);}
        };
        if(initial||reduced){await finish();return;}
        let elapsed=0,last=performance.now(),published=false,lastProgress=0;
        const elements=new Map([...container.current!.querySelectorAll<HTMLElement>('.react-flow__node')].map(element=>[element.dataset.id!,element]));
        let edgeElements=[...container.current!.querySelectorAll<SVGGElement>('.react-flow__edge')].filter(e=>affected.has(e.dataset.id!)).map(e=>e.querySelector<SVGGElement>('.graph-routed-edge')!);
        const edgeStartOpacity=new Map(edgeElements.filter(Boolean).map(element=>[element,Number(element.getAttribute('opacity')??1)]));
        const started=last;
        // Promote only the cards that move, and only for this transition.
        for(const [key,element] of elements)if(moved.has(key))element.style.willChange='transform';
        // Only explicit auto-arrange preserves a previous anchor by moving the viewport.
        const before=reset&&anchorId&&old?.layout.nodes[anchorId]&&positions.get(anchorId),after=anchorId&&layout.nodes[anchorId];
        const tick=(now:number)=>{
          if(cancelled||id!==generation.current||!sceneRequests.current.accepts(ticket))return;
          const delta=now-last;last=now;
          if(connectionRef.current||drag.current&&!drag.current.cancelled||published&&committedScene.current?.layout!==layout){frame=requestAnimationFrame(tick);return;}
          elapsed+=delta;
          const state=graphMotionFrame(elapsed,moved.size>0);container.current!.dataset.layoutPhase=state.phase;
          if(state.position===1&&!published){setScene({layout,links});setEdgeFade({ids:affected,opacity:0});published=true;}
          if(published&&committedScene.current?.layout===layout)edgeElements=[...container.current!.querySelectorAll<SVGGElement>('.react-flow__edge')].filter(e=>affected.has(e.dataset.id!)).map(e=>e.querySelector<SVGGElement>('.graph-routed-edge')!);
          for(const element of edgeElements)if(element){element.setAttribute('opacity',String(published?state.newOpacity:state.oldOpacity*(edgeStartOpacity.get(element)??1)));element.style.pointerEvents=published&&state.newOpacity>0?'':'none';}
          // Keep frame work outside React reconciliation. Hit tests use these displayed coordinates.
          for(const [key,element] of elements){
            const target=layout.nodes[key],origin=positions.get(key);
            if(!target){element.style.opacity=String(state.oldOpacity);displayOpacities.current.set(key,state.oldOpacity);element.style.pointerEvents='none';continue;}
            const added=!old?.layout.nodes[key];
            if(!added&&!moved.has(key))continue;
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
      }catch(caught){if(!cancelled){
        routingError.current=true;setConnectionIssue(null);setError((caught instanceof Error?caught.message:String(caught))+(layoutRef.current?' 当前修改和临时连线已保留。':''));setPhase('error');setFeedback(null);
        manualPending.current=true;setDragTick(t=>t+1);
        setEdgeFade({ids:new Set(),opacity:1});

      }}
    };
    timer=setTimeout(()=>void run(),initial?0:manualPending.current?80:graphMotion.wait);
    return()=>{cancelled=true;clearTimeout(timer);cancelAnimationFrame(frame);
      // DOM animation can be interrupted before React publishes a new opacity.
      canvasElement?.querySelectorAll<HTMLElement>('.react-flow__node').forEach(e=>{e.style.willChange='';});
      canvasElement?.querySelectorAll<SVGGElement>('.graph-routed-edge').forEach(e=>{e.setAttribute('opacity','1');e.style.pointerEvents='';});
      setEdgeFade({ids:new Set(),opacity:1});
    };
    // Geometry and topology alone schedule layouts. Decoration, visibility and selection are projections.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[structure,initialized,setNodes]);
  const locate=useCallback((id:string)=>{
    const node=flow.getNode(id);if(!node||!container.current)return;
    const {left,right,top,bottom}=available(),v=flow.getViewport();
    void flow.setViewport({zoom:v.zoom,x:(left+right)/2-(node.position.x+(node.measured?.width||244)/2)*v.zoom,y:(top+bottom)/2-(node.position.y+(node.measured?.height||154)/2)*v.zoom},{duration:reduced()?0:260});
  },[flow,available]);
  const previousRevealSelection=useRef(selected);
  useEffect(()=>{
    if(busy||!selected||!container.current)return;
    const changed=previousRevealSelection.current!==selected;previousRevealSelection.current=selected;
    const element=container.current;let previous=element.getBoundingClientRect();
    let timer:ReturnType<typeof setTimeout>;
    const reveal=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(interaction.operation)return;const node=flow.getNode(selected);if(!node)return;const v=flow.getViewport(),b=available(),x=v.x+node.position.x*v.zoom,y=v.y+node.position.y*v.zoom,w=(node.measured?.width||244)*v.zoom,h=(node.measured?.height||168)*v.zoom;
      if(x<b.left||x+w>b.right||y<b.top||y+h>b.bottom)locate(selected);
    // Keep a node still while the second click of a drill-down is arriving.
    },350);};
    if(changed)reveal();const observer=new ResizeObserver(()=>{const next=element.getBoundingClientRect();if(next.width!==previous.width||next.height!==previous.height){previous=next;reveal();}});observer.observe(element);return()=>{observer.disconnect();clearTimeout(timer);};
  },[busy,selected,flow,available,locate,interaction]);
  useEffect(()=>{if(props.locate&&!busy&&layoutRef.current?.nodes[props.locate.id]&&located.current!==props.locate.sequence){located.current=props.locate.sequence;locate(props.locate.id);}},[props.locate,busy,locate]);
  const linkById=useMemo(()=>new Map(links.map(e=>[e.id,e])),[links]);
  const currentBoxes=new Map(nodes.filter(n=>!n.data.retiring).map(n=>[n.id,{...(displayPositions.current.get(n.id)||n.position),width:n.measured?.width||244,height:n.measured?.height||154}]));
  // Auto-arrange already owns edge visibility through its animation clock. Only manual
  // movement needs the extra stale-geometry guard; avoid rescanning every moving card.
  const staleRoutes=manualPending.current?staleRouteIds(scene?.layout||null,links,currentBoxes,drag.current&&!drag.current.cancelled?drag.current.ids:[]):new Set(links.filter(e=>!scene?.layout.edges[e.id]).map(e=>e.id));
  const staleKey=JSON.stringify([...staleRoutes].sort());
  const edges=useMemo<RouteEdge[]>(()=>(scene?.links||[]).map(e=>({...e,type:'delivery',sourceHandle:'route-out',targetHandle:'route-in',
    className:(props.visibleIds&&(!props.visibleIds.includes(e.source)||!props.visibleIds.includes(e.target))?'graph-edge-hidden':'')+(staleRoutes.has(e.id)||!linkById.has(e.id)||linkById.get(e.id)?.source!==e.source||linkById.get(e.id)?.target!==e.target?' graph-route-stale':''),
    label:undefined,selected:e.id===selectedEdge,reconnectable:false,
    data:{route:scene?.layout.edges[e.id],planningOnly:(linkById.get(e.id)||e).planningOnly,invalid:props.invalidEdges?.includes(e.id),critical:(linkById.get(e.id)||e).critical,labelText:e.label||'',description:(linkById.get(e.id)||e).description,filtered:!!props.visibleIds&&(!props.visibleIds.includes(e.source)||!props.visibleIds.includes(e.target)),opacity:edgeFade.ids.has(e.id)?edgeFade.opacity:1}
  // The key changes only when route validity changes, not on every pointer movement.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })),[scene,linkById,selectedEdge,props.visibleIds,props.invalidEdges,edgeFade,staleKey]);
  // Focus is presentation only: do not rebuild React Flow's node/edge store for it.
  // Reapply after a geometry commit, which may replace the corresponding DOM nodes.
  useLayoutEffect(()=>{
    const emphasized=new Set(props.emphasizedIds||[]),focused=!!props.focusId;
    container.current?.querySelectorAll<HTMLElement>('.react-flow__node').forEach(e=>e.classList.toggle('graph-node-dim',focused&&!emphasized.has(e.dataset.id!)));
    container.current?.querySelectorAll<HTMLElement>('.react-flow__edge').forEach(e=>{const edge=linkById.get(e.dataset.id!);e.querySelector('.graph-edge-presentation')?.classList.toggle('is-dimmed',focused&&!!edge&&(!emphasized.has(edge.source)||!emphasized.has(edge.target)));});
  },[props.focusId,props.emphasizedIds,linkById,nodes,edges]);
  const restoreDrag=()=>{const d=drag.current;if(!d)return;displayPositions.current=new Map(Object.entries(d.original));manualPending.current=Object.entries(d.original).some(([id,p])=>p.x!==layoutRef.current?.nodes[id]?.x||p.y!==layoutRef.current?.nodes[id]?.y);setNodes(ns=>ns.map(n=>({...n,position:d.original[n.id]||n.position})));setEdgeFade({ids:new Set(),opacity:1});setDragTick(t=>t+1);};
  const cancelDrag=()=>{if(!drag.current)return false;drag.current.cancelled=true;restoreDrag();return true;};
  const actionableIds=selectedIds.filter(id=>cards.some(c=>c.id===id)&&(!props.visibleIds||props.visibleIds.includes(id)));
  const editableIds=actionableIds.filter(id=>!['start','acceptance','project'].includes(cards.find(c=>c.id===id)?.kind||''));
  const displayedPositions=()=>Object.fromEntries(flow.getNodes().map(n=>[n.id,{...(displayPositions.current.get(n.id)||n.position)}]));
  const commitMove=(positions:Record<string,Point>)=>{if(JSON.stringify(positions)!==JSON.stringify(props.positions))generation.current++;sceneRequests.current.invalidate();manualPending.current=true;lastArrange.current=arrange;displayPositions.current=new Map(Object.entries(positions));setNodes(ns=>ns.map(n=>({...n,position:positions[n.id]||n.position})));props.commands.dispatch({type:'move',positions});};
  const positioned=()=>flow.getNodes().map(n=>({id:n.id,...n.position,width:n.measured?.width||244,height:n.measured?.height||154}));
  const duplicate=(ids:string[],offset=32,snapshot?:unknown,original=positioned())=>{const current=positioned(),all=[...current,...original.filter(n=>!current.some(c=>c.id===n.id))];props.commands.dispatch({type:'duplicate',ids,positions:vacantGroup(all,Object.fromEntries(ids.flatMap(id=>{const p=original.find(n=>n.id===id);return p?[[id,{x:p.x+offset,y:p.y+offset}]]:[]})),true),snapshot});};
  const createAt=(kind:string,point:Point)=>{const commit=()=>props.commands.dispatch({type:'create',kind,position:vacantPosition(positioned(),'__new__',point)});const operation=interaction.operation;if(operation?.kind==='place')interaction.complete(operation.id,commit);else commit();};
  useEffect(()=>{if(!props.placing||!editing)return;const ticket=interaction.begin('place',()=>latestProps.current.onExitFocus?.());return()=>{if(interaction.isCurrent(ticket))interaction.cancel();};},[props.placing,editing,interaction]);
  useEffect(()=>{if(!editing)interaction.cancel();},[editing,interaction]);

  const gesture=connection.gesture;
  const screenPoint=(id:string,side?:ConnectionSide)=>{
    const node=flow.getNode(id);if(!node)return null;
    const w=node.measured?.width||244,h=node.measured?.height||154;
    const position=displayPositions.current.get(id)||node.position;
    return flow.flowToScreenPosition({x:position.x+(side==='left'?0:side==='right'?w:w/2),y:position.y+(side==='top'?0:side==='bottom'?h:h/2)});
  };
  const rect=container.current?.getBoundingClientRect(),previewMarker=useId().replace(/:/g,'_');
  const screenBox=(id:string):PreviewBox|null=>{const box=currentBoxes.get(id);return box?{x:box.x*viewport.zoom+viewport.x,y:box.y*viewport.zoom+viewport.y,width:box.width*viewport.zoom,height:box.height*viewport.zoom}:null;};
  const fixed=gesture&&screenBox(gesture.source),candidate=gesture?.target&&screenBox(gesture.target),pointer=gesture&&rect?{x:gesture.point.x-rect.left,y:gesture.point.y-rect.top}:null;
  const liveCurve=fixed&&pointer?(gesture?.reconnectEnd==='source'?candidate?previewCurve(candidate,fixed):previewCurve(fixed,pointer,undefined,true):previewCurve(fixed,candidate||pointer,gesture?.side)):null;
  const pendingLinks=rendered?links.filter(e=>staleRoutes.has(e.id)&&(manualPending.current||!scene?.layout.edges[e.id])&&(!props.visibleIds||props.visibleIds.includes(e.source)&&props.visibleIds.includes(e.target))):[];
  const pendingCurve=(e:GraphLink)=>{const a=screenBox(e.source),b=screenBox(e.target);if(!a||!b)return null;const route=scene?.layout.edges[e.id],oldA=scene?.layout.nodes[e.source],oldB=scene?.layout.nodes[e.target];return previewCurve(a,b,route&&oldA?facingSide({...currentBoxes.get(e.source)!,...oldA},route.points[0]):undefined,false,route&&oldB?facingSide({...currentBoxes.get(e.target)!,...oldB},route.points.at(-1)!):undefined);};
  const hintSource=gesture?.reconnectEnd==='source'?gesture.target:gesture?.source,hintTarget=gesture?.reconnectEnd==='source'?gesture.source:gesture?.target;
  const hint=gesture?.issue?.message||(gesture?.target?cards.find(c=>c.id===hintSource)?.title+' 完成后 '+cards.find(c=>c.id===hintTarget)?.title+' 开始':gesture?gesture.reconnectEnd==='source'?'选择新的前置卡片，完成后进入当前后续':'拖到后续卡片，或点击卡片完成连接':'');
  const openNode=(id:string)=>{const card=cards.find(c=>c.id===id);if(card&&props.onOpenNode&&!gesture){runtime.commitFields(false);props.onOpenNode(card);}};
  return <div className="dependency-canvas" ref={container} role="region" tabIndex={0} aria-label="动态交付依赖图"
    data-layout-ready={!busy} data-layout-phase={phase} data-rendered-layout={rendered} data-connection-active={!!gesture}
    onPointerDownCapture={event=>{
      const endpoint=(event.target as HTMLElement).closest<HTMLElement>('[data-reconnect-end]');
      if(endpoint&&props.reconnect&&event.button===0){event.preventDefault();event.stopPropagation();const end=endpoint.dataset.reconnectEnd as 'source'|'target';connection.begin(end==='source'?props.reconnect.target:props.reconnect.source,'right',{x:event.clientX,y:event.clientY},event.pointerId,end);return;}
      connection.pointerDown(event);
      if(!event.isPropagationStopped()&&!runtime.covers(event.target as Element)&&!(event.target as HTMLElement).closest('input,button,select,textarea,[contenteditable=true]'))event.currentTarget.focus({preventScroll:true});
    }}
    onDragOver={e=>{if(editing&&e.dataTransfer.types.includes('application/pm-element')){e.preventDefault();e.dataTransfer.dropEffect='copy';}}}
    onDrop={e=>{if(!editing||runtime.covers(e.target as Element))return;const kind=e.dataTransfer.getData('application/pm-element');if(kind){e.preventDefault();createAt(kind,flow.screenToFlowPosition({x:e.clientX,y:e.clientY}));}}}
    onClickCapture={event=>{if(editing&&props.placing&&!runtime.covers(event.target as Element)){event.preventDefault();event.stopPropagation();createAt(props.placing,flow.screenToFlowPosition({x:event.clientX,y:event.clientY}));return;}connection.click(event);}}
    onMouseDownCapture={event=>{if(event.button===1)event.preventDefault();}}
    onAuxClick={event=>{if(event.button===1)event.preventDefault();}}
    onKeyDownCapture={event=>{
      if(event.nativeEvent.isComposing||event.nativeEvent.keyCode===229)return;
      const mod=event.ctrlKey||event.metaKey,key=event.key.toLowerCase();

      if(runtime.covers(event.target as Element)||(event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]'))return;
      const handle=(event.target as HTMLElement).closest<HTMLElement>('.business-handle');
      if(editing&&handle&&['Enter',' '].includes(event.key)){
        const node=handle.closest<HTMLElement>('.react-flow__node');if(node?.dataset.id){event.preventDefault();event.stopPropagation();if(!connection.choose(node.dataset.id)){const box=handle.getBoundingClientRect();connection.begin(node.dataset.id,handle.dataset.side as ConnectionSide,{x:box.x+box.width/2,y:box.y+box.height/2},null);}return;}
      }
      if(connectionRef.current&&['Enter',' '].includes(event.key)&&!(event.target as HTMLElement).closest('.business-handle')){
        const node=(event.target as HTMLElement).closest<HTMLElement>('.react-flow__node:not(.graph-node-hidden)');
        if(node?.dataset.id){event.preventDefault();event.stopPropagation();connection.choose(node.dataset.id);return;}
      }
      if(mod&&key==='z'&&(props.commands.allows('undo')||props.commands.allows('redo'))){event.preventDefault();event.stopPropagation();if(interaction.cancel())return;connection.cancel();props.commands.dispatch({type:event.shiftKey?'redo':'undo'});return;}
      if(mod&&key==='a'){event.preventDefault();event.stopPropagation();selectFromCanvas('');setSelectedIds(cards.filter(c=>!props.visibleIds||props.visibleIds.includes(c.id)).map(c=>c.id));return;}
      if(event.key==='Enter'&&!mod&&props.onOpenNode&&!connectionRef.current){event.preventDefault();event.stopPropagation();openNode((event.target as HTMLElement).closest<HTMLElement>('.react-flow__node')?.dataset.id||selected);return;}
      if(mod&&['f','c','v'].includes(key)){event.preventDefault();event.stopPropagation();if(key==='f')props.onSearch?.();if(key==='c')clipboard.current={ids:selectedEdge?[]:[...editableIds],nodes:positioned(),snapshot:props.commands.copy(editableIds)};if(key==='v'&&editing&&clipboard.current.ids.length)duplicate(clipboard.current.ids,32,clipboard.current.snapshot,clipboard.current.nodes);return;}
      if(editing&&event.key==='Delete'){event.preventDefault();event.stopPropagation();if(editableIds.length||selectedEdge)props.commands.dispatch({type:'delete',ids:editableIds,edgeId:selectedEdge});return;}
      if(editing&&event.key==='F2'&&actionableIds.includes(selected)&&!selectedEdge&&!['start','acceptance','project'].includes(cards.find(c=>c.id===selected)?.kind||'')){event.preventDefault();const el=container.current?.querySelector<HTMLElement>('[data-inline-title="'+CSS.escape(selected)+'"]');if(el)el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));}
      if(editing&&event.key.startsWith('Arrow')&&actionableIds.length&&!selectedEdge){event.preventDefault();event.stopPropagation();const delta=event.shiftKey?10:1,p=displayedPositions();for(const id of actionableIds){const n=p[id];if(n)p[id]={x:n.x+(event.key==='ArrowLeft'?-delta:event.key==='ArrowRight'?delta:0),y:n.y+(event.key==='ArrowUp'?-delta:event.key==='ArrowDown'?delta:0)};}commitMove(p);}
      if(event.key==='Escape'&&interaction.operation){event.preventDefault();event.stopPropagation();interaction.cancel();return;}
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(connectionRef.current)connection.cancel();else if(props.placing){props.onExitFocus?.();return;}else if(props.onDismissOverlays?.()){dismissError();return;}else {props.onExitFocus?.();if(!props.focusId&&!props.placing){setSelectedIds([]);selectFromCanvas('');}}dismissError();}
    }}>
    {!rendered&&slowBusy&&<div className="graph-initial-loader" role="status"><LoaderCircle size={20}/>正在准备画布</div>}
    {hint&&<div className={'dependency-layout-notice graph-connection-hint'+(gesture?.issue?' is-invalid':'')} style={gesture&&rect?{left:Math.max(12,Math.min(gesture.point.x-rect.left+16,rect.width-260)),top:Math.max(12,Math.min(gesture.point.y-rect.top+20,rect.height-110)),transform:'none'}:undefined} role="status">{hint}</div>}
    {error&&<div className="dependency-layout-notice graph-error-notice" data-workspace-zone="notice" role="alert"><span>{error}</span>{connectionIssue?.kind&&props.onInspectIssue&&<button className="ghost-button" onClick={()=>{props.onInspectIssue?.(connectionIssue);setError('');}}>{connectionIssue.kind==='duplicate'?'查看已有关系':'查看循环路径'}</button>}{routingError.current&&<button className="ghost-button" onClick={()=>setRetry(n=>n+1)}>重试连线</button>}<button className="graph-notice-close" aria-label="关闭提示" title="关闭提示" onClick={dismissError}><X size={16}/></button></div>}
    <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      nodesDraggable={editing} nodesConnectable={false} deleteKeyCode={null} autoPanOnNodeFocus={false} autoPanOnConnect={false}
      zoomOnScroll zoomOnPinch zoomOnDoubleClick={false} panOnScroll={false} preventScrolling zoomActivationKeyCode={null}
      onNodeDoubleClick={(_,node)=>openNode(node.id)}
      panActivationKeyCode="Space" panOnDrag={[0,1]} selectionKeyCode="Shift" multiSelectionKeyCode={["Control","Meta"]} connectOnClick={false}
      snapToGrid snapGrid={[8,8]}
      onPaneClick={event=>{if(props.placing&&editing)createAt(props.placing,flow.screenToFlowPosition({x:event.clientX,y:event.clientY}));else {setSelectedIds([]);selectFromCanvas('');}}}
      onNodeDragStart={(event,node)=>{selectFromCanvas(node.id);const ids=selectedIds.includes(node.id)?selectedIds:[node.id];setSelectedIds(ids);manualPending.current=true;const ticket=interaction.begin('move',()=>{cancelDrag();});drag.current={ticket,ids,original:displayedPositions(),copy:'altKey' in event&&event.altKey};setEdgeFade({ids:new Set(links.filter(e=>ids.includes(e.source)||ids.includes(e.target)).map(e=>e.id)),opacity:0});}}
      onNodeDrag={(_,node,dragged)=>{if(!drag.current)return;if(drag.current.cancelled){restoreDrag();return;}for(const n of dragged.length?dragged:[node])displayPositions.current.set(n.id,props.constrainPosition?.(n.id,n.position)||n.position);setDragTick(t=>t+1);}}
      onNodeDragStop={(event,node,dragged)=>{const d=drag.current;if(!d)return;const el='clientX' in event?document.elementFromPoint(event.clientX,event.clientY):null;const invalid=d.cancelled||!interaction.isCurrent(d.ticket)||!el||!container.current?.contains(el)||runtime.covers(el);if(invalid){restoreDrag();interaction.cancel();drag.current=null;return;}
        const targets=Object.fromEntries((dragged.length?dragged:[node]).filter(n=>d.ids.includes(n.id)).map(n=>[n.id,props.constrainPosition?.(n.id,n.position)||n.position]));
        if(d.copy){restoreDrag();drag.current=null;interaction.complete(d.ticket,()=>props.commands.dispatch({type:'duplicate',ids:d.ids,positions:vacantGroup(positioned(),targets,true)}));}
        else {const final={...d.original,...vacantGroup(positioned(),targets)};if(props.constrainPosition)for(const id of d.ids)final[id]=props.constrainPosition(id,final[id]);drag.current=null;interaction.complete(d.ticket,()=>commitMove(final));}
      }}
      onNodeClick={(event,node)=>{if(!connection.choose(node.id)){if(!event.ctrlKey&&!event.metaKey)setSelectedIds([node.id]);const ids=interaction.selection.kind==='nodes'?interaction.selection.ids:[];selectFromCanvas(ids.includes(node.id)?node.id:ids.at(-1)||'');}}} onEdgeClick={(_,edge)=>{interaction.select({kind:'edge',id:edge.id});}}
      onMoveEnd={(_,v)=>{if(!busy&&!first.current)saveViewport(keyRef.current,v);}} minZoom={.02} maxZoom={1.5} fitView={false}>
      <Background gap={24} size={1}/>{props.regions&&<div className="delivery-regions" style={{transform:`translate(${viewport.x}px,${viewport.y}px) scale(${viewport.zoom})`}}>{props.regions.filter(r=>!props.focusRegionId||r.id===props.focusRegionId||r.nodeIds.some(id=>props.visibleIds?.includes(id))).map(r=><div key={r.id} className="delivery-region" style={{left:r.x,top:r.y,width:r.width,height:Math.max(r.height,...nodes.filter(n=>r.nodeIds.includes(n.id)).map(n=>n.position.y-r.y+(n.measured?.height||168)+PHASE_PADDING))}} data-phase-region={r.id}><div className="delivery-region-header"><button className="ghost-button nodrag nopan" onClick={()=>props.onSelectPhase?.(r.phase?.featureId||'unassigned',r.id)}><span className="delivery-region-name" title={r.name}>{r.name}</span>{r.phase&&<PhaseStatusBadge phase={r.phase}/>}</button><p title={r.phase?.scope}>{r.phase?.scope||(!r.nodeIds.length?'交付范围待明确':'')}</p>{r.phase&&<small>目标 {r.phase.targetDate||'待定'}</small>}</div></div>)}</div>}
    </ReactFlow>
    {(liveCurve||pendingLinks.length>0)&&<svg className={'graph-connection-preview'+(gesture?.issue?' is-invalid':'')} aria-hidden="true">
      <defs><marker id={previewMarker} viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="context-stroke"/></marker></defs>
      {pendingLinks.map(e=>{const curve=pendingCurve(e);return curve?<path key={e.id} className="graph-preview-path graph-pending-route" data-edge-id={e.id} d={curve.d} markerEnd={'url(#'+previewMarker+')'}/>:null;})}
      {liveCurve?.d&&<path className={'graph-preview-path graph-live-connection'+(gesture?.issue?' is-invalid':'')} d={liveCurve.d} markerEnd={'url(#'+previewMarker+')'}/>}
    </svg>}
    {editing&&!busy&&props.reconnect&&(['source','target'] as const).map(end=>{
      const point=screenPoint(props.reconnect![end],end==='source'?'right':'left');if(!point||!rect)return null;
      return <button key={end} className="graph-reconnect-handle nopan nodrag" data-reconnect-end={end} aria-label={end==='source'?'拖动改接前置':'拖动改接后续'} style={{left:point.x-rect.left,top:point.y-rect.top}} onClick={e=>{if(e.detail===0)connection.begin(end==='source'?props.reconnect!.target:props.reconnect!.source,'right',point,null,end);}}/>;
    })}
    {drag.current&&!drag.current.cancelled&&<svg className="graph-drag-lines" aria-hidden="true">{flow.getNodes().filter(n=>!drag.current!.ids.includes(n.id)).flatMap(n=>drag.current!.ids.flatMap(id=>{const moving=flow.getNode(id);if(!moving)return [];const lines=[];if(Math.abs(n.position.x-moving.position.x)<5){const x=n.position.x*viewport.zoom+viewport.x;lines.push(<line key={id+n.id+'x'} x1={x} x2={x} y1={0} y2="100%"/>);}if(Math.abs(n.position.y-moving.position.y)<5){const y=n.position.y*viewport.zoom+viewport.y;lines.push(<line key={id+n.id+'y'} y1={y} y2={y} x1={0} x2="100%"/>);}return lines;}))}</svg>}
    {drag.current?.copy&&!drag.current.cancelled&&rect&&<div className="graph-copy-preview" data-drag-tick={dragTick}>{drag.current.ids.map(id=>{const p=drag.current!.original[id],n=flow.getNode(id);return p&&n?<div key={id} style={{left:p.x*viewport.zoom+viewport.x,top:p.y*viewport.zoom+viewport.y,width:(n.measured?.width||244)*viewport.zoom,height:(n.measured?.height||154)*viewport.zoom}}>{n.data.title}</div>:null;})}</div>}
    {props.children}
    <div className="graph-view-controls nopan nodrag nowheel" data-workspace-zone="controls"><span className="graph-layout-status" role="status" aria-label={slowBusy&&!gesture&&!drag.current?'正在更新连线':undefined} title={slowBusy&&!gesture&&!drag.current?'正在更新连线':undefined}>{slowBusy&&!gesture&&!drag.current&&<LoaderCircle size={14}/>}</span>
      <button className="ghost-button" aria-label="缩小画布" title="缩小画布" onClick={()=>void flow.zoomOut()}><Minus size={16}/></button><span>{Math.round(viewport.zoom*100)}%</span>
      <button className="ghost-button" aria-label="放大画布" title="放大画布" onClick={()=>void flow.zoomIn()}><Plus size={16}/></button>
      <button className="ghost-button" aria-label="定位所选节点" title="定位所选节点" disabled={!selected} onClick={()=>locate(selected)}><LocateFixed size={16}/></button><button className="ghost-button" aria-label="适配视图" title="适配视图" onClick={()=>void fitAvailable(true,props.focusId?props.emphasizedIds:props.visibleIds,true)}><Scan size={16}/></button>
      <button className="ghost-button" aria-label="自动整理" title={editing?"自动整理（可撤销）":"进入编辑后可整理共享布局"} disabled={!!gesture||!editing} onClick={()=>setArrange(value=>value+1)}><LayoutGrid size={16}/></button>
    </div>
  </div>;
}
