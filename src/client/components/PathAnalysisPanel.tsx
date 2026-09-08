import { useEffect,useMemo,useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError,jsonBody, requiresWriteRecheck } from '../api';
import { useSession } from '../app-context';
import { useResourceQuery } from '../use-resource-query';
import { invalidateRequirementViews, keys } from '../query-keys';
import { canManageProject } from '../permissions';
import type { Requirement } from '../types';
import { acceptanceId, startId, type PathAnalysis, type PathNode } from '../../shared/paths';
import { addBusinessDays, riskLabels, todayIso } from '../../shared/domain';
import { hasWorkdayCalendarFallback } from '../../shared/workday';
import { projectPathGraph } from '../path-projection';
import { Modal } from './Modal';
import { EmptyState, LoadingState } from './Feedback';
import { FormError } from './Form';
import '../paths.css';
import {emptyRequirementFilters,unfinishedStatuses,matchesRequirementFilters,compareRiskRequirements} from '../../shared/requirement-view';
import {matchesSearch} from '../../shared/search';
import {readPathFilters,writePathFilters,graphBranch,graphContext,cardFilterItem,cardSearch,readPathOrigin,savePathOrigin} from '../path-view';
import {PathFilters} from './PathFilters';
import { GraphWorkspace } from './GraphWorkspace';
import { PredecessorPicker } from './PredecessorPicker';
import { clearProjectGraphDrafts,useDependencyDraft } from '../use-graph-draft';
import { draftNetwork, dependencyIssue } from '../dependency-draft';
import type { DependencyChanges } from '../../shared/path-contracts';
import type { GraphCard } from '../path-projection';
type PlanPreview={requirementId:string;projectId:string;baseStart:string;expectedRevision:number;previewToken:string;applicable:boolean;entries:Array<{workItemId:string;requirementId:string;title:string;currentStart:string|null;currentEnd:string|null;proposedStart:string|null;proposedEnd:string|null;reasons:string[]}>};
type Editor = {kind:'relation'}|{kind:'estimate';node:PathNode}|{kind:'review'}|{kind:'plan'}|{kind:'acceptance'};

