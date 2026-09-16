import { Button } from './Button';
import {Select} from './Select';
import {useState} from 'react';
import {ArrowUpRight} from 'lucide-react';
import {dependencySource,dependencyTarget,type Dependency,type PathAnalysis} from '../../shared/paths';
import {matchesSearch} from '../../shared/search';
import {endpointName,relationEndpoints,type RelationSide} from '../path-relations';

function EndpointPicker({data,relation,side,onChange,disabled}:{data:PathAnalysis;relation:Dependency;side:RelationSide;onChange:(id:string)=>void;disabled:boolean}) {
  const [search,setSearch]=useState('');
  const options=relationEndpoints(data,relation,side),value=side==='source'?dependencySource(relation):dependencyTarget(relation);
  const label=side==='source'?'等待什么完成':'完成后允许什么开始';
  const matches=options.filter(o=>o.id===value||o.kind==='start'||o.kind==='acceptance'||matchesSearch([o.title],search));
  return <div className="delivery-endpoint-picker">
    {options.length>5&&<input aria-label={'搜索'+label} placeholder="搜索工作项、里程碑／拼音" value={search} disabled={disabled} onChange={e=>setSearch(e.target.value)}/>}
    <label className="field"><span>{label}</span><Select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>
      {!options.some(o=>o.id===value)&&<option value={value}>已失效交付点</option>}
      {matches.map(o=><option key={o.id} value={o.id} disabled={o.disabled&&o.id!==value}>{o.title}{o.kind==='milestone'?'（里程碑）':''}{o.disabled?'（已结束）':''}</option>)}
    </Select></label>
  </div>;
}

export function DeliveryCondition({data,relation,editable,disabledReason,issue,onInspectIssue,onChange,onLocate}:{data:PathAnalysis;relation:Dependency;editable:boolean;disabledReason?:string;issue?:{message:string;kind?:string};onInspectIssue:()=>void;onChange:(source:string,target:string)=>void;onLocate:(id:string)=>void}) {
  const source=dependencySource(relation),target=dependencyTarget(relation);
  const sourceName=data.requirements.find(r=>r.id===relation.sourceRequirementId)?.title||'项目里程碑';
  const targetName=data.requirements.find(r=>r.id===relation.targetRequirementId)?.title||'项目里程碑';
  return <section className="delivery-condition" aria-label="交付条件">
    {editable?<>
      <div className="delivery-condition-owner" title={sourceName}>前置 · {sourceName}</div>
      <EndpointPicker data={data} relation={relation} side="source" disabled={false} onChange={id=>onChange(id,target)}/>
      <details className="delivery-target" open={relation.targetWorkItemId||relation.targetMilestoneId?true:undefined}>
        <summary>后续 · {targetName}<small>{endpointName(data,target,false)}</small></summary>
        <EndpointPicker data={data} relation={relation} side="target" disabled={false} onChange={id=>onChange(source,id)}/>
      </details>
      {issue&&<div className="delivery-condition-error" role="alert">{issue.message}{issue.kind==='cycle'&&<Button variant="secondary" type="button" className="ghost-button" onClick={onInspectIssue}>查看循环路径</Button>}</div>}
      <small>调整会替换当前关系，保存后生效。前置满足后仍由人开始。</small>
    </>:disabledReason&&<small>{disabledReason}</small>}
    <div className="delivery-condition-links">{([['source',source],['target',target]] as const).map(([side,id])=><Button variant="secondary" type="button" className="ghost-button" key={side} onClick={()=>onLocate(id)} title={endpointName(data,id)}><ArrowUpRight size={14}/>{side==='source'?'查看前置交付':'查看后续工作'}</Button>)}</div>
  </section>;
}
