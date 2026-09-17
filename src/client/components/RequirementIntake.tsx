import { readRecheck, persistRecheck } from "../core/write-recheck";
import { PhaseDialog } from './PhasePlanning';
import * as planningApi from "../features/planning/api";
import * as requirementsApi from "../features/requirements/api";
import { Button } from "./Button";
import { Select } from "./Select";


import { migrateFeatureFields } from "../feature-storage-migration";

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from "../api";
import { invalidateRequirementViews } from "../query-keys";

import { Modal } from "./Modal";
import { FormField, FormError } from "./Form";
import type { Requirement } from "../types";

import "./requirement-intake.css";

import { useIntake } from '../features/planning/use-intake';
import { PhaseChoiceControl } from '../features/planning/PhaseChoiceControl';

export type OrganizationBatchRecheck={requirementIds:string[];featureId:string;reason?:string};

export function intakeRecheckKey(kind:'feature'|'organization',accountKey:string,projectId:string){return `project-manage:requirement-${kind}-recheck:${accountKey}:${projectId}`;}

export function readOrganizationBatchRecheck(accountKey:string,projectId:string):OrganizationBatchRecheck|null{
  return readRecheck(intakeRecheckKey('organization',accountKey,projectId), stored => {const value=migrateFeatureFields(stored) as Partial<OrganizationBatchRecheck>;return Array.isArray(value.requirementIds)&&value.requirementIds.length>0&&value.requirementIds.every(id=>typeof id==='string')&&typeof value.featureId==='string'?value as OrganizationBatchRecheck:null;
  });
}

export function persistOrganizationBatchRecheck(accountKey:string,projectId:string,value:OrganizationBatchRecheck|null){
  persistRecheck(intakeRecheckKey('organization',accountKey,projectId), value);
}

export function OrganizationFields({projectId,featureId,phaseId,onChange}:{projectId:string;featureId?:string;phaseId?:string;onChange?:(key:'featureId'|'phaseId',value:string)=>void}) {
  const query=useIntake(projectId);
  return <><FormField label="特性"><Select aria-label="需求特性" name="featureId" value={featureId} onChange={e=>onChange?.('featureId',e.target.value)}><option value="">默认归入其他需求</option>{featureId&&!query.data?.features.some(g=>g.id===featureId)&&<option value={featureId}>原特性（待核对）</option>}{query.data?.features.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</Select></FormField>
    {featureId&&query.data?.features.find(f=>f.id===featureId)?.kind!=='other'&&<PhaseChoice key={featureId} projectId={projectId} featureId={featureId} value={phaseId||''} onChange={value=>onChange?.('phaseId',value)}/>}
    {query.error&&<p className="field-full warning-banner">特性读取失败，输入保留。<Button variant="secondary" type="button" className="ghost-button" onClick={()=>void query.refetch()}>重试</Button></p>}</>;
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
  const refresh=async()=>{setReading(true);try{const latest=await Promise.all(baseline.map(r=>requirementsApi.requirementsById<Requirement>(r.id)));setBaseline(latest);setReadError('');const intakeResult=await query.refetch();return !intakeResult.error;}catch(e){setReadError(e instanceof Error?e.message:'读取失败');return false;}finally{setReading(false);}};
  const [featureId,setFeatureId]=useState(recheck?.featureId||'keep'),[reason,setReason]=useState(recheck?.reason||'');
  const unknown=Boolean(recheck),submitting=useRef(false);
  const mutation=useMutation({mutationFn:()=>planningApi.projectsRequirementPlacement(projectId, {method:'POST',body:jsonBody({requirements:baseline.map(r=>({id:r.id,expectedVersion:r.version})),...(featureId==='keep'?{}:{featureId:featureId||null}),reason})}),onMutate:()=>onRecheckChange({requirementIds:baseline.map(r=>r.id),featureId,reason}),onSuccess:()=>{onRecheckChange(null);invalidateRequirementViews(client);onClose();},onError:async error=>{if(!isWriteOutcomeUnknown(error))onRecheckChange(null);if(requiresWriteRecheck(error))await refresh();},onSettled:()=>{submitting.current=false;}});
  const save=()=>{if(submitting.current||unknown||reading||featureId==='keep')return;submitting.current=true;mutation.mutate();};
  const confirmRefresh=async()=>{if(!await refresh())return;onRecheckChange(null);mutation.reset();invalidateRequirementViews(client);onClose();};
  return <Modal title={`整理 ${requirements.length} 个需求`} onClose={onClose} closable={!mutation.isPending}><form onSubmit={e=>{e.preventDefault();save();}} className="intake-stack"><label className="field"><span>特性</span><Select value={featureId} disabled={reading||mutation.isPending||unknown} onChange={e=>setFeatureId(e.target.value)}><option value="keep">保持原特性</option><option value="">归入其他特性</option>{query.data?.features.map(g=><option value={g.id} key={g.id}>{g.name}</option>)}</Select></label><label className="field"><span>调整原因</span><textarea value={reason} maxLength={2000} disabled={reading||mutation.isPending||unknown} onChange={e=>setReason(e.target.value)}/></label><FormError>{unknown?'整理结果待核对。本窗口不会重复提交；请读取最新需求后继续。':mutation.error?.message||readError}</FormError>{unknown?<Button busy={(reading)} aria-label={reading?'读取中…':'读取最新需求并继续'} variant="secondary" type="button" className="ghost-button" disabled={reading} onClick={()=>void confirmRefresh()}>{'读取最新需求并继续'}</Button>:mutation.error&&<Button variant="secondary" type="button" className="ghost-button" disabled={reading} onClick={()=>void refresh()}>读取最新需求并保留输入</Button>}<Button variant="primary" type="submit" className="primary-button" disabled={reading||mutation.isPending||unknown||featureId==='keep'}>保存整理</Button></form></Modal>;
}

export { useIntake } from '../features/planning/use-intake';

export function PhaseChoice(props: Omit<import("react").ComponentProps<typeof PhaseChoiceControl>, "Editor">) { return <PhaseChoiceControl {...props} Editor={PhaseDialog}/>; }
