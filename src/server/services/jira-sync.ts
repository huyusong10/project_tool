import type { Actor } from '../auth';
import type { JiraAction, JiraActionItem, JiraTransitionInput, JiraTransitionOptions } from '../../shared/jira';
import { getDatabaseContext } from '../database-context';
import { AppError, fail, notFound } from '../errors';
import { JiraRemoteError } from '../jira/client';
import { jiraAccount, jiraSession } from './jira-connection';
import { assertJiraProject, bindingVersion, projectBindings, readJiraOperation, requireJiraEnabled, requirementFacts, storeJiraOperation, updateJiraOperation } from './jira-scan';
import { recordJiraRead } from './jira-progress';
import { recordAudit } from './audit';
import { assertJiraWriteUnlocked } from './jira-write-lock';

type Payload = { items: JiraActionItem[]; identity: string | null; bindingVersion: string; remoteUpdated: string };
const running = new Set<string>();
const legacyMessage = '旧版操作已失效，请重新打开需求操作';
export function rejectLegacyJiraSync() { return fail(legacyMessage, 'STALE_WRITE', 410); }
function binding(projectId: string, actor: Actor, requirementId: string) {
  requireJiraEnabled(projectId, actor); requirementFacts(requirementId, projectId);
  const session = jiraSession(actor), b = projectBindings(projectId).find(b => b.requirement_id === requirementId && b.site === session.site);
  if (!b) fail('请先关联当前站点的 Jira 事项', 'DEPENDENCY_CONFLICT', 409);
  return { session, binding: b, version: bindingVersion(requirementId, projectId) };
}
export async function jiraTransitionOptions(projectId: string, actor: Actor, requirementId: string): Promise<JiraTransitionOptions> {
  const current = binding(projectId, actor, requirementId), startedAt = new Date().toISOString();
  const issue = await current.session.client.issue(current.binding.issue_id), transitions = await current.session.client.transitions(issue.id);
  current.session.assertCurrent(); requireJiraEnabled(projectId, actor);
  if (bindingVersion(requirementId, projectId) !== current.version) fail('关联已变化，请重新打开操作', 'STALE_WRITE', 409);
  recordJiraRead(projectId, actor, requirementId, issue, null, startedAt);
  return { requirementId, issue, transitions, bindingVersion: current.version, credentialVersion: current.session.version };
}
export async function previewJiraAction(projectId: string, actor: Actor, input: JiraTransitionInput): Promise<JiraAction> {
  const current = await jiraTransitionOptions(projectId, actor, input.requirementId);
  if (current.bindingVersion !== input.bindingVersion || current.credentialVersion !== input.credentialVersion || current.issue.updated !== input.remoteUpdated || current.issue.status.id !== input.fromId) fail('Jira 状态或关联已变化，请重新选择操作', 'STALE_WRITE', 409);
  const transition = current.transitions.find(t => t.id === input.transitionId);
  if (!transition) fail('当前已无法执行这个操作，请重新读取可用操作', 'STALE_WRITE', 409);
  if (transition.requiredFields.length) fail('请先在 Jira 补充：' + transition.requiredFields.join('、'));
  const session = jiraSession(actor), { requirement } = requirementFacts(input.requirementId, projectId);
  const item: JiraActionItem = { requirementId: input.requirementId, title: requirement.title, issueId: current.issue.id, key: current.issue.key, site: session.site,
    from: current.issue.status, target: transition.to, transitionId: transition.id, transitionName: transition.name, reason: input.reason,
    outcome: 'ready', message: null, observed: null };
  const payload: Payload = { items: [item], identity: session.identity, bindingVersion: current.bindingVersion, remoteUpdated: current.issue.updated };
  const saved = storeJiraOperation(projectId, actor, 'transition', payload);
  return { id: saved.id, createdAt: saved.createdAt, state: 'preview', legacy: false, items: [item] };
}
function load(projectId: string, actor: Actor, id: string) {
  assertJiraProject(projectId, actor);
  const row = getDatabaseContext().sqlite.prepare("SELECT kind FROM jira_operations WHERE id=? AND project_id=? AND account_id=? AND kind IN ('sync','transition')").get(id, projectId, jiraAccount(actor)) as { kind: string } | undefined;
  if (!row) notFound('本账号的操作记录不存在');
  return { kind: row.kind, ...readJiraOperation<Payload>(id, projectId, actor, row.kind, false) };
}
export function readJiraAction(projectId: string, actor: Actor, id: string): JiraAction {
  const operation = load(projectId, actor, id), legacy = operation.kind === 'sync';
  if (operation.state === 'running' && !running.has(id)) {
    for (const item of operation.payload.items) {
      if (item.outcome === 'running') { item.outcome = 'unknown'; item.message = '服务已中断，请核对 Jira 当前状态'; }
      else if (item.outcome === 'ready') { item.outcome = 'failed'; item.message = '服务已中断，此操作未执行'; }
    }
    operation.state = 'finished'; updateJiraOperation(id, 'finished', operation.payload);
  }
  const items = operation.payload.items.map(item => legacy ? {
    ...item, transitionId: '', transitionName: '历史同步', observed: item.observed || null,
    outcome: operation.state === 'preview' ? 'failed' as const : item.outcome,
    message: operation.state === 'preview' ? legacyMessage : item.message,
  } : item);
  return { id, createdAt: operation.createdAt, state: legacy && operation.state === 'preview' ? 'finished' : operation.state as JiraAction['state'], legacy, items };
}
export function listJiraActions(projectId: string, actor: Actor) {
  assertJiraProject(projectId, actor);
  const rows = getDatabaseContext().sqlite.prepare("SELECT id FROM jira_operations WHERE project_id=? AND account_id=? AND kind IN ('sync','transition') AND state<>'preview' ORDER BY created_at DESC,rowid DESC").all(projectId, jiraAccount(actor)) as Array<{ id: string }>;
  return rows.map(r => readJiraAction(projectId, actor, r.id));
}
export async function executeJiraAction(projectId: string, actor: Actor, id: string): Promise<JiraAction> {
  const receipt = readJiraAction(projectId, actor, id);
  if (receipt.legacy) return rejectLegacyJiraSync();
  if (receipt.state !== 'preview') return receipt;
  const operation = readJiraOperation<Payload>(id, projectId, actor, 'transition');
  if (Date.now() - Date.parse(operation.createdAt) > 15 * 60_000) fail('操作预览已过期，请重新选择操作', 'STALE_WRITE', 409);
  const item = operation.payload.items[0], current = binding(projectId, actor, item.requirementId);
  if (current.version !== operation.payload.bindingVersion) fail('需求关联已变化，请重新确认', 'STALE_WRITE', 409);
  getDatabaseContext().sqlite.transaction(() => {
    assertJiraWriteUnlocked(item.issueId, item.site, id);
    const claim = getDatabaseContext().sqlite.prepare("UPDATE jira_operations SET state='running' WHERE id=? AND state='preview'").run(id);
    if (!claim.changes) fail('本次操作已提交，请读取结果', 'STALE_WRITE', 409);
    item.outcome = 'running'; updateJiraOperation(id, 'running', operation.payload);
  })();
  running.add(id);
  try {
    const transitions = await current.session.client.transitions(item.issueId), transition = transitions.find(t => t.id === item.transitionId && t.to.id === item.target.id);
    if (!transition) fail('当前已无法执行所选操作，请重新读取 Jira 状态');
    if (transition.requiredFields.length) fail('请先在 Jira 补充：' + transition.requiredFields.join('、'));
    const issue = await current.session.client.issue(item.issueId);
    if (issue.updated !== operation.payload.remoteUpdated || issue.status.id !== item.from.id) fail('Jira 状态或事项已变化，本次没有修改，请重新确认');
    current.session.assertCurrent(); requireJiraEnabled(projectId, actor);
    if (bindingVersion(item.requirementId, projectId) !== operation.payload.bindingVersion) fail('需求关联已变化，本次没有修改');
    try { await current.session.client.transition(item.issueId, item.transitionId); }
    catch (e) { if (e instanceof JiraRemoteError && e.uncertain) item.outcome = 'unknown'; throw e; }
    item.outcome = 'unknown';
    const latest = await current.session.client.issue(item.issueId);
    current.session.assertCurrent(); requireJiraEnabled(projectId, actor);
    item.observed = { status: latest.status, updated: latest.updated, checkedAt: new Date().toISOString() };
    if (bindingVersion(item.requirementId, projectId) === operation.payload.bindingVersion) recordJiraRead(projectId, actor, item.requirementId, latest);
    if (latest.status.id !== item.target.id) fail('Jira 当前状态与目标不同，请核对操作结果');
    item.outcome = 'success'; item.message = 'Jira 状态已修改';
  } catch (e) {
    if (item.outcome !== 'unknown') item.outcome = 'failed';
    item.message = e instanceof AppError ? e.message : '操作未完成，请读取结果后再处理';
    if (item.outcome === 'unknown') {
      try {
        const latest = await current.session.client.issue(item.issueId); current.session.assertCurrent(); requireJiraEnabled(projectId, actor);
        item.observed = { status: latest.status, updated: latest.updated, checkedAt: new Date().toISOString() };
        if (bindingVersion(item.requirementId, projectId) === operation.payload.bindingVersion) recordJiraRead(projectId, actor, item.requirementId, latest);
      } catch { /* An uncertain write is never sent again. */ }
    }
  } finally {
    updateJiraOperation(id, 'finished', operation.payload); running.delete(id);
    recordAudit(actor, 'jira_transition', 'jira_issue', item.key, JSON.stringify({ operationId: id, identity: operation.payload.identity, from: item.from.name, operation: item.transitionName, target: item.target.name, reason: item.reason, outcome: item.outcome, message: item.message }), projectId);
  }
  return readJiraAction(projectId, actor, id);
}
export async function recheckJiraAction(projectId: string, actor: Actor, id: string, acknowledge = false): Promise<JiraAction> {
  const receipt = readJiraAction(projectId, actor, id);
  if (receipt.state === 'running' || receipt.state === 'preview') return receipt;
  requireJiraEnabled(projectId, actor); const session = jiraSession(actor), operation = load(projectId, actor, id);
  for (const item of operation.payload.items.filter(i => i.outcome === 'unknown')) {
    if (item.site !== session.site) fail('原操作属于其他 Jira 站点，请先恢复对应站点连接');
    const latest = await session.client.issue(item.issueId); session.assertCurrent(); requireJiraEnabled(projectId, actor);
    item.observed = { status: latest.status, updated: latest.updated, checkedAt: new Date().toISOString() };
    item.message = `当前 Jira 为 ${latest.status.name}；未重发原操作`;
    if (acknowledge) { item.outcome = 'checked'; item.message += '；操作者已确认结束核对'; }
    recordAudit(actor, 'jira_recheck', 'jira_issue', item.key, item.message + '；操作 ' + id, projectId);
    const b = projectBindings(projectId).find(b => b.requirement_id === item.requirementId && b.issue_id === item.issueId && b.site === session.site);
    if (b) recordJiraRead(projectId, actor, item.requirementId, latest);
  }
  updateJiraOperation(id, operation.state, operation.payload);
  return readJiraAction(projectId, actor, id);
}
