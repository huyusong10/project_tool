import { z } from 'zod';
import { idSchema, isoDateSchema, requirementListInputSchema } from './contracts';
import { workItemStatuses } from './domain';

const pageFields = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
};
const dateFields = { from: isoDateSchema.optional(), to: isoDateSchema.optional() };
const orderedDates = (v: { from?: string; to?: string }) => !v.from || !v.to || v.from <= v.to;
const dateError = { message: '开始日期不能晚于结束日期', path: ['to'] };
const q = z.string().trim().max(200).optional();
const flag = z.union([z.boolean(), z.enum(['true', 'false'])]).transform(v => v === true || v === 'true');

export const requirementQuerySchema = requirementListInputSchema.omit({deliveryScope:true}).extend({
  q, ownerId: idSchema.optional(), participantId: idSchema.optional(),
  ...dateFields, ...pageFields, includeWorkItems: flag.default(false),
}).refine(orderedDates, dateError);

export const workItemQuerySchema = z.object({
  projectId: idSchema, requirementId: idSchema.optional(), q,
  ownerId: idSchema.optional(), participantId: idSchema.optional(),
  status: z.enum(workItemStatuses).optional(), active: flag.optional(),
  overdue: flag.optional(), unassigned: flag.optional(),
  ...dateFields, ...pageFields,
}).strict().refine(orderedDates, dateError).superRefine((v, ctx) => {
  if (v.ownerId && v.unassigned) ctx.addIssue({ code: 'custom', path: ['ownerId'], message: '指定负责人不能与仅未分派同时筛选' });
  if (v.status && ['completed', 'cancelled'].includes(v.status) && (v.active || v.overdue))
    ctx.addIssue({ code: 'custom', path: ['status'], message: '已结束状态不能与仅未完成或仅逾期同时筛选' });
});

export const progressQuerySchema = z.object({
  projectId: idSchema, requirementId: idSchema.optional(), workItemId: idSchema.optional(),
  authorAccountId: idSchema.optional(), eventType: z.string().trim().min(1).max(100).optional(), q,
  ...dateFields, ...pageFields,
  snapshot: z.coerce.number().int().nonnegative().optional(),
}).strict().refine(orderedDates, dateError);

export const pathGraphQuerySchema = z.object({
  projectId: idSchema,
  view: z.enum(['project', 'requirement','features','feature']).default('project'),
  featureId:idSchema.optional(), phaseId:idSchema.optional(), planning:flag.default(true), actual:flag.default(true),
  requirementId: idSchema.optional(), target: idSchema.optional(),
  rootNodeId: idSchema.optional(), traversal: z.enum(['upstream', 'downstream', 'both']).default('both'),
  depth: z.coerce.number().int().min(0).max(100).default(1),
  attention: flag.default(false), q,
  maxNodes: z.coerce.number().int().min(1).max(2000).default(500),
  direction: z.enum(['right', 'down']).default('right'),
  layout: z.enum(['none', 'auto']).default('none'),
  format: z.enum(['json', 'svg']).default('json'),
}).strict().refine(v => (v.view === 'requirement') === Boolean(v.requirementId), {
  message: '需求视图必须提供 requirementId；项目视图请省略 requirementId', path: ['requirementId'],
}).refine(v=>(v.view==='feature')===Boolean(v.featureId),{message:'特性需求视图必须提供 featureId；未关联特性集合使用 unassigned',path:['featureId']}).refine(v=>!v.phaseId||v.view==='feature',{message:'Phase 筛选需要特性视图',path:['phaseId']});

export type RequirementQuery = z.infer<typeof requirementQuerySchema>;
export type WorkItemQuery = z.infer<typeof workItemQuerySchema>;
export type ProgressQuery = z.infer<typeof progressQuerySchema>;
export type PathGraphQuery = z.infer<typeof pathGraphQuerySchema>;
