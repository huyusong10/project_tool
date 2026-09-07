import { z } from 'zod';
import {
  issueStatuses, maxTemplateDurationDays, maxTemplateItems, maxTemplateOffsetDays,
  priorities, projectRoles, projectStatuses, requirementStatuses,
} from './domain';
import { actionReasonCodes } from './action-items';
import { isValidIsoDate } from './workday';

export const idSchema = z.string().trim().min(1, 'ID不能为空');
export const isoDateSchema = z.string().refine(isValidIsoDate, '日期必须是有效的YYYY-MM-DD日期');
export const optionalDateSchema = z.union([isoDateSchema, z.literal(''), z.null()]).optional();
export const optionalTextSchema = z.union([z.string().trim().max(10000), z.null()]).optional();
export const optionalIdSchema = z.union([idSchema, z.literal(''), z.null()]).optional();
export const optionalHttpUrlSchema = z.union([
  z.literal(''),
  z.null(),
  z.string().trim().url('辅助链接格式不正确').refine((value) => /^https?:\/\//i.test(value), '辅助链接仅支持HTTP或HTTPS'),
]).optional();
export const expectedVersionSchema = z.number().int().min(1);
export const backupFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/, '备份文件指纹不合法');
export const requiredLabelSchema = z.string().trim().min(1).max(200);

export const idParamsSchema = z.object({ id: idSchema }).strict();
export const projectParamsSchema = z.object({ projectId: idSchema }).strict();
export const copyTemplateInputSchema = z.object({ projectId: idSchema, sourceTemplateId: idSchema }).strict();
export const projectPersonParamsSchema = z.object({ projectId: idSchema, personId: idSchema }).strict();
export const issueUpdateParamsSchema = z.object({ id: idSchema, updateId: idSchema }).strict();
export const archiveParamsSchema = z.object({
  entity: z.enum(['projects', 'requirements', 'people', 'templates']),
  id: idSchema,
}).strict();
export const backupDeleteInputSchema = z.object({ expectedFingerprint: backupFingerprintSchema.optional() }).strict();
export const backupRestoreInputSchema = z.object({
  name: z.string().trim().min(1, '备份文件名不能为空'),
  expectedFingerprint: backupFingerprintSchema.optional(),
}).strict();
export const emptyCommandInputSchema = z.object({}).strict().default({});
export const brandingInputSchema = z.object({
  systemName: z.string(),
  shortName: z.string(),
  logoDataUrl: z.union([z.string(), z.null()]).optional(),
  expectedUpdatedAt: z.string().datetime().nullable().optional(),
}).strict();
export const apiTokenInputSchema = z.object({
  name: z.string().trim().min(1, 'Token名称不能为空').max(200, 'Token名称不能超过200个字符'),
  expiresInDays: z.union([
    z.null(),
    z.literal('never'),
    z.number().int().min(1).max(3650),
    z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(3650)),
  ]).optional(),
}).strict();
export const changePasswordInputSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(8).max(1024),
}).strict();
export const loginInputSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(1024),
}).strict();

export const projectInputSchema = z.object({
  name: z.string().trim().min(1).optional(),
  plannedStart: optionalDateSchema,
  plannedEnd: optionalDateSchema,
  defaultTemplateId: z.string().nullable().optional(),
  status: z.enum(projectStatuses).optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
}).refine((input) => !input.plannedStart || !input.plannedEnd || input.plannedStart <= input.plannedEnd, {
  message: '项目计划完成日期不能早于计划开始日期',
}).strict();
export const createProjectInputSchema = z.object({
  name: requiredLabelSchema,
  plannedStart: optionalDateSchema,
  plannedEnd: optionalDateSchema,
  status: z.enum(projectStatuses).optional(),
}).strict().refine((input) => !input.plannedStart || !input.plannedEnd || input.plannedStart <= input.plannedEnd, {
  message: '项目计划完成日期不能早于计划开始日期',
});
export const projectArchiveInputSchema = z.object({
  force: z.boolean().optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
  expectedRequirements: z.number().int().nonnegative().optional(),
  expectedIssues: z.number().int().nonnegative().optional(),
}).refine((input) => (input.expectedRequirements === undefined) === (input.expectedIssues === undefined), {
  message: '已确认的需求数和问题数必须同时提供',
}).refine((input) => input.force || input.expectedRequirements === undefined, {
  message: '只有强制归档可以提交已确认的影响数量',
}).strict();

