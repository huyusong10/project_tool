import {Select} from './Select';
import { migrateFeatureFields } from "../feature-storage-migration";
import type { FeaturePhase } from "../../shared/feature-phases";
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

export type OrganizationBatchRecheck={requirementIds:string[];featureId:string;reason?:string};
function intakeRecheckKey(kind:'feature'|'organization',accountKey:string,projectId:string){return `project-manage:requirement-${kind}-recheck:${accountKey}:${projectId}`;}
export function readOrganizationBatchRecheck(accountKey:string,projectId:string):OrganizationBatchRecheck|null{
  try{const raw=sessionStorage.getItem(intakeRecheckKey('organization',accountKey,projectId));if(!raw)return null;const value=migrateFeatureFields(JSON.parse(raw)) as Partial<OrganizationBatchRecheck>;return Array.isArray(value.requirementIds)&&value.requirementIds.length>0&&value.requirementIds.every(id=>typeof id==='string')&&typeof value.featureId==='string'?value as OrganizationBatchRecheck:null;}catch{return null;}
}
export function persistOrganizationBatchRecheck(accountKey:string,projectId:string,value:OrganizationBatchRecheck|null){try{const key=intakeRecheckKey('organization',accountKey,projectId);if(value)sessionStorage.setItem(key,JSON.stringify(value));else sessionStorage.removeItem(key);}catch{/* 当前页面仍保留核对锁。 */}}

export function useIntake(projectId:string) {
  const {session}=useSession();
  return useResourceQuery<IntakeCatalog>([...keys.intake,projectId,session.accountId],`/api/projects/${projectId}/requirement-intake`,!!projectId,value=>{if(!value||!Array.isArray(value.features))throw new InvalidResponseError(200,false,'需求特性响应不完整');});
}
export function OrganizationFields({projectId,featureId,phaseId,onChange}:{projectId:string;featureId?:string;phaseId?:string;onChange?:(key:'featureId'|'phaseId',value:string)=>void}) {
  const query=useIntake(projectId);
  const phases=useResourceQuery<FeaturePhase[]>(['feature-phases',projectId,featureId],'/api/projects/'+projectId+'/feature-phases?featureId='+featureId,!!featureId);
  return <><FormField label="特性"><Select aria-label="需求特性" name="featureId" value={featureId} onChange={e=>{onChange?.('featureId',e.target.value);}}><option value="">默认归入其他特性</option>{featureId&&!query.data?.features.some(g=>g.id===featureId)&&<option value={featureId}>原特性（待核对）</option>}{query.data?.features.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</Select></FormField>
    {featureId&&<FormField label="Phase（可选）"><Select aria-label="需求 Phase" name="phaseId" value={phaseId||""} onChange={e=>onChange?.("phaseId",e.target.value)}><option value="">未分派阶段</option>{phaseId&&!phases.data?.some(p=>p.id===phaseId)&&<option value={phaseId}>原 Phase（待核对）</option>}{phases.data?.filter(p=>p.featureId===featureId).map(p=><option key={p.id} value={p.id} disabled={!!p.deliveredAt&&p.id!==phaseId}>{p.name}{p.deliveredAt?" · 已交付":""}</option>)}</Select>{phases.error&&<small>Phase 读取失败，请刷新核对</small>}</FormField>}
    {query.error&&<p className="field-full warning-banner">特性读取失败，输入保留。<button type="button" className="ghost-button" onClick={()=>void query.refetch()}>重试</button></p>}</>;
}
export function OrganizationFilters({items,feature,onFeature}:{items:Array<{featureId?:string|null;featureName?:string|null}>;feature:string;onFeature:(v:string)=>void}) {
  const features=[...new Map(items.filter(r=>r.featureId).map(r=>[r.featureId!,r.featureName||r.featureId!])).entries()];
  return <><Select aria-label="特性筛选" value={feature} onChange={e=>onFeature(e.target.value)}><option value="">全部特性</option>{feature&&feature!=='unassigned'&&!features.some(([id])=>id===feature)&&<option value={feature}>原特性（已不可用）</option>}{features.map(([id,name])=><option key={id} value={id}>{name}</option>)}</Select></>;
}
export function matchesOrganization(item:{featureId?:string|null},feature:string) {
  return (!feature||(feature==='unassigned'?!item.featureId:item.featureId===feature));
}
export function OrganizationBatchDialog({projectId,requirements,recheck,onRecheckChange,onClose}:{projectId:string;requirements:Requirement[];recheck:OrganizationBatchRecheck|null;onRecheckChange:(value:OrganizationBatchRecheck|null)=>void;onClose:()=>void}) {
  const client=useQueryClient(),query=useIntake(projectId);
  const [baseline,setBaseline]=useState(requirements),[reading,setReading]=useState(false),[readError,setReadError]=useState('');
  const refresh=async()=>{setReading(true);try{const latest=await Promise.all(baseline.map(r=>api<Requirement>('/api/requirements/'+r.id)));setBaseline(latest);setReadError('');const intakeResult=await query.refetch();return !intakeResult.error;}catch(e){setReadError(e instanceof Error?e.message:'读取失败');return false;}finally{setReading(false);}};
  const [featureId,setFeatureId]=useState(recheck?.featureId||'keep'),[reason,setReason]=useState(recheck?.reason||'');
  const unknown=Boolean(recheck),submitting=useRef(false);
  const mutation=useMutation({mutationFn:()=>api(`/api/projects/${projectId}/requirement-placement`,{method:'POST',body:jsonBody({requirements:baseline.map(r=>({id:r.id,expectedVersion:r.version})),...(featureId==='keep'?{}:{featureId:featureId||null}),reason})}),onMutate:()=>onRecheckChange({requirementIds:baseline.map(r=>r.id),featureId,reason}),onSuccess:()=>{onRecheckChange(null);invalidateRequirementViews(client);onClose();},onError:async error=>{if(!isWriteOutcomeUnknown(error))onRecheckChange(null);if(requiresWriteRecheck(error))await refresh();},onSettled:()=>{submitting.current=false;}});
  const save=()=>{if(submitting.current||unknown||reading||featureId==='keep')return;submitting.current=true;mutation.mutate();};
  const confirmRefresh=async()=>{if(!await refresh())return;onRecheckChange(null);mutation.reset();invalidateRequirementViews(client);onClose();};
  return <Modal title={`整理 ${requirements.length} 个需求`} onClose={onClose} closable={!mutation.isPending}><form onSubmit={e=>{e.preventDefault();save();}} className="intake-stack"><label className="field"><span>特性</span><Select value={featureId} disabled={reading||mutation.isPending||unknown} onChange={e=>setFeatureId(e.target.value)}><option value="keep">保持原特性</option><option value="">归入其他特性</option>{query.data?.features.map(g=><option value={g.id} key={g.id}>{g.name}</option>)}</Select></label><label className="field"><span>调整原因</span><textarea value={reason} maxLength={2000} disabled={reading||mutation.isPending||unknown} onChange={e=>setReason(e.target.value)}/></label><FormError>{unknown?'整理结果待核对。本窗口不会重复提交；请读取最新需求后继续。':mutation.error?.message||readError}</FormError>{unknown?<button type="button" className="ghost-button" disabled={reading} onClick={()=>void confirmRefresh()}>{reading?'读取中…':'读取最新需求并继续'}</button>:mutation.error&&<button type="button" className="ghost-button" disabled={reading} onClick={()=>void refresh()}>读取最新需求并保留输入</button>}<button className="primary-button" disabled={reading||mutation.isPending||unknown||featureId==='keep'}>保存整理</button></form></Modal>;
}
