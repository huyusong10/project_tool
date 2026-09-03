import { randomUUID } from 'node:crypto';
import { sqlite } from './database';
import type { Actor } from './auth';
import { createAccountForPerson } from './accounts';
import { config } from './config';
import {
  archiveUnusedSamplePeople,
  deleteOrReleaseSamplePeople,
  isSampleProjectId,
  restoreSamplePeople,
} from './sample-project';
import {
  addBusinessDays,
  businessDayDelta,
  businessDaysInclusive,
  deriveRequirementMetrics,
  issueStatuses,
  maxTemplateDurationDays,
  maxTemplateItems,
  maxTemplateOffsetDays,
  plannedDatesFromOffset,
  plannedStartFromDeadline,
  priorities,
  projectRoles,
  requirementStatuses,
  riskLevels,
  isTerminalWorkItemStatus,
  todayIso,
  workItemStatuses,
  type ProjectRole,
} from '../shared/domain';
import { canonicalizeLabel, normalizeSearchText } from '../shared/search';
import { fail, notFound } from './errors';
import {
  getRequirement,
  getWorkItems,
  requirementSelect,
  workItemSelect,
  type RequirementRecord,
  type WorkItemRecord,
} from './services/requirements';
import { recordAudit as audit } from './services/audit';
import {
  assertExpectedVersion,
  assertTransition,
  ensureEnum,
  milestoneLabel,
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
  templateDescription,
  type JsonObject,
} from './services/support';

export { getRequirement, listRequirements } from './services/requirements';
export type { RequirementRecord, WorkItemRecord } from './services/requirements';
export { listAudit, recordAudit, searchAudit } from './services/audit';
export {
  addIssueUpdate,
  correctIssue,
  createIssue,
  deferIssue,
  deleteIssueUpdate,
  getIssue,
  listIssues,
  reopenIssue,
  resolveIssue,
  resumeIssue,
  updateIssue,
  updateIssueUpdate,
} from './services/issues';
export type { IssueRecord, IssueUpdateRecord } from './services/issues';
export { authenticateApiToken, issueToken, listTokens, revokeToken } from './services/tokens';
export { getDashboard, getPeopleConcurrency } from './services/reporting';
export { listActionItems } from './services/actions';

export type ProjectRecord = {
  id: string; name: string; status: string; plannedStart: string | null; plannedEnd: string | null;
  defaultTemplateId: string | null; createdAt: string; updatedAt: string; deletedAt?: string | null;
  isSample: boolean; projectRole?: ProjectRole; canManage?: boolean;
};

type TemplateItemInput = { id?: string; title: string; startOffsetDays: number; durationDays: number; milestoneLabel: string | null; sortOrder: number };

const projectSelect = `SELECT id, name, status, planned_start AS plannedStart, planned_end AS plannedEnd,
  default_template_id AS defaultTemplateId, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt FROM projects`;

function withProjectMeta<T extends { id: string }>(project: T): T & { isSample: boolean } {
  return { ...project, isSample: isSampleProjectId(project.id) };
}

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

function requirementOwner(projectId: string, value: unknown) {
  const ownerId = nullableText(value);
  if (ownerId && !row(`SELECT p.id FROM people p JOIN project_people pp ON pp.person_id=p.id
    WHERE p.id=? AND pp.project_id=? AND pp.project_role IN ('member','manager')
      AND p.deleted_at IS NULL AND p.active=1`, ownerId, projectId)) {
    fail('需求负责人必须是当前项目中已启用的成员或项目经理');
  }
  return ownerId;
}

export function createProject(input: JsonObject, actor: Actor): ProjectRecord {
  const id = randomUUID(); const now = nowIso(); const name = requireLabel(input.name, '项目名称');
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
  if (!current) notFound('项目不存在');
  const name = input.name === undefined ? current.name : requireLabel(input.name, '项目名称');
  const defaultTemplateId = input.defaultTemplateId === undefined ? current.defaultTemplateId : nullableText(input.defaultTemplateId);
  if (defaultTemplateId && !row('SELECT id FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL', defaultTemplateId, id)) {
    fail('默认流程必须属于当前项目且未归档');
  }
  sqlite.prepare(`UPDATE projects SET name=?, status=?, planned_start=?, planned_end=?, default_template_id=?, updated_at=? WHERE id=?`).run(
    name, input.status === undefined ? current.status : String(input.status),
    input.plannedStart === undefined ? current.plannedStart : nullableText(input.plannedStart),
    input.plannedEnd === undefined ? current.plannedEnd : nullableText(input.plannedEnd), defaultTemplateId, nowIso(), id,
  );
  audit(actor, 'update', 'project', id, `更新项目：${name}`);
  return withProjectMeta(row<Omit<ProjectRecord, 'isSample'>>(`${projectSelect} WHERE id=?`, id)!);
}

