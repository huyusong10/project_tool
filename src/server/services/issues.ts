import { randomUUID } from 'node:crypto';
import { sqlite } from '../database';
import type { Actor } from '../auth';
import { issueStatuses, isOverdueByWorkday, priorities, todayIso } from '../../shared/domain';
import { fail, forbidden, notFound } from '../errors';
import { recordAudit as audit } from './audit';
import {
  assertExpectedVersion,
  assertTransition,
  ensureEnum,
  nowIso,
  nullableDate,
  nullableLabel,
  nullableText,
  requireDate,
  requireLabel,
  requireProgress,
  requireText,
  row,
  rows,
  type JsonObject,
} from './support';

export type IssueUpdateRecord = {
  id: string; issueId: string; progress: number | null; content: string; eventType: string; supersedesId: string | null; createdByAccountId: string | null; createdByName: string | null; createdAt: string; updatedAt: string;
};

export type IssueRecord = {
  id: string; projectId: string; projectName: string; requirementId: string | null; requirementTitle: string | null;
  sourceRef: string | null; title: string; impact: string | null; reporter: string | null;
  ownerId: string | null; ownerName: string | null; status: string; priority: string; progress: number;
  discoveredAt: string; dueDate: string | null; resolvedAt: string | null;
  version: number; createdAt: string; updatedAt: string; latestUpdate: string | null; latestUpdateAt: string | null;
  overdue: boolean; updates?: IssueUpdateRecord[];
};

const issueSelect = `SELECT i.id, i.project_id AS projectId, pr.name AS projectName,
  i.requirement_id AS requirementId, r.title AS requirementTitle, i.source_ref AS sourceRef,
  i.title, i.impact, i.reporter, i.owner_id AS ownerId, p.name AS ownerName,
  i.status, i.priority, i.progress, i.discovered_at AS discoveredAt, i.due_date AS dueDate,
  i.resolved_at AS resolvedAt, i.version, i.created_at AS createdAt, i.updated_at AS updatedAt,
  (SELECT u.content FROM issue_updates u WHERE u.issue_id=i.id ORDER BY u.created_at DESC, u.id DESC LIMIT 1) AS latestUpdate,
  (SELECT u.created_at FROM issue_updates u WHERE u.issue_id=i.id ORDER BY u.created_at DESC, u.id DESC LIMIT 1) AS latestUpdateAt
  FROM issues i JOIN projects pr ON pr.id=i.project_id
  LEFT JOIN requirements r ON r.id=i.requirement_id
  LEFT JOIN people p ON p.id=i.owner_id`;

