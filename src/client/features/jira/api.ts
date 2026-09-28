import { api, InvalidResponseError, jsonBody } from '../../api';
import { jiraSettingsSchema } from '../../../shared/jira';
import type { JiraConnection, JiraImportPreview, JiraScan, JiraSettingsRecord, JiraSettings, JiraMetadataQuery, JiraProgress, JiraProgressRow, JiraRefresh, JiraTransitionOptions, JiraTransitionInput, JiraAction } from '../../../shared/jira';
import type { CreateRequirementInput, Requirement } from '../../../shared/api/requirements';
const root = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/jira`;
export const connection = () => api<JiraConnection>('/api/me/jira-connection');
export const saveConnection = (token: string) => api<JiraConnection>('/api/me/jira-connection', { method: 'PUT', body: jsonBody({ token }) });
export const removeConnection = () => api<JiraConnection>('/api/me/jira-connection', { method: 'DELETE' });
export const testConnection = () => api<JiraConnection>('/api/me/jira-connection/test', { method: 'POST', readOnly: true });
export async function settings(id: string): Promise<JiraSettingsRecord> {
  const result = await api<JiraSettingsRecord>(root(id) + '/settings');
  if (!result || !Number.isInteger(result.version) || !jiraSettingsSchema.safeParse(result.settings).success) throw new InvalidResponseError(200, false, 'Invalid Jira settings');
  return result;
}
export const metadata = <T>(id: string, query: JiraMetadataQuery) => api<T>(root(id) + '/metadata?' + new URLSearchParams(query));
export const saveSettings = (id: string, value: JiraSettings, expectedVersion: number) => api<JiraSettingsRecord>(root(id) + '/settings', { method: 'PUT', body: jsonBody({ settings: value, expectedVersion }) });
export const latestScan = (id: string) => api<JiraScan | null>(root(id) + '/scan');
export const scan = (id: string, startAt = 0, previousId?: string) => api<JiraScan>(root(id) + '/scan', { method: 'POST', body: jsonBody({ startAt, previousId }), readOnly: true });
export const bind = (id: string, requirementId: string, key: string) => api(root(id) + '/bindings', { method: 'POST', body: jsonBody({ requirementId, key }) });
export const unbind = (id: string, requirementId: string) => api(root(id) + '/bindings/' + encodeURIComponent(requirementId), { method: 'DELETE' });
export const ignore = (id: string, key: string, ignored: boolean) => api(root(id) + '/ignored', { method: 'PUT', body: jsonBody({ key, ignored }) });
export const importPreview = (id: string, key: string) => api<JiraImportPreview>(root(id) + '/import-preview', { method: 'POST', body: jsonBody({ key }), readOnly: true });
export const importRequirement = (id: string, previewId: string, value: CreateRequirementInput) => api<Requirement>(root(id) + '/imports/' + encodeURIComponent(previewId), { method: 'POST', body: jsonBody(value) });
function validRow(row: JiraProgressRow) { return row && typeof row.requirementId === 'string' && typeof row.title === 'string' && Array.isArray(row.references) && ['unread', 'success', 'failed'].includes(row.readState); }
export async function progress(id: string) {
  const result = await api<JiraProgress>(root(id) + '/progress');
  if (!Array.isArray(result?.rows) || !result.rows.every(validRow)) throw new InvalidResponseError(200, false, 'Invalid Jira progress');
  return result;
}
export async function requirementProgress(id: string, requirementId: string) {
  const result = await api<JiraProgressRow | null>(root(id) + '/requirements/' + encodeURIComponent(requirementId));
  if (result !== null && !validRow(result)) throw new InvalidResponseError(200, false, 'Invalid Jira requirement');
  return result;
}
export const requirementLink = (id: string, requirementId: string) => api<{ key: string; url: string } | null>(root(id) + '/requirements/' + encodeURIComponent(requirementId) + '/link');
export const refreshProgress = (id: string, input: { id?: string; offset?: number; requirementId?: string } = {}) => api<JiraRefresh>(root(id) + '/progress/refresh', { method: 'POST', body: jsonBody(input), readOnly: true });
export const transitionOptions = (id: string, requirementId: string) => api<JiraTransitionOptions>(root(id) + '/requirements/' + encodeURIComponent(requirementId) + '/transitions');
export const previewAction = (id: string, input: JiraTransitionInput) => api<JiraAction>(root(id) + '/action-preview', { method: 'POST', body: jsonBody(input), readOnly: true });
export const executeAction = (id: string, previewId: string) => api<JiraAction>(root(id) + '/operations/' + encodeURIComponent(previewId) + '/execute', { method: 'POST' });
export const operations = (id: string) => api<JiraAction[]>(root(id) + '/operations');
export const readAction = (id: string, operationId: string) => api<JiraAction>(root(id) + '/operations/' + encodeURIComponent(operationId));
export const recheckAction = (id: string, operationId: string, acknowledge = false) => api<JiraAction>(root(id) + '/operations/' + encodeURIComponent(operationId) + '/recheck', { method: 'POST', body: jsonBody({ acknowledge }), readOnly: true });
