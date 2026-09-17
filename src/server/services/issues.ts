import { randomUUID } from 'node:crypto';
import { isOverdueByWorkday, issueStatuses, priorities, todayIso } from '../../shared/domain';
import type { Actor } from '../auth';
import { assertProjectManager, assertProjectMember, canUpdateIssueProgress, requireAuthorizationActor } from '../authorization';
import { getDatabaseContext } from '../database-context';
import { fail, forbidden, notFound } from '../errors';
import { recordAudit as audit } from './audit';
import { assertExpectedVersion, assertHistoricalProjectPeople, assertTransition, assertVersionedWrite, changeSnapshot, describeChanges, ensureEnum, nowIso, nullableDate, nullableLabel, nullableText, requireDate, requireLabel, requireProgress, requireText, row, rows, type JsonObject } from './support';

export type IssueUpdateRecord = {
  id: string; issueId: string; progress: number | null; content: string; eventType: string; supersedesId: string | null; createdByAccountId: string | null; createdByName: string | null; createdAt: string; updatedAt: string;
};

export type IssueRecord = {
  nextReviewAt:string|null;
  id: string; projectId: string; projectName: string; requirementId: string | null; requirementTitle: string | null;
  sourceRef: string | null; title: string; impact: string | null; reporter: string | null;
  ownerId: string | null; ownerName: string | null; status: string; priority: string; progress: number;
  discoveredAt: string; dueDate: string | null; resolvedAt: string | null;
  version: number; createdAt: string; updatedAt: string; latestUpdate: string | null; latestUpdateAt: string | null;
  overdue: boolean; updates?: IssueUpdateRecord[];
};

// 同毫秒记录按表内写入顺序排序；随机UUID不代表事件先后。
const issueSelect = `SELECT i.next_review_at AS nextReviewAt,i.id, i.project_id AS projectId, pr.name AS projectName,
  i.requirement_id AS requirementId, r.title AS requirementTitle, i.source_ref AS sourceRef,
  i.title, i.impact, i.reporter, i.owner_id AS ownerId, p.name AS ownerName,
  i.status, i.priority, i.progress, i.discovered_at AS discoveredAt, i.due_date AS dueDate,
  i.resolved_at AS resolvedAt, i.version, i.created_at AS createdAt, i.updated_at AS updatedAt,
  (SELECT u.content FROM issue_updates u WHERE u.issue_id=i.id ORDER BY u.created_at DESC, u.rowid DESC LIMIT 1) AS latestUpdate,
  (SELECT u.created_at FROM issue_updates u WHERE u.issue_id=i.id ORDER BY u.created_at DESC, u.rowid DESC LIMIT 1) AS latestUpdateAt
  FROM issues i JOIN projects pr ON pr.id=i.project_id
  LEFT JOIN requirements r ON r.id=i.requirement_id
  LEFT JOIN people p ON p.id=i.owner_id`;

