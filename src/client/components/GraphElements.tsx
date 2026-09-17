import {useGraphInspect} from './ObjectDetailContext';
import { Button } from './Button';
import {ArrowUpRight} from 'lucide-react';
import {useProjectWorkspace} from '../project-workspace-context';
import {scopeFromObject} from '../workspace-location';
import {PhaseChip} from './DeliveryTables';
import { ExecutionStageBadge, WorkProgressBadge } from "./ExecutionStageBadge";
import {memo,useEffect,useRef,useMemo,useId} from 'react';
import {Handle,Position,BaseEdge,useUpdateNodeInternals,useStore,type Node,type NodeProps,type Edge,type EdgeProps} from '@xyflow/react';
import type {GraphCard} from '../path-projection';
import {roundedRoutePath,type RoutedLayout} from '../path-layout';
import {requirementStatusLabels,riskLabels} from '../../shared/domain';
import {EditorField} from './EditorField';
export type CardData = GraphCard & { selectedPhaseId?:string;onSelectPhase?:(featureId:string,phaseId:string)=>void;rename?:(id:string,title:string)=>void; connectable?:boolean; vertical: boolean; editing: boolean; highlighted: boolean; invalid: boolean; retiring?:boolean; context?:boolean; connection?:string };
export type CardNode = Node<CardData, 'delivery'>;
export type RouteEdge = Edge<{ route?: RoutedLayout['edges'][string]; critical: boolean; planningOnly?:boolean; labelText: string; description?:string; opacity:number; invalid?:boolean; filtered?:boolean }, 'delivery'>;
const Card = memo(function Card({ id, data, selected }: NodeProps<CardNode>) {
  const inspect=useGraphInspect(),workspace=useProjectWorkspace(),system=workspace?.data.featureContext?.overview.features.some(f=>f.id===data.featureId&&f.kind==='other');
  const update = useUpdateNodeInternals(), key = String(data.vertical);
  const previous = useRef(key);
  useEffect(() => { if (previous.current !== key) { previous.current = key; update(id); } }, [id, key, update]);
  const side = (input: boolean) => data.vertical ? input ? Position.Top : Position.Bottom : input ? Position.Left : Position.Right;
  return <div data-kind={data.kind} className={'dependency-card' + (selected ? ' selected' : '') + (data.external ? ' external' : '') +
    (data.critical ? ' critical' : '') + (data.highlighted ? ' search-match' : '') + (data.invalid ? ' invalid' : '') +
    (['start', 'acceptance'].includes(data.kind) ? ' gate-card' : '')+(['milestone','acceptance'].includes(data.kind)?' milestone-card':'')+(data.connection?' connection-'+data.connection:'')}>
    <Handle id="route-in" type="target" position={side(true)} className="route-handle" isConnectable={false}/>
    <div className="dependency-card-top">{data.kind==='work'?<WorkProgressBadge work={data}/>:data.kind==='requirement'&&data.executionStage?<ExecutionStageBadge requirement={{status:data.status,executionStage:data.executionStage}}/>:<span>{data.kind==='feature'?(system?'归类':data.archived?'归档特性':data.featureId==='unassigned'?'未关联特性':'特性'):data.kind==='template'?'流程工作':data.kind==='milestone'?'里程碑':data.external ? '关联工作' : requirementStatusLabels[data.status as keyof typeof requirementStatusLabels] || '交付条件'}</span>}
      {data.kind!=='template'&&data.kind!=='feature'&&<span className={'risk-badge risk-' + data.risk}>{['completed', 'cancelled'].includes(data.status) ? '已结束' : riskLabels[data.risk as keyof typeof riskLabels] || '待评估'}</span>}</div>
    {workspace?<div className="workspace-graph-name"><button className="text-button graph-title nodrag nopan" onClick={e=>{e.stopPropagation();(inspect||workspace.inspect)(id);}}>{data.title}</button>{['feature','requirement'].includes(data.kind)&&!data.external&&!data.context&&<Button variant="ghost" iconOnly size="small" className="workspace-enter workspace-icon-button nodrag nopan" title="进入下一级" aria-label={'进入'+data.title} onClick={e=>{e.stopPropagation();const scope=scopeFromObject(id,workspace.data);if(scope)workspace.enter(scope);}}><ArrowUpRight size={14}/></Button>}</div>:<EditorField inline required fieldKey={'title:'+id} value={data.title} disabled={['feature','requirement'].includes(data.kind)||!data.editing||!data.rename||['start','acceptance','project'].includes(data.kind)} onCommit={title=>data.rename?.(id,title)}/>}{data.kind!=='feature'&&<small title={data.subtitle}>{data.subtitle}</small>}
    <div className="dependency-card-bottom">{data.kind==='feature'?<span title={data.expectation}>{data.expectation||data.phases?.filter(p=>p.status!=='completed'&&p.targetDate).sort((a,b)=>a.targetDate!.localeCompare(b.targetDate!)).slice(0,1).map(p=>p.name+' · '+p.targetDate).join('')||'目标待安排'}</span>:<><span>{data.plannedEnd?'计划 '+data.plannedEnd:data.forecast?'预计 '+data.forecast:'日期待定'}</span>{data.kind!=='template'&&<span>{data.floatDays === null ? '余量待确认' : '余量 ' + data.floatDays + ' 天'}</span>}</>}</div>
    {(data.kind==='feature'&&!data.phases?.length||data.context||data.unknown||data.hiddenCount>0)&&<small>{data.kind==='feature'?'尚未规划 Phase':data.context?'来自 '+(data.featureName||'关联特性'):data.unknown?'交付条件待确认':'另有 '+data.hiddenCount+' 条关系'}</small>}
    {!!data.phases?.length&&<div className="delivery-phase-chips">{data.phases.map(p=><PhaseChip key={p.id} phase={p} selected={p.id===data.selectedPhaseId} onClick={()=>workspace?workspace.enter({kind:'phase',id:p.id}):data.onSelectPhase?.(p.featureId,p.id)}/>)}</div>}
    <Handle id="route-out" type="source" position={side(false)} className="route-handle" isConnectable={false}/>
    {data.editing && !system && data.connectable!==false && !data.retiring && data.kind !== 'start' && !(data.kind==='feature'&&(data.archived||data.featureId==='unassigned')) && (['left','right','top','bottom'] as const).map(side=><button key={side} type="button" data-side={side} className="business-handle nopan nodrag" aria-label={'从'+data.title+'的'+{left:'左',right:'右',top:'上',bottom:'下'}[side]+'侧连接后续'+(data.kind==='feature'?'特性':'工作')}/>)}
  </div>;
});
const RoutedEdge=memo(function RoutedEdge({ id, data, selected }: EdgeProps<RouteEdge>) {
  const markerId=useId().replace(/:/g,'_'),zoom=useStore(state=>state.transform[2]);
  const color=data?.invalid?'var(--danger)':selected||data?.critical?'var(--accent)':'var(--text-faint)';
  // Focus only changes the presentation group; retain the SVG geometry and labels.
  const drawing=useMemo(()=>{
    if(!data?.route)return null;
    const points=data.route.points.map(p=>({...p})),last=points.at(-1)!,previous=points.at(-2)!;
    const length=Math.hypot(last.x-previous.x,last.y-previous.y),gap=Math.min(6/zoom,10,length/3);
    if(length){last.x-=(last.x-previous.x)/length*gap;last.y-=(last.y-previous.y)/length*gap;}
    const path=roundedRoutePath(points),label=data.route.label;
    return <><defs><marker id={markerId} viewBox="0 0 8 8" refX="8" refY="4" markerWidth={Math.min(14,8/zoom)} markerHeight={Math.min(14,8/zoom)} markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill={color}/></marker></defs>
      <BaseEdge id={id} path={path} markerEnd={'url(#'+markerId+')'} interactionWidth={20} style={{stroke:color,strokeWidth:selected?2.8:data.critical?2.2:1.3,vectorEffect:'non-scaling-stroke',strokeDasharray:data.planningOnly?'6 4':undefined}}/>
      {label&&<g className="dependency-edge-label"><rect x={label.x-3} y={label.y} width={label.width+6} height={20} rx={4}/><text x={label.x} y={label.y+14}>{data.labelText}</text></g>}</>;
  },[id,data?.route,data?.labelText,data?.critical,data?.planningOnly,selected,color,markerId,zoom]);
  if(!data||!drawing)return null;
  return <g className="graph-routed-edge" opacity={data.opacity} style={{pointerEvents:data.opacity===0?'none':undefined}}><g className={'graph-edge-presentation'+(data.invalid?' is-invalid':'')+(data.filtered?' is-filtered':'')}><title>{data.description||data.labelText}</title>{drawing}</g></g>;
});
export const nodeTypes = { delivery: Card }, edgeTypes = { delivery: RoutedEdge };
