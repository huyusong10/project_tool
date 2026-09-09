import {DeliveryBatchReview} from './DeliveryBatchReview';
import {ProjectCommitmentControl} from './ProjectCommitments';
import {ExecutionReviewControl} from './ExecutionReview';
import {useEffect,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {useNavigate} from 'react-router-dom';
import {api,isWriteOutcomeUnknown,jsonBody,requiresWriteRecheck} from '../api';
import {useSession} from '../app-context';
import {canManageProject} from '../permissions';
import {invalidateRequirementViews,keys} from '../query-keys';
import {assertCleanProjectDraft,useDependencyDraft} from '../use-graph-draft';
import {changeEntity} from '../editor-commands';
import type {Requirement,Person} from '../types';
import type {PathAnalysis} from '../../shared/paths';

import {Modal} from './Modal';
import {RequirementCommandDialog} from './RequirementCommandDialog';
import {readResourceFresh} from '../use-resource-query';

export function DeliveryControlsForId({id}:{id:string}){
  const query=useQuery({queryKey:keys.requirement(id),queryFn:()=>api<Requirement>('/api/requirements/'+id)});
  return query.data?<DeliveryControls requirement={query.data} compact/>:null;
}
function executionWarning(action:string,r:Requirement){
  const allowed:Record<string,string[]>={start:['not_started'],progress:['in_progress'],note:['blocked'],block:['in_progress'],unblock:['blocked'],'submit-acceptance':['in_progress'],rework:['pending_acceptance','completed']};
  if(!allowed[action])return '';
  if(r.deletedAt||!allowed[action].includes(r.status))return '当前状态不支持此操作，请关闭窗口后重新选择；已填说明保留。';
  if(action!=='rework'&&r.executionMode!=='direct')return '需求已改为工作项分解，请操作对应工作项。';
  if(action==='start'&&r.deliveryScope==='candidate')return '请项目经理先将需求纳入交付。';
  return '';
}
export function DeliveryControls({requirement:r,compact=false}:{requirement:Requirement;compact?:boolean}){
  const {session}=useSession(),client=useQueryClient(),navigate=useNavigate();
  const manager=canManageProject(session,r.projectId),owner=manager||session.personId===r.ownerId,acceptor=manager||r.acceptanceOwnerValid&&session.personId===r.acceptanceOwnerId;
  const [needsCheck,setNeedsCheck]=useState(false),[reading,setReading]=useState(false),[readError,setReadError]=useState('');
  const [modal,setModal]=useState<{action:string;base:Requirement}|null>(null),[content,setContent]=useState(''),[percent,setPercent]=useState(r.progress),[selected,setSelected]=useState<string[]>([]),[conditions,setConditions]=useState<{dependencyRevision:number;unmetPredecessors:Array<{id:string;title:string}>}|null>(null);
  const readSequence=useRef(0);
  const submitting=useRef(false),unknownWrite=useRef<{version:number;versioned:boolean}|null>(null);
  const [reviewRequired,setReviewRequired]=useState(false);
  useEffect(()=>()=>{readSequence.current++;},[r.id]);
  const mutation=useMutation({mutationFn:async()=>{
    if(!modal)return;await assertCleanProjectDraft(session.accountId||'guest',r.projectId,{requirementId:r.id,action:modal.action});
    const b=modal.base,payload:Record<string,unknown>={expectedVersion:b.version};
    if(modal.action==='progress'){payload.content=content;payload.requirementPercent=percent;}
    else if(modal.action==='note')payload.content=content;
    else if(modal.action==='rework'){payload.reason=content;payload.progress=Math.min(percent,99);if(b.executionMode!=='direct')payload.workItemIds=selected;}
    else if(modal.action==='submit-acceptance')payload.content=content;
    else if(modal.action==='block')payload.reason=content;
    else if(conditions){payload.expectedDependencyRevision=conditions.dependencyRevision;payload.reason=content||undefined;}
    return api('/api/requirements/'+r.id+'/'+(modal.action==='note'?'progress':modal.action),{method:'POST',body:jsonBody(payload)});
  },onSuccess:()=>{readSequence.current++;invalidateRequirementViews(client,r.id);setModal(null);setConditions(null);},onError:e=>{
    if(isWriteOutcomeUnknown(e)&&modal)unknownWrite.current={version:modal.base.version,versioned:modal.action!=='note'};
    if(requiresWriteRecheck(e))setNeedsCheck(true);
  },onSettled:()=>{submitting.current=false;}});
  const reload=async(action:string)=>{
    const sequence=++readSequence.current;setReading(true);setReadError('');
    try{
      const [latest,nextConditions]=await Promise.all([
        api<Requirement>('/api/requirements/'+r.id),
        action==='start'?api<NonNullable<typeof conditions>>('/api/requirements/'+r.id+'/start-conditions'):Promise.resolve(null),
      ]);
      if(sequence!==readSequence.current)return;
      // 说明记录不增加需求版本，不能凭版本未变认定未写入。
      const unknown=unknownWrite.current;
      setReviewRequired(Boolean(unknown&&(!unknown.versioned||latest.version!==unknown.version)));
      setModal({action,base:latest});setConditions(nextConditions);setNeedsCheck(false);mutation.reset();invalidateRequirementViews(client,r.id);
    }catch(error){if(sequence===readSequence.current){setReadError(error instanceof Error?error.message:'读取失败，请重试');setNeedsCheck(true);}}
    finally{if(sequence===readSequence.current)setReading(false);}
  };
  const open=(action:string)=>{readSequence.current++;unknownWrite.current=null;setReviewRequired(false);setReading(false);setNeedsCheck(false);setReadError('');mutation.reset();setContent('');setSelected([]);setPercent(Math.min(r.progress,99));setConditions(null);setModal({action,base:r});if(action==='start')void reload(action);};
  const close=()=>{if(!submitting.current&&!mutation.isPending){readSequence.current++;setReading(false);setModal(null);}};
  const direct=r.executionMode==='direct',ended=['completed','cancelled'].includes(r.status);
  const labels:Record<string,string>={start:'开始需求',progress:'更新进度',note:'补充说明',block:'标记阻塞',unblock:'解除阻塞','submit-acceptance':'提交验收',accept:'确认验收',rework:'退回返工'};
  const warning=modal?executionWarning(modal.action,modal.base):'';
  return <>
    <div className="button-row delivery-controls">
      {direct&&<ExecutionReviewControl requirementId={r.id}/>}
      {direct&&owner&&!ended&&<>{r.status==='not_started'&&<button disabled={r.deliveryScope==='candidate'} title={r.deliveryScope==='candidate'?'请项目经理先在交付设置中纳入交付':undefined} className="primary-button" onClick={()=>void open('start')}>开始需求</button>}{r.status==='in_progress'&&<button className="ghost-button" onClick={()=>void open('progress')}>更新进度</button>}{r.status==='in_progress'&&<><button className="ghost-button" onClick={()=>void open('block')}>标记阻塞</button><button className="primary-button" onClick={()=>void open('submit-acceptance')}>提交验收</button></>}{r.status==='blocked'&&<><button className="ghost-button" onClick={()=>void open('note')}>补充说明</button><button className="ghost-button" onClick={()=>void open('unblock')}>解除阻塞</button></>}{['not_started','in_progress'].includes(r.status)&&!compact&&<button className="ghost-button" onClick={()=>setModal({action:'split',base:r})}>拆分剩余工作</button>}</>}
      {acceptor&&r.status==='pending_acceptance'&&<button className="primary-button" onClick={()=>void open('accept')}>确认验收</button>}
      {acceptor&&['pending_acceptance','completed'].includes(r.status)&&<button className="ghost-button" onClick={()=>void open('rework')}>退回返工</button>}
      {manager&&!ended&&!compact&&<button className="ghost-button" onClick={()=>setModal({action:'settings',base:r})}>交付设置</button>}
    </div>
    {modal&&['split','settings'].includes(modal.action)&&<DeliveryDraftDialog requirements={[modal.base]} mode={modal.action as 'split'|'settings'} onClose={()=>setModal(null)}/>}
    {modal?.action==='accept'&&<RequirementCommandDialog action="accept" requirement={r} onReload={()=>{
      const sequence=readSequence.current;
      return readResourceFresh<Requirement>(client,keys.requirement(r.id),'/api/requirements/'+r.id,()=>sequence===readSequence.current);
    }} onClose={close} onArchived={()=>{}}/>}
    {modal&&!['split','settings','accept'].includes(modal.action)&&<Modal title={labels[modal.action]} onClose={close} closable={!mutation.isPending}><form onSubmit={e=>{e.preventDefault();if(!submitting.current&&!mutation.isPending&&!needsCheck&&!reading&&!reviewRequired&&!warning){submitting.current=true;mutation.mutate();}}}><fieldset className="form-fieldset" disabled={mutation.isPending}>
      <p>{modal.base.title}</p>
      {conditions?.unmetPredecessors.length? <p className="warning-banner">仍未满足：{conditions.unmetPredecessors.map(p=>p.title).join('、')}。确认后提前开始，保留这些前置。</p>:null}
      {['progress','rework'].includes(modal.action)&&modal.base.executionMode==='direct'&&<label className="field"><span>完成度</span><input aria-label="需求完成度" type="number" min={modal.action==='progress'?modal.base.progress:0} max={99} required value={percent} onChange={e=>setPercent(Number(e.target.value))}/></label>}
      {modal.action==='note'&&<p className="field-help">需求处于阻塞状态，只能补充说明；解除阻塞后才能继续提高完成度。</p>}
      {modal.action==='rework'&&modal.base.executionMode!=='direct'&&modal.base.workItems.filter(w=>w.status==='completed').map(w=><label key={w.id} className="editor-person-check"><input type="checkbox" checked={selected.includes(w.id)} onChange={e=>setSelected(v=>e.target.checked?[...v,w.id]:v.filter(id=>id!==w.id))}/>{w.title}</label>)}
      {!['start','unblock'].includes(modal.action)&&<label className="field"><span>说明</span><textarea aria-label="执行说明" required value={content} onChange={e=>setContent(e.target.value)}/></label>}
      {mutation.error&&<p className="form-error">{mutation.error.message}{mutation.error.message.includes('草稿')&&<button type="button" className="ghost-button" onClick={()=>navigate('/requirements/'+r.id+'?view=path')}>查看路径草稿</button>}</p>}
      {needsCheck&&<div className="warning-banner">本次操作需要核对最新状态。已填说明保留。<button type="button" className="ghost-button" disabled={reading} onClick={()=>void reload(modal.action)}>读取最新状态</button></div>}{readError&&<p className="form-error">{readError}</p>}
      {warning&&<p className="warning-banner">{warning}</p>}
      {reviewRequired&&<p className="warning-banner">已读取最新状态，仍无法确认刚才的提交是否生效。请先核对进展记录；为避免重复写入，本窗口不再提交。已填说明保留，可复制后关闭窗口。</p>}
      <div className="form-actions"><button className="primary-button" disabled={mutation.isPending||needsCheck||reading||reviewRequired||!!warning}>{mutation.isPending?'正在提交…':conditions?.unmetPredecessors.length?'确认可以开始':labels[modal.action]}</button></div>
    </fieldset></form></Modal>}
  </>;
}
export function DeliveryDraftDialog({requirements,mode,onClose}:{requirements:Requirement[];mode:'split'|'settings'|'scope';onClose:()=>void}){
  const projectId=requirements[0].projectId,query=useQuery({queryKey:[...keys.paths,projectId],queryFn:()=>api<PathAnalysis>('/api/projects/'+projectId+'/path-analysis')});
  return <Modal title={mode==='split'?'拆分剩余工作':mode==='scope'?'批量调整交付范围':'交付设置'} onClose={onClose}>{query.data?<DeliveryDraftForm data={query.data} requirements={requirements} mode={mode} onClose={onClose}/>:<p>{query.error?.message||'正在读取交付信息…'}</p>}</Modal>;
}
function DeliveryDraftForm({data,requirements,mode,onClose}:{data:PathAnalysis;requirements:Requirement[];mode:'split'|'settings'|'scope';onClose:()=>void}){
  const {session}=useSession(),client=useQueryClient(),r=requirements[0];
  const draft=useDependencyDraft(session.accountId||'guest',data,'project',()=>invalidateRequirementViews(client));
  const [scope,setScope]=useState(r.deliveryScope||'committed'),[acceptor,setAcceptor]=useState(r.acceptanceOwnerId||''),[duration,setDuration]=useState(String(r.durationDays||'')),[forecast,setForecast]=useState(r.forecastEnd||''),[unblock,setUnblock]=useState(r.unblockEstimate||''),[reason,setReason]=useState(''),[names,setNames]=useState(''),[error,setError]=useState('');
  const [review,setReview]=useState(false);const initialized=useRef(false);
  useEffect(()=>{if(draft.loading||initialized.current)return;initialized.current=true;const existing=draft.changes.entities?.find(c=>c.id===r.id&&c.op==='update');const value={...r,...data.requirements.find(v=>v.id===r.id),...existing?.data};setScope(value.deliveryScope||'committed');setAcceptor(value.acceptanceOwnerId||'');setDuration(String(value.durationDays||''));setForecast(value.forecastEnd||'');setUnblock(value.unblockEstimate||'');},[draft.loading,draft.changes.entities,r,data.requirements]);
  const people=useQuery({queryKey:[...keys.people,r.projectId],queryFn:()=>api<Person[]>('/api/people?projectId='+r.projectId)});
  const joining=useRef(false);
  const add=async()=>{
    if(joining.current)return;
    let next=draft.changes;
    if(mode==='split'){
      const titles=names.split('\n').map(v=>v.trim()).filter(Boolean);if(!titles.length){setError('请至少填写一个剩余工作项');return;}
      next=changeEntity(next,{entity:'requirement',op:'update',id:r.id,expectedVersion:r.version,data:{executionMode:'work_items',reason:reason||'拆分剩余工作'}});
      for(const title of titles)next=changeEntity(next,{entity:'work',op:'create',id:crypto.randomUUID(),requirementId:r.id,data:{title,ownerId:r.ownerId,durationDays:1,reason:reason||'拆分剩余工作'}});
    }else for(const value of requirements){
      if(scope==='candidate'&&value.deliveryScope!=='candidate'&&['in_progress','blocked','pending_acceptance'].includes(value.status)&&!reason.trim()){setError('撤出已执行需求时请填写原因');return;}
      const original={...value,...data.requirements.find(r=>r.id===value.id),...next.entities?.find(c=>c.id===value.id)?.data};
      const desired={deliveryScope:scope,...(mode==='settings'?{acceptanceOwnerId:acceptor||null,...(r.executionMode==='direct'?{durationDays:duration?Number(duration):null,forecastEnd:forecast||null,unblockEstimate:unblock||null}:{})}:{})};
      const changed=Object.fromEntries(Object.entries(desired).filter(([key,v])=>JSON.stringify(v??null)!==JSON.stringify(original[key as keyof typeof original]??null)));
      if(Object.keys(changed).length)next=changeEntity(next,{entity:'requirement',op:'update',id:value.id,expectedVersion:value.version,data:{...changed,...(reason?{reason}:{})}});
    }
    if(!next.add.length&&!next.remove.length&&!next.estimates.length&&!next.entities?.length&&!next.layouts?.length&&!next.commitment){setError('没有需要保存的修改');return;}
    joining.current=true;draft.begin();draft.change(next);await draft.flush();joining.current=false;setReview(true);
  };
  if(review)return <DeliveryBatchReview draft={draft} data={data} onSaved={onClose}/>;
  return <form onSubmit={e=>{e.preventDefault();void add();}}><fieldset className="form-fieldset" disabled={draft.loading||draft.readOnly||!!draft.pending||draft.busy}><p>在本窗口预览并整批保存，无需跳转画布。已有草稿 {draft.count} 项。</p>
    {mode==='split'?<><p>已完成 {r.progress}% 保留为基线。每行填写一个剩余工作项，默认一个工作日，可在画布中调整。</p><textarea aria-label="剩余工作项" required rows={5} value={names} onChange={e=>setNames(e.target.value)}/></>:<label className="field"><span>交付范围</span><select aria-label="交付范围" value={scope} onChange={e=>setScope(e.target.value as 'committed'|'candidate')}><option value="committed">纳入交付</option><option value="candidate">候选</option></select></label>}
    {mode==='settings'&&<><label className="field"><span>验收人</span><select aria-label="验收人" value={acceptor} onChange={e=>setAcceptor(e.target.value)}><option value="">项目经理</option>{acceptor&&!people.data?.some(p=>p.id===acceptor)&&<option value={acceptor}>原验收人（需重新核对）</option>}{people.data?.filter(p=>p.active&&p.accountStatus==='active'&&p.projectRole!=='viewer').map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{r.executionMode==='direct'&&<><label className="field"><span>预计工期（工作日）</span><input type="number" min={1} max={3660} value={duration} onChange={e=>setDuration(e.target.value)}/></label><label className="field"><span>预计执行完成</span><input type="date" value={forecast} onChange={e=>setForecast(e.target.value)}/></label><label className="field"><span>预计解除阻塞</span><input type="date" value={unblock} onChange={e=>setUnblock(e.target.value)}/></label></>}</>}
    {mode==='settings'&&<ProjectCommitmentControl projectId={r.projectId}/>}
    <label className="field"><span>变更说明</span><textarea value={reason} onChange={e=>setReason(e.target.value)}/></label>{(error||draft.storageError)&&<p className="form-error">{error||draft.storageError}</p>}<div className="form-actions"><button className="primary-button">加入草稿并预览</button></div>
  </fieldset></form>;
}