function appendIssueEvent(issueId: string, eventType: string, content: string, actor: Actor, progress: number | null = null, supersedesId: string | null = null, createdAt = nowIso()) {
  getDatabaseContext().sqlite.prepare(`INSERT INTO issue_updates
    (id, issue_id, progress, content, event_type, supersedes_id, created_by_account_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), issueId, progress, content, eventType, supersedesId, actor.accountId || null, createdAt, createdAt);
}

function enrichIssue(issue: Omit<IssueRecord, 'overdue'> & Partial<Pick<IssueRecord, 'overdue'>>, asOfDate = todayIso()): IssueRecord {
  return { ...issue, overdue: issue.status !== 'resolved' && isOverdueByWorkday(issue.dueDate, asOfDate) } as IssueRecord;
}

function requireActiveProject(projectId: string, afterWrite = false) {
  if (row('SELECT id FROM projects WHERE id=? AND deleted_at IS NULL', projectId)) return;
  if (afterWrite) fail('项目已归档，不能继续写入', 'DEPENDENCY_CONFLICT', 409);
  notFound('项目不存在');
}

function issueRequirement(projectId: string, value: unknown, afterWrite = false) {
  const requirementId = nullableText(value);
  if (requirementId && !row('SELECT id FROM requirements WHERE id=? AND project_id=? AND deleted_at IS NULL', requirementId, projectId)) {
    if (afterWrite) fail('关联需求已归档，不能继续写入', 'DEPENDENCY_CONFLICT', 409);
    fail('关联需求不存在或不属于当前项目');
  }
  return requirementId;
}

function issueOwner(projectId: string, value: unknown, conflict = false) {
  const ownerId = nullableText(value);
  if (ownerId && !row(`SELECT p.id FROM people p JOIN project_people pp ON pp.person_id=p.id
    WHERE p.id=? AND pp.project_id=? AND pp.project_role IN ('member','manager')
      AND p.deleted_at IS NULL AND p.active=1
      AND EXISTS (SELECT 1 FROM accounts a WHERE a.person_id=p.id AND a.status='active' AND a.deleted_at IS NULL)`, ownerId, projectId)) {
    fail('负责人必须是当前项目中账号有效的成员或项目经理', conflict ? 'DEPENDENCY_CONFLICT' : 'VALIDATION_ERROR', conflict ? 409 : 400);
  }
  return ownerId;
}

function assertIssueParentMutable(issue: Pick<IssueRecord, 'requirementId'>) {
  if (issue.requirementId && !row('SELECT id FROM requirements WHERE id=? AND deleted_at IS NULL', issue.requirementId)) {
    fail('关联需求已归档，不能修改其问题', 'DEPENDENCY_CONFLICT', 409);
  }
}

function validateIssueResolution(status: string, discoveredAt: string, resolvedAt: string | null) {
  if (status !== 'resolved' && resolvedAt) fail('未解决问题不能设置解决日期，请先使用“确认解决”操作');
  if (status === 'resolved' && !resolvedAt) fail('已解决问题必须保留解决日期');
  if (resolvedAt && resolvedAt < discoveredAt) fail('解决日期不能早于发现日期，请核对日期');
  if (resolvedAt && resolvedAt > todayIso()) fail('解决日期不能晚于今天');
}

export function listIssues(filters: {
  projectId?: string; q?: string; status?: string; priority?: string; ownerId?: string;
  requirementId?: string; scope?: string; overdue?: string | boolean; unassigned?: string | boolean;
  active?: string | boolean; page?: number; pageSize?: number;
} = {}, asOfDate = todayIso()) {
  // 公共问题始终可见；需求问题随父需求一起退出日常视图，恢复需求后自动重新出现。
  const where: string[] = ['(i.requirement_id IS NULL OR r.deleted_at IS NULL)'];
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
    if (filters.status === 'active') where.push(`i.status<>'resolved'`);
    else {
      const status = ensureEnum(filters.status, issueStatuses, '问题状态');
      where.push('i.status=?'); params.push(status);
    }
  }
  if (filters.priority) {
    const priority = ensureEnum(filters.priority, priorities, '问题优先级');
    where.push('i.priority=?'); params.push(priority);
  }
  if (filters.ownerId) { where.push('i.owner_id=?'); params.push(filters.ownerId); }
  if (filters.requirementId) { where.push('i.requirement_id=?'); params.push(filters.requirementId); }
  if (filters.scope === 'public') where.push('i.requirement_id IS NULL');
  if (filters.scope === 'requirement') where.push('i.requirement_id IS NOT NULL');
  if (filters.active === true || filters.active === 'true') where.push(`i.status<>'resolved'`);
  if (filters.overdue === true || filters.overdue === 'true') {
    where.push(`i.status<>'resolved' AND i.due_date IS NOT NULL AND business_day_delta(i.due_date, ?)>0`); params.push(asOfDate);
  }
  if (filters.unassigned === true || filters.unassigned === 'true') where.push('i.owner_id IS NULL');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const requestedPage = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 50));
  const countFrom = `FROM issues i JOIN projects pr ON pr.id=i.project_id
    LEFT JOIN requirements r ON r.id=i.requirement_id LEFT JOIN people p ON p.id=i.owner_id`;
  const total = row<{ count: number }>(`SELECT COUNT(*) AS count ${countFrom} ${clause}`, ...params)?.count || 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pages);
  const items = rows<IssueRecord>(`${issueSelect} ${clause}
    ORDER BY CASE WHEN i.status='resolved' THEN 1 ELSE 0 END,
      CASE WHEN i.status<>'resolved' AND i.due_date IS NOT NULL AND business_day_delta(i.due_date, ?)>0 THEN 0 ELSE 1 END,
      CASE i.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
      CASE WHEN i.due_date IS NULL THEN 1 ELSE 0 END, i.due_date,
      CASE i.status WHEN 'in_progress' THEN 0 WHEN 'deferred' THEN 1 ELSE 2 END,
      i.updated_at DESC, i.id
    LIMIT ? OFFSET ?`, ...params, asOfDate, pageSize, (page - 1) * pageSize)
    .map((issue) => enrichIssue(issue, asOfDate));
  const summaryWhere = `WHERE (i.requirement_id IS NULL OR r.deleted_at IS NULL)${filters.projectId ? ' AND i.project_id=?' : ''}`;
  const summaryParams = filters.projectId ? [filters.projectId] : [];
  const rawSummary = row<Record<string, number | null>>(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN i.status='in_progress' THEN 1 ELSE 0 END) AS inProgress,
    SUM(CASE WHEN i.status='deferred' THEN 1 ELSE 0 END) AS deferred,
    SUM(CASE WHEN i.status='resolved' THEN 1 ELSE 0 END) AS resolved,
    SUM(CASE WHEN i.status<>'resolved' THEN 1 ELSE 0 END) AS active,
    SUM(CASE WHEN i.status<>'resolved' AND i.priority IN ('P0','P1') THEN 1 ELSE 0 END) AS highPriority,
    SUM(CASE WHEN i.status<>'resolved' AND i.due_date IS NOT NULL AND business_day_delta(i.due_date, ?)>0 THEN 1 ELSE 0 END) AS overdue,
    SUM(CASE WHEN i.owner_id IS NULL AND i.status<>'resolved' THEN 1 ELSE 0 END) AS unassigned
    FROM issues i LEFT JOIN requirements r ON r.id=i.requirement_id ${summaryWhere}`, asOfDate, ...summaryParams) || {};
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
  return { items, total, page, pageSize, pages, summary };
}