export const requirementInputSchema = z.object({
  projectId: idSchema.optional(),
  title: z.string().trim().min(1).optional(),
  priority: z.enum(priorities).optional(),
  ownerId: optionalIdSchema,
  background: optionalTextSchema,
  acceptanceCriteria: optionalTextSchema,
  referenceUrl: optionalHttpUrlSchema,
  plannedStart: optionalDateSchema,
  plannedEnd: optionalDateSchema,
  scheduleMode: z.enum(['start', 'deadline']).optional(),
  templateId: z.string().optional(),
  confirmTemplateReset: z.boolean().optional(),
  expectedVersion: expectedVersionSchema.optional(),
  reason: z.string().trim().min(1).optional(),
}).passthrough();

export const createRequirementInputSchema = requirementInputSchema.pick({
  projectId: true,
  title: true,
  priority: true,
  ownerId: true,
  background: true,
  acceptanceCriteria: true,
  referenceUrl: true,
  plannedStart: true,
  plannedEnd: true,
  templateId: true,
}).extend({
  projectId: idSchema,
  title: z.string().trim().min(1),
  priority: z.enum(priorities).default('P2'),
}).strict().refine((input) => !(input.plannedStart && input.plannedEnd), {
  message: '计划开始和截止日期只能选择一项',
});

export const updateRequirementInputSchema = requirementInputSchema.pick({
  title: true, priority: true, ownerId: true, background: true,
  acceptanceCriteria: true, referenceUrl: true, expectedVersion: true,
}).extend({ expectedVersion: expectedVersionSchema });

export const requirementCorrectionInputSchema = updateRequirementInputSchema.extend({
  reason: z.string().trim().min(1),
  supersedesId: z.string().nullable().optional(),
});

export const rescheduleRequirementInputSchema = requirementInputSchema.extend({
  scheduleMode: z.enum(['start', 'deadline']),
  expectedVersion: expectedVersionSchema,
}).refine((input) => Boolean(input.plannedStart) !== Boolean(input.plannedEnd), {
  message: '计划开始和完成日期请选择一项',
});

export const reselectRequirementTemplateInputSchema = requirementInputSchema.extend({
  templateId: idSchema,
  expectedVersion: expectedVersionSchema,
}).strict();

export const previewRequirementPlanInputSchema = z.object({
  templateId: idSchema,
  baseStart: isoDateSchema.optional(),
}).strict();

export const applyRequirementPlanInputSchema = previewRequirementPlanInputSchema.extend({
  expectedVersion: expectedVersionSchema,
  templateItemIds: z.array(idSchema).optional(),
  reason: z.string().trim().optional(),
  previewToken: z.string().regex(/^[a-f0-9]{64}$/, '预览标识无效，请重新预览').optional(),
}).strict();

export const applyTemplateInputSchema = z.object({
  templateId: idSchema,
  expectedVersion: expectedVersionSchema,
  reason: z.string().trim().min(1).optional(),
}).strict();

export const workItemInputSchema = z.object({
  title: z.string().trim().min(1).optional(),
  ownerId: z.string().nullable().optional(),
  collaboratorIds: z.array(idSchema).optional(),
  assigneeIds: z.array(idSchema).optional(),
  plannedStart: optionalDateSchema,
  plannedEnd: optionalDateSchema,
  sortOrder: z.number().int().min(0).optional(),
  milestoneLabel: z.string().nullable().optional(),
  expectedVersion: expectedVersionSchema.optional(),
  reason: z.string().trim().min(1).optional(),
}).passthrough();

