import { z } from 'zod';

const id = z.string().trim().min(1).max(200);
export const jiraIssueKeySchema = z.string().trim().regex(/^[A-Z][A-Z0-9_]*-\d+$/);
export const jiraStatusSchema = z.object({ id, name: id }).strict();
export type JiraStatus = z.infer<typeof jiraStatusSchema>;
export const jiraSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  projects: z.array(id).max(30).default([]), issueTypes: z.array(id).max(30).default(['Story', 'Task']),
  labels: z.array(id).max(30).default([]), components: z.array(id).max(30).default([]), assignees: z.array(id).max(30).default([]),
  jql: z.string().trim().max(4000).default(''),
}).strict();
export type JiraSettings = z.infer<typeof jiraSettingsSchema>;
export type JiraSettingsRecord = { version: number; settings: JiraSettings };
export const jiraSetupMessages = {
  disabled: '系统管理员已停用 Jira 连接，暂时无法配置或使用。',
  deployment: '暂时无法保存 Jira 连接，请稍后重试；如果持续失败，请联系管理员检查服务配置。',
} as const;
export const jiraConnectionMessages = {
  invalidToken: 'Jira 未能验证这个 Token，请检查是否完整、是否已过期或被撤销。',
  permission: '当前 Jira 账号没有所需权限，请联系 Jira 管理员确认。',
  unavailable: '暂时无法连接 Jira，请稍后重试；如果持续失败，请联系管理员检查连接。',
  savedUnavailable: '已保存的 Jira 连接暂时无法使用。请联系管理员检查配置，不需要反复提交 Token。',
} as const;
export type JiraConnection = { configured: boolean; available: boolean; baseUrl: string; version: string; verifiedAt: string | null; identity: string | null; problem: string | null; setupIssue: keyof typeof jiraSetupMessages | null };
export type JiraProject = { id: string; key: string; name: string };
export type JiraIssueType = JiraStatus & { statuses: JiraStatus[] };
export type JiraUser = { name: string; displayName: string };
export const jiraMetadataQuerySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('projects'), version: id }).strict(),
  z.object({ kind: z.enum(['types', 'components']), project: id, version: id }).strict(),
  z.object({ kind: z.enum(['users', 'labels']), query: z.string().trim().min(1).max(200), version: id }).strict(),
]);
export type JiraMetadataQuery = z.infer<typeof jiraMetadataQuerySchema>;
export type JiraIssue = { id: string; key: string; title: string; typeId: string; type: string; status: JiraStatus; updated: string; url: string };
export const jiraAssociationLabels = { linked: '已关联', candidate: '待确认关联', none: '无对应需求', conflict: '关联冲突' } as const;
export type JiraCandidate = { id: string; title: string; reason: string };
export type JiraScanRow = {
  key: string; issue: JiraIssue | null; requirementId: string | null; requirementTitle: string | null;
  featureName: string | null; phaseName: string | null; localStatus: string | null;
  association: keyof typeof jiraAssociationLabels;
  candidates: JiraCandidate[]; ignored: boolean; problem: string | null;
};
export type JiraScan = { id: string; checkedAt: string; rows: JiraScanRow[]; nextStartAt: number | null; total: number; complete: boolean; warnings: string[] };
export type JiraProgressRow = {
  requirementId: string; title: string; featureId: string | null; featureName: string | null; phaseId: string | null; phaseName: string | null; localStatus: string;
  binding: { issueId: string; key: string; url: string } | null;
  issue: JiraIssue | null; checkedAt: string | null; readState: 'unread' | 'success' | 'failed'; problem: string | null;
  references: Array<{ key: string; reason: string }>;
};
export type JiraProgress = { rows: JiraProgressRow[] };
export type JiraRefresh = { id: string; offset: number; total: number; complete: boolean; failed: number };
export type JiraTransition = { id: string; name: string; to: JiraStatus; requiredFields: string[] };
export type JiraTransitionOptions = { requirementId: string; issue: JiraIssue; transitions: JiraTransition[]; bindingVersion: string; credentialVersion: string };
export const jiraTransitionInputSchema = z.object({ requirementId: id, transitionId: id, bindingVersion: id, credentialVersion: id, remoteUpdated: id, fromId: id, reason: z.string().trim().max(2000).default('') }).strict();
export type JiraTransitionInput = z.infer<typeof jiraTransitionInputSchema>;
export type JiraActionItem = {
  requirementId: string; title: string; issueId: string; key: string; site: string;
  from: JiraStatus; target: JiraStatus; transitionId: string; transitionName: string; reason: string;
  outcome: 'ready' | 'running' | 'success' | 'failed' | 'unknown' | 'checked' | 'partial'; message: string | null;
  observed: { status: JiraStatus; updated: string; checkedAt: string } | null;
};
export type JiraAction = { id: string; createdAt: string; state: 'preview' | 'running' | 'finished'; legacy: boolean; items: JiraActionItem[] };
export type JiraImportPreview = { id: string; issue: JiraIssue; links: Array<{ title: string; url: string; kind: 'task' | 'document' }>; warnings: string[] };
