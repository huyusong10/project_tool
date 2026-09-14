import { z } from 'zod';
import type { ExecutionStage } from './execution-stage';

const id = z.string().trim().min(1), version = z.number().int().positive();
export const phaseDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, '日期无效');
export const phaseInput = z.object({ id: id.optional(), expectedVersion: version.optional(), name: z.string().trim().min(1).max(200), scope: z.string().trim().max(10000).default(''), targetDate: phaseDate.nullable().default(null), note: z.string().trim().max(2000).default(''), sortOrder: z.number().int().min(0).optional(), reason: z.string().trim().max(2000).optional() }).strict();
export const phaseCommand = z.object({ expectedVersion: version, reason: z.string().trim().max(2000).optional(), deliveredAt: phaseDate.optional() }).strict();
export const phaseStatusLabels = { planning: '规划中', in_progress: '推进中', ready: '待交付', delivered: '已交付' } as const;
export type PhaseStatus = keyof typeof phaseStatusLabels;
export type PhaseRequirement = { id: string; title: string; status: string; version: number; phaseId?: string | null; featureId?: string | null; actualEnd?: string | null; deletedAt?: string | null; acceptanceCriteria?: string | null; executionStage: ExecutionStage };
export type PhaseDelivery = { id: string; deliveredAt: string; deliveredByName: string | null; createdAt: string; reopenedAt: string | null; reopenReason: string | null; snapshot: { name: string; scope: string; targetDate: string | null; requirements: Array<{ id: string; title: string; acceptanceCriteria?: string | null; actualEnd?: string | null }> } };
export type FeaturePhase = { startedAt?: string | null; id: string; projectId: string; featureId: string; name: string; scope: string; targetDate: string | null; note: string; sortOrder: number; version: number; deliveredAt: string | null; status: PhaseStatus; overdue: boolean; requirements: PhaseRequirement[]; deliveries: PhaseDelivery[]; distribution: Array<{ key: string; label: string; count: number; requirementIds: string[] }> };
export function phaseStatus(requirements: Array<{ status: string }>, deliveredAt: string | null): PhaseStatus {
  if (deliveredAt) return 'delivered';
  const active = requirements.filter(r => r.status !== 'cancelled');
  if (active.length && active.every(r => r.status === 'completed')) return 'ready';
  return active.some(r => r.status === 'completed' || r.status === 'in_progress') ? 'in_progress' : 'planning';
}
export function phaseDistribution(requirements: PhaseRequirement[]) {
  const byStage = new Map<string, FeaturePhase['distribution'][number]>();
  for (const r of requirements.filter(r => r.status !== 'cancelled')) {
    const stage = r.executionStage, old = byStage.get(stage.key) || { key: stage.key, label: stage.key === 'parallel' ? '并行推进' : stage.label, count: 0, requirementIds: [] };
    old.count++; old.requirementIds.push(r.id); byStage.set(stage.key, old);
  }
  return [...byStage.values()];
}