export function archiveProject(id: string, actor: Actor, options: { force?: boolean } = {}) {
  const existing = row<{ name: string }>('SELECT name FROM projects WHERE id=? AND deleted_at IS NULL', id);
  if (!existing) notFound('项目不存在');
  const dependencies = {
    requirements: row<{ count: number }>(`SELECT COUNT(*) AS count FROM requirements WHERE project_id=? AND deleted_at IS NULL AND status NOT IN ('completed','cancelled')`, id)?.count || 0,
    issues: row<{ count: number }>(`SELECT COUNT(*) AS count FROM issues WHERE project_id=? AND status<>'resolved'`, id)?.count || 0,
  };
  const hasActiveContent = Boolean(dependencies.requirements || dependencies.issues);
  if (hasActiveContent && !options.force) fail(`项目仍有活跃需求${dependencies.requirements}项、未解决问题${dependencies.issues}项`, 'DEPENDENCY_CONFLICT', 409, dependencies);
  const now = nowIso();
  sqlite.transaction(() => {
    sqlite.prepare('UPDATE projects SET deleted_at=?, updated_at=? WHERE id=?').run(now, now, id);
    if (isSampleProjectId(id)) archiveUnusedSamplePeople(sqlite, now, actor.accountId);
  })();
  audit(actor, 'archive', 'project', id, hasActiveContent
    ? `强制归档项目：${existing.name}（活跃需求${dependencies.requirements}项、未解决问题${dependencies.issues}项）`
    : `归档项目：${existing.name}`);
  return { ok: true, forced: hasActiveContent, dependencies };
}