function appendIssueEvent(issueId: string, eventType: string, content: string, actor: Actor, progress: number | null = null, supersedesId: string | null = null, createdAt = nowIso()) {
  sqlite.prepare(`INSERT INTO issue_updates
    (id, issue_id, progress, content, event_type, supersedes_id, created_by_account_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), issueId, progress, content, eventType, supersedesId, actor.accountId || null, createdAt, createdAt);
}

function enrichIssue(issue: Omit<IssueRecord, 'overdue'> & Partial<Pick<IssueRecord, 'overdue'>>): IssueRecord {
  return { ...issue, overdue: issue.status !== 'resolved' && isOverdueByWorkday(issue.dueDate) } as IssueRecord;
}

function requireActiveProject(projectId: string) {
  if (!row('SELECT id FROM projects WHERE id=? AND deleted_at IS NULL', projectId)) notFound('项目不存在');
}

function issueRequirement(projectId: string, value: unknown) {
  const requirementId = nullableText(value);
  if (requirementId && !row('SELECT id FROM requirements WHERE id=? AND project_id=? AND deleted_at IS NULL', requirementId, projectId)) {
    fail('关联需求不存在或不属于当前项目');
  }
  return requirementId;
}

function issueOwner(projectId: string, value: unknown) {
  const ownerId = nullableText(value);
  if (ownerId && !row(`SELECT p.id FROM people p JOIN project_people pp ON pp.person_id=p.id
    WHERE p.id=? AND pp.project_id=? AND pp.project_role IN ('member','manager')
      AND p.deleted_at IS NULL AND p.active=1`, ownerId, projectId)) {
    fail('负责人必须是当前项目中已启用的成员或项目经理');
  }
  return ownerId;
}

export function listIssues(filters: {
  projectId?: string; q?: string; status?: string; priority?: string; ownerId?: string;
  requirementId?: string; scope?: string; overdue?: string | boolean; unassigned?: string | boolean;
  active?: string | boolean; page?: number; pageSize?: number;
} = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.projectId) { where.push('i.project_id=?'); params.push(filters.projectId); }
  const q = String(filters.q || '').trim();
  if (q) {
    where.push(`(search_score(i.title, ?)>0 OR search_plain_match(COALESCE(i.impact, ''), ?)=1
      OR search_score(COALESCE(i.reporter, ''), ?)>0 OR search_plain_match(COALESCE(i.source_ref, ''), ?)=1
      OR search_score(COALESCE(r.title, ''), ?)>0 OR search_score(COALESCE(p.name, ''), ?)>0 OR EXISTS (
        SELECT 1 FROM issue_updates search_update WHERE search_update.issue_id=i.id AND search_plain_match(search_update.content, ?)=1
      ))`);
    params.push(q, q, q, q, q, q, q);
  }
  if (filters.status) {
    const status = ensureEnum(filters.status, issueStatuses, '问题状态');
    where.push('i.status=?'); params.push(status);
  }
  if (filters.priority) {
    const priority = ensureEnum(filters.priority, priorities, '问题优先级');
    where.push('i.priority=?'); params.push(priority);
  }
  if (filters.ownerId) { where.push('i.owner_id=?'); params.push(filters.ownerId); }
  if (filters.requirementId) { where.push('i.requirement_id=?'); params.push(filters.requirementId); }
  if (filters.scope === 'public') where.push('i.requirement_id IS NULL');
  if (filters.active === true || filters.active === 'true') where.push(`i.status<>'resolved'`);
  if (filters.overdue === true || filters.overdue === 'true') {
    where.push(`i.status<>'resolved' AND i.due_date IS NOT NULL AND business_day_delta(i.due_date, ?)>0`); params.push(todayIso());
  }
  if (filters.unassigned === true || filters.unassigned === 'true') where.push('i.owner_id IS NULL');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(filters.pageSize) || 50));
  const countFrom = `FROM issues i JOIN projects pr ON pr.id=i.project_id
    LEFT JOIN requirements r ON r.id=i.requirement_id LEFT JOIN people p ON p.id=i.owner_id`;
  const total = row<{ count: number }>(`SELECT COUNT(*) AS count ${countFrom} ${clause}`, ...params)?.count || 0;
  const items = rows<IssueRecord>(`${issueSelect} ${clause}
    ORDER BY CASE WHEN i.status='resolved' THEN 1 ELSE 0 END,
      CASE WHEN i.status<>'resolved' AND i.due_date IS NOT NULL AND business_day_delta(i.due_date, ?)>0 THEN 0 ELSE 1 END,
      CASE i.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
      CASE WHEN i.due_date IS NULL THEN 1 ELSE 0 END, i.due_date,
      CASE i.status WHEN 'in_progress' THEN 0 WHEN 'deferred' THEN 1 ELSE 2 END,
      i.updated_at DESC, i.id
    LIMIT ? OFFSET ?`, ...params, todayIso(), pageSize, (page - 1) * pageSize).map(enrichIssue);
  const summaryWhere = filters.projectId ? 'WHERE project_id=?' : '';
  const summaryParams = filters.projectId ? [filters.projectId] : [];
  const rawSummary = row<Record<string, number | null>>(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) AS inProgress,
    SUM(CASE WHEN status='deferred' THEN 1 ELSE 0 END) AS deferred,
    SUM(CASE WHEN status='resolved' THEN 1 ELSE 0 END) AS resolved,
    SUM(CASE WHEN status<>'resolved' THEN 1 ELSE 0 END) AS active,
    SUM(CASE WHEN status<>'resolved' AND priority IN ('P0','P1') THEN 1 ELSE 0 END) AS highPriority,
    SUM(CASE WHEN status<>'resolved' AND due_date IS NOT NULL AND business_day_delta(due_date, ?)>0 THEN 1 ELSE 0 END) AS overdue,
    SUM(CASE WHEN owner_id IS NULL AND status<>'resolved' THEN 1 ELSE 0 END) AS unassigned
    FROM issues ${summaryWhere}`, todayIso(), ...summaryParams) || {};
  const totalSummary = Number(rawSummary.total || 0);
  const resolvedSummary = Number(rawSummary.resolved || 0);
  const summary = {
    total: totalSummary,
    inProgress: Number(rawSummary.inProgress || 0), deferred: Number(rawSummary.deferred || 0),
    resolved: resolvedSummary, active: Number(rawSummary.active || 0),
    highPriority: Number(rawSummary.highPriority || 0), overdue: Number(rawSummary.overdue || 0),
    unassigned: Number(rawSummary.unassigned || 0),
    closureRate: totalSummary ? Math.round((resolvedSummary / totalSummary) * 1000) / 10 : 0,
  };
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), summary };
}