function PathEditor({editor,data,requirement,manager,onClose,onReload}:{editor:Editor;data:PathAnalysis;requirement?:Requirement;manager:boolean;onClose:()=>void;onReload:()=>Promise<PathAnalysis>}) {
  const client=useQueryClient(), [baseline,setBaseline]=useState(data.revision),[needsCheck,setNeedsCheck]=useState(false),[reloadError,setReloadError]=useState(''),[preview,setPreview]=useState<PlanPreview|null>(null);
  const [sourceReq,setSourceReq]=useState(requirement?.id||data.requirements[0]?.id||''),[targetReq,setTargetReq]=useState(requirement?.id||data.requirements[1]?.id||data.requirements[0]?.id||'');
  const [sourceWork,setSourceWork]=useState(''),[targetWork,setTargetWork]=useState('');
  const estimate=editor.kind==='estimate'?editor.node.estimate:null;
  const [duration,setDuration]=useState(String(estimate?.durationDays??(editor.kind==='estimate'?Math.max(1,editor.node.remainingDays):1))),[earliest,setEarliest]=useState(estimate?.earliestStart||'');
  const [unblock,setUnblock]=useState(estimate?.unblockEstimate||''),[forecast,setForecast]=useState(estimate?.forecastEnd||'');
  const [acceptance,setAcceptance]=useState(data.requirements.find(r=>r.id===requirement?.id)?.forecastAcceptance||'');
  const [baseStart,setBaseStart]=useState(addBusinessDays(todayIso(),0));
  const stale=baseline!==data.revision||needsCheck;
  const {session}=useSession();
  const canEditStructure=manager||!!requirement&&requirement.ownerId===session.personId;
  const mutation=useMutation({mutationFn:async ({url,body,method='POST'}:{url:string;body:unknown;method?:string})=>api(url,{method,body:jsonBody(body)}),onSuccess:()=>{invalidateRequirementViews(client,requirement?.id);onClose();},onError:(error)=>{if(requiresWriteRecheck(error))setNeedsCheck(true);}});
  const planning=useMutation({mutationFn:()=>api<PlanPreview>(`/api/requirements/${requirement!.id}/dependency-plan/preview`,{method:'POST',body:jsonBody({baseStart,expectedRevision:baseline})}),onSuccess:setPreview});
  const options=data.requirements.filter(r=>manager||r.id===requirement?.id);
  const submit=()=>{
    if(stale)return;
    const version={expectedRevision:baseline};
    if(editor.kind==='relation') mutation.mutate({url:`/api/projects/${data.projectId}/dependencies`,body:{...version,sourceRequirementId:sourceReq,sourceWorkItemId:sourceWork||null,targetRequirementId:targetReq,targetWorkItemId:targetWork||null}});
    if(editor.kind==='estimate') mutation.mutate({url:`/api/work-items/${editor.node.id}/path-estimate`,method:'PATCH',body:{...version,...canEditStructure?{durationDays:Number(duration),earliestStart:earliest||null}:{},unblockEstimate:unblock||null,forecastEnd:forecast||null}});
    if(editor.kind==='review') mutation.mutate({url:`/api/requirements/${requirement!.id}/dependency-review`,body:{...version,reviewed:true}});
    if(editor.kind==='acceptance') mutation.mutate({url:`/api/requirements/${requirement!.id}/dependency-review`,body:{...version,forecastAcceptance:acceptance||null}});
    if(editor.kind==='plan'&&preview) mutation.mutate({url:`/api/requirements/${requirement!.id}/dependency-plan/apply`,body:{baseStart,expectedRevision:baseline,previewToken:preview.previewToken}});
  };
  const labels={relation:'配置交付前置',estimate:'工期与交付预测',review:'核对需求依赖',plan:'按依赖预览排期',acceptance:'预计验收日期'};
  return <Modal title={labels[editor.kind]} width={editor.kind==='plan'?880:660} closable={!mutation.isPending} onClose={onClose}>
    <form className="path-editor" onSubmit={e=>{e.preventDefault();submit();}}><fieldset disabled={mutation.isPending}>
      {stale&&<div className="warning-banner">数据或操作结果需要重新核对，已填内容保留。<button type="button" className="ghost-button" onClick={()=>void onReload().then(latest=>{setBaseline(latest.revision);setNeedsCheck(false);setPreview(null);setReloadError('');}).catch(error=>setReloadError(error.message))}>重新读取并核对</button></div>}
      {editor.kind==='relation'&&<><p>前置完成后，后续工作才具备开始条件。多个前置必须全部满足。</p>
        <div className="path-form-grid">{(['source','target'] as const).map(side=>{
          const source=side==='source',reqId=source?sourceReq:targetReq;
          return <div key={side}><label className="field"><span>{source?'前置需求':'后续需求'}</span><select aria-label={source?'前置需求':'后续需求'} value={reqId} onChange={e=>{if(source){setSourceReq(e.target.value);setSourceWork('');}else{setTargetReq(e.target.value);setTargetWork('');}}}>{options.map(r=><option value={r.id} key={r.id}>{r.title}</option>)}</select></label>
            <label className="field"><span>{source?'交付点':'开始条件'}</span><select aria-label={source?'前置交付点':'后续工作'} value={source?sourceWork:targetWork} onChange={e=>source?setSourceWork(e.target.value):setTargetWork(e.target.value)}><option value="">{source?'整需求验收完成':'整个需求开始'}</option>{data.nodes.filter(n=>n.requirementId===reqId&&n.kind==='work').map(n=><option key={n.id} value={n.id}>{n.title}</option>)}</select></label></div>;
        })}</div></>}
      {editor.kind==='estimate'&&<><p>{editor.node.title}</p><div className="path-form-grid">{canEditStructure&&<><label className="field"><span>预计工期（工作日）</span><input type="number" min={1} max={3660} value={duration} onChange={e=>setDuration(e.target.value)} required/></label><label className="field"><span>最早开始（可选约束）</span><input type="date" value={earliest} onChange={e=>setEarliest(e.target.value)}/></label></>}
        <label className="field"><span>预计解除阻塞</span><input type="date" min={data.asOfDate} value={unblock} onChange={e=>setUnblock(e.target.value)}/></label><label className="field"><span>人工预测完成</span><input type="date" min={data.asOfDate} value={forecast} onChange={e=>setForecast(e.target.value)}/></label></div><p className="field-help">日期可留空。缺少解阻时间时，受影响交付保持待确认。修改预测不自动改写计划。</p></>}
      {editor.kind==='review'&&<><p>请核对本需求全部工作项，以及下方关系明细。确认后，没有前置关系的工作项按独立工作处理。</p><ul>{data.dependencies.filter(d=>d.targetRequirementId===requirement!.id).map(d=><li key={d.id}>{data.nodes.find(n=>n.id===(d.sourceWorkItemId||acceptanceId(d.sourceRequirementId)))?.title} → {d.targetWorkItemId?data.nodes.find(n=>n.id===d.targetWorkItemId)?.title:'整个需求开始'}</li>)}</ul><p>本次确认不改动已保存的计划日期。</p></>}
      {editor.kind==='acceptance'&&<label className="field"><span>预计验收日期</span><input type="date" min={data.asOfDate} value={acceptance} onChange={e=>setAcceptance(e.target.value)}/><small>留空表示日期待确认；不代替真正的验收操作。</small></label>}
      {editor.kind==='plan'&&<><label className="field"><span>需求开始锚点</span><input type="date" min={data.asOfDate} value={baseStart} onChange={e=>{setBaseStart(e.target.value);setPreview(null);}} required/></label><button type="button" className="ghost-button" disabled={stale||planning.isPending} onClick={()=>planning.mutate()}>生成差异预览</button>
        {preview&&<div className="path-table-scroll"><table><thead><tr><th>工作项</th><th>当前计划</th><th>建议计划</th></tr></thead><tbody>{preview.entries.map(e=><tr key={e.workItemId}><td>{e.title}</td><td>{e.currentStart||'—'} ～ {e.currentEnd||'—'}</td><td>{e.proposedStart&&e.proposedEnd?`${e.proposedStart} ～ ${e.proposedEnd}`:e.reasons.join('；')}</td></tr>)}</tbody></table><p>涉及 {new Set(preview.entries.map(e=>e.requirementId)).size} 个需求，只调整未开始工作。</p></div>}</>}
      <FormError>{mutation.error?.message||planning.error?.message||reloadError}</FormError>
      <div className="button-row"><button type="button" className="ghost-button" onClick={onClose}>取消</button><button className="primary-button" disabled={stale||mutation.isPending||(editor.kind==='plan'&&!preview?.applicable)}>{mutation.isPending?'保存中…':editor.kind==='review'?'确认已核对':editor.kind==='plan'?'应用以上计划':'保存'}</button></div>
    </fieldset></form>
  </Modal>;
}