export function restoreProject(id: string, actor: Actor) {
  if (!row('SELECT id FROM projects WHERE id=? AND deleted_at IS NOT NULL', id)) notFound('归档项目不存在');
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
    (SELECT a.username FROM accounts a WHERE a.person_id=p.id AND a.deleted_at IS NULL) AS username,
    (SELECT a.status FROM accounts a WHERE a.person_id=p.id AND a.deleted_at IS NULL) AS accountStatus
    FROM people p ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.active DESC, p.name`, ...(projectId ? [projectId, ...params] : params));
}

function requireActiveProject(projectId: string) {
  if (!row('SELECT id FROM projects WHERE id=? AND deleted_at IS NULL', projectId)) notFound('项目不存在');
}

export function listPeopleCandidates(projectId: string, q = '') {
  requireActiveProject(projectId);
  const query = normalizeSearchText(q);
  const candidates = rows<{
    id: string; name: string; jobTitle: string | null; username: string | null; active: number; deletedAt: string | null;
    existingProjectRole: ProjectRole | null; searchRank: number;
  }>(`SELECT p.id, p.name, p.job_title AS jobTitle, a.username,
      p.active, p.deleted_at AS deletedAt, pp.project_role AS existingProjectRole,
      MAX(search_score(p.name, ?) + 100,
        search_score(COALESCE(a.username, ''), ?) + 50,
        search_score(COALESCE(p.job_title, ''), ?)) AS searchRank
    FROM people p
    LEFT JOIN accounts a ON a.person_id=p.id AND a.deleted_at IS NULL
    LEFT JOIN project_people pp ON pp.person_id=p.id AND pp.project_id=?
    WHERE ((?='' AND p.deleted_at IS NULL AND p.active=1 AND pp.person_id IS NULL)
      OR (?<>'' AND (search_score(p.name, ?)>0
        OR search_score(COALESCE(a.username, ''), ?)>0
        OR search_score(COALESCE(p.job_title, ''), ?)>0)))
    ORDER BY CASE WHEN p.deleted_at IS NULL AND p.active=1 AND pp.person_id IS NULL THEN 0 ELSE 1 END,
      searchRank DESC, p.name
    LIMIT 50`, query, query, query, projectId, query, query, query, query, query);
  return candidates.map(({ searchRank: _searchRank, ...person }) => ({
    ...person,
    canAdd: !person.deletedAt && Boolean(person.active) && !person.existingProjectRole,
    unavailableReason: person.deletedAt ? 'archived' : !person.active ? 'inactive' : person.existingProjectRole ? 'already_member' : null,
  }));
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

function managerProjects(personId: string) {
  return rows<{ id: string; name: string }>(`SELECT pr.id, pr.name FROM project_people pp
    JOIN projects pr ON pr.id=pp.project_id
    WHERE pp.person_id=? AND pp.project_role='manager' AND pr.deleted_at IS NULL
    ORDER BY pr.name`, personId);
}

function assertNotActiveProjectManager(personId: string) {
  const projects = managerProjects(personId);
  if (projects.length) {
    fail(`该人员仍担任${projects.length}个项目的项目经理，请先在对应项目完成移交`, 'DEPENDENCY_CONFLICT', 409, {
      projects: projects.map(({ id, name }) => ({ id, name })),
    });
  }
}

function assertManagerReplacement(projectId: string, personId: string, nextRole?: ProjectRole) {
  const current = row<{ projectRole: ProjectRole }>('SELECT project_role AS projectRole FROM project_people WHERE project_id=? AND person_id=?', projectId, personId);
  if (current?.projectRole !== 'manager' || nextRole === 'manager') return;
  const managers = row<{ count: number }>(`SELECT COUNT(*) AS count FROM project_people
    WHERE project_id=? AND project_role='manager'`, projectId)?.count || 0;
  if (managers <= 1) fail('项目至少需要保留一名项目经理，请先指定接任者', 'DEPENDENCY_CONFLICT', 409, { managers });
}

export function addProjectPerson(projectId: string, personId: string, actor: Actor, requestedRole: unknown = 'member') {
  requireActiveProject(projectId);
  const person = row<{ name: string }>('SELECT name FROM people WHERE id=? AND deleted_at IS NULL AND active=1', personId);
  if (!person) notFound('人员不存在或已停用');
  const projectRole = ensureEnum(requestedRole, projectRoles, '项目角色');
  const currentRole = row<{ projectRole: ProjectRole }>('SELECT project_role AS projectRole FROM project_people WHERE project_id=? AND person_id=?', projectId, personId)?.projectRole;
  assertManagerReplacement(projectId, personId, projectRole);
  if (projectRole === 'viewer' && currentRole && currentRole !== 'viewer') assertNoActiveAssignments(personId, projectId);
  sqlite.prepare(`INSERT INTO project_people (project_id, person_id, project_role, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(project_id,person_id) DO UPDATE SET project_role=excluded.project_role`).run(projectId, personId, projectRole, nowIso());
  audit(actor, 'add_member', 'person', personId, `设置项目成员：${person.name}（${projectRole}）`, projectId);
  return listPeople(false, projectId).find((item: any) => item.id === personId);
}

export function removeProjectPerson(projectId: string, personId: string, actor: Actor) {
  requireActiveProject(projectId);
  const person = row<{ name: string }>('SELECT name FROM people WHERE id=? AND deleted_at IS NULL', personId);
  if (!person) notFound('人员不存在');
  const membership = row<{ projectRole: ProjectRole }>('SELECT project_role AS projectRole FROM project_people WHERE project_id=? AND person_id=?', projectId, personId);
  if (!membership) notFound('该人员不属于当前项目');
  assertManagerReplacement(projectId, personId);
  assertNoActiveAssignments(personId, projectId);
  const result = sqlite.prepare('DELETE FROM project_people WHERE project_id=? AND person_id=?').run(projectId, personId);
  if (!result.changes) notFound('该人员不属于当前项目');
  audit(actor, 'remove_member', 'person', personId, `移出项目成员：${person.name}`, projectId);
  return { ok: true };
}

function assertUniquePersonName(name: string, exceptId?: string) {
  const normalized = normalizeSearchText(name);
  const duplicate = rows<{ id: string; name: string }>('SELECT id, name FROM people WHERE deleted_at IS NULL')
    .find((person) => person.id !== exceptId && normalizeSearchText(person.name) === normalized);
  if (duplicate) fail('人员姓名已存在');
}

export function createPerson(input: JsonObject, actor: Actor) {
  const id = randomUUID(); const now = nowIso(); const name = requireLabel(input.name, '姓名');
  const projectId = nullableText(input.projectId);
  if (projectId) requireActiveProject(projectId);
  assertUniquePersonName(name);
  sqlite.transaction(() => {
    sqlite.prepare('INSERT INTO people (id, name, job_title, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)')
      .run(id, name, nullableLabel(input.jobTitle, '岗位'), now, now);
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
  if (!current) notFound('人员不存在');
  const name = input.name === undefined ? current.name : requireLabel(input.name, '姓名');
  assertUniquePersonName(name, id);
  const active = input.active === undefined
    ? current.active
    : [true, 1, '1', 'true'].includes(input.active as boolean | number | string) ? 1 : 0;
  if (!active && current.active) {
    assertNotActiveProjectManager(id);
    assertNoActiveAssignments(id);
  }
  sqlite.transaction(() => {
    sqlite.prepare('UPDATE people SET name=?, job_title=?, active=?, updated_at=? WHERE id=?').run(
      name, input.jobTitle === undefined ? current.jobTitle : nullableLabel(input.jobTitle, '岗位'), active, nowIso(), id,
    );
    if (input.active !== undefined) {
      sqlite.prepare(`UPDATE accounts SET status=?, session_version=session_version+1, updated_at=?
        WHERE person_id=? AND is_builtin=0 AND deleted_at IS NULL`).run(active ? 'active' : 'disabled', nowIso(), id);
    }
  })();
  audit(actor, 'update', 'person', id, `更新人员：${name}`);
  return row('SELECT id, name, job_title AS jobTitle, active, created_at AS createdAt, updated_at AS updatedAt FROM people WHERE id=?', id)!;
}

export function archivePerson(id: string, actor: Actor) {
  if (!row('SELECT id FROM people WHERE id=? AND deleted_at IS NULL', id)) notFound('人员不存在');
  assertNotActiveProjectManager(id);
  assertNoActiveAssignments(id);
  sqlite.transaction(() => {
    sqlite.prepare('UPDATE people SET deleted_at=?, active=0, updated_at=? WHERE id=?').run(nowIso(), nowIso(), id);
    sqlite.prepare(`UPDATE accounts SET status='disabled', session_version=session_version+1, updated_at=?
      WHERE person_id=? AND is_builtin=0 AND deleted_at IS NULL`).run(nowIso(), id);
  })();
  audit(actor, 'archive', 'person', id, '归档人员');
  return { ok: true };
}

export function restorePerson(id: string, actor: Actor) {
  const person = row<{ name: string }>('SELECT name FROM people WHERE id=? AND deleted_at IS NOT NULL', id);
  if (!person) notFound('归档人员不存在');
  assertUniquePersonName(person.name, id);
  sqlite.transaction(() => {
    sqlite.prepare('UPDATE people SET deleted_at=NULL, active=1, updated_at=? WHERE id=?').run(nowIso(), id);
    const account = row<{ id: string; deletedAt: string | null }>('SELECT id, deleted_at AS deletedAt FROM accounts WHERE person_id=?', id);
    if (account && !account.deletedAt) sqlite.prepare(`UPDATE accounts SET status='active', session_version=session_version+1, updated_at=? WHERE id=?`).run(nowIso(), account.id);
    else if (!account) createAccountForPerson(id, person.name, true);
  })();
  audit(actor, 'restore', 'person', id, `恢复人员：${person.name}`);
  return listPeople(true).find((item: any) => item.id === id);
}

function parseTemplateItems(input: unknown): TemplateItemInput[] {
  if (!Array.isArray(input)) return [];
  if (input.length > maxTemplateItems) fail(`流程工作项不能超过${maxTemplateItems}个`);
  return input.map((value, index) => {
    if (typeof value === 'string') return { title: requireLabel(value, '工作项名称'), startOffsetDays: index, durationDays: 1, milestoneLabel: null, sortOrder: index };
    const item = value as JsonObject;
    const startOffsetDays = Number(item.startOffsetDays ?? index);
    const durationDays = Number(item.durationDays ?? 1);
    if (!Number.isInteger(startOffsetDays) || startOffsetDays < 0 || startOffsetDays > maxTemplateOffsetDays) fail(`开始偏移必须是0到${maxTemplateOffsetDays}之间的整数`);
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > maxTemplateDurationDays) fail(`工期必须是1到${maxTemplateDurationDays}之间的整数`);
    return {
      id: nullableText(item.id) || undefined,
      title: requireLabel(item.title, '工作项名称'), startOffsetDays, durationDays,
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
  const itemWhere = [
    ...(projectId ? ['t.project_id=?'] : []),
    ...(!includeDeleted ? ['t.deleted_at IS NULL', 'i.deleted_at IS NULL'] : []),
  ];
  const items = rows<any>(`SELECT i.id, i.template_id AS templateId, i.title, i.sort_order AS sortOrder,
    i.start_offset_days AS startOffsetDays, i.duration_days AS durationDays, i.milestone_label AS milestoneLabel, i.deleted_at AS deletedAt
    FROM template_items i JOIN work_item_templates t ON t.id=i.template_id
    ${itemWhere.length ? `WHERE ${itemWhere.join(' AND ')}` : ''} ORDER BY i.sort_order`, ...(projectId ? [projectId] : []));
  return templates.map((template) => ({
    ...template,
    items: items.filter((item) => item.templateId === template.id && (includeDeleted || !item.deletedAt)),
  }));
}

function assertUniqueTemplateName(projectId: string, name: string, exceptId?: string) {
  const normalized = normalizeSearchText(name);
  const duplicate = rows<{ id: string; name: string }>('SELECT id, name FROM work_item_templates WHERE project_id=? AND deleted_at IS NULL', projectId)
    .find((template) => template.id !== exceptId && normalizeSearchText(template.name) === normalized);
  if (duplicate) fail('当前项目已存在同名流程');
}

export function createTemplate(input: JsonObject, actor: Actor) {
  const id = randomUUID(); const now = nowIso(); const projectId = requireText(input.projectId, '项目');
  requireActiveProject(projectId);
  const name = requireLabel(input.name, '流程名称');
  assertUniqueTemplateName(projectId, name);
  const description = templateDescription(input.description);
  const items = parseTemplateItems(input.items);
  if (!items.length) fail('模板至少需要一个工作项');
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
  if (!current) notFound('模板不存在');
  const name = input.name === undefined ? current.name : requireLabel(input.name, '模板名称');
  assertUniqueTemplateName(current.projectId, name, id);
  const description = input.description === undefined ? current.description : templateDescription(input.description);
  const items = input.items === undefined ? null : parseTemplateItems(input.items);
  if (items && !items.length) fail('模板至少需要一个工作项');
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
  if (!source) notFound('来源流程不存在');
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
  if (!template) notFound('模板不存在');
  if (row('SELECT 1 FROM projects WHERE id=? AND default_template_id=?', template.projectId, id)) fail('项目默认流程不能归档，请先更换默认流程', 'DEPENDENCY_CONFLICT');
  const activeCount = row<{ count: number }>('SELECT COUNT(*) AS count FROM work_item_templates WHERE project_id=? AND deleted_at IS NULL', template.projectId)?.count || 0;
  if (activeCount <= 1) fail('项目至少需要保留一个有效流程', 'DEPENDENCY_CONFLICT');
  sqlite.prepare('UPDATE work_item_templates SET deleted_at=?, updated_at=? WHERE id=?').run(nowIso(), nowIso(), id);
  audit(actor, 'archive', 'template', id, '归档流程设计');
  return { ok: true };
}

export function restoreTemplate(id: string, actor: Actor) {
  const template = row<{ projectId: string; name: string }>('SELECT project_id AS projectId, name FROM work_item_templates WHERE id=? AND deleted_at IS NOT NULL', id);
  if (!template) notFound('归档模板不存在');
  assertUniqueTemplateName(template.projectId, template.name, id);
  sqlite.prepare('UPDATE work_item_templates SET deleted_at=NULL, updated_at=? WHERE id=?').run(nowIso(), id);
  audit(actor, 'restore', 'template', id, '恢复流程设计');
  return listTemplates(template.projectId, true).find((item: any) => item.id === id);
}

function activeTemplateItems(templateId: string) {
  return rows<{ id: string; title: string; sortOrder: number; startOffsetDays: number; durationDays: number; milestoneLabel: string | null }>(`SELECT id, title,
    sort_order AS sortOrder, start_offset_days AS startOffsetDays, duration_days AS durationDays, milestone_label AS milestoneLabel
    FROM template_items WHERE template_id=? AND deleted_at IS NULL ORDER BY sort_order`, templateId);
}

function applyTemplateInternal(requirementId: string, templateId: string, baseStart: string) {
  const items = activeTemplateItems(templateId);
  if (!items.length) fail('模板没有可用工作项');
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
  if (!requirement) notFound('需求不存在');
  const workItems = getWorkItems(requirementId);
  const metrics = deriveRequirementMetrics(requirement, workItems, todayIso(), config.highRiskDelayDays);
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
  if (!project) notFound('项目不存在');
  const title = requireLabel(input.title, '需求标题');
  const priority = ensureEnum(input.priority ?? 'P2', priorities, '优先级');
  const ownerId = requirementOwner(projectId, input.ownerId);
  const background = nullableText(input.background);
  const acceptanceCriteria = nullableText(input.acceptanceCriteria);
  const referenceUrl = nullableText(input.referenceUrl);
  const inputPlannedStart = nullableText(input.plannedStart);
  const inputPlannedEnd = nullableText(input.plannedEnd);
  if (inputPlannedStart && inputPlannedEnd) fail('计划开始和截止日期只能选择一项');
  const hasSchedule = Boolean(inputPlannedStart || inputPlannedEnd);
  const templateId = nullableText(input.templateId) || (hasSchedule ? project.defaultTemplateId || firstActiveTemplateId(projectId) : null);
  if (templateId && !row('SELECT id FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL', templateId, projectId)) {
    fail('请选择当前项目的有效流程设计');
  }
  if (hasSchedule && !templateId) fail('立即规划时请选择当前项目的有效流程设计');
  let plannedStart: string | null = null;
  if (inputPlannedStart) {
    plannedStart = requireDate(inputPlannedStart, '计划开始');
    if (businessDaysInclusive(plannedStart, plannedStart) !== 1) fail('计划开始需为工作日');
  } else if (inputPlannedEnd) {
    const deadline = requireDate(inputPlannedEnd, '截止日期');
    if (businessDaysInclusive(deadline, deadline) !== 1) fail('截止日期需为工作日');
    plannedStart = plannedStartFromDeadline(deadline, activeTemplateItems(templateId!));
  }
  const tx = sqlite.transaction(() => {
    sqlite.prepare(`INSERT INTO requirements
      (id, project_id, template_id, title, background, acceptance_criteria, reference_url, owner_id,
        status, planned_start, progress, risk_level, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planning', ?, 0, 'low', ?, ?, ?)`).run(
      id, projectId, templateId, title, background, acceptanceCriteria, referenceUrl, ownerId, plannedStart, priority, now, now,
    );
    if (plannedStart && templateId) applyTemplateInternal(id, templateId, plannedStart);
    updateStoredRequirementEnd(id);
  });
  tx(); audit(actor, 'create', 'requirement', id, plannedStart ? `创建需求并生成工作项：${title}` : `创建待规划需求：${title}`);
  return getRequirement(id);
}