export function getIssue(id: string) {
  const issue = row<IssueRecord>(`${issueSelect} WHERE i.id=?`, id);
  if (!issue) notFound('问题不存在');
  const updates = rows<IssueUpdateRecord>(`SELECT u.id, u.issue_id AS issueId, u.progress, u.content,
    u.event_type AS eventType, u.supersedes_id AS supersedesId,
    u.created_by_account_id AS createdByAccountId, a.username AS createdByName,
    u.created_at AS createdAt, u.updated_at AS updatedAt FROM issue_updates u
    LEFT JOIN accounts a ON a.id=u.created_by_account_id
    WHERE u.issue_id=? ORDER BY u.created_at DESC, u.id DESC`, id);
  return { ...enrichIssue(issue), updates };
}

export function createIssue(input: JsonObject, actor: Actor) {
  const id = randomUUID(); const projectId = requireText(input.projectId, '项目'); requireActiveProject(projectId);
  const title = requireLabel(input.title, '问题标题');
  const requirementId = issueRequirement(projectId, input.requirementId);
  const priority = input.priority === undefined ? 'P2' : ensureEnum(input.priority, priorities, '问题优先级');
  const discoveredAt = input.discoveredAt === undefined ? todayIso() : requireDate(input.discoveredAt, '发现日期');
  const dueDate = nullableDate(input.dueDate, '目标日期');
  const now = nowIso();
  sqlite.prepare(`INSERT INTO issues
    (id, project_id, requirement_id, source_ref, title, impact, reporter, owner_id, status, priority,
      progress, discovered_at, due_date, resolved_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, projectId, requirementId, nullableLabel(input.sourceRef, '来源标识'), title, nullableText(input.impact),
    nullableLabel(input.reporter, '提出人'), issueOwner(projectId, input.ownerId), 'in_progress', priority, 0, discoveredAt, dueDate, null, now, now,
  );
  audit(actor, 'create', 'issue', id, `创建问题：${title}`);
  return getIssue(id);
}

export function updateIssue(id: string, input: JsonObject, actor: Actor) {
  const current = getIssue(id); const projectId = current.projectId;
  assertExpectedVersion(input, current.version);
  if (current.status === 'resolved') fail('已解决问题已锁定，请使用重开或纠错操作', 'TERMINAL_LOCKED');
  if (['status', 'progress', 'resolvedAt'].some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    fail('问题状态、完成度和解决日期不能通过普通编辑修改');
  }
  const title = input.title === undefined ? current.title : requireLabel(input.title, '问题标题');
  const requirementId = input.requirementId === undefined ? current.requirementId : issueRequirement(projectId, input.requirementId);
  const sourceRef = input.sourceRef === undefined ? current.sourceRef : nullableLabel(input.sourceRef, '来源标识');
  const ownerId = input.ownerId === undefined ? current.ownerId : issueOwner(projectId, input.ownerId);
  const priority = input.priority === undefined ? current.priority : ensureEnum(input.priority, priorities, '问题优先级');
  const now = nowIso();
  const dueDate = current.status === 'deferred' ? null : input.dueDate === undefined ? current.dueDate : nullableDate(input.dueDate, '目标日期');
  sqlite.transaction(() => {
    sqlite.prepare(`UPDATE issues SET requirement_id=?, source_ref=?, title=?, impact=?, reporter=?, owner_id=?,
      priority=?, discovered_at=?, due_date=?, version=version+1, updated_at=? WHERE id=? AND version=?`).run(
      requirementId, sourceRef, title,
      input.impact === undefined ? current.impact : nullableText(input.impact),
      input.reporter === undefined ? current.reporter : nullableLabel(input.reporter, '提出人'),
      ownerId, priority,
      input.discoveredAt === undefined ? current.discoveredAt : requireDate(input.discoveredAt, '发现日期'),
      dueDate, now, id, current.version,
    );
    audit(actor, 'update', 'issue', id, `更新问题：${title}`);
  })();
  return getIssue(id);
}

export function addIssueUpdate(issueId: string, input: JsonObject, actor: Actor, permissions: { canSetProgress: boolean; canResolve: boolean }) {
  const issue = getIssue(issueId); const content = requireText(input.content, '进展内容');
  if (issue.status === 'resolved') fail('已解决问题不能再追加进展，请先由项目经理重新打开', 'TERMINAL_LOCKED');
  const hasProgress = input.progress !== undefined && nullableText(input.progress) !== null;
  if (hasProgress && !permissions.canSetProgress) forbidden('只有问题负责人或项目经理可以更新问题完成度');
  const progress = hasProgress ? requireProgress(input.progress, '问题完成度') : null;
  if (progress === 100) fail('100%只能由项目经理通过“确认解决”提交');
  if (progress !== null && issue.status !== 'in_progress') fail('只有处理中问题可以更新完成度', 'INVALID_TRANSITION');
  if (progress !== null && progress < issue.progress) fail('普通进展不能降低完成度，请由项目经理执行纠错');
  if (progress !== null) assertExpectedVersion(input, issue.version);
  const id = randomUUID(); const now = nowIso();
  sqlite.transaction(() => {
    sqlite.prepare(`INSERT INTO issue_updates (id, issue_id, progress, content, event_type, created_by_account_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, issueId, progress, content, progress === null ? 'note' : 'progress', actor.accountId || null, now, now);
    if (progress !== null) sqlite.prepare(`UPDATE issues SET progress=?, version=version+1, updated_at=? WHERE id=? AND version=?`)
      .run(progress, now, issueId, issue.version);
  })();
  audit(actor, 'create', 'issue_update', id, `追加问题进展：${issue.title} · ${content.slice(0, 50)}`);
  return getIssue(issueId);
}

