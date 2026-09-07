import { z } from 'zod';
import { idSchema } from './contracts';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === v; }, '日期不合法');
export const pathQuery = z.object({ target: z.string().min(1).optional() }).strict();
export const pathVersion = z.object({ expectedRevision: z.number().int().nonnegative() }).strict();
export const dependencyInput = pathVersion.extend({ sourceRequirementId: idSchema, sourceWorkItemId: idSchema.nullable().default(null), targetRequirementId: idSchema, targetWorkItemId: idSchema.nullable().default(null) }).strict();
export const pathEstimateInput = pathVersion.extend({ durationDays: z.number().int().min(1).max(3660).nullable().optional(), earliestStart: date.nullable().optional(), unblockEstimate: date.nullable().optional(), forecastEnd: date.nullable().optional() }).strict();
export const reviewDependenciesInput = pathVersion.extend({ forecastAcceptance: date.nullable().optional(), reviewed: z.boolean().optional() }).strict();
export const dependencyPlanInput = z.object({ baseStart: date, expectedRevision: z.number().int().nonnegative() }).strict();
export const applyDependencyPlanInput = dependencyPlanInput.extend({ previewToken: z.string().min(1) }).strict();

export const dependencyChanges = z.object({
  add: z.array(dependencyInput.omit({ expectedRevision: true }).extend({ clientId: idSchema })).max(6000).default([]),
  remove: z.array(idSchema).max(6000).default([]),
  estimates: z.array(pathEstimateInput.omit({ expectedRevision: true }).extend({ workItemId: idSchema })).max(2000).default([]),
}).strict();
export const dependencyChangesInput = pathVersion.extend({
  target: z.string().min(1).default('project'),
  changes: dependencyChanges,
}).strict();
export const applyDependencyChangesInput = dependencyChangesInput.extend({
  batchId: z.string().uuid(),
  previewToken: z.string().min(1),
}).strict();
export type DependencyChanges = z.infer<typeof dependencyChanges>;
export type DependencyChangesInput = z.infer<typeof dependencyChangesInput>;
export type DependencyChangePreview = {
  analysis: import('./paths').PathAnalysis; expectedRevision: number; asOfDate: string;
  previewToken: string; count: number;
  differences: {
    added: DependencyChanges['add']; removed: import('./paths').Dependency[];
    estimates: Array<{workItemId:string;before:import('./paths').PathNode['estimate'];after:import('./paths').PathNode['estimate']}>;
  };
};
export type DependencyChangeReceipt = {
  batchId: string; committedRevision: number; addedIds: Record<string, string>; createdAt: string;
};
