import { z } from 'zod';
import { priorities, projectRoles } from './domain';

export const idSchema = z.string().trim().min(1, 'ID不能为空');
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为YYYY-MM-DD');
export const optionalDateSchema = z.union([isoDateSchema, z.literal(''), z.null()]).optional();
export const expectedVersionSchema = z.number().int().min(1);

export const idParamsSchema = z.object({ id: idSchema });
export const projectParamsSchema = z.object({ projectId: idSchema });
export const projectPersonParamsSchema = z.object({ projectId: idSchema, personId: idSchema });
export const issueUpdateParamsSchema = z.object({ id: idSchema, updateId: idSchema });
export const archiveParamsSchema = z.object({
  entity: z.enum(['projects', 'requirements', 'people', 'templates']),
  id: idSchema,
});

export const projectInputSchema = z.object({
  name: z.string().trim().min(1).optional(),
  plannedStart: optionalDateSchema,
  plannedEnd: optionalDateSchema,
  defaultTemplateId: z.string().nullable().optional(),
  status: z.string().optional(),
}).passthrough();

export const requirementInputSchema = z.object({
  projectId: idSchema.optional(),
  title: z.string().trim().min(1).optional(),
  priority: z.enum(priorities).optional(),
  plannedStart: optionalDateSchema,
  plannedEnd: optionalDateSchema,
  scheduleMode: z.enum(['start', 'deadline']).optional(),
  templateId: z.string().optional(),
  confirmTemplateReset: z.boolean().optional(),
  expectedVersion: expectedVersionSchema.optional(),
  reason: z.string().trim().min(1).optional(),
}).passthrough();

export const createRequirementInputSchema = requirementInputSchema.extend({
  projectId: idSchema,
  title: z.string().trim().min(1),
  priority: z.enum(priorities).default('P2'),
}).refine((input) => Boolean(input.plannedStart) !== Boolean(input.plannedEnd), {
  message: '计划开始和截止日期请选择一项',
});

export const updateRequirementInputSchema = requirementInputSchema.pick({
  title: true, priority: true, expectedVersion: true,
}).extend({ expectedVersion: expectedVersionSchema });

export const rescheduleRequirementInputSchema = requirementInputSchema.extend({
  scheduleMode: z.enum(['start', 'deadline']),
  expectedVersion: expectedVersionSchema,
}).refine((input) => Boolean(input.plannedStart) !== Boolean(input.plannedEnd), {
  message: '计划开始和完成日期请选择一项',
});

export const reselectRequirementTemplateInputSchema = requirementInputSchema.extend({
  templateId: idSchema,
  expectedVersion: expectedVersionSchema,
});

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
export const reasonCommandSchema = expectedVersionInputSchema.extend({ reason: z.string().trim().min(1) });
export const contentCommandSchema = expectedVersionInputSchema.extend({ content: z.string().trim().min(1) });
export const workItemCommandSchema = expectedVersionInputSchema.extend({
  reason: z.string().trim().optional(),
  content: z.string().trim().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  actualStart: optionalDateSchema,
  actualEnd: optionalDateSchema,
});

export const progressInputSchema = z.object({
  content: z.string().trim().min(1),
  workItemId: z.string().nullable().optional(),
  workItemPercent: z.number().int().min(0).max(99).optional(),
  expectedVersion: expectedVersionSchema.optional(),
}).passthrough();

export const issueInputSchema = z.object({
  projectId: idSchema.optional(),
  title: z.string().trim().min(1).optional(),
  impact: z.string().nullable().optional(),
  reporter: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  requirementId: z.string().nullable().optional(),
  priority: z.enum(priorities).optional(),
  dueDate: optionalDateSchema,
  expectedVersion: expectedVersionSchema.optional(),
}).passthrough();

export const issueUpdateInputSchema = z.object({
  content: z.string().trim().min(1),
  progress: z.number().int().min(0).max(99).optional(),
  expectedVersion: expectedVersionSchema.optional(),
}).passthrough();

export const templateItemSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1),
  startOffsetDays: z.number().int().min(0),
  durationDays: z.number().int().min(1),
  milestoneLabel: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0),
});

export const templateInputSchema = z.object({
  projectId: idSchema.optional(),
  name: z.string().trim().min(1).optional(),
  description: z.string().max(2000).optional(),
  items: z.array(templateItemSchema).min(1).optional(),
}).passthrough();

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
}).passthrough();

export const projectMemberInputSchema = z.object({ role: z.enum(projectRoles).default('member') }).passthrough();
export const archiveDeleteInputSchema = z.object({ confirmName: z.string().optional() }).passthrough();