function changeRequirement(id: string, input: JsonObject, actor: Actor) {
  const current = getRequirement(id);
  assertExpectedVersion(input, current.version);
  if (['pending_acceptance', 'completed', 'cancelled'].includes(current.status)) {
    fail('待验收、已完成或已取消需求已锁定，请使用验收、返工或纠错操作', 'TERMINAL_LOCKED');
  }
  const title = input.title === undefined ? current.title : requireLabel(input.title, '需求标题');
  const priority = input.priority === undefined ? current.priority : ensureEnum(input.priority, priorities, '优先级');
  const ownerId = input.ownerId === undefined ? current.ownerId : requirementOwner(current.projectId, input.ownerId);
  const background = input.background === undefined ? current.background : nullableText(input.background);
  const acceptanceCriteria = input.acceptanceCriteria === undefined ? current.acceptanceCriteria : nullableText(input.acceptanceCriteria);
  const referenceUrl = input.referenceUrl === undefined ? current.referenceUrl : nullableText(input.referenceUrl);
  const requestedPlannedStart = input.plannedStart === undefined ? undefined : requireDate(input.plannedStart, '计划开始');
  const requestedPlannedEnd = input.plannedEnd === undefined ? undefined : requireDate(input.plannedEnd, '计划完成');
  if (requestedPlannedStart !== undefined && requestedPlannedEnd !== undefined) fail('计划开始和完成日期请选择一项');
  const scheduleMode = input.scheduleMode === undefined
    ? (requestedPlannedEnd !== undefined ? 'deadline' : 'start')
    : ensureEnum(input.scheduleMode, ['start', 'deadline'] as const, '排期方式');
  if (scheduleMode === 'start' && requestedPlannedEnd !== undefined) fail('正排时请设置计划开始日期');
  if (scheduleMode === 'deadline' && requestedPlannedStart !== undefined) fail('倒排时请设置计划完成日期');
  const templateId = input.templateId === undefined ? current.templateId : nullableText(input.templateId);
  const templateChanged = input.templateId !== undefined && templateId !== current.templateId;
  const hasExecution = current.workItems!.some((item) => item.status !== 'not_started' || item.progress > 0 || item.actualStart)
    || Boolean(row(`SELECT 1 FROM progress_updates WHERE requirement_id=? AND event_type<>'note' LIMIT 1`, id));
  if (input.ownerId !== undefined && !ownerId && hasExecution) {
    fail('需求已开始执行，只能更换负责人，不能清空负责人', 'DEPENDENCY_CONFLICT', 409);
  }
  let nextPlannedStart = current.plannedStart;
  let shiftDays = 0;
  let generateInitialPlan = false;
  if (requestedPlannedStart !== undefined || requestedPlannedEnd !== undefined) {
    const targetDate = requestedPlannedStart ?? requestedPlannedEnd!;
    if (businessDaysInclusive(targetDate, targetDate) !== 1) fail(`${scheduleMode === 'start' ? '计划开始' : '计划完成'}需为工作日`);
    if (!templateChanged) {
      const currentAnchor = scheduleMode === 'start' ? current.plannedStart : current.plannedEnd;
      if (!currentAnchor) {
        if (current.workItems!.length || !current.templateId) fail('当前需求缺少可用于顺延的计划日期');
        nextPlannedStart = scheduleMode === 'start'
          ? targetDate
          : plannedStartFromDeadline(targetDate, activeTemplateItems(current.templateId));
        generateInitialPlan = true;
      } else {
        shiftDays = businessDayDelta(currentAnchor, targetDate);
        nextPlannedStart = scheduleMode === 'start'
          ? targetDate
          : current.plannedStart ? addBusinessDays(current.plannedStart, shiftDays) : null;
      }
    }
    if (hasExecution && !nullableText(input.reason)) fail('需求已开始执行，调整排期时必须填写变更原因');
  }
  if (templateChanged) {
    if (hasExecution) fail('需求已有执行记录，不能重选流程；请取消后重新创建', 'INVALID_TRANSITION');
    if (!templateId || !row('SELECT id FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL', templateId, current.projectId)) fail('请选择当前项目的有效流程设计');
    if (requestedPlannedEnd !== undefined) {
      nextPlannedStart = plannedStartFromDeadline(requestedPlannedEnd, activeTemplateItems(templateId));
    } else if (requestedPlannedStart !== undefined) {
      nextPlannedStart = requestedPlannedStart;
    }
    if (!nextPlannedStart) fail('重选流程前请设置计划日期');
    if (input.confirmTemplateReset !== true) fail('重选流程会替换未执行工作项并重新生成计划；需求级说明将保留，请确认后重试');
  }
  if (generateInitialPlan && !row('SELECT id FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL', current.templateId, current.projectId)) {
    fail('当前流程设计已归档，请恢复流程或重新选择', 'DEPENDENCY_CONFLICT', 409);
  }
  const now = nowIso();
  sqlite.transaction(() => {
    if (templateChanged && templateId) {
      sqlite.prepare('DELETE FROM work_items WHERE requirement_id=?').run(id);
      sqlite.prepare(`UPDATE requirements SET template_id=?, title=?, status='planning', planned_start=?,
        planned_end=NULL, progress=0, risk_level='low', priority=?, owner_id=?, background=?, acceptance_criteria=?, reference_url=?,
        accepted_at=NULL, accepted_by_account_id=NULL,
        version=version+1, updated_at=? WHERE id=?`)
        .run(templateId, title, nextPlannedStart, priority, ownerId, background, acceptanceCriteria, referenceUrl, now, id);
      applyTemplateInternal(id, templateId, nextPlannedStart!);
      updateStoredRequirementEnd(id);
      return;
    }
    shiftRequirementWorkItems(id, shiftDays, now);
    sqlite.prepare(`UPDATE requirements SET title=?, priority=?, owner_id=?, background=?, acceptance_criteria=?, reference_url=?,
      planned_start=?, version=version+1, updated_at=? WHERE id=?`)
      .run(title, priority, ownerId, background, acceptanceCriteria, referenceUrl, nextPlannedStart, now, id);
    if (generateInitialPlan) applyTemplateInternal(id, current.templateId!, nextPlannedStart!);
    if (requestedPlannedStart !== undefined || requestedPlannedEnd !== undefined) updateStoredRequirementEnd(id);
    else if (ownerId !== current.ownerId) syncStoredRequirementState(id, now, false);
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
  if (['status', 'progress', 'acceptedAt', 'acceptedByAccountId', 'templateId', 'title', 'priority', 'ownerId', 'background', 'acceptanceCriteria', 'referenceUrl']
    .some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    fail('排期命令不能修改需求信息、状态、进度、验收或流程');
  }
  return changeRequirement(id, input, actor);
}

export function reselectRequirementTemplate(id: string, input: JsonObject, actor: Actor) {
  if (!nullableText(input.templateId)) fail('请选择要重新绑定的流程');
  if (['status', 'progress', 'acceptedAt', 'acceptedByAccountId', 'title', 'priority', 'ownerId', 'background', 'acceptanceCriteria', 'referenceUrl']
    .some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    fail('流程重选命令不能修改需求信息、状态、进度或验收信息');
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
  if (!row('SELECT id FROM requirements WHERE id=? AND deleted_at IS NOT NULL', id)) notFound('归档需求不存在');
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
  if (!requirement.plannedStart) fail('需求缺少计划开始日期');
  if (!row('SELECT id FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL', templateId, requirement.projectId)) fail('流程设计不属于当前项目');
  const tx = sqlite.transaction(() => { applyTemplateInternal(requirementId, templateId, requirement.plannedStart!); updateStoredRequirementEnd(requirementId); });
  tx(); audit(actor, 'apply_template', 'requirement', requirementId, '从模板补充工作项');
  return getRequirement(requirementId);
}

export function previewRequirementPlan(requirementId: string, input: JsonObject) {
  const requirement = getRequirement(requirementId, true);
  const templateId = requireText(input.templateId, '流程设计');
  if (!row('SELECT id FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL', templateId, requirement.projectId)) fail('流程设计不属于当前项目');
  const baseStart = requireDate(input.baseStart ?? requirement.plannedStart, '计划开始');
  if (businessDaysInclusive(baseStart, baseStart) !== 1) fail('计划开始需为工作日');
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
  if (!Array.isArray(value)) fail('协作人员格式不合法');
  const ids = [...new Set(value.map((id) => String(id).trim()).filter((id) => id && id !== ownerId))];
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const count = row<{ count: number }>(`SELECT COUNT(*) AS count FROM people WHERE id IN (${placeholders}) AND deleted_at IS NULL AND active=1`, ...ids)?.count || 0;
    if (count !== ids.length) fail('协作人员不存在或已停用');
  }
  return ids;
}

function assertProjectAssignees(requirementId: string, ids: Array<string | null>, conflict = false) {
  const assigneeIds = [...new Set(ids.filter(Boolean) as string[])];
  if (!assigneeIds.length) return;
  const requirement = row<{ projectId: string }>('SELECT project_id AS projectId FROM requirements WHERE id=?', requirementId);
  if (!requirement) notFound('需求不存在');
  const placeholders = assigneeIds.map(() => '?').join(',');
  const count = row<{ count: number }>(`SELECT COUNT(*) AS count FROM project_people pp
    JOIN people p ON p.id=pp.person_id
    WHERE pp.project_id=? AND pp.person_id IN (${placeholders}) AND pp.project_role IN ('member','manager')
      AND p.deleted_at IS NULL AND p.active=1`, requirement.projectId, ...assigneeIds)?.count || 0;
  if (count !== assigneeIds.length) fail('负责人必须是当前项目中已启用的成员或项目经理', conflict ? 'DEPENDENCY_CONFLICT' : 'VALIDATION_ERROR', conflict ? 409 : 400);
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
  const id = randomUUID(); const now = nowIso(); const title = requireLabel(input.title, '工作项标题');
  const max = row<{ value: number | null }>('SELECT MAX(sort_order) AS value FROM work_items WHERE requirement_id=?', requirementId)?.value ?? -1;
  const ownerId = nullableText(input.ownerId);
  const collaboratorIds = collaboratorIdsFromInput(input, ownerId) || [];
  assertProjectAssignees(requirementId, [ownerId, ...collaboratorIds]);
  const milestone = milestoneLabel(input.milestoneLabel);
  const plannedStart = nullableDate(input.plannedStart, '计划开始'); const plannedEnd = nullableDate(input.plannedEnd, '计划完成');
  if (plannedStart && businessDaysInclusive(plannedStart, plannedStart) !== 1) fail('计划开始需为工作日');
  if (plannedEnd && businessDaysInclusive(plannedEnd, plannedEnd) !== 1) fail('计划完成需为工作日');
  if (plannedStart && plannedEnd && plannedStart > plannedEnd) fail('计划完成日期不能早于计划开始日期');
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
  if (!current) notFound('工作项不存在');
  getRequirement(current.requirementId);
  assertExpectedVersion(input, current.version);
  if (isTerminalWorkItemStatus(current.status)) fail('已完成或已取消的工作项已锁定，请使用重开或纠错操作', 'TERMINAL_LOCKED');
  const executionKeys = ['status', 'progress', 'actualStart', 'actualEnd', 'blockedAt', 'blockedReason'];
  if (executionKeys.some((key) => Object.prototype.hasOwnProperty.call(input, key))) fail('状态、进度和实际日期不能通过普通编辑修改，请使用对应操作命令');
  const title = input.title === undefined ? current.title : requireLabel(input.title, '工作项标题');
  const milestone = input.milestoneLabel === undefined ? current.milestoneLabel : milestoneLabel(input.milestoneLabel);
  const ownerId = input.ownerId === undefined ? current.ownerId : nullableText(input.ownerId);
  const collaboratorIds = collaboratorIdsFromInput(input, ownerId);
  const currentCollaborators = collaboratorIds === undefined
    ? rows<{ personId: string }>('SELECT person_id AS personId FROM work_item_collaborators WHERE work_item_id=?', id).map((item) => item.personId)
    : collaboratorIds;
  assertProjectAssignees(current.requirementId, [ownerId, ...currentCollaborators]);
  const plannedStart = input.plannedStart === undefined ? current.plannedStart : nullableDate(input.plannedStart, '计划开始');
  const plannedEnd = input.plannedEnd === undefined ? current.plannedEnd : nullableDate(input.plannedEnd, '计划完成');
  if (plannedStart && businessDaysInclusive(plannedStart, plannedStart) !== 1) fail('计划开始需为工作日');
  if (plannedEnd && businessDaysInclusive(plannedEnd, plannedEnd) !== 1) fail('计划完成需为工作日');
  if (plannedStart && plannedEnd && plannedStart > plannedEnd) fail('计划完成日期不能早于计划开始日期');
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
  if (!current) notFound('工作项不存在');
  getRequirement(current.requirementId);
  assertExpectedVersion(input, current.version);
  const today = todayIso(); const now = nowIso();
  const labels = { start: '开始', complete: '完成', block: '阻塞', unblock: '解除阻塞', cancel: '取消' } as const;
  const eventContent = action === 'complete' ? requireText(input.content, '完成说明')
    : action === 'block' ? requireText(input.reason, '阻塞原因')
      : action === 'cancel' ? requireText(input.reason, '取消原因')
        : nullableText(input.content) || `${labels[action]}工作项`;
  if (action === 'start') {
    assertTransition(current.status, ['not_started'], '开始');
    const requirement = getRequirement(current.requirementId);
    if (requirement.status === 'planning') fail('需求尚未完成规划，请先指定需求负责人并补齐全部工作项排期', 'DEPENDENCY_CONFLICT', 409);
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
  if (!current) notFound('工作项不存在');
  const requirement = getRequirement(current.requirementId);
  if (requirement.status === 'cancelled') fail('已取消需求的工作项不能重开', 'DEPENDENCY_CONFLICT', 409);
  const item = requirement.workItems!.find((entry) => entry.id === id)!;
  assertProjectAssignees(current.requirementId, [requirement.ownerId, item.ownerId, ...item.collaborators.map((person) => person.id)], true);
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
  if (!current) notFound('工作项不存在');
  getRequirement(current.requirementId);
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
  const title = input.title === undefined ? current.title : requireLabel(input.title, '工作项标题'); const now = nowIso();
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
  if (!current) notFound('工作项不存在');
  getRequirement(current.requirementId);
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
  const currentIds = requirement.workItems!.map((item) => item.id);
  if (ids.length !== currentIds.length || new Set(ids).size !== ids.length
    || ids.some((id) => !currentIds.includes(id))) {
    fail('工作项顺序必须包含当前需求的全部工作项，且不能重复');
  }
  if (requirement.workItems!.some((item) => item.status !== 'not_started') && !nullableText(input.reason)) fail('需求已开始执行，调整顺序时必须填写变更原因');
  const now = nowIso();
  const tx = sqlite.transaction(() => { ids.forEach((id, index) => sqlite.prepare('UPDATE work_items SET sort_order=?, version=version+1, updated_at=? WHERE id=? AND requirement_id=?').run(index, now, id, requirementId)); syncStoredRequirementState(requirementId, now); });
  tx(); audit(actor, 'reorder', 'work_item', requirementId, '调整工作项顺序');
  return getRequirement(requirementId).workItems;
}

export function addProgress(requirementId: string, input: JsonObject, actor: Actor) {
  const requirement = getRequirement(requirementId); const content = requireText(input.content, '具体进展');
  const id = randomUUID(); const now = nowIso(); const workItemId = nullableText(input.workItemId);
  if (workItemId && !requirement.workItems!.some((item) => item.id === workItemId)) notFound('关联工作项不存在');
  if (!workItemId && input.workItemPercent !== undefined && nullableText(input.workItemPercent) !== null) fail('填写完成度前请选择工作项');
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

export function updateProgress(id: string, _input: JsonObject, _actor: Actor) {
  if (!row('SELECT id FROM progress_updates WHERE id=?', id)) notFound('进展记录不存在');
  fail('进展历史为只追加记录，不能修改；如需更正请追加纠错记录', 'HISTORY_IMMUTABLE');
}

export function deleteProgress(id: string, _actor: Actor) {
  if (!row('SELECT id FROM progress_updates WHERE id=?', id)) notFound('进展记录不存在');
  fail('进展历史为只追加记录，不能删除', 'HISTORY_IMMUTABLE');
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
      if (!project) {
        if (row('SELECT id FROM projects WHERE id=?', id)) fail('只能永久删除已归档项目');
        notFound('归档项目不存在');
      }
      if (requireLabel(input.confirmName, '确认名称') !== canonicalizeLabel(project.name)) fail('确认名称与项目名称不一致');
      const requirementCount = row<{ count: number }>('SELECT COUNT(*) AS count FROM requirements WHERE project_id=?', id)?.count || 0;
      sqlite.prepare('DELETE FROM requirements WHERE project_id=?').run(id);
      sqlite.prepare('DELETE FROM projects WHERE id=?').run(id);
      if (isSampleProjectId(id)) deleteOrReleaseSamplePeople(sqlite, nowIso());
      audit(actor, 'permanent_delete', 'project', id, `永久删除归档项目：${project.name}（含${requirementCount}条需求）`, null);
      return { ok: true };
    }
    if (entity === 'requirements') {
      const requirement = row<{ title: string }>('SELECT title FROM requirements WHERE id=? AND deleted_at IS NOT NULL', id);
      if (!requirement) {
        if (row('SELECT id FROM requirements WHERE id=?', id)) fail('只能永久删除已归档需求');
        notFound('归档需求不存在');
      }
      if (requireLabel(input.confirmName, '确认名称') !== canonicalizeLabel(requirement.title)) fail('确认名称与需求名称不一致');
      sqlite.prepare('DELETE FROM requirements WHERE id=?').run(id);
      audit(actor, 'permanent_delete', 'requirement', id, `永久删除归档需求：${requirement.title}`);
      return { ok: true };
    }
    if (entity === 'people') {
      const person = row<{ name: string }>('SELECT name FROM people WHERE id=? AND deleted_at IS NOT NULL', id);
      if (!person) {
        if (row('SELECT id FROM people WHERE id=?', id)) fail('只能永久删除已归档人员');
        notFound('归档人员不存在');
      }
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
      if (!template) {
        if (row('SELECT id FROM work_item_templates WHERE id=?', id)) fail('只能永久删除已归档流程');
        notFound('归档模板不存在');
      }
      const references = row<{ count: number }>(`SELECT
        (SELECT COUNT(*) FROM requirements WHERE template_id=?) +
        (SELECT COUNT(*) FROM work_items WHERE template_item_id IN (SELECT id FROM template_items WHERE template_id=?)) AS count`, id, id)?.count || 0;
      if (references) fail(`该流程仍被${references}条历史业务记录引用，只能保留归档快照`, 'DEPENDENCY_CONFLICT', 409, { references });
      sqlite.prepare('DELETE FROM work_item_templates WHERE id=?').run(id);
      audit(actor, 'permanent_delete', 'template', id, `永久删除归档模板：${template.name}`);
      return { ok: true };
    }
    fail('归档类型不合法');
  });
  return tx();
}

export { issueStatuses, priorities, requirementStatuses, riskLevels, workItemStatuses };