export function PathAnalysisPanel({projectId,requirement,onExit}:{projectId:string;requirement?:Requirement;onExit?:()=>void}) {
  const [params]=useSearchParams();
  const {session}=useSession();
  const target=requirement?(params.get('target')||acceptanceId(requirement.id)):'project';
  const query=useResourceQuery<PathAnalysis>([...keys.paths,projectId,requirement?.id||'all',target],
    requirement?'/api/requirements/'+requirement.id+'/path-analysis?target='+encodeURIComponent(target):'/api/projects/'+projectId+'/path-analysis',!!projectId);
  useEffect(()=>{if(query.error instanceof ApiError&&[401,403].includes(query.error.status))clearProjectGraphDrafts(session.accountId||'guest',projectId);},[query.error,session.accountId,projectId]);
  if(query.isLoading)return <div className="path-analysis immersive-path graph-loading-shell"><section className="graph-workspace"><LoadingState label="正在分析交付依赖…"/></section></div>;
  if(query.unavailable||!query.data)return <EmptyState title="路径分析暂不可用" detail={query.error?.message||'请选择项目'} action={<button className="ghost-button" onClick={()=>void query.refetch()}>重新加载</button>}/>;
  return <PathWorkspace key={projectId} data={query.data} requirement={requirement} target={target} onExit={onExit}
    onReload={async()=>{const result=await query.refetch({throwOnError:true});return result.data!;}}/>;
}
function EstimateFields({node,structure,onChange}:{node:PathNode;structure:boolean;onChange:(patch:DependencyChanges['estimates'][number])=>void}) {
  return <div className="graph-fields">{(['durationDays','earliestStart','unblockEstimate','forecastEnd'] as const).filter(k=>structure||!['durationDays','earliestStart'].includes(k)).map(key=>
    <label className="field" key={key}><span>{{durationDays:'预计工期（工作日）',earliestStart:'最早开始',unblockEstimate:'预计解阻',forecastEnd:'人工预测完成'}[key]}</span>
      <input key={key+String(node.estimate[key])} aria-label={{durationDays:'预计工期',earliestStart:'最早开始',unblockEstimate:'预计解阻',forecastEnd:'人工预测完成'}[key]}
        type={key==='durationDays'?'number':'date'} min={key==='durationDays'?1:undefined} max={key==='durationDays'?3660:undefined} defaultValue={node.estimate[key]??''}
        onBlur={e=>{const value=e.target.value?(key==='durationDays'?Number(e.target.value):e.target.value):null;if(value!==node.estimate[key])onChange({workItemId:node.id,[key]:value});}}/></label>)}
    <small>字段修改加入草稿。保存预测后，计划日期仍需单独预览并应用。</small></div>;
}
function PathWorkspace({data:formal,requirement,target,onExit,onReload}:{data:PathAnalysis;requirement?:Requirement;target:string;onExit?:()=>void;onReload:()=>Promise<PathAnalysis>}) {
  const [params,setParams]=useSearchParams(),location=useLocation(),navigate=useNavigate(),client=useQueryClient(),{session}=useSession();
  const focus=requirement?.id,manager=canManageProject(session,formal.projectId),canEdit=manager||!!requirement&&requirement.ownerId===session.personId;
  const draft=useDependencyDraft(session.accountId||'guest',formal,target,()=>{invalidateRequirementViews(client,focus);void onReload().catch(()=>{});});
  const data=useMemo(()=>draft.preview?.analysis||draftNetwork(formal,draft.changes),[draft.preview,formal,draft.changes]);
  const editing=draft.active&&!draft.pending,selected=params.get('pathNode')||params.get('workItemId')||'',search=params.get('pathSearch')||'';
  const viewStorage='pm-path-view:'+(session.accountId||'guest')+':'+formal.projectId+':'+(focus||'all');
  const viewLoaded=useRef(false);
  useEffect(()=>{
    try{if(!viewLoaded.current){viewLoaded.current=true;const saved=sessionStorage.getItem(viewStorage);if(saved&&![...params.keys()].some(k=>k.startsWith('path'))){const next=new URLSearchParams(params);for(const [k,v] of new URLSearchParams(saved))if(k.startsWith('path'))next.set(k,v);setParams(next,{replace:true,state:location.state});return;}}
      sessionStorage.setItem(viewStorage,params.toString());
    }catch{/* Explicit URL navigation remains available. */}
  },[viewStorage,params,setParams,location.state]);
  const panel=params.get('pathPanel')||'',setPanel=(value:string)=>setParam('pathPanel',value);
  const [edgeId,setEdgeId]=useState(''),[relationId,setRelationId]=useState('');
  const inspector=(params.get('pathInspector')||(matchMedia('(max-width:800px)').matches?'closed':'open'))==='open'&&(!!selected||!!edgeId||!!relationId),setInspector=(value:boolean)=>setParam('pathInspector',value?'open':'closed');
  const [locate,setLocate]=useState<{id:string;sequence:number}>();
  const [imported,setImported]=useState<string[]>(()=>selected?[selected]:[]),[issue,setIssue]=useState<{message:string;nodeIds?:string[]}>(),[confirmDiscard,setConfirmDiscard]=useState(false);
  const [guard,setGuard]=useState<null|(()=>void)>(null),[editor,setEditor]=useState<Editor|null>(null);
  useEffect(()=>{const media=matchMedia('(max-width: 800px)'),changed=()=>{if(media.matches){const next=new URLSearchParams(params);next.delete('pathPanel');next.set('pathInspector','closed');setParams(next,{replace:true,state:location.state});}};media.addEventListener('change',changed);return()=>media.removeEventListener('change',changed);},[params,setParams,location.state]);
  useEffect(()=>setIssue(undefined),[draft.changes]);
  const branchParam=params.get('pathBranch')||'',[branch,setBranch]=useState(branchParam);
  useEffect(()=>setBranch(branchParam),[branchParam]);
  const setParam=(name:string,value:string)=>{if(name==='pathBranch')setBranch(value);const next=params;if(value)next.set(name,value);else next.delete(name);setParams(new URLSearchParams(next),{replace:true,state:location.state});};
  const narrow=()=>matchMedia('(max-width: 800px)').matches;
  const select=(id:string)=>{setParam('pathNode',id);setEdgeId('');setRelationId('');setInspector(true);if(narrow())setPanel('');};
  const openPanel=(name:string)=>{setPanel(panel===name?'':name);if(narrow())setInspector(false);};
  const originKey=(session.accountId||'guest')+':'+formal.projectId+':'+location.key;
  const origin=readPathOrigin(originKey,location.state);
  useEffect(()=>savePathOrigin(originKey,origin),[originKey,origin]);
  const directTo=(requirementId:string,workItemId?:string|null)=>{
    const p=new URLSearchParams({view:'path',target});if(workItemId)p.set('pathNode',workItemId);
    navigate('/requirements/'+requirementId+'?'+p,{state:{pathOrigin:{url:location.pathname+location.search,label:focus?requirement!.title+'路径':'项目全局',parent:origin}}});
  };
  const goBack=async()=>{
    if(!origin)return;const id=/^\/requirements\/([^/?]+)/.exec(origin.url)?.[1];
    try{if(id)await api('/api/requirements/'+id,{readOnly:true});navigate(origin.url,{state:{pathOrigin:origin.parent}});}
    catch(error){if(error instanceof ApiError&&[403,404].includes(error.status))navigate('/paths',{state:{pathNotice:'来源已删除或不可访问，已返回项目全局。'}});else setIssue({message:'暂时无法读取来源，请稍后重试返回。'});}
  };
  const guarded=(action:()=>void)=>{if(draft.count||draft.pending)setGuard(()=>action);else action();};
  const graph=useMemo(()=>{
    const value=projectPathGraph(data,focus,false);
    if(focus)for(const id of new Set(imported)) {
      if(value.cards.some(c=>c.id===id))continue;
      const n=data.nodes.find(n=>n.id===id&&n.kind==='work');if(!n)continue;
      value.cards.push({id:n.id,requirementId:n.requirementId!,workItemId:n.id,kind:n.kind,title:n.title,subtitle:'外部 · '+data.requirements.find(r=>r.id===n.requirementId)?.title,status:n.status,risk:data.risks[n.requirementId!]?.riskLevel||'pending',forecast:n.forecastEnd,floatDays:n.floatDays,critical:n.critical,unknown:!!n.unknownReasons.length,external:true,hiddenCount:0});
    }
    if(draft.count&&!draft.preview)value.cards=value.cards.map(c=>({...c,forecast:null,floatDays:null,critical:false,unknown:true}));
    return value;
  },[data,focus,imported,draft.count,draft.preview]);
  const [filters,setFilters]=useState(()=>readPathFilters(params,!!focus));
  const filterSignature=JSON.stringify(readPathFilters(params,!!focus));
  useEffect(()=>setFilters(JSON.parse(filterSignature)),[filterSignature]);
  const applyFilters=(value:ReturnType<typeof readPathFilters>)=>{setFilters(value);setParams(writePathFilters(params,value),{replace:true,state:location.state});};
  const sorted=useMemo(()=>[...graph.cards].sort((a,b)=>compareRiskRequirements(cardFilterItem(a,data),cardFilterItem(b,data))),[graph.cards,data]);
  const matching=useMemo(()=>sorted.filter(c=>matchesRequirementFilters(cardFilterItem(c,data),filters)),[sorted,data,filters]);
  const ids=useMemo(()=>graphContext(new Set(matching.map(c=>c.id)),graph.links),[matching,graph.links]);
  const visibleIds=useMemo(()=>[...ids],[ids]),contextIds=useMemo(()=>visibleIds.filter(id=>!matching.some(c=>c.id===id)),[visibleIds,matching]);
  const emphasized=useMemo(()=>branch?graphBranch(branch,focus?data.edges:graph.links):ids,[branch,focus,data.edges,graph.links,ids]);
  const emphasizedIds=useMemo(()=>visibleIds.filter(id=>emphasized.has(id)),[visibleIds,emphasized]);
  const floatMatch=(c:GraphCard)=>{const f=params.get('pathFloat');return !f||(f==='unknown'?c.floatDays===null:f==='critical'?c.floatDays===0:f==='near'?c.floatDays!==null&&c.floatDays>0&&c.floatDays<=2:c.floatDays!==null&&c.floatDays>2);};
  const searchCards=useMemo(()=>{
    if(!focus)return graph.cards;const known=new Set(graph.cards.map(c=>c.id));
    const others:GraphCard[]=data.nodes.filter(n=>n.kind==='work'&&!known.has(n.id)).map(n=>({id:n.id,requirementId:n.requirementId!,workItemId:n.id,kind:n.kind,title:n.title,subtitle:'外部 · '+data.requirements.find(r=>r.id===n.requirementId)?.title,status:n.status,risk:data.risks[n.requirementId!]?.riskEvaluated?n.riskLevel:'pending',forecast:n.forecastEnd,floatDays:n.floatDays,critical:n.critical,unknown:!!n.unknownReasons.length,external:true,hiddenCount:0}));
    return [...graph.cards,...others];
  },[graph.cards,data,focus]);
  const results=(search?searchCards:sorted).filter(c=>cardSearch(c,data,search)&&floatMatch(c)).sort((a,b)=>compareRiskRequirements(cardFilterItem(a,data),cardFilterItem(b,data)));
  const listed=(search?results:matching.filter(floatMatch));
  const locateNode=(id:string)=>{
    if(focus&&!graph.cards.some(c=>c.id===id))setImported(current=>[...new Set([...current,id])]);
    if(!ids.has(id)){const next=writePathFilters(params,emptyRequirementFilters());next.delete('pathBranch');setBranch('');setParams(next,{replace:true,state:location.state});}
    else if(branch&&!emphasized.has(id))setParam('pathBranch','');
    setLocate({id,sequence:Date.now()});
  };
  const people=new Map<string,string>(),owners=new Map<string,string>();
  for(const r of data.requirements){if(r.ownerId)owners.set(r.ownerId,r.ownerName||'未命名人员');(r.assigneeIds||[]).forEach((id,i)=>people.set(id,r.assigneeNames?.[i]||id));}
  if(focus)for(const n of data.nodes)if(n.ownerId)owners.set(n.ownerId,n.ownerName||'未命名人员');
  const filterCount=Object.values(filters).reduce<number>((sum,v)=>sum+(Array.isArray(v)?v.length:Number(v)),0);
  const selectedCard=searchCards.find(c=>c.id===selected),node=data.nodes.find(n=>n.id===selected);
  const selectedEdge=graph.links.find(e=>e.id===edgeId),selectedRelation=data.dependencies.find(d=>d.id===relationId);
  const editableRelation=(d:PathAnalysis['dependencies'][number])=>manager||canEdit&&d.sourceRequirementId===focus&&d.targetRequirementId===focus;
  const remove=(id:string,changes=draft.changes):DependencyChanges=>({...changes,add:changes.add.filter(e=>e.clientId!==id),remove:formal.dependencies.some(e=>e.id===id)?[...new Set([...changes.remove,id])]:changes.remove});
  const proposal=(source:string,destination:string):DependencyChanges['add'][number]|null=>{
    if(!focus)return {clientId:crypto.randomUUID(),sourceRequirementId:source,sourceWorkItemId:null,targetRequirementId:destination,targetWorkItemId:null};
    const a=data.nodes.find(n=>n.id===source),b=data.nodes.find(n=>n.id===destination);if(!a?.requirementId||!b?.requirementId)return null;
    return {clientId:crypto.randomUUID(),sourceRequirementId:a.requirementId,sourceWorkItemId:a.kind==='work'?a.id:null,targetRequirementId:b.requirementId,targetWorkItemId:b.kind==='work'?b.id:null};
  };
  const validate=(source:string,destination:string)=>{
    if(source===destination)return {message:'不能依赖自身',nodeIds:[source]};
    const edge=proposal(source,destination);if(!edge)return {message:'交付端点已失效'};
    if(['completed','cancelled'].includes(data.requirements.find(r=>r.id===edge.targetRequirementId)?.status||'')||['completed','cancelled'].includes(data.nodes.find(n=>n.id===destination)?.status||''))return {message:'已结束的交付不能增加前置关系',nodeIds:[destination]};
    if(!manager&&(!canEdit||edge.sourceRequirementId!==focus||edge.targetRequirementId!==focus))return {message:'跨需求关系由项目经理维护'};
    if(data.dependencies.some(d=>d.sourceRequirementId===edge.sourceRequirementId&&d.targetRequirementId===edge.targetRequirementId&&d.sourceWorkItemId===edge.sourceWorkItemId&&d.targetWorkItemId===edge.targetWorkItemId))return {message:'这条依赖已经存在',nodeIds:[source,destination]};
    return dependencyIssue(formal,{...draft.changes,add:[...draft.changes.add,edge]});
  };
  const connect=(source:string,destination:string)=>{
    const error=validate(source,destination);if(error){setIssue(error);return;}
    draft.change({...draft.changes,add:[...draft.changes.add,proposal(source,destination)!]});setIssue(undefined);
  };
  const reconnectRelation=selectedRelation||(selectedEdge?.dependencyIds.length===1?data.dependencies.find(d=>d.id===selectedEdge.dependencyIds[0]):undefined);
  const canReconnect=editing&&reconnectRelation&&editableRelation(reconnectRelation)&&(!!focus||!reconnectRelation.sourceWorkItemId&&!reconnectRelation.targetWorkItemId);
  const reconnectChanges=(source:string,destination:string)=>{const next=remove(reconnectRelation!.id);return {...next,add:[...next.add,proposal(source,destination)!]};};
  const validateReconnect=(source:string,destination:string)=>{
    const edge=proposal(source,destination);if(!edge||!canReconnect)return {message:'不能改接该关系'};
    if(['completed','cancelled'].includes(data.requirements.find(r=>r.id===edge.targetRequirementId)?.status||'')||['completed','cancelled'].includes(data.nodes.find(n=>n.id===destination)?.status||''))return {message:'已结束的交付不能增加前置关系'};
    if(!manager&&(edge.sourceRequirementId!==focus||edge.targetRequirementId!==focus))return {message:'跨需求关系由项目经理维护'};
    if(data.dependencies.some(d=>d.id!==reconnectRelation!.id&&d.sourceRequirementId===edge.sourceRequirementId&&d.targetRequirementId===edge.targetRequirementId&&d.sourceWorkItemId===edge.sourceWorkItemId&&d.targetWorkItemId===edge.targetWorkItemId))return {message:'这条依赖已经存在'};
    return dependencyIssue(formal,reconnectChanges(source,destination));
  };
  const label=(id:string)=>data.nodes.find(n=>n.id===id)?.title||data.requirements.find(r=>r.id===id)?.title||'失效端点';
  const relationLabel=(d:PathAnalysis['dependencies'][number])=>label(d.sourceWorkItemId||acceptanceId(d.sourceRequirementId))+' → '+label(d.targetWorkItemId||startId(d.targetRequirementId));
  const displayRelations=selectedEdge?data.dependencies.filter(d=>selectedEdge.dependencyIds.includes(d.id)):data.dependencies.filter(d=>focus?(d.sourceRequirementId===focus||d.targetRequirementId===focus):d.sourceRequirementId!==d.targetRequirementId);
  const relationList=(relations:typeof data.dependencies)=><div className="graph-relation-list">{relations.length?relations.map(d=><div key={d.id}>
    <button className={relationId===d.id?'selected':''} onClick={()=>{setRelationId(d.id);setInspector(true);if(narrow())setPanel('');}}>{relationLabel(d)}<small>{d.sourceWorkItemId||d.targetWorkItemId?'部分交付':'验收后开始'} · {d.origin==='template'?'模板关系':'自定义关系'}</small></button>
    {editing&&editableRelation(d)&&relationId===d.id&&<button className="ghost-button" onClick={()=>{draft.change(remove(d.id));setRelationId('');}}>移除选中关系</button>}
  </div>):<p>当前没有关系。</p>}</div>;
  const work=requirement?.workItems.find(w=>w.id===selected),canEstimate=!!work&&!['completed','cancelled'].includes(work.status)&&(canEdit||!!session.personId&&work.assigneeIds.includes(session.personId));
  const req=data.requirements.find(r=>r.id===focus);
  const nodesPanel=<>
    {panel==='filters'&&<PathFilters value={filters} onChange={applyFilters} owners={[...owners].map(([id,title])=>({id,title}))} people={[...people].map(([id,title])=>({id,title}))} personId={session.personId} internal={!!focus}/>}
    <p className="graph-result-count">匹配 {matching.length} 项 · 关联上下文 {contextIds.length} 项</p>
    {!listed.length&&<p>没有匹配项。<button className="ghost-button" onClick={()=>{setParam('pathSearch','');applyFilters({...emptyRequirementFilters(),statuses:focus?[]:[...unfinishedStatuses]});}}>清空条件</button></p>}
    <div className="path-node-list">{listed.map(c=><div className="graph-list-row" key={c.id}><button className={selected===c.id?'selected':''} onClick={()=>select(c.id)}>{c.title}<small>{!ids.has(c.id)?'范围外 · ':branch&&!emphasized.has(c.id)?'分支外 · ':''}{c.forecast||'待确认'} · {riskLabels[c.risk as keyof typeof riskLabels]||'待评估'}</small>{search&&c.kind==='requirement'&&<small>{data.nodes.filter(n=>n.requirementId===c.id&&n.kind==='work'&&matchesSearch([{text:n.title,weight:1}],search)).map(n=>n.title).join('、')}</small>}</button><button className="ghost-button" onClick={()=>locateNode(c.id)}>{ids.has(c.id)?'定位':'查看全部并定位'}</button></div>)}</div></>;
  const finder=<><input aria-label="筛选图中节点" value={search} placeholder={focus?'搜索工作项／拼音':'搜索需求、工作项／拼音'} onChange={e=>{setParam('pathSearch',e.target.value);setPanel('nodes');}}/><button className="ghost-button" onClick={()=>openPanel('filters')}>筛选 · {filterCount}</button><button className="ghost-button" onClick={()=>openPanel('nodes')}>节点 {matching.length}</button><button className="ghost-button" onClick={()=>{setParam('pathSearch','');setParam('pathFloat','');applyFilters({...emptyRequirementFilters(),statuses:focus?[]:[...unfinishedStatuses]});}}>清空</button></>;
  const toolbar=<><div className="graph-toolbar-row"><div className="graph-title-group">{origin&&<button className="graph-back-link" onClick={()=>void goBack()}>返回{origin.label}</button>}{focus&&<Link className="graph-back-link" to="/paths">项目全局</Link>}{onExit&&<button className="graph-back-link" onClick={()=>guarded(onExit)}>查看需求详情</button>}<strong>{focus?requirement!.title:'项目交付依赖'}</strong></div>
    <div className="button-row">{editing&&focus&&manager&&<button className="ghost-button" onClick={()=>openPanel('import')}>引入外部交付</button>}{focus&&canEdit&&!req?.dependenciesReviewedAt&&<button className="ghost-button" onClick={()=>guarded(()=>setEditor({kind:'review'}))}>核对依赖</button>}<button className="ghost-button" onClick={()=>openPanel('relations')}>关系</button>
      {draft.active?<><span className="draft-badge">{draft.count} 项未保存</span><button className="ghost-button" disabled={!draft.canUndo||!!draft.pending||draft.busy} onClick={draft.undo}>撤销</button><button className="ghost-button" disabled={!draft.canRedo||!!draft.pending||draft.busy} onClick={draft.redo}>重做</button>
        <button className="primary-button" disabled={draft.busy||!draft.pending&&(!draft.preview||draft.conflict)} onClick={()=>void draft.save()}>{draft.busy?'保存中…':draft.pending?'查询回执并重试':'保存修改'}</button>
        <button className="ghost-button" disabled={!!draft.pending||draft.busy} onClick={()=>draft.count?setConfirmDiscard(true):draft.cancel()}>取消编辑</button></>:
        (canEdit||canEstimate)&&<button className="primary-button" onClick={draft.begin}>{canEdit?'编辑关系':'编辑预测'}</button>}
    </div></div>
    <div className="graph-toolbar-row graph-delivery-summary">{focus?<select aria-label="分析目标" value={target} onChange={e=>setParam('target',e.target.value)}>
      <option value={acceptanceId(focus)}>本需求验收</option><option value="project">项目交付</option>
      {target!=='project'&&target!==acceptanceId(focus)&&!data.nodes.some(n=>n.id===target&&n.requirementId===focus&&n.milestoneLabel)&&<option value={target}>{data.targetLabel}</option>}
      {data.nodes.filter(n=>n.requirementId===focus&&n.milestoneLabel).map(n=><option key={n.id} value={n.id}>{n.milestoneLabel}</option>)}</select>:<span>{data.targetLabel}</span>}
      <span>{draft.count?'未保存预览':'正式分析'} · {draft.previewing?'计算中…':draft.count&&!draft.preview?'等待有效预览':'预计 '+(data.forecastEnd||'待确认')}</span>
      <span>目标 {data.targetDate||'未设日期'} · {draft.count&&!draft.preview?'余量待预览':data.deadlineSlack===null?'余量待确认':'余量 '+data.deadlineSlack+' 天'}</span>
      <button className="ghost-button" onClick={()=>openPanel('summary')}>分析说明</button>
    </div>
    <div className="graph-status-slot" role="status">
      {branch?<><span>聚焦 {graph.cards.find(c=>c.id===branch)?.title||'已移除节点'} · 强调 {emphasizedIds.length}／{visibleIds.length} 项</span><button className="ghost-button" onClick={()=>setParam('pathBranch','')}>退出聚焦</button></>:<span>{(location.state as {pathNotice?:string}|null)?.pathNotice|| (editing&&canEdit?'从连接点拖到目标卡片建立前置关系。':'选择只更新详情；定位才移动视口。')}</span>}
      {(issue||draft.error||draft.conflict)&&<button className="ghost-button danger-text" onClick={()=>openPanel('changes')}>{draft.conflict?'版本冲突':issue?.message||draft.error?.message} · 查看修改</button>}
    </div>
  </>;
  const detail=inspector?<><div className="graph-panel-heading"><h3>{selectedRelation?'关系详情':selectedEdge?'交付关系':selectedCard?.title||'选择节点或连线'}</h3><button className="ghost-button" onClick={()=>setInspector(false)}>关闭</button></div>
    {selectedEdge||selectedRelation?<>{relationList(selectedRelation?[selectedRelation]:displayRelations)}
      {editing&&selectedRelation&&editableRelation(selectedRelation)&&<PredecessorPicker label="改接前置（选择后替换）" value={[]} options={graph.cards.filter(c=>c.kind!=='start').map(c=>({id:c.id,title:c.title}))} onChange={ids=>{
        const source=ids.at(-1);if(!source)return;const destination=focus?selectedRelation.targetWorkItemId||startId(selectedRelation.targetRequirementId):selectedRelation.targetRequirementId;
        if(!focus&&(selectedRelation.sourceWorkItemId||selectedRelation.targetWorkItemId)){directTo(selectedRelation.targetRequirementId,selectedRelation.targetWorkItemId);return;}
        const edge=proposal(source,destination)!;const next=remove(selectedRelation.id);next.add.push(edge);
        const problem=dependencyIssue(formal,next);if(problem)setIssue(problem);else{draft.change(next);setRelationId(edge.clientId);setEdgeId('');}
      }}/>}
    </>:selectedCard&&<><p>{selectedCard.subtitle}</p><p>{data.risks[selectedCard.requirementId]?.riskReason}</p><p>{node?.source}</p>{node?.unknownReasons.length?<p className="danger-text">{node.unknownReasons.join('；')}</p>:null}
      {branch&&!emphasized.has(selected)&&<p className="graph-outside-notice">此节点在分支外，定位后返回全图。</p>}
      <div className="button-row"><button className="ghost-button" onClick={()=>locateNode(selected)}>定位</button><button className="ghost-button" onClick={()=>setParam('pathBranch',branch===selected?'':selected)}>{branch===selected?'退出聚焦':branch?'聚焦此分支':'聚焦分支'}</button>
        {(!focus||selectedCard.external)&&<button className="primary-button" onClick={()=>directTo(selectedCard.requirementId,selectedCard.workItemId)}>进入需求路径</button>}
        {focus&&node?.workItemId&&node.requirementId===focus&&<button className="ghost-button" onClick={()=>guarded(()=>{const p=new URLSearchParams(params);p.delete('view');p.set('workItemId',node.id);setParams(p,{state:location.state});})}>定位并处理工作项</button>}
      </div>
      {editing&&canEstimate&&node&&<EstimateFields key={node.id} node={node} structure={canEdit} onChange={patch=>{
        const existing=draft.changes.estimates.find(p=>p.workItemId===patch.workItemId);
        draft.change({...draft.changes,estimates:[...draft.changes.estimates.filter(p=>p.workItemId!==patch.workItemId),{...existing,...patch}]});
      }}/>}
      {editing&&canEdit&&!['acceptance'].includes(selectedCard.kind)&&<details className="graph-more-relations"><summary>更多关系操作</summary><PredecessorPicker label={focus?'前置工作项':'前置需求'} value={data.dependencies.filter(d=>focus?(d.targetWorkItemId||startId(d.targetRequirementId))===selected:!d.sourceWorkItemId&&!d.targetWorkItemId&&d.targetRequirementId===selected).map(d=>focus?d.sourceWorkItemId||acceptanceId(d.sourceRequirementId):d.sourceRequirementId)}
        options={graph.cards.filter(c=>c.id!==selected&&c.kind!=='start'&&(manager||c.requirementId===focus)).map(c=>({id:c.id,title:c.title}))}
        onChange={ids=>{
          const current=data.dependencies.filter(d=>focus?(d.targetWorkItemId||startId(d.targetRequirementId))===selected:!d.sourceWorkItemId&&!d.targetWorkItemId&&d.targetRequirementId===selected);
          let next=draft.changes;
          for(const d of current)if(!ids.includes(focus?d.sourceWorkItemId||acceptanceId(d.sourceRequirementId):d.sourceRequirementId)&&editableRelation(d))next=remove(d.id,next);
          const existing=current.map(d=>focus?d.sourceWorkItemId||acceptanceId(d.sourceRequirementId):d.sourceRequirementId);
          next={...next,add:[...next.add,...ids.filter(id=>!existing.includes(id)).map(id=>proposal(id,selected)!)]};
          const problem=dependencyIssue(formal,next);if(problem)setIssue(problem);else{draft.change(next);setIssue(undefined);}
        }}/></details>}
      {node?.kind==='acceptance'&&node.requirementId===focus&&manager&&<button className="ghost-button" onClick={()=>guarded(()=>setEditor({kind:'acceptance'}))}>预计验收日期</button>}
    </>}
  </>:undefined;
  const auxiliary=panel?<><div className="graph-panel-heading"><h3>{{filters:'筛选条件',nodes:'节点列表',blockers:'阻塞源排行',float:'余量分布',relations:'关系明细',import:'引入外部工作项',summary:'分析说明',schedule:'交付排期预览',changes:'修改与冲突'}[panel]}</h3><button className="ghost-button" onClick={()=>setPanel('')}>关闭</button></div>
    {(panel==='nodes'||panel==='filters')&&nodesPanel}
    {panel==='blockers'&&<>{!data.blockers.length&&<p>当前没有阻塞源。</p>}{data.blockers.map(b=><div className="graph-list-row" key={b.nodeId}><button onClick={()=>{if(!focus)select(b.requirementId);else if(graph.cards.some(c=>c.id===b.nodeId))select(b.nodeId);else directTo(b.requirementId,b.workItemId);}}><strong>{b.title}</strong><small>{b.reasons.join('；')} · {b.ownerName||'未分派'}</small><small>{b.affectedRequirementIds.length} 个下游需求{b.critical?' · 关键阻塞':''}</small><span className="path-impact-bar"><i style={{width:Math.min(100,b.affectedRequirementIds.length/Math.max(1,data.coverage.total)*100)+'%'}}/></span></button></div>)}</>}
    {panel==='float'&&<><div className="path-float-distribution">{[{id:'critical',label:'0 天'},{id:'near',label:'1—2 天'},{id:'other',label:'大于 2 天'},{id:'unknown',label:'待确认'}].map(b=><button key={b.id} onClick={()=>setParam('pathFloat',params.get('pathFloat')===b.id?'':b.id)} className={params.get('pathFloat')===b.id?'selected':''}>{b.label}<strong>{graph.cards.filter(c=>b.id==='critical'?c.floatDays===0:b.id==='near'?c.floatDays!==null&&c.floatDays>0&&c.floatDays<=2:b.id==='other'?c.floatDays!==null&&c.floatDays>2:c.floatDays===null).length}</strong></button>)}</div>{nodesPanel}</>}
    {panel==='schedule'&&<><p>{draft.count?'未保存预览':'正式分析'} · 计划日期保持原值。进入需求后可预览并应用排期差异。</p>{sorted.map(c=><div className="graph-list-row" key={c.id}><button onClick={()=>directTo(c.requirementId)}><strong>{c.title}</strong><small>计划：{data.requirements.find(r=>r.id===c.requirementId)?.plannedEnd||'未排期'} · 预测：{c.forecast||'待确认'}</small></button></div>)}</>}
    {panel==='relations'&&relationList(displayRelations)}
    {panel==='import'&&<><input aria-label="搜索外部工作项" placeholder="搜索工作项或需求…" value={search} onChange={e=>setParam('pathSearch',e.target.value)}/>{data.nodes.filter(n=>n.kind==='work'&&n.requirementId!==focus&&(n.title+' '+data.requirements.find(r=>r.id===n.requirementId)?.title).toLowerCase().includes(search.toLowerCase())).map(n=><div className="graph-list-row" key={n.id}><button onClick={()=>{setImported(ids=>[...new Set([...ids,n.id])]);select(n.id);}}>{n.title}<small>{data.requirements.find(r=>r.id===n.requirementId)?.title}</small></button></div>)}<small>引入后连线建立部分交付关系，未连线的外部节点不会写入数据。</small></>}
    {panel==='summary'&&<><p>目标：{data.targetLabel}</p><p>业务日期：{data.asOfDate} · 版本 {formal.revision}</p><p>已核对 {data.coverage.reviewed}/{data.coverage.total} 个需求；{data.coverage.unplanned} 个待规划。</p><p>{data.complete?'预测覆盖当前目标。':'仍有待确认条件，交付日期与余量不完整。'}</p><p>图中关键路径按当前目标计算；风险标签采用项目目标。草稿仅用于预览，保存后才刷新正式风险和甘特。</p>{hasWorkdayCalendarFallback([data.forecastEnd,data.targetDate])&&<p>部分日期超出法定工作日日历覆盖范围，按周一至周五计算。</p>}<button className="ghost-button" onClick={()=>void onReload()}>刷新分析</button></>}
    {panel==='changes'&&<>{(issue||draft.error)&&<div role="alert" className="form-error">{issue?.message||draft.error?.message}<small>{issue?.nodeIds?.map(label).join(' → ')}</small><button className="ghost-button" disabled={draft.previewing||draft.conflict} onClick={draft.retryPreview}>重新预览</button></div>}<p>新增 {draft.changes.add.length} 条，移除 {draft.changes.remove.length} 条，估算 {draft.changes.estimates.length} 项。</p>
      {draft.changes.add.map(d=><p key={d.clientId}>新增：{label(d.sourceWorkItemId||acceptanceId(d.sourceRequirementId))} → {label(d.targetWorkItemId||startId(d.targetRequirementId))}</p>)}
      {draft.changes.remove.map(id=><p key={id}>移除：{formal.dependencies.find(d=>d.id===id)?relationLabel(formal.dependencies.find(d=>d.id===id)!):'该关系已被其他人移除'}</p>)}
      {draft.changes.estimates.map(e=><div key={e.workItemId}><strong>{label(e.workItemId)}</strong>{Object.entries(e).filter(([k])=>k!=='workItemId').map(([k,v])=><p key={k}>{{durationDays:'工期',earliestStart:'最早开始',unblockEstimate:'解阻',forecastEnd:'预测完成'}[k]}：{String(formal.nodes.find(n=>n.id===e.workItemId)?.estimate[k as keyof PathNode['estimate']]??'空')} → {String(v??'空')}</p>)}</div>)}
      {draft.conflict&&<><p>服务端版本 {formal.revision}，草稿基于 {draft.version}。</p><p>请核对上述修改与最新值。已删除的关系会从移除列表中剔除；其他修改按您填写的值重新预览。</p><button className="primary-button" onClick={draft.rebase}>已核对，按最新版本重新预览</button></>}
    </>}
  </>:undefined;
  return <div className="path-analysis immersive-path"><GraphWorkspace cards={graph.cards} links={graph.links} visibleIds={visibleIds} contextIds={contextIds} emphasizedIds={emphasizedIds} onExitFocus={()=>setParam('pathBranch','')} selected={selected} onSelect={select}
    reconnect={canReconnect?{id:reconnectRelation!.id,source:focus?reconnectRelation!.sourceWorkItemId||acceptanceId(reconnectRelation!.sourceRequirementId):reconnectRelation!.sourceRequirementId,target:focus?reconnectRelation!.targetWorkItemId||startId(reconnectRelation!.targetRequirementId):reconnectRelation!.targetRequirementId}:undefined}
    validateReconnect={validateReconnect} onReconnect={(source,destination)=>{const problem=validateReconnect(source,destination);if(problem)setIssue(problem);else{draft.change(reconnectChanges(source,destination));setRelationId('');setEdgeId('');}}}
    viewKey={(session.accountId||'guest')+':'+formal.projectId+':'+(focus||'all')} toolbar={toolbar} finder={finder} detail={detail} auxiliary={auxiliary} selectedEdge={edgeId}
    onEdgeSelect={id=>{setEdgeId(id);setRelationId('');setInspector(true);if(narrow())setPanel('');}} editing={editing&&canEdit} onConnect={connect} validateConnection={validate} onInvalid={setIssue}
    highlighted={search||params.get('pathFloat')?results.map(c=>c.id):[]} invalidNodes={(issue?.nodeIds||draft.issue?.nodeIds||[]).map(id=>focus?id:formal.nodes.find(n=>n.id===id)?.requirementId||id)} locate={locate} focusId={branch||''} onUndo={editing?draft.undo:undefined} onRedo={editing?draft.redo:undefined}
    footer={<><button className="ghost-button" onClick={()=>openPanel('blockers')}>阻塞 {data.blockers.length}</button><button className="ghost-button" onClick={()=>openPanel('float')}>余量</button>

      {!focus&&<button className="ghost-button" onClick={()=>openPanel('schedule')}>排期预览</button>}
      {focus&&manager&&<button className="ghost-button" onClick={()=>guarded(()=>setEditor({kind:'plan'}))}>排期预览</button>}

    </>}/>
    {editor&&<PathEditor editor={editor} data={formal} requirement={requirement} manager={manager} onClose={()=>setEditor(null)} onReload={onReload}/>}
    {(confirmDiscard||guard)&&<Modal title="处理未保存修改" width={460} onClose={()=>{setConfirmDiscard(false);setGuard(null);}}><p>当前草稿尚未保存。</p><div className="button-row">
      <button className="ghost-button" onClick={()=>{setConfirmDiscard(false);setGuard(null);}}>继续编辑</button><button className="ghost-button" disabled={!!draft.pending||draft.busy} onClick={()=>{draft.cancel();setConfirmDiscard(false);const action=guard;setGuard(null);action?.();}}>放弃草稿</button>
      {guard&&<button className="primary-button" disabled={draft.busy||!draft.pending&&!draft.preview} onClick={()=>void draft.save().then(saved=>{if(saved){const action=guard;setGuard(null);action?.();}})}>保存后继续</button>}
    </div></Modal>}
  </div>;
}
