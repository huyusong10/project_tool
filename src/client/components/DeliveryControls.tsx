import { versionedWriteOutcome } from '../core/write-recheck';
import { readRecheck, persistRecheck } from '../core/write-recheck';
import * as requirementsApi from '../features/requirements/api';
import { useDeliveryForm } from '../use-delivery-form';
import { Button } from './Button';
import { Check, Play, RotateCcw } from 'lucide-react';
import { useAppNavigate } from '../use-app-navigation';
import { StartAssignmentDialog, type StartAssignment } from './StartAssignmentDialog';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from '../api';
import { useSession } from '../app-context';
import { canManageProject } from '../permissions';
import { invalidateRequirementViews, keys } from '../query-keys';
import { assertCleanProjectDraft } from '../use-graph-draft';
import type { Requirement } from '../types';
import { Modal } from './Modal';
import { useToast } from './Toast';

type DeliveryAction='start'|'progress'|'complete'|'rework';
type DeliveryRecheck={action:DeliveryAction;version:number;content:string;percent:number;selected:string[];stage:'read'|'review'};
const deliveryActions:DeliveryAction[]=['start','progress','complete','rework'];
function deliveryRecheckKey(accountKey:string,requirementId:string){return `project-manage:delivery-recheck:${accountKey}:${requirementId}`;}
function readDeliveryRecheck(accountKey:string,requirementId:string):DeliveryRecheck|null{
  return readRecheck(deliveryRecheckKey(accountKey,requirementId), stored => {
    
    const value=stored as Partial<DeliveryRecheck>;
    return deliveryActions.includes(value.action as DeliveryAction)&&typeof value.version==='number'&&typeof value.content==='string'
      &&typeof value.percent==='number'&&Array.isArray(value.selected)&&value.selected.every(id=>typeof id==='string')
      &&(value.stage==='read'||value.stage==='review')?value as DeliveryRecheck:null;
  
  });
}
function persistDeliveryRecheck(accountKey:string,requirementId:string,value:DeliveryRecheck|null){
  persistRecheck(deliveryRecheckKey(accountKey,requirementId), value);
}

