import {useResourceQuery} from '../use-resource-query';
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, InvalidResponseError, isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from '../api';
import { keys, invalidateRequirementViews } from '../query-keys';
import { useSession } from '../app-context';
import { Modal } from './Modal';
import { FormField, FormError } from './Form';
import type { Requirement } from '../types';
import type { IntakeCatalog } from '../../shared/intake';
import './requirement-intake.css';

export type OrganizationBatchRecheck={requirementIds:string[];groupId:string};
function intakeRecheckKey(kind:'group'|'organization',accountKey:string,projectId:string){return `project-manage:requirement-${kind}-recheck:${accountKey}:${projectId}`;}
export function readOrganizationBatchRecheck(accountKey:string,projectId:string):OrganizationBatchRecheck|null{
  try{const raw=sessionStorage.getItem(intakeRecheckKey('organization',accountKey,projectId));if(!raw)return null;const value=JSON.parse(raw) as Partial<OrganizationBatchRecheck>;return Array.isArray(value.requirementIds)&&value.requirementIds.length>0&&value.requirementIds.every(id=>typeof id==='string')&&typeof value.groupId==='string'?value as OrganizationBatchRecheck:null;}catch{return null;}
}
export function persistOrganizationBatchRecheck(accountKey:string,projectId:string,value:OrganizationBatchRecheck|null){try{const key=intakeRecheckKey('organization',accountKey,projectId);if(value)sessionStorage.setItem(key,JSON.stringify(value));else sessionStorage.removeItem(key);}catch{/* 当前页面仍保留核对锁。 */}}

export function useIntake(projectId:string) {
  const {session}=useSession();
  return useResourceQuery<IntakeCatalog>([...keys.intake,projectId,session.accountId],`/api/projects/${projectId}/requirement-intake`,!!projectId,value=>{if(!value||!Array.isArray(value.groups))throw new InvalidResponseError(200,false,'需求特性响应不完整');});
}
export function OrganizationFields({projectId,groupId,onChange}:{projectId:string;groupId?:string;onChange?:(key:'groupId',value:string)=>void}) {
  const query=useIntake(projectId);
  return <><FormField label="特性（可选）"><select aria-label="需求特性" name="groupId" value={groupId} onChange={e=>onChange?.('groupId',e.target.value)}><option value="">未归属</option>{groupId&&!query.data?.groups.some(g=>g.id===groupId)&&<option value={groupId}>原特性（待核对）</option>}{query.data?.groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></FormField>
    {query.error&&<p className="field-full warning-banner">特性读取失败，输入保留。<button type="button" className="ghost-button" onClick={()=>void query.refetch()}>重试</button></p>}</>;
}
export function OrganizationFilters({items,group,onGroup}:{items:Array<{groupId?:string|null;groupName?:string|null}>;group:string;onGroup:(v:string)=>void}) {
  const groups=[...new Map(items.filter(r=>r.groupId).map(r=>[r.groupId!,r.groupName||r.groupId!])).entries()];
  return <><select aria-label="特性筛选" value={group} onChange={e=>onGroup(e.target.value)}><option value="">全部特性</option><option value="ungrouped">未归属</option>{group&&group!=='ungrouped'&&!groups.some(([id])=>id===group)&&<option value={group}>原特性（已不可用）</option>}{groups.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></>;
}
export function matchesOrganization(item:{groupId?:string|null},group:string) {
  return (!group||(group==='ungrouped'?!item.groupId:item.groupId===group));
}
export function OrganizationBatchDialog({projectId,requirements,recheck,onRecheckChange,onClose}:{projectId:string;requirements:Requirement[];recheck:OrganizationBatchRecheck|null;onRecheckChange:(value:OrganizationBatchRecheck|null)=>void;onClose:()=>void}) {
  const client=useQueryClient(),query=useIntake(projectId);
  const [baseline,setBaseline]=useState(requirements),[reading,setReading]=useState(false),[readError,setReadError]=useState('');
  const refresh=async()=>{setReading(true);try{const latest=await Promise.all(baseline.map(r=>api<Requirement>('/api/requirements/'+r.id)));setBaseline(latest);setReadError('');const intakeResult=await query.refetch();return !intakeResult.error;}catch(e){setReadError(e instanceof Error?e.message:'读取失败');return false;}finally{setReading(false);}};
  const [groupId,setGroupId]=useState(recheck?.groupId||'keep');
  const unknown=Boolean(recheck),submitting=useRef(false);
  const mutation=useMutation({mutationFn:()=>api(`/api/projects/${projectId}/requirement-organization`,{method:'POST',body:jsonBody({requirements:baseline.map(r=>({id:r.id,expectedVersion:r.version})),...(groupId==='keep'?{}:{groupId:groupId||null})})}),onMutate:()=>onRecheckChange({requirementIds:baseline.map(r=>r.id),groupId}),onSuccess:()=>{onRecheckChange(null);invalidateRequirementViews(client);onClose();},onError:async error=>{if(!isWriteOutcomeUnknown(error))onRecheckChange(null);if(requiresWriteRecheck(error))await refresh();},onSettled:()=>{submitting.current=false;}});
  const save=()=>{if(submitting.current||unknown||reading||groupId==='keep')return;submitting.current=true;mutation.mutate();};
  const confirmRefresh=async()=>{if(!await refresh())return;onRecheckChange(null);mutation.reset();invalidateRequirementViews(client);onClose();};
  return <Modal title={`整理 ${requirements.length} 个需求`} onClose={onClose} closable={!mutation.isPending}><form onSubmit={e=>{e.preventDefault();save();}} className="intake-stack"><label className="field"><span>特性</span><select value={groupId} disabled={reading||mutation.isPending||unknown} onChange={e=>setGroupId(e.target.value)}><option value="keep">保持原特性</option><option value="">移入未归属</option>{query.data?.groups.map(g=><option value={g.id} key={g.id}>{g.name}</option>)}</select></label><FormError>{unknown?'整理结果待核对。本窗口不会重复提交；请读取最新需求后继续。':mutation.error?.message||readError}</FormError>{unknown?<button type="button" className="ghost-button" disabled={reading} onClick={()=>void confirmRefresh()}>{reading?'读取中…':'读取最新需求并继续'}</button>:mutation.error&&<button type="button" className="ghost-button" disabled={reading} onClick={()=>void refresh()}>读取最新需求并保留输入</button>}<button className="primary-button" disabled={reading||mutation.isPending||unknown||groupId==='keep'}>保存整理</button></form></Modal>;
}
