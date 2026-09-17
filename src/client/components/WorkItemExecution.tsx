import * as requirementsApi from '../features/requirements/api';
import * as workItemsApi from '../features/work-items/api';
import { useDeliveryForm } from '../use-delivery-form';
import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { jsonBody } from '../api';
import { useSession } from '../app-context';
import { workExecutionAccess } from '../permissions';
import { keys, invalidateRequirementViews } from '../query-keys';
import { cacheResourceUpdate } from '../use-resource-query';
import { assertCleanRequirementDraft } from '../use-graph-draft';
import { useWorkItemSave } from '../use-work-item-save';
import { persistWorkItemActionRecheck, readWorkItemActionRechecks, workItemRecheckEvent } from '../work-item-write-rechecks';
import type { Person, Requirement, WorkItem } from '../types';
import { WorkItemActions } from './WorkItemActions';
import { ProgressForm } from './ProgressForm';
import type { StartAssignment } from './StartAssignmentDialog';

export type ExecutionControls={progress:ReactNode;actions:ReactNode};

/** The inspector and Gantt use the same execution forms, versions and draft checks. */
export function WorkItemExecution({requirement:r,item,people,children,progressLabel,progressContent,extraMenu,presentation="compact"}:{requirement:Requirement;item:WorkItem;people:Person[];children:(controls:ExecutionControls)=>ReactNode;progressLabel?:string;progressContent?:ReactNode;extraMenu?:ReactNode;presentation?:"compact"|"detail"}){
  const {session}=useSession(),client=useQueryClient(),account=session.accountId||session.username||'guest';
  const [progressOpen,setProgressOpen]=useDeliveryForm(r.projectId,item.id+':progress-open',()=>false),[history,setHistory]=useState<Requirement|null>(null);
  const [needsCheck,setNeedsCheck]=useState(()=>readWorkItemActionRechecks(account).has(item.id));
  useEffect(()=>{setNeedsCheck(readWorkItemActionRechecks(account).has(item.id));setHistory(null);},[account,item.id]);
  useEffect(()=>{const sync=(e:Event)=>{const detail=(e as CustomEvent<{accountKey:string;id:string;required:boolean}>).detail;if(detail?.accountKey===account&&detail.id===item.id)setNeedsCheck(detail.required);};window.addEventListener(workItemRecheckEvent,sync);return()=>window.removeEventListener(workItemRecheckEvent,sync);},[account,item.id]);
  const access=workExecutionAccess(session,r,item,people),save=useWorkItemSave(r.id,people);
  const reload=async()=>{
    const latest=await requirementsApi.requirementsById<Requirement>(r.id);
    cacheResourceUpdate(client,keys.requirement(r.id),latest);setHistory(latest);return latest;
  };
  const action=useMutation({mutationFn:async(input:{action:string;content?:string;expectedVersion:number;expectedDependencyRevision?:number;assignment?:StartAssignment})=>{
    await assertCleanRequirementDraft(session.accountId||'guest',r.id,{workItemId:item.id,action:input.action});
    return workItemsApi.workItemsById2(item.id, input.action, {method:'POST',body:jsonBody({...input.assignment,expectedVersion:input.expectedVersion,expectedDependencyRevision:input.expectedDependencyRevision,...(input.action==='complete'?{content:input.content}:input.content?{reason:input.content}:{})})});
  },onSuccess:()=>invalidateRequirementViews(client,r.id)});
  const updates=(history?.progressUpdates||r.progressUpdates||[]).filter(u=>u.workItemId===item.id);
  const label=(access.progress&&progressLabel?progressLabel+' · '+item.progress+'%':null)||(({not_started:'未开始',completed:'已完成',cancelled:'已取消'} as Record<string,string>)[item.status]??item.progress+'%');
  const progressControl=access.progress?<button className="work-progress-link" disabled={needsCheck} title={needsCheck?'请先核对刚才的操作结果':'更新工作项进度'} aria-label={progressLabel||'更新 '+item.title+' 进度'} onClick={e=>{e.stopPropagation();setHistory(null);setProgressOpen(true);}}>{presentation==='detail'?item.progress+'%':progressContent??label}</button>:presentation==="detail"?null:<span>{progressContent??label}</span>;
  const progress=presentation==='detail'?<span className="work-execution-progress-slot">{progressControl}</span>:progressControl;
  const actions=access.operate?<WorkItemActions item={item} extraMenu={extraMenu} presentation={presentation}
    onAction={(next,content,expectedVersion,expectedDependencyRevision,assignment)=>action.mutateAsync({action:next,content,expectedVersion,expectedDependencyRevision,assignment})}
    onCancel={(reason,expectedVersion)=>action.mutateAsync({action:'cancel',content:reason,expectedVersion})}
    onSaveDates={access.manager?(dates,version)=>save(item,dates,version):undefined}
    onCompleteAsPlanned={access.manager&&!['completed','cancelled','pending_acceptance'].includes(r.status)?expectedVersion=>action.mutateAsync({action:'complete-as-planned',expectedVersion}):undefined}
    onReload={async()=>{const latest=await reload(),work=latest.workItems.find(w=>w.id===item.id);if(!work)throw Error('工作项已不存在，请关闭操作面板。');invalidateRequirementViews(client,r.id);return {item:work,updates:latest.progressUpdates?.filter(u=>u.workItemId===item.id)||[]};}}
    onOpenChange={open=>{if(open&&!history)void reload().catch(()=>{/* The action's reload control can retry; server checks all history before writing. */});}}
    hasExecutionHistory={!!item.actualStart||updates.some(u=>!['note','correction'].includes(u.eventType))} correctionCandidates={updates}
    canManage={access.manager||access.owner} stateChangesDisabled={r.status==='cancelled'} writeNeedsRecheck={needsCheck}
    onWriteNeedsRecheckChange={required=>{setNeedsCheck(required);persistWorkItemActionRecheck(account,item.id,required);}}/>:null;
  const scope=(current:Requirement)=>({items:current.workItems.filter(w=>workExecutionAccess(session,current,w,people).progress),updates:current.progressUpdates||[],requirementStatus:current.status});
  const progressRequirement=history&&history.version>=r.version&&(history.workItems.find(w=>w.id===item.id)?.version??-1)>=item.version?history:r;
  return <>{children({progress,actions})}{progressOpen&&<ProgressForm title="更新工作项进度" requirementId={r.id} fixedItemId={item.id} scope={scope(progressRequirement)} loadScope={async()=>scope(await reload())} contextLabel={r.projectName+' · '+r.title} onClose={()=>setProgressOpen(false)}/>}</>;
}
