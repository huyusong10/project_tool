import {referenceLinksInput,type ReferenceLink} from './reference-links';
import { z } from 'zod';
import type { ExecutionStage } from './execution-stage';

const id = z.string().trim().min(1), version = z.number().int().positive();
export const phaseDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !v.startsWith('0000-') && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, '日期无效');
export const phaseInput = z.object({ referenceLinks:referenceLinksInput.optional(), id: id.optional(), expectedVersion: version.optional(), name: z.string().trim().min(1).max(200), scope: z.string().trim().max(10000).optional(), targetDate: phaseDate.nullable().optional(), note: z.string().trim().max(2000).optional(), sortOrder: z.number().int().min(0).optional(), reason: z.string().trim().max(2000).optional() }).strict();
export const phaseCommand = z.object({ expectedVersion: version, reason: z.string().trim().max(2000).optional() }).strict();
export const phaseStatusLabels = { planning: '待规划', not_started: '未开始', in_progress: '进行中', completed: '已完成' } as const;
export type PhaseStatus = keyof typeof phaseStatusLabels;
export type ProgressFact = { status:string; progress?:number|null; progressWeight?:number|null };
export type PhaseRequirement = ProgressFact & { id: string; title: string; status: string; version: number; phaseId?: string | null; featureId?: string | null; actualStart?: string | null; actualEnd?: string | null; deletedAt?: string | null; acceptanceCriteria?: string | null; executionStage: ExecutionStage };
export type PhaseDelivery = { id: string; deliveredAt: string; deliveredByName: string | null; createdAt: string; reopenedAt: string | null; reopenReason: string | null; snapshot: { name: string; scope: string; targetDate: string | null; requirements: Array<{ id: string; title: string; acceptanceCriteria?: string | null; actualEnd?: string | null }> } };
export type FeaturePhase = { completion?:PhaseCompletion; actualStart?:string|null; observationEnd?:string|null; referenceLinks?:ReferenceLink[]; startedAt?: string | null; id: string; projectId: string; featureId: string; name: string; scope: string; targetDate: string | null; note: string; sortOrder: number; version: number; deliveredAt: string | null; status: PhaseStatus; completedAt: string | null; overdue: boolean; requirements: PhaseRequirement[]; deliveries: PhaseDelivery[]; distribution: Array<{ key: string; label: string; count: number; requirementIds: string[] }> };
export function phaseStatus(requirements: Array<{ status: string }>): PhaseStatus {
  const active = requirements.filter(r => r.status !== 'cancelled');
  if (!active.length) return 'planning';
  if (active.every(r => r.status === 'completed')) return 'completed';
  return active.some(r => r.status !== 'not_started') ? 'in_progress' : 'not_started';
}
export type PhaseCompletion = { total: number; completed: number; inProgress: number; notStarted: number; percent: number | null; weight:number };
/** Weight recorded requirement progress, never the currently displayed execution stage. */
export function phaseCompletion(requirements: ReadonlyArray<ProgressFact>): PhaseCompletion {
  const active = requirements.filter(r => r.status !== 'cancelled');
  const completed = active.filter(r => r.status === 'completed').length;
  const notStarted = active.filter(r => r.status === 'not_started').length;
  const weightOf=(r:ProgressFact)=>Math.max(1,r.progressWeight??1);
  const weight=active.reduce((sum,r)=>sum+weightOf(r),0);
  const earned=active.reduce((sum,r)=>sum+weightOf(r)*(r.status==='completed'?100:r.status==='not_started'?0:Math.max(0,Math.min(99,r.progress??0))),0);
  return { total: active.length, completed, notStarted, inProgress: active.length - completed - notStarted,
    weight, percent: weight ? Math.min(completed===active.length?100:99,Math.round(earned/weight)) : null };
}
export function phaseProgress(requirements: Array<ProgressFact & {actualStart?: string | null; actualEnd?: string | null}>, targetDate: string | null, asOfDate: string) {
  const status = phaseStatus(requirements), active = requirements.filter(r => r.status !== 'cancelled');
  const completedAt = status === 'completed' && active.every(r => r.actualEnd)
    ? active.map(r => r.actualEnd!).sort().at(-1)! : null;
  const actualStart = active.filter(r => r.status !== 'not_started').flatMap(r => r.actualStart ? [r.actualStart] : []).sort()[0] || null;
  const observationEnd = status === 'completed' ? completedAt : status === 'in_progress' && actualStart && actualStart <= asOfDate ? asOfDate : null;
  return {status, actualStart, observationEnd, completedAt, completion: phaseCompletion(requirements), overdue: active.length > 0 && status !== 'completed' && !!targetDate && targetDate < asOfDate};
}
export function phaseDistribution(requirements: PhaseRequirement[]) {
  const byStage = new Map<string, FeaturePhase['distribution'][number]>();
  for (const r of requirements.filter(r => r.status !== 'cancelled')) {
    const stage = r.executionStage, old = byStage.get(stage.key) || { key: stage.key, label: stage.key === 'parallel' ? '并行推进' : stage.label, count: 0, requirementIds: [] };
    old.count++; old.requirementIds.push(r.id); byStage.set(stage.key, old);
  }
  return [...byStage.values()];
}

export type PhaseSummary=Pick<FeaturePhase,'id'|'featureId'|'name'|'status'|'scope'|'overdue'|'targetDate'|'sortOrder'>;