export const expectedVersionInputSchema = z.object({ expectedVersion: expectedVersionSchema }).passthrough();
export const startWorkItemInputSchema=expectedVersionInputSchema.extend({reason:z.string().trim().min(1).optional(),expectedDependencyRevision:z.number().int().nonnegative().optional()});
export const reasonCommandSchema = expectedVersionInputSchema.extend({ reason: z.string().trim().min(1) });
export const contentCommandSchema = expectedVersionInputSchema.extend({ content: z.string().trim().min(1) });
export const completeAsPlannedInputSchema = z.object({
  expectedVersion: expectedVersionSchema,
  content: z.string().trim().min(1).max(10000).default('历史补录，按计划完成'),
}).strict();
export const workItemCommandSchema = expectedVersionInputSchema.extend({
  reason: z.string().trim().optional(),
  content: z.string().trim().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  actualStart: optionalDateSchema,
  actualEnd: optionalDateSchema,
});

export const workItemCorrectionSchema = workItemCommandSchema.omit({ content: true }).extend({
  reason: z.string().trim().min(1),
  title: z.string().trim().min(1).optional(),
  supersedesId: z.string().nullable().optional(),
});

export const reopenWorkItemInputSchema = reasonCommandSchema.extend({
  progress: z.number().int().min(0).max(99).optional(),
});

export const issueCommandSchema = expectedVersionInputSchema.extend({
  reason: z.string().trim().optional(),
  content: z.string().trim().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  title: z.string().trim().min(1).optional(),
  impact: z.string().nullable().optional(),
  resolvedAt: optionalDateSchema,
  supersedesId: z.string().nullable().optional(),
});

export const reopenIssueInputSchema = reasonCommandSchema.extend({
  progress: z.number().int().min(0).max(99).optional(),
});

export const issueCorrectionInputSchema = issueCommandSchema.omit({ content: true }).extend({
  reason: z.string().trim().min(1),
});

export const progressInputSchema = z.object({
  content: z.string().trim().min(1),
  workItemId: z.string().nullable().optional(),
  workItemPercent: z.number().int().min(0).max(99).optional(),
  expectedVersion: expectedVersionSchema.optional(),
}).strict();

export const createWorkItemInputSchema = workItemInputSchema.omit({ sortOrder: true }).extend({
  title: requiredLabelSchema,
  expectedVersion: expectedVersionSchema,
}).strict().refine((input) => input.collaboratorIds === undefined || input.assigneeIds === undefined, {
  message: '协作人员与参与人员字段不能同时提交',
});

export const updateWorkItemInputSchema = workItemInputSchema.extend({
  expectedVersion: expectedVersionSchema,
}).refine((input) => input.collaboratorIds === undefined || input.assigneeIds === undefined, {
  message: '协作人员与参与人员字段不能同时提交',
});

export const progressHistoryUpdateInputSchema = z.object({
  content: z.string().optional(),
  workItemId: optionalIdSchema,
  workItemPercent: z.number().int().min(0).max(99).optional(),
  expectedVersion: expectedVersionSchema.optional(),
}).strict();

export const issueInputSchema = z.object({
  projectId: idSchema.optional(),
  title: z.string().trim().min(1).optional(),
  impact: z.string().nullable().optional(),
  reporter: z.string().nullable().optional(),
  sourceRef: z.union([z.string().trim().max(200), z.null()]).optional(),
  ownerId: z.string().nullable().optional(),
  requirementId: z.string().nullable().optional(),
  priority: z.enum(priorities).optional(),
  discoveredAt: isoDateSchema.optional(),
  dueDate: optionalDateSchema,
  expectedVersion: expectedVersionSchema.optional(),
}).passthrough();

export const createIssueInputSchema = issueInputSchema.pick({
  projectId: true,
  title: true,
  impact: true,
  reporter: true,
  sourceRef: true,
  ownerId: true,
  requirementId: true,
  priority: true,
  discoveredAt: true,
  dueDate: true,
}).extend({
  projectId: idSchema,
  title: requiredLabelSchema,
}).strict();

export const updateIssueInputSchema = issueInputSchema.omit({ projectId: true }).extend({
  expectedVersion: expectedVersionSchema,
});