function issueStateEvent(id: string, action: 'defer' | 'resume' | 'resolve', input: JsonObject, actor: Actor) {
  const current = getIssue(id); assertExpectedVersion(input, current.version); const now = nowIso();
  const content = action === 'defer' ? requireText(input.reason, '挂起原因')
    : action === 'resume' ? requireText(input.reason, '恢复原因')
      : requireText(input.content, '闭环说明');
  if (action === 'defer') assertTransition(current.status, ['in_progress'], '挂起');
  if (action === 'resume') assertTransition(current.status, ['deferred'], '恢复');
  if (action === 'resolve') assertTransition(current.status, ['in_progress'], '确认解决');
  sqlite.transaction(() => {
    if (action === 'defer') sqlite.prepare(`UPDATE issues SET status='deferred', due_date=NULL, version=version+1, updated_at=? WHERE id=? AND version=?`).run(now, id, current.version);
    if (action === 'resume') sqlite.prepare(`UPDATE issues SET status='in_progress', version=version+1, updated_at=? WHERE id=? AND version=?`).run(now, id, current.version);
    if (action === 'resolve') sqlite.prepare(`UPDATE issues SET status='resolved', progress=100, resolved_at=?, version=version+1, updated_at=? WHERE id=? AND version=?`).run(todayIso(), now, id, current.version);
    appendIssueEvent(id, action, content, actor, action === 'resolve' ? 100 : current.progress, null, now);
    audit(actor, action, 'issue', id, `${action === 'defer' ? '挂起' : action === 'resume' ? '恢复处理' : '确认解决'}问题：${current.title}`);
  })();
  return getIssue(id);
}

