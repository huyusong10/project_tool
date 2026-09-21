import { readRecheck } from "../../core/write-recheck";

import { type ReferenceLink } from "../../../shared/reference-links";

import type { Feature } from "../../../shared/intake";
import { type FeaturePhase } from "../../../shared/feature-phases";
import type { Requirement } from "../../types";

import "../../components/phase-planning.css";

export type PhaseEdit = { requirementIds?:string[]; feature: Feature & {phases?:FeaturePhase[]}; phase?: FeaturePhase; stageKey?:string; mode: 'edit' | 'delete' | 'placement' | 'history' };

export type PhaseForm = { referenceLinks?:ReferenceLink[]; sortOrder?:number; name: string; scope: string; targetDate: string | null; note: string; reason: string };

export function rebasePhaseForm(draft:PhaseForm,previous:FeaturePhase,latest:FeaturePhase):PhaseForm {
  const base={...previous,referenceLinks:previous.referenceLinks||[]};
  const next={...latest,referenceLinks:latest.referenceLinks||[]};
  const merged={...draft};
  for(const field of ['name','scope','targetDate','note','sortOrder','referenceLinks'] as const){
    if(draft[field]===undefined||JSON.stringify(draft[field])===JSON.stringify(base[field]))Object.assign(merged,{[field]:next[field]});
  }
  return merged;
}

export type PendingPhase = { edit: PhaseEdit; value: PhaseForm; payload: Record<string, unknown>; selected?:Requirement[] };

export const pendingKey = (account: string, project: string) => 'pm-phase-write:' + account + ':' + project;

export function readPendingPhase(account: string, project: string): PendingPhase | null {
  return readRecheck(pendingKey(account, project), stored => { const value = stored as PendingPhase | null; return value?.edit.feature.projectId === project && value.payload && value.value ? value : null;
  });
}

export function nextPhaseName(phases:Array<Pick<FeaturePhase,'name'>>) {
  return 'Phase '+(Math.max(0,...phases.map(p=>Number(/^Phase\s+(\d+)(?=\D|$)/i.exec(p.name.trim())?.[1]||0)))+1);
}

export type PhaseDialogProps = { edit: PhaseEdit; onClose: () => void; onCreated?: (phase: FeaturePhase) => void };