export const issueUpdateInputSchema = z.object({
  content: z.string().trim().min(1),
  progress: z.number().int().min(0).max(99).optional(),
  expectedVersion: expectedVersionSchema.optional(),
}).strict();

export const issueUpdateHistoryInputSchema = z.object({
  content: z.string().optional(),
  progress: z.number().int().min(0).max(99).optional(),
}).strict();

export const templateItemSchema = z.object({
  id: z.string().optional(),
  clientKey: z.string().min(1).optional(),
  predecessorKeys: z.array(z.string().min(1)).max(maxTemplateItems).optional(),
  title: z.string().trim().min(1),
  startOffsetDays: z.number().int().min(0).max(maxTemplateOffsetDays),
  durationDays: z.number().int().min(1).max(maxTemplateDurationDays),
  milestoneLabel: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0),
}).strict();
export const createTemplateItemSchema = templateItemSchema.extend({ id: z.never().optional() });

export const templateInputSchema = z.object({
  dependencyMode: z.enum(['legacy','dependencies']).optional(),
  projectId: idSchema.optional(),
  name: z.string().trim().min(1).optional(),
  description: z.string().max(2000).optional(),
  items: z.array(templateItemSchema).min(1).max(maxTemplateItems).optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
}).strict();
export const createTemplateInputSchema = templateInputSchema.pick({
  dependencyMode: true,
  projectId: true,
  name: true,
  description: true,
  items: true,
}).extend({
  projectId: idSchema,
  name: requiredLabelSchema,
  items: z.array(createTemplateItemSchema).min(1).max(maxTemplateItems),
}).strict();
export const updateTemplateInputSchema = templateInputSchema.omit({ projectId: true });
export const templateCommandSchema = z.object({
  expectedUpdatedAt: z.string().datetime().optional(),
}).strict();

export const personInputSchema = z.object({
  projectId: idSchema.optional(),
  name: z.string().trim().min(1).optional(),
  jobTitle: z.string().nullable().optional(),
  active: z.union([
    z.boolean(),
    z.literal(0),
    z.literal(1),
    z.literal('0'),
    z.literal('1'),
    z.literal('true'),
    z.literal('false'),
  ]).optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
}).strict();
export const createPersonInputSchema = personInputSchema.pick({
  projectId: true,
  name: true,
  jobTitle: true,
}).extend({ name: requiredLabelSchema }).strict();
export const updatePersonInputSchema = personInputSchema.omit({ projectId: true });
export const personCommandSchema = z.object({
  expectedUpdatedAt: z.string().datetime().optional(),
}).strict();

