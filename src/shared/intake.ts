import { z } from 'zod';

const key = z.string().trim().min(1).max(200);
const label = z.string().trim().min(1).max(200);
const text = z.string().trim().max(10000);
const version = z.number().int().positive();
export const organizationFields = { groupId: key.nullable().optional() };
export type Organization = { groupId?: string | null; groupName?: string | null };
export const groupAssessmentLabels = { pending: '待评估', on_track: '基本符合', off_track: '有偏差', needs_adjustment: '需要调整' } as const;
export const groupOverviewInput = z.object({
  expectation: z.string().trim().max(2000),
  progressSummary: z.string().trim().max(2000),
  assessment: z.enum(['pending', 'on_track', 'off_track', 'needs_adjustment']),
  note: z.string().trim().max(2000),
}).strict();
export type GroupOverviewInput = z.infer<typeof groupOverviewInput>;
export const emptyGroupOverview: GroupOverviewInput = { expectation: '', progressSummary: '', assessment: 'pending', note: '' };
export const groupInput = z.object({ id: key.optional(), name: label, sortOrder: z.number().int().nonnegative().default(0), expectedVersion: version.optional(), description: text.optional(), overview: groupOverviewInput.optional() }).strict();
export const groupDeleteInput = z.object({ expectedVersion: version }).strict();
export const organizationInput = z.object({ requirements: z.array(z.object({ id: key, expectedVersion: version }).strict()).min(1).max(1000), ...organizationFields }).strict().refine(v => v.groupId !== undefined, '请选择分组');
export const sourceClauseInput = z.object({ key, section: text.default(''), externalId: text.default(''), title: label, content: text.default(''), priority: text.default(''), deferredReason: text.optional() }).strict();
export const sourceDocumentInput = z.object({ key, title: label, url: z.string().url().refine(v => /^https?:\/\//i.test(v), '来源仅支持HTTP或HTTPS'), version: key, complete: z.boolean().default(false), clauses: z.array(sourceClauseInput).max(2000) }).strict();
export const sourceWriteInput = z.object({ expectedRevision: z.string(), documents: z.array(sourceDocumentInput).min(1).max(50) }).strict();
export const sourceLinkInput = z.object({ requirementId: key, workItemId: key.nullable().default(null), clauseId: key, scope: text.refine(v => !!v, '请填写本次落实范围'), expectedVersion: version, reason: text.optional(), reviewedRevisionId: key.optional() }).strict();
export const sourceLinkDeleteInput = z.object({ requirementId: key, expectedVersion: version, reason: text.optional() }).strict();
export const deferClauseInput = z.object({ expectedRevision: z.string(), reason: text }).strict();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v, '日期无效');
const url = z.string().url().refine(v => /^https?:\/\//i.test(v), '来源仅支持 HTTP 或 HTTPS');
const itemInput = z.object({ key, title: label, ownerId: key.nullable().optional(), plannedStart:date.nullable().optional(), plannedEnd:date.nullable().optional(), durationDays: z.number().int().min(1).max(3660).nullable().optional() }).strict();
export const importRequirementInput = z.object({
  key, action: z.enum(['create', 'update', 'skip']).default('create'), existingId: key.optional(), expectedVersion:version.optional(), confirmAdditional: z.boolean().default(false),
  title: label, background: text.optional(), acceptanceCriteria: text.optional(), referenceUrl:url.nullable().optional(), group: label.nullable().optional(),
  ownerId: key.nullable().optional(), plannedStart:date.nullable().optional(), plannedEnd:date.nullable().optional(), durationDays:z.number().int().min(1).max(3660).nullable().optional(),
  workItems: z.array(itemInput).max(500).default([]),
}).strict();
const endpoint = z.object({ requirement: key, workItem: key.optional() }).strict();
export const intakePackageSchema = z.object({
  formatVersion: z.literal(2), requirements: z.array(importRequirementInput).min(1).max(1000),
  dependencies: z.array(z.object({ source: endpoint, target: endpoint }).strict()).max(6000).default([]),
}).strict();
export const importPreviewInput = z.object({ package: intakePackageSchema }).strict();
export const importApplyInput = importPreviewInput.extend({ batchId: z.string().uuid(), previewToken: z.string(), expectedRevision: z.string() }).strict();
export type IntakePackage = z.infer<typeof intakePackageSchema>;
export type SourceDocumentInput = z.infer<typeof sourceDocumentInput>;
export type RequirementGroup = {
  id: string; projectId: string; name: string; sortOrder: number; version: number;
  description: string; archivedAt: string | null;
  overview: GroupOverviewInput; assessedAt: string | null; assessedBy: string | null; assessedByName: string | null;
};
export type SourceRevision = { id: string; documentVersion: string; section: string; externalId: string; title: string; content: string; priority: string };
export type SourceLink = { id: string; clauseId: string; requirementId: string; workItemId: string | null; scope: string; reviewedRevisionId: string; requirementTitle: string; requirementVersion: number; workItemTitle: string | null; status: string; deliveryScope: string; deletedAt: string | null; reviewed: SourceRevision; needsReview: boolean };
export type SourceClause = { id: string; key: string; documentId: string; deferredReason: string; current: SourceRevision; links: SourceLink[] };
export type SourceDocument = { id: string; key: string; title: string; url: string; version: string; complete: boolean; clauses: SourceClause[] };
export type IntakeCatalog = { revision: string; groups: RequirementGroup[]; documents: SourceDocument[] };
export type SourceChange = { document: string; clause: string; before: SourceRevision; after: Omit<SourceRevision,'id'> };
export type ImportPreview = { expectedRevision: string; previewToken: string; package: IntakePackage; warnings: string[]; errors: string[]; existingMatches: Array<{ requirement: string; id: string; title: string }>; differences: unknown; counts: { requirements: number; updated: number; workItems: number } };
export type ImportReceipt = { status: 'applied'; batchId: string; createdAt: string; requirementIds: Record<string,string> } | { status: 'not_found' };

export const intakeExample: IntakePackage = intakePackageSchema.parse({
  formatVersion: 2,
  requirements: [{ key: 'query', title: '查询与详情', background: 'EX-001：支持筛选和查看详情，只能查询授权范围内的数据。', referenceUrl: 'https://example.com/requirements', group: '示例模块', acceptanceCriteria: '组合筛选和详情可用；越权查询被拒绝。', workItems: [{ key: 'api', title: '查询接口' }, { key: 'ui', title: '查询页面与联调' }] }],
  dependencies: [{ source: { requirement: 'query', workItem: 'api' }, target: { requirement: 'query', workItem: 'ui' } }],
});
