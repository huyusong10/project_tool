import { z } from 'zod';
import { idSchema } from './contracts';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === v; }, '日期不合法');
export const forecastReviewInput=z.object({remainingDays:z.number().int().min(1).max(3660).optional(),forecastEnd:date.optional()}).strict().refine(v=>Number(v.remainingDays!==undefined)+Number(!!v.forecastEnd)===1,'请填写剩余工作日或预计完成日期中的一项');
export const pathQuery = z.object({ target: z.string().min(1).optional() }).strict();
export const pathVersion = z.object({ expectedRevision: z.number().int().nonnegative() }).strict();
export const dependencyInput = pathVersion.extend({ sourceRequirementId: z.string(), sourceWorkItemId: idSchema.nullable().default(null), targetRequirementId: z.string(), targetWorkItemId: idSchema.nullable().default(null),sourceMilestoneId:idSchema.nullable().optional(),targetMilestoneId:idSchema.nullable().optional() }).strict();
export const pathEstimateInput = pathVersion.extend({ reviewForecast:forecastReviewInput.optional(), durationDays: z.number().int().min(1).max(3660).nullable().optional(), earliestStart: date.nullable().optional(), unblockEstimate: date.nullable().optional(), forecastEnd: date.nullable().optional(),arrangement:z.enum(['early','late']).optional(),arrangementAnchor:idSchema.nullable().optional() }).strict();
export const reviewDependenciesInput = pathVersion.extend({ forecastAcceptance: date.nullable().optional(), reviewed: z.boolean().optional() }).strict();
export const dependencyPlanInput = z.object({ baseStart: date, expectedRevision: z.number().int().nonnegative() }).strict();
export const applyDependencyPlanInput = dependencyPlanInput.extend({ previewToken: z.string().min(1) }).strict();

export const editorEntityChange=z.object({entity:z.enum(['requirement','work','milestone']),op:z.enum(['create','update','delete']),id:idSchema,requirementId:idSchema.nullable().optional(),expectedVersion:z.number().int().positive().optional(),data:z.object({
  blockedCoordinatorId:idSchema.nullable().optional(),blockedNextReviewAt:date.nullable().optional(),blockedIssueId:idSchema.nullable().optional(),
  reviewForecast:forecastReviewInput.optional(),
  deliveryScope:z.enum(['committed','candidate']).optional(),executionMode:z.enum(['direct','work_items']).optional(),acceptanceOwnerId:idSchema.nullable().optional(),forecastEnd:date.nullable().optional(),unblockEstimate:date.nullable().optional(),
  title:z.string().trim().min(1).optional(),ownerId:idSchema.nullable().optional(),assigneeIds:z.array(idSchema).optional(),priority:z.enum(['P0','P1','P2','P3']).optional(),background:z.string().nullable().optional(),acceptanceCriteria:z.string().nullable().optional(),referenceUrl:z.string().nullable().optional(),templateId:idSchema.nullable().optional(),plannedStart:date.nullable().optional(),plannedEnd:date.nullable().optional(),durationDays:z.number().int().min(1).max(3660).nullable().optional(),arrangement:z.enum(['early','late']).optional(),arrangementAnchor:idSchema.nullable().optional(),targetDate:date.nullable().optional(),confirmationMode:z.enum(['auto','manual']).optional(),reason:z.string().optional(),
}).strict().default({})}).strict();
export const diagramLayoutChange=z.object({scope:idSchema,direction:z.enum(['right','down']),expectedVersion:z.number().int().nonnegative(),positions:z.record(z.string(),z.object({x:z.number().finite(),y:z.number().finite()}).strict())}).strict();
export type EditorEntityChange=z.infer<typeof editorEntityChange>;

export const dependencyChanges = z.object({
  commitment: z.object({reason:z.string().trim().max(2000).default(''),milestoneId:idSchema.nullable().optional()}).strict().optional(),
  add: z.array(dependencyInput.omit({ expectedRevision: true }).extend({ clientId: idSchema })).max(6000).default([]),
  remove: z.array(idSchema).max(6000).default([]),
  estimates: z.array(pathEstimateInput.omit({ expectedRevision: true }).extend({ workItemId: idSchema })).max(2000).default([]),
  entities:z.array(editorEntityChange).max(4000).optional(),layouts:z.array(diagramLayoutChange).max(200).optional(),
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
    commitment?: {value:import('./commitments').DeliveryCommitment;differences:import('./commitments').CommitmentDifference[];previousTargetDate:string|null};
    impact?:import('./delivery-impact').DeliveryImpact[];
    target?:import('./delivery-impact').DeliveryTargetChange;
    added: DependencyChanges['add']; removed: import('./paths').Dependency[];
    estimates: Array<{workItemId:string;before:import('./paths').PathNode['estimate'];after:import('./paths').PathNode['estimate']}>;
    entities?:EditorEntityChange[];
  };
};
export type DependencyChangeReceipt = {
  batchId: string; committedRevision: number; addedIds: Record<string, string>; createdAt: string;
};
