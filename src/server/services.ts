import { randomUUID, timingSafeEqual } from 'node:crypto';
import { sqlite } from './database';
import { createApiTokenValue, hashApiToken, type Actor } from './auth';
import { createAccountForPerson } from './accounts';
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
  todayIso,
  workItemStatuses,
  type ProjectRole,
} from '../shared/domain';

type JsonObject = Record<string, unknown>;
const nowIso = () => new Date().toISOString();

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
  if (!allowed.includes(value as T[number])) throw new Error(`${field}不合法`);
  return value as T[number];
}

function requireText(value: unknown, field: string) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${field}不能为空`);
  return text;
}

function nullableText(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

function templateDescription(value: unknown) {
  const description = String(value ?? '').trim();
  if (description.length > 2000) throw new Error('流程描述不能超过2000个字符');
  return description;
}

function milestoneLabel(value: unknown) {
  const label = String(value ?? '').trim();
  if (label.length > 80) throw new Error('里程碑名称不能超过80个字符');
  return label || null;
}

function requireDate(value: unknown, field: string) {
  const text = requireText(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${field}格式不合法`);
  return text;
}

function nullableDate(value: unknown, field: string) {
  const text = nullableText(value);
  if (text && !/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${field}格式不合法`);
  return text;
}

function requireProgress(value: unknown, field = '完成度') {
  const progress = Number(value);
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw new Error(`${field}必须是0到100的整数`);
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
  projectRole?: ProjectRole; canManage?: boolean;
};

export type WorkItemRecord = {
  id: string; requirementId: string; templateItemId: string | null; title: string; ownerId: string | null; ownerName: string | null;
  status: string; plannedStart: string | null; plannedEnd: string | null; actualStart: string | null; actualEnd: string | null;
  forecastEnd: string | null; blockedAt: string | null; blockedReason: string | null; milestoneLabel: string | null; progress: number; sortOrder: number; createdAt: string; updatedAt: string;
  collaborators: Array<{ id: string; name: string; jobTitle: string | null }>;
  assigneeIds: string[]; assigneeNames: string[];
};

export type RequirementRecord = {
  id: string; projectId: string; projectName: string; templateId: string | null; templateName: string | null; title: string; ownerId: string | null; ownerName: string | null;
  status: string; plannedStart: string | null; plannedEnd: string | null; progress: number; plannedProgress?: number; progressGap?: number;
  riskLevel: string; priority: string; createdAt: string; updatedAt: string; deletedAt?: string | null; workItems?: WorkItemRecord[];
  delayed?: boolean; highRisk?: boolean; riskEvaluated?: boolean; riskReason?: string; finishVariance?: number; durationVariance?: number; effectiveEnd?: string | null;
};

export type IssueUpdateRecord = {
  id: string; issueId: string; progress: number | null; content: string; createdByAccountId: string | null; createdByName: string | null; createdAt: string; updatedAt: string;
};

export type IssueRecord = {
  id: string; projectId: string; projectName: string; requirementId: string | null; requirementTitle: string | null;
  sourceRef: string | null; title: string; impact: string | null; reporter: string | null;
  ownerId: string | null; ownerName: string | null; status: string; priority: string; progress: number;
  discoveredAt: string; dueDate: string | null; resolvedAt: string | null;
  createdAt: string; updatedAt: string; latestUpdate: string | null; latestUpdateAt: string | null;
  overdue: boolean; updates?: IssueUpdateRecord[];
};

type TemplateItemInput = { id?: string; title: string; startOffsetDays: number; durationDays: number; milestoneLabel: string | null; sortOrder: number };

const projectSelect = `SELECT id, name, status, planned_start AS plannedStart, planned_end AS plannedEnd,
  default_template_id AS defaultTemplateId, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt FROM projects`;

const requirementSelect = `SELECT r.id, r.project_id AS projectId, pr.name AS projectName,
  r.template_id AS templateId, t.name AS templateName, r.title,
  r.owner_id AS ownerId, p.name AS ownerName, r.status, r.planned_start AS plannedStart,
  r.planned_end AS plannedEnd, r.progress, r.risk_level AS riskLevel, r.priority,
  r.created_at AS createdAt, r.updated_at AS updatedAt, r.deleted_at AS deletedAt
  FROM requirements r JOIN projects pr ON pr.id = r.project_id
  LEFT JOIN people p ON p.id = r.owner_id
  LEFT JOIN work_item_templates t ON t.id = r.template_id`;

const workItemSelect = `SELECT w.id, w.requirement_id AS requirementId, w.template_item_id AS templateItemId,
  w.title, w.owner_id AS ownerId, p.name AS ownerName, w.status,
  w.planned_start AS plannedStart, w.planned_end AS plannedEnd,
  w.actual_start AS actualStart, w.actual_end AS actualEnd, w.forecast_end AS forecastEnd,
  w.blocked_at AS blockedAt, w.blocked_reason AS blockedReason, w.milestone_label AS milestoneLabel, w.progress,
  w.sort_order AS sortOrder, w.created_at AS createdAt, w.updated_at AS updatedAt
  FROM work_items w LEFT JOIN people p ON p.id = w.owner_id`;

const issueSelect = `SELECT i.id, i.project_id AS projectId, pr.name AS projectName,
  i.requirement_id AS requirementId, r.title AS requirementTitle, i.source_ref AS sourceRef,
  i.title, i.impact, i.reporter, i.owner_id AS ownerId, p.name AS ownerName,
  i.status, i.priority, i.progress, i.discovered_at AS discoveredAt, i.due_date AS dueDate,
  i.resolved_at AS resolvedAt, i.created_at AS createdAt, i.updated_at AS updatedAt,
  (SELECT u.content FROM issue_updates u WHERE u.issue_id=i.id ORDER BY u.created_at DESC, u.id DESC LIMIT 1) AS latestUpdate,
  (SELECT u.created_at FROM issue_updates u WHERE u.issue_id=i.id ORDER BY u.created_at DESC, u.id DESC LIMIT 1) AS latestUpdateAt
  FROM issues i JOIN projects pr ON pr.id=i.project_id
  LEFT JOIN requirements r ON r.id=i.requirement_id
  LEFT JOIN people p ON p.id=i.owner_id`;

export function listProjects(includeDeleted = false, actor?: Actor): ProjectRecord[] {
  const projects = rows<ProjectRecord>(`${projectSelect} ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'} ORDER BY created_at DESC`);
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
  return row<ProjectRecord>(`${projectSelect} WHERE id=?`, id)!;
}

export function updateProject(id: string, input: JsonObject, actor: Actor): ProjectRecord {
  const current = row<ProjectRecord>(`${projectSelect} WHERE id=? AND deleted_at IS NULL`, id);
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
  return row<ProjectRecord>(`${projectSelect} WHERE id=?`, id)!;
}

export function archiveProject(id: string, actor: Actor) {
  const existing = row<{ name: string }>('SELECT name FROM projects WHERE id=? AND deleted_at IS NULL', id);
  if (!existing) throw new Error('项目不存在');
  sqlite.prepare('UPDATE projects SET deleted_at=?, updated_at=? WHERE id=?').run(nowIso(), nowIso(), id);
  audit(actor, 'archive', 'project', id, `归档项目：${existing.name}`);
  return { ok: true };
}

export function restoreProject(id: string, actor: Actor) {
  if (!row('SELECT id FROM projects WHERE id=? AND deleted_at IS NOT NULL', id)) throw new Error('归档项目不存在');
  sqlite.prepare('UPDATE projects SET deleted_at=NULL, updated_at=? WHERE id=?').run(nowIso(), id);
  audit(actor, 'restore', 'project', id, '恢复项目');
  return row<ProjectRecord>(`${projectSelect} WHERE id=?`, id)!;
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

export function addProjectPerson(projectId: string, personId: string, actor: Actor, requestedRole: unknown = 'member') {
  requireActiveProject(projectId);
  const person = row<{ name: string }>('SELECT name FROM people WHERE id=? AND deleted_at IS NULL AND active=1', personId);
  if (!person) throw new Error('人员不存在或已停用');
  const projectRole = ensureEnum(requestedRole, projectRoles, '项目角色');
  const currentRole = row<{ projectRole: ProjectRole }>('SELECT project_role AS projectRole FROM project_people WHERE project_id=? AND person_id=?', projectId, personId)?.projectRole;
  if ((projectRole === 'manager' || currentRole === 'manager') && actor.globalRole !== 'admin') {
    const error = new Error('项目经理只能由平台管理员任免') as Error & { statusCode: number }; error.statusCode = 403; throw error;
  }
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
  const assignments = {
    requirements: row<{ count: number }>(`SELECT COUNT(*) AS count FROM requirements
      WHERE project_id=? AND owner_id=? AND deleted_at IS NULL AND status NOT IN ('completed','cancelled')`, projectId, personId)?.count || 0,
    workItems: row<{ count: number }>(`SELECT COUNT(DISTINCT w.id) AS count FROM work_items w
      JOIN requirements r ON r.id=w.requirement_id
      LEFT JOIN work_item_collaborators c ON c.work_item_id=w.id AND c.person_id=?
      WHERE r.project_id=? AND r.deleted_at IS NULL AND w.status NOT IN ('completed','cancelled')
        AND (w.owner_id=? OR c.person_id IS NOT NULL)`, personId, projectId, personId)?.count || 0,
    issues: row<{ count: number }>(`SELECT COUNT(*) AS count FROM issues
      WHERE project_id=? AND owner_id=? AND status<>'resolved'`, projectId, personId)?.count || 0,
  };
  if (assignments.requirements || assignments.workItems || assignments.issues) {
    const error = new Error(`该成员仍有关联任务：需求${assignments.requirements}项、工作项${assignments.workItems}项、问题${assignments.issues}项，请先重新分配`) as Error & { statusCode: number; details: typeof assignments };
    error.statusCode = 409; error.details = assignments; throw error;
  }
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
  if (!row('SELECT id FROM work_item_templates WHERE id=? AND deleted_at IS NULL', id)) throw new Error('模板不存在');
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
      status: deriveWorkItemStatus(item),
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
    ...requirement, ...metrics, workItems,
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
    w.title AS workItemTitle, u.percent, u.work_item_percent AS workItemPercent, u.content, u.created_by_account_id AS createdByAccountId,
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

function updateStoredRequirementEnd(requirementId: string) {
  const plannedEnd = row<{ plannedEnd: string | null }>('SELECT MAX(planned_end) AS plannedEnd FROM work_items WHERE requirement_id=?', requirementId)?.plannedEnd || null;
  sqlite.prepare('UPDATE requirements SET planned_end=?, updated_at=? WHERE id=?').run(plannedEnd, nowIso(), requirementId);
}

function syncStoredRequirementProgress(requirementId: string, updatedAt = nowIso()) {
  const requirement = row<RequirementRecord>(`${requirementSelect} WHERE r.id=?`, requirementId);
  if (!requirement) throw new Error('需求不存在');
  const progress = enrichRequirement(requirement).progress;
  sqlite.prepare('UPDATE requirements SET progress=?, updated_at=? WHERE id=?').run(progress, updatedAt, requirementId);
  return progress;
}

function shiftRequirementWorkItems(requirementId: string, businessDays: number, updatedAt: string) {
  if (businessDays === 0) return;
  const items = rows<{ id: string; plannedStart: string | null; plannedEnd: string | null }>(
    'SELECT id, planned_start AS plannedStart, planned_end AS plannedEnd FROM work_items WHERE requirement_id=?', requirementId,
  );
  const update = sqlite.prepare('UPDATE work_items SET planned_start=?, planned_end=?, updated_at=? WHERE id=?');
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

export function updateRequirement(id: string, input: JsonObject, actor: Actor) {
  const current = getRequirement(id);
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
  }
  if (templateChanged) {
    if (!templateId || !row('SELECT id FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL', templateId, current.projectId)) throw new Error('请选择当前项目的有效流程设计');
    if (requestedPlannedEnd !== undefined) {
      nextPlannedStart = plannedStartFromDeadline(requestedPlannedEnd, activeTemplateItems(templateId));
    } else if (requestedPlannedStart !== undefined) {
      nextPlannedStart = requestedPlannedStart;
    }
    if (!nextPlannedStart) throw new Error('重选流程前请设置计划日期');
    if (input.confirmTemplateReset !== true) throw new Error('重选流程会清空已有工作项和进展记录，请确认后重试');
  }
  const now = nowIso();
  sqlite.transaction(() => {
    if (templateChanged && templateId) {
      sqlite.prepare('DELETE FROM progress_updates WHERE requirement_id=?').run(id);
      sqlite.prepare('DELETE FROM work_items WHERE requirement_id=?').run(id);
      sqlite.prepare(`UPDATE requirements SET template_id=?, title=?, status='planning', planned_start=?,
        planned_end=NULL, progress=0, risk_level='low', priority=?, updated_at=? WHERE id=?`)
        .run(templateId, title, nextPlannedStart, priority, now, id);
      applyTemplateInternal(id, templateId, nextPlannedStart!);
      updateStoredRequirementEnd(id);
      return;
    }
    shiftRequirementWorkItems(id, shiftDays, now);
    sqlite.prepare('UPDATE requirements SET title=?, priority=?, planned_start=?, updated_at=? WHERE id=?')
      .run(title, priority, nextPlannedStart, now, id);
    if (requestedPlannedStart !== undefined || requestedPlannedEnd !== undefined) updateStoredRequirementEnd(id);
  })();
  audit(actor, templateChanged ? 'apply_template' : 'update', 'requirement', id,
    templateChanged ? `重选流程并重建计划：${title}`
      : requestedPlannedStart !== undefined || requestedPlannedEnd !== undefined ? `调整需求排期：${title}` : `更新需求：${title}`);
  return getRequirement(id);
}

export function archiveRequirement(id: string, actor: Actor) {
  const current = getRequirement(id);
  sqlite.prepare('UPDATE requirements SET deleted_at=?, updated_at=? WHERE id=?').run(nowIso(), nowIso(), id);
  audit(actor, 'archive', 'requirement', id, `归档需求：${current.title}`);
  return { ok: true };
}

export function restoreRequirement(id: string, actor: Actor) {
  if (!row('SELECT id FROM requirements WHERE id=? AND deleted_at IS NOT NULL', id)) throw new Error('归档需求不存在');
  sqlite.prepare('UPDATE requirements SET deleted_at=NULL, updated_at=? WHERE id=?').run(nowIso(), id);
  audit(actor, 'restore', 'requirement', id, '恢复需求');
  return getRequirement(id);
}

export function applyTemplate(requirementId: string, templateId: string, actor: Actor) {
  const requirement = getRequirement(requirementId);
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
  const preview = previewRequirementPlan(requirementId, input);
  const selected = new Set(Array.isArray(input.templateItemIds) ? input.templateItemIds.map(String) : preview.entries.filter((item) => item.willChange).map((item) => item.templateItemId));
  const now = nowIso();
  const tx = sqlite.transaction(() => {
    let nextOrder = (row<{ maxOrder: number | null }>('SELECT MAX(sort_order) AS maxOrder FROM work_items WHERE requirement_id=?', requirementId)?.maxOrder ?? -1) + 1;
    for (const item of preview.entries) {
      if (!selected.has(item.templateItemId) || !item.willChange) continue;
      if (item.workItemId) {
        sqlite.prepare(`UPDATE work_items SET planned_start=COALESCE(planned_start, ?), planned_end=COALESCE(planned_end, ?), updated_at=? WHERE id=?`)
          .run(item.proposedStart, item.proposedEnd, now, item.workItemId);
      } else {
        sqlite.prepare(`INSERT INTO work_items
          (id, requirement_id, template_item_id, title, milestone_label, status, planned_start, planned_end, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'not_started', ?, ?, ?, ?, ?)`).run(
          randomUUID(), requirementId, item.templateItemId, item.title, item.milestoneLabel, item.proposedStart, item.proposedEnd, nextOrder++, now, now,
        );
      }
    }
    sqlite.prepare('UPDATE requirements SET planned_start=?, updated_at=? WHERE id=?').run(preview.baseStart, now, requirementId);
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
    WHERE pp.project_id=? AND pp.person_id IN (${placeholders}) AND p.deleted_at IS NULL AND p.active=1`, requirement.projectId, ...assigneeIds)?.count || 0;
  if (count !== assigneeIds.length) throw new Error('负责人必须是当前项目成员');
}

function syncWorkItemCollaborators(workItemId: string, collaboratorIds: string[]) {
  sqlite.prepare('DELETE FROM work_item_collaborators WHERE work_item_id=?').run(workItemId);
  const insert = sqlite.prepare('INSERT INTO work_item_collaborators (work_item_id, person_id) VALUES (?, ?)');
  collaboratorIds.forEach((personId) => insert.run(workItemId, personId));
}

export function createWorkItem(requirementId: string, input: JsonObject, actor: Actor) {
  getRequirement(requirementId);
  const id = randomUUID(); const now = nowIso(); const title = requireText(input.title, '工作项标题');
  const max = row<{ value: number | null }>('SELECT MAX(sort_order) AS value FROM work_items WHERE requirement_id=?', requirementId)?.value ?? -1;
  let actualStart = nullableText(input.actualStart); let actualEnd = nullableText(input.actualEnd);
  if (actualEnd && !actualStart) actualStart = actualEnd;
  const ownerId = nullableText(input.ownerId);
  const collaboratorIds = collaboratorIdsFromInput(input, ownerId) || [];
  assertProjectAssignees(requirementId, [ownerId, ...collaboratorIds]);
  const milestone = milestoneLabel(input.milestoneLabel);
  sqlite.transaction(() => {
    sqlite.prepare(`INSERT INTO work_items
      (id, requirement_id, title, owner_id, milestone_label, status, planned_start, planned_end, actual_start, actual_end, progress, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'not_started', ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, requirementId, title, ownerId, milestone, nullableText(input.plannedStart), nullableText(input.plannedEnd),
      actualStart, actualEnd, actualEnd ? 100 : 0, max + 1, now, now,
    );
    syncWorkItemCollaborators(id, collaboratorIds);
  })();
  updateStoredRequirementEnd(requirementId);
  syncStoredRequirementProgress(requirementId);
  audit(actor, 'create', 'work_item', id, `新增工作项：${title}${collaboratorIds.length ? `（${collaboratorIds.length + (ownerId ? 1 : 0)}人协作）` : ''}`);
  return getRequirement(requirementId).workItems!.find((item) => item.id === id);
}

export function updateWorkItem(id: string, input: JsonObject, actor: Actor) {
  const current = row<WorkItemRecord>(`${workItemSelect} WHERE w.id=?`, id);
  if (!current) throw new Error('工作项不存在');
  const title = input.title === undefined ? current.title : requireText(input.title, '工作项标题');
  const milestone = input.milestoneLabel === undefined ? current.milestoneLabel : milestoneLabel(input.milestoneLabel);
  const ownerId = input.ownerId === undefined ? current.ownerId : nullableText(input.ownerId);
  const collaboratorIds = collaboratorIdsFromInput(input, ownerId);
  const currentCollaborators = collaboratorIds === undefined
    ? rows<{ personId: string }>('SELECT person_id AS personId FROM work_item_collaborators WHERE work_item_id=?', id).map((item) => item.personId)
    : collaboratorIds;
  assertProjectAssignees(current.requirementId, [ownerId, ...currentCollaborators]);
  let actualStart = input.actualStart === undefined ? current.actualStart : nullableText(input.actualStart);
  const actualEnd = input.actualEnd === undefined ? current.actualEnd : nullableText(input.actualEnd);
  if (actualEnd && !actualStart) actualStart = actualEnd;
  const progress = actualEnd ? 100 : current.actualEnd && !actualEnd ? Math.min(99, current.progress) : current.progress;
  const status = current.status === 'cancelled'
    ? 'cancelled'
    : current.blockedAt
      ? 'blocked'
      : actualEnd
        ? 'completed'
        : actualStart
          ? 'in_progress'
          : 'not_started';
  sqlite.transaction(() => {
    sqlite.prepare(`UPDATE work_items SET title=?, owner_id=?, milestone_label=?, planned_start=?, planned_end=?, actual_start=?, actual_end=?, progress=?, status=?, sort_order=?, updated_at=? WHERE id=?`).run(
      title, ownerId, milestone,
      input.plannedStart === undefined ? current.plannedStart : nullableText(input.plannedStart),
      input.plannedEnd === undefined ? current.plannedEnd : nullableText(input.plannedEnd), actualStart, actualEnd,
      progress, status, input.sortOrder === undefined ? current.sortOrder : Number(input.sortOrder), nowIso(), id,
    );
    if (collaboratorIds !== undefined) syncWorkItemCollaborators(id, collaboratorIds);
    else if (ownerId) sqlite.prepare('DELETE FROM work_item_collaborators WHERE work_item_id=? AND person_id=?').run(id, ownerId);
  })();
  updateStoredRequirementEnd(current.requirementId);
  syncStoredRequirementProgress(current.requirementId);
  audit(actor, 'update', 'work_item', id, `更新工作项：${title}`);
  return getRequirement(current.requirementId).workItems!.find((item) => item.id === id);
}

function workItemEvent(id: string, action: 'start' | 'complete' | 'block' | 'unblock' | 'cancel', input: JsonObject, actor: Actor) {
  const current = row<WorkItemRecord>(`${workItemSelect} WHERE w.id=?`, id);
  if (!current) throw new Error('工作项不存在');
  const today = todayIso(); const now = nowIso();
  if (action === 'start') sqlite.prepare(`UPDATE work_items SET actual_start=COALESCE(actual_start, ?), status='in_progress', blocked_at=NULL, blocked_reason=NULL, updated_at=? WHERE id=?`).run(today, now, id);
  if (action === 'complete') sqlite.prepare(`UPDATE work_items SET actual_start=COALESCE(actual_start, ?), actual_end=?, progress=100, status='completed', blocked_at=NULL, blocked_reason=NULL, updated_at=? WHERE id=?`).run(today, today, now, id);
  if (action === 'block') sqlite.prepare(`UPDATE work_items SET blocked_at=?, blocked_reason=?, status='blocked', updated_at=? WHERE id=?`).run(now, requireText(input.reason, '阻塞原因'), now, id);
  if (action === 'unblock') sqlite.prepare(`UPDATE work_items SET blocked_at=NULL, blocked_reason=NULL, status=CASE WHEN actual_start IS NULL THEN 'not_started' ELSE 'in_progress' END, updated_at=? WHERE id=?`).run(now, id);
  if (action === 'cancel') sqlite.prepare(`UPDATE work_items SET status='cancelled', blocked_at=NULL, blocked_reason=NULL, updated_at=? WHERE id=?`).run(now, id);
  syncStoredRequirementProgress(current.requirementId, now);
  audit(actor, action, 'work_item', id, `${action === 'start' ? '开始' : action === 'complete' ? '完成' : action === 'block' ? '阻塞' : action === 'unblock' ? '解除阻塞' : '取消'}工作项：${current.title}`);
  return getRequirement(current.requirementId).workItems!.find((item) => item.id === id);
}

export const startWorkItem = (id: string, actor: Actor) => workItemEvent(id, 'start', {}, actor);
export const completeWorkItem = (id: string, actor: Actor) => workItemEvent(id, 'complete', {}, actor);
export const blockWorkItem = (id: string, input: JsonObject, actor: Actor) => workItemEvent(id, 'block', input, actor);
export const unblockWorkItem = (id: string, actor: Actor) => workItemEvent(id, 'unblock', {}, actor);
export const cancelWorkItem = (id: string, actor: Actor) => workItemEvent(id, 'cancel', {}, actor);

export function deleteWorkItem(id: string, actor: Actor) {
  const current = row<WorkItemRecord>(`${workItemSelect} WHERE w.id=?`, id);
  if (!current) throw new Error('工作项不存在');
  sqlite.prepare('DELETE FROM work_items WHERE id=?').run(id); updateStoredRequirementEnd(current.requirementId); syncStoredRequirementProgress(current.requirementId);
  audit(actor, 'delete', 'work_item', id, `删除工作项：${current.title}`);
  return { ok: true };
}

export function reorderWorkItems(requirementId: string, ids: string[], actor: Actor) {
  const tx = sqlite.transaction(() => ids.forEach((id, index) => sqlite.prepare('UPDATE work_items SET sort_order=?, updated_at=? WHERE id=? AND requirement_id=?').run(index, nowIso(), id, requirementId)));
  tx(); audit(actor, 'reorder', 'work_item', requirementId, '调整工作项顺序');
  return getRequirement(requirementId).workItems;
}

export function addProgress(requirementId: string, input: JsonObject, actor: Actor) {
  const requirement = getRequirement(requirementId); const content = requireText(input.content, '具体进展');
  const id = randomUUID(); const now = nowIso(); const workItemId = nullableText(input.workItemId);
  if (workItemId && !requirement.workItems!.some((item) => item.id === workItemId)) throw new Error('关联工作项不存在');
  if (!workItemId && input.workItemPercent !== undefined && nullableText(input.workItemPercent) !== null) throw new Error('填写完成度前请选择工作项');
  const workItemPercent = workItemId ? requireProgress(input.workItemPercent, '工作项完成度') : null;
  const workItem = workItemId ? requirement.workItems!.find((item) => item.id === workItemId)! : null;
  if (workItem?.status === 'cancelled') throw new Error('已取消的工作项不能提交进度');
  const tx = sqlite.transaction(() => {
    if (workItemId && workItemPercent !== null) {
      if (workItemPercent === 100) {
        sqlite.prepare(`UPDATE work_items SET progress=100, actual_start=COALESCE(actual_start, ?), actual_end=?,
          status='completed', blocked_at=NULL, blocked_reason=NULL, updated_at=? WHERE id=?`).run(todayIso(), todayIso(), now, workItemId);
      } else {
        sqlite.prepare(`UPDATE work_items SET progress=?, actual_start=CASE WHEN ?>0 THEN COALESCE(actual_start, ?) ELSE actual_start END,
          actual_end=NULL, status=CASE WHEN blocked_at IS NOT NULL THEN 'blocked' WHEN ?>0 THEN 'in_progress' ELSE 'not_started' END,
          updated_at=? WHERE id=?`).run(workItemPercent, workItemPercent, todayIso(), workItemPercent, now, workItemId);
      }
    }
    const percent = syncStoredRequirementProgress(requirementId, now);
    sqlite.prepare(`INSERT INTO progress_updates (id, requirement_id, work_item_id, percent, work_item_percent, content, created_by_account_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, requirementId, workItemId, percent, workItemPercent, content, actor.accountId || null, now, now);
  });
  tx(); const result = getRequirement(requirementId);
  audit(actor, 'create', 'progress', id, `追加进展：${result.progress}% ${content.slice(0, 50)}`);
  return result;
}

export function updateProgress(id: string, input: JsonObject, actor: Actor) {
  const current = row<any>('SELECT * FROM progress_updates WHERE id=?', id);
  if (!current) throw new Error('进展记录不存在');
  const content = input.content === undefined ? current.content : requireText(input.content, '具体进展');
  const workItemId = input.workItemId === undefined ? current.work_item_id : nullableText(input.workItemId);
  if (workItemId && !row('SELECT id FROM work_items WHERE id=? AND requirement_id=?', workItemId, current.requirement_id)) throw new Error('关联工作项不存在');
  const percent = getRequirement(current.requirement_id).progress;
  const workItemPercent = workItemId === current.work_item_id
    ? current.work_item_percent
    : workItemId
      ? row<{ progress: number }>('SELECT progress FROM work_items WHERE id=?', workItemId)?.progress ?? null
      : null;
  sqlite.prepare('UPDATE progress_updates SET percent=?, work_item_percent=?, content=?, work_item_id=?, updated_at=? WHERE id=?')
    .run(percent, workItemPercent, content, workItemId, nowIso(), id);
  audit(actor, 'update', 'progress', id, `更新进展记录：${percent}%`);
  return getRequirement(current.requirement_id);
}

export function deleteProgress(id: string, actor: Actor) {
  const current = row<any>('SELECT * FROM progress_updates WHERE id=?', id);
  if (!current) throw new Error('进展记录不存在');
  sqlite.prepare('DELETE FROM progress_updates WHERE id=?').run(id);
  audit(actor, 'delete', 'progress', id, `删除进展记录：${current.percent}%`);
  return { ok: true };
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
    WHERE p.id=? AND pp.project_id=? AND p.deleted_at IS NULL AND p.active=1`, ownerId, projectId)) {
    throw new Error('负责人不属于当前项目');
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
  const ownerId = issueOwner(projectId, input.ownerId);
  let status = input.status === undefined ? 'open' : ensureEnum(input.status, issueStatuses, '问题状态');
  const priority = input.priority === undefined ? 'P2' : ensureEnum(input.priority, priorities, '问题优先级');
  const progress = status === 'resolved' ? 100 : input.progress === undefined ? 0 : requireProgress(input.progress, '问题完成度');
  if (status !== 'resolved' && progress === 100) throw new Error('100%问题必须由项目经理确认关闭');
  if (status === 'open' && progress > 0) status = 'in_progress';
  if (status === 'in_progress' && !ownerId) throw new Error('进入处理中前请指定负责人');
  const discoveredAt = input.discoveredAt === undefined ? todayIso() : requireDate(input.discoveredAt, '发现日期');
  const dueDate = status === 'deferred' ? null : nullableDate(input.dueDate, '目标日期');
  const resolvedAt = status === 'resolved' ? todayIso() : null;
  const now = nowIso();
  sqlite.prepare(`INSERT INTO issues
    (id, project_id, requirement_id, source_ref, title, impact, reporter, owner_id, status, priority,
      progress, discovered_at, due_date, resolved_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, projectId, requirementId, nullableText(input.sourceRef), title, nullableText(input.impact),
    nullableText(input.reporter), ownerId, status, priority, progress, discoveredAt, dueDate, resolvedAt, now, now,
  );
  audit(actor, 'create', 'issue', id, `创建问题：${title}`);
  return getIssue(id);
}

export function updateIssue(id: string, input: JsonObject, actor: Actor) {
  const current = getIssue(id); const projectId = current.projectId;
  const title = input.title === undefined ? current.title : requireText(input.title, '问题标题');
  const requirementId = input.requirementId === undefined ? current.requirementId : issueRequirement(projectId, input.requirementId);
  const sourceRef = input.sourceRef === undefined ? current.sourceRef : nullableText(input.sourceRef);
  const ownerId = input.ownerId === undefined ? current.ownerId : issueOwner(projectId, input.ownerId);
  let status = input.status === undefined ? current.status : ensureEnum(input.status, issueStatuses, '问题状态');
  const priority = input.priority === undefined ? current.priority : ensureEnum(input.priority, priorities, '问题优先级');
  const updateContent = nullableText(input.updateContent);
  if (current.status !== 'resolved' && status === 'resolved' && !updateContent) throw new Error('标记已解决时请填写闭环说明');
  let progress = status === 'resolved'
    ? 100
    : input.progress === undefined
      ? current.status === 'resolved' ? 99 : current.progress
      : requireProgress(input.progress, '问题完成度');
  if (status !== 'resolved' && progress === 100) throw new Error('未关闭问题的完成度不能为100%');
  if (status === 'open' && progress > 0) status = 'in_progress';
  if (status === 'in_progress' && !ownerId) throw new Error('进入处理中前请指定负责人');
  const now = nowIso(); const updateId = updateContent ? randomUUID() : null;
  const resolvedAt = status === 'resolved' ? current.resolvedAt || todayIso() : null;
  const dueDate = status === 'deferred' ? null : input.dueDate === undefined ? current.dueDate : nullableDate(input.dueDate, '目标日期');
  sqlite.transaction(() => {
    sqlite.prepare(`UPDATE issues SET requirement_id=?, source_ref=?, title=?, impact=?, reporter=?, owner_id=?,
      status=?, priority=?, progress=?, discovered_at=?, due_date=?, resolved_at=?, updated_at=? WHERE id=?`).run(
      requirementId, sourceRef, title,
      input.impact === undefined ? current.impact : nullableText(input.impact),
      input.reporter === undefined ? current.reporter : nullableText(input.reporter),
      ownerId, status, priority, progress,
      input.discoveredAt === undefined ? current.discoveredAt : requireDate(input.discoveredAt, '发现日期'),
      dueDate,
      resolvedAt, now, id,
    );
    if (updateId && updateContent) sqlite.prepare(`INSERT INTO issue_updates
      (id, issue_id, progress, content, created_by_account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(updateId, id, progress, updateContent, actor.accountId || null, now, now);
  })();
  audit(actor, 'update', 'issue', id, `更新问题：${title}`);
  if (updateId && updateContent) audit(actor, 'create', 'issue_update', updateId, `追加问题进展：${updateContent.slice(0, 50)}`);
  return getIssue(id);
}

export function addIssueUpdate(issueId: string, input: JsonObject, actor: Actor, permissions: { canSetProgress: boolean; canResolve: boolean }) {
  const issue = getIssue(issueId); const content = requireText(input.content, '进展内容');
  if (issue.status === 'resolved') throw new Error('已解决问题不能再追加进展，请先由项目经理重新打开');
  const hasProgress = input.progress !== undefined && nullableText(input.progress) !== null;
  if (hasProgress && !permissions.canSetProgress) throw new Error('只有问题负责人或项目经理可以更新问题完成度');
  const progress = hasProgress ? requireProgress(input.progress, '问题完成度') : null;
  if (progress === 100 && !permissions.canResolve) throw new Error('问题关闭必须由项目经理确认');
  let status = issue.status;
  if (progress === 100) status = 'resolved';
  else if (progress !== null && progress > 0 && status === 'open') status = 'in_progress';
  const id = randomUUID(); const now = nowIso();
  sqlite.transaction(() => {
    sqlite.prepare(`INSERT INTO issue_updates (id, issue_id, progress, content, created_by_account_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, issueId, progress, content, actor.accountId || null, now, now);
    sqlite.prepare(`UPDATE issues SET progress=COALESCE(?, progress), status=?, resolved_at=CASE WHEN ?='resolved' THEN ? ELSE resolved_at END,
      updated_at=? WHERE id=?`).run(progress, status, status, todayIso(), now, issueId);
  })();
  audit(actor, 'create', 'issue_update', id, `追加问题进展：${issue.title} · ${content.slice(0, 50)}`);
  return getIssue(issueId);
}

function latestIssueProgressUpdate(issueId: string) {
  return row<{ id: string; progress: number }>(`SELECT id, progress FROM issue_updates
    WHERE issue_id=? AND progress IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 1`, issueId);
}

function syncIssueProgressFromUpdates(issueId: string, now = nowIso()) {
  const issue = row<{ status: string; ownerId: string | null }>(
    'SELECT status, owner_id AS ownerId FROM issues WHERE id=?', issueId,
  );
  if (!issue) throw new Error('问题不存在');
  const latest = latestIssueProgressUpdate(issueId);
  const progress = latest?.progress ?? 0;
  const status = progress === 100
    ? 'resolved'
    : issue.status === 'resolved'
      ? progress > 0 && issue.ownerId ? 'in_progress' : 'open'
      : issue.status === 'open' && progress > 0 && issue.ownerId
        ? 'in_progress'
        : issue.status;
  sqlite.prepare(`UPDATE issues SET progress=?, status=?, resolved_at=CASE WHEN ?='resolved' THEN COALESCE(resolved_at, ?) ELSE NULL END,
    updated_at=? WHERE id=?`).run(progress, status, status, todayIso(), now, issueId);
}

export function updateIssueUpdate(issueId: string, updateId: string, input: JsonObject, actor: Actor) {
  const current = row<{ id: string; issueId: string; issueTitle: string; progress: number | null; content: string }>(`SELECT
    u.id, u.issue_id AS issueId, i.title AS issueTitle, u.progress, u.content FROM issue_updates u
    JOIN issues i ON i.id=u.issue_id WHERE u.id=? AND u.issue_id=?`, updateId, issueId);
  if (!current) throw new Error('问题进展不存在');
  const content = input.content === undefined ? current.content : requireText(input.content, '进展内容');
  const nextProgress = input.progress === undefined
    ? current.progress
    : input.progress === null || String(input.progress).trim() === ''
      ? null
      : requireProgress(input.progress, '问题完成度');
  const latestBefore = latestIssueProgressUpdate(issueId);
  const now = nowIso();
  sqlite.prepare('UPDATE issue_updates SET content=?, progress=?, updated_at=? WHERE id=? AND issue_id=?')
    .run(content, nextProgress, now, updateId, issueId);
  const latestAfter = latestIssueProgressUpdate(issueId);
  if (input.progress !== undefined && (latestBefore?.id === updateId || latestAfter?.id === updateId)) syncIssueProgressFromUpdates(issueId, now);
  else sqlite.prepare('UPDATE issues SET updated_at=? WHERE id=?').run(now, issueId);
  audit(actor, 'update', 'issue_update', updateId, `编辑问题进展：${current.issueTitle} · ${content.slice(0, 50)}`);
  return getIssue(issueId);
}

export function deleteIssueUpdate(issueId: string, updateId: string, actor: Actor) {
  const current = row<{ id: string; issueTitle: string; progress: number | null; content: string }>(`SELECT
    u.id, i.title AS issueTitle, u.progress, u.content FROM issue_updates u
    JOIN issues i ON i.id=u.issue_id WHERE u.id=? AND u.issue_id=?`, updateId, issueId);
  if (!current) throw new Error('问题进展不存在');
  const latestBefore = latestIssueProgressUpdate(issueId);
  const now = nowIso();
  sqlite.prepare('DELETE FROM issue_updates WHERE id=? AND issue_id=?').run(updateId, issueId);
  if (latestBefore?.id === updateId) syncIssueProgressFromUpdates(issueId, now);
  else sqlite.prepare('UPDATE issues SET updated_at=? WHERE id=?').run(now, issueId);
  audit(actor, 'delete', 'issue_update', updateId, `删除问题进展：${current.issueTitle} · ${current.content.slice(0, 50)}`);
  return getIssue(issueId);
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
    projects: projectId ? [] : rows(`SELECT id, name AS title, deleted_at AS deletedAt FROM projects WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`),
    requirements: rows(`SELECT id, title, deleted_at AS deletedAt FROM requirements WHERE deleted_at IS NOT NULL ${projectId ? 'AND project_id=?' : ''} ORDER BY deleted_at DESC`, ...(projectId ? [projectId] : [])),
    people: projectId ? [] : rows(`SELECT id, name AS title, job_title AS jobTitle, deleted_at AS deletedAt FROM people WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`),
    templates: rows(`SELECT id, name AS title, deleted_at AS deletedAt FROM work_item_templates WHERE deleted_at IS NOT NULL ${projectId ? 'AND project_id=?' : ''} ORDER BY deleted_at DESC`, ...(projectId ? [projectId] : [])),
  };
}

export type ArchiveEntity = 'projects' | 'requirements' | 'people' | 'templates';

export function permanentlyDeleteArchive(entity: ArchiveEntity, id: string, actor: Actor) {
  const tx = sqlite.transaction(() => {
    if (entity === 'projects') {
      const project = row<{ name: string }>('SELECT name FROM projects WHERE id=? AND deleted_at IS NOT NULL', id);
      if (!project) throw new Error('归档项目不存在');
      const requirementCount = row<{ count: number }>('SELECT COUNT(*) AS count FROM requirements WHERE project_id=?', id)?.count || 0;
      sqlite.prepare('DELETE FROM requirements WHERE project_id=?').run(id);
      sqlite.prepare('DELETE FROM projects WHERE id=?').run(id);
      audit(actor, 'permanent_delete', 'project', id, `永久删除归档项目：${project.name}（含${requirementCount}条需求）`, null);
      return { ok: true };
    }
    if (entity === 'requirements') {
      const requirement = row<{ title: string }>('SELECT title FROM requirements WHERE id=? AND deleted_at IS NOT NULL', id);
      if (!requirement) throw new Error('归档需求不存在');
      sqlite.prepare('DELETE FROM requirements WHERE id=?').run(id);
      audit(actor, 'permanent_delete', 'requirement', id, `永久删除归档需求：${requirement.title}`);
      return { ok: true };
    }
    if (entity === 'people') {
      const person = row<{ name: string }>('SELECT name FROM people WHERE id=? AND deleted_at IS NOT NULL', id);
      if (!person) throw new Error('归档人员不存在');
      sqlite.prepare('UPDATE requirements SET owner_id=NULL WHERE owner_id=?').run(id);
      sqlite.prepare('UPDATE work_items SET owner_id=NULL WHERE owner_id=?').run(id);
      sqlite.prepare('DELETE FROM accounts WHERE person_id=? AND is_builtin=0').run(id);
      sqlite.prepare('DELETE FROM people WHERE id=?').run(id);
      audit(actor, 'permanent_delete', 'person', id, `永久删除归档人员：${person.name}`);
      return { ok: true };
    }
    if (entity === 'templates') {
      const template = row<{ name: string }>('SELECT name FROM work_item_templates WHERE id=? AND deleted_at IS NOT NULL', id);
      if (!template) throw new Error('归档模板不存在');
      sqlite.prepare('UPDATE projects SET default_template_id=NULL WHERE default_template_id=?').run(id);
      sqlite.prepare(`UPDATE work_items SET template_item_id=NULL
        WHERE template_item_id IN (SELECT id FROM template_items WHERE template_id=?)`).run(id);
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
