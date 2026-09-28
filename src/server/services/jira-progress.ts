import { createHash } from 'node:crypto';
import type { Actor } from '../auth';
import { AppError, fail } from '../errors';
import { getDatabaseContext } from '../database-context';
import type { JiraIssue, JiraProgress, JiraProgressRow, JiraRefresh } from '../../shared/jira';
import { jiraKeyFromUrl } from '../../shared/jira-links';
import { readReferenceLinks } from '../../shared/reference-links';
import { connectionStatus, jiraAccount, jiraSession, jiraSite } from './jira-connection';
import { assertJiraProject, insertBinding, localReferences, projectBindings, readJiraOperation, requireJiraEnabled, storeJiraOperation, updateJiraOperation } from './jira-scan';

type LocalRow = Pick<JiraProgressRow, 'requirementId' | 'title' | 'featureId' | 'featureName' | 'phaseId' | 'phaseName' | 'localStatus'>;
type Cache = { requirementId: string; version: string; issue: JiraIssue | null; checkedAt: string; startedAt: string; problem: string | null };
type RefreshPayload = { queue: Array<{ id: string; version: string }>; offset: number; failed: number };
const activeRefreshes = new Set<string>();
export function jiraLocalRows(projectId: string): LocalRow[] {
  return getDatabaseContext().sqlite.prepare(`SELECT r.id AS requirementId,r.title,r.feature_id AS featureId,f.name AS featureName,
    r.phase_id AS phaseId,p.name AS phaseName,r.status AS localStatus FROM requirements r
    LEFT JOIN features f ON f.id=r.feature_id LEFT JOIN feature_phases p ON p.id=r.phase_id
    WHERE r.project_id=? AND r.deleted_at IS NULL ORDER BY r.sort_order,r.created_at,r.id`).all(projectId) as LocalRow[];
}
export function referenceVersion(projectId: string, requirementId: string) {
  const db = getDatabaseContext().sqlite;
  const ref = db.prepare('SELECT reference_links,reference_url,deleted_at FROM requirements WHERE id=? AND project_id=?').get(requirementId, projectId);
  const binding = projectBindings(projectId).find(b => b.requirement_id === requirementId);
  const exclusions = db.prepare('SELECT site,issue_id FROM jira_reference_only WHERE requirement_id=? ORDER BY site,issue_id').all(requirementId);
  return createHash('sha256').update(JSON.stringify({ ref, binding, exclusions })).digest('hex');
}
function caches(projectId: string, actor: Actor) {
  const connection = connectionStatus(actor);
  if (!connection.available || !connection.verifiedAt) return [];
  return (getDatabaseContext().sqlite.prepare("SELECT payload FROM jira_operations WHERE project_id=? AND account_id=? AND credential_version=? AND kind='jira_read' ORDER BY created_at DESC,rowid DESC").all(projectId, jiraAccount(actor), connection.version) as Array<{ payload: string }>).map(r => JSON.parse(r.payload) as Cache);
}
export function recordJiraRead(projectId: string, actor: Actor, requirementId: string, issue: JiraIssue | null, problem: string | null = null, startedAt = new Date().toISOString()) {
  const version = referenceVersion(projectId, requirementId), previous = caches(projectId, actor).find(c => c.requirementId === requirementId && c.version === version);
  if (previous && previous.startedAt > startedAt) return;
  const payload: Cache = { requirementId, version, issue: issue || previous?.issue || null, problem, startedAt, checkedAt: new Date().toISOString() };
  getDatabaseContext().sqlite.transaction(() => {
    getDatabaseContext().sqlite.prepare("DELETE FROM jira_operations WHERE project_id=? AND account_id=? AND kind='jira_read' AND json_extract(payload,'$.requirementId')=?").run(projectId, jiraAccount(actor), requirementId);
    storeJiraOperation(projectId, actor, 'jira_read', payload, 'finished');
  })();
}
export function jiraProgress(projectId: string, actor: Actor): JiraProgress {
  assertJiraProject(projectId, actor);
  const saved = caches(projectId, actor), bindings = projectBindings(projectId), references = localReferences(projectId);
  return { rows: jiraLocalRows(projectId).map(r => {
    const b = bindings.find(b => b.requirement_id === r.requirementId), refs = references.find(x => x.id === r.requirementId);
    const cache = saved.find(c => c.requirementId === r.requirementId && c.version === referenceVersion(projectId, r.requirementId));
    const problem = cache?.problem || (b && b.site !== jiraSite() ? '关联属于其他 Jira 站点，请重新关联' : null), key = cache?.issue?.id === b?.issue_id ? cache?.issue?.key : b?.issue_key;
    return { ...r, binding: b ? { issueId: b.issue_id, key: key!, url: b.site + '/browse/' + key } : null,
      issue: cache?.issue || null, checkedAt: cache?.checkedAt || null, readState: problem ? 'failed' : cache ? 'success' : 'unread', problem,
      references: b ? [] : [...new Map([...(refs?.titleKeys || []).map(key => ({ key, reason: '需求标题中的 Jira 编号' })), ...(refs?.work || []).map(key => ({ key, reason: '工作项中的 Jira 链接' })), ...(refs?.direct || []).map(key => ({ key, reason: '需求中的 Jira 链接' }))].map(ref => [ref.key, ref])).values()],
    };
  }) };
}
export async function refreshJiraProgress(projectId: string, actor: Actor, input: { id?: string; offset?: number; requirementId?: string }): Promise<JiraRefresh> {
  requireJiraEnabled(projectId, actor);
  const session = jiraSession(actor), startedAt = new Date().toISOString();
  let id = input.id, payload: RefreshPayload;
  if (id) {
    const operation = readJiraOperation<RefreshPayload>(id, projectId, actor, 'refresh'); payload = operation.payload;
    if (payload.offset !== input.offset) fail('刷新进度已变化，请重新读取列表', 'STALE_WRITE', 409);
  } else {
    const rows = jiraProgress(projectId, actor).rows.filter(r => (!input.requirementId || r.requirementId === input.requirementId) && (r.binding || r.references.some(ref => ref.reason === '需求中的 Jira 链接')));
    if (input.requirementId && !jiraLocalRows(projectId).some(r => r.requirementId === input.requirementId)) fail('需求不存在', 'NOT_FOUND', 404);
    payload = { queue: rows.map(r => ({ id: r.requirementId, version: referenceVersion(projectId, r.requirementId) })), offset: 0, failed: 0 };
    id = storeJiraOperation(projectId, actor, 'refresh', payload, 'finished').id;
  }
  if (activeRefreshes.has(id)) fail('这批需求正在刷新，请等待结果', 'STALE_WRITE', 409);
  activeRefreshes.add(id);
  try {
    const references = localReferences(projectId), batch = payload.queue.slice(payload.offset, payload.offset + 50);
    const issues = new Map<string, JiraIssue>(), failures = new Map<string, string>();
    const bindings = projectBindings(projectId), keys = [...new Set(batch.flatMap(r => {
      const b = bindings.find(b => b.requirement_id === r.id);
      return b ? b.site === session.site ? [b.issue_id] : [] : references.find(ref => ref.id === r.id)?.direct || [];
    }))];
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, keys.length) }, async () => {
      while (cursor < keys.length) {
        const key = keys[cursor++]; session.assertCurrent(); requireJiraEnabled(projectId, actor);
        try { const issue = await session.client.issue(key); issues.set(key, issue); }
        catch (e) { failures.set(key, e instanceof AppError ? e.message : '暂时无法读取 Jira 事项，请稍后重试'); }
      }
    }));
    session.assertCurrent(); requireJiraEnabled(projectId, actor);
    for (const item of batch) {
      if (referenceVersion(projectId, item.id) !== item.version) { payload.failed++; continue; }
      let binding = projectBindings(projectId).find(b => b.requirement_id === item.id);
      const direct = references.find(r => r.id === item.id)?.direct || [];
      let problem: string | null = binding && binding.site !== session.site ? '关联属于其他 Jira 站点，请重新关联' : null;
      let issue = binding ? issues.get(binding.issue_id) : undefined;
      if (binding) problem ||= failures.get(binding.issue_id) || null;
      else {
        const resolved = direct.map(key => issues.get(key));
        problem = direct.map(key => failures.get(key)).find(Boolean) || null;
        if (!problem && resolved.length && resolved.every(i => i && i.id === resolved[0]!.id)) {
          issue = resolved[0];
          const refKeys = new Set([...direct, issue!.key]);
          const competing = references.some(r => r.id !== item.id && r.direct.some(k => refKeys.has(k) || issues.get(k)?.id === issue!.id));
          const foreign = (getDatabaseContext().sqlite.prepare('SELECT r.reference_links,r.reference_url FROM requirements r JOIN projects p ON p.id=r.project_id WHERE r.project_id<>? AND r.deleted_at IS NULL AND p.deleted_at IS NULL').all(projectId) as Array<{ reference_links: string; reference_url: string | null }>).some(r => readReferenceLinks(r.reference_links, r.reference_url).some(l => refKeys.has(jiraKeyFromUrl(l.url, session.site) || '')));
          const excluded = getDatabaseContext().sqlite.prepare('SELECT 1 FROM jira_reference_only WHERE requirement_id=? AND site=? AND issue_id=?').get(item.id, session.site, issue!.id);
          const ignored = getDatabaseContext().sqlite.prepare('SELECT 1 FROM jira_ignored WHERE project_id=? AND site=? AND issue_key IN (' + [...refKeys].map(() => '?').join(',') + ')').get(projectId, session.site, ...refKeys);
          if (competing || foreign) problem = '多个需求引用此 Jira 事项，请人工确认关联';
          else if (!excluded && !ignored) {
            try { insertBinding(projectId, actor, item.id, issue!, '需求唯一 Jira 链接'); binding = projectBindings(projectId).find(b => b.requirement_id === item.id); }
            catch (e) { problem = e instanceof AppError ? e.message : '关联未完成，请人工确认'; }
          }
        } else if (!problem && direct.length > 1) problem = '需求包含多个 Jira 事项，请选择主要关联';
      }
      if (problem) payload.failed++;
      if (binding || problem) recordJiraRead(projectId, actor, item.id, binding ? issue || null : null, problem, startedAt);
    }
    payload.offset += batch.length;
    updateJiraOperation(id, 'finished', payload);
    return { id, offset: payload.offset, total: payload.queue.length, complete: payload.offset === payload.queue.length, failed: payload.failed };
  } finally { activeRefreshes.delete(id); }
}