export function DeliveryControlsForId({id}:{id:string}){
  const query=useQuery({queryKey:keys.requirement(id),queryFn:()=>requirementsApi.requirementsById<Requirement>(id)});
  return query.data?<DeliveryControls requirement={query.data} compact/>:null;
}
function executionWarning(action:string,r:Requirement){
  const allowed:Record<string,string[]>={start:['not_started'],progress:['in_progress'],complete:['in_progress'],rework:['completed']};
  if(!allowed[action])return '';
  if(r.deletedAt||!allowed[action].includes(r.status))return '当前状态不支持此操作，请关闭窗口后重新选择；已填说明保留。';
  if(action!=='rework'&&r.executionMode!=='direct')return '需求已改为工作项分解，请操作对应工作项。';
  return '';
}
export function DeliveryControls({requirement:r,children,progressContent}:{requirement:Requirement;compact?:boolean;progressContent?:ReactNode;children?:(controls:{progress:ReactNode;actions:ReactNode})=>ReactNode}){
  const {session}=useSession(),client=useQueryClient(),navigate=useAppNavigate(),toast=useToast();
  const manager=canManageProject(session,r.projectId),owner=manager||session.personId===r.ownerId;
  const recheckAccountKey=session.accountId||session.username||'guest';
  const [initialRecheck]=useState(()=>readDeliveryRecheck(recheckAccountKey,r.id));
  const [deliveryRecheck,setDeliveryRecheckState]=useState<DeliveryRecheck|null>(initialRecheck);
  const setDeliveryRecheck=(value:DeliveryRecheck|null)=>{persistDeliveryRecheck(recheckAccountKey,r.id,value);setDeliveryRecheckState(value);};
  const [needsCheck,setNeedsCheck]=useState(initialRecheck?.stage==='read'),[reading,setReading]=useState(false),[readError,setReadError]=useState('');
  const [input,setInput,clearInput]=useDeliveryForm(r.projectId,r.id+':execution-input',()=>({modal:null as {action:DeliveryAction;base:Requirement}|null,content:initialRecheck?.content||'',percent:initialRecheck?.percent??r.progress,selected:initialRecheck?.selected||[] as string[]}));
  const [modal,setModal]=useState(input.modal),[content,setContent]=useState(input.content),[percent,setPercent]=useState(input.percent),[selected,setSelected]=useState(input.selected);
  useEffect(()=>{if(modal)setInput({modal,content,percent,selected});},[modal,content,percent,selected,setInput]);
  const requirementRef=useRef(r);requirementRef.current=r;
  const readSequence=useRef(0);
  const submitting=useRef(false),unknownWrite=useRef<{version:number;versioned:boolean}|null>(initialRecheck?{version:initialRecheck.version,versioned:true}:null);
  const [reviewRequired,setReviewRequired]=useState(initialRecheck?.stage==='review');
  useEffect(()=>()=>{readSequence.current++;},[r.id]);
  useEffect(()=>{
    const next=readDeliveryRecheck(recheckAccountKey,r.id);setDeliveryRecheckState(next);
    unknownWrite.current=next?{version:next.version,versioned:true}:null;setNeedsCheck(next?.stage==='read');setReviewRequired(next?.stage==='review');
    if(next){setContent(next.content);setPercent(next.percent);setSelected(next.selected);setModal({action:next.action,base:requirementRef.current});}
  },[r.id,recheckAccountKey]);
  type ExecutionInput={assignment?:StartAssignment;action:DeliveryAction;base:Requirement;content:string;percent:number;selected:string[]};
  const mutation=useMutation({mutationFn:async(input:ExecutionInput)=>{
    await assertCleanProjectDraft(session.accountId||'guest',input.base.projectId,{requirementId:input.base.id,action:input.action});
    const payload:Record<string,unknown>={expectedVersion:input.base.version,...input.assignment};
    if(input.action==='progress'){payload.content=input.content;payload.requirementPercent=input.percent;}
    else if(input.action==='rework'){payload.reason=input.content;payload.progress=Math.min(input.percent,99);if(input.base.executionMode!=='direct')payload.workItemIds=input.selected;}
    else if(input.action==='complete')payload.content=input.content;
    return requirementsApi.requirementsById2(input.base.id, input.action, {method:'POST',body:jsonBody(payload)});
  },onMutate:input=>{const next:DeliveryRecheck={action:input.action,version:input.base.version,content:input.content,percent:input.percent,selected:input.selected,stage:'read'};unknownWrite.current={version:next.version,versioned:true};setDeliveryRecheck(next);},
  onSuccess:(_result,input)=>{clearInput();setContent('');setSelected([]);readSequence.current++;setDeliveryRecheck(null);unknownWrite.current=null;invalidateRequirementViews(client,input.base.id,'execution');setModal(null);setAssigning(false);toast.success({start:'需求已开始',progress:'完成度已更新',complete:'需求已完成',rework:'需求已重新打开'}[input.action]);},
  onError:(error,input)=>{
    if(!input.assignment)setModal({action:input.action,base:input.base});setContent(input.content);setPercent(input.percent);setSelected(input.selected);
    if(isWriteOutcomeUnknown(error)){unknownWrite.current={version:input.base.version,versioned:true};setDeliveryRecheck({action:input.action,version:input.base.version,content:input.content,percent:input.percent,selected:input.selected,stage:'read'});}else{unknownWrite.current=null;setDeliveryRecheck(null);}
    if(requiresWriteRecheck(error))setNeedsCheck(true);
  },onSettled:()=>{submitting.current=false;}});
  const submit=async(input:ExecutionInput)=>{if(submitting.current||mutation.isPending||needsCheck||reading||reviewRequired)return false;submitting.current=true;return mutation.mutateAsync(input).then(()=>true,()=>false);};
  const quick=(action:DeliveryAction)=>{if(deliveryRecheck)return;mutation.reset();submit({action,base:r,content:'',percent:Math.min(r.progress,99),selected:[]});};
  const reload=async(action:DeliveryAction)=>{
    const sequence=++readSequence.current;setReading(true);setReadError('');
    try{
      const latest=await requirementsApi.requirementsById<Requirement>(r.id);
      if(sequence!==readSequence.current)return;
      // 说明记录不增加需求版本，不能凭版本未变认定未写入。
      const unknown=unknownWrite.current;
      const requiresReview=Boolean(unknown&&(!unknown.versioned||versionedWriteOutcome(unknown.version,latest.version)==='conflict'));
      setReviewRequired(requiresReview);
      if(requiresReview&&deliveryRecheck)setDeliveryRecheck({...deliveryRecheck,stage:'review'});else setDeliveryRecheck(null);
      setModal({action,base:latest});setNeedsCheck(false);mutation.reset();invalidateRequirementViews(client,r.id,'execution');
    }catch(error){if(sequence===readSequence.current){setReadError(error instanceof Error?error.message:'读取失败，请重试');setNeedsCheck(true);}}
    finally{if(sequence===readSequence.current)setReading(false);}
  };
  const open=(action:DeliveryAction)=>{if(deliveryRecheck)return;if(input.modal?.action===action){setModal(input.modal);return;}readSequence.current++;unknownWrite.current=null;setReviewRequired(false);setReading(false);setNeedsCheck(false);setReadError('');mutation.reset();setContent('');setSelected([]);setPercent(Math.min(r.progress,99));setModal({action,base:r});};
  const resumeRecheck=()=>{if(!deliveryRecheck)return;readSequence.current++;unknownWrite.current={version:deliveryRecheck.version,versioned:true};setContent(deliveryRecheck.content);setPercent(deliveryRecheck.percent);setSelected(deliveryRecheck.selected);setNeedsCheck(deliveryRecheck.stage==='read');setReviewRequired(deliveryRecheck.stage==='review');setReadError('');mutation.reset();setModal({action:deliveryRecheck.action,base:r});};
  const finishReview=()=>{setDeliveryRecheck(null);unknownWrite.current=null;setReviewRequired(false);setModal(null);};
  const close=()=>{if(!submitting.current&&!mutation.isPending){readSequence.current++;setReading(false);setModal(null);}};
  const [assigning,setAssigning]=useState(false);
  const direct=r.executionMode==='direct',ended=['completed','cancelled'].includes(r.status);
  const labels:Record<string,string>={start:'开始需求',progress:'更新进度',complete:'完成需求',rework:'返工'};
  const warning=modal?executionWarning(modal.action,modal.base):'';
  const progress=children&&progressContent!==undefined
    ? direct&&owner&&r.status==='in_progress'&&!deliveryRecheck?<button type="button" className="work-progress-link" aria-label={'更新 '+r.title+' 进度'} disabled={mutation.isPending} onClick={()=>open('progress')}>{progressContent}</button>:progressContent
    : direct&&owner&&r.status==='in_progress'&&!deliveryRecheck?<Button variant={children ? "link" : "secondary"} className={children?'work-progress-link':'ghost-button'} aria-label={children?'更新 '+r.title+' 进度':'更新进度'} disabled={mutation.isPending} onClick={()=>open('progress')}>{children?r.progress+'%':'更新'}</Button>:children?<span>{r.status==='not_started'?'未开始':r.status==='completed'?'已完成':r.status==='cancelled'?'已取消':r.progress+'%'}</span>:null;
  const actions=deliveryRecheck&&!mutation.isPending?<Button variant="secondary" size="compact" width="action" className="ghost-button" aria-label="核对操作结果" title="核对操作结果" onClick={resumeRecheck}>核对</Button>:<>{direct&&owner&&!ended&&<>{r.status==='not_started'&&<Button variant="primary" size="compact" width="action" className="primary-button execution-action" aria-label="开始需求" title="开始需求" data-action="start" disabled={mutation.isPending} onClick={()=>!r.ownerId||r.ownerValid===false?setAssigning(true):quick('start')}><Play size={14}/>开始</Button>}{r.status==='in_progress'&&<Button variant="soft" tone="success" size="compact" width="action" className="primary-button execution-action" aria-label="完成需求" title="完成需求" data-action="complete" disabled={mutation.isPending} onClick={()=>quick('complete')}><Check size={14}/>完成</Button>}</>}{owner&&r.status==='completed'&&<Button variant="soft" tone="warning" size="compact" width="action" className="ghost-button execution-action" data-action="rework" disabled={mutation.isPending} onClick={()=>open('rework')}><RotateCcw size={14}/>返工</Button>}</>;
  return <>
    {children?children({progress,actions}):<div className="button-row delivery-controls">{progress}{actions}</div>}
    {assigning&&<StartAssignmentDialog requirement={r} pending={mutation.isPending} blocked={needsCheck||reviewRequired} recovery={(needsCheck||reviewRequired)&&<Button variant="secondary" type="button" className="ghost-button" onClick={()=>{setAssigning(false);if(deliveryRecheck)resumeRecheck();else setModal({action:"start",base:r});}}>读取并核对操作结果</Button>} error={mutation.error?.message} onClose={()=>setAssigning(false)} onStart={assignment=>submit({action:'start',base:r,assignment,content:'',percent:r.progress,selected:[]})}/>}
    {modal&&<Modal title={labels[modal.action]} onClose={close} closable={!mutation.isPending}><form onSubmit={e=>{e.preventDefault();if(!submitting.current&&!mutation.isPending&&!needsCheck&&!reading&&!reviewRequired&&!warning){submit({action:modal.action,base:modal.base,content,percent,selected});}}}><fieldset className="form-fieldset" disabled={mutation.isPending}>
      <p>{modal.base.title}</p>
      {['progress','rework'].includes(modal.action)&&modal.base.executionMode==='direct'&&<label className="field"><span>完成度</span><input aria-label="需求完成度" type="number" min={modal.action==='progress'?modal.base.progress:0} max={99} required value={percent} onChange={e=>setPercent(Number(e.target.value))}/></label>}
      {modal.action==='rework'&&modal.base.executionMode!=='direct'&&modal.base.workItems.filter(w=>w.status==='completed').map(w=><label key={w.id} className="editor-person-check"><input type="checkbox" checked={selected.includes(w.id)} onChange={e=>setSelected(v=>e.target.checked?[...v,w.id]:v.filter(id=>id!==w.id))}/>{w.title}</label>)}
      {modal.action!=='start'&&<label className="field"><span>说明（可选）</span><textarea aria-label="执行说明" value={content} onChange={e=>setContent(e.target.value)}/></label>}
      {mutation.error&&<p className="form-error">{mutation.error.message}{mutation.error.message.includes('草稿')&&<Button variant="secondary" type="button" className="ghost-button" onClick={()=>navigate('/requirements/'+r.id+'?view=path')}>查看路径草稿</Button>}</p>}
      {needsCheck&&<div className="warning-banner">本次操作需要核对最新状态。已填说明保留。<Button variant="secondary" type="button" className="ghost-button" disabled={reading} onClick={()=>void reload(modal.action)}>读取最新状态</Button></div>}{readError&&<p className="form-error">{readError}</p>}
      {warning&&<p className="warning-banner">{warning}</p>}
      {reviewRequired&&<div className="warning-banner">已读取最新状态，仍无法确认刚才的提交是否生效。请先核对进展记录；为避免重复写入，本窗口不再提交。已填说明保留。<Button variant="secondary" type="button" className="ghost-button" onClick={finishReview}>已核对并关闭</Button></div>}
      <div className="form-actions"><Button variant="secondary" type="button" disabled={mutation.isPending} onClick={()=>{clearInput();setInput({modal:null,content:"",percent:r.progress,selected:[]});setContent("");setPercent(r.progress);setSelected([]);close();}}>取消编辑</Button><Button variant="primary" type="submit" className="primary-button" disabled={mutation.isPending||needsCheck||reading||reviewRequired||!!warning}>{mutation.isPending?'正在提交…':labels[modal.action]}</Button></div>
    </fieldset></form></Modal>}
  </>;
}
