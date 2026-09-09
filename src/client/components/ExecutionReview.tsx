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
export function ExecutionReviewDialog({requirementId,workItemId,onClose}:{requirementId:string;workItemId?:string;onClose:()=>void}) {
  const req=useQuery({queryKey:keys.requirement(requirementId),queryFn:()=>api<Requirement>('/api/requirements/'+requirementId)});
  const graph=useQuery({queryKey:[...keys.paths,req.data?.projectId],queryFn:()=>api<PathAnalysis>('/api/projects/'+req.data!.projectId+'/path-analysis'),enabled:!!req.data});
  return <Modal title="预测依据与阻塞协调" width={680} onClose={onClose}>{req.data&&graph.data?<ReviewEditor key={workItemId||requirementId} requirement={req.data} workItemId={workItemId} data={graph.data} onClose={onClose}/>:<p>{req.error?.message||graph.error?.message||'正在读取…'}</p>}</Modal>;
}
function ReviewEditor({requirement:r,workItemId,data,onClose}:{requirement:Requirement;workItemId?:string;data:PathAnalysis;onClose:()=>void}) {
  const {session}=useSession(),client=useQueryClient(),work=r.workItems.find(w=>w.id===workItemId),value=work||r;
  const manager=canManageProject(session,r.projectId),editable=manager||session.personId===r.ownerId||!!work?.assigneeIds.includes(session.personId||'');
  const draft=useDependencyDraft(session.accountId||'guest',data,'project',()=>invalidateRequirementViews(client));
  const [review,setReview]=useState(false),[method,setMethod]=useState('remaining'),[remaining,setRemaining]=useState(''),[end,setEnd]=useState(''),[confirmEstimate,setConfirmEstimate]=useState(false);
  const [coordinator,setCoordinator]=useState(value.blockedCoordinatorId||''),[nextDate,setNextDate]=useState(value.blockedNextReviewAt||''),[issue,setIssue]=useState(value.blockedIssueId||''),[editCoordination,setEditCoordination]=useState(false);
  const initialized=useRef(false);useEffect(()=>{if(draft.loading||initialized.current)return;initialized.current=true;const entity=draft.changes.entities?.find(c=>c.id===value.id),estimate=work?draft.changes.estimates.find(p=>p.workItemId===work.id):undefined,review=estimate?.reviewForecast||entity?.data.reviewForecast;
    if(review){setConfirmEstimate(true);setMethod(review.remainingDays?'remaining':'date');setRemaining(String(review.remainingDays||''));setEnd(review.forecastEnd||'');}
    if(entity){const restored={...value,...entity.data};setCoordinator(restored.blockedCoordinatorId||'');setNextDate(restored.blockedNextReviewAt||'');setIssue(restored.blockedIssueId||'');setEditCoordination(['blockedCoordinatorId','blockedNextReviewAt','blockedIssueId'].some(k=>Object.hasOwn(entity.data,k)));}
  },[draft.loading,draft.changes,value,work]);
  const [issueSearch,setIssueSearch]=useState('');
  const people=useQuery({queryKey:[...keys.people,r.projectId],queryFn:()=>api<Person[]>('/api/people?projectId='+r.projectId),enabled:value.status==='blocked'});
  const issues=useQuery({queryKey:[...keys.issues,r.projectId,'coordination',issueSearch],queryFn:()=>api<IssuePage>('/api/issues?projectId='+r.projectId+'&pageSize=200&search='+encodeURIComponent(issueSearch)),enabled:value.status==='blocked'});
  const linked=issues.data?.items.find(i=>i.id===issue);
  const joining=useRef(false);
  if(workItemId&&!work)return <p role="alert">工作项已失效，请返回刷新后重新选择。</p>;
  if(review)return <DeliveryBatchReview draft={draft} data={data} onSaved={onClose}/>;
  return <><strong>{value.title}</strong><ForecastFacts basis={value.forecastBasis} coordination={value.blockerCoordination}/>
    {!work&&r.executionMode!=='direct'&&<p>此需求通过工作项推进，请在对应工作项核对估算。</p>}
    {editable&&!['completed','cancelled','pending_acceptance'].includes(value.status)&&(!!work||r.executionMode==='direct')&&<form onSubmit={async e=>{
      e.preventDefault();if(joining.current)return;let next=draft.changes;
      if(confirmEstimate){const reviewForecast=method==='remaining'?{remainingDays:Number(remaining)}:{forecastEnd:end};
        if(work)next={...next,estimates:[...next.estimates.filter(p=>p.workItemId!==work.id),{...next.estimates.find(p=>p.workItemId===work.id),workItemId:work.id,reviewForecast}]};
        else next=changeEntity(next,{entity:'requirement',op:'update',id:r.id,expectedVersion:r.version,data:{reviewForecast}});
      }
      if(editCoordination&&value.status==='blocked')next=changeEntity(next,{entity:work?'work':'requirement',op:'update',id:value.id,requirementId:work?r.id:undefined,expectedVersion:value.version,data:{blockedCoordinatorId:issue?null:coordinator||null,blockedNextReviewAt:issue?null:nextDate||null,blockedIssueId:issue||null}});
      joining.current=true;draft.begin();draft.change(next);await draft.flush();joining.current=false;setReview(true);
    }}><fieldset className="form-fieldset" disabled={draft.loading||draft.readOnly||draft.busy||!!draft.pending}>
      <label className="editor-person-check"><input type="checkbox" checked={confirmEstimate} onChange={e=>setConfirmEstimate(e.target.checked)}/>核对剩余工作，不修改完成度或已确认计划</label>
      {confirmEstimate&&<div className="form-grid"><label className="field"><span>核对方式</span><select value={method} onChange={e=>setMethod(e.target.value)}><option value="remaining">剩余工作日</option><option value="date">预计完成日期</option></select></label>{method==='remaining'?<label className="field"><span>剩余工作日</span><input type="number" required min={1} max={3660} value={remaining} onChange={e=>setRemaining(e.target.value)}/></label>:<label className="field"><span>预计完成日期</span><input type="date" required value={end} onChange={e=>setEnd(e.target.value)}/></label>}</div>}
      {value.status==='blocked'&&<><label className="editor-person-check"><input type="checkbox" checked={editCoordination} onChange={e=>setEditCoordination(e.target.checked)}/>修改阻塞协调安排</label>{editCoordination&&<>
        <label className="field"><span>搜索项目问题</span><input value={issueSearch} onChange={e=>setIssueSearch(e.target.value)}/></label><label className="field"><span>关联已有问题</span><select value={issue} onChange={e=>setIssue(e.target.value)}><option value="">不关联问题</option>{issue&&!linked&&<option value={issue}>当前关联问题</option>}{issues.data?.items.map(i=><option key={i.id} value={i.id}>{i.title}{i.status==='resolved'?'（已解决）':''}</option>)}</select></label>
        {issue?<p>沿用问题负责人 {linked?.ownerName||'项目经理'} · 下次核对 {linked?.nextReviewAt||'未设置'}。在问题页面修改跟进安排。</p>:<><label className="field"><span>协调人</span><select value={coordinator} onChange={e=>setCoordinator(e.target.value)}><option value="">执行负责人</option>{people.data?.filter(p=>p.active&&p.accountStatus==='active'&&p.projectRole!=='viewer').map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label className="field"><span>下次核对日期</span><input type="date" value={nextDate} onChange={e=>setNextDate(e.target.value)}/></label></>}
      </>}</>}
      {(people.error||issues.error)&&<p className="form-error">{people.error?.message||issues.error?.message}</p>}
      <div className="form-actions"><button className="primary-button" disabled={!confirmEstimate&&!editCoordination}>加入草稿并预览全部修改</button></div>
    </fieldset></form>}
  </>;
}