export function getIssue(id: string, includeArchivedParent = false) {
  const issue = row<IssueRecord>(`${issueSelect} WHERE i.id=? ${includeArchivedParent ? '' : 'AND (i.requirement_id IS NULL OR r.deleted_at IS NULL)'}`, id);
  if (!issue) notFound('问题不存在');
  const updates = rows<IssueUpdateRecord>(`SELECT u.id, u.issue_id AS issueId, u.progress, u.content,
    u.event_type AS eventType, u.supersedes_id AS supersedesId,
    u.created_by_account_id AS createdByAccountId, a.username AS createdByName,
    u.created_at AS createdAt, u.updated_at AS updatedAt FROM issue_updates u
    LEFT JOIN accounts a ON a.id=u.created_by_account_id
    WHERE u.issue_id=? ORDER BY u.created_at DESC, u.rowid DESC`, id);
  return { ...enrichIssue(issue), updates };
}

export function createIssue(input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => ![
    'projectId', 'title', 'impact', 'reporter', 'sourceRef', 'ownerId', 'requirementId',
    'priority', 'discoveredAt', 'dueDate', 'nextReviewAt',
  ].includes(key))) fail('新建问题不能提交未声明字段');
  if (['status', 'progress', 'resolvedAt', 'expectedVersion'].some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    fail('新建问题不能提交状态、完成度、解决日期或版本字段');
  }
  const id = randomUUID(); const projectId = requireText(input.projectId, '项目'); requireActiveProject(projectId);
  const title = requireLabel(input.title, '问题标题');
  const requirementId = issueRequirement(projectId, input.requirementId);
  const priority = input.priority === undefined ? 'P2' : ensureEnum(input.priority, priorities, '问题优先级');
  const discoveredAt = input.discoveredAt === undefined ? todayIso() : requireDate(input.discoveredAt, '发现日期');
  const dueDate = nullableDate(input.dueDate, '目标日期');
  const now = nowIso();
  getDatabaseContext().sqlite.transaction(() => {
    getDatabaseContext().sqlite.prepare(`INSERT INTO issues
      (id, project_id, requirement_id, source_ref, title, impact, reporter, owner_id, status, priority,
        progress, discovered_at, due_date, resolved_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, projectId, requirementId, nullableLabel(input.sourceRef, '来源标识'), title, nullableText(input.impact),
      nullableLabel(input.reporter, '提出人'), issueOwner(projectId, input.ownerId), 'in_progress', priority, 0, discoveredAt, dueDate, null, now, now,
    );
    getDatabaseContext().sqlite.prepare('UPDATE issues SET next_review_at=? WHERE id=?').run(nullableDate(input.nextReviewAt,'下次核对日期'),id);
    requireActiveProject(projectId, true);
    if (requirementId) issueRequirement(projectId, requirementId, true);
    issueOwner(projectId, input.ownerId, true);
    const currentActor = requireAuthorizationActor(actor);
    assertProjectMember(currentActor, projectId);
    if (nullableText(input.ownerId)) assertProjectManager(currentActor, projectId);
    audit(actor, 'create', 'issue', id, `创建问题：${title}`);
  })();
  return getIssue(id);
}

export function updateIssue(id: string, input: JsonObject, actor: Actor) {
  const current = getIssue(id, true); const projectId = current.projectId;
  assertIssueParentMutable(current);
  assertExpectedVersion(input, current.version);
  if (input.projectId !== undefined && requireText(input.projectId, '项目') !== projectId) {
    fail('问题不能通过普通编辑迁移到其他项目');
  }
  const historical = current.status === 'resolved';
  assertProjectManager(requireAuthorizationActor(actor), projectId);
  if (['status', 'progress'].some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    fail('问题状态和完成度不能通过普通编辑修改');
  }
  if (Object.keys(input).some((key) => ![
    'expectedVersion', 'projectId', 'title', 'impact', 'reporter', 'sourceRef',
    'ownerId', 'requirementId', 'priority', 'discoveredAt', 'dueDate', 'nextReviewAt', 'resolvedAt', 'reason',
  ].includes(key))) fail('问题编辑不能提交未声明字段');
  const title = input.title === undefined ? current.title : requireLabel(input.title, '问题标题');
  const requirementId = input.requirementId === undefined ? current.requirementId : issueRequirement(projectId, input.requirementId);
  const sourceRef = input.sourceRef === undefined ? current.sourceRef : nullableLabel(input.sourceRef, '来源标识');
  const ownerId = input.ownerId === undefined ? current.ownerId : nullableText(input.ownerId);
  const priority = input.priority === undefined ? current.priority : ensureEnum(input.priority, priorities, '问题优先级');
  const impact = input.impact === undefined ? current.impact : nullableText(input.impact);
  const reporter = input.reporter === undefined ? current.reporter : nullableLabel(input.reporter, '提出人');
  const discoveredAt = input.discoveredAt === undefined ? current.discoveredAt : requireDate(input.discoveredAt, '发现日期');
  const dueDate = current.status === 'deferred' ? null : input.dueDate === undefined ? current.dueDate : nullableDate(input.dueDate, '目标日期');
  const nextReviewAt=input.nextReviewAt===undefined?current.nextReviewAt:nullableDate(input.nextReviewAt,'下次核对日期');
  const resolvedAt = input.resolvedAt === undefined ? current.resolvedAt : nullableDate(input.resolvedAt, '解决日期');
  validateIssueResolution(current.status, discoveredAt, resolvedAt);
  const validateOwner = () => {
    if (ownerId === current.ownerId) return;
    if (historical) assertHistoricalProjectPeople(projectId, [ownerId]);
    else issueOwner(projectId, ownerId, true);
  };
  validateOwner();
  const changedFields = resolvedAt !== current.resolvedAt || nextReviewAt!==current.nextReviewAt||title !== current.title || requirementId !== current.requirementId || sourceRef !== current.sourceRef
    || impact !== current.impact || reporter !== current.reporter || ownerId !== current.ownerId
    || priority !== current.priority || discoveredAt !== current.discoveredAt || dueDate !== current.dueDate;
  if (!changedFields) {
    getDatabaseContext().sqlite.transaction(() => {
      requireActiveProject(projectId, true);
      if (requirementId) issueRequirement(projectId, requirementId, true);
      validateOwner();
      assertProjectManager(requireAuthorizationActor(actor), projectId);
    })();
    return current;
  }
  const now = nowIso();
  getDatabaseContext().sqlite.transaction(() => {
    const changed = getDatabaseContext().sqlite.prepare(`UPDATE issues SET requirement_id=?, source_ref=?, title=?, impact=?, reporter=?, owner_id=?,
      priority=?, discovered_at=?, due_date=?, next_review_at=?, resolved_at=?, version=version+1, updated_at=? WHERE id=? AND version=?`).run(
      requirementId, sourceRef, title, impact, reporter, ownerId, priority, discoveredAt, dueDate, nextReviewAt, resolvedAt, now, id, current.version,
    );
    assertVersionedWrite(changed, '问题');
    const reason = nullableText(input.reason) || describeChanges(current,input);
    if (historical) appendIssueEvent(id, 'correction', reason, actor, current.progress, null, now);
    audit(actor, historical ? 'correct' : 'update', 'issue', id, JSON.stringify(changeSnapshot(current,{requirementId,sourceRef,title,impact,reporter,ownerId,priority,discoveredAt,dueDate,nextReviewAt,resolvedAt},reason)));
    requireActiveProject(projectId, true);
    if (requirementId) issueRequirement(projectId, requirementId, true);
    validateOwner();
    assertProjectManager(requireAuthorizationActor(actor), projectId);
  })();
  return getIssue(id);
}

export function addIssueUpdate(issueId: string, input: JsonObject, actor: Actor, permissions: { canSetProgress: boolean; canResolve: boolean }) {
  if (Object.keys(input).some((key) => !['content', 'progress', 'expectedVersion'].includes(key))) {
    fail('问题进展命令不能提交无关字段');
  }
  const issue = getIssue(issueId, true); const content = nullableText(input.content) || (input.progress !== undefined ? `完成度：${issue.progress}% → ${input.progress}%` : requireText(input.content, '说明'));
  assertIssueParentMutable(issue);
  if (issue.status === 'resolved') fail('已解决问题不能再追加进展，请先由项目经理重新打开', 'TERMINAL_LOCKED');
  const hasProgress = input.progress !== undefined && nullableText(input.progress) !== null;
  if (hasProgress && !permissions.canSetProgress) forbidden('只有问题负责人或项目经理可以更新问题完成度');
  const progress = hasProgress ? requireProgress(input.progress, '问题完成度') : null;
  if (progress === 100) fail('100%只能由项目经理通过“确认解决”提交');
  if (progress !== null && issue.status !== 'in_progress') fail('只有处理中问题可以更新完成度', 'INVALID_TRANSITION');
  if (progress !== null && progress < issue.progress) fail('普通进展不能降低完成度，请由项目经理执行纠错');
  if (progress !== null || input.expectedVersion !== undefined) assertExpectedVersion(input, issue.version);
  const id = randomUUID(); const now = nowIso();
  getDatabaseContext().sqlite.transaction(() => {
    getDatabaseContext().sqlite.prepare(`INSERT INTO issue_updates (id, issue_id, progress, content, event_type, created_by_account_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, issueId, progress, content, progress === null ? 'note' : 'progress', actor.accountId || null, now, now);
    if (progress !== null) {
      const changed = getDatabaseContext().sqlite.prepare(`UPDATE issues SET progress=?, version=version+1, updated_at=? WHERE id=? AND version=?`)
        .run(progress, now, issueId, issue.version);
      assertVersionedWrite(changed, '问题');
    }
    const latest = row<{ status: string; parentDeletedAt: string | null }>(`SELECT i.status, r.deleted_at AS parentDeletedAt
      FROM issues i LEFT JOIN requirements r ON r.id=i.requirement_id WHERE i.id=?`, issueId);
    if (!latest) notFound('问题不存在');
    if (latest.parentDeletedAt) fail('关联需求已归档，不能修改其问题', 'DEPENDENCY_CONFLICT', 409);
    if (latest.status === 'resolved') fail('已解决问题不能再追加进展，请先由项目经理重新打开', 'TERMINAL_LOCKED', 409);
    requireActiveProject(issue.projectId, true);
    const currentActor = requireAuthorizationActor(actor);
    assertProjectMember(currentActor, issue.projectId);
    if (progress !== null && !canUpdateIssueProgress(currentActor, issueId)) forbidden('只有问题负责人或项目经理可以更新问题完成度');
    audit(actor, 'create', 'issue_update', id, `追加问题进展：${issue.title} · ${content.slice(0, 50)}`);
  })();
  return getIssue(issueId);
}

