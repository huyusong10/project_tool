import {useState,useEffect,useRef} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Link} from 'react-router-dom';
import {ClipboardCheck} from 'lucide-react';
import {api} from '../api';
import {useSession} from '../app-context';
import {canManageProject} from '../permissions';
import {keys,invalidateRequirementViews} from '../query-keys';
import {useDependencyDraft} from '../use-graph-draft';
import {changeEntity} from '../editor-commands';
import type {Requirement,Person,IssuePage} from '../types';
import type {PathAnalysis} from '../../shared/paths';
import type {ForecastBasis} from '../../shared/forecast-basis';
import type {BlockerCoordination} from '../../shared/blocker-coordination';
import {Modal} from './Modal';
import {saveDeliveryEdit} from '../save-delivery-edit';
import {DeliveryBatchReview} from './DeliveryBatchReview';
export function ForecastFacts({basis,coordination}:{basis?:ForecastBasis;coordination?:BlockerCoordination}) {
  return <dl className="forecast-facts">
    {basis&&<><div><dt>预测依据</dt><dd>{basis.source||'待确认'}</dd></div>{basis.review&&<div><dt>最近核对</dt><dd>{basis.review.confirmedName||basis.review.confirmedBy} · {new Date(basis.review.confirmedAt).toLocaleString()} · {basis.review.remainingDays!=null?`剩余 ${basis.review.remainingDays} 个工作日`:`预计 ${basis.review.forecastEnd||'待确认'}`}</dd></div>}{basis.reasons.length>0&&<div><dt>未决条件</dt><dd>{basis.reasons.join('；')}</dd></div>}<div><dt>人员并发</dt><dd>执行人另有 {basis.concurrentWorkCount} 项执行工作；数量提示不参与排期。{basis.concurrentWork?.length? <details><summary>查看执行工作{basis.concurrentWorkCount>10?'（前 10 项）':''}</summary><ul>{basis.concurrentWork.map(item=><li key={item.id}>{item.requirementId?<Link to={'/requirements/'+item.requirementId+(item.id.startsWith('execute:')?'':'?workItemId='+encodeURIComponent(item.id))}>{item.requirementTitle} · {item.title}</Link>:item.title} · 预计 {item.forecastEnd||'待确认'}{item.critical?' · 交付关键路径':''}</li>)}</ul></details>:null}</dd></div></>}
    {coordination&&<><div><dt>阻塞协调</dt><dd>{coordination.coordinatorName} · 下次核对 {coordination.nextReviewAt||'未设置'}</dd></div>{coordination.issueId&&<div><dt>关联问题</dt><dd><Link to={'/issues?issueId='+encodeURIComponent(coordination.issueId)}>{coordination.issueTitle}</Link>{coordination.issueResolved?' · 已解决，请执行人确认解阻':''}</dd></div>}</>}
  </dl>;
}
export function ExecutionReviewControl({requirementId,workItemId}:{requirementId:string;workItemId?:string}) {
  const [open,setOpen]=useState(false);
  return <><button type="button" className="ghost-button" title="预测依据与阻塞协调" aria-label="预测依据与阻塞协调" onClick={()=>setOpen(true)}><ClipboardCheck size={15}/></button>{open&&<ExecutionReviewDialog requirementId={requirementId} workItemId={workItemId} onClose={()=>setOpen(false)}/>}</>;
}
export function ExecutionReviewDialog({requirementId,workItemId,onClose,intent}:{requirementId:string;workItemId?:string;onClose:()=>void;intent?:'forecast'|'follow-up'}) {
  const req=useQuery({queryKey:keys.requirement(requirementId),queryFn:()=>api<Requirement>('/api/requirements/'+requirementId)});
  const graph=useQuery({queryKey:[...keys.paths,req.data?.projectId],queryFn:()=>api<PathAnalysis>('/api/projects/'+req.data!.projectId+'/path-analysis'),enabled:!!req.data});
  return <Modal title={intent==='follow-up'?'跟进阻塞':'核对预测'} width={680} onClose={onClose}>{req.data&&graph.data?<ReviewEditor key={workItemId||requirementId} requirement={req.data} workItemId={workItemId} data={graph.data} onClose={onClose} intent={intent}/>:<p>{req.error?.message||graph.error?.message||'正在读取…'}</p>}</Modal>;
}
function ReviewEditor({requirement,workItemId,data,onClose,intent}:{requirement:Requirement;workItemId?:string;data:PathAnalysis;onClose:()=>void;intent?:'forecast'|'follow-up'}) {
  const [r,setBaseline]=useState(requirement);
  const {session}=useSession(),client=useQueryClient(),work=r.workItems.find(w=>w.id===workItemId),value=work||r;
  const editable=canManageProject(session,r.projectId)||session.personId===r.ownerId||!!work?.assigneeIds.includes(session.personId||'');
  const blocked=value.status==='blocked',canForecast=editable&&!['completed','cancelled','pending_acceptance'].includes(value.status)&&(!!work||r.executionMode==='direct');
  const canFollow=blocked&&(editable||!!session.personId&&value.blockerCoordination?.coordinatorId===session.personId&&!value.blockedIssueId);
  const draft=useDependencyDraft(session.accountId||'guest',data,'project',()=>invalidateRequirementViews(client));
  const [review,setReview]=useState(false),[method,setMethod]=useState('remaining'),[remaining,setRemaining]=useState(''),[end,setEnd]=useState('');
  const [coordinator,setCoordinator]=useState(value.blockedCoordinatorId||''),[nextDate,setNextDate]=useState(value.blockedNextReviewAt||''),[issue,setIssue]=useState(value.blockedIssueId||''),[note,setNote]=useState('');
  const initialized=useRef(false);useEffect(()=>{if(draft.loading||initialized.current)return;initialized.current=true;const entity=draft.changes.entities?.find(c=>c.id===value.id),estimate=work?draft.changes.estimates.find(p=>p.workItemId===work.id):undefined,review=estimate?.reviewForecast||entity?.data.reviewForecast;
    if(review){setMethod(review.remainingDays?'remaining':'date');setRemaining(String(review.remainingDays||''));setEnd(review.forecastEnd||'');}
    if(entity){const restored={...value,...entity.data};setCoordinator(restored.blockedCoordinatorId||'');setNextDate(restored.blockedNextReviewAt||'');setIssue(restored.blockedIssueId||'');setNote(entity.data.reason||'');}
  },[draft.loading,draft.changes,value,work]);
  const [issueSearch,setIssueSearch]=useState('');
  const people=useQuery({queryKey:[...keys.people,r.projectId],queryFn:()=>api<Person[]>('/api/people?projectId='+r.projectId),enabled:blocked&&editable});
  const issues=useQuery({queryKey:[...keys.issues,r.projectId,'coordination',issueSearch],queryFn:()=>api<IssuePage>('/api/issues?projectId='+r.projectId+'&pageSize=200&search='+encodeURIComponent(issueSearch)),enabled:blocked&&editable});
  const linked=issues.data?.items.find(i=>i.id===issue),joining=useRef(false);
  const latestValue=workItemId?requirement.workItems.find(w=>w.id===workItemId):requirement;
  const stale=latestValue?.version!==value.version;
  const [staleSave,setStaleSave]=useState(false);
  const hasForecast=canForecast&&!!(method==='remaining'?remaining:end),hasCoordination=canFollow&&(!!note.trim()||coordinator!==(value.blockedCoordinatorId||'')||nextDate!==(value.blockedNextReviewAt||'')||issue!==(value.blockedIssueId||''));
  if(workItemId&&!work)return <p role="alert">工作项已失效，请返回刷新后重新选择。</p>;
  if(review||draft.pending)return <DeliveryBatchReview draft={draft} data={data} onSaved={onClose}/>;
  return <><strong>{value.title}</strong><details className="forecast-review-details"><summary>查看预测依据与当前跟进安排</summary><ForecastFacts basis={value.forecastBasis} coordination={value.blockerCoordination}/></details>
    {!work&&r.executionMode!=='direct'&&<p>请在对应工作项核对估算。</p>}
    {(canForecast||canFollow)&&<form onSubmit={async e=>{
      e.preventDefault();if(joining.current)return;if(stale){setStaleSave(true);return;}let next=draft.changes;
      if(hasForecast){const reviewForecast=method==='remaining'?{remainingDays:Number(remaining)}:{forecastEnd:end};
        if(work)next={...next,estimates:[...next.estimates.filter(p=>p.workItemId!==work.id),{...next.estimates.find(p=>p.workItemId===work.id),workItemId:work.id,reviewForecast}]};
        else next=changeEntity(next,{entity:'requirement',op:'update',id:r.id,expectedVersion:r.version,data:{reviewForecast}});
      }
      if(hasCoordination)next=changeEntity(next,{entity:work?'work':'requirement',op:'update',id:value.id,requirementId:work?r.id:undefined,expectedVersion:value.version,data:{...(editable?{blockedCoordinatorId:issue?null:coordinator||null,blockedIssueId:issue||null}:{}),blockedNextReviewAt:issue?null:nextDate||null,...(note.trim()?{reason:note.trim()}:{})}});
      joining.current=true;try{await saveDeliveryEdit(draft,next,r.id,()=>setReview(true),onClose);}finally{joining.current=false;}
    }}><fieldset className="form-fieldset" disabled={draft.loading||draft.readOnly||draft.busy||!!draft.pending}>
      {canForecast&&<div className="form-grid"><label className="field"><span>估算方式</span><select value={method} onChange={e=>setMethod(e.target.value)}><option value="remaining">还需几个工作日</option><option value="date">预计哪天完成</option></select></label>{method==='remaining'?<label className="field"><span>剩余工作日</span><input autoFocus={intent!=='follow-up'} type="number" min={1} max={3660} placeholder="不填则保留当前估算" value={remaining} onChange={e=>setRemaining(e.target.value)}/></label>:<label className="field"><span>预计完成日期</span><input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label>}</div>}
      {canForecast&&<p className="field-help">更新预测，完成度和已确认计划保持原值。</p>}
      {stale&&<div className="warning-banner" role={staleSave?'alert':undefined}>对象资料已更新，当前输入保留。最新工期 {latestValue?.durationDays||'待确认'} 个工作日，预计完成 {latestValue?.forecastEnd||'待确认'}，下次核对 {latestValue?.blockedNextReviewAt||'未设置'}。<button type="button" className="ghost-button" onClick={()=>{setBaseline(requirement);setStaleSave(false);}}>已核对，保留输入</button></div>}
      {canFollow&&<>{issue?<p>由问题负责人 {linked?.ownerName||value.blockerCoordination?.coordinatorName||'项目经理'} 跟进。<Link to={'/issues?issueId='+encodeURIComponent(issue)}>打开关联问题</Link></p>:<><label className="field"><span>跟进说明</span><textarea autoFocus={intent==='follow-up'} value={note} onChange={e=>setNote(e.target.value)} placeholder="记录本次协调结果（可选）"/></label><label className="field"><span>下次核对日期</span><input type="date" value={nextDate} onChange={e=>setNextDate(e.target.value)}/></label></>}
        {editable&&<details><summary>更换协调人或关联问题</summary><label className="field"><span>搜索项目问题</span><input value={issueSearch} onChange={e=>setIssueSearch(e.target.value)}/></label><label className="field"><span>关联已有问题</span><select value={issue} onChange={e=>setIssue(e.target.value)}><option value="">不关联问题</option>{issue&&!linked&&<option value={issue}>当前关联问题</option>}{issues.data?.items.map(i=><option key={i.id} value={i.id}>{i.title}{i.status==='resolved'?'（已解决）':''}</option>)}</select></label>{!issue&&<label className="field"><span>协调人</span><select value={coordinator} onChange={e=>setCoordinator(e.target.value)}><option value="">执行负责人</option>{people.data?.filter(p=>p.active&&p.accountStatus==='active'&&p.projectRole!=='viewer').map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>}</details>}
      </>}
      {(people.error||issues.error||draft.error||draft.storageError)&&<p role="alert" className="form-error">{people.error?.message||issues.error?.message||draft.error?.message||draft.storageError}</p>}
      {draft.readOnly&&<p>当前草稿由另一窗口编辑。请在原窗口保存，或接管草稿。</p>}
      <div className="form-actions">{draft.count>0&&<button type="button" className="ghost-button" onClick={()=>setReview(true)}>查看已有修改 {draft.count}</button>}<button className="primary-button" disabled={!hasForecast&&!hasCoordination}>{draft.busy?'正在保存…':'保存'}</button></div>
    </fieldset></form>}
  </>;
}
