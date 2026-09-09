import {memo,useEffect,useRef,useMemo,useId} from 'react';
import {Handle,Position,BaseEdge,useUpdateNodeInternals,useStore,type Node,type NodeProps,type Edge,type EdgeProps} from '@xyflow/react';
import type {GraphCard} from '../path-projection';
import {roundedRoutePath,type RoutedLayout} from '../path-layout';
import {requirementStatusLabels,riskLabels} from '../../shared/domain';
import {EditorField} from './EditorField';
export type CardData = GraphCard & { rename?:(id:string,title:string)=>void; vertical: boolean; editing: boolean; highlighted: boolean; invalid: boolean; retiring?:boolean; context?:boolean; connection?:string };
export type CardNode = Node<CardData, 'delivery'>;
export type RouteEdge = Edge<{ route?: RoutedLayout['edges'][string]; critical: boolean; labelText: string; description?:string; opacity:number; invalid?:boolean; filtered?:boolean }, 'delivery'>;
const Card = memo(function Card({ id, data, selected }: NodeProps<CardNode>) {
  const update = useUpdateNodeInternals(), key = String(data.vertical);
  const previous = useRef(key);
  useEffect(() => { if (previous.current !== key) { previous.current = key; update(id); } }, [id, key, update]);
  const side = (input: boolean) => data.vertical ? input ? Position.Top : Position.Bottom : input ? Position.Left : Position.Right;
  return <div className={'dependency-card' + (selected ? ' selected' : '') + (data.external ? ' external' : '') +
    (data.critical ? ' critical' : '') + (data.highlighted ? ' search-match' : '') + (data.invalid ? ' invalid' : '') +
    (['start', 'acceptance'].includes(data.kind) ? ' gate-card' : '')+(['milestone','acceptance'].includes(data.kind)?' milestone-card':'')+(data.connection?' connection-'+data.connection:'')}>
    <Handle id="route-in" type="target" position={side(true)} className="route-handle" isConnectable={false}/>
    <div className="dependency-card-top"><span>{data.kind==='template'?'流程工作':data.kind==='milestone'?'里程碑':data.external ? '关联需求' : data.critical ? '关键路径' : requirementStatusLabels[data.status as keyof typeof requirementStatusLabels] || '交付条件'}</span>
      {data.kind!=='template'&&<span className={'risk-badge risk-' + data.risk}>{['completed', 'cancelled'].includes(data.status) ? '已结束' : riskLabels[data.risk as keyof typeof riskLabels] || '待评估'}</span>}</div>
    <EditorField inline required fieldKey={'title:'+id} value={data.title} disabled={!data.editing||!data.rename||['start','acceptance','project'].includes(data.kind)} onCommit={title=>data.rename?.(id,title)}/><small title={data.subtitle}>{data.subtitle}</small>
    <div className="dependency-card-bottom"><span>{data.forecast || '交付待确认'}</span>{data.kind!=='template'&&<span>{data.floatDays === null ? '余量待确认' : '余量 ' + data.floatDays + ' 天'}</span>}</div>
    <small>{data.context?'关联上下文':data.unknown ? '交付条件待确认' : data.hiddenCount ? '另有 ' + data.hiddenCount + ' 条关系' : '\u00a0'}</small>
    <Handle id="route-out" type="source" position={side(false)} className="route-handle" isConnectable={false}/>
    {data.editing && !data.retiring && data.kind !== 'start' && (['left','right','top','bottom'] as const).map(side=><button key={side} type="button" data-side={side} className="business-handle nopan nodrag" aria-label={'从'+data.title+'的'+{left:'左',right:'右',top:'上',bottom:'下'}[side]+'侧连接后续工作'}/>)}
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
      <BaseEdge id={id} path={path} markerEnd={'url(#'+markerId+')'} interactionWidth={20} style={{stroke:color,strokeWidth:selected?2.8:data.critical?2.2:1.3,vectorEffect:'non-scaling-stroke'}}/>
      {label&&<g className="dependency-edge-label"><rect x={label.x-3} y={label.y} width={label.width+6} height={20} rx={4}/><text x={label.x} y={label.y+14}>{data.labelText}</text></g>}</>;
  },[id,data?.route,data?.labelText,data?.critical,selected,color,markerId,zoom]);
  if(!data||!drawing)return null;
  return <g className="graph-routed-edge" opacity={data.opacity} style={{pointerEvents:data.opacity===0?'none':undefined}}><g className={'graph-edge-presentation'+(data.invalid?' is-invalid':'')+(data.filtered?' is-filtered':'')}><title>{data.description||data.labelText}</title>{drawing}</g></g>;
});
export const nodeTypes = { delivery: Card }, edgeTypes = { delivery: RoutedEdge };
