import { randomUUID, timingSafeEqual } from 'node:crypto';
import { sqlite } from './database';
import { createApiTokenValue, hashApiToken, type Actor } from './auth';
import { createAccountForPerson } from './accounts';
import {
  archiveUnusedSamplePeople,
  deleteOrReleaseSamplePeople,
  isSampleProjectId,
  restoreSamplePeople,
} from './sample-project';
import {
  addBusinessDays,
  addCalendarDays,
  businessDayDelta,
  businessDaysInclusive,
  calculateWorkItemGap,
  deriveRequirementMetrics,
  deriveWorkItemStatus,
  issueStatuses,
  plannedDatesFromOffset,
  plannedStartFromDeadline,
  priorities,
  projectRoles,
  requirementStatuses,
  riskLevels,
  isTerminalRequirementStatus,
  isTerminalWorkItemStatus,
  todayIso,
  workItemStatuses,
  type ProjectRole,
} from '../shared/domain';

type JsonObject = Record<string, unknown>;
const nowIso = () => new Date().toISOString();

type DomainErrorCode = 'VALIDATION_ERROR' | 'INVALID_TRANSITION' | 'TERMINAL_LOCKED' | 'HISTORY_IMMUTABLE' | 'STALE_WRITE' | 'DEPENDENCY_CONFLICT';

function fail(message: string, code: DomainErrorCode = 'VALIDATION_ERROR', statusCode = code === 'VALIDATION_ERROR' ? 400 : 409, details?: unknown, currentVersion?: number): never {
  const error = new Error(message) as Error & { statusCode: number; code: DomainErrorCode; details?: unknown; currentVersion?: number };
  error.statusCode = statusCode; error.code = code; error.details = details; error.currentVersion = currentVersion;
  throw error;
}

function assertExpectedVersion(input: JsonObject, currentVersion: number) {
  if (input.expectedVersion === undefined || input.expectedVersion === null || input.expectedVersion === '') fail('缺少expectedVersion，请刷新数据后重试');
  const expected = Number(input.expectedVersion);
  if (!Number.isInteger(expected) || expected < 1) fail('数据版本不合法');
  if (expected !== currentVersion) fail('数据已被其他用户修改，请刷新后重试', 'STALE_WRITE', 409, undefined, currentVersion);
  return expected;
}

function assertTransition(current: string, allowed: readonly string[], action: string) {
  if (!allowed.includes(current)) fail(`当前状态“${current}”不能${action}`, isTerminalWorkItemStatus(current) || isTerminalRequirementStatus(current) || current === 'resolved' ? 'TERMINAL_LOCKED' : 'INVALID_TRANSITION');
}

function auditProjectId(entityType: string, entityId: string | null): string | null {
  if (!entityId) return null;
  if (entityType === 'project') return entityId;
  if (entityType === 'template') return row<{ projectId: string }>('SELECT project_id AS projectId FROM work_item_templates WHERE id=?', entityId)?.projectId || null;
  if (entityType === 'requirement') return row<{ projectId: string }>('SELECT project_id AS projectId FROM requirements WHERE id=?', entityId)?.projectId || null;
  if (entityType === 'issue') return row<{ projectId: string }>('SELECT project_id AS projectId FROM issues WHERE id=?', entityId)?.projectId || null;
  if (entityType === 'work_item') return row<{ projectId: string }>(`SELECT r.project_id AS projectId FROM work_items w JOIN requirements r ON r.id=w.requirement_id WHERE w.id=?`, entityId)?.projectId || null;
  if (entityType === 'progress') return row<{ projectId: string }>(`SELECT r.project_id AS projectId FROM progress_updates u JOIN requirements r ON r.id=u.requirement_id WHERE u.id=?`, entityId)?.projectId || null;
  if (entityType === 'issue_update') return row<{ projectId: string }>(`SELECT i.project_id AS projectId FROM issue_updates u JOIN issues i ON i.id=u.issue_id WHERE u.id=?`, entityId)?.projectId || null;
  return null;
}