function issueStateEvent(id: string, action: 'defer' | 'resume' | 'resolve', input: JsonObject, actor: Actor) {
  const allowedFields = new Set(['expectedVersion', action === 'resolve' ? 'content' : 'reason']);
  if (Object.keys(input).some((key) => !allowedFields.has(key))) {
    fail(`${action === 'resolve' ? '确认解决' : action === 'defer' ? '挂起' : '恢复'}命令不能提交无关的问题字段`);
  }
  const current = getIssue(id, true); assertExpectedVersion(input, current.version); const now = nowIso();
  const today = todayIso();
  assertIssueParentMutable(current);
  const content = nullableText(action === 'resolve' ? input.content : input.reason) || ({defer:'挂起问题',resume:'恢复处理',resolve:'问题已解决'}[action]);
  if (action === 'defer') assertTransition(current.status, ['in_progress'], '挂起');
  if (action === 'resume') assertTransition(current.status, ['deferred'], '恢复');
  if (action === 'resolve') {
    assertTransition(current.status, ['in_progress'], '确认解决');
    validateIssueResolution('resolved', current.discoveredAt, today);
  }
  getDatabaseContext().sqlite.transaction(() => {
    const changed = action === 'defer'
      ? getDatabaseContext().sqlite.prepare(`UPDATE issues SET status='deferred', due_date=NULL, version=version+1, updated_at=? WHERE id=? AND version=?`).run(now, id, current.version)
      : action === 'resume'
        ? getDatabaseContext().sqlite.prepare(`UPDATE issues SET status='in_progress', version=version+1, updated_at=? WHERE id=? AND version=?`).run(now, id, current.version)
        : getDatabaseContext().sqlite.prepare(`UPDATE issues SET status='resolved', progress=100, resolved_at=?, version=version+1, updated_at=? WHERE id=? AND version=?`).run(today, now, id, current.version);
    assertVersionedWrite(changed, '问题');
    appendIssueEvent(id, action, content, actor, action === 'resolve' ? 100 : current.progress, null, now);
    audit(actor, action, 'issue', id, `${action === 'defer' ? '挂起' : action === 'resume' ? '恢复处理' : '确认解决'}问题：${current.title}`);
    requireActiveProject(current.projectId, true);
    if (current.requirementId) issueRequirement(current.projectId, current.requirementId, true);
    assertProjectManager(requireAuthorizationActor(actor), current.projectId);
  })();
  return getIssue(id);
}