export const accountInputSchema = z.object({
  username: z.string().trim().min(1).optional(),
  role: z.enum(['user', 'admin', 'project_manager']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  managedProjectIds: z.array(idSchema).optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
}).strict();
export const accountCommandSchema = z.object({
  expectedUpdatedAt: z.string().datetime().optional(),
}).strict();
export const openAccountInputSchema = z.object({
  expectedAccountDeletedAt: z.string().datetime().nullable().optional(),
}).strict();

export const projectMemberInputSchema = z.object({
  role: z.enum(projectRoles).default('member'),
  expectedMembershipUpdatedAt: z.string().datetime().nullable().optional(),
}).strict();
export const projectMemberCommandSchema = z.object({
  expectedMembershipUpdatedAt: z.string().datetime().nullable().optional(),
}).strict();
export const projectMemberMutationInputSchema = projectMemberInputSchema.safeExtend({
  projectId: idSchema,
  personId: idSchema,
});
export const projectMemberMutationCommandSchema = projectMemberCommandSchema.safeExtend({
  projectId: idSchema,
  personId: idSchema,
});
export const archiveDeleteInputSchema = z.object({
  confirmName: z.string().optional(),
  expectedDeletedAt: z.string().trim().min(1, '缺少归档版本，请刷新后重试'),
}).strict();
export const archiveRestoreInputSchema = z.object({
  expectedDeletedAt: z.string().trim().min(1, '归档版本不能为空').optional(),
}).strict();

const optionalQueryFlagSchema = z.union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true').optional();

export const projectListInputSchema = z.object({
  includeDeleted: optionalQueryFlagSchema,
}).strict();

export const projectScopeInputSchema = z.object({
  projectId: idSchema,
}).strict();

export const archiveListInputSchema = z.object({
  projectId: idSchema.optional(),
}).strict();

export const auditListInputSchema = z.object({
  projectId: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
}).strict();

export const projectResourceListInputSchema = projectListInputSchema.extend({
  projectId: idSchema,
});

export const peopleListInputSchema = projectListInputSchema.extend({
  projectId: idSchema.optional(),
});

export const personCandidatesInputSchema = z.object({
  projectId: idSchema,
  q: z.string().trim().max(200).optional(),
}).strict();

export const requirementListInputSchema = z.object({
  projectId: idSchema,
  status: z.enum(requirementStatuses).optional(),
  view: z.enum(['delayed', 'high_risk']).optional(),
  includeDeleted: optionalQueryFlagSchema,
}).strict();

export const issueListInputSchema = z.object({
  projectId: idSchema,
  q: z.string().trim().optional(),
  status: z.union([z.enum(issueStatuses), z.literal('active')]).optional(),
  priority: z.enum(priorities).optional(),
  ownerId: idSchema.optional(),
  requirementId: idSchema.optional(),
  scope: z.enum(['public', 'requirement']).optional(),
  overdue: optionalQueryFlagSchema,
  unassigned: optionalQueryFlagSchema,
  active: optionalQueryFlagSchema,
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
}).strict().superRefine((input, context) => {
  if (input.status === 'resolved' && (input.active || input.overdue)) {
    context.addIssue({ code: 'custom', path: ['status'], message: '已解决状态不能与仅未闭环或仅逾期同时筛选' });
  }
  if (input.ownerId && input.unassigned) {
    context.addIssue({ code: 'custom', path: ['ownerId'], message: '指定负责人不能与仅未分派同时筛选' });
  }
  if (input.scope === 'public' && input.requirementId) {
    context.addIssue({ code: 'custom', path: ['scope'], message: '公共问题不能同时指定关联需求' });
  }
});

export const actionItemsInputSchema = z.object({
  projectId: idSchema,
  severity: z.enum(['high', 'medium', 'low']).optional(),
  reason: z.enum(actionReasonCodes).optional(),
  ownerId: z.union([idSchema, z.literal('unassigned')]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
}).strict();

export const analyticsQueryInputSchema = z.object({
  projectId: idSchema,
  range: z.object({
    from: isoDateSchema,
    to: isoDateSchema,
  }).strict().refine((range) => range.from <= range.to, {
    message: '分析时间范围不合法',
    path: ['to'],
  }),
  panels: z.array(z.record(z.string(), z.unknown())).min(1).max(24),
}).strict();

export const reorderWorkItemsInputSchema = z.object({
  ids: z.array(idSchema).min(1, '工作项顺序不能为空').refine(
    (ids) => new Set(ids).size === ids.length,
    '工作项顺序不能包含重复ID',
  ),
  reason: z.string().trim().min(1).optional(),
  expectedVersion: expectedVersionSchema,
}).strict();

export const peopleConcurrencyInputSchema = z.object({
  projectId: idSchema.optional(),
  personId: idSchema.optional(),
  jobTitle: z.string().trim().optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
}).strict().refine((input) => !input.from || !input.to || input.from <= input.to, {
  message: '开始日期不能晚于结束日期',
}).refine((input) => {
  if (!input.from || !input.to) return true;
  const from = Date.parse(`${input.from}T00:00:00Z`);
  const to = Date.parse(`${input.to}T00:00:00Z`);
  return to - from <= 1830 * 24 * 60 * 60 * 1000;
}, { message: '人员并发查询范围不能超过5年' });

export const projectPeopleConcurrencyInputSchema = peopleConcurrencyInputSchema.refine(
  (input) => Boolean(input.projectId),
  { message: '项目ID不能为空', path: ['projectId'] },
);