function audit(actor: Actor, action: string, entityType: string, entityId: string | null, summary: string, projectId?: string | null) {
  const scopeProjectId = projectId === undefined ? auditProjectId(entityType, entityId) : projectId;
  sqlite.prepare(`INSERT INTO audit_logs (id, actor_type, actor_id, action, entity_type, entity_id, project_id, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), actor.type, actor.id, action, entityType, entityId, scopeProjectId, summary, nowIso());
}

export function recordAudit(actor: Actor, action: string, entityType: string, entityId: string | null, summary: string, projectId?: string | null) {
  audit(actor, action, entityType, entityId, summary, projectId);
}

function ensureEnum<T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] {
  if (!allowed.includes(value as T[number])) fail(`${field}不合法`);
  return value as T[number];
}

function requireText(value: unknown, field: string) {
  const text = String(value ?? '').trim();
  if (!text) fail(`${field}不能为空`);
  return text;
}

function nullableText(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

function templateDescription(value: unknown) {
  const description = String(value ?? '').trim();
  if (description.length > 2000) fail('流程描述不能超过2000个字符');
  return description;
}

function milestoneLabel(value: unknown) {
  const label = String(value ?? '').trim();
  if (label.length > 80) fail('里程碑名称不能超过80个字符');
  return label || null;
}

function requireDate(value: unknown, field: string) {
  const text = requireText(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail(`${field}格式不合法`);
  return text;
}

function nullableDate(value: unknown, field: string) {
  const text = nullableText(value);
  if (text && !/^\d{4}-\d{2}-\d{2}$/.test(text)) fail(`${field}格式不合法`);
  return text;
}

function requireProgress(value: unknown, field = '完成度') {
  const progress = Number(value);
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) fail(`${field}必须是0到100的整数`);
  return progress;
}

function rows<T = JsonObject>(sql: string, ...params: unknown[]): T[] {
  return sqlite.prepare(sql).all(...params) as T[];
}

function row<T = JsonObject>(sql: string, ...params: unknown[]): T | undefined {
  return sqlite.prepare(sql).get(...params) as T | undefined;
}

export type ProjectRecord = {
  id: string; name: string; status: string; plannedStart: string | null; plannedEnd: string | null;
  defaultTemplateId: string | null; createdAt: string; updatedAt: string; deletedAt?: string | null;
  isSample: boolean; projectRole?: ProjectRole; canManage?: boolean;
};

export type WorkItemRecord = {
  id: string; requirementId: string; templateItemId: string | null; title: string; ownerId: string | null; ownerName: string | null;
  status: string; plannedStart: string | null; plannedEnd: string | null; actualStart: string | null; actualEnd: string | null;
  forecastEnd: string | null; blockedAt: string | null; blockedReason: string | null; milestoneLabel: string | null; progress: number; sortOrder: number; version: number; createdAt: string; updatedAt: string;
  collaborators: Array<{ id: string; name: string; jobTitle: string | null }>;
  assigneeIds: string[]; assigneeNames: string[];
};

export type RequirementRecord = {
  id: string; projectId: string; projectName: string; templateId: string | null; templateName: string | null; title: string; ownerId: string | null; ownerName: string | null;
  status: string; plannedStart: string | null; plannedEnd: string | null; progress: number; plannedProgress?: number; progressGap?: number;
  riskLevel: string; priority: string; acceptedAt: string | null; acceptedByAccountId: string | null; version: number; createdAt: string; updatedAt: string; deletedAt?: string | null; workItems?: WorkItemRecord[];
  delayed?: boolean; highRisk?: boolean; riskEvaluated?: boolean; riskReason?: string; finishVariance?: number; durationVariance?: number; effectiveEnd?: string | null;
};

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

type TemplateItemInput = { id?: string; title: string; startOffsetDays: number; durationDays: number; milestoneLabel: string | null; sortOrder: number };

const projectSelect = `SELECT id, name, status, planned_start AS plannedStart, planned_end AS plannedEnd,
  default_template_id AS defaultTemplateId, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt FROM projects`;

function withProjectMeta<T extends { id: string }>(project: T): T & { isSample: boolean } {
  return { ...project, isSample: isSampleProjectId(project.id) };
}

const requirementSelect = `SELECT r.id, r.project_id AS projectId, pr.name AS projectName,
  r.template_id AS templateId, t.name AS templateName, r.title,
  r.owner_id AS ownerId, p.name AS ownerName, r.status, r.planned_start AS plannedStart,
  r.planned_end AS plannedEnd, r.progress, r.risk_level AS riskLevel, r.priority,
  r.accepted_at AS acceptedAt, r.accepted_by_account_id AS acceptedByAccountId, r.version,
  r.created_at AS createdAt, r.updated_at AS updatedAt, r.deleted_at AS deletedAt
  FROM requirements r JOIN projects pr ON pr.id = r.project_id
  LEFT JOIN people p ON p.id = r.owner_id
  LEFT JOIN work_item_templates t ON t.id = r.template_id`;

const workItemSelect = `SELECT w.id, w.requirement_id AS requirementId, w.template_item_id AS templateItemId,
  w.title, w.owner_id AS ownerId, p.name AS ownerName, w.status,
  w.planned_start AS plannedStart, w.planned_end AS plannedEnd,
  w.actual_start AS actualStart, w.actual_end AS actualEnd, w.forecast_end AS forecastEnd,
  w.blocked_at AS blockedAt, w.blocked_reason AS blockedReason, w.milestone_label AS milestoneLabel, w.progress,
  w.sort_order AS sortOrder, w.version, w.created_at AS createdAt, w.updated_at AS updatedAt
  FROM work_items w LEFT JOIN people p ON p.id = w.owner_id`;

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

export function listProjects(includeDeleted = false, actor?: Actor): ProjectRecord[] {
  const projects = rows<Omit<ProjectRecord, 'isSample'>>(`${projectSelect} ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'} ORDER BY created_at DESC`)
    .map(withProjectMeta)
    .sort((left, right) => Number(left.isSample) - Number(right.isSample));
  if (!actor) return projects;
  if (actor.globalRole === 'admin') return projects.map((project) => ({ ...project, projectRole: 'manager', canManage: true }));
  if (!actor.personId) return [];
  const memberships = rows<{ projectId: string; projectRole: ProjectRole }>(
    'SELECT project_id AS projectId, project_role AS projectRole FROM project_people WHERE person_id=?', actor.personId,
  );
  const byProject = new Map(memberships.map((item) => [item.projectId, item.projectRole]));
  return projects.filter((project) => byProject.has(project.id)).map((project) => {
    const projectRole = byProject.get(project.id)!;
    return { ...project, projectRole, canManage: projectRole === 'manager' };
  });
}

const initialFlowItems = [
  { title: '设计', startOffsetDays: 0, durationDays: 2 },
  { title: '开发', startOffsetDays: 2, durationDays: 5 },
  { title: '测试', startOffsetDays: 7, durationDays: 3 },
  { title: '发布', startOffsetDays: 10, durationDays: 1 },
] as const;

function createInitialProjectFlow(projectId: string, createdAt: string) {
  const templateId = randomUUID();
  sqlite.prepare(`INSERT INTO work_item_templates (id, project_id, name, description, created_at, updated_at)
    VALUES (?, ?, '通用研发流程', '项目初始流程，可由项目经理按实际情况调整。', ?, ?)`)
    .run(templateId, projectId, createdAt, createdAt);
  const insert = sqlite.prepare(`INSERT INTO template_items
    (id, template_id, title, sort_order, start_offset_days, duration_days) VALUES (?, ?, ?, ?, ?, ?)`);
  initialFlowItems.forEach((item, index) => insert.run(randomUUID(), templateId, item.title, index, item.startOffsetDays, item.durationDays));
  return templateId;
}

function firstActiveTemplateId(projectId: string) {
  return row<{ id: string }>(`SELECT id FROM work_item_templates WHERE project_id=? AND deleted_at IS NULL
    ORDER BY CASE WHEN name='DCIM AI工作流' THEN 0 ELSE 1 END, created_at LIMIT 1`, projectId)?.id || null;
}

export function createProject(input: JsonObject, actor: Actor): ProjectRecord {
  const id = randomUUID(); const now = nowIso(); const name = requireText(input.name, '项目名称');
  sqlite.transaction(() => {
    sqlite.prepare(`INSERT INTO projects (id, name, status, planned_start, planned_end, default_template_id, created_at, updated_at)
      VALUES (?, ?, 'active', ?, ?, NULL, ?, ?)`).run(id, name, nullableText(input.plannedStart), nullableText(input.plannedEnd), now, now);
    const defaultTemplateId = createInitialProjectFlow(id, now);
    sqlite.prepare('UPDATE projects SET default_template_id=? WHERE id=?').run(defaultTemplateId, id);
  })();
  audit(actor, 'create', 'project', id, `创建项目：${name}`);
  return withProjectMeta(row<Omit<ProjectRecord, 'isSample'>>(`${projectSelect} WHERE id=?`, id)!);
}

export function updateProject(id: string, input: JsonObject, actor: Actor): ProjectRecord {
  const current = row<Omit<ProjectRecord, 'isSample'>>(`${projectSelect} WHERE id=? AND deleted_at IS NULL`, id);
  if (!current) throw new Error('项目不存在');
  const name = input.name === undefined ? current.name : requireText(input.name, '项目名称');
  const defaultTemplateId = input.defaultTemplateId === undefined ? current.defaultTemplateId : nullableText(input.defaultTemplateId);
  if (defaultTemplateId && !row('SELECT id FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL', defaultTemplateId, id)) {
    throw new Error('默认流程必须属于当前项目且未归档');
  }
  sqlite.prepare(`UPDATE projects SET name=?, status=?, planned_start=?, planned_end=?, default_template_id=?, updated_at=? WHERE id=?`).run(
    name, input.status === undefined ? current.status : String(input.status),
    input.plannedStart === undefined ? current.plannedStart : nullableText(input.plannedStart),
    input.plannedEnd === undefined ? current.plannedEnd : nullableText(input.plannedEnd), defaultTemplateId, nowIso(), id,
  );
  audit(actor, 'update', 'project', id, `更新项目：${name}`);
  return withProjectMeta(row<Omit<ProjectRecord, 'isSample'>>(`${projectSelect} WHERE id=?`, id)!);
}

export function archiveProject(id: string, actor: Actor) {
  const existing = row<{ name: string }>('SELECT name FROM projects WHERE id=? AND deleted_at IS NULL', id);
  if (!existing) throw new Error('项目不存在');
  const dependencies = {
    requirements: row<{ count: number }>(`SELECT COUNT(*) AS count FROM requirements WHERE project_id=? AND deleted_at IS NULL AND status NOT IN ('completed','cancelled')`, id)?.count || 0,
    issues: row<{ count: number }>(`SELECT COUNT(*) AS count FROM issues WHERE project_id=? AND status<>'resolved'`, id)?.count || 0,
  };
  if (dependencies.requirements || dependencies.issues) fail(`项目仍有活跃需求${dependencies.requirements}项、未解决问题${dependencies.issues}项，请先终止或闭环`, 'DEPENDENCY_CONFLICT', 409, dependencies);
  const now = nowIso();
  sqlite.transaction(() => {
    sqlite.prepare('UPDATE projects SET deleted_at=?, updated_at=? WHERE id=?').run(now, now, id);
    if (isSampleProjectId(id)) archiveUnusedSamplePeople(sqlite, now);
  })();
  audit(actor, 'archive', 'project', id, `归档项目：${existing.name}`);
  return { ok: true };
}

export function restoreProject(id: string, actor: Actor) {
  if (!row('SELECT id FROM projects WHERE id=? AND deleted_at IS NOT NULL', id)) throw new Error('归档项目不存在');
  const now = nowIso();
  sqlite.transaction(() => {
    sqlite.prepare('UPDATE projects SET deleted_at=NULL, updated_at=? WHERE id=?').run(now, id);
    if (isSampleProjectId(id)) restoreSamplePeople(sqlite, now);
  })();
  audit(actor, 'restore', 'project', id, '恢复项目');
  return withProjectMeta(row<Omit<ProjectRecord, 'isSample'>>(`${projectSelect} WHERE id=?`, id)!);
}

export function listPeople(includeDeleted = false, projectId?: string) {
  const where = includeDeleted ? [] : ['p.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (projectId) {
    where.push('EXISTS (SELECT 1 FROM project_people pp WHERE pp.person_id=p.id AND pp.project_id=?)');
    params.push(projectId);
  }
  return rows(`SELECT p.id, p.name, p.job_title AS jobTitle, p.active, p.created_at AS createdAt,
    p.updated_at AS updatedAt, p.deleted_at AS deletedAt,
    ${projectId ? `(SELECT pp2.project_role FROM project_people pp2 WHERE pp2.person_id=p.id AND pp2.project_id=?)` : `'member'`} AS projectRole,
    (SELECT a.username FROM accounts a WHERE a.person_id=p.id) AS username,
    (SELECT a.status FROM accounts a WHERE a.person_id=p.id) AS accountStatus
    FROM people p ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.active DESC, p.name`, ...(projectId ? [projectId, ...params] : params));
}

function requireActiveProject(projectId: string) {
  if (!row('SELECT id FROM projects WHERE id=? AND deleted_at IS NULL', projectId)) throw new Error('项目不存在');
}

export function listPeopleCandidates(projectId: string, q = '') {
  requireActiveProject(projectId);
  const pattern = `%${q.trim()}%`;
  return rows(`SELECT p.id, p.name, p.job_title AS jobTitle
    FROM people p WHERE p.deleted_at IS NULL AND p.active=1
      AND NOT EXISTS (SELECT 1 FROM project_people pp WHERE pp.project_id=? AND pp.person_id=p.id)
      AND (?='' OR p.name LIKE ? OR COALESCE(p.job_title,'') LIKE ?)
    ORDER BY p.name LIMIT 50`, projectId, q.trim(), pattern, pattern);
}

function activeAssignmentCounts(personId: string, projectId?: string) {
  const projectClause = projectId ? 'AND r.project_id=?' : '';
  const requirementClause = projectId ? 'AND project_id=?' : '';
  return {
    requirements: row<{ count: number }>(`SELECT COUNT(*) AS count FROM requirements
      WHERE owner_id=? AND deleted_at IS NULL AND status NOT IN ('completed','cancelled') ${requirementClause}`, personId, ...(projectId ? [projectId] : []))?.count || 0,
    workItems: row<{ count: number }>(`SELECT COUNT(DISTINCT w.id) AS count FROM work_items w
      JOIN requirements r ON r.id=w.requirement_id
      LEFT JOIN work_item_collaborators c ON c.work_item_id=w.id AND c.person_id=?
      WHERE r.deleted_at IS NULL AND w.status NOT IN ('completed','cancelled') AND (w.owner_id=? OR c.person_id IS NOT NULL) ${projectClause}`,
      personId, personId, ...(projectId ? [projectId] : []))?.count || 0,
    issues: row<{ count: number }>(`SELECT COUNT(*) AS count FROM issues
      WHERE owner_id=? AND status<>'resolved' ${projectId ? 'AND project_id=?' : ''}`, personId, ...(projectId ? [projectId] : []))?.count || 0,
  };
}

function assertNoActiveAssignments(personId: string, projectId?: string) {
  const assignments = activeAssignmentCounts(personId, projectId);
  if (assignments.requirements || assignments.workItems || assignments.issues) {
    fail(`该人员仍有需求${assignments.requirements}项、工作项${assignments.workItems}项、问题${assignments.issues}项，请先重新分配`, 'DEPENDENCY_CONFLICT', 409, assignments);
  }
}

export function addProjectPerson(projectId: string, personId: string, actor: Actor, requestedRole: unknown = 'member') {
  requireActiveProject(projectId);
  const person = row<{ name: string }>('SELECT name FROM people WHERE id=? AND deleted_at IS NULL AND active=1', personId);
  if (!person) throw new Error('人员不存在或已停用');
  const projectRole = ensureEnum(requestedRole, projectRoles, '项目角色');
  const currentRole = row<{ projectRole: ProjectRole }>('SELECT project_role AS projectRole FROM project_people WHERE project_id=? AND person_id=?', projectId, personId)?.projectRole;
  if ((projectRole === 'manager' || currentRole === 'manager') && actor.globalRole !== 'admin') {
    const error = new Error('项目经理只能由平台管理员任免') as Error & { statusCode: number }; error.statusCode = 403; throw error;
  }
  if (projectRole === 'viewer' && currentRole && currentRole !== 'viewer') assertNoActiveAssignments(personId, projectId);
  sqlite.prepare(`INSERT INTO project_people (project_id, person_id, project_role, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(project_id,person_id) DO UPDATE SET project_role=excluded.project_role`).run(projectId, personId, projectRole, nowIso());
  audit(actor, 'add_member', 'person', personId, `设置项目成员：${person.name}（${projectRole}）`, projectId);
  return listPeople(false, projectId).find((item: any) => item.id === personId);
}

export function removeProjectPerson(projectId: string, personId: string, actor: Actor) {
  requireActiveProject(projectId);
  const person = row<{ name: string }>('SELECT name FROM people WHERE id=? AND deleted_at IS NULL', personId);
  if (!person) throw new Error('人员不存在');
  const membership = row<{ projectRole: ProjectRole }>('SELECT project_role AS projectRole FROM project_people WHERE project_id=? AND person_id=?', projectId, personId);
  if (!membership) throw new Error('该人员不属于当前项目');
  if (membership.projectRole === 'manager' && actor.globalRole !== 'admin') {
    const error = new Error('项目经理只能由平台管理员移除') as Error & { statusCode: number }; error.statusCode = 403; throw error;
  }
  assertNoActiveAssignments(personId, projectId);
  const result = sqlite.prepare('DELETE FROM project_people WHERE project_id=? AND person_id=?').run(projectId, personId);
  if (!result.changes) throw new Error('该人员不属于当前项目');
  audit(actor, 'remove_member', 'person', personId, `移出项目成员：${person.name}`, projectId);
  return { ok: true };
}

function assertUniquePersonName(name: string, exceptId?: string) {
  const duplicate = row<{ id: string }>(`SELECT id FROM people WHERE deleted_at IS NULL
    AND lower(trim(name))=lower(trim(?)) ${exceptId ? 'AND id<>?' : ''} LIMIT 1`, ...[name, ...(exceptId ? [exceptId] : [])]);
  if (duplicate) throw new Error('人员姓名已存在');
}

export function createPerson(input: JsonObject, actor: Actor) {
  const id = randomUUID(); const now = nowIso(); const name = requireText(input.name, '姓名');
  const projectId = nullableText(input.projectId);
  if (projectId) requireActiveProject(projectId);
  assertUniquePersonName(name);
  sqlite.transaction(() => {
    sqlite.prepare('INSERT INTO people (id, name, job_title, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)')
      .run(id, name, nullableText(input.jobTitle), now, now);
    if (projectId) sqlite.prepare('INSERT INTO project_people (project_id, person_id, created_at) VALUES (?, ?, ?)').run(projectId, id, now);
    createAccountForPerson(id, name, true);
  })();
  audit(actor, 'create', 'person', id, `新增人员：${name}`);
  return row('SELECT id, name, job_title AS jobTitle, active, created_at AS createdAt, updated_at AS updatedAt FROM people WHERE id=?', id)!;
}

export function updatePerson(id: string, input: JsonObject, actor: Actor) {
  const current = row<{ name: string; jobTitle: string | null; active: number }>(
    'SELECT name, job_title AS jobTitle, active FROM people WHERE id=? AND deleted_at IS NULL', id,
  );
  if (!current) throw new Error('人员不存在');
  const name = input.name === undefined ? current.name : requireText(input.name, '姓名');
  assertUniquePersonName(name, id);
  const active = input.active === undefined
    ? current.active
    : [true, 1, '1', 'true'].includes(input.active as boolean | number | string) ? 1 : 0;
  if (!active && current.active) assertNoActiveAssignments(id);
  sqlite.transaction(() => {
    sqlite.prepare('UPDATE people SET name=?, job_title=?, active=?, updated_at=? WHERE id=?').run(
      name, input.jobTitle === undefined ? current.jobTitle : nullableText(input.jobTitle), active, nowIso(), id,
    );
    if (input.active !== undefined) {
      sqlite.prepare(`UPDATE accounts SET status=?, session_version=session_version+1, updated_at=?
        WHERE person_id=? AND is_builtin=0`).run(active ? 'active' : 'disabled', nowIso(), id);
    }
  })();
  audit(actor, 'update', 'person', id, `更新人员：${name}`);
  return row('SELECT id, name, job_title AS jobTitle, active, created_at AS createdAt, updated_at AS updatedAt FROM people WHERE id=?', id)!;
}

export function archivePerson(id: string, actor: Actor) {
  if (!row('SELECT id FROM people WHERE id=? AND deleted_at IS NULL', id)) throw new Error('人员不存在');
  assertNoActiveAssignments(id);
  sqlite.transaction(() => {
    sqlite.prepare('UPDATE people SET deleted_at=?, active=0, updated_at=? WHERE id=?').run(nowIso(), nowIso(), id);
    sqlite.prepare(`UPDATE accounts SET status='disabled', session_version=session_version+1, updated_at=?
      WHERE person_id=? AND is_builtin=0`).run(nowIso(), id);
  })();
  audit(actor, 'archive', 'person', id, '归档人员');
  return { ok: true };
}

export function restorePerson(id: string, actor: Actor) {
  const person = row<{ name: string }>('SELECT name FROM people WHERE id=? AND deleted_at IS NOT NULL', id);
  if (!person) throw new Error('归档人员不存在');
  assertUniquePersonName(person.name, id);
  sqlite.transaction(() => {
    sqlite.prepare('UPDATE people SET deleted_at=NULL, active=1, updated_at=? WHERE id=?').run(nowIso(), id);
    const account = row<{ id: string }>('SELECT id FROM accounts WHERE person_id=?', id);
    if (account) sqlite.prepare(`UPDATE accounts SET status='active', session_version=session_version+1, updated_at=? WHERE id=?`).run(nowIso(), account.id);
    else createAccountForPerson(id, person.name, true);
  })();
  audit(actor, 'restore', 'person', id, `恢复人员：${person.name}`);
  return listPeople(true).find((item: any) => item.id === id);
}

function parseTemplateItems(input: unknown): TemplateItemInput[] {
  if (!Array.isArray(input)) return [];
  return input.map((value, index) => {
    if (typeof value === 'string') return { title: requireText(value, '工作项名称'), startOffsetDays: index, durationDays: 1, milestoneLabel: null, sortOrder: index };
    const item = value as JsonObject;
    const startOffsetDays = Number(item.startOffsetDays ?? index);
    const durationDays = Number(item.durationDays ?? 1);
    if (!Number.isInteger(startOffsetDays) || startOffsetDays < 0) throw new Error('开始偏移必须是非负整数');
    if (!Number.isInteger(durationDays) || durationDays < 1) throw new Error('工期必须是正整数');
    return {
      id: nullableText(item.id) || undefined,
      title: requireText(item.title, '工作项名称'), startOffsetDays, durationDays,
      milestoneLabel: milestoneLabel(item.milestoneLabel),
      sortOrder: Number.isInteger(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
    };
  });
}

export function listTemplates(projectId?: string | null, includeDeleted = false) {
  if (projectId) requireActiveProject(projectId);
  const templates = rows<any>(`SELECT id, project_id AS projectId, name, description, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
    FROM work_item_templates ${projectId ? 'WHERE project_id=?' : includeDeleted ? '' : 'WHERE deleted_at IS NULL'}
    ${projectId && !includeDeleted ? 'AND deleted_at IS NULL' : ''} ORDER BY created_at`, ...(projectId ? [projectId] : []));
  const items = rows<any>(`SELECT id, template_id AS templateId, title, sort_order AS sortOrder,
    start_offset_days AS startOffsetDays, duration_days AS durationDays, milestone_label AS milestoneLabel, deleted_at AS deletedAt
    FROM template_items ORDER BY sort_order`);
  return templates.map((template) => ({
    ...template,
    items: items.filter((item) => item.templateId === template.id && (includeDeleted || !item.deletedAt)),
  }));
}

function assertUniqueTemplateName(projectId: string, name: string, exceptId?: string) {
  const duplicate = row<{ id: string }>(`SELECT id FROM work_item_templates WHERE project_id=? AND deleted_at IS NULL
    AND lower(trim(name))=lower(trim(?)) ${exceptId ? 'AND id<>?' : ''} LIMIT 1`, projectId, name, ...(exceptId ? [exceptId] : []));
  if (duplicate) throw new Error('当前项目已存在同名流程');
}

export function createTemplate(input: JsonObject, actor: Actor) {
  const id = randomUUID(); const now = nowIso(); const projectId = requireText(input.projectId, '项目');
  requireActiveProject(projectId);
  const name = requireText(input.name, '流程名称');
  assertUniqueTemplateName(projectId, name);
  const description = templateDescription(input.description);
  const items = parseTemplateItems(input.items);
  if (!items.length) throw new Error('模板至少需要一个工作项');
  const tx = sqlite.transaction(() => {
    sqlite.prepare('INSERT INTO work_item_templates (id, project_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, projectId, name, description, now, now);
    const insert = sqlite.prepare(`INSERT INTO template_items
      (id, template_id, title, sort_order, start_offset_days, duration_days, milestone_label) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    items.forEach((item, index) => insert.run(randomUUID(), id, item.title, index, item.startOffsetDays, item.durationDays, item.milestoneLabel));
  });
  tx(); audit(actor, 'create', 'template', id, `创建流程：${name}`);
  return listTemplates(projectId).find((item: any) => item.id === id);
}

export function updateTemplate(id: string, input: JsonObject, actor: Actor) {
  const current = row<{ projectId: string; name: string; description: string }>('SELECT project_id AS projectId, name, description FROM work_item_templates WHERE id=? AND deleted_at IS NULL', id);
  if (!current) throw new Error('模板不存在');
  const name = input.name === undefined ? current.name : requireText(input.name, '模板名称');
  assertUniqueTemplateName(current.projectId, name, id);
  const description = input.description === undefined ? current.description : templateDescription(input.description);
  const items = input.items === undefined ? null : parseTemplateItems(input.items);
  if (items && !items.length) throw new Error('模板至少需要一个工作项');
  const tx = sqlite.transaction(() => {
    sqlite.prepare('UPDATE work_item_templates SET name=?, description=?, updated_at=? WHERE id=?').run(name, description, nowIso(), id);
    if (!items) return;
    const existing = new Set(rows<{ id: string }>('SELECT id FROM template_items WHERE template_id=? AND deleted_at IS NULL', id).map((item) => item.id));
    const kept = new Set<string>();
    const update = sqlite.prepare(`UPDATE template_items SET title=?, sort_order=?, start_offset_days=?, duration_days=?, milestone_label=?, deleted_at=NULL
      WHERE id=? AND template_id=?`);
    const insert = sqlite.prepare(`INSERT INTO template_items
      (id, template_id, title, sort_order, start_offset_days, duration_days, milestone_label) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    items.forEach((item, index) => {
      if (item.id && existing.has(item.id)) {
        update.run(item.title, index, item.startOffsetDays, item.durationDays, item.milestoneLabel, item.id, id); kept.add(item.id);
      } else {
        const newId = randomUUID(); insert.run(newId, id, item.title, index, item.startOffsetDays, item.durationDays, item.milestoneLabel); kept.add(newId);
      }
    });
    for (const itemId of existing) if (!kept.has(itemId)) sqlite.prepare('UPDATE template_items SET deleted_at=? WHERE id=?').run(nowIso(), itemId);
  });
  tx(); audit(actor, 'update', 'template', id, `更新模板：${name}`);
  return listTemplates(current.projectId).find((item: any) => item.id === id);
}

export function copyTemplate(targetProjectId: string, sourceTemplateId: string, actor: Actor) {
  requireActiveProject(targetProjectId);
  const source = row<{ name: string; description: string }>(
    'SELECT name, description FROM work_item_templates WHERE id=? AND deleted_at IS NULL', sourceTemplateId,
  );
  if (!source) throw new Error('来源流程不存在');
  let name = `${source.name}（副本）`; let suffix = 2;
  while (row('SELECT 1 FROM work_item_templates WHERE project_id=? AND deleted_at IS NULL AND lower(trim(name))=lower(trim(?))', targetProjectId, name)) {
    name = `${source.name}（副本${suffix++}）`;
  }
  const items = activeTemplateItems(sourceTemplateId).map((item) => ({
    title: item.title, startOffsetDays: item.startOffsetDays, durationDays: item.durationDays, milestoneLabel: item.milestoneLabel, sortOrder: item.sortOrder,
  }));
  return createTemplate({ projectId: targetProjectId, name, description: source.description, items }, actor);
}

export function archiveTemplate(id: string, actor: Actor) {
  const template = row<{ projectId: string }>('SELECT project_id AS projectId FROM work_item_templates WHERE id=? AND deleted_at IS NULL', id);
  if (!template) throw new Error('模板不存在');
  if (row('SELECT 1 FROM projects WHERE id=? AND default_template_id=?', template.projectId, id)) fail('项目默认流程不能归档，请先更换默认流程', 'DEPENDENCY_CONFLICT');
  const activeCount = row<{ count: number }>('SELECT COUNT(*) AS count FROM work_item_templates WHERE project_id=? AND deleted_at IS NULL', template.projectId)?.count || 0;
  if (activeCount <= 1) fail('项目至少需要保留一个有效流程', 'DEPENDENCY_CONFLICT');
  sqlite.prepare('UPDATE work_item_templates SET deleted_at=?, updated_at=? WHERE id=?').run(nowIso(), nowIso(), id);
  audit(actor, 'archive', 'template', id, '归档流程设计');
  return { ok: true };
}

export function restoreTemplate(id: string, actor: Actor) {
  const template = row<{ projectId: string; name: string }>('SELECT project_id AS projectId, name FROM work_item_templates WHERE id=? AND deleted_at IS NOT NULL', id);
  if (!template) throw new Error('归档模板不存在');
  assertUniqueTemplateName(template.projectId, template.name, id);
  sqlite.prepare('UPDATE work_item_templates SET deleted_at=NULL, updated_at=? WHERE id=?').run(nowIso(), id);
  audit(actor, 'restore', 'template', id, '恢复流程设计');
  return listTemplates(template.projectId, true).find((item: any) => item.id === id);
}

function getWorkItems(requirementId: string): WorkItemRecord[] {
  const items = rows<Omit<WorkItemRecord, 'collaborators' | 'assigneeIds' | 'assigneeNames'>>(
    `${workItemSelect} WHERE w.requirement_id=? ORDER BY w.sort_order, w.created_at`, requirementId,
  );
  const collaborators = rows<{ workItemId: string; id: string; name: string; jobTitle: string | null }>(`
    SELECT c.work_item_id AS workItemId, p.id, p.name, p.job_title AS jobTitle
    FROM work_item_collaborators c
    JOIN work_items w ON w.id=c.work_item_id
    JOIN people p ON p.id=c.person_id
    WHERE w.requirement_id=? ORDER BY p.name`, requirementId);
  return items.map((item) => {
    const itemCollaborators = collaborators.filter((person) => person.workItemId === item.id && person.id !== item.ownerId)
      .map(({ workItemId: _workItemId, ...person }) => person);
    return {
      ...item,
      collaborators: itemCollaborators,
      assigneeIds: [item.ownerId, ...itemCollaborators.map((person) => person.id)].filter(Boolean) as string[],
      assigneeNames: [item.ownerName, ...itemCollaborators.map((person) => person.name)].filter(Boolean) as string[],
    };
  });
}

function enrichRequirement(requirement: RequirementRecord): RequirementRecord {
  const workItems = getWorkItems(requirement.id);
  const metrics = deriveRequirementMetrics(requirement, workItems);
  const gaps = workItems.map((item) => calculateWorkItemGap(item));
  return {
    ...requirement, ...metrics,
    status: requirement.status, progress: requirement.progress, plannedEnd: requirement.plannedEnd,
    workItems,
    durationVariance: gaps.length ? Math.max(...gaps.map((gap) => gap.durationVariance), 0) : 0,
  };
}

export function listRequirements(filters: { projectId?: string; includeDeleted?: boolean; view?: string; status?: string } = {}) {
  const where = [filters.includeDeleted ? '1=1' : 'r.deleted_at IS NULL']; const params: unknown[] = [];
  if (filters.projectId) { where.push('r.project_id=?'); params.push(filters.projectId); }
  let result = rows<RequirementRecord>(`${requirementSelect} WHERE ${where.join(' AND ')} ORDER BY r.updated_at DESC`, ...params).map(enrichRequirement);
  if (filters.status) result = result.filter((item) => item.status === filters.status);
  if (filters.view === 'delayed') result = result.filter((item) => item.delayed);
  if (filters.view === 'high_risk') result = result.filter((item) => item.highRisk);
  return result;
}

export function getRequirement(id: string, includeDeleted = false) {
  const requirement = row<RequirementRecord>(`${requirementSelect} WHERE r.id=? ${includeDeleted ? '' : 'AND r.deleted_at IS NULL'}`, id);
  if (!requirement) throw new Error('需求不存在');
  const result = enrichRequirement(requirement);
  const progressUpdates = rows(`SELECT u.id, u.requirement_id AS requirementId, u.work_item_id AS workItemId,
    w.title AS workItemTitle, u.percent, u.work_item_percent AS workItemPercent, u.content,
    u.event_type AS eventType, u.supersedes_id AS supersedesId, u.created_by_account_id AS createdByAccountId,
    a.username AS createdByName, u.created_at AS createdAt, u.updated_at AS updatedAt
    FROM progress_updates u LEFT JOIN work_items w ON w.id=u.work_item_id
    LEFT JOIN accounts a ON a.id=u.created_by_account_id
    WHERE u.requirement_id=? ORDER BY u.created_at DESC`, id);
  return { ...result, progressUpdates };
}

function activeTemplateItems(templateId: string) {
  return rows<{ id: string; title: string; sortOrder: number; startOffsetDays: number; durationDays: number; milestoneLabel: string | null }>(`SELECT id, title,
    sort_order AS sortOrder, start_offset_days AS startOffsetDays, duration_days AS durationDays, milestone_label AS milestoneLabel
    FROM template_items WHERE template_id=? AND deleted_at IS NULL ORDER BY sort_order`, templateId);
}

function applyTemplateInternal(requirementId: string, templateId: string, baseStart: string) {
  const items = activeTemplateItems(templateId);
  if (!items.length) throw new Error('模板没有可用工作项');
  const existing = new Set(rows<{ templateItemId: string | null; title: string }>(
    'SELECT template_item_id AS templateItemId, title FROM work_items WHERE requirement_id=?', requirementId,
  ).flatMap((item) => [item.templateItemId, item.title].filter(Boolean) as string[]));
  const insert = sqlite.prepare(`INSERT INTO work_items
    (id, requirement_id, template_item_id, title, milestone_label, status, planned_start, planned_end, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'not_started', ?, ?, ?, ?, ?)`);
  const now = nowIso();
  let nextOrder = (row<{ maxOrder: number | null }>('SELECT MAX(sort_order) AS maxOrder FROM work_items WHERE requirement_id=?', requirementId)?.maxOrder ?? -1) + 1;
  for (const item of items) {
    if (existing.has(item.id) || existing.has(item.title)) continue;
    const plan = plannedDatesFromOffset(baseStart, item.startOffsetDays, item.durationDays);
    insert.run(randomUUID(), requirementId, item.id, item.title, item.milestoneLabel, plan.plannedStart, plan.plannedEnd, nextOrder++, now, now);
  }
}

function syncStoredRequirementState(requirementId: string, updatedAt = nowIso(), incrementVersion = true) {
  const requirement = row<RequirementRecord>(`${requirementSelect} WHERE r.id=?`, requirementId);
  if (!requirement) throw new Error('需求不存在');
  const workItems = getWorkItems(requirementId);
  const metrics = deriveRequirementMetrics(requirement, workItems);
  const acceptedAt = metrics.status === 'completed' ? requirement.acceptedAt : null;
  sqlite.prepare(`UPDATE requirements SET status=?, progress=?, planned_end=?, risk_level=?, accepted_at=?,
    accepted_by_account_id=CASE WHEN ? IS NULL THEN NULL ELSE accepted_by_account_id END,
    version=version+?, updated_at=? WHERE id=?`).run(
    metrics.status, metrics.progress, metrics.plannedEnd, metrics.riskLevel, acceptedAt, acceptedAt,
    incrementVersion ? 1 : 0, updatedAt, requirementId,
  );
  return metrics;
}

function updateStoredRequirementEnd(requirementId: string) {
  return syncStoredRequirementState(requirementId);
}

function syncStoredRequirementProgress(requirementId: string, updatedAt = nowIso()) {
  return syncStoredRequirementState(requirementId, updatedAt).progress;
}

function appendRequirementEvent(requirementId: string, eventType: string, content: string, actor: Actor, workItemId: string | null = null, workItemPercent: number | null = null, supersedesId: string | null = null, createdAt = nowIso()) {
  const percent = row<{ progress: number }>('SELECT progress FROM requirements WHERE id=?', requirementId)?.progress ?? 0;
  const id = randomUUID();
  sqlite.prepare(`INSERT INTO progress_updates
    (id, requirement_id, work_item_id, percent, work_item_percent, content, event_type, supersedes_id, created_by_account_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, requirementId, workItemId, percent, workItemPercent, content, eventType, supersedesId, actor.accountId || null, createdAt, createdAt,
  );
  return id;
}

function appendIssueEvent(issueId: string, eventType: string, content: string, actor: Actor, progress: number | null = null, supersedesId: string | null = null, createdAt = nowIso()) {
  const id = randomUUID();
  sqlite.prepare(`INSERT INTO issue_updates
    (id, issue_id, progress, content, event_type, supersedes_id, created_by_account_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, issueId, progress, content, eventType, supersedesId, actor.accountId || null, createdAt, createdAt,
  );
  return id;
}

function shiftRequirementWorkItems(requirementId: string, businessDays: number, updatedAt: string) {
  if (businessDays === 0) return;
  const items = rows<{ id: string; plannedStart: string | null; plannedEnd: string | null }>(
    'SELECT id, planned_start AS plannedStart, planned_end AS plannedEnd FROM work_items WHERE requirement_id=?', requirementId,
  );
  const update = sqlite.prepare('UPDATE work_items SET planned_start=?, planned_end=?, version=version+1, updated_at=? WHERE id=?');
  for (const item of items) {
    update.run(
      item.plannedStart ? addBusinessDays(item.plannedStart, businessDays) : null,
      item.plannedEnd ? addBusinessDays(item.plannedEnd, businessDays) : null,
      updatedAt,
      item.id,
    );
  }
}

export function createRequirement(input: JsonObject, actor: Actor) {
  const id = randomUUID(); const now = nowIso(); const projectId = requireText(input.projectId, '项目');
  const project = row<{ id: string; defaultTemplateId: string | null }>(
    'SELECT id, default_template_id AS defaultTemplateId FROM projects WHERE id=? AND deleted_at IS NULL', projectId,
  );
  if (!project) throw new Error('项目不存在');
  const title = requireText(input.title, '需求标题');
  const priority = ensureEnum(input.priority ?? 'P2', priorities, '优先级');
  const templateId = nullableText(input.templateId) || project.defaultTemplateId || firstActiveTemplateId(projectId);
  if (!templateId || !row('SELECT id FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL', templateId, projectId)) throw new Error('请选择当前项目的有效流程设计');
  const inputPlannedStart = nullableText(input.plannedStart);
  const inputPlannedEnd = nullableText(input.plannedEnd);
  if (Boolean(inputPlannedStart) === Boolean(inputPlannedEnd)) throw new Error('计划开始和截止日期请选择一项');
  let plannedStart: string;
  if (inputPlannedStart) {
    plannedStart = requireDate(inputPlannedStart, '计划开始');
    if (businessDaysInclusive(plannedStart, plannedStart) !== 1) throw new Error('计划开始需为工作日');
  } else {
    const deadline = requireDate(inputPlannedEnd, '截止日期');
    if (businessDaysInclusive(deadline, deadline) !== 1) throw new Error('截止日期需为工作日');
    plannedStart = plannedStartFromDeadline(deadline, activeTemplateItems(templateId));
  }
  const tx = sqlite.transaction(() => {
    sqlite.prepare(`INSERT INTO requirements
      (id, project_id, template_id, title, status, planned_start, progress, risk_level, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'planning', ?, 0, 'low', ?, ?, ?)`).run(id, projectId, templateId, title, plannedStart, priority, now, now);
    applyTemplateInternal(id, templateId, plannedStart);
    updateStoredRequirementEnd(id);
  });
  tx(); audit(actor, 'create', 'requirement', id, `创建需求并生成工作项：${title}`);
  return getRequirement(id);
}

function changeRequirement(id: string, input: JsonObject, actor: Actor) {
  const current = getRequirement(id);
  assertExpectedVersion(input, current.version);
  if (['pending_acceptance', 'completed', 'cancelled'].includes(current.status)) {
    fail('待验收、已完成或已取消需求已锁定，请使用验收、返工或纠错操作', 'TERMINAL_LOCKED');
  }
  const title = input.title === undefined ? current.title : requireText(input.title, '需求标题');
  const priority = input.priority === undefined ? current.priority : ensureEnum(input.priority, priorities, '优先级');
  const requestedPlannedStart = input.plannedStart === undefined ? undefined : requireDate(input.plannedStart, '计划开始');
  const requestedPlannedEnd = input.plannedEnd === undefined ? undefined : requireDate(input.plannedEnd, '计划完成');
  if (requestedPlannedStart !== undefined && requestedPlannedEnd !== undefined) throw new Error('计划开始和完成日期请选择一项');
  const scheduleMode = input.scheduleMode === undefined
    ? (requestedPlannedEnd !== undefined ? 'deadline' : 'start')
    : ensureEnum(input.scheduleMode, ['start', 'deadline'] as const, '排期方式');
  if (scheduleMode === 'start' && requestedPlannedEnd !== undefined) throw new Error('正排时请设置计划开始日期');
  if (scheduleMode === 'deadline' && requestedPlannedStart !== undefined) throw new Error('倒排时请设置计划完成日期');
  const templateId = input.templateId === undefined ? current.templateId : nullableText(input.templateId);
  const templateChanged = input.templateId !== undefined && templateId !== current.templateId;
  const hasExecution = current.workItems!.some((item) => item.status !== 'not_started' || item.progress > 0 || item.actualStart)
    || Boolean(row(`SELECT 1 FROM progress_updates WHERE requirement_id=? AND event_type<>'note' LIMIT 1`, id));
  let nextPlannedStart = current.plannedStart;
  let shiftDays = 0;
  if (requestedPlannedStart !== undefined || requestedPlannedEnd !== undefined) {
    const targetDate = requestedPlannedStart ?? requestedPlannedEnd!;
    if (businessDaysInclusive(targetDate, targetDate) !== 1) throw new Error(`${scheduleMode === 'start' ? '计划开始' : '计划完成'}需为工作日`);
    if (!templateChanged) {
      const currentAnchor = scheduleMode === 'start' ? current.plannedStart : current.plannedEnd;
      if (!currentAnchor) throw new Error('当前需求缺少可用于顺延的计划日期');
      shiftDays = businessDayDelta(currentAnchor, targetDate);
      nextPlannedStart = scheduleMode === 'start'
        ? targetDate
        : current.plannedStart ? addBusinessDays(current.plannedStart, shiftDays) : null;
    }
    if (hasExecution && !nullableText(input.reason)) fail('需求已开始执行，调整排期时必须填写变更原因');
  }
  if (templateChanged) {
    if (hasExecution) fail('需求已有执行记录，不能重选流程；请取消后重新创建', 'INVALID_TRANSITION');
    if (!templateId || !row('SELECT id FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL', templateId, current.projectId)) throw new Error('请选择当前项目的有效流程设计');
    if (requestedPlannedEnd !== undefined) {
      nextPlannedStart = plannedStartFromDeadline(requestedPlannedEnd, activeTemplateItems(templateId));
    } else if (requestedPlannedStart !== undefined) {
      nextPlannedStart = requestedPlannedStart;
    }
    if (!nextPlannedStart) throw new Error('重选流程前请设置计划日期');
    if (input.confirmTemplateReset !== true) throw new Error('重选流程会替换未执行工作项并重新生成计划；需求级说明将保留，请确认后重试');
  }
  const now = nowIso();
  sqlite.transaction(() => {
    if (templateChanged && templateId) {
      sqlite.prepare('DELETE FROM work_items WHERE requirement_id=?').run(id);
      sqlite.prepare(`UPDATE requirements SET template_id=?, title=?, status='planning', planned_start=?,
        planned_end=NULL, progress=0, risk_level='low', priority=?, accepted_at=NULL, accepted_by_account_id=NULL,
        version=version+1, updated_at=? WHERE id=?`)
        .run(templateId, title, nextPlannedStart, priority, now, id);
      applyTemplateInternal(id, templateId, nextPlannedStart!);
      updateStoredRequirementEnd(id);
      return;
    }
    shiftRequirementWorkItems(id, shiftDays, now);
    sqlite.prepare('UPDATE requirements SET title=?, priority=?, planned_start=?, version=version+1, updated_at=? WHERE id=?')
      .run(title, priority, nextPlannedStart, now, id);
    if (requestedPlannedStart !== undefined || requestedPlannedEnd !== undefined) updateStoredRequirementEnd(id);
  })();
  audit(actor, templateChanged ? 'apply_template' : 'update', 'requirement', id,
    templateChanged ? `重选流程并重建计划：${title}`
      : requestedPlannedStart !== undefined || requestedPlannedEnd !== undefined ? `调整需求排期：${title}` : `更新需求：${title}`);
  return getRequirement(id);
}

export function updateRequirement(id: string, input: JsonObject, actor: Actor) {
  const commandFields = ['status', 'progress', 'acceptedAt', 'acceptedByAccountId', 'plannedStart', 'plannedEnd', 'scheduleMode', 'templateId', 'confirmTemplateReset'];
  if (commandFields.some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    fail('需求状态、进度、验收、排期和流程不能通过普通编辑修改，请使用对应操作命令');
  }
  return changeRequirement(id, input, actor);
}

export function rescheduleRequirement(id: string, input: JsonObject, actor: Actor) {
  if (input.plannedStart === undefined && input.plannedEnd === undefined) fail('请设置计划开始或计划完成日期');
  if (['status', 'progress', 'acceptedAt', 'acceptedByAccountId', 'templateId'].some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    fail('排期命令不能修改状态、进度、验收或流程');
  }
  return changeRequirement(id, input, actor);
}

export function reselectRequirementTemplate(id: string, input: JsonObject, actor: Actor) {
  if (!nullableText(input.templateId)) fail('请选择要重新绑定的流程');
  if (['status', 'progress', 'acceptedAt', 'acceptedByAccountId'].some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    fail('流程重选命令不能修改状态、进度或验收信息');
  }
  return changeRequirement(id, { ...input, confirmTemplateReset: true }, actor);
}

export function archiveRequirement(id: string, input: JsonObject, actor: Actor) {
  const current = getRequirement(id);
  assertExpectedVersion(input, current.version);
  if (!['completed', 'cancelled'].includes(current.status)) fail('需求必须先完成验收或取消，才能归档', 'DEPENDENCY_CONFLICT');
  const activeIssues = row<{ count: number }>(`SELECT COUNT(*) AS count FROM issues WHERE requirement_id=? AND status<>'resolved'`, id)?.count || 0;
  if (activeIssues) fail(`需求仍有${activeIssues}个未解决问题，不能归档`, 'DEPENDENCY_CONFLICT', 409, { issues: activeIssues });
  sqlite.prepare('UPDATE requirements SET deleted_at=?, updated_at=? WHERE id=?').run(nowIso(), nowIso(), id);
  audit(actor, 'archive', 'requirement', id, `归档需求：${current.title}`);
  return { ok: true };
}

export function acceptRequirement(id: string, input: JsonObject, actor: Actor) {
  const current = getRequirement(id);
  assertExpectedVersion(input, current.version);
  assertTransition(current.status, ['pending_acceptance'], '验收');
  const content = requireText(input.content, '验收说明'); const now = nowIso();
  sqlite.transaction(() => {
    sqlite.prepare(`UPDATE requirements SET status='completed', progress=100, accepted_at=?, accepted_by_account_id=?,
      version=version+1, updated_at=? WHERE id=? AND version=?`).run(now, actor.accountId || null, now, id, current.version);
    appendRequirementEvent(id, 'accept', content, actor, null, null, null, now);
    audit(actor, 'accept', 'requirement', id, `验收需求：${current.title}`);
  })();
  return getRequirement(id);
}

export function cancelRequirement(id: string, input: JsonObject, actor: Actor) {
  const current = getRequirement(id);
  assertExpectedVersion(input, current.version);
  assertTransition(current.status, ['planning', 'not_started', 'in_progress', 'blocked', 'pending_acceptance'], '取消');
  const reason = requireText(input.reason, '取消原因'); const now = nowIso();
  sqlite.transaction(() => {
    sqlite.prepare(`UPDATE work_items SET status='cancelled', progress=min(progress,99), actual_end=NULL,
      blocked_at=NULL, blocked_reason=NULL, version=version+1, updated_at=?
      WHERE requirement_id=? AND status NOT IN ('completed','cancelled')`).run(now, id);
    sqlite.prepare(`UPDATE requirements SET status='cancelled', accepted_at=NULL, accepted_by_account_id=NULL,
      version=version+1, updated_at=? WHERE id=? AND version=?`).run(now, id, current.version);
    appendRequirementEvent(id, 'cancel', reason, actor, null, null, null, now);
    audit(actor, 'cancel', 'requirement', id, `取消需求：${current.title}`);
  })();
  return getRequirement(id);
}

export function restoreRequirement(id: string, actor: Actor) {
  if (!row('SELECT id FROM requirements WHERE id=? AND deleted_at IS NOT NULL', id)) throw new Error('归档需求不存在');
  sqlite.prepare('UPDATE requirements SET deleted_at=NULL, updated_at=? WHERE id=?').run(nowIso(), id);
  audit(actor, 'restore', 'requirement', id, '恢复需求');
  return getRequirement(id);
}

export function applyTemplate(requirementId: string, input: JsonObject, actor: Actor) {
  const requirement = getRequirement(requirementId);
  assertExpectedVersion(input, requirement.version);
  const templateId = requireText(input.templateId, '流程设计');
  if (['pending_acceptance', 'completed', 'cancelled'].includes(requirement.status)) fail('终态需求不能补充工作项', 'TERMINAL_LOCKED');
  if (requirement.workItems!.some((item) => item.status !== 'not_started') && !nullableText(input.reason)) fail('需求已开始执行，补充流程工作项时必须填写变更原因');
  if (!requirement.plannedStart) throw new Error('需求缺少计划开始日期');
  if (!row('SELECT id FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL', templateId, requirement.projectId)) throw new Error('流程设计不属于当前项目');
  const tx = sqlite.transaction(() => { applyTemplateInternal(requirementId, templateId, requirement.plannedStart!); updateStoredRequirementEnd(requirementId); });
  tx(); audit(actor, 'apply_template', 'requirement', requirementId, '从模板补充工作项');
  return getRequirement(requirementId);
}

export function previewRequirementPlan(requirementId: string, input: JsonObject) {
  const requirement = getRequirement(requirementId, true);
  const templateId = requireText(input.templateId, '流程设计');
  if (!row('SELECT id FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL', templateId, requirement.projectId)) throw new Error('流程设计不属于当前项目');
  const baseStart = requireDate(input.baseStart ?? requirement.plannedStart, '计划开始');
  const workItems = requirement.workItems || [];
  const entries = activeTemplateItems(templateId).map((item) => {
    const existing = workItems.find((work) => work.templateItemId === item.id) || workItems.find((work) => work.title === item.title);
    const proposed = plannedDatesFromOffset(baseStart, item.startOffsetDays, item.durationDays);
    return {
      templateItemId: item.id, workItemId: existing?.id || null, title: item.title,
      milestoneLabel: item.milestoneLabel,
      currentStart: existing?.plannedStart || null, currentEnd: existing?.plannedEnd || null,
      proposedStart: proposed.plannedStart, proposedEnd: proposed.plannedEnd,
      willChange: !existing || !existing.plannedStart || !existing.plannedEnd,
      reason: !existing ? 'missing_item' : !existing.plannedStart || !existing.plannedEnd ? 'missing_plan' : 'unchanged',
    };
  });
  return { requirementId, templateId, baseStart, entries };
}

export function applyRequirementPlan(requirementId: string, input: JsonObject, actor: Actor) {
  const requirement = getRequirement(requirementId);
  assertExpectedVersion(input, requirement.version);
  if (['pending_acceptance', 'completed', 'cancelled'].includes(requirement.status)) fail('终态需求不能修改工作计划', 'TERMINAL_LOCKED');
  const hasExecution = requirement.workItems!.some((item) => item.status !== 'not_started');
  if (hasExecution && !nullableText(input.reason)) fail('需求已开始执行，补全或调整计划时必须填写原因');
  const preview = previewRequirementPlan(requirementId, input);
  const selected = new Set(Array.isArray(input.templateItemIds) ? input.templateItemIds.map(String) : preview.entries.filter((item) => item.willChange).map((item) => item.templateItemId));
  const now = nowIso();
  const tx = sqlite.transaction(() => {
    let nextOrder = (row<{ maxOrder: number | null }>('SELECT MAX(sort_order) AS maxOrder FROM work_items WHERE requirement_id=?', requirementId)?.maxOrder ?? -1) + 1;
    for (const item of preview.entries) {
      if (!selected.has(item.templateItemId) || !item.willChange) continue;
      if (item.workItemId) {
        sqlite.prepare(`UPDATE work_items SET planned_start=COALESCE(planned_start, ?), planned_end=COALESCE(planned_end, ?), version=version+1, updated_at=? WHERE id=?`)
          .run(item.proposedStart, item.proposedEnd, now, item.workItemId);
      } else {
        sqlite.prepare(`INSERT INTO work_items
          (id, requirement_id, template_item_id, title, milestone_label, status, planned_start, planned_end, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'not_started', ?, ?, ?, ?, ?)`).run(
          randomUUID(), requirementId, item.templateItemId, item.title, item.milestoneLabel, item.proposedStart, item.proposedEnd, nextOrder++, now, now,
        );
      }
    }
    sqlite.prepare('UPDATE requirements SET planned_start=?, version=version+1, updated_at=? WHERE id=?').run(preview.baseStart, now, requirementId);
    updateStoredRequirementEnd(requirementId);
  });
  tx(); audit(actor, 'apply_plan', 'requirement', requirementId, `按模板补全计划：${selected.size}项`);
  return getRequirement(requirementId);
}

function collaboratorIdsFromInput(input: JsonObject, ownerId: string | null) {
  const value = input.collaboratorIds === undefined ? input.assigneeIds : input.collaboratorIds;
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('协作人员格式不合法');
  const ids = [...new Set(value.map((id) => String(id).trim()).filter((id) => id && id !== ownerId))];
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const count = row<{ count: number }>(`SELECT COUNT(*) AS count FROM people WHERE id IN (${placeholders}) AND deleted_at IS NULL AND active=1`, ...ids)?.count || 0;
    if (count !== ids.length) throw new Error('协作人员不存在或已停用');
  }
  return ids;
}

function assertProjectAssignees(requirementId: string, ids: Array<string | null>) {
  const assigneeIds = [...new Set(ids.filter(Boolean) as string[])];
  if (!assigneeIds.length) return;
  const requirement = row<{ projectId: string }>('SELECT project_id AS projectId FROM requirements WHERE id=?', requirementId);
  if (!requirement) throw new Error('需求不存在');
  const placeholders = assigneeIds.map(() => '?').join(',');
  const count = row<{ count: number }>(`SELECT COUNT(*) AS count FROM project_people pp
    JOIN people p ON p.id=pp.person_id
    WHERE pp.project_id=? AND pp.person_id IN (${placeholders}) AND pp.project_role IN ('member','manager')
      AND p.deleted_at IS NULL AND p.active=1`, requirement.projectId, ...assigneeIds)?.count || 0;
  if (count !== assigneeIds.length) throw new Error('负责人必须是当前项目中已启用的成员或项目经理');
}

function syncWorkItemCollaborators(workItemId: string, collaboratorIds: string[]) {
  sqlite.prepare('DELETE FROM work_item_collaborators WHERE work_item_id=?').run(workItemId);
  const insert = sqlite.prepare('INSERT INTO work_item_collaborators (work_item_id, person_id) VALUES (?, ?)');
  collaboratorIds.forEach((personId) => insert.run(workItemId, personId));
}

export function createWorkItem(requirementId: string, input: JsonObject, actor: Actor) {
  const requirement = getRequirement(requirementId);
  assertExpectedVersion(input, requirement.version);
  if (['pending_acceptance', 'completed', 'cancelled'].includes(requirement.status)) fail('当前需求已锁定，不能新增工作项', 'TERMINAL_LOCKED');
  if (requirement.workItems!.some((item) => item.status !== 'not_started') && !nullableText(input.reason)) {
    fail('需求已开始执行，新增工作项时必须填写变更原因');
  }
  const id = randomUUID(); const now = nowIso(); const title = requireText(input.title, '工作项标题');
  const max = row<{ value: number | null }>('SELECT MAX(sort_order) AS value FROM work_items WHERE requirement_id=?', requirementId)?.value ?? -1;
  const ownerId = nullableText(input.ownerId);
  const collaboratorIds = collaboratorIdsFromInput(input, ownerId) || [];
  assertProjectAssignees(requirementId, [ownerId, ...collaboratorIds]);
  const milestone = milestoneLabel(input.milestoneLabel);
  const plannedStart = nullableDate(input.plannedStart, '计划开始'); const plannedEnd = nullableDate(input.plannedEnd, '计划完成');
  if (plannedStart && plannedEnd && plannedStart > plannedEnd) throw new Error('计划完成日期不能早于计划开始日期');
  sqlite.transaction(() => {
    sqlite.prepare(`INSERT INTO work_items
      (id, requirement_id, title, owner_id, milestone_label, status, planned_start, planned_end, progress, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'not_started', ?, ?, 0, ?, ?, ?)`).run(
      id, requirementId, title, ownerId, milestone, plannedStart, plannedEnd, max + 1, now, now,
    );
    syncWorkItemCollaborators(id, collaboratorIds);
    syncStoredRequirementState(requirementId, now);
    audit(actor, 'create', 'work_item', id, `新增工作项：${title}${collaboratorIds.length ? `（${collaboratorIds.length + (ownerId ? 1 : 0)}人协作）` : ''}`);
  })();
  return getRequirement(requirementId).workItems!.find((item) => item.id === id);
}

export function updateWorkItem(id: string, input: JsonObject, actor: Actor) {
  const current = row<WorkItemRecord>(`${workItemSelect} WHERE w.id=?`, id);
  if (!current) throw new Error('工作项不存在');
  assertExpectedVersion(input, current.version);
  if (isTerminalWorkItemStatus(current.status)) fail('已完成或已取消的工作项已锁定，请使用重开或纠错操作', 'TERMINAL_LOCKED');
  const executionKeys = ['status', 'progress', 'actualStart', 'actualEnd', 'blockedAt', 'blockedReason'];
  if (executionKeys.some((key) => Object.prototype.hasOwnProperty.call(input, key))) fail('状态、进度和实际日期不能通过普通编辑修改，请使用对应操作命令');
  const title = input.title === undefined ? current.title : requireText(input.title, '工作项标题');
  const milestone = input.milestoneLabel === undefined ? current.milestoneLabel : milestoneLabel(input.milestoneLabel);
  const ownerId = input.ownerId === undefined ? current.ownerId : nullableText(input.ownerId);
  const collaboratorIds = collaboratorIdsFromInput(input, ownerId);
  const currentCollaborators = collaboratorIds === undefined
    ? rows<{ personId: string }>('SELECT person_id AS personId FROM work_item_collaborators WHERE work_item_id=?', id).map((item) => item.personId)
    : collaboratorIds;
  assertProjectAssignees(current.requirementId, [ownerId, ...currentCollaborators]);
  const plannedStart = input.plannedStart === undefined ? current.plannedStart : nullableDate(input.plannedStart, '计划开始');
  const plannedEnd = input.plannedEnd === undefined ? current.plannedEnd : nullableDate(input.plannedEnd, '计划完成');
  if (plannedStart && plannedEnd && plannedStart > plannedEnd) throw new Error('计划完成日期不能早于计划开始日期');
  const scheduleChanged = plannedStart !== current.plannedStart || plannedEnd !== current.plannedEnd;
  const requirementHasExecution = Boolean(row(`SELECT 1 FROM work_items WHERE requirement_id=? AND status<>'not_started' LIMIT 1`, current.requirementId));
  const collaboratorsChanged = collaboratorIds !== undefined
    && [...collaboratorIds].sort().join(',') !== [...currentCollaborators].sort().join(',');
  const structuralChanged = title !== current.title || milestone !== current.milestoneLabel || ownerId !== current.ownerId
    || collaboratorsChanged || scheduleChanged || input.sortOrder !== undefined && Number(input.sortOrder) !== current.sortOrder;
  if (requirementHasExecution && structuralChanged && !nullableText(input.reason)) fail('需求已开始执行，调整工作项结构、负责人或排期时必须填写变更原因');
  const now = nowIso();
  sqlite.transaction(() => {
    const result = sqlite.prepare(`UPDATE work_items SET title=?, owner_id=?, milestone_label=?, planned_start=?, planned_end=?,
      sort_order=?, version=version+1, updated_at=? WHERE id=? AND version=?`).run(
      title, ownerId, milestone, plannedStart, plannedEnd,
      input.sortOrder === undefined ? current.sortOrder : Number(input.sortOrder), now, id, current.version,
    );
    if (!result.changes) fail('数据已被其他用户修改，请刷新后重试', 'STALE_WRITE', 409, undefined, current.version);
    if (collaboratorIds !== undefined) syncWorkItemCollaborators(id, collaboratorIds);
    else if (ownerId) sqlite.prepare('DELETE FROM work_item_collaborators WHERE work_item_id=? AND person_id=?').run(id, ownerId);
    syncStoredRequirementState(current.requirementId, now);
    if (requirementHasExecution && structuralChanged) appendRequirementEvent(current.requirementId, 'correction', requireText(input.reason, '变更原因'), actor, id, current.progress, null, now);
    audit(actor, 'update', 'work_item', id, `更新工作项：${title}`);
  })();
  return getRequirement(current.requirementId).workItems!.find((item) => item.id === id);
}

function workItemEvent(id: string, action: 'start' | 'complete' | 'block' | 'unblock' | 'cancel', input: JsonObject, actor: Actor) {
  const current = row<WorkItemRecord>(`${workItemSelect} WHERE w.id=?`, id);
  if (!current) throw new Error('工作项不存在');
  assertExpectedVersion(input, current.version);
  const today = todayIso(); const now = nowIso();
  const labels = { start: '开始', complete: '完成', block: '阻塞', unblock: '解除阻塞', cancel: '取消' } as const;
  const eventContent = action === 'complete' ? requireText(input.content, '完成说明')
    : action === 'block' ? requireText(input.reason, '阻塞原因')
      : action === 'cancel' ? requireText(input.reason, '取消原因')
        : nullableText(input.content) || `${labels[action]}工作项`;
  if (action === 'start') {
    assertTransition(current.status, ['not_started'], '开始');
    if (!current.ownerId) fail('开始工作项前请指定负责人');
    if (!current.plannedStart || !current.plannedEnd) fail('开始工作项前请完善计划日期');
  }
  if (action === 'complete') assertTransition(current.status, ['in_progress'], '完成');
  if (action === 'block') assertTransition(current.status, ['in_progress'], '阻塞');
  if (action === 'unblock') assertTransition(current.status, ['blocked'], '解除阻塞');
  if (action === 'cancel') assertTransition(current.status, ['not_started', 'in_progress', 'blocked'], '取消');
  sqlite.transaction(() => {
    if (action === 'start') sqlite.prepare(`UPDATE work_items SET actual_start=?, status='in_progress', version=version+1, updated_at=? WHERE id=? AND version=?`).run(today, now, id, current.version);
    if (action === 'complete') sqlite.prepare(`UPDATE work_items SET actual_end=?, progress=100, status='completed', blocked_at=NULL, blocked_reason=NULL, version=version+1, updated_at=? WHERE id=? AND version=?`).run(today, now, id, current.version);
    if (action === 'block') sqlite.prepare(`UPDATE work_items SET blocked_at=?, blocked_reason=?, status='blocked', version=version+1, updated_at=? WHERE id=? AND version=?`).run(now, eventContent, now, id, current.version);
    if (action === 'unblock') sqlite.prepare(`UPDATE work_items SET blocked_at=NULL, blocked_reason=NULL, status='in_progress', version=version+1, updated_at=? WHERE id=? AND version=?`).run(now, id, current.version);
    if (action === 'cancel') sqlite.prepare(`UPDATE work_items SET status='cancelled', progress=min(progress,99), actual_end=NULL, blocked_at=NULL, blocked_reason=NULL, version=version+1, updated_at=? WHERE id=? AND version=?`).run(now, id, current.version);
    syncStoredRequirementState(current.requirementId, now);
    const nextProgress = action === 'complete' ? 100 : current.progress;
    appendRequirementEvent(current.requirementId, action, eventContent, actor, id, nextProgress, null, now);
    audit(actor, action, 'work_item', id, `${labels[action]}工作项：${current.title}`);
  })();
  return getRequirement(current.requirementId).workItems!.find((item) => item.id === id);
}

export const startWorkItem = (id: string, input: JsonObject, actor: Actor) => workItemEvent(id, 'start', input, actor);
export const completeWorkItem = (id: string, input: JsonObject, actor: Actor) => workItemEvent(id, 'complete', input, actor);
export const blockWorkItem = (id: string, input: JsonObject, actor: Actor) => workItemEvent(id, 'block', input, actor);
export const unblockWorkItem = (id: string, input: JsonObject, actor: Actor) => workItemEvent(id, 'unblock', input, actor);
export const cancelWorkItem = (id: string, input: JsonObject, actor: Actor) => workItemEvent(id, 'cancel', input, actor);

export function reopenWorkItem(id: string, input: JsonObject, actor: Actor) {
  const current = row<WorkItemRecord>(`${workItemSelect} WHERE w.id=?`, id);
  if (!current) throw new Error('工作项不存在');
  assertExpectedVersion(input, current.version); assertTransition(current.status, ['completed', 'cancelled'], '重开');
  const reason = requireText(input.reason, '重开原因');
  const restoredProgress = input.progress === undefined ? (current.status === 'completed' ? 99 : Math.min(current.progress, 99)) : requireProgress(input.progress, '恢复进度');
  if (restoredProgress >= 100) fail('恢复进度必须小于100%');
  const nextStatus = current.actualStart ? 'in_progress' : 'not_started'; const nextProgress = nextStatus === 'not_started' ? 0 : restoredProgress;
  const now = nowIso();
  sqlite.transaction(() => {
    sqlite.prepare(`UPDATE work_items SET status=?, progress=?, actual_end=NULL, blocked_at=NULL, blocked_reason=NULL,
      version=version+1, updated_at=? WHERE id=? AND version=?`).run(nextStatus, nextProgress, now, id, current.version);
    syncStoredRequirementState(current.requirementId, now);
    appendRequirementEvent(current.requirementId, 'reopen', reason, actor, id, nextProgress, null, now);
    audit(actor, 'reopen', 'work_item', id, `重开工作项：${current.title}`);
  })();
  return getRequirement(current.requirementId).workItems!.find((item) => item.id === id);
}

export function correctWorkItem(id: string, input: JsonObject, actor: Actor) {
  const current = row<WorkItemRecord>(`${workItemSelect} WHERE w.id=?`, id);
  if (!current) throw new Error('工作项不存在');
  assertExpectedVersion(input, current.version); const reason = requireText(input.reason, '纠错原因');
  const progress = input.progress === undefined ? current.progress : requireProgress(input.progress, '完成度');
  if (isTerminalWorkItemStatus(current.status) && progress !== current.progress) fail('终态工作项调整进度时必须使用重开操作', 'TERMINAL_LOCKED');
  if (progress >= 100 && current.status !== 'completed') fail('100%只能由完成操作产生');
  const actualStart = input.actualStart === undefined ? current.actualStart : nullableDate(input.actualStart, '实际开始');
  const actualEnd = input.actualEnd === undefined ? current.actualEnd : nullableDate(input.actualEnd, '实际完成');
  if (current.status === 'not_started' && (actualStart || actualEnd || progress !== 0)) fail('未开始工作项不能设置实际日期或非零进度');
  if (['in_progress', 'blocked'].includes(current.status) && (!actualStart || actualEnd || progress >= 100)) fail('进行中或阻塞工作项必须保留实际开始日期，且不能设置实际完成日期');
  if (current.status === 'completed' && (!actualStart || !actualEnd)) fail('已完成工作项必须保留实际开始和完成日期');
  if (current.status === 'cancelled' && actualEnd) fail('已取消工作项不能设置实际完成日期');
  if (actualStart && actualEnd && actualStart > actualEnd) fail('实际完成日期不能早于实际开始日期');
  const title = input.title === undefined ? current.title : requireText(input.title, '工作项标题'); const now = nowIso();
  sqlite.transaction(() => {
    sqlite.prepare(`UPDATE work_items SET title=?, actual_start=?, actual_end=?, progress=?, version=version+1, updated_at=? WHERE id=? AND version=?`)
      .run(title, actualStart, actualEnd, progress, now, id, current.version);
    syncStoredRequirementState(current.requirementId, now);
    appendRequirementEvent(current.requirementId, 'correction', reason, actor, id, progress, nullableText(input.supersedesId), now);
    audit(actor, 'correct', 'work_item', id, `纠错工作项：${current.title}`);
  })();
  return getRequirement(current.requirementId).workItems!.find((item) => item.id === id);
}

export function deleteWorkItem(id: string, input: JsonObject, actor: Actor) {
  const current = row<WorkItemRecord>(`${workItemSelect} WHERE w.id=?`, id);
  if (!current) throw new Error('工作项不存在');
  assertExpectedVersion(input, current.version);
  if (current.status !== 'not_started' || current.progress !== 0 || row('SELECT 1 FROM progress_updates WHERE work_item_id=? LIMIT 1', id)) {
    fail('只有未开始、0%且无历史的工作项可以删除，其他工作项请使用取消', 'DEPENDENCY_CONFLICT');
  }
  sqlite.transaction(() => { sqlite.prepare('DELETE FROM work_items WHERE id=?').run(id); syncStoredRequirementState(current.requirementId); })();
  audit(actor, 'delete', 'work_item', id, `删除工作项：${current.title}`);
  return { ok: true };
}

export function reorderWorkItems(requirementId: string, ids: string[], actor: Actor, input: JsonObject = {}) {
  const requirement = getRequirement(requirementId); assertExpectedVersion(input, requirement.version);
  if (['pending_acceptance', 'completed', 'cancelled'].includes(requirement.status)) fail('当前需求已锁定，不能调整工作项顺序', 'TERMINAL_LOCKED');
  if (requirement.workItems!.some((item) => item.status !== 'not_started') && !nullableText(input.reason)) fail('需求已开始执行，调整顺序时必须填写变更原因');
  const now = nowIso();
  const tx = sqlite.transaction(() => { ids.forEach((id, index) => sqlite.prepare('UPDATE work_items SET sort_order=?, version=version+1, updated_at=? WHERE id=? AND requirement_id=?').run(index, now, id, requirementId)); syncStoredRequirementState(requirementId, now); });
  tx(); audit(actor, 'reorder', 'work_item', requirementId, '调整工作项顺序');
  return getRequirement(requirementId).workItems;
}

export function addProgress(requirementId: string, input: JsonObject, actor: Actor) {
  const requirement = getRequirement(requirementId); const content = requireText(input.content, '具体进展');
  const id = randomUUID(); const now = nowIso(); const workItemId = nullableText(input.workItemId);
  if (workItemId && !requirement.workItems!.some((item) => item.id === workItemId)) throw new Error('关联工作项不存在');
  if (!workItemId && input.workItemPercent !== undefined && nullableText(input.workItemPercent) !== null) throw new Error('填写完成度前请选择工作项');
  const hasPercent = input.workItemPercent !== undefined && input.workItemPercent !== null && String(input.workItemPercent).trim() !== '';
  const workItemPercent = workItemId && hasPercent ? requireProgress(input.workItemPercent, '工作项完成度') : null;
  const workItem = workItemId ? requirement.workItems!.find((item) => item.id === workItemId)! : null;
  if (workItemPercent !== null && workItem) assertExpectedVersion(input, workItem.version);
  if (workItem && isTerminalWorkItemStatus(workItem.status)) fail('已完成或已取消工作项不能再提交进展', 'TERMINAL_LOCKED');
  if (workItemPercent !== null && workItem?.status !== 'in_progress') fail('只有进行中工作项可以更新完成度；请先开始或解除阻塞', 'INVALID_TRANSITION');
  if (workItemPercent === 100) fail('100%只能通过“完成工作项”操作提交');
  if (workItemPercent !== null && workItem && workItemPercent < workItem.progress) fail('普通进展不能降低完成度，请由项目经理执行纠错');
  if (!workItemId && ['pending_acceptance', 'completed', 'cancelled'].includes(requirement.status)) fail('终态需求已锁定，不能追加进展', 'TERMINAL_LOCKED');
  const tx = sqlite.transaction(() => {
    if (workItemId && workItemPercent !== null) {
      sqlite.prepare(`UPDATE work_items SET progress=?, version=version+1, updated_at=? WHERE id=? AND version=?`)
        .run(workItemPercent, now, workItemId, workItem!.version);
      syncStoredRequirementState(requirementId, now);
    }
    const percent = row<{ progress: number }>('SELECT progress FROM requirements WHERE id=?', requirementId)?.progress ?? requirement.progress;
    sqlite.prepare(`INSERT INTO progress_updates (id, requirement_id, work_item_id, percent, work_item_percent, content, event_type, created_by_account_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, requirementId, workItemId, percent, workItemPercent, content, workItemPercent === null ? 'note' : 'progress', actor.accountId || null, now, now);
  });
  tx(); const result = getRequirement(requirementId);
  audit(actor, 'create', 'progress', id, `追加进展：${result.progress}% ${content.slice(0, 50)}`);
  return result;
}

export function updateProgress(id: string, input: JsonObject, actor: Actor) {
  if (!row('SELECT id FROM progress_updates WHERE id=?', id)) throw new Error('进展记录不存在');
  fail('进展历史为只追加记录，不能修改；如需更正请追加纠错记录', 'HISTORY_IMMUTABLE');
}

export function deleteProgress(id: string, actor: Actor) {
  if (!row('SELECT id FROM progress_updates WHERE id=?', id)) throw new Error('进展记录不存在');
  fail('进展历史为只追加记录，不能删除', 'HISTORY_IMMUTABLE');
}

function enrichIssue(issue: Omit<IssueRecord, 'overdue'> & Partial<Pick<IssueRecord, 'overdue'>>): IssueRecord {
  return {
    ...issue,
    overdue: issue.status !== 'resolved' && Boolean(issue.dueDate && issue.dueDate < todayIso()),
  } as IssueRecord;
}

function issueRequirement(projectId: string, value: unknown) {
  const requirementId = nullableText(value);
  if (requirementId && !row('SELECT id FROM requirements WHERE id=? AND project_id=? AND deleted_at IS NULL', requirementId, projectId)) {
    throw new Error('关联需求不存在或不属于当前项目');
  }
  return requirementId;
}

function issueOwner(projectId: string, value: unknown) {
  const ownerId = nullableText(value);
  if (ownerId && !row(`SELECT p.id FROM people p JOIN project_people pp ON pp.person_id=p.id
    WHERE p.id=? AND pp.project_id=? AND pp.project_role IN ('member','manager')
      AND p.deleted_at IS NULL AND p.active=1`, ownerId, projectId)) {
    throw new Error('负责人必须是当前项目中已启用的成员或项目经理');
  }
  return ownerId;
}

export function listIssues(filters: {
  projectId?: string; q?: string; status?: string; priority?: string; ownerId?: string;
  requirementId?: string; scope?: string; overdue?: string | boolean; unassigned?: string | boolean;
  active?: string | boolean; page?: number; pageSize?: number;
} = {}) {
  const where: string[] = []; const params: unknown[] = [];
  if (filters.projectId) { where.push('i.project_id=?'); params.push(filters.projectId); }
  const q = String(filters.q || '').trim();
  if (q) {
    const pattern = `%${q}%`;
    where.push(`(i.title LIKE ? OR i.impact LIKE ? OR i.reporter LIKE ? OR i.source_ref LIKE ?
      OR r.title LIKE ? OR p.name LIKE ? OR EXISTS (
        SELECT 1 FROM issue_updates search_update WHERE search_update.issue_id=i.id AND search_update.content LIKE ?
      ))`);
    params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
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
    where.push(`i.status<>'resolved' AND i.due_date IS NOT NULL AND i.due_date<?`); params.push(todayIso());
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
      CASE WHEN i.status<>'resolved' AND i.due_date IS NOT NULL AND i.due_date<? THEN 0 ELSE 1 END,
      CASE i.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
      CASE WHEN i.due_date IS NULL THEN 1 ELSE 0 END, i.due_date,
      CASE i.status WHEN 'in_progress' THEN 0 WHEN 'open' THEN 1 WHEN 'deferred' THEN 2 ELSE 3 END,
      i.updated_at DESC, i.id
    LIMIT ? OFFSET ?`, ...params, todayIso(), pageSize, (page - 1) * pageSize).map(enrichIssue);
  const summaryWhere = filters.projectId ? 'WHERE project_id=?' : '';
  const summaryParams = filters.projectId ? [filters.projectId] : [];
  const rawSummary = row<any>(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open,
    SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) AS inProgress,
    SUM(CASE WHEN status='deferred' THEN 1 ELSE 0 END) AS deferred,
    SUM(CASE WHEN status='resolved' THEN 1 ELSE 0 END) AS resolved,
    SUM(CASE WHEN status<>'resolved' THEN 1 ELSE 0 END) AS active,
    SUM(CASE WHEN status<>'resolved' AND priority IN ('P0','P1') THEN 1 ELSE 0 END) AS highPriority,
    SUM(CASE WHEN status<>'resolved' AND due_date IS NOT NULL AND due_date<? THEN 1 ELSE 0 END) AS overdue,
    SUM(CASE WHEN owner_id IS NULL AND status<>'resolved' THEN 1 ELSE 0 END) AS unassigned
    FROM issues ${summaryWhere}`, todayIso(), ...summaryParams) || {};
  const totalSummary = Number(rawSummary.total || 0);
  const resolvedSummary = Number(rawSummary.resolved || 0);
  const summary = {
    total: totalSummary, open: Number(rawSummary.open || 0),
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
  if (!issue) throw new Error('问题不存在');
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
  const title = requireText(input.title, '问题标题');
  const requirementId = issueRequirement(projectId, input.requirementId);
  const priority = input.priority === undefined ? 'P2' : ensureEnum(input.priority, priorities, '问题优先级');
  const discoveredAt = input.discoveredAt === undefined ? todayIso() : requireDate(input.discoveredAt, '发现日期');
  const dueDate = nullableDate(input.dueDate, '目标日期');
  const now = nowIso();
  sqlite.prepare(`INSERT INTO issues
    (id, project_id, requirement_id, source_ref, title, impact, reporter, owner_id, status, priority,
      progress, discovered_at, due_date, resolved_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, projectId, requirementId, nullableText(input.sourceRef), title, nullableText(input.impact),
    nullableText(input.reporter), null, 'open', priority, 0, discoveredAt, dueDate, null, now, now,
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
  const title = input.title === undefined ? current.title : requireText(input.title, '问题标题');
  const requirementId = input.requirementId === undefined ? current.requirementId : issueRequirement(projectId, input.requirementId);
  const sourceRef = input.sourceRef === undefined ? current.sourceRef : nullableText(input.sourceRef);
  const ownerId = input.ownerId === undefined ? current.ownerId : issueOwner(projectId, input.ownerId);
  const priority = input.priority === undefined ? current.priority : ensureEnum(input.priority, priorities, '问题优先级');
  const now = nowIso();
  const dueDate = current.status === 'deferred' ? null : input.dueDate === undefined ? current.dueDate : nullableDate(input.dueDate, '目标日期');
  sqlite.transaction(() => {
    sqlite.prepare(`UPDATE issues SET requirement_id=?, source_ref=?, title=?, impact=?, reporter=?, owner_id=?,
      priority=?, discovered_at=?, due_date=?, version=version+1, updated_at=? WHERE id=? AND version=?`).run(
      requirementId, sourceRef, title,
      input.impact === undefined ? current.impact : nullableText(input.impact),
      input.reporter === undefined ? current.reporter : nullableText(input.reporter),
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
  if (hasProgress && !permissions.canSetProgress) throw new Error('只有问题负责人或项目经理可以更新问题完成度');
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

function issueStateEvent(id: string, action: 'start' | 'defer' | 'resume' | 'resolve', input: JsonObject, actor: Actor) {
  const current = getIssue(id); assertExpectedVersion(input, current.version); const now = nowIso();
  const content = action === 'start' ? nullableText(input.content) || '开始处理问题'
    : action === 'defer' ? requireText(input.reason, '暂缓原因')
      : action === 'resume' ? requireText(input.reason, '恢复原因')
        : requireText(input.content, '闭环说明');
  if (action === 'start') {
    assertTransition(current.status, ['open'], '开始处理');
    if (!current.ownerId) fail('进入处理中前请指定负责人');
  }
  if (action === 'defer') assertTransition(current.status, ['open', 'in_progress'], '暂缓');
  if (action === 'resume') assertTransition(current.status, ['deferred'], '恢复');
  if (action === 'resolve') assertTransition(current.status, ['in_progress'], '确认解决');
  const resumeStatus = current.progress > 0 ? 'in_progress' : 'open';
  if (action === 'resume' && resumeStatus === 'in_progress' && !current.ownerId) fail('恢复处理前请指定负责人');
  sqlite.transaction(() => {
    if (action === 'start') sqlite.prepare(`UPDATE issues SET status='in_progress', version=version+1, updated_at=? WHERE id=? AND version=?`).run(now, id, current.version);
    if (action === 'defer') sqlite.prepare(`UPDATE issues SET status='deferred', due_date=NULL, version=version+1, updated_at=? WHERE id=? AND version=?`).run(now, id, current.version);
    if (action === 'resume') sqlite.prepare(`UPDATE issues SET status=?, version=version+1, updated_at=? WHERE id=? AND version=?`).run(resumeStatus, now, id, current.version);
    if (action === 'resolve') sqlite.prepare(`UPDATE issues SET status='resolved', progress=100, resolved_at=?, version=version+1, updated_at=? WHERE id=? AND version=?`).run(todayIso(), now, id, current.version);
    appendIssueEvent(id, action, content, actor, action === 'resolve' ? 100 : current.progress, null, now);
    audit(actor, action, 'issue', id, `${action === 'start' ? '开始处理' : action === 'defer' ? '暂缓' : action === 'resume' ? '恢处理' : '确认解决'}问题：${current.title}`);
  })();
  return getIssue(id);
}

export const startIssue = (id: string, input: JsonObject, actor: Actor) => issueStateEvent(id, 'start', input, actor);
export const deferIssue = (id: string, input: JsonObject, actor: Actor) => issueStateEvent(id, 'defer', input, actor);
export const resumeIssue = (id: string, input: JsonObject, actor: Actor) => issueStateEvent(id, 'resume', input, actor);
export const resolveIssue = (id: string, input: JsonObject, actor: Actor) => issueStateEvent(id, 'resolve', input, actor);

export function reopenIssue(id: string, input: JsonObject, actor: Actor) {
  const current = getIssue(id); assertExpectedVersion(input, current.version); assertTransition(current.status, ['resolved'], '重开');
  const reason = requireText(input.reason, '重开原因');
  const requested = input.progress === undefined ? (current.ownerId ? 99 : 0) : requireProgress(input.progress, '恢复进度');
  if (requested >= 100) fail('恢复进度必须小于100%');
  if (requested > 0 && !current.ownerId) fail('恢复为处理中前请先指定负责人');
  const status = requested > 0 ? 'in_progress' : 'open'; const now = nowIso();
  sqlite.transaction(() => {
    sqlite.prepare(`UPDATE issues SET status=?, progress=?, resolved_at=NULL, version=version+1, updated_at=? WHERE id=? AND version=?`)
      .run(status, requested, now, id, current.version);
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
  if (current.status === 'open' && progress !== 0) fail('待处理问题进度必须为0%');
  const title = input.title === undefined ? current.title : requireText(input.title, '问题标题');
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

export function updateIssueUpdate(issueId: string, updateId: string, input: JsonObject, actor: Actor) {
  if (!row('SELECT id FROM issue_updates WHERE id=? AND issue_id=?', updateId, issueId)) throw new Error('问题进展不存在');
  fail('问题历史为只追加记录，不能修改；如需更正请追加纠错记录', 'HISTORY_IMMUTABLE');
}

export function deleteIssueUpdate(issueId: string, updateId: string, actor: Actor) {
  if (!row('SELECT id FROM issue_updates WHERE id=? AND issue_id=?', updateId, issueId)) throw new Error('问题进展不存在');
  fail('问题历史为只追加记录，不能删除', 'HISTORY_IMMUTABLE');
}

export function getPeopleConcurrency(filters: { projectId?: string; personId?: string; jobTitle?: string; from?: string; to?: string; includeExternalAggregate?: boolean } = {}) {
  const from = filters.from || todayIso(); const to = filters.to || addCalendarDays(from, 6);
  const dates: string[] = [];
  for (let date = from; date <= to; date = addCalendarDays(date, 1)) if (businessDaysInclusive(date, date) === 1) dates.push(date);
  const where = ['p.deleted_at IS NULL', 'p.active=1']; const params: unknown[] = [];
  if (filters.personId) { where.push('p.id=?'); params.push(filters.personId); }
  if (filters.jobTitle) { where.push('p.job_title=?'); params.push(filters.jobTitle); }
  if (filters.projectId) {
    where.push('EXISTS (SELECT 1 FROM project_people pp WHERE pp.person_id=p.id AND pp.project_id=?)');
    params.push(filters.projectId);
  }
  const people = rows<any>(`SELECT p.id, p.name, p.job_title AS jobTitle FROM people p WHERE ${where.join(' AND ')} ORDER BY p.name`, ...params);
  const itemWhere = ['a.personId IS NOT NULL', 'r.deleted_at IS NULL']; const itemParams: unknown[] = [];
  if (filters.projectId) { itemWhere.push('r.project_id=?'); itemParams.push(filters.projectId); }
  const items = rows<any>(`SELECT w.id, w.title, a.personId, w.status, w.planned_start AS plannedStart,
    w.planned_end AS plannedEnd, w.actual_start AS actualStart, w.actual_end AS actualEnd,
    w.blocked_at AS blockedAt, r.id AS requirementId, r.title AS requirementTitle
    FROM work_items w
    JOIN requirements r ON r.id=w.requirement_id
    JOIN (
      SELECT id AS workItemId, owner_id AS personId FROM work_items WHERE owner_id IS NOT NULL
      UNION
      SELECT work_item_id AS workItemId, person_id AS personId FROM work_item_collaborators
    ) a ON a.workItemId=w.id
    WHERE ${itemWhere.join(' AND ')}`, ...itemParams)
    .filter((item) => deriveWorkItemStatus(item) !== 'cancelled');
  const today = todayIso();
  const externalCounts = new Map<string, number>();
  if (filters.projectId && filters.includeExternalAggregate) {
    const external = rows<{ personId: string; count: number }>(`SELECT a.personId, COUNT(DISTINCT w.id) AS count
      FROM work_items w JOIN requirements r ON r.id=w.requirement_id
      JOIN (
        SELECT id AS workItemId, owner_id AS personId FROM work_items WHERE owner_id IS NOT NULL
        UNION SELECT work_item_id AS workItemId, person_id AS personId FROM work_item_collaborators
      ) a ON a.workItemId=w.id
      WHERE r.project_id<>? AND r.deleted_at IS NULL AND w.status NOT IN ('completed','cancelled')
        AND w.actual_start IS NOT NULL AND w.actual_start<=? AND (w.actual_end IS NULL OR w.actual_end>=?)
      GROUP BY a.personId`, filters.projectId, today, today);
    external.forEach((item) => externalCounts.set(item.personId, Number(item.count)));
  }
  const result = people.map((person) => {
    const owned = items.filter((item) => item.personId === person.id);
    const days = dates.map((date) => {
      const plannedItems = owned.filter((item) => item.plannedStart && item.plannedEnd && date >= item.plannedStart && date <= item.plannedEnd);
      const actualItems = owned.filter((item) => item.actualStart && date >= item.actualStart && date <= (item.actualEnd || today));
      const selected = date <= today ? actualItems : plannedItems;
      return { date, count: selected.length, plannedCount: plannedItems.length, actualCount: actualItems.length, items: selected.map((item) => ({ id: item.id, title: item.title, requirementId: item.requirementId, requirementTitle: item.requirementTitle })) };
    });
    return { ...person, currentCount: days.find((day) => day.date === today)?.count || 0,
      externalCurrentCount: filters.includeExternalAggregate ? externalCounts.get(person.id) || 0 : undefined,
      peakCount: Math.max(0, ...days.map((day) => day.count)), days };
  });
  return { from, to, dates, people: result, currentTop: [...result].filter((person) => person.currentCount > 0).sort((a, b) => b.currentCount - a.currentCount).slice(0, 5) };
}

export function listArchives(projectId?: string) {
  return {
    projects: projectId ? [] : rows(`SELECT p.id, p.name AS title, p.deleted_at AS deletedAt,
      (SELECT COUNT(*) FROM requirements r WHERE r.project_id=p.id) AS requirementCount,
      (SELECT COUNT(*) FROM work_items w JOIN requirements r ON r.id=w.requirement_id WHERE r.project_id=p.id) AS workItemCount,
      (SELECT COUNT(*) FROM issues i WHERE i.project_id=p.id) AS issueCount,
      (SELECT COUNT(*) FROM work_item_templates t WHERE t.project_id=p.id) AS templateCount
      FROM projects p WHERE p.deleted_at IS NOT NULL ORDER BY p.deleted_at DESC`),
    requirements: rows(`SELECT r.id, r.title, r.deleted_at AS deletedAt,
      (SELECT COUNT(*) FROM work_items w WHERE w.requirement_id=r.id) AS workItemCount,
      (SELECT COUNT(*) FROM progress_updates u WHERE u.requirement_id=r.id) AS progressCount,
      (SELECT COUNT(*) FROM issues i WHERE i.requirement_id=r.id) AS linkedIssueCount
      FROM requirements r WHERE r.deleted_at IS NOT NULL ${projectId ? 'AND r.project_id=?' : ''} ORDER BY r.deleted_at DESC`, ...(projectId ? [projectId] : [])),
    people: projectId ? [] : rows(`SELECT id, name AS title, job_title AS jobTitle, deleted_at AS deletedAt FROM people WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`),
    templates: rows(`SELECT id, name AS title, deleted_at AS deletedAt FROM work_item_templates WHERE deleted_at IS NOT NULL ${projectId ? 'AND project_id=?' : ''} ORDER BY deleted_at DESC`, ...(projectId ? [projectId] : [])),
  };
}

export type ArchiveEntity = 'projects' | 'requirements' | 'people' | 'templates';

export function permanentlyDeleteArchive(entity: ArchiveEntity, id: string, actor: Actor, input: JsonObject = {}) {
  const tx = sqlite.transaction(() => {
    if (entity === 'projects') {
      const project = row<{ name: string }>('SELECT name FROM projects WHERE id=? AND deleted_at IS NOT NULL', id);
      if (!project) throw new Error('归档项目不存在');
      if (requireText(input.confirmName, '确认名称') !== project.name) fail('确认名称与项目名称不一致');
      const requirementCount = row<{ count: number }>('SELECT COUNT(*) AS count FROM requirements WHERE project_id=?', id)?.count || 0;
      sqlite.prepare('DELETE FROM requirements WHERE project_id=?').run(id);
      sqlite.prepare('DELETE FROM projects WHERE id=?').run(id);
      if (isSampleProjectId(id)) deleteOrReleaseSamplePeople(sqlite, nowIso());
      audit(actor, 'permanent_delete', 'project', id, `永久删除归档项目：${project.name}（含${requirementCount}条需求）`, null);
      return { ok: true };
    }
    if (entity === 'requirements') {
      const requirement = row<{ title: string }>('SELECT title FROM requirements WHERE id=? AND deleted_at IS NOT NULL', id);
      if (!requirement) throw new Error('归档需求不存在');
      if (requireText(input.confirmName, '确认名称') !== requirement.title) fail('确认名称与需求名称不一致');
      sqlite.prepare('DELETE FROM requirements WHERE id=?').run(id);
      audit(actor, 'permanent_delete', 'requirement', id, `永久删除归档需求：${requirement.title}`);
      return { ok: true };
    }
    if (entity === 'people') {
      const person = row<{ name: string }>('SELECT name FROM people WHERE id=? AND deleted_at IS NOT NULL', id);
      if (!person) throw new Error('归档人员不存在');
      const references = row<{ count: number }>(`SELECT
        (SELECT COUNT(*) FROM requirements WHERE owner_id=?) +
        (SELECT COUNT(*) FROM work_items WHERE owner_id=?) +
        (SELECT COUNT(*) FROM work_item_collaborators WHERE person_id=?) +
        (SELECT COUNT(*) FROM issues WHERE owner_id=?) AS count`, id, id, id, id)?.count || 0;
      if (references) fail(`该人员仍被${references}条历史业务记录引用，只能保留归档`, 'DEPENDENCY_CONFLICT', 409, { references });
      sqlite.prepare('DELETE FROM accounts WHERE person_id=? AND is_builtin=0').run(id);
      sqlite.prepare('DELETE FROM people WHERE id=?').run(id);
      audit(actor, 'permanent_delete', 'person', id, `永久删除归档人员：${person.name}`);
      return { ok: true };
    }
    if (entity === 'templates') {
      const template = row<{ name: string }>('SELECT name FROM work_item_templates WHERE id=? AND deleted_at IS NOT NULL', id);
      if (!template) throw new Error('归档模板不存在');
      const references = row<{ count: number }>(`SELECT
        (SELECT COUNT(*) FROM requirements WHERE template_id=?) +
        (SELECT COUNT(*) FROM work_items WHERE template_item_id IN (SELECT id FROM template_items WHERE template_id=?)) AS count`, id, id)?.count || 0;
      if (references) fail(`该流程仍被${references}条历史业务记录引用，只能保留归档快照`, 'DEPENDENCY_CONFLICT', 409, { references });
      sqlite.prepare('DELETE FROM work_item_templates WHERE id=?').run(id);
      audit(actor, 'permanent_delete', 'template', id, `永久删除归档模板：${template.name}`);
      return { ok: true };
    }
    throw new Error('归档类型不合法');
  });
  return tx();
}

export function getDashboard(projectId?: string) {
  const requirements = listRequirements({ projectId });
  const recentProgress = rows<{ id: string; requirementId: string; workItemId: string | null; workItemTitle: string | null; percent: number; content: string; createdAt: string; updatedAt: string }>(`
    SELECT id, requirementId, workItemId, workItemTitle, percent, content, createdAt, updatedAt FROM (
      SELECT u.id, u.requirement_id AS requirementId, u.work_item_id AS workItemId,
        w.title AS workItemTitle, u.percent, u.content, u.created_at AS createdAt, u.updated_at AS updatedAt,
        ROW_NUMBER() OVER (PARTITION BY u.requirement_id ORDER BY u.created_at DESC, u.id DESC) AS rank
      FROM progress_updates u
      LEFT JOIN work_items w ON w.id=u.work_item_id
      JOIN requirements r ON r.id=u.requirement_id
      WHERE r.deleted_at IS NULL ${projectId ? 'AND r.project_id=?' : ''}
    ) ranked WHERE rank<=3 ORDER BY createdAt DESC`, ...(projectId ? [projectId] : []));
  const recentByRequirement = new Map<string, typeof recentProgress>();
  for (const update of recentProgress) recentByRequirement.set(update.requirementId, [...(recentByRequirement.get(update.requirementId) || []), update]);
  const requirementIssueCounts = rows<{ requirementId: string; active: number; overdue: number }>(`
    SELECT requirement_id AS requirementId, COUNT(*) AS active,
      SUM(CASE WHEN due_date IS NOT NULL AND due_date<? THEN 1 ELSE 0 END) AS overdue
    FROM issues
    WHERE requirement_id IS NOT NULL AND status<>'resolved' ${projectId ? 'AND project_id=?' : ''}
    GROUP BY requirement_id`, todayIso(), ...(projectId ? [projectId] : []));
  const issuesByRequirement = new Map(requirementIssueCounts.map((item) => [item.requirementId, {
    active: Number(item.active || 0), overdue: Number(item.overdue || 0),
  }]));
  const dashboardRequirements = requirements.map((item) => ({
    ...item,
    recentProgressUpdates: recentByRequirement.get(item.id) || [],
    issueSummary: issuesByRequirement.get(item.id) || { active: 0, overdue: 0 },
  }));
  const active = requirements.filter((item) => !['completed', 'cancelled'].includes(item.status)).length;
  const completed = requirements.filter((item) => item.status === 'completed').length;
  const delayed = requirements.filter((item) => item.delayed).length;
  const highRisk = requirements.filter((item) => item.highRisk).length;
  const evaluatedRequirements = requirements.filter((item) => item.riskEvaluated);
  const completionRate = requirements.length ? Math.round((completed / requirements.length) * 1000) / 10 : 0;
  const statuses = requirementStatuses.map((status) => ({ status, count: requirements.filter((item) => item.status === status).length }));
  const risks = riskLevels.map((risk) => ({ risk, count: evaluatedRequirements.filter((item) => item.riskLevel === risk).length }));
  const weeks: Array<{ week: string; completed: number }> = []; const now = new Date();
  for (let i = 11; i >= 0; i -= 1) {
    const start = new Date(now); start.setDate(now.getDate() - now.getDay() - i * 7 + 1); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(start.getDate() + 7);
    weeks.push({ week: `${start.getMonth() + 1}/${start.getDate()}`, completed: requirements.filter((item) => item.status === 'completed' && new Date(item.updatedAt) >= start && new Date(item.updatedAt) < end).length });
  }
  const varianceTop = requirements.filter((item) => (item.finishVariance ?? 0) > 0).sort((a, b) => (b.finishVariance ?? 0) - (a.finishVariance ?? 0)).slice(0, 10)
    .map((item) => ({ id: item.id, title: item.title, variance: item.finishVariance }));
  const issuePage = listIssues({ projectId, scope: 'public', page: 1, pageSize: 10 });
  const attention = issuePage.items.filter((item) => item.status === 'open' || item.status === 'in_progress').slice(0, 5);
  return {
    summary: { total: requirements.length, active, completed, delayed, highRisk, completionRate },
    requirements: dashboardRequirements,
    issues: { summary: issuePage.summary, attention },
    charts: { statuses, risks, weeks, varianceTop },
  };
}

export function listAudit(limit = 100, projectId?: string) {
  return rows(`${auditSelect} ${auditFrom} ${projectId ? 'WHERE l.project_id=?' : ''} ORDER BY l.created_at DESC LIMIT ?`,
    ...(projectId ? [projectId] : []), Math.min(Math.max(limit, 1), 500));
}

const auditSelect = `SELECT l.id, l.actor_type AS actorType, l.actor_id AS actorId,
  CASE WHEN l.actor_type='user' THEN user_account.username WHEN l.actor_type='token' THEN token_account.username END AS actorName,
  actor_token.name AS tokenName, l.action, l.entity_type AS entityType, l.entity_id AS entityId,
  l.project_id AS projectId, audit_project.name AS projectName,
  l.summary, l.created_at AS createdAt`;
const auditFrom = `FROM audit_logs l
  LEFT JOIN accounts user_account ON l.actor_type='user' AND user_account.id=l.actor_id
  LEFT JOIN api_tokens actor_token ON l.actor_type='token' AND actor_token.id=l.actor_id
  LEFT JOIN accounts token_account ON token_account.id=actor_token.account_id
  LEFT JOIN projects audit_project ON audit_project.id=l.project_id`;

export function searchAudit(filters: { q?: string; actorType?: string; action?: string; entityType?: string; projectId?: string; from?: string; to?: string; page?: number; pageSize?: number } = {}) {
  const where: string[] = []; const params: unknown[] = [];
  const q = String(filters.q || '').trim();
  if (q) {
    where.push('(l.summary LIKE ? OR l.entity_id LIKE ? OR l.actor_id LIKE ? OR l.action LIKE ? OR user_account.username LIKE ? OR token_account.username LIKE ? OR actor_token.name LIKE ?)');
    const pattern = `%${q}%`; params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  }
  if (filters.actorType) { where.push('l.actor_type=?'); params.push(filters.actorType); }
  if (filters.action) { where.push('l.action=?'); params.push(filters.action); }
  if (filters.entityType) { where.push('l.entity_type=?'); params.push(filters.entityType); }
  if (filters.projectId) { where.push('l.project_id=?'); params.push(filters.projectId); }
  if (filters.from) { where.push('l.created_at>=?'); params.push(`${filters.from}T00:00:00.000Z`); }
  if (filters.to) { where.push('l.created_at<=?'); params.push(`${filters.to}T23:59:59.999Z`); }
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(100, Math.max(20, Number(filters.pageSize) || 50));
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = row<{ count: number }>(`SELECT COUNT(*) AS count ${auditFrom} ${clause}`, ...params)?.count || 0;
  const items = rows(`${auditSelect} ${auditFrom} ${clause}
    ORDER BY l.created_at DESC LIMIT ? OFFSET ?`, ...params, pageSize, (page - 1) * pageSize);
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export function listTokens(accountId?: string, allAccounts = false) {
  return rows(`SELECT t.id, t.name, t.prefix, t.expires_at AS expiresAt, t.last_used_at AS lastUsedAt,
    t.revoked_at AS revokedAt, t.account_id AS accountId, a.username AS accountName, t.created_at AS createdAt
    FROM api_tokens t JOIN accounts a ON a.id=t.account_id
    ${allAccounts ? '' : 'WHERE t.account_id=?'} ORDER BY t.created_at DESC`, ...(allAccounts ? [] : [accountId || '']));
}

export function issueToken(input: JsonObject, actor: Actor) {
  if (!actor.accountId) throw new Error('Token必须绑定登录账号');
  const id = randomUUID(); const name = requireText(input.name, 'Token名称'); const now = nowIso();
  const days = input.expiresInDays === null || input.expiresInDays === 'never' ? null : Number(input.expiresInDays ?? 90);
  if (days !== null && (!Number.isFinite(days) || days < 1 || days > 3650)) throw new Error('有效期不合法');
  const expiresAt = days === null ? null : new Date(Date.now() + days * 86400000).toISOString();
  const { prefix, token } = createApiTokenValue();
  sqlite.prepare(`INSERT INTO api_tokens (id, name, prefix, token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, name, prefix, hashApiToken(token), actor.accountId, expiresAt, now);
  audit(actor, 'create', 'api_token', id, `创建MCP Token：${name}`);
  return { id, name, prefix, token, expiresAt, createdAt: now };
}

export function revokeToken(id: string, actor: Actor, allowAnyAccount = false) {
  const token = row<{ name: string; accountId: string }>('SELECT name, account_id AS accountId FROM api_tokens WHERE id=?', id);
  if (!token) throw new Error('Token不存在');
  if (!allowAnyAccount && token.accountId !== actor.accountId) {
    const error = new Error('只能撤销自己的Token') as Error & { statusCode: number }; error.statusCode = 403; throw error;
  }
  sqlite.prepare('UPDATE api_tokens SET revoked_at=? WHERE id=?').run(nowIso(), id);
  audit(actor, 'revoke', 'api_token', id, `撤销MCP Token：${token.name}`);
  return { ok: true };
}

export function authenticateApiToken(token: string): (Actor & { accountId: string; personId: string | null; globalRole: 'user' | 'admin' }) | null {
  const match = /^pm_([a-f0-9]{10})_/.exec(token);
  if (!match) return null;
  const record = row<any>(`SELECT t.*, a.username, a.person_id, a.global_role, a.status AS account_status
    FROM api_tokens t JOIN accounts a ON a.id=t.account_id WHERE t.prefix=?`, match[1]);
  if (!record || record.revoked_at || record.account_status !== 'active'
    || (record.expires_at && record.expires_at <= nowIso())) return null;
  const actualHash = Buffer.from(hashApiToken(token)); const expectedHash = Buffer.from(record.token_hash);
  if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) return null;
  sqlite.prepare('UPDATE api_tokens SET last_used_at=? WHERE id=?').run(nowIso(), record.id);
  return { type: 'token', id: record.id, label: record.name, accountId: record.account_id,
    personId: record.person_id, globalRole: record.global_role };
}

export { issueStatuses, priorities, requirementStatuses, riskLevels, workItemStatuses };
