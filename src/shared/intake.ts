import { z } from 'zod';

const key = z.string().trim().min(1).max(200);
const label = z.string().trim().min(1).max(200);
const text = z.string().trim().max(10000);
const version = z.number().int().positive();
export const tagsSchema = z.array(label).max(30).transform(values => [...new Set(values)]);
export const organizationFields = { groupId: key.nullable().optional(), tags: tagsSchema.optional() };
export type Organization = { groupId?: string | null; groupName?: string | null; tags?: string[] };
export const groupInput = z.object({ id: key.optional(), name: label, sortOrder: z.number().int().nonnegative().default(0), expectedVersion: version.optional() }).strict();
export const groupDeleteInput = z.object({ expectedVersion: version }).strict();
export const organizationInput = z.object({ requirements: z.array(z.object({ id: key, expectedVersion: version }).strict()).min(1).max(1000), ...organizationFields }).strict().refine(v => v.groupId !== undefined || v.tags !== undefined, '请选择分组或标签');
export const sourceClauseInput = z.object({ key, section: text.default(''), externalId: text.default(''), title: label, content: text.default(''), priority: text.default(''), deferredReason: text.optional() }).strict();
export const sourceDocumentInput = z.object({ key, title: label, url: z.union([z.literal(''),z.string().url().refine(v => /^https?:\/\//i.test(v), '来源仅支持HTTP或HTTPS')]).default(''), version: z.string().trim().max(200).default(''), complete: z.boolean().default(false), clauses: z.array(sourceClauseInput).max(2000) }).strict();
export const sourceWriteInput = z.object({ expectedRevision: z.string(), documents: z.array(sourceDocumentInput).min(1).max(50) }).strict();
export const sourceLinkInput = z.object({ requirementId: key, workItemId: key.nullable().default(null), clauseId: key, scope: text.refine(v => !!v, '请填写本次落实范围'), expectedVersion: version, reason: text.optional(), reviewedRevisionId: key.optional() }).strict();
export const sourceLinkDeleteInput = z.object({ requirementId: key, expectedVersion: version, reason: text.optional() }).strict();
export const deferClauseInput = z.object({ expectedRevision: z.string(), reason: text }).strict();
const itemInput = z.object({ key, title: label, ownerId: key.nullable().optional(), durationDays: z.number().int().min(1).max(3660).nullable().optional() }).strict();
export const importRequirementInput = z.object({
  key, action: z.enum(['create', 'link', 'skip']).default('create'), existingId: key.optional(), confirmAdditional: z.boolean().default(false),
  title: label, background: text.default(''), acceptanceCriteria: text.default(''), group: label.nullable().optional(), tags: tagsSchema.default([]),
  ownerId: key.nullable().optional(), deliveryScope: z.enum(['candidate','committed']).default('candidate'),
  workItems: z.array(itemInput).max(500).default([]),
}).strict();
export const importLinkInput = z.object({ requirement: key, workItem: key.optional(), document: key, clause: key, scope: text.refine(v => !!v, '请填写本次落实范围') }).strict();
const endpoint = z.object({ requirement: key, workItem: key.optional() }).strict();
export const intakePackageSchema = z.object({
  formatVersion: z.literal(1), documents: z.array(sourceDocumentInput).max(50).default([]),
  requirements: z.array(importRequirementInput).max(1000).default([]), links: z.array(importLinkInput).max(6000).default([]),
  dependencies: z.array(z.object({ source: endpoint, target: endpoint }).strict()).max(6000).default([]),
}).strict();
export const importPreviewInput = z.object({ package: intakePackageSchema }).strict();
export const importApplyInput = importPreviewInput.extend({ batchId: z.string().uuid(), previewToken: z.string(), expectedRevision: z.string() }).strict();
export type IntakePackage = z.infer<typeof intakePackageSchema>;
export type SourceDocumentInput = z.infer<typeof sourceDocumentInput>;
export type RequirementGroup = { id: string; projectId: string; name: string; sortOrder: number; version: number };
export type SourceRevision = { id: string; documentVersion: string; section: string; externalId: string; title: string; content: string; priority: string };
export type SourceLink = { id: string; clauseId: string; requirementId: string; workItemId: string | null; scope: string; reviewedRevisionId: string; requirementTitle: string; requirementVersion: number; workItemTitle: string | null; status: string; deliveryScope: string; deletedAt: string | null; reviewed: SourceRevision; needsReview: boolean };
export type SourceClause = { id: string; key: string; documentId: string; deferredReason: string; current: SourceRevision; links: SourceLink[] };
export type SourceDocument = { id: string; key: string; title: string; url: string; version: string; complete: boolean; clauses: SourceClause[] };
export type IntakeCatalog = { revision: string; groups: RequirementGroup[]; tags: string[]; documents: SourceDocument[] };
export type SourceChange = { document: string; clause: string; before: SourceRevision; after: Omit<SourceRevision,'id'> };
export type ImportPreview = { expectedRevision: string; previewToken: string; package: IntakePackage; warnings: string[]; errors: string[]; existingMatches: Array<{ requirement: string; id: string; title: string }>; sourceChanges: SourceChange[]; differences: unknown; counts: { requirements: number; workItems: number; documents: number; clauses: number; links: number } };
export type ImportReceipt = { status: 'applied'; batchId: string; createdAt: string; requirementIds: Record<string,string> } | { status: 'not_found' };

export const intakeExample: IntakePackage = intakePackageSchema.parse({
  formatVersion: 1,
  documents: [{ key: 'example', title: '示例需求说明', url: 'https://example.com/requirements', version: '1', clauses: [
    { key: 'query', section: '功能需求', externalId: 'EX-001', title: '查询与详情', content: '支持筛选和查看详情。' },
    { key: 'access', section: '验收要求', externalId: 'EX-001', title: '查询权限', content: '只能查询授权范围内的数据。' },
  ] }],
  requirements: [{ key: 'query-delivery', title: '查询与详情可用', group: '示例模块', tags: ['中心'], acceptanceCriteria: '组合筛选和详情可用；越权查询被拒绝。', workItems: [{ key: 'api', title: '查询接口' }, { key: 'ui', title: '查询页面与联调' }] }],
  links: [{ requirement: 'query-delivery', document: 'example', clause: 'query', scope: '实现筛选与详情' }, { requirement: 'query-delivery', document: 'example', clause: 'access', scope: '验证授权范围' }],
  dependencies: [{ source: { requirement: 'query-delivery', workItem: 'api' }, target: { requirement: 'query-delivery', workItem: 'ui' } }],
});
