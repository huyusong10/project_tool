import {useEffect,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {useNavigate} from 'react-router-dom';
import {api,jsonBody,requiresWriteRecheck} from '../api';
import {useSession} from '../app-context';
import {canManageProject} from '../permissions';
import {invalidateRequirementViews,keys} from '../query-keys';
import {assertCleanProjectDraft,useDependencyDraft} from '../use-graph-draft';
import {changeEntity} from '../editor-commands';
import type {Requirement,Person} from '../types';
import type {PathAnalysis} from '../../shared/paths';
import type {DeliveryImpact,DeliveryTargetChange} from '../../shared/delivery-impact';
import {Modal} from './Modal';

export function DeliveryControlsForId({id}:{id:string}){
  const query=useQuery({queryKey:keys.requirement(id),queryFn:()=>api<Requirement>('/api/requirements/'+id)});
  return query.data?<DeliveryControls requirement={query.data} compact/>:null;
}
export function DeliveryImpactTable({entries,target}:{entries:DeliveryImpact[];target?:DeliveryTargetChange}){
  const goal=target&&<p className="field-help">{target.after.label} · 目标 {target.before.date||'待确认'} → {target.after.date||'待确认'} · 预计 {target.before.complete?target.before.forecast||'待确认':'待确认'} → {target.after.complete?target.after.forecast||'待确认':'待确认'}</p>;
  if(!entries.length)return <>{goal}<p className="field-help">交付预测、范围和风险没有变化。</p></>;
  const risk:Record<string,string>={high:'高',medium:'中',low:'低',unknown:'待评估'};
  const scope:Record<string,string>={committed:'纳入交付',candidate:'候选',absent:'不在范围'};
  return <div className="delivery-impact-list">{goal}{entries.map(e=><div className="graph-list-row" key={e.requirementId}><strong>{e.title}</strong><small>{scope[e.beforeScope]} → {scope[e.afterScope]} · 预计 {e.beforeForecast||'待确认'} → {e.afterForecast||'待确认'}</small><small>优先级 {e.beforePriority||'—'} → {e.afterPriority||'—'} · 风险 {risk[e.beforeRisk]} → {risk[e.afterRisk]} · 缓冲 {e.beforeBuffer??'待确认'} → {e.afterBuffer??'待确认'}</small><small>{e.ownerName||'项目经理'} · {e.reasons.join('；')}</small>{e.outsideExecuting&&<small className="warning-text">范围外仍在执行，工作与关系保留</small>}{(!!e.beforeSources?.length||!!e.afterSources?.length)&&<small>阻塞来源：{e.beforeSources?.map(s=>s.title).join('、')||'无'} → {e.afterSources?.map(s=>s.title).join('、')||'无'}</small>}</div>)}</div>;
}
export function DeliveryControls({requirement:r,compact=false}:{requirement:Requirement;compact?:boolean}){
  const {session}=useSession(),client=useQueryClient(),navigate=useNavigate();
  const manager=canManageProject(session,r.projectId),owner=manager||session.personId===r.ownerId,acceptor=manager||r.acceptanceOwnerValid&&session.personId===r.acceptanceOwnerId;
  const [needsCheck,setNeedsCheck]=useState(false),[reading,setReading]=useState(false),[readError,setReadError]=useState('');
  const [modal,setModal]=useState<{action:string;base:Requirement}|null>(null),[content,setContent]=useState(''),[percent,setPercent]=useState(r.progress),[selected,setSelected]=useState<string[]>([]),[conditions,setConditions]=useState<{dependencyRevision:number;unmetPredecessors:Array<{id:string;title:string}>}|null>(null);
  const readSequence=useRef(0);
  useEffect(()=>()=>{readSequence.current++;},[r.id]);
  const mutation=useMutation({mutationFn:async()=>{
    if(!modal)return;await assertCleanProjectDraft(session.accountId||'guest',r.projectId);
    const b=modal.base,payload:Record<string,unknown>={expectedVersion:b.version};
    if(modal.action==='progress'){payload.content=content;payload.requirementPercent=percent;}
    else if(modal.action==='note')payload.content=content;
    else if(modal.action==='rework'){payload.reason=content;payload.progress=Math.min(percent,99);if(b.executionMode!=='direct')payload.workItemIds=selected;}
    else if(['accept','submit-acceptance'].includes(modal.action))payload.content=content;
    else if(modal.action==='block')payload.reason=content;
    else if(conditions){payload.expectedDependencyRevision=conditions.dependencyRevision;payload.reason=content||undefined;}
    return api('/api/requirements/'+r.id+'/'+(modal.action==='note'?'progress':modal.action),{method:'POST',body:jsonBody(payload)});
  },onSuccess:()=>{readSequence.current++;invalidateRequirementViews(client,r.id);setModal(null);setConditions(null);},onError:e=>{if(requiresWriteRecheck(e))setNeedsCheck(true);}});
  const reload=async(action:string)=>{
    const sequence=++readSequence.current;setReading(true);setReadError('');
    try{
      const [latest,nextConditions]=await Promise.all([
        api<Requirement>('/api/requirements/'+r.id),
        action==='start'?api<NonNullable<typeof conditions>>('/api/requirements/'+r.id+'/start-conditions'):Promise.resolve(null),
      ]);
      if(sequence!==readSequence.current)return;
      setModal({action,base:latest});setConditions(nextConditions);setNeedsCheck(false);mutation.reset();invalidateRequirementViews(client,r.id);
    }catch(error){if(sequence===readSequence.current){setReadError(error instanceof Error?error.message:'读取失败，请重试');setNeedsCheck(true);}}
    finally{if(sequence===readSequence.current)setReading(false);}
  };
  const open=(action:string)=>{readSequence.current++;setReading(false);setNeedsCheck(false);setReadError('');mutation.reset();setContent('');setSelected([]);setPercent(Math.min(r.progress,99));setConditions(null);setModal({action,base:r});if(action==='start')void reload(action);};
  const close=()=>{if(!mutation.isPending){readSequence.current++;setReading(false);setModal(null);}};
  const direct=r.executionMode==='direct',ended=['completed','cancelled'].includes(r.status);
  const labels:Record<string,string>={start:'开始需求',progress:'更新进度',note:'补充说明',block:'标记阻塞',unblock:'解除阻塞','submit-acceptance':'提交验收',accept:'确认验收',rework:'退回返工'};
  return <>
    <div className="button-row delivery-controls">
      {direct&&owner&&!ended&&<>{r.status==='not_started'&&<button disabled={r.deliveryScope==='candidate'} title={r.deliveryScope==='candidate'?'请项目经理先在交付设置中纳入交付':undefined} className="primary-button" onClick={()=>void open('start')}>开始需求</button>}{r.status==='in_progress'&&<button className="ghost-button" onClick={()=>void open('progress')}>更新进度</button>}{r.status==='in_progress'&&<><button className="ghost-button" onClick={()=>void open('block')}>标记阻塞</button><button className="primary-button" onClick={()=>void open('submit-acceptance')}>提交验收</button></>}{r.status==='blocked'&&<><button className="ghost-button" onClick={()=>void open('note')}>补充说明</button><button className="ghost-button" onClick={()=>void open('unblock')}>解除阻塞</button></>}{['not_started','in_progress'].includes(r.status)&&!compact&&<button className="ghost-button" onClick={()=>setModal({action:'split',base:r})}>拆分剩余工作</button>}</>}
      {acceptor&&r.status==='pending_acceptance'&&<button className="primary-button" onClick={()=>void open('accept')}>确认验收</button>}
      {acceptor&&['pending_acceptance','completed'].includes(r.status)&&<button className="ghost-button" onClick={()=>void open('rework')}>退回返工</button>}
      {manager&&!ended&&!compact&&<button className="ghost-button" onClick={()=>setModal({action:'settings',base:r})}>交付设置</button>}
    </div>
    {modal&&['split','settings'].includes(modal.action)&&<DeliveryDraftDialog requirements={[modal.base]} mode={modal.action as 'split'|'settings'} onClose={()=>setModal(null)}/>}
    {modal&&!['split','settings'].includes(modal.action)&&<Modal title={labels[modal.action]} onClose={close} closable={!mutation.isPending}><form onSubmit={e=>{e.preventDefault();if(!mutation.isPending&&!needsCheck&&!reading)mutation.mutate();}}><fieldset className="form-fieldset" disabled={mutation.isPending}>
      <p>{modal.base.title}</p>{modal.action==='accept'&&<><p>验收标准：{modal.base.acceptanceCriteria||'尚未填写，请在验收说明中写明核对结果'}</p><p>未达成里程碑：{modal.base.milestones?.filter(m=>!m.achievedAt&&!m.cancelled).map(m=>m.title).join('、')||'无'} · 未关闭问题：{modal.base.issueSummary?.active||0}</p></>}
      {conditions?.unmetPredecessors.length? <p className="warning-banner">仍未满足：{conditions.unmetPredecessors.map(p=>p.title).join('、')}。确认后提前开始，保留这些前置。</p>:null}
      {['progress','rework'].includes(modal.action)&&modal.base.executionMode==='direct'&&<label className="field"><span>完成度</span><input aria-label="需求完成度" type="number" min={modal.action==='progress'?modal.base.progress:0} max={99} required value={percent} onChange={e=>setPercent(Number(e.target.value))}/></label>}
      {modal.action==='note'&&<p className="field-help">需求处于阻塞状态，只能补充说明；解除阻塞后才能继续提高完成度。</p>}
      {modal.action==='rework'&&modal.base.executionMode!=='direct'&&modal.base.workItems.filter(w=>w.status==='completed').map(w=><label key={w.id} className="editor-person-check"><input type="checkbox" checked={selected.includes(w.id)} onChange={e=>setSelected(v=>e.target.checked?[...v,w.id]:v.filter(id=>id!==w.id))}/>{w.title}</label>)}
      {!['start','unblock'].includes(modal.action)&&<label className="field"><span>说明</span><textarea aria-label="执行说明" required value={content} onChange={e=>setContent(e.target.value)}/></label>}
      {mutation.error&&<p className="form-error">{mutation.error.message}{mutation.error.message.includes('草稿')&&<button type="button" className="ghost-button" onClick={()=>navigate('/requirements/'+r.id+'?view=path')}>查看路径草稿</button>}</p>}
      {needsCheck&&<div className="warning-banner">本次操作需要核对最新状态。已填说明保留。<button type="button" className="ghost-button" disabled={reading} onClick={()=>void reload(modal.action)}>读取最新状态</button></div>}{readError&&<p className="form-error">{readError}</p>}
      <div className="form-actions"><button className="primary-button" disabled={mutation.isPending||needsCheck||reading}>{mutation.isPending?'正在提交…':conditions?.unmetPredecessors.length?'确认可以开始':labels[modal.action]}</button></div>
    </fieldset></form></Modal>}
  </>;
}
export function DeliveryDraftDialog({requirements,mode,onClose}:{requirements:Requirement[];mode:'split'|'settings'|'scope';onClose:()=>void}){
  const projectId=requirements[0].projectId,query=useQuery({queryKey:[...keys.paths,projectId],queryFn:()=>api<PathAnalysis>('/api/projects/'+projectId+'/path-analysis')});
  return <Modal title={mode==='split'?'拆分剩余工作':mode==='scope'?'批量调整交付范围':'交付设置'} onClose={onClose}>{query.data?<DeliveryDraftForm data={query.data} requirements={requirements} mode={mode} onClose={onClose}/>:<p>{query.error?.message||'正在读取交付信息…'}</p>}</Modal>;
}
function DeliveryDraftForm({data,requirements,mode,onClose}:{data:PathAnalysis;requirements:Requirement[];mode:'split'|'settings'|'scope';onClose:()=>void}){
  const {session}=useSession(),navigate=useNavigate(),client=useQueryClient(),r=requirements[0];
  const draft=useDependencyDraft(session.accountId||'guest',data,'project',()=>invalidateRequirementViews(client));
  const [scope,setScope]=useState(r.deliveryScope||'committed'),[acceptor,setAcceptor]=useState(r.acceptanceOwnerId||''),[duration,setDuration]=useState(String(r.durationDays||'')),[forecast,setForecast]=useState(r.forecastEnd||''),[unblock,setUnblock]=useState(r.unblockEstimate||''),[reason,setReason]=useState(''),[names,setNames]=useState(''),[error,setError]=useState('');
  const people=useQuery({queryKey:[...keys.people,r.projectId],queryFn:()=>api<Person[]>('/api/people?projectId='+r.projectId)});
  const add=()=>{
    let next=draft.changes;
    if(mode==='split'){
      const titles=names.split('\n').map(v=>v.trim()).filter(Boolean);if(!titles.length){setError('请至少填写一个剩余工作项');return;}
      next=changeEntity(next,{entity:'requirement',op:'update',id:r.id,expectedVersion:r.version,data:{executionMode:'work_items',reason:reason||'拆分剩余工作'}});
      for(const title of titles)next=changeEntity(next,{entity:'work',op:'create',id:crypto.randomUUID(),requirementId:r.id,data:{title,ownerId:r.ownerId,durationDays:1,reason:reason||'拆分剩余工作'}});
    }else for(const value of requirements){
      if(scope==='candidate'&&value.deliveryScope!=='candidate'&&['in_progress','blocked','pending_acceptance'].includes(value.status)&&!reason.trim()){setError('撤出已执行需求时请填写原因');return;}
      next=changeEntity(next,{entity:'requirement',op:'update',id:value.id,expectedVersion:value.version,data:{deliveryScope:scope,reason:reason||undefined,...(mode==='settings'?{acceptanceOwnerId:acceptor||null,...(r.executionMode==='direct'?{durationDays:duration?Number(duration):null,forecastEnd:forecast||null,unblockEstimate:unblock||null}:{})}:{})}});
    }
    draft.begin();draft.change(next);onClose();navigate(mode==='scope'?'/paths':'/requirements/'+r.id+'?view=path');
  };
  return <form onSubmit={e=>{e.preventDefault();add();}}><fieldset className="form-fieldset" disabled={draft.loading||draft.readOnly||!!draft.pending||draft.busy}><p>加入项目共享草稿后预览，点击工作区保存才生效。已有草稿 {draft.count} 项。</p>
    {mode==='split'?<><p>已完成 {r.progress}% 保留为基线。每行填写一个剩余工作项，默认一个工作日，可在画布中调整。</p><textarea aria-label="剩余工作项" required rows={5} value={names} onChange={e=>setNames(e.target.value)}/></>:<label className="field"><span>交付范围</span><select aria-label="交付范围" value={scope} onChange={e=>setScope(e.target.value as 'committed'|'candidate')}><option value="committed">纳入交付</option><option value="candidate">候选</option></select></label>}
    {mode==='settings'&&<><label className="field"><span>验收人</span><select aria-label="验收人" value={acceptor} onChange={e=>setAcceptor(e.target.value)}><option value="">项目经理</option>{acceptor&&!people.data?.some(p=>p.id===acceptor)&&<option value={acceptor}>原验收人（需重新核对）</option>}{people.data?.filter(p=>p.active&&p.accountStatus==='active'&&p.projectRole!=='viewer').map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{r.executionMode==='direct'&&<><label className="field"><span>预计工期（工作日）</span><input type="number" min={1} max={3660} value={duration} onChange={e=>setDuration(e.target.value)}/></label><label className="field"><span>预计执行完成</span><input type="date" value={forecast} onChange={e=>setForecast(e.target.value)}/></label><label className="field"><span>预计解除阻塞</span><input type="date" value={unblock} onChange={e=>setUnblock(e.target.value)}/></label></>}</>}
    <label className="field"><span>变更说明</span><textarea value={reason} onChange={e=>setReason(e.target.value)}/></label>{(error||draft.storageError)&&<p className="form-error">{error||draft.storageError}</p>}<div className="form-actions"><button className="primary-button">加入草稿并预览</button></div>
  </fieldset></form>;
}
