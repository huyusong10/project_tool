import {useEffect,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {useNavigate} from 'react-router-dom';
import {api,isWriteOutcomeUnknown,jsonBody,requiresWriteRecheck} from '../api';
import {useSession} from '../app-context';
import {canManageProject} from '../permissions';
import {invalidateRequirementViews,keys} from '../query-keys';
import {assertCleanProjectDraft} from '../use-graph-draft';
import type {Requirement} from '../types';
import {Modal} from './Modal';

export function DeliveryControlsForId({id}:{id:string}){
  const query=useQuery({queryKey:keys.requirement(id),queryFn:()=>api<Requirement>('/api/requirements/'+id)});
  return query.data?<DeliveryControls requirement={query.data} compact/>:null;
}
function executionWarning(action:string,r:Requirement){
  const allowed:Record<string,string[]>={start:['not_started'],progress:['in_progress'],complete:['in_progress'],rework:['completed']};
  if(!allowed[action])return '';
  if(r.deletedAt||!allowed[action].includes(r.status))return '当前状态不支持此操作，请关闭窗口后重新选择；已填说明保留。';
  if(action!=='rework'&&r.executionMode!=='direct')return '需求已改为工作项分解，请操作对应工作项。';
  return '';
}
export function DeliveryControls({requirement:r}:{requirement:Requirement;compact?:boolean}){
  const {session}=useSession(),client=useQueryClient(),navigate=useNavigate();
  const manager=canManageProject(session,r.projectId),owner=manager||session.personId===r.ownerId;
  const [needsCheck,setNeedsCheck]=useState(false),[reading,setReading]=useState(false),[readError,setReadError]=useState('');
  const [modal,setModal]=useState<{action:string;base:Requirement}|null>(null),[content,setContent]=useState(''),[percent,setPercent]=useState(r.progress),[selected,setSelected]=useState<string[]>([]);
  const readSequence=useRef(0);
  const submitting=useRef(false),unknownWrite=useRef<{version:number;versioned:boolean}|null>(null);
  const [reviewRequired,setReviewRequired]=useState(false);
  useEffect(()=>()=>{readSequence.current++;},[r.id]);
  const mutation=useMutation({mutationFn:async()=>{
    if(!modal)return;await assertCleanProjectDraft(session.accountId||'guest',r.projectId,{requirementId:r.id,action:modal.action});
    const b=modal.base,payload:Record<string,unknown>={expectedVersion:b.version};
    if(modal.action==='progress'){payload.content=content;payload.requirementPercent=percent;}
    else if(modal.action==='rework'){payload.reason=content;payload.progress=Math.min(percent,99);if(b.executionMode!=='direct')payload.workItemIds=selected;}
    else if(modal.action==='complete')payload.content=content;
    return api('/api/requirements/'+r.id+'/'+modal.action,{method:'POST',body:jsonBody(payload)});
  },onSuccess:()=>{readSequence.current++;invalidateRequirementViews(client,r.id);setModal(null);},onError:e=>{
    if(isWriteOutcomeUnknown(e)&&modal)unknownWrite.current={version:modal.base.version,versioned:true};
    if(requiresWriteRecheck(e))setNeedsCheck(true);
  },onSettled:()=>{submitting.current=false;}});
  const reload=async(action:string)=>{
    const sequence=++readSequence.current;setReading(true);setReadError('');
    try{
      const latest=await api<Requirement>('/api/requirements/'+r.id);
      if(sequence!==readSequence.current)return;
      // 说明记录不增加需求版本，不能凭版本未变认定未写入。
      const unknown=unknownWrite.current;
      setReviewRequired(Boolean(unknown&&(!unknown.versioned||latest.version!==unknown.version)));
      setModal({action,base:latest});setNeedsCheck(false);mutation.reset();invalidateRequirementViews(client,r.id);
    }catch(error){if(sequence===readSequence.current){setReadError(error instanceof Error?error.message:'读取失败，请重试');setNeedsCheck(true);}}
    finally{if(sequence===readSequence.current)setReading(false);}
  };
  const open=(action:string)=>{readSequence.current++;unknownWrite.current=null;setReviewRequired(false);setReading(false);setNeedsCheck(false);setReadError('');mutation.reset();setContent('');setSelected([]);setPercent(Math.min(r.progress,99));setModal({action,base:r});};
  const close=()=>{if(!submitting.current&&!mutation.isPending){readSequence.current++;setReading(false);setModal(null);}};
  const direct=r.executionMode==='direct',ended=['completed','cancelled'].includes(r.status);
  const labels:Record<string,string>={start:'开始需求',progress:'更新进度',complete:'完成需求',rework:'返工'};
  const warning=modal?executionWarning(modal.action,modal.base):'';
  return <>
    <div className="button-row delivery-controls">
      {direct&&owner&&!ended&&<>{r.status==='not_started'&&<button className="primary-button" onClick={()=>open('start')}>开始需求</button>}{r.status==='in_progress'&&<><button className="ghost-button" onClick={()=>open('progress')}>更新进度</button><button className="primary-button" onClick={()=>open('complete')}>完成需求</button></>}</>}
      {owner&&r.status==='completed'&&<button className="ghost-button" onClick={()=>open('rework')}>返工</button>}
    </div>
    {modal&&<Modal title={labels[modal.action]} onClose={close} closable={!mutation.isPending}><form onSubmit={e=>{e.preventDefault();if(!submitting.current&&!mutation.isPending&&!needsCheck&&!reading&&!reviewRequired&&!warning){submitting.current=true;mutation.mutate();}}}><fieldset className="form-fieldset" disabled={mutation.isPending}>
      <p>{modal.base.title}</p>
      {['progress','rework'].includes(modal.action)&&modal.base.executionMode==='direct'&&<label className="field"><span>完成度</span><input aria-label="需求完成度" type="number" min={modal.action==='progress'?modal.base.progress:0} max={99} required value={percent} onChange={e=>setPercent(Number(e.target.value))}/></label>}
      {modal.action==='rework'&&modal.base.executionMode!=='direct'&&modal.base.workItems.filter(w=>w.status==='completed').map(w=><label key={w.id} className="editor-person-check"><input type="checkbox" checked={selected.includes(w.id)} onChange={e=>setSelected(v=>e.target.checked?[...v,w.id]:v.filter(id=>id!==w.id))}/>{w.title}</label>)}
      {modal.action!=='start'&&<label className="field"><span>说明</span><textarea aria-label="执行说明" required={modal.action!=='complete'} value={content} onChange={e=>setContent(e.target.value)}/></label>}
      {mutation.error&&<p className="form-error">{mutation.error.message}{mutation.error.message.includes('草稿')&&<button type="button" className="ghost-button" onClick={()=>navigate('/requirements/'+r.id+'?view=path')}>查看路径草稿</button>}</p>}
      {needsCheck&&<div className="warning-banner">本次操作需要核对最新状态。已填说明保留。<button type="button" className="ghost-button" disabled={reading} onClick={()=>void reload(modal.action)}>读取最新状态</button></div>}{readError&&<p className="form-error">{readError}</p>}
      {warning&&<p className="warning-banner">{warning}</p>}
      {reviewRequired&&<p className="warning-banner">已读取最新状态，仍无法确认刚才的提交是否生效。请先核对进展记录；为避免重复写入，本窗口不再提交。已填说明保留，可复制后关闭窗口。</p>}
      <div className="form-actions"><button className="primary-button" disabled={mutation.isPending||needsCheck||reading||reviewRequired||!!warning}>{mutation.isPending?'正在提交…':labels[modal.action]}</button></div>
    </fieldset></form></Modal>}
  </>;
}