export const deferIssue = (id: string, input: JsonObject, actor: Actor) => issueStateEvent(id, 'defer', input, actor);
export const resumeIssue = (id: string, input: JsonObject, actor: Actor) => issueStateEvent(id, 'resume', input, actor);
export const resolveIssue = (id: string, input: JsonObject, actor: Actor) => issueStateEvent(id, 'resolve', input, actor);

export function reopenIssue(id: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => !['expectedVersion', 'reason', 'progress'].includes(key))) {
    fail('重开命令不能提交无关的问题字段');
  }
  const current = getIssue(id, true); assertExpectedVersion(input, current.version); assertTransition(current.status, ['resolved'], '重开');
  assertIssueParentMutable(current);
  if (current.ownerId) issueOwner(current.projectId, current.ownerId, true);
  const reason = nullableText(input.reason) || '重新打开问题';
  const requested = input.progress === undefined ? (current.ownerId ? 99 : 0) : requireProgress(input.progress, '恢复进度');
  if (requested >= 100) fail('恢复进度必须小于100%');
  const now = nowIso();
  getDatabaseContext().sqlite.transaction(() => {
    const changed = getDatabaseContext().sqlite.prepare(`UPDATE issues SET status='in_progress', progress=?, resolved_at=NULL, version=version+1, updated_at=? WHERE id=? AND version=?`)
      .run(requested, now, id, current.version);
    assertVersionedWrite(changed, '问题');
    appendIssueEvent(id, 'reopen', reason, actor, requested, null, now);
    audit(actor, 'reopen', 'issue', id, `重开问题：${current.title}`);
    requireActiveProject(current.projectId, true);
    if (current.requirementId) issueRequirement(current.projectId, current.requirementId, true);
    if (current.ownerId) issueOwner(current.projectId, current.ownerId, true);
    assertProjectManager(requireAuthorizationActor(actor), current.projectId);
  })();
  return getIssue(id);
}