export const deferIssue = (id: string, input: JsonObject, actor: Actor) => issueStateEvent(id, 'defer', input, actor);
export const resumeIssue = (id: string, input: JsonObject, actor: Actor) => issueStateEvent(id, 'resume', input, actor);
export const resolveIssue = (id: string, input: JsonObject, actor: Actor) => issueStateEvent(id, 'resolve', input, actor);

export function reopenIssue(id: string, input: JsonObject, actor: Actor) {
  const current = getIssue(id); assertExpectedVersion(input, current.version); assertTransition(current.status, ['resolved'], '重开');
  const reason = requireText(input.reason, '重开原因');
  const requested = input.progress === undefined ? (current.ownerId ? 99 : 0) : requireProgress(input.progress, '恢复进度');
  if (requested >= 100) fail('恢复进度必须小于100%');
  const now = nowIso();
  sqlite.transaction(() => {
    sqlite.prepare(`UPDATE issues SET status='in_progress', progress=?, resolved_at=NULL, version=version+1, updated_at=? WHERE id=? AND version=?`)
      .run(requested, now, id, current.version);
    appendIssueEvent(id, 'reopen', reason, actor, requested, null, now);
    audit(actor, 'reopen', 'issue', id, `重开问题：${current.title}`);
  })();
  return getIssue(id);
}

export function correctIssue(id: string, input: JsonObject, actor: Actor) {
  const current = getIssue(id); assertExpectedVersion(input, current.version); const reason = requireText(input.reason, '纠错原因');
  const progress = input.progress === undefined ? current.progress : requireProgress(input.progress, '问题完成度');
  if (current.status === 'resolved' && progress !== 100) fail('已解决问题降低进度时必须使用重开操作', 'TERMINAL_LOCKED');
  if (current.status !== 'resolved' && progress >= 100) fail('100%只能通过“确认解决”产生');
  const title = input.title === undefined ? current.title : requireLabel(input.title, '问题标题');
  const resolvedAt = input.resolvedAt === undefined ? current.resolvedAt : nullableDate(input.resolvedAt, '解决日期');
  if (current.status === 'resolved' && !resolvedAt) fail('已解决问题必须保留解决日期');
  const now = nowIso();
  sqlite.transaction(() => {
    sqlite.prepare(`UPDATE issues SET title=?, impact=?, resolved_at=?, progress=?, version=version+1, updated_at=? WHERE id=? AND version=?`).run(
      title, input.impact === undefined ? current.impact : nullableText(input.impact), resolvedAt, progress, now, id, current.version,
    );
    appendIssueEvent(id, 'correction', reason, actor, progress, nullableText(input.supersedesId), now);
    audit(actor, 'correct', 'issue', id, `纠错问题：${current.title}`);
  })();
  return getIssue(id);
}

export function updateIssueUpdate(issueId: string, updateId: string, _input: JsonObject, _actor: Actor) {
  if (!row('SELECT id FROM issue_updates WHERE id=? AND issue_id=?', updateId, issueId)) notFound('问题进展不存在');
  fail('问题历史为只追加记录，不能修改；如需更正请追加纠错记录', 'HISTORY_IMMUTABLE');
}

export function deleteIssueUpdate(issueId: string, updateId: string, _actor: Actor) {
  if (!row('SELECT id FROM issue_updates WHERE id=? AND issue_id=?', updateId, issueId)) notFound('问题进展不存在');
  fail('问题历史为只追加记录，不能删除', 'HISTORY_IMMUTABLE');
}
