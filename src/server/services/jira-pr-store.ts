import { createHash, randomUUID } from 'node:crypto';
import type { Actor } from '../auth';
import type { JiraPr, PrCandidate, PrItem, PrPreview, PrSource, PrStep } from '../../shared/jira-pr';
import { getDatabaseContext } from '../database-context';
import { fail, notFound } from '../errors';
import { assertJiraProject, projectBindings } from './jira-scan';
import { recordAudit } from './audit';
import { getRequirement } from './requirements';

export const livePrExecutions = new Set<string>();
export const prNow = () => new Date().toISOString();
export const prDb = () => getDatabaseContext().sqlite;
export const prHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const prBinding = (projectId: string, requirementId: string) => projectBindings(projectId).find(b => b.requirement_id === requirementId);
export const prBindingVersion = (projectId: string, requirementId: string) => prHash(prBinding(projectId, requirementId) || null);
export const newPrStep = (body: string, sourceIds: string[]): PrStep => ({ id: randomUUID(), kind: 'comment', body, generatedBody: body, sourceIds, target: null, transitionId: null, transitionName: null, comment: { state: 'pending' }, transition: { state: 'pending' } });
export const stepDone = (s: PrStep) => s.comment.state === 'success' && (s.kind === 'comment' || s.transition.state === 'success');
export const itemUnknown = (i: PrItem) => i.steps.some(s => s.comment.state === 'unknown' || s.transition.state === 'unknown');
export function persistPr(pr: JiraPr) {
  const result = prDb().prepare('UPDATE jira_prs SET version=version+1,state=?,started_at=?,payload=?,updated_at=? WHERE id=? AND version=?')
    .run(pr.state, pr.startedAt, JSON.stringify({ scope: pr.scope, collectedAt: pr.collectedAt, items: pr.items, warnings: pr.warnings }), prNow(), pr.id, pr.version);
  if (!result.changes) fail('PR 已被其他人修改，请保留当前输入并重新读取', 'STALE_WRITE', 409);
  pr.version++; pr.updatedAt = prNow();
}
export function readPr(projectId: string, actor: Actor, id: string): JiraPr {
  assertJiraProject(projectId, actor);
  const row = prDb().prepare('SELECT id,project_id AS projectId,version,state,started_at AS startedAt,created_at AS createdAt,updated_at AS updatedAt,payload FROM jira_prs WHERE id=? AND project_id=?').get(id, projectId) as (Omit<JiraPr, 'scope' | 'items' | 'warnings' | 'collectedAt'> & { payload: string }) | undefined;
  if (!row) notFound('PR 不存在');
  const { payload, ...meta } = row, pr: JiraPr = { ...meta, ...JSON.parse(payload) };
  if (pr.state === 'running' && !livePrExecutions.has(id)) {
    for (const item of pr.items) for (const step of item.steps) for (const receipt of [step.comment, step.transition]) {
      if (receipt.state === 'running') { receipt.state = 'unknown'; receipt.message = '服务已中断，请先核对 Jira 结果'; }
    }
    pr.state = 'active'; persistPr(pr);
    for (const operation of prDb().prepare("SELECT id,payload FROM jira_operations WHERE kind='pr' AND json_extract(payload,'$.prId')=? AND state='running'").all(id) as Array<{ id: string; payload: string }>) {
      const receipt = JSON.parse(operation.payload) as PrPreview;
      for (const item of receipt.items) {
        for (const step of item.steps) for (const part of [step.comment, step.transition]) if (part.state === 'running') { part.state = 'unknown'; part.message = '服务已中断，请在 PR 中核对 Jira 结果'; }
        item.outcome = item.steps.some(s => s.comment.state === 'unknown' || s.transition.state === 'unknown') ? 'unknown' : item.steps.every(stepDone) ? 'success' : 'failed';
      }
      prDb().prepare("UPDATE jira_operations SET state='finished',payload=?,updated_at=? WHERE id=?").run(JSON.stringify(receipt), prNow(), operation.id);
    }
  }
  const states = new Map((prDb().prepare('SELECT progress_id AS id,state,pr_id AS prId,comment_id AS commentId,synced_at AS syncedAt FROM jira_progress_sync WHERE project_id=?').all(projectId) as Array<{ id: string; state: PrSource['jiraSyncState']; prId: string | null; commentId: string | null; syncedAt: string | null }>).map(s => [s.id, s]));
  for (const item of pr.items) for (const source of item.sources) {
    const state = states.get(source.id);
    Object.assign(source, { jiraSyncState: state?.state || 'pending', jiraPrId: state?.prId || null, jiraCommentId: state?.commentId || null, jiraSyncedAt: state?.syncedAt || null });
  }
  for (const item of pr.items) {
    const requirement = getRequirement(item.requirementId, true, false);
    item.localStatus = requirement.status; item.localProgress = requirement.progress;
    item.basis = `本地：${requirement.executionStage.label}`;
  }
  return pr;
}
export function listPrs(projectId: string, actor: Actor) {
  assertJiraProject(projectId, actor);
  const ids = prDb().prepare('SELECT id FROM jira_prs WHERE project_id=? ORDER BY created_at DESC,rowid DESC').all(projectId) as Array<{ id: string }>;
  return ids.map(({ id }) => { const p = readPr(projectId, actor, id); return { id: p.id, version: p.version, state: p.state, createdAt: p.createdAt, updatedAt: p.updatedAt, itemCount: p.items.length }; });
}
export function assertEditable(pr: JiraPr, version: number) {
  if (pr.version !== version) fail('PR 已变化，请保留当前输入并重新读取', 'STALE_WRITE', 409);
  if (pr.state !== 'active' || pr.items.some(itemUnknown)) fail('PR 正在执行、已经结束或有待核对结果，请先处理原操作', 'DEPENDENCY_CONFLICT', 409);
}
export function prCandidates(projectId: string, actor: Actor): PrCandidate[] {
  assertJiraProject(projectId, actor);
  const requirements = prDb().prepare(`SELECT r.id AS requirementId,r.title,r.status AS localStatus,r.progress AS localProgress,r.feature_id AS featureId,f.name AS featureName,p.name AS phaseName,r.deleted_at AS archived,b.issue_key AS key
    FROM requirements r LEFT JOIN features f ON f.id=r.feature_id LEFT JOIN feature_phases p ON p.id=r.phase_id
    LEFT JOIN jira_bindings b ON b.requirement_id=r.id WHERE r.project_id=? ORDER BY f.sort_order,r.sort_order,r.created_at,r.id`).all(projectId) as Array<Omit<PrCandidate, 'sources' | 'archived'> & { archived: string | null }>;
  const sources = prDb().prepare(`SELECT u.id,u.requirement_id AS requirementId,COALESCE(u.work_item_id,u.deleted_work_item_id) AS workItemId,COALESCE(w.title,u.deleted_work_item_title) AS workItemTitle,
    u.percent,u.work_item_percent AS workItemPercent,u.content,u.event_type AS eventType,u.supersedes_id AS supersedesId,
    u.created_by_account_id AS createdByAccountId,a.username AS createdByName,u.created_at AS createdAt,u.updated_at AS updatedAt,
    COALESCE(s.state,'pending') AS jiraSyncState,s.pr_id AS jiraPrId,s.comment_id AS jiraCommentId,s.synced_at AS jiraSyncedAt,
    s.manual_account_id AS jiraManualAccountId,s.manual_reason AS jiraManualReason,s.manual_url AS jiraManualUrl
    FROM progress_updates u JOIN requirements r ON r.id=u.requirement_id LEFT JOIN work_items w ON w.id=u.work_item_id
    LEFT JOIN accounts a ON a.id=u.created_by_account_id LEFT JOIN jira_progress_sync s ON s.progress_id=u.id AND s.project_id=r.project_id
    WHERE r.project_id=? ORDER BY u.created_at,u.rowid`).all(projectId) as PrSource[];
  const byRequirement = new Map<string, PrSource[]>();
  for (const source of sources) { const list = byRequirement.get(source.requirementId) || []; list.push(source); byRequirement.set(source.requirementId, list); }
  return requirements.map(r => ({ ...r, archived: !!r.archived, sources: byRequirement.get(r.requirementId) || [] }));
}
export function claimSources(pr: JiraPr) {
  const wanted = new Set(pr.items.flatMap(i => i.steps.flatMap(s => s.sourceIds)));
  for (const row of prDb().prepare("SELECT progress_id FROM jira_progress_sync WHERE pr_id=? AND state='in_pr'").all(pr.id) as Array<{ progress_id: string }>) {
    if (!wanted.has(row.progress_id)) prDb().prepare("UPDATE jira_progress_sync SET state='pending',pr_id=NULL,updated_at=? WHERE progress_id=? AND pr_id=?").run(prNow(), row.progress_id, pr.id);
  }
  for (const item of pr.items) for (const source of item.sources.filter(s => wanted.has(s.id))) {
    const existing = prDb().prepare('SELECT state,pr_id FROM jira_progress_sync WHERE project_id=? AND progress_id=?').get(pr.projectId, source.id) as { state: string; pr_id: string | null } | undefined;
    if (existing?.state === 'synced' && existing.pr_id === pr.id) continue;
    if (existing && !(existing.state === 'pending' || existing.state === 'in_pr' && existing.pr_id === pr.id)) fail('部分进展的同步状态已变化，请重新生成草稿', 'STALE_WRITE', 409);
    prDb().prepare(`INSERT INTO jira_progress_sync(project_id,progress_id,state,pr_id,updated_at) VALUES (?,?,'in_pr',?,?)
      ON CONFLICT(project_id,progress_id) DO UPDATE SET state='in_pr',pr_id=excluded.pr_id,updated_at=excluded.updated_at`).run(pr.projectId, source.id, pr.id, prNow());
  }
}
export function markPrSourcesPublished(pr: JiraPr, step: PrStep) {
  for (const sourceId of step.sourceIds) prDb().prepare("UPDATE jira_progress_sync SET state='synced',comment_id=?,synced_at=?,updated_at=? WHERE project_id=? AND progress_id=? AND pr_id=? AND state='in_pr'")
    .run(step.comment.commentId || null, step.comment.at || prNow(), prNow(), pr.projectId, sourceId, pr.id);
  for (const item of pr.items) for (const source of item.sources) if (step.sourceIds.includes(source.id)) Object.assign(source, { jiraSyncState: 'synced', jiraPrId: pr.id, jiraCommentId: step.comment.commentId || null, jiraSyncedAt: step.comment.at || prNow() });
}
export function setProgressSyncState(projectId: string, actor: Actor, ids: string[], ignored: boolean) {
  assertJiraProject(projectId, actor);
  prDb().transaction(() => {
    for (const id of new Set(ids)) {
      if (!prDb().prepare('SELECT 1 FROM progress_updates u JOIN requirements r ON r.id=u.requirement_id WHERE u.id=? AND r.project_id=?').get(id, projectId)) notFound('进展记录不存在');
      const current = prDb().prepare('SELECT state FROM jira_progress_sync WHERE project_id=? AND progress_id=?').get(projectId, id) as { state: string } | undefined;
      if (current && !['pending', 'ignored'].includes(current.state)) fail('只能排除待同步进展或恢复已排除的进展');
      prDb().prepare(`INSERT INTO jira_progress_sync(project_id,progress_id,state,updated_at) VALUES (?,?,?,?) ON CONFLICT(project_id,progress_id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at`).run(projectId, id, ignored ? 'ignored' : 'pending', prNow());
    }
    recordAudit(actor, 'jira_pr_sources', 'project', projectId, JSON.stringify({ ids, ignored }), projectId);
  })();
  return { ok: true };
}
export function closePr(projectId: string, actor: Actor, id: string, version: number) {
  const pr = readPr(projectId, actor, id); assertEditable(pr, version);
  prDb().transaction(() => {
    pr.state = 'abandoned'; persistPr(pr);
    prDb().prepare("UPDATE jira_progress_sync SET state='pending',pr_id=NULL,updated_at=? WHERE pr_id=? AND state='in_pr'").run(prNow(), id);
    recordAudit(actor, 'jira_pr_close', 'jira_pr', id, '结束 PR，未发布的进展回到待同步', projectId);
  })();
  return pr;
}