export function correctIssue(id: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => ![
    'expectedVersion', 'reason', 'supersedesId', 'title', 'impact', 'progress', 'resolvedAt',
  ].includes(key))) fail('问题纠错不能提交闭环说明或未声明字段');
  const current = getIssue(id, true); assertExpectedVersion(input, current.version); const reason = nullableText(input.reason) || describeChanges(current,input);
  assertIssueParentMutable(current);
  const progress = input.progress === undefined ? current.progress : requireProgress(input.progress, '问题完成度');
  if (current.status === 'resolved' && progress !== 100) fail('已解决问题降低进度时必须使用重开操作', 'TERMINAL_LOCKED');
  if (current.status !== 'resolved' && progress >= 100) fail('100%只能通过“确认解决”产生');
  const title = input.title === undefined ? current.title : requireLabel(input.title, '问题标题');
  const resolvedAt = input.resolvedAt === undefined ? current.resolvedAt : nullableDate(input.resolvedAt, '解决日期');
  validateIssueResolution(current.status, current.discoveredAt, resolvedAt);
  const supersedesId = nullableText(input.supersedesId);
  if (supersedesId && !row('SELECT id FROM issue_updates WHERE id=? AND issue_id=?', supersedesId, id)) {
    fail('纠错引用记录不存在或不属于当前问题');
  }
  const impact = input.impact === undefined ? current.impact : nullableText(input.impact);
  const factsChanged = title !== current.title || impact !== current.impact
    || resolvedAt !== current.resolvedAt || progress !== current.progress;
  if (!factsChanged && !supersedesId) fail('没有需要纠错的问题信息，请修改字段或关联历史记录');
  const now = nowIso();
  getDatabaseContext().sqlite.transaction(() => {
    const changed = getDatabaseContext().sqlite.prepare(`UPDATE issues SET title=?, impact=?, resolved_at=?, progress=?, version=version+1, updated_at=? WHERE id=? AND version=?`).run(
      title, impact, resolvedAt, progress, now, id, current.version,
    );
    assertVersionedWrite(changed, '问题');
    appendIssueEvent(id, 'correction', reason, actor, progress, supersedesId, now);
    audit(actor, 'correct', 'issue', id, `纠错问题：${current.title}`);
    requireActiveProject(current.projectId, true);
    if (current.requirementId) issueRequirement(current.projectId, current.requirementId, true);
    assertProjectManager(requireAuthorizationActor(actor), current.projectId);
  })();
  return getIssue(id);
}

export function updateIssueUpdate(issueId: string, updateId: string, input: JsonObject, _actor: Actor) {
  if (Object.keys(input).some((key) => !['content', 'progress'].includes(key))) fail('问题历史修改不能提交未声明字段');
  if (!row('SELECT id FROM issue_updates WHERE id=? AND issue_id=?', updateId, issueId)) notFound('问题进展不存在');
  fail('问题历史为只追加记录，不能修改；如需更正请追加纠错记录', 'HISTORY_IMMUTABLE');
}

export function deleteIssueUpdate(issueId: string, updateId: string, _actor: Actor) {
  if (!row('SELECT id FROM issue_updates WHERE id=? AND issue_id=?', updateId, issueId)) notFound('问题进展不存在');
  fail('问题历史为只追加记录，不能删除', 'HISTORY_IMMUTABLE');
}
