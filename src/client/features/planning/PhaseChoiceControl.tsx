
import * as planningApi from "./api";

import { Button } from "../../components/Button";
import { Select } from "../../components/Select";
import { canManageProject } from "../../permissions";

import { readPendingPhase, type PhaseEdit } from './phase-model';

import type { FeaturePhase } from "../../../shared/feature-phases";
import { useResourceQuery } from "../../use-resource-query";
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useSession } from "../../app-context";

import { FormField } from "../../components/Form";

import "../../components/requirement-intake.css";

import { useIntake } from './use-intake';

export function PhaseChoiceControl({Editor,projectId,featureId,value,onChange,label='需求 Phase'}:{Editor: import('react').ComponentType<import('./phase-model').PhaseDialogProps>;projectId:string;featureId:string;value:string;onChange:(value:string)=>void;label?:string}) {
  const {session}=useSession(),client=useQueryClient(),catalog=useIntake(projectId);
  const phases=useResourceQuery<FeaturePhase[]>(['feature-phases',projectId,featureId],signal => planningApi.projectsFeaturePhasesQuery<FeaturePhase[]>(projectId, featureId, { signal }),!!featureId);
  const feature=catalog.data?.features.find(f=>f.id===featureId);
  const [edit,setEdit]=useState<PhaseEdit|null>(null);
  const canCreate=canManageProject(session,projectId)&&feature&&feature.kind!=='other'&&!feature.archivedAt&&!phases.unavailable&&!!phases.data;
  const create=()=>{if(canCreate)setEdit(readPendingPhase(session.accountId||'guest',projectId)?.edit||{feature:{...feature,phases:phases.data||[]},mode:'edit'});};
  return <>
    <FormField label="交付 Phase（可选）"><Select aria-label={label} name="phaseId" value={value} onChange={e=>e.target.value==='__create_phase__'?create():onChange(e.target.value)}>
      <option value="">未分派 Phase</option>{value&&!phases.data?.some(p=>p.id===value)&&<option value={value}>原 Phase（待核对）</option>}
      {phases.data?.map(p=><option key={p.id} value={p.id}>{p.name}{p.status==='completed'?' · 已完成':''}</option>)}
      {canCreate&&<option value="__create_phase__">新建 Phase…</option>}
    </Select>{phases.error&&<small>Phase 读取失败。<Button variant="link" type="button" onClick={()=>void phases.refetch()}>重新读取</Button></small>}
    {canCreate&&<Button variant="link" type="button" onClick={create}>新建 Phase…</Button>}</FormField>
    {edit&&<Editor edit={edit} onClose={()=>setEdit(null)} onCreated={phase=>{
      if(phase.featureId!==featureId)return;
      client.setQueryData<FeaturePhase[]>(['feature-phases',projectId,featureId],old=>[...(old||[]).filter(p=>p.id!==phase.id),phase]);
      onChange(phase.id);
    }}/>}
  </>;
}
