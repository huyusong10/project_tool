import {invalidateForecastReview} from './services/forecast-reviews';
import {validateCoordination,persistCoordination,assertCoordinationAccess} from './services/blocker-coordination';
import {coordinationKeys} from '../shared/blocker-coordination';
import {rescheduleDirectRequirement,createDirectRequirement,updateDeliveryRequirement,executeDirectRequirement,validateDeliveryFields,assertRequirementAcceptor} from './services/delivery-execution';
import { createHash, randomUUID } from 'node:crypto';
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
  businessDaysInclusive,
  canDeleteWorkItem,
  deriveRequirementMetrics,
  issueStatuses,
  maxTemplateDurationDays,
  maxTemplateItems,
  maxTemplateOffsetDays,
  plannedDatesFromOffset,
  plannedStartFromDeadline,
  priorities,
  projectRoles,
  projectStatuses,
  rebaseBusinessDate,
  requirementStatuses,
  riskLevels,
  isTerminalWorkItemStatus,
  todayIso,
  workItemStatuses,
  type ProjectRole,
} from '../shared/domain';
import { canonicalizeLabel, normalizeSearchText } from '../shared/search';
import { AppError, fail, forbidden, notFound } from './errors';
import {
  assertCanAddProgress,
  assertAdmin,
  assertProjectManager,
  assertProjectResourceReadable,
  assertRequirementOwnerOrManager,
  assertWorkItemParticipantOrManager,
  assertWorkItemRequirementOwnerOrManager,
  requireAuthorizationActor,
} from './authorization';
import {
  getRequirement,
  getWorkItems,
  requirementSelect,
  workItemSelect,
  type RequirementRecord,
  type WorkItemRecord,
} from './services/requirements';
import { recordAudit as audit, recordAudits } from './services/audit';
import { getCancellationHistory } from './services/work-item-history';
import { assertStartConditions, adjustForecastClock } from './services/paths';
import {settleMilestones} from './services/milestones';
import { prepareTemplateGraph, saveTemplateGraph, instantiateTemplateGraph } from './services/path-templates';
import {
  requireActiveProject,
  assertExpectedVersion,
  assertExpectedUpdatedAt,
  assertTransition,
  assertVersionedWrite,
  chunkValues,
  ensureEnum,
  milestoneLabel,
  nowIso,
  nextUpdatedAt,
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

type TemplateItemInput = import('../shared/path-template').TemplateDependencyItem & { id?: string; clientKey?: string; predecessorKeys?: string[]; title: string; startOffsetDays: number; durationDays: number; milestoneLabel: string | null; sortOrder: number };

function assertCurrentAdmin(actor: Actor) {
  if (!actor.accountId) {
    if (actor.globalRole !== 'admin') forbidden('此功能仅管理员可用');
    return;
  }
  assertAdmin(requireAuthorizationActor(actor));
}

const projectSelect = `SELECT id, name, status, planned_start AS plannedStart, planned_end AS plannedEnd,
  default_template_id AS defaultTemplateId, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt FROM projects`;

function withProjectMeta<T extends { id: string }>(project: T): T & { isSample: boolean } {
  return { ...project, isSample: isSampleProjectId(project.id) };
}

export function listProjects(includeDeleted = false, actor?: Actor): ProjectRecord[] {
  const canIncludeDeleted = includeDeleted && (!actor || actor.globalRole === 'admin');
  const projects = rows<Omit<ProjectRecord, 'isSample'>>(`${projectSelect} ${canIncludeDeleted ? '' : 'WHERE deleted_at IS NULL'} ORDER BY created_at DESC`)
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

function requirementOwner(projectId: string, value: unknown, conflict = false) {
  const ownerId = nullableText(value);
  if (ownerId && !row(`SELECT p.id FROM people p JOIN project_people pp ON pp.person_id=p.id
    WHERE p.id=? AND pp.project_id=? AND pp.project_role IN ('member','manager')
      AND p.deleted_at IS NULL AND p.active=1`, ownerId, projectId)) {
    fail('需求负责人必须是当前项目中已启用的成员或项目经理', conflict ? 'DEPENDENCY_CONFLICT' : 'VALIDATION_ERROR', conflict ? 409 : 400);
  }
  return ownerId;
}

export function createProject(input: JsonObject, actor: Actor): ProjectRecord {
  if (Object.keys(input).some((key) => !['name', 'plannedStart', 'plannedEnd', 'status'].includes(key))) {
    fail('新建项目不能提交未声明字段');
  }
  if (['defaultTemplateId', 'expectedUpdatedAt'].some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    fail('新建项目不能提交默认流程或更新版本字段');
  }
  const id = randomUUID(); const now = nowIso(); const name = requireLabel(input.name, '项目名称');
  const status = input.status === undefined ? 'active' : ensureEnum(input.status, projectStatuses, '项目状态');
  const plannedStart = nullableDate(input.plannedStart, '项目计划开始');
  const plannedEnd = nullableDate(input.plannedEnd, '项目计划完成');
  if (plannedStart && plannedEnd && plannedStart > plannedEnd) fail('项目计划完成日期不能早于计划开始日期');
  sqlite.transaction(() => {
    sqlite.prepare(`INSERT INTO projects (id, name, status, planned_start, planned_end, default_template_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`).run(id, name, status, plannedStart, plannedEnd, now, now);
    const defaultTemplateId = createInitialProjectFlow(id, now);
    sqlite.prepare('UPDATE projects SET default_template_id=? WHERE id=?').run(defaultTemplateId, id);
    assertCurrentAdmin(actor);
    audit(actor, 'create', 'project', id, `创建项目：${name}`);
  })();
  return withProjectMeta(row<Omit<ProjectRecord, 'isSample'>>(`${projectSelect} WHERE id=?`, id)!);
}

export function updateProject(id: string, input: JsonObject, actor: Actor): ProjectRecord {
  if (Object.keys(input).some((key) => ![
    'name', 'plannedStart', 'plannedEnd', 'defaultTemplateId', 'status', 'expectedUpdatedAt',
  ].includes(key))) fail('项目编辑不能提交未声明字段');
  const current = row<Omit<ProjectRecord, 'isSample'>>(`${projectSelect} WHERE id=? AND deleted_at IS NULL`, id);
  if (!current) notFound('项目不存在');
  assertExpectedUpdatedAt(input, current.updatedAt, '项目');
  const name = input.name === undefined ? current.name : requireLabel(input.name, '项目名称');
  const status = input.status === undefined ? current.status : ensureEnum(input.status, projectStatuses, '项目状态');
  const plannedStart = input.plannedStart === undefined ? current.plannedStart : nullableDate(input.plannedStart, '项目计划开始');
  const plannedEnd = input.plannedEnd === undefined ? current.plannedEnd : nullableDate(input.plannedEnd, '项目计划完成');
  if (plannedStart && plannedEnd && plannedStart > plannedEnd) fail('项目计划完成日期不能早于计划开始日期');
  const defaultTemplateId = input.defaultTemplateId === undefined ? current.defaultTemplateId : nullableText(input.defaultTemplateId);
  if (defaultTemplateId && !row('SELECT id FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL', defaultTemplateId, id)) {
    fail('默认流程必须属于当前项目且未归档');
  }
  const changedFields = name !== current.name || status !== current.status || plannedStart !== current.plannedStart
    || plannedEnd !== current.plannedEnd || defaultTemplateId !== current.defaultTemplateId;
  if (!changedFields) {
    sqlite.transaction(() => {
      if (defaultTemplateId && !row('SELECT id FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL', defaultTemplateId, id)) {
        fail('默认流程已被归档，请刷新后重新选择', 'DEPENDENCY_CONFLICT', 409);
      }
      assertProjectManager(requireAuthorizationActor(actor), id);
    })();
    return withProjectMeta(current);
  }
  const updatedAt = nextUpdatedAt(current.updatedAt);
  sqlite.transaction(() => {
    const changed = sqlite.prepare(`UPDATE projects SET name=?, status=?, planned_start=?, planned_end=?, default_template_id=?, updated_at=?
      WHERE id=? AND updated_at=? AND deleted_at IS NULL`).run(
      name, status,
      plannedStart, plannedEnd, defaultTemplateId, updatedAt, id, current.updatedAt,
    );
    if (!changed.changes) fail('项目已被其他用户修改，请重新打开后再保存', 'STALE_WRITE', 409);
    if (defaultTemplateId && !row('SELECT id FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL', defaultTemplateId, id)) {
      fail('默认流程已被归档，请刷新后重新选择', 'DEPENDENCY_CONFLICT', 409);
    }
    assertProjectManager(requireAuthorizationActor(actor), id);
    audit(actor, 'update', 'project', id, `更新项目：${name}`);
  })();
  return withProjectMeta(row<Omit<ProjectRecord, 'isSample'>>(`${projectSelect} WHERE id=?`, id)!);
}

function activeProjectDependencies(id: string) {
  return {
    requirements: row<{ count: number }>(`SELECT COUNT(*) AS count FROM requirements WHERE project_id=? AND deleted_at IS NULL AND status NOT IN ('completed','cancelled')`, id)?.count || 0,
    issues: row<{ count: number }>(`SELECT COUNT(*) AS count FROM issues WHERE project_id=? AND status<>'resolved'`, id)?.count || 0,
  };
}

export function archiveProject(id: string, actor: Actor, options: {
  force?: boolean;
  expectedUpdatedAt?: string;
  expectedRequirements?: number;
  expectedIssues?: number;
} = {}) {
  if (Object.keys(options).some((key) => ![
    'force', 'expectedUpdatedAt', 'expectedRequirements', 'expectedIssues',
  ].includes(key))) fail('项目归档不能提交未声明字段');
  const existing = row<{ name: string; updatedAt: string }>('SELECT name, updated_at AS updatedAt FROM projects WHERE id=? AND deleted_at IS NULL', id);
  if (!existing) notFound('项目不存在');
  assertExpectedUpdatedAt(options, existing.updatedAt, '项目');
  let dependencies = { requirements: 0, issues: 0 };
  let hasActiveContent = false;
  const now = nextUpdatedAt(existing.updatedAt);
  sqlite.transaction(() => {
    const changed = sqlite.prepare(`UPDATE projects SET deleted_at=?, updated_at=?
      WHERE id=? AND updated_at=? AND deleted_at IS NULL`).run(now, now, id, existing.updatedAt);
    if (!changed.changes) fail('项目已被其他用户修改，请重新打开后再归档', 'STALE_WRITE', 409);
    // 先取得 SQLite 写锁，再复核依赖；并发创建若先提交，归档会回滚。
    dependencies = activeProjectDependencies(id);
    hasActiveContent = Boolean(dependencies.requirements || dependencies.issues);
    if (options.force && options.expectedRequirements !== undefined && (
      dependencies.requirements !== options.expectedRequirements || dependencies.issues !== options.expectedIssues
    )) {
      fail(`项目活跃内容已变化：需求${dependencies.requirements}项、问题${dependencies.issues}项，请重新确认`, 'DEPENDENCY_CONFLICT', 409, dependencies);
    }
    if (hasActiveContent && !options.force) {
      fail(`项目仍有活跃需求${dependencies.requirements}项、未解决问题${dependencies.issues}项`, 'DEPENDENCY_CONFLICT', 409, dependencies);
    }
    if (isSampleProjectId(id)) archiveUnusedSamplePeople(sqlite, now, actor.accountId);
    assertCurrentAdmin(actor);
    audit(actor, 'archive', 'project', id, hasActiveContent
      ? `强制归档项目：${existing.name}（活跃需求${dependencies.requirements}项、未解决问题${dependencies.issues}项）`
      : `归档项目：${existing.name}`);
  })();
  return { ok: true, forced: hasActiveContent, dependencies };
}

export function restoreProject(id: string, actor: Actor, input: JsonObject = {}) {
  const existing = row<{ deletedAt: string; updatedAt: string }>('SELECT deleted_at AS deletedAt, updated_at AS updatedAt FROM projects WHERE id=? AND deleted_at IS NOT NULL', id);
  if (!existing) notFound('归档项目不存在');
  assertOptionalArchiveGeneration(input, existing.deletedAt);
  const now = nextUpdatedAt(existing.updatedAt);
  sqlite.transaction(() => {
    const changed = sqlite.prepare(`UPDATE projects SET deleted_at=NULL, updated_at=?
      WHERE id=? AND deleted_at=? AND updated_at=?`).run(now, id, existing.deletedAt, existing.updatedAt);
    if (!changed.changes) fail('归档项目已变化，请刷新后再恢复', 'STALE_WRITE', 409);
    if (isSampleProjectId(id)) restoreSamplePeople(sqlite, now);
    assertCurrentAdmin(actor);
    audit(actor, 'restore', 'project', id, '恢复项目');
  })();
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
    ${projectId ? `(SELECT pp3.updated_at FROM project_people pp3 WHERE pp3.person_id=p.id AND pp3.project_id=?)` : `NULL`} AS membershipUpdatedAt,
    (SELECT a.username FROM accounts a WHERE a.person_id=p.id AND a.deleted_at IS NULL) AS username,
    (SELECT a.status FROM accounts a WHERE a.person_id=p.id AND a.deleted_at IS NULL) AS accountStatus,
    (SELECT a.deleted_at FROM accounts a WHERE a.person_id=p.id) AS accountDeletedAt
    FROM people p ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.active DESC, p.name`, ...(projectId ? [projectId, projectId, ...params] : params));
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

function assertProjectHasManager(projectId: string) {
  const managers = row<{ count: number }>(`SELECT COUNT(*) AS count FROM project_people
    WHERE project_id=? AND project_role='manager'`, projectId)?.count || 0;
  if (!managers) fail('项目至少需要保留一名项目经理，请先指定接任者', 'DEPENDENCY_CONFLICT', 409, { managers });
}

function assertExpectedMembershipUpdatedAt(expectedUpdatedAt: string | null | undefined, currentUpdatedAt: string | null | undefined) {
  if (expectedUpdatedAt === undefined || expectedUpdatedAt === (currentUpdatedAt || null)) return;
  throw new AppError('项目成员关系已被其他用户修改，请刷新后重试', 409, 'STALE_WRITE', {
    currentMembershipUpdatedAt: currentUpdatedAt || null,
  });
}

export function addProjectPerson(projectId: string, personId: string, actor: Actor, requestedRole: unknown = 'member', expectedUpdatedAt?: string | null) {
  requireActiveProject(projectId);
  const person = row<{ name: string }>('SELECT name FROM people WHERE id=? AND deleted_at IS NULL AND active=1', personId);
  if (!person) notFound('人员不存在或已停用');
  const projectRole = ensureEnum(requestedRole, projectRoles, '项目角色');
  const current = row<{ projectRole: ProjectRole; updatedAt: string | null }>(
    'SELECT project_role AS projectRole, updated_at AS updatedAt FROM project_people WHERE project_id=? AND person_id=?', projectId, personId,
  );
  assertExpectedMembershipUpdatedAt(expectedUpdatedAt, current?.updatedAt);
  const currentRole = current?.projectRole;
  assertManagerReplacement(projectId, personId, projectRole);
  if (projectRole === 'viewer' && currentRole && currentRole !== 'viewer') assertNoActiveAssignments(personId, projectId);
  if (currentRole === projectRole) {
    sqlite.transaction(() => {
      const unchanged = row<{ projectRole: ProjectRole; updatedAt: string | null }>(
        'SELECT project_role AS projectRole, updated_at AS updatedAt FROM project_people WHERE project_id=? AND person_id=?', projectId, personId,
      );
      if (!unchanged || unchanged.projectRole !== projectRole || unchanged.updatedAt !== (current?.updatedAt || null)) {
        throw new AppError('项目成员关系已被其他用户修改，请刷新后重试', 409, 'STALE_WRITE');
      }
      if (!row('SELECT id FROM people WHERE id=? AND deleted_at IS NULL AND active=1', personId)) {
        fail('人员已停用或归档，不能设置项目成员', 'DEPENDENCY_CONFLICT', 409);
      }
      requireActiveProject(projectId, true);
      assertProjectManager(requireAuthorizationActor(actor), projectId);
    })();
    return listPeople(false, projectId).find((item: any) => item.id === personId);
  }
  const updatedAt = current ? nextUpdatedAt(current.updatedAt || nowIso()) : nowIso();
  sqlite.transaction(() => {
    if (current) {
      const changed = sqlite.prepare(`UPDATE project_people SET project_role=?, updated_at=?
        WHERE project_id=? AND person_id=? AND updated_at IS ?`).run(projectRole, updatedAt, projectId, personId, current.updatedAt);
      if (!changed.changes) throw new AppError('项目成员关系已被其他用户修改，请刷新后重试', 409, 'STALE_WRITE');
    } else {
      sqlite.prepare(`INSERT INTO project_people (project_id, person_id, project_role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)`).run(projectId, personId, projectRole, updatedAt, updatedAt);
    }
    if (!row('SELECT id FROM people WHERE id=? AND deleted_at IS NULL AND active=1', personId)) {
      fail('人员已停用或归档，不能设置项目成员', 'DEPENDENCY_CONFLICT', 409);
    }
    if (projectRole === 'viewer') assertNoActiveAssignments(personId, projectId);
    if (currentRole === 'manager' && projectRole !== 'manager') assertProjectHasManager(projectId);
    requireActiveProject(projectId, true);
    const currentActor = requireAuthorizationActor(actor);
    if (!(currentActor.personId === personId && currentRole === 'manager' && projectRole !== 'manager')) {
      assertProjectManager(currentActor, projectId);
    }
    audit(actor, 'add_member', 'person', personId, `设置项目成员：${person.name}（${projectRole}）`, projectId);
  })();
  return listPeople(false, projectId).find((item: any) => item.id === personId);
}

export function removeProjectPerson(projectId: string, personId: string, actor: Actor, expectedUpdatedAt?: string | null) {
  requireActiveProject(projectId);
  const person = row<{ name: string }>('SELECT name FROM people WHERE id=? AND deleted_at IS NULL', personId);
  if (!person) notFound('人员不存在');
  const membership = row<{ projectRole: ProjectRole; updatedAt: string | null }>(
    'SELECT project_role AS projectRole, updated_at AS updatedAt FROM project_people WHERE project_id=? AND person_id=?', projectId, personId,
  );
  if (!membership) notFound('该人员不属于当前项目');
  assertExpectedMembershipUpdatedAt(expectedUpdatedAt, membership.updatedAt);
  assertManagerReplacement(projectId, personId);
  assertNoActiveAssignments(personId, projectId);
  sqlite.transaction(() => {
    const result = sqlite.prepare('DELETE FROM project_people WHERE project_id=? AND person_id=? AND updated_at IS ?')
      .run(projectId, personId, membership.updatedAt);
    if (!result.changes) throw new AppError('项目成员关系已被其他用户修改，请刷新后重试', 409, 'STALE_WRITE');
    assertNoActiveAssignments(personId, projectId);
    if (membership.projectRole === 'manager') assertProjectHasManager(projectId);
    requireActiveProject(projectId, true);
    const currentActor = requireAuthorizationActor(actor);
    if (!(currentActor.personId === personId && membership.projectRole === 'manager')) {
      assertProjectManager(currentActor, projectId);
    }
    audit(actor, 'remove_member', 'person', personId, `移出项目成员：${person.name}`, projectId);
  })();
  return { ok: true };
}

function assertUniquePersonName(name: string, exceptId?: string) {
  const normalized = normalizeSearchText(name);
  const duplicate = rows<{ id: string; name: string }>('SELECT id, name FROM people WHERE deleted_at IS NULL')
    .find((person) => person.id !== exceptId && normalizeSearchText(person.name) === normalized);
  if (duplicate) fail('人员姓名已存在');
}

export function createPerson(input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => !['projectId', 'name', 'jobTitle'].includes(key))) {
    fail('新建人员不能提交未声明字段');
  }
  if (['active', 'expectedUpdatedAt'].some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    fail('新建人员不能提交启停状态或更新版本字段');
  }
  const id = randomUUID(); const now = nowIso(); const name = requireLabel(input.name, '姓名');
  const projectId = nullableText(input.projectId);
  if (projectId) requireActiveProject(projectId);
  assertUniquePersonName(name);
  sqlite.transaction(() => {
    sqlite.prepare('INSERT INTO people (id, name, job_title, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)')
      .run(id, name, nullableLabel(input.jobTitle, '岗位'), now, now);
    if (projectId) sqlite.prepare('INSERT INTO project_people (project_id, person_id, created_at, updated_at) VALUES (?, ?, ?, ?)').run(projectId, id, now, now);
    createAccountForPerson(id, name, true);
    if (projectId) requireActiveProject(projectId, true);
    assertCurrentAdmin(actor);
    audit(actor, 'create', 'person', id, `新增人员：${name}`);
  })();
  return row('SELECT id, name, job_title AS jobTitle, active, created_at AS createdAt, updated_at AS updatedAt FROM people WHERE id=?', id)!;
}

export function updatePerson(id: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => !['name', 'jobTitle', 'active', 'expectedUpdatedAt'].includes(key))) {
    fail('人员编辑不能提交未声明字段');
  }
  const current = row<{ name: string; jobTitle: string | null; active: number; updatedAt: string }>(
    'SELECT name, job_title AS jobTitle, active, updated_at AS updatedAt FROM people WHERE id=? AND deleted_at IS NULL', id,
  );
  if (!current) notFound('人员不存在');
  if (input.projectId !== undefined) fail('人员所属项目不能通过人员编辑修改，请使用项目成员管理');
  assertExpectedUpdatedAt(input, current.updatedAt, '人员');
  const name = input.name === undefined ? current.name : requireLabel(input.name, '姓名');
  assertUniquePersonName(name, id);
  const jobTitle = input.jobTitle === undefined ? current.jobTitle : nullableLabel(input.jobTitle, '岗位');
  const active = input.active === undefined
    ? current.active
    : [true, 1, '1', 'true'].includes(input.active as boolean | number | string) ? 1 : 0;
  if (!active && current.active) {
    assertNotActiveProjectManager(id);
    assertNoActiveAssignments(id);
  }
  if (name === current.name && jobTitle === current.jobTitle && active === current.active) {
    sqlite.transaction(() => {
      if (!active) {
        assertNotActiveProjectManager(id);
        assertNoActiveAssignments(id);
      }
      assertCurrentAdmin(actor);
    })();
    return row('SELECT id, name, job_title AS jobTitle, active, created_at AS createdAt, updated_at AS updatedAt FROM people WHERE id=?', id)!;
  }
  const updatedAt = nextUpdatedAt(current.updatedAt);
  const linkedAccount = active !== current.active
    ? row<{ id: string; updatedAt: string }>('SELECT id, updated_at AS updatedAt FROM accounts WHERE person_id=? AND is_builtin=0 AND deleted_at IS NULL', id)
    : undefined;
  const accountUpdatedAt = linkedAccount ? nextUpdatedAt(linkedAccount.updatedAt) : undefined;
  sqlite.transaction(() => {
    const changed = sqlite.prepare(`UPDATE people SET name=?, job_title=?, active=?, updated_at=?
      WHERE id=? AND updated_at=? AND deleted_at IS NULL`).run(
      name, jobTitle, active, updatedAt, id, current.updatedAt,
    );
    if (!changed.changes) fail('人员已被其他用户修改，请重新打开后再保存', 'STALE_WRITE', 409);
    if (linkedAccount && accountUpdatedAt) {
      const accountChanged = sqlite.prepare(`UPDATE accounts SET status=?, session_version=session_version+1, updated_at=?
        WHERE id=? AND updated_at=? AND deleted_at IS NULL`).run(active ? 'active' : 'disabled', accountUpdatedAt, linkedAccount.id, linkedAccount.updatedAt);
      if (!accountChanged.changes) fail('关联账号已被其他用户修改，请重新打开后再保存', 'STALE_WRITE', 409);
    }
    if (!active) {
      assertNotActiveProjectManager(id);
      assertNoActiveAssignments(id);
    }
    assertCurrentAdmin(actor);
    audit(actor, 'update', 'person', id, `更新人员：${name}`);
  })();
  return row('SELECT id, name, job_title AS jobTitle, active, created_at AS createdAt, updated_at AS updatedAt FROM people WHERE id=?', id)!;
}

export function archivePerson(id: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => key !== 'expectedUpdatedAt')) fail('人员归档不能提交未声明字段');
  const person = row<{ updatedAt: string }>('SELECT updated_at AS updatedAt FROM people WHERE id=? AND deleted_at IS NULL', id);
  if (!person) notFound('人员不存在');
  assertExpectedUpdatedAt(input, person.updatedAt, '人员');
  assertNotActiveProjectManager(id);
  assertNoActiveAssignments(id);
  const updatedAt = nextUpdatedAt(person.updatedAt);
  const linkedAccount = row<{ id: string; updatedAt: string }>('SELECT id, updated_at AS updatedAt FROM accounts WHERE person_id=? AND is_builtin=0 AND deleted_at IS NULL', id);
  const accountUpdatedAt = linkedAccount ? nextUpdatedAt(linkedAccount.updatedAt) : undefined;
  sqlite.transaction(() => {
    const changed = sqlite.prepare(`UPDATE people SET deleted_at=?, active=0, updated_at=?
      WHERE id=? AND updated_at=? AND deleted_at IS NULL`).run(updatedAt, updatedAt, id, person.updatedAt);
    if (!changed.changes) fail('人员已被其他用户修改，请重新打开后再归档', 'STALE_WRITE', 409);
    if (linkedAccount && accountUpdatedAt) {
      const accountChanged = sqlite.prepare(`UPDATE accounts SET status='disabled', session_version=session_version+1, updated_at=?
        WHERE id=? AND updated_at=? AND deleted_at IS NULL`).run(accountUpdatedAt, linkedAccount.id, linkedAccount.updatedAt);
      if (!accountChanged.changes) fail('关联账号已被其他用户修改，请重新打开后再归档', 'STALE_WRITE', 409);
    }
    assertNotActiveProjectManager(id);
    assertNoActiveAssignments(id);
    assertCurrentAdmin(actor);
    audit(actor, 'archive', 'person', id, '归档人员');
  })();
  return { ok: true };
}

export function restorePerson(id: string, actor: Actor, input: JsonObject = {}) {
  const person = row<{ name: string; deletedAt: string; updatedAt: string }>('SELECT name, deleted_at AS deletedAt, updated_at AS updatedAt FROM people WHERE id=? AND deleted_at IS NOT NULL', id);
  if (!person) notFound('归档人员不存在');
  assertOptionalArchiveGeneration(input, person.deletedAt);
  assertUniquePersonName(person.name, id);
  const updatedAt = nextUpdatedAt(person.updatedAt);
  const account = row<{ id: string; deletedAt: string | null; updatedAt: string }>('SELECT id, deleted_at AS deletedAt, updated_at AS updatedAt FROM accounts WHERE person_id=?', id);
  const accountUpdatedAt = account && !account.deletedAt ? nextUpdatedAt(account.updatedAt) : undefined;
  sqlite.transaction(() => {
    const changed = sqlite.prepare(`UPDATE people SET deleted_at=NULL, active=1, updated_at=?
      WHERE id=? AND updated_at=? AND deleted_at=?`).run(updatedAt, id, person.updatedAt, person.deletedAt);
    if (!changed.changes) fail('归档人员已被其他用户修改，请重新读取后再恢复', 'STALE_WRITE', 409);
    if (account && !account.deletedAt && accountUpdatedAt) {
      const accountChanged = sqlite.prepare(`UPDATE accounts SET status='active', session_version=session_version+1, updated_at=?
        WHERE id=? AND updated_at=? AND deleted_at IS NULL`).run(accountUpdatedAt, account.id, account.updatedAt);
      if (!accountChanged.changes) fail('关联账号已被其他用户修改，请重新读取后再恢复', 'STALE_WRITE', 409);
    } else if (!account) createAccountForPerson(id, person.name, true);
    assertCurrentAdmin(actor);
    audit(actor, 'restore', 'person', id, `恢复人员：${person.name}`);
  })();
  return listPeople(true).find((item: any) => item.id === id);
}

function parseTemplateItems(input: unknown): TemplateItemInput[] {
  if (!Array.isArray(input)) return [];
  if (input.length > maxTemplateItems) fail(`流程工作项不能超过${maxTemplateItems}个`);
  return input.map((value, index) => {
    if (typeof value === 'string') return { title: requireLabel(value, '工作项名称'), startOffsetDays: index, durationDays: 1, milestoneLabel: null, sortOrder: index };
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('流程工作项格式不正确');
    const item = value as JsonObject;
    if (Object.keys(item).some((key) => ![
      'id', 'clientKey', 'predecessorKeys', 'title', 'startOffsetDays', 'durationDays', 'milestoneLabel', 'sortOrder', 'kind','arrangement','arrangementAnchor','confirmationMode',
    ].includes(key))) fail('流程工作项不能提交未声明字段');
    const startOffsetDays = Number(item.startOffsetDays ?? index);
    const durationDays = item.kind==='milestone'?0:Number(item.durationDays ?? 1);
    if (!Number.isInteger(startOffsetDays) || startOffsetDays < 0 || startOffsetDays > maxTemplateOffsetDays) fail(`开始偏移必须是0到${maxTemplateOffsetDays}之间的整数`);
    if (!Number.isInteger(durationDays) || durationDays < (item.kind==='milestone'?0:1) || durationDays > maxTemplateDurationDays) fail(`工期必须是1到${maxTemplateDurationDays}之间的整数`);
    return {
      kind:item.kind===undefined?'work':ensureEnum(item.kind,['work','milestone'] as const,'元素类型'),arrangement:item.arrangement===undefined?'early':ensureEnum(item.arrangement,['early','late'] as const,'安排方式'),arrangementAnchor:nullableText(item.arrangementAnchor),confirmationMode:item.confirmationMode===undefined?'auto':ensureEnum(item.confirmationMode,['auto','manual'] as const,'确认方式'),
      id: nullableText(item.id) || undefined,
      clientKey: nullableText(item.clientKey) || undefined,
      predecessorKeys: item.predecessorKeys === undefined ? undefined : Array.isArray(item.predecessorKeys) ? item.predecessorKeys.map(String) : fail('前置工作项格式不正确'),
      title: requireLabel(item.title, '工作项名称'), startOffsetDays, durationDays,
      milestoneLabel: milestoneLabel(item.milestoneLabel),
      sortOrder: Number.isInteger(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
    };
  });
}

function templateItemsUnchanged(templateId: string, items: TemplateItemInput[]) {
  const current = rows<Required<TemplateItemInput>&{predecessorIds:string}>(`SELECT id, title, sort_order AS sortOrder, predecessor_ids AS predecessorIds,
    start_offset_days AS startOffsetDays, duration_days AS durationDays, milestone_label AS milestoneLabel,kind,arrangement,arrangement_anchor AS arrangementAnchor,confirmation_mode AS confirmationMode
    FROM template_items WHERE template_id=? AND deleted_at IS NULL ORDER BY sort_order, rowid`, templateId);
  return current.length === items.length && items.every((item, index) => {
    const existing = current[index];
    return item.id === existing.id && item.title === existing.title && index === existing.sortOrder
      && item.startOffsetDays === existing.startOffsetDays && item.durationDays === existing.durationDays
      && item.milestoneLabel === existing.milestoneLabel && (item.kind||'work')===existing.kind && (item.arrangement||'early')===existing.arrangement && (item.arrangementAnchor||null)===(existing.arrangementAnchor||null) && (item.confirmationMode||'auto')===existing.confirmationMode
      && JSON.stringify((JSON.parse(existing.predecessorIds) as string[]).sort()) === JSON.stringify((item.predecessorKeys||[]).map(key=>items.find(i=>(i.clientKey||i.id)===key)?.id).sort());
  });
}

export function listTemplates(projectId?: string | null, includeDeleted = false) {
  if (projectId) requireActiveProject(projectId);
  const templates = rows<any>(`SELECT id, project_id AS projectId, name, description, dependency_mode AS dependencyMode, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
    FROM work_item_templates ${projectId ? 'WHERE project_id=?' : includeDeleted ? '' : 'WHERE deleted_at IS NULL'}
    ${projectId && !includeDeleted ? 'AND deleted_at IS NULL' : ''} ORDER BY created_at`, ...(projectId ? [projectId] : []));
  const itemWhere = [
    ...(projectId ? ['t.project_id=?'] : []),
    ...(!includeDeleted ? ['t.deleted_at IS NULL', 'i.deleted_at IS NULL'] : []),
  ];
  const items = rows<any>(`SELECT i.id, i.template_id AS templateId, i.title, i.sort_order AS sortOrder,
    i.start_offset_days AS startOffsetDays, i.duration_days AS durationDays, i.predecessor_ids AS predecessorIds, i.milestone_label AS milestoneLabel, i.kind,i.arrangement,i.arrangement_anchor AS arrangementAnchor,i.confirmation_mode AS confirmationMode, i.deleted_at AS deletedAt
    FROM template_items i JOIN work_item_templates t ON t.id=i.template_id
    ${itemWhere.length ? `WHERE ${itemWhere.join(' AND ')}` : ''} ORDER BY i.sort_order`, ...(projectId ? [projectId] : []));
  return templates.map((template) => ({
    ...template,
    layout:(()=>{const l=row<{positions:string;version:number;direction:string}>('SELECT positions,version,direction FROM diagram_layouts WHERE project_id=? AND scope=? AND direction=?',template.projectId,'template:'+template.id,'right');return l?{...l,positions:JSON.parse(l.positions)}:undefined;})(),
    items: items.filter((item) => item.templateId === template.id && (includeDeleted || !item.deletedAt)).map(item => ({ ...item, predecessorIds: JSON.parse(item.predecessorIds) })),
  }));
}

function assertUniqueTemplateName(projectId: string, name: string, exceptId?: string) {
  const normalized = normalizeSearchText(name);
  const duplicate = rows<{ id: string; name: string }>('SELECT id, name FROM work_item_templates WHERE project_id=? AND deleted_at IS NULL', projectId)
    .find((template) => template.id !== exceptId && normalizeSearchText(template.name) === normalized);
  if (duplicate) fail('当前项目已存在同名流程');
}

export function createTemplate(input:JsonObject,actor:Actor){return templateBatch(null,input,actor);}
export function updateTemplate(id:string,input:JsonObject,actor:Actor){return templateBatch(id,input,actor);}
function templateBatch(id:string|null,raw:JsonObject,actor:Actor){
  const {batchId,layout,...input}=raw;
  if(!batchId&&!layout)return id?updateTemplateCore(id,input,actor):createTemplateCore(input,actor);
  const projectId=id?row<{projectId:string}>('SELECT project_id AS projectId FROM work_item_templates WHERE id=?',id)?.projectId:String(input.projectId||'');
  if(!projectId)notFound('流程不存在');
  return sqlite.transaction(()=>{
    assertProjectManager(requireAuthorizationActor(actor),projectId);
    const hash=createHash('sha256').update(JSON.stringify({id,...raw})).digest('hex');
    if(batchId){const receipt=row<{actorId:string;actorType:string;projectId:string;hash:string;ids:string}>('SELECT actor_id AS actorId,actor_type AS actorType,project_id AS projectId,content_hash AS hash,added_ids AS ids FROM dependency_change_receipts WHERE batch_id=?',batchId);
      if(receipt){if(receipt.actorId!==actor.id||receipt.actorType!==actor.type||receipt.projectId!==projectId)notFound('本账号的提交回执不存在');if(receipt.hash!==hash)fail('批次标识已用于其他内容');return listTemplates(projectId).find(t=>t.id===JSON.parse(receipt.ids).$template);}}
    const result=id?updateTemplateCore(id,input,actor):createTemplateCore(input,actor);
    const submitted=(input.items||[]) as Array<{id?:string;clientKey?:string}>;const ids:Record<string,string>={$template:result.id};submitted.forEach((n,i)=>{ids[n.clientKey||n.id||String(i)]=result.items[i].id;});
    if(layout){const value=layout as {direction:string;expectedVersion:number;positions:Record<string,{x:number;y:number}>},scope='template:'+result.id;
      const existing=row<{version:number}>('SELECT version FROM diagram_layouts WHERE project_id=? AND scope=? AND direction=?',projectId,scope,value.direction);
      if((existing?.version||0)!==value.expectedVersion)fail('流程布局已经变化','STALE_WRITE',409);
      const valid=new Set(result.items.map((i:{id:string})=>i.id)),positions=Object.fromEntries(Object.entries(value.positions).map(([key,p])=>[ids[key]||key,p]));
      if(Object.keys(positions).some(key=>!valid.has(key)))fail('布局包含失效元素');
      sqlite.prepare('INSERT INTO diagram_layouts(project_id,scope,direction,positions,version,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(project_id,scope,direction) DO UPDATE SET positions=excluded.positions,version=excluded.version,updated_at=excluded.updated_at').run(projectId,scope,value.direction,JSON.stringify(positions),value.expectedVersion+1,nowIso());
    }
    if(batchId)sqlite.prepare('INSERT INTO dependency_change_receipts(batch_id,project_id,actor_type,actor_id,content_hash,committed_revision,added_ids,created_at) VALUES (?,?,?,?,?,?,?,?)').run(batchId,projectId,actor.type,actor.id,hash,row<{revision:number}>('SELECT analysis_revision AS revision FROM projects WHERE id=?',projectId)!.revision,JSON.stringify(ids),nowIso());
    return listTemplates(projectId).find(t=>t.id===result.id);
  }).immediate();
}

function createTemplateCore(input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => !['projectId', 'name', 'description', 'items', 'dependencyMode'].includes(key))) {
    fail('新建流程不能提交未声明字段');
  }
  if (Object.prototype.hasOwnProperty.call(input, 'expectedUpdatedAt')) {
    fail('新建流程不能提交更新版本字段');
  }
  const id = randomUUID(); const now = nowIso(); const projectId = requireText(input.projectId, '项目');
  requireActiveProject(projectId);
  const name = requireLabel(input.name, '流程名称');
  assertUniqueTemplateName(projectId, name);
  const description = templateDescription(input.description);
  const mode = String(input.dependencyMode || 'legacy');
  const items = prepareTemplateGraph(parseTemplateItems(input.items), mode);
  if (!items.length) fail('模板至少需要一个工作项');
  const tx = sqlite.transaction(() => {
    sqlite.prepare('INSERT INTO work_item_templates (id, project_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, projectId, name, description, now, now);
    const insert = sqlite.prepare(`INSERT INTO template_items
      (id, template_id, title, sort_order, start_offset_days, duration_days, milestone_label,kind) VALUES (?, ?, ?, ?, ?, ?, ?,?)`);
    items.forEach((item, index) => insert.run(randomUUID(), id, item.title, index, item.startOffsetDays, item.durationDays, item.milestoneLabel,item.kind||'work'));
    saveTemplateGraph(id, mode, items);
    requireActiveProject(projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), projectId);
    audit(actor, 'create', 'template', id, `创建流程：${name}`);
  });
  tx();
  return listTemplates(projectId).find((item: any) => item.id === id);
}

function updateTemplateCore(id: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => !['name', 'description', 'items', 'expectedUpdatedAt', 'dependencyMode'].includes(key))) {
    fail('流程编辑不能提交未声明字段');
  }
  const current = row<{ projectId: string; name: string; description: string; updatedAt: string }>('SELECT project_id AS projectId, name, description, updated_at AS updatedAt FROM work_item_templates WHERE id=? AND deleted_at IS NULL', id);
  if (!current) notFound('模板不存在');
  assertExpectedUpdatedAt(input, current.updatedAt, '流程');
  if (input.projectId !== undefined && requireText(input.projectId, '项目') !== current.projectId) {
    fail('流程不能通过普通编辑迁移到其他项目');
  }
  const name = input.name === undefined ? current.name : requireLabel(input.name, '模板名称');
  assertUniqueTemplateName(current.projectId, name, id);
  const description = input.description === undefined ? current.description : templateDescription(input.description);
  const oldMode = row<{mode:string}>('SELECT dependency_mode AS mode FROM work_item_templates WHERE id=?',id)!.mode;
  const mode = String(input.dependencyMode || oldMode);
  if (oldMode === 'dependencies' && mode !== oldMode) fail('已启用依赖的流程不能退回偏移模式');
  if (mode !== oldMode && input.items === undefined) fail('切换模式必须核对全部工作项');
  const items = input.items === undefined ? null : prepareTemplateGraph(parseTemplateItems(input.items), mode);
  if (items && !items.length) fail('模板至少需要一个工作项');
  if (items) {
    const submittedIds = items.flatMap((item) => item.id ? [item.id] : []);
    if (new Set(submittedIds).size !== submittedIds.length) fail('同一流程工作项不能重复提交');
    const existingIds = new Set(rows<{ id: string }>(
      'SELECT id FROM template_items WHERE template_id=? AND deleted_at IS NULL', id,
    ).map((item) => item.id));
    if (submittedIds.some((itemId) => !existingIds.has(itemId))) {
      fail('流程工作项已失效或不属于当前流程，请刷新后重试');
    }
  }
  if (mode === oldMode && name === current.name && description === current.description && (!items || templateItemsUnchanged(id, items))) {
    sqlite.transaction(() => {
      requireActiveProject(current.projectId, true);
      assertProjectManager(requireAuthorizationActor(actor), current.projectId);
    })();
    return listTemplates(current.projectId).find((item: any) => item.id === id);
  }
  const updatedAt = nextUpdatedAt(current.updatedAt);
  const tx = sqlite.transaction(() => {
    const changed = sqlite.prepare(`UPDATE work_item_templates SET name=?, description=?, updated_at=?
      WHERE id=? AND updated_at=? AND deleted_at IS NULL`).run(name, description, updatedAt, id, current.updatedAt);
    if (!changed.changes) fail('流程已被其他用户修改，请重新打开后再保存', 'STALE_WRITE', 409);
    if (items) {
      const existing = new Set(rows<{ id: string }>('SELECT id FROM template_items WHERE template_id=? AND deleted_at IS NULL', id).map((item) => item.id));
      const kept = new Set<string>();
      const update = sqlite.prepare(`UPDATE template_items SET title=?, sort_order=?, start_offset_days=?, duration_days=?, milestone_label=?,kind=?, deleted_at=NULL
        WHERE id=? AND template_id=?`);
      const insert = sqlite.prepare(`INSERT INTO template_items
        (id, template_id, title, sort_order, start_offset_days, duration_days, milestone_label,kind) VALUES (?, ?, ?, ?, ?, ?, ?,?)`);
      items.forEach((item, index) => {
        if (item.id && existing.has(item.id)) {
          update.run(item.title, index, item.startOffsetDays, item.durationDays, item.milestoneLabel,item.kind||'work', item.id, id); kept.add(item.id);
        } else {
          const newId = randomUUID(); insert.run(newId, id, item.title, index, item.startOffsetDays, item.durationDays, item.milestoneLabel,item.kind||'work'); kept.add(newId);
        }
      });
      for (const itemId of existing) if (!kept.has(itemId)) sqlite.prepare('UPDATE template_items SET deleted_at=? WHERE id=?').run(updatedAt, itemId);
      saveTemplateGraph(id, mode, items);
    }
    requireActiveProject(current.projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), current.projectId);
    audit(actor, 'update', 'template', id, `更新模板：${name}`);
  });
  tx();
  return listTemplates(current.projectId).find((item: any) => item.id === id);
}

export function copyTemplate(targetProjectId: string, sourceTemplateId: string, actor: Actor) {
  requireActiveProject(targetProjectId);
  const source = row<{ projectId: string; name: string; description: string; updatedAt: string; dependencyMode:string }>(
    `SELECT project_id AS projectId, name, description, updated_at AS updatedAt, dependency_mode AS dependencyMode
      FROM work_item_templates WHERE id=? AND deleted_at IS NULL`, sourceTemplateId,
  );
  if (!source) notFound('来源流程不存在');
  let name = `${source.name}（副本）`; let suffix = 2;
  while (row('SELECT 1 FROM work_item_templates WHERE project_id=? AND deleted_at IS NULL AND lower(trim(name))=lower(trim(?))', targetProjectId, name)) {
    name = `${source.name}（副本${suffix++}）`;
  }
  const sourceItems = listTemplates(source.projectId).find(t=>t.id===sourceTemplateId)!.items as Array<{id:string;predecessorIds:string[];title:string;startOffsetDays:number;durationDays:number;milestoneLabel:string|null;sortOrder:number}>;
  const items = sourceItems.map((item) => ({
    clientKey:item.id, predecessorKeys:item.predecessorIds,
    title: item.title, startOffsetDays: item.startOffsetDays, durationDays: item.durationDays, milestoneLabel: item.milestoneLabel, sortOrder: item.sortOrder,
  }));
  return sqlite.transaction(() => {
    const copied = createTemplate({ projectId: targetProjectId, name, description: source.description, dependencyMode:source.dependencyMode, items }, actor);
    const latestSource = row<{ updatedAt: string }>(
      'SELECT updated_at AS updatedAt FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL',
      sourceTemplateId, source.projectId,
    );
    if (!latestSource || latestSource.updatedAt !== source.updatedAt) {
      fail('来源流程已归档或发生变化，请重新读取后再复制', 'DEPENDENCY_CONFLICT', 409);
    }
    assertProjectResourceReadable(requireAuthorizationActor(actor), source.projectId, '来源流程不存在');
    return copied;
  })();
}

export function archiveTemplate(id: string, actor: Actor, input: JsonObject = {}) {
  if (Object.keys(input).some((key) => key !== 'expectedUpdatedAt')) fail('流程归档不能提交未声明字段');
  const template = row<{ projectId: string; updatedAt: string }>('SELECT project_id AS projectId, updated_at AS updatedAt FROM work_item_templates WHERE id=? AND deleted_at IS NULL', id);
  if (!template) notFound('模板不存在');
  assertExpectedUpdatedAt(input, template.updatedAt, '流程');
  if (row('SELECT 1 FROM projects WHERE id=? AND default_template_id=?', template.projectId, id)) fail('项目默认流程不能归档，请先更换默认流程', 'DEPENDENCY_CONFLICT');
  const activeCount = row<{ count: number }>('SELECT COUNT(*) AS count FROM work_item_templates WHERE project_id=? AND deleted_at IS NULL', template.projectId)?.count || 0;
  if (activeCount <= 1) fail('项目至少需要保留一个有效流程', 'DEPENDENCY_CONFLICT');
  const archivedAt = nextUpdatedAt(template.updatedAt);
  sqlite.transaction(() => {
    const changed = sqlite.prepare(`UPDATE work_item_templates SET deleted_at=?, updated_at=?
      WHERE id=? AND updated_at=? AND deleted_at IS NULL`).run(archivedAt, archivedAt, id, template.updatedAt);
    if (!changed.changes) fail('流程已被其他用户修改，请重新打开后再归档', 'STALE_WRITE', 409);
    if (row('SELECT 1 FROM projects WHERE id=? AND default_template_id=?', template.projectId, id)) {
      fail('项目默认流程不能归档，请先更换默认流程', 'DEPENDENCY_CONFLICT', 409);
    }
    const remaining = row<{ count: number }>('SELECT COUNT(*) AS count FROM work_item_templates WHERE project_id=? AND deleted_at IS NULL', template.projectId)?.count || 0;
    if (!remaining) fail('项目至少需要保留一个有效流程', 'DEPENDENCY_CONFLICT', 409);
    requireActiveProject(template.projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), template.projectId);
    audit(actor, 'archive', 'template', id, '归档流程设计');
  })();
  return { ok: true };
}

export function restoreTemplate(id: string, actor: Actor, input: JsonObject = {}) {
  const template = row<{ projectId: string; name: string; deletedAt: string; updatedAt: string }>(
    'SELECT project_id AS projectId, name, deleted_at AS deletedAt, updated_at AS updatedAt FROM work_item_templates WHERE id=? AND deleted_at IS NOT NULL', id,
  );
  if (!template) notFound('归档模板不存在');
  assertOptionalArchiveGeneration(input, template.deletedAt);
  assertUniqueTemplateName(template.projectId, template.name, id);
  const updatedAt = nextUpdatedAt(template.updatedAt);
  sqlite.transaction(() => {
    const changed = sqlite.prepare(`UPDATE work_item_templates SET deleted_at=NULL, updated_at=?
      WHERE id=? AND deleted_at=? AND updated_at=?`).run(updatedAt, id, template.deletedAt, template.updatedAt);
    if (!changed.changes) fail('归档流程已变化，请刷新后再恢复', 'STALE_WRITE', 409);
    requireActiveProject(template.projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), template.projectId);
    audit(actor, 'restore', 'template', id, '恢复流程设计');
  })();
  return listTemplates(template.projectId, true).find((item: any) => item.id === id);
}

function activeTemplateItems(templateId: string) {
  return rows<{ id: string; title: string; sortOrder: number; startOffsetDays: number; durationDays: number; milestoneLabel: string | null }>(`SELECT id, title,
    sort_order AS sortOrder, start_offset_days AS startOffsetDays, duration_days AS durationDays, milestone_label AS milestoneLabel,kind,arrangement,arrangement_anchor AS arrangementAnchor,confirmation_mode AS confirmationMode
    FROM template_items WHERE template_id=? AND deleted_at IS NULL AND kind='work' ORDER BY sort_order`, templateId);
}

function applyTemplateInternal(requirementId: string, templateId: string, baseStart: string, deferAnalysis=false) {
  const createdIds: string[] = [];
  const items = activeTemplateItems(templateId);
  if (!items.length && !row("SELECT 1 FROM template_items WHERE template_id=? AND deleted_at IS NULL AND kind='milestone' LIMIT 1", templateId)) fail('模板没有可用元素');
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
    const workId = randomUUID(); createdIds.push(workId);
    insert.run(workId, requirementId, item.id, item.title, item.milestoneLabel, plan.plannedStart, plan.plannedEnd, nextOrder++, now, now);
  }
  instantiateTemplateGraph(requirementId, templateId, createdIds, baseStart, deferAnalysis);
}

function syncStoredRequirementState(requirementId: string, updatedAt = nowIso(), incrementVersion = true, expectedVersion?: number) {
  const requirement = row<RequirementRecord>(`${requirementSelect} WHERE r.id=?`, requirementId);
  if (!requirement) notFound('需求不存在');
  const workItems = getWorkItems(requirementId);
  const metrics = deriveRequirementMetrics(requirement, workItems, todayIso(), config.highRiskDelayDays);
  const acceptedAt = metrics.status === 'completed' ? requirement.acceptedAt : null;
  const changed = sqlite.prepare(`UPDATE requirements SET status=?, progress=?, planned_start=?, planned_end=?, risk_level=?, accepted_at=?,
    accepted_by_account_id=CASE WHEN ? IS NULL THEN NULL ELSE accepted_by_account_id END,
    version=version+?, updated_at=? WHERE id=? AND deleted_at IS NULL${expectedVersion === undefined ? '' : ' AND version=?'}`).run(
    metrics.status, metrics.progress, metrics.plannedStart, metrics.plannedEnd, metrics.riskLevel, acceptedAt, acceptedAt,
    incrementVersion ? 1 : 0, updatedAt, requirementId, ...(expectedVersion === undefined ? [] : [expectedVersion]),
  );
  assertVersionedWrite(changed, '需求');
  return metrics;
}

function updateStoredRequirementSchedule(requirementId: string) {
  return syncStoredRequirementState(requirementId);
}

type RequirementEventEntry = {
  eventType: string;
  content: string;
  workItemId?: string | null;
  workItemPercent?: number | null;
  supersedesId?: string | null;
};

function appendRequirementEvents(requirementId: string, entries: RequirementEventEntry[], actor: Actor, createdAt = nowIso(), knownProgress?: number) {
  const percent = knownProgress ?? row<{ progress: number }>('SELECT progress FROM requirements WHERE id=?', requirementId)?.progress ?? 0;
  const insert = sqlite.prepare(`INSERT INTO progress_updates
    (id, requirement_id, work_item_id, percent, work_item_percent, content, event_type, supersedes_id, created_by_account_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  return entries.map((entry) => {
    const id = randomUUID();
    insert.run(id, requirementId, entry.workItemId || null, percent, entry.workItemPercent ?? null,
      entry.content, entry.eventType, entry.supersedesId || null, actor.accountId || null, createdAt, createdAt);
    return id;
  });
}

function appendRequirementEvent(requirementId: string, eventType: string, content: string, actor: Actor, workItemId: string | null = null, workItemPercent: number | null = null, supersedesId: string | null = null, createdAt = nowIso()) {
  return appendRequirementEvents(requirementId, [{ eventType, content, workItemId, workItemPercent, supersedesId }], actor, createdAt)[0];
}

function shiftRequirementWorkItems(requirementId: string, currentAnchor: string, targetAnchor: string, updatedAt: string) {
  if (currentAnchor === targetAnchor) return;
  const items = rows<{ id: string; plannedStart: string | null; plannedEnd: string | null }>(
    `SELECT id, planned_start AS plannedStart, planned_end AS plannedEnd FROM work_items
      WHERE requirement_id=? AND status<>'cancelled'`, requirementId,
  );
  const update = sqlite.prepare('UPDATE work_items SET planned_start=?, planned_end=?, version=version+1, updated_at=? WHERE id=?');
  for (const item of items) {
    update.run(
      item.plannedStart ? rebaseBusinessDate(item.plannedStart, currentAnchor, targetAnchor) : null,
      item.plannedEnd ? rebaseBusinessDate(item.plannedEnd, currentAnchor, targetAnchor) : null,
      updatedAt,
      item.id,
    );
  }
}

export function createRequirement(input: JsonObject, actor: Actor, deferNormalization=false) {
  if(input.executionMode==='direct')return createDirectRequirement(input,actor,deferNormalization);
  if (Object.keys(input).some((key) => ![
    'projectId', 'title', 'priority', 'ownerId', 'background', 'acceptanceCriteria', 'referenceUrl',
    'plannedStart', 'plannedEnd', 'templateId','deliveryScope','executionMode','acceptanceOwnerId','durationDays','forecastEnd','unblockEstimate',
  ].includes(key))) fail('新建需求不能提交未声明字段');
  const commandFields = ['status', 'progress', 'acceptedAt', 'acceptedByAccountId', 'scheduleMode', 'confirmTemplateReset', 'expectedVersion', 'reason'];
  if (commandFields.some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    fail('新建需求不能提交状态、进度、验收、排期模式、重选确认或版本字段');
  }
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
    validateDeliveryFields(projectId,input,actor);
    sqlite.prepare('UPDATE requirements SET delivery_scope=?,acceptance_owner_id=? WHERE id=?').run(input.deliveryScope||'committed',input.acceptanceOwnerId||null,id);
    if (plannedStart && templateId) applyTemplateInternal(id, templateId, plannedStart, deferNormalization);
    else if(templateId&&input.executionMode==='work_items'){applyTemplateInternal(id,templateId,todayIso(),deferNormalization);sqlite.prepare('UPDATE work_items SET planned_start=NULL,planned_end=NULL WHERE requirement_id=?').run(id);}
    updateStoredRequirementSchedule(id);
    sqlite.prepare('UPDATE requirements SET dependencies_reviewed_at=? WHERE id=?').run(now,id);
    requirementOwner(projectId, ownerId, true);
    requireActiveProject(projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), projectId);
    audit(actor, 'create', 'requirement', id, plannedStart ? `创建需求并生成工作项：${title}` : `创建待规划需求：${title}`);
  });
  tx();
  return getRequirement(id, false, !deferNormalization);
}

function changeRequirement(id: string, input: JsonObject, actor: Actor, deferAnalysis=false) {
  const current = getRequirement(id, false, !deferAnalysis);
  assertExpectedVersion(input, current.version);
  if (['completed', 'cancelled'].includes(current.status)) {
    fail('已完成或已取消需求已锁定，请使用返工或纠错操作', 'TERMINAL_LOCKED');
  }
  if (current.status === 'pending_acceptance' && ['plannedStart', 'plannedEnd', 'scheduleMode', 'templateId', 'confirmTemplateReset']
    .some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    fail('待验收需求只能修改基本信息，不能调整排期或流程', 'TERMINAL_LOCKED');
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
    || Boolean(row(`SELECT 1 FROM progress_updates WHERE requirement_id=? AND event_type NOT IN ('note','correction') LIMIT 1`, id));
  if (input.ownerId !== undefined && !ownerId && hasExecution) {
    fail('需求已开始执行，只能更换负责人，不能清空负责人', 'DEPENDENCY_CONFLICT', 409);
  }
  let nextPlannedStart = current.plannedStart;
  let scheduleShift: { currentAnchor: string; targetAnchor: string } | null = null;
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
        scheduleShift = { currentAnchor, targetAnchor: targetDate };
        nextPlannedStart = current.plannedStart
          ? rebaseBusinessDate(current.plannedStart, currentAnchor, targetDate)
          : null;
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
  const informationChanged = title !== current.title || priority !== current.priority || ownerId !== current.ownerId
    || background !== current.background || acceptanceCriteria !== current.acceptanceCriteria || referenceUrl !== current.referenceUrl;
  const scheduleRequested = requestedPlannedStart !== undefined || requestedPlannedEnd !== undefined;
  const scheduleChanged = templateChanged || generateInitialPlan
    || Boolean(scheduleRequested && scheduleShift && scheduleShift.currentAnchor !== scheduleShift.targetAnchor);
  if (!informationChanged && !scheduleChanged) {
    sqlite.transaction(() => {
      requirementOwner(current.projectId, ownerId, true);
      requireActiveProject(current.projectId, true);
      assertProjectManager(requireAuthorizationActor(actor), current.projectId);
    })();
    return current;
  }
  const now = nowIso();
  const auditAction = templateChanged ? 'apply_template' : 'update';
  const auditSummary = templateChanged ? `重选流程并重建计划：${title}`
    : requestedPlannedStart !== undefined || requestedPlannedEnd !== undefined ? `调整需求排期：${title}` : `更新需求：${title}`;
  sqlite.transaction(() => {
    if (templateChanged && templateId) {
      sqlite.prepare('DELETE FROM work_items WHERE requirement_id=?').run(id);
      const changed = sqlite.prepare(`UPDATE requirements SET template_id=?, title=?, status='planning', planned_start=?,
        planned_end=NULL, progress=0, risk_level='low', priority=?, owner_id=?, background=?, acceptance_criteria=?, reference_url=?,
        accepted_at=NULL, accepted_by_account_id=NULL,
        version=version+1, updated_at=? WHERE id=? AND version=?`)
        .run(templateId, title, nextPlannedStart, priority, ownerId, background, acceptanceCriteria, referenceUrl, now, id, current.version);
      assertVersionedWrite(changed, '需求');
      applyTemplateInternal(id, templateId, nextPlannedStart!);
      updateStoredRequirementSchedule(id);
      requirementOwner(current.projectId, ownerId, true);
      requireActiveProject(current.projectId, true);
      assertProjectManager(requireAuthorizationActor(actor), current.projectId);
      audit(actor, auditAction, 'requirement', id, auditSummary);
      return;
    }
    if (scheduleShift) shiftRequirementWorkItems(id, scheduleShift.currentAnchor, scheduleShift.targetAnchor, now);
    const changed = sqlite.prepare(`UPDATE requirements SET title=?, priority=?, owner_id=?, background=?, acceptance_criteria=?, reference_url=?,
      planned_start=?, version=version+1, updated_at=? WHERE id=? AND version=?`)
      .run(title, priority, ownerId, background, acceptanceCriteria, referenceUrl, nextPlannedStart, now, id, current.version);
    assertVersionedWrite(changed, '需求');
    if (generateInitialPlan) applyTemplateInternal(id, current.templateId!, nextPlannedStart!);
    if (requestedPlannedStart !== undefined || requestedPlannedEnd !== undefined) updateStoredRequirementSchedule(id);
    else if (ownerId !== current.ownerId) syncStoredRequirementState(id, now, false);
    requirementOwner(current.projectId, ownerId, true);
    requireActiveProject(current.projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), current.projectId);
    audit(actor, auditAction, 'requirement', id, auditSummary);
  })();
  return getRequirement(id, false, !deferAnalysis);
}

export function updateRequirement(id: string, input: JsonObject, actor: Actor, deferAnalysis=false) {
  if(['deliveryScope','executionMode','acceptanceOwnerId','durationDays','forecastEnd','unblockEstimate',...coordinationKeys].some(k=>input[k]!==undefined)||getRequirement(id, false, !deferAnalysis).executionMode==='direct')return updateDeliveryRequirement(id,input,actor,false,deferAnalysis);
  const commandFields = ['status', 'progress', 'acceptedAt', 'acceptedByAccountId', 'plannedStart', 'plannedEnd', 'scheduleMode', 'templateId', 'confirmTemplateReset'];
  if (commandFields.some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    fail('需求状态、进度、验收、排期和流程不能通过普通编辑修改，请使用对应操作命令');
  }
  if (Object.keys(input).some((key) => ![
    'expectedVersion', 'title', 'priority', 'ownerId', 'background', 'acceptanceCriteria', 'referenceUrl',
  ].includes(key))) fail('需求编辑不能提交未声明字段');
  return changeRequirement(id, input, actor, deferAnalysis);
}

export function correctRequirement(id: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => ![
    'expectedVersion', 'reason', 'supersedesId', 'title', 'priority', 'ownerId',
    'background', 'acceptanceCriteria', 'referenceUrl',
  ].includes(key))) fail('需求纠错不能提交未声明字段');
  const current = getRequirement(id);
  assertExpectedVersion(input, current.version);
  assertTransition(current.status, ['completed', 'cancelled'], '纠错');
  if (['status', 'progress', 'acceptedAt', 'acceptedByAccountId', 'plannedStart', 'plannedEnd', 'scheduleMode', 'templateId', 'confirmTemplateReset']
    .some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    fail('需求纠错只能修正基本信息，不能修改状态、进度、验收、排期或流程');
  }
  const reason = requireText(input.reason, '纠错原因');
  const title = input.title === undefined ? current.title : requireLabel(input.title, '需求标题');
  const priority = input.priority === undefined ? current.priority : ensureEnum(input.priority, priorities, '优先级');
  const ownerId = input.ownerId === undefined ? current.ownerId : requirementOwner(current.projectId, input.ownerId);
  const background = input.background === undefined ? current.background : nullableText(input.background);
  const acceptanceCriteria = input.acceptanceCriteria === undefined ? current.acceptanceCriteria : nullableText(input.acceptanceCriteria);
  const referenceUrl = input.referenceUrl === undefined ? current.referenceUrl : nullableText(input.referenceUrl);
  const hasExecution = current.workItems!.some((item) => item.status !== 'not_started' || item.progress > 0 || item.actualStart)
    || Boolean(row(`SELECT 1 FROM progress_updates WHERE requirement_id=? AND event_type NOT IN ('note','correction','cancel') LIMIT 1`, id));
  if (input.ownerId !== undefined && !ownerId && hasExecution) {
    fail('需求已有执行记录，只能更换负责人，不能清空负责人', 'DEPENDENCY_CONFLICT', 409);
  }
  const supersedesId = nullableText(input.supersedesId);
  if (supersedesId && !row('SELECT id FROM progress_updates WHERE id=? AND requirement_id=? AND work_item_id IS NULL', supersedesId, id)) {
    fail('纠错引用记录不存在或不是当前需求的需求级记录');
  }
  const factsChanged = title !== current.title || priority !== current.priority || ownerId !== current.ownerId
    || background !== current.background || acceptanceCriteria !== current.acceptanceCriteria || referenceUrl !== current.referenceUrl;
  if (!factsChanged && !supersedesId) fail('没有需要纠错的需求信息，请修改字段或关联历史记录');
  const now = nowIso();
  sqlite.transaction(() => {
    const changed = sqlite.prepare(`UPDATE requirements SET title=?, priority=?, owner_id=?, background=?, acceptance_criteria=?, reference_url=?,
      version=version+1, updated_at=? WHERE id=? AND version=? AND deleted_at IS NULL`).run(
      title, priority, ownerId, background, acceptanceCriteria, referenceUrl, now, id, current.version,
    );
    assertVersionedWrite(changed, '需求');
    appendRequirementEvent(id, 'correction', reason, actor, null, null, supersedesId, now);
    audit(actor, 'correct', 'requirement', id, `纠错需求：${current.title}`);
    requireActiveProject(current.projectId, true);
    if (input.ownerId !== undefined && ownerId !== current.ownerId) requirementOwner(current.projectId, ownerId, true);
    assertProjectManager(requireAuthorizationActor(actor), current.projectId);
  })();
  return getRequirement(id);
}

export function rescheduleRequirement(id: string, input: JsonObject, actor: Actor) {
  if(getRequirement(id).executionMode==='direct')return rescheduleDirectRequirement(id,input,actor);
  if (input.plannedStart === undefined && input.plannedEnd === undefined) fail('请设置计划开始或计划完成日期');
  if (['status', 'progress', 'acceptedAt', 'acceptedByAccountId', 'templateId', 'title', 'priority', 'ownerId', 'background', 'acceptanceCriteria', 'referenceUrl']
    .some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    fail('排期命令不能修改需求信息、状态、进度、验收或流程');
  }
  if (Object.keys(input).some((key) => !['expectedVersion', 'scheduleMode', 'plannedStart', 'plannedEnd', 'reason'].includes(key))) {
    fail('排期命令不能提交未声明字段');
  }
  return changeRequirement(id, input, actor);
}

export function reselectRequirementTemplate(id: string, input: JsonObject, actor: Actor) {
  if(getRequirement(id).executionMode==='direct')fail('请通过拆分剩余工作预览并保存流程变化');
  if (Object.keys(input).some((key) => ![
    'templateId', 'expectedVersion', 'plannedStart', 'plannedEnd', 'scheduleMode', 'reason',
  ].includes(key))) fail('流程重选命令不能提交未声明字段');
  if (!nullableText(input.templateId)) fail('请选择要重新绑定的流程');
  if (['status', 'progress', 'acceptedAt', 'acceptedByAccountId', 'title', 'priority', 'ownerId', 'background', 'acceptanceCriteria', 'referenceUrl']
    .some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    fail('流程重选命令不能修改需求信息、状态、进度或验收信息');
  }
  return changeRequirement(id, { ...input, confirmTemplateReset: true }, actor);
}

export function archiveRequirement(id: string, input: JsonObject, actor: Actor, deferAnalysis=false) {
  if (Object.keys(input).some((key) => key !== 'expectedVersion')) fail('归档命令不能提交无关的需求字段');
  const current = getRequirement(id, false, !deferAnalysis);
  assertExpectedVersion(input, current.version);
  if (!['completed', 'cancelled'].includes(current.status)) fail('需求必须先完成验收或取消，才能归档', 'DEPENDENCY_CONFLICT');
  const now = nextUpdatedAt(current.updatedAt);
  sqlite.transaction(() => {
    const changed = sqlite.prepare(`UPDATE requirements SET deleted_at=?, version=version+1, updated_at=?
      WHERE id=? AND version=? AND deleted_at IS NULL`).run(now, now, id, current.version);
    if (!changed.changes) fail('需求已被其他用户修改，请重新打开后再归档', 'STALE_WRITE', 409);
    const activeIssues = row<{ count: number }>(`SELECT COUNT(*) AS count FROM issues WHERE requirement_id=? AND status<>'resolved'`, id)?.count || 0;
    if (activeIssues) fail(`需求仍有${activeIssues}个未解决问题，不能归档`, 'DEPENDENCY_CONFLICT', 409, { issues: activeIssues });
    requireActiveProject(current.projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), current.projectId);
    audit(actor, 'archive', 'requirement', id, `归档需求：${current.title}`);
  })();
  return { ok: true };
}

export function acceptRequirement(id: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => key !== 'expectedVersion' && key !== 'content')) fail('验收命令不能提交无关的需求字段');
  assertRequirementAcceptor(id,actor);
  const current = getRequirement(id);
  assertExpectedVersion(input, current.version);
  assertTransition(current.status, ['pending_acceptance'], '验收');
  const content = requireText(input.content, '验收说明')+(current.acceptanceOwnerId&&current.acceptanceOwnerId!==requireAuthorizationActor(actor).personId?'；项目经理代验，指定验收人：'+(current.acceptanceOwnerName||current.acceptanceOwnerId):''); const now = nowIso();
  sqlite.transaction(() => {
    if(sqlite.prepare('SELECT 1 FROM milestones WHERE requirement_id=? AND achieved_at IS NULL AND cancelled=0 LIMIT 1').get(id))fail('尚有未达成里程碑，请先完成交付或确认里程碑');
    const changed = sqlite.prepare(`UPDATE requirements SET status='completed', progress=100, accepted_at=?, accepted_by_account_id=?,
      version=version+1, updated_at=? WHERE id=? AND version=?`).run(now, actor.accountId || null, now, id, current.version);
    assertVersionedWrite(changed, '需求');
    appendRequirementEvent(id, 'accept', content, actor, null, null, null, now);
    audit(actor, 'accept', 'requirement', id, `验收需求：${current.title}`);settleMilestones(current.projectId,actor);
    requireActiveProject(current.projectId, true);
    assertRequirementAcceptor(id,actor);
  })();
  return getRequirement(id);
}

export function cancelRequirement(id: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => key !== 'expectedVersion' && key !== 'reason')) fail('取消命令不能提交无关的需求字段');
  const current = getRequirement(id);
  assertExpectedVersion(input, current.version);
  assertTransition(current.status, ['planning', 'not_started', 'in_progress', 'blocked', 'pending_acceptance'], '取消');
  const reason = requireText(input.reason, '取消原因'); const now = nowIso();
  sqlite.transaction(() => {
    sqlite.prepare(`UPDATE work_items SET status='cancelled', progress=min(progress,99), actual_end=NULL,
      blocked_at=NULL, blocked_reason=NULL, version=version+1, updated_at=?
      WHERE requirement_id=? AND status NOT IN ('completed','cancelled')`).run(now, id);
    const changed = sqlite.prepare(`UPDATE requirements SET status='cancelled', accepted_at=NULL, accepted_by_account_id=NULL,
      version=version+1, updated_at=? WHERE id=? AND version=?`).run(now, id, current.version);
    assertVersionedWrite(changed, '需求');
    syncStoredRequirementState(id, now, false);
    appendRequirementEvent(id, 'cancel', reason, actor, null, null, null, now);
    audit(actor, 'cancel', 'requirement', id, `取消需求：${current.title}`);
    requireActiveProject(current.projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), current.projectId);
  })();
  return getRequirement(id);
}

export function restoreRequirement(id: string, actor: Actor, input: JsonObject = {}) {
  const current = row<{ projectId: string; version: number; deletedAt: string; updatedAt: string }>(
    'SELECT project_id AS projectId, version, deleted_at AS deletedAt, updated_at AS updatedAt FROM requirements WHERE id=? AND deleted_at IS NOT NULL', id,
  );
  if (!current) notFound('归档需求不存在');
  assertOptionalArchiveGeneration(input, current.deletedAt);
  const updatedAt = nextUpdatedAt(current.updatedAt);
  sqlite.transaction(() => {
    const changed = sqlite.prepare(`UPDATE requirements SET deleted_at=NULL, version=version+1, updated_at=?
      WHERE id=? AND version=? AND deleted_at=? AND updated_at=?`).run(updatedAt, id, current.version, current.deletedAt, current.updatedAt);
    if (!changed.changes) fail('归档需求已变化，请刷新后再恢复', 'STALE_WRITE', 409);
    requireActiveProject(current.projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), current.projectId);
    audit(actor, 'restore', 'requirement', id, '恢复需求');
  })();
  return getRequirement(id);
}

export function applyTemplate(requirementId: string, input: JsonObject, actor: Actor) {
  if(getRequirement(requirementId).executionMode==='direct')fail('请通过拆分剩余工作预览并保存流程变化');
  if (Object.keys(input).some((key) => !['templateId', 'expectedVersion', 'reason'].includes(key))) {
    fail('补充流程命令不能提交未声明字段');
  }
  const requirement = getRequirement(requirementId);
  assertExpectedVersion(input, requirement.version);
  const templateId = requireText(input.templateId, '流程设计');
  if (['pending_acceptance', 'completed', 'cancelled'].includes(requirement.status)) fail('终态需求不能补充工作项', 'TERMINAL_LOCKED');
  if (requirement.workItems!.some((item) => item.status !== 'not_started') && !nullableText(input.reason)) fail('需求已开始执行，补充流程工作项时必须填写变更原因');
  if (!requirement.plannedStart) fail('需求缺少计划开始日期');
  if (!row('SELECT id FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL', templateId, requirement.projectId)) fail('流程设计不属于当前项目');
  const tx = sqlite.transaction(() => {
    applyTemplateInternal(requirementId, templateId, requirement.plannedStart!);
    syncStoredRequirementState(requirementId, nowIso(), true, requirement.version);
    requireActiveProject(requirement.projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), requirement.projectId);
    audit(actor, 'apply_template', 'requirement', requirementId, '从模板补充工作项');
  });
  tx();
  return getRequirement(requirementId);
}

export function previewRequirementPlan(requirementId: string, input: JsonObject) {
  if(getRequirement(requirementId).executionMode==='direct')fail('直接执行需求使用需求排期；分解工作请先拆分剩余工作');
  const requirement = getRequirement(requirementId, true);
  const templateId = requireText(input.templateId, '流程设计');
  if (!row('SELECT id FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL', templateId, requirement.projectId)) fail('流程设计不属于当前项目');
  const baseStart = requireDate(input.baseStart ?? requirement.plannedStart, '计划开始');
  if (businessDaysInclusive(baseStart, baseStart) !== 1) fail('计划开始需为工作日');
  const workItems = requirement.workItems || [];
  const entries = activeTemplateItems(templateId).map((item) => {
    const existing = workItems.find((work) => !isTerminalWorkItemStatus(work.status) && work.templateItemId === item.id)
      || workItems.find((work) => !isTerminalWorkItemStatus(work.status) && work.title === item.title)
      || workItems.find((work) => work.templateItemId === item.id)
      || workItems.find((work) => work.title === item.title);
    const terminal = Boolean(existing && ['completed', 'cancelled'].includes(existing.status));
    const proposed = plannedDatesFromOffset(baseStart, item.startOffsetDays, item.durationDays);
    return {
      templateItemId: item.id, workItemId: existing?.id || null, title: item.title,
      milestoneLabel: item.milestoneLabel,
      currentStart: existing?.plannedStart || null, currentEnd: existing?.plannedEnd || null,
      proposedStart: existing?.plannedStart || proposed.plannedStart, proposedEnd: existing?.plannedEnd || proposed.plannedEnd,
      willChange: !terminal && (!existing || !existing.plannedStart || !existing.plannedEnd),
      reason: terminal ? 'terminal' : !existing ? 'missing_item' : !existing.plannedStart || !existing.plannedEnd ? 'missing_plan' : 'unchanged',
    };
  });
  const pathRevision=row<{value:number}>('SELECT analysis_revision AS value FROM projects WHERE id=?',requirement.projectId)!.value;
  const templateUpdatedAt=row<{value:string}>('SELECT updated_at AS value FROM work_item_templates WHERE id=?',templateId)!.value;
  const preview = { requirementId, requirementVersion: requirement.version, pathRevision, templateUpdatedAt, asOfDate:todayIso(), templateId, baseStart, entries };
  // 校验实际展示的日期和流程内容，不持久化预览状态。
  const previewToken = createHash('sha256').update(JSON.stringify(preview)).digest('hex');
  return { ...preview, previewToken };
}

export function applyRequirementPlan(requirementId: string, input: JsonObject, actor: Actor) {
  if(getRequirement(requirementId).executionMode==='direct')fail('直接执行需求使用需求排期；分解工作请先拆分剩余工作');
  if (Object.keys(input).some((key) => ![
    'templateId', 'baseStart', 'expectedVersion', 'templateItemIds', 'reason', 'previewToken',
  ].includes(key))) fail('应用计划命令不能提交未声明字段');
  const requirement = getRequirement(requirementId);
  assertExpectedVersion(input, requirement.version);
  if (['pending_acceptance', 'completed', 'cancelled'].includes(requirement.status)) fail('终态需求不能修改工作计划', 'TERMINAL_LOCKED');
  const hasExecution = requirement.workItems!.some((item) => item.status !== 'not_started');
  if (hasExecution && !nullableText(input.reason)) fail('需求已开始执行，补全或调整计划时必须填写原因');
  const preview = previewRequirementPlan(requirementId, input);
  if (input.previewToken !== undefined && input.previewToken !== preview.previewToken) {
    fail('需求或流程已更新，原预览已失效，请重新预览后确认', 'STALE_WRITE', 409, undefined, requirement.version);
  }
  const selected = new Set(Array.isArray(input.templateItemIds) ? input.templateItemIds.map(String) : preview.entries.filter((item) => item.willChange).map((item) => item.templateItemId));
  for (const item of preview.entries) {
    if (selected.has(item.templateItemId) && item.willChange && item.proposedStart > item.proposedEnd) {
      fail(`工作项「${item.title}」补全后的开始日期晚于完成日期，请调整计划开始或先编辑该工作项`);
    }
  }
  const now = nowIso();
  const tx = sqlite.transaction(() => {
    const createdIds:string[]=[];
    if(previewRequirementPlan(requirementId,input).previewToken!==preview.previewToken)fail('排期预览已失效，请重新预览','STALE_WRITE',409);
    let nextOrder = (row<{ maxOrder: number | null }>('SELECT MAX(sort_order) AS maxOrder FROM work_items WHERE requirement_id=?', requirementId)?.maxOrder ?? -1) + 1;
    for (const item of preview.entries) {
      if (!selected.has(item.templateItemId) || !item.willChange) continue;
      if (item.workItemId) {
        sqlite.prepare(`UPDATE work_items SET planned_start=COALESCE(planned_start, ?), planned_end=COALESCE(planned_end, ?), version=version+1, updated_at=?
          WHERE id=? AND status NOT IN ('completed','cancelled')`)
          .run(item.proposedStart, item.proposedEnd, now, item.workItemId);
      } else {
        const createdId=randomUUID();createdIds.push(createdId);
        sqlite.prepare(`INSERT INTO work_items
          (id, requirement_id, template_item_id, title, milestone_label, status, planned_start, planned_end, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'not_started', ?, ?, ?, ?, ?)`).run(
          createdId, requirementId, item.templateItemId, item.title, item.milestoneLabel, item.proposedStart, item.proposedEnd, nextOrder++, now, now,
        );
      }
    }
    instantiateTemplateGraph(requirementId,preview.templateId,createdIds,preview.baseStart);
    const changed = sqlite.prepare('UPDATE requirements SET planned_start=?, version=version+1, updated_at=? WHERE id=? AND version=?')
      .run(preview.baseStart, now, requirementId, requirement.version);
    assertVersionedWrite(changed, '需求');
    syncStoredRequirementState(requirementId, now, false);
    requireActiveProject(requirement.projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), requirement.projectId);
    audit(actor, 'apply_plan', 'requirement', requirementId, `按模板补全计划：${selected.size}项`);
  });
  tx();
  return getRequirement(requirementId);
}

const workItemExecutionKeys = ['status', 'progress', 'actualStart', 'actualEnd', 'blockedAt', 'blockedReason'];

function collaboratorIdsFromInput(input: JsonObject, ownerId: string | null) {
  if (Object.prototype.hasOwnProperty.call(input, 'collaboratorIds') && Object.prototype.hasOwnProperty.call(input, 'assigneeIds')) {
    fail('协作人员与参与人员字段不能同时提交');
  }
  const value = input.collaboratorIds === undefined ? input.assigneeIds : input.collaboratorIds;
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail('协作人员格式不合法');
  const ids = [...new Set(value.map((id) => String(id).trim()).filter((id) => id && id !== ownerId))];
  let activeCount = 0;
  for (const batch of chunkValues(ids)) {
    const placeholders = batch.map(() => '?').join(',');
    activeCount += row<{ count: number }>(`SELECT COUNT(*) AS count FROM people WHERE id IN (${placeholders}) AND deleted_at IS NULL AND active=1`, ...batch)?.count || 0;
  }
  if (activeCount !== ids.length) fail('协作人员不存在或已停用');
  return ids;
}

function assertProjectAssignees(requirementId: string, ids: Array<string | null>, conflict = false) {
  const assigneeIds = [...new Set(ids.filter(Boolean) as string[])];
  if (!assigneeIds.length) return;
  const requirement = row<{ projectId: string }>('SELECT project_id AS projectId FROM requirements WHERE id=?', requirementId);
  if (!requirement) notFound('需求不存在');
  let count = 0;
  for (const batch of chunkValues(assigneeIds, 899)) {
    const placeholders = batch.map(() => '?').join(',');
    count += row<{ count: number }>(`SELECT COUNT(*) AS count FROM project_people pp
      JOIN people p ON p.id=pp.person_id
      WHERE pp.project_id=? AND pp.person_id IN (${placeholders}) AND pp.project_role IN ('member','manager')
        AND p.deleted_at IS NULL AND p.active=1`, requirement.projectId, ...batch)?.count || 0;
  }
  if (count !== assigneeIds.length) fail('负责人必须是当前项目中已启用的成员或项目经理', conflict ? 'DEPENDENCY_CONFLICT' : 'VALIDATION_ERROR', conflict ? 409 : 400);
}

function syncWorkItemCollaborators(workItemId: string, collaboratorIds: string[]) {
  sqlite.prepare('DELETE FROM work_item_collaborators WHERE work_item_id=?').run(workItemId);
  const insert = sqlite.prepare('INSERT INTO work_item_collaborators (work_item_id, person_id) VALUES (?, ?)');
  collaboratorIds.forEach((personId) => insert.run(workItemId, personId));
}

export function createWorkItem(requirementId: string, input: JsonObject, actor: Actor, deferAnalysis=false) {
  if(getRequirement(requirementId, false, !deferAnalysis).executionMode==='direct')fail('请先在草稿中选择拆分剩余工作，再整批保存');
  if (Object.keys(input).some((key) => ![
    'title', 'ownerId', 'collaboratorIds', 'assigneeIds', 'plannedStart', 'plannedEnd',
    'milestoneLabel', 'expectedVersion', 'reason',
  ].includes(key))) fail('新建工作项不能提交未声明字段');
  const requirement = getRequirement(requirementId, false, !deferAnalysis);
  assertExpectedVersion(input, requirement.version);
  if (workItemExecutionKeys.some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    fail('新建工作项不能提交状态、进度、实际日期或阻塞信息');
  }
  if (Object.prototype.hasOwnProperty.call(input, 'sortOrder')) {
    fail('新增工作项不能指定排序位置，请创建后使用工作项排序');
  }
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
    const reviewed = row<{ reviewedAt: string | null }>('SELECT dependencies_reviewed_at AS reviewedAt FROM requirements WHERE id=?', requirementId)?.reviewedAt;
    sqlite.prepare(`INSERT INTO work_items
      (id, requirement_id, title, owner_id, milestone_label, status, planned_start, planned_end, progress, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'not_started', ?, ?, 0, ?, ?, ?)`).run(
      id, requirementId, title, ownerId, milestone, plannedStart, plannedEnd, max + 1, now, now,
    );
    // Explicitly adding independent work preserves the previously checked dependency facts.
    if (reviewed) sqlite.prepare('UPDATE requirements SET dependencies_reviewed_at=? WHERE id=?').run(reviewed, requirementId);
    syncWorkItemCollaborators(id, collaboratorIds);
    syncStoredRequirementState(requirementId, now, true, requirement.version);
    requireActiveProject(requirement.projectId, true);
    assertRequirementOwnerOrManager(requireAuthorizationActor(actor), requirementId);
    audit(actor, 'create', 'work_item', id, `新增工作项：${title}${collaboratorIds.length ? `（${collaboratorIds.length + (ownerId ? 1 : 0)}人协作）` : ''}`);
    assertProjectAssignees(requirementId, [ownerId, ...collaboratorIds], true);
  })();
  return getRequirement(requirementId, false, !deferAnalysis).workItems!.find((item) => item.id === id);
}

export function updateWorkItem(id: string, input: JsonObject, actor: Actor, deferAnalysis=false) {
  const current = row<WorkItemRecord>(`${workItemSelect} WHERE w.id=?`, id);
  if (!current) notFound('工作项不存在');
  const requirement = getRequirement(current.requirementId, false, !deferAnalysis);
  assertExpectedVersion(input, current.version);
  if (isTerminalWorkItemStatus(current.status)) fail('已完成或已取消的工作项已锁定，请使用重开或纠错操作', 'TERMINAL_LOCKED');
  if (workItemExecutionKeys.some((key) => Object.prototype.hasOwnProperty.call(input, key))) fail('状态、进度和实际日期不能通过普通编辑修改，请使用对应操作命令');
  if (Object.keys(input).some((key) => ![
    'expectedVersion', 'title', 'ownerId', 'collaboratorIds', 'assigneeIds',
    'plannedStart', 'plannedEnd', 'sortOrder', 'milestoneLabel', 'reason',...coordinationKeys,
  ].includes(key))) fail('工作项编辑不能提交未声明字段');
  const title = input.title === undefined ? current.title : requireLabel(input.title, '工作项标题');
  const milestone = input.milestoneLabel === undefined ? current.milestoneLabel : milestoneLabel(input.milestoneLabel);
  const ownerId = input.ownerId === undefined ? current.ownerId : nullableText(input.ownerId);
  const collaboratorIds = collaboratorIdsFromInput(input, ownerId);
  const previousCollaboratorIds = rows<{ personId: string }>('SELECT person_id AS personId FROM work_item_collaborators WHERE work_item_id=?', id)
    .map((item) => item.personId);
  const nextCollaboratorIds = (collaboratorIds ?? previousCollaboratorIds).filter((personId) => personId !== ownerId);
  assertProjectAssignees(current.requirementId, [ownerId, ...nextCollaboratorIds]);
  const plannedStart = input.plannedStart === undefined ? current.plannedStart : nullableDate(input.plannedStart, '计划开始');
  const plannedEnd = input.plannedEnd === undefined ? current.plannedEnd : nullableDate(input.plannedEnd, '计划完成');
  if (plannedStart && businessDaysInclusive(plannedStart, plannedStart) !== 1) fail('计划开始需为工作日');
  if (plannedEnd && businessDaysInclusive(plannedEnd, plannedEnd) !== 1) fail('计划完成需为工作日');
  if (plannedStart && plannedEnd && plannedStart > plannedEnd) fail('计划完成日期不能早于计划开始日期');
  const scheduleChanged = plannedStart !== current.plannedStart || plannedEnd !== current.plannedEnd;
  const requirementHasExecution = Boolean(row(`SELECT 1 FROM work_items WHERE requirement_id=? AND status<>'not_started' LIMIT 1`, current.requirementId));
  const collaboratorsChanged = collaboratorIds !== undefined
    && [...collaboratorIds].sort().join(',') !== [...previousCollaboratorIds].sort().join(',');
  const structuralChanged = title !== current.title || milestone !== current.milestoneLabel || ownerId !== current.ownerId
    || collaboratorsChanged || scheduleChanged || input.sortOrder !== undefined && Number(input.sortOrder) !== current.sortOrder;
  if (requirementHasExecution && structuralChanged && !nullableText(input.reason)) fail('需求已开始执行，调整工作项结构、负责人或排期时必须填写变更原因');
  const coordinationChanged=coordinationKeys.some(k=>input[k]!==undefined);const coordination=coordinationChanged?validateCoordination(requirement.projectId,{...current,...input}):undefined;if(coordinationChanged&&current.status!=='blocked')fail('只有阻塞对象可以修改协调信息');
  if(coordinationChanged&&!structuralChanged)assertCoordinationAccess('work',id,input,actor);
  if (!structuralChanged&&!coordinationChanged) {
    sqlite.transaction(() => {
      requireActiveProject(requirement.projectId, true);
      if(coordinationChanged&&!structuralChanged)assertCoordinationAccess('work',id,input,actor);else assertWorkItemRequirementOwnerOrManager(requireAuthorizationActor(actor), id);
      assertProjectAssignees(current.requirementId, [ownerId, ...nextCollaboratorIds], true);
    })();
    return requirement.workItems!.find((item) => item.id === id);
  }
  const now = nowIso();
  sqlite.transaction(() => {
    const result = sqlite.prepare(`UPDATE work_items SET title=?, owner_id=?, milestone_label=?, planned_start=?, planned_end=?,
      sort_order=?, version=version+1, updated_at=? WHERE id=? AND version=?`).run(
      title, ownerId, milestone, plannedStart, plannedEnd,
      input.sortOrder === undefined ? current.sortOrder : Number(input.sortOrder), now, id, current.version,
    );
    assertVersionedWrite(result, '工作项');
    if(coordination)persistCoordination('work',id,requirement.projectId,{...coordination,reason:input.reason},actor);
    if (collaboratorIds !== undefined) syncWorkItemCollaborators(id, collaboratorIds);
    else if (ownerId) sqlite.prepare('DELETE FROM work_item_collaborators WHERE work_item_id=? AND person_id=?').run(id, ownerId);
    syncStoredRequirementState(current.requirementId, now, true, requirement.version);
    requireActiveProject(requirement.projectId, true);
    if(coordinationChanged&&!structuralChanged)assertCoordinationAccess('work',id,input,actor);else assertWorkItemRequirementOwnerOrManager(requireAuthorizationActor(actor), id);
    if (requirementHasExecution && structuralChanged) appendRequirementEvent(current.requirementId, 'correction', requireText(input.reason, '变更原因'), actor, id, current.progress, null, now);
    audit(actor, 'update', 'work_item', id, `更新工作项：${title}`);
    assertProjectAssignees(current.requirementId, [ownerId, ...nextCollaboratorIds], true);
  })();
  return getRequirement(current.requirementId, false, !deferAnalysis).workItems!.find((item) => item.id === id);
}

function validateWorkItemActualDates(actualStart: string | null, actualEnd: string | null, today = todayIso()) {
  if (actualStart && actualEnd && actualStart > actualEnd) fail('实际完成日期不能早于实际开始日期');
  if (actualStart && actualStart > today) fail('实际开始日期不能晚于今天，请先修正实际日期');
  if (actualEnd && actualEnd > today) fail('实际完成日期不能晚于今天');
}

function workItemEvent(id: string, action: 'start' | 'complete' | 'block' | 'unblock' | 'cancel', input: JsonObject, actor: Actor) {
  const allowedFields = new Set([
    'expectedVersion',
    ...(action === 'block'?coordinationKeys:[]),
    ...(action === 'complete' ? ['content'] : action === 'block' || action === 'cancel' ? ['reason'] : action === 'start' ? ['reason','expectedDependencyRevision'] : []),
  ]);
  if (Object.keys(input).some((key) => !allowedFields.has(key))) {
    const labels = { start: '开始', complete: '完成', block: '阻塞', unblock: '解除阻塞', cancel: '取消' } as const;
    fail(`${labels[action]}命令不能提交无关的工作项字段`);
  }
  const current = row<WorkItemRecord>(`${workItemSelect} WHERE w.id=?`, id);
  if (!current) notFound('工作项不存在');
  const parentRequirement = getRequirement(current.requirementId);
  assertExpectedVersion(input, current.version);
  const today = todayIso(); const now = nowIso();
  const labels = { start: '开始', complete: '完成', block: '阻塞', unblock: '解除阻塞', cancel: '取消' } as const;
  let eventContent = action === 'complete' ? nullableText(input.content) || '完成工作项'
    : action === 'block' ? requireText(input.reason, '阻塞原因')
      : action === 'cancel' ? requireText(input.reason, '取消原因')
        : action==='start' && nullableText(input.reason) ? requireText(input.reason,'执行例外原因') : `${labels[action]}工作项`;
  if (action === 'start') {
    assertTransition(current.status, ['not_started'], '开始');
    const requirement = getRequirement(current.requirementId);
    if(requirement.deliveryScope==='candidate')fail('请项目经理先将需求纳入交付');
    if(!requirement.ownerId||!requirement.ownerValid)fail('开始前请指定有效需求负责人','DEPENDENCY_CONFLICT',409);
    validateDeliveryFields(requirement.projectId,{ownerId:current.ownerId},actor);
    if (!current.ownerId) fail('开始工作项前请指定负责人');

  }
  if (action === 'complete') {
    assertTransition(current.status, ['in_progress'], '完成');
    validateWorkItemActualDates(current.actualStart, today, today);
  }
  if (action === 'block') assertTransition(current.status, ['in_progress'], '阻塞');
  if (action === 'unblock') assertTransition(current.status, ['blocked'], '解除阻塞');
  if (action === 'cancel') assertTransition(current.status, ['not_started', 'in_progress', 'blocked'], '取消');
  sqlite.transaction(() => {
    const acknowledged=action==='start'?assertStartConditions(id,current.requirementId,input):undefined;
    if(action==='block'||action==='unblock')adjustForecastClock(id,action,today);
    const changed = action === 'start'
      ? sqlite.prepare(`UPDATE work_items SET actual_start=?, status='in_progress', version=version+1, updated_at=? WHERE id=? AND version=?`).run(today, now, id, current.version)
      : action === 'complete'
        ? sqlite.prepare(`UPDATE work_items SET actual_end=?, progress=100, status='completed', blocked_at=NULL, blocked_reason=NULL, version=version+1, updated_at=? WHERE id=? AND version=?`).run(today, now, id, current.version)
        : action === 'block'
          ? sqlite.prepare(`UPDATE work_items SET blocked_at=?, blocked_reason=?, status='blocked', version=version+1, updated_at=? WHERE id=? AND version=?`).run(now, eventContent, now, id, current.version)
          : action === 'unblock'
            ? sqlite.prepare(`UPDATE work_items SET blocked_at=NULL, blocked_reason=NULL, status='in_progress', version=version+1, updated_at=? WHERE id=? AND version=?`).run(now, id, current.version)
            : sqlite.prepare(`UPDATE work_items SET status='cancelled', progress=min(progress,99), actual_end=NULL, blocked_at=NULL, blocked_reason=NULL, version=version+1, updated_at=? WHERE id=? AND version=?`).run(now, id, current.version);
    assertVersionedWrite(changed, '工作项');
    syncStoredRequirementState(current.requirementId, now, true, parentRequirement.version);
    requireActiveProject(parentRequirement.projectId, true);
    assertWorkItemParticipantOrManager(requireAuthorizationActor(actor), id);
    if(action==='block'){const v=validateCoordination(parentRequirement.projectId,input);persistCoordination('work',id,parentRequirement.projectId,v,actor);}
    const nextProgress = action === 'complete' ? 100 : current.progress;
    appendRequirementEvent(current.requirementId, action, eventContent, actor, id, nextProgress, null, now);
    if(acknowledged?.length)audit(actor,'confirm_start_conditions','work_item',id,'确认前置尾项：'+acknowledged.map(p=>p.title+' ['+p.id+']').join('、'));
    audit(actor, action, 'work_item', id, `${labels[action]}工作项：${current.title}`);settleMilestones(parentRequirement.projectId,actor);
  })();
  return getRequirement(current.requirementId).workItems!.find((item) => item.id === id);
}

export const startWorkItem = (id: string, input: JsonObject, actor: Actor) => workItemEvent(id, 'start', input, actor);
export const completeWorkItem = (id: string, input: JsonObject, actor: Actor) => workItemEvent(id, 'complete', input, actor);
export const blockWorkItem = (id: string, input: JsonObject, actor: Actor) => workItemEvent(id, 'block', input, actor);
export const unblockWorkItem = (id: string, input: JsonObject, actor: Actor) => workItemEvent(id, 'unblock', input, actor);
export const cancelWorkItem = (id: string, input: JsonObject, actor: Actor) => workItemEvent(id, 'cancel', input, actor);

function validatePlannedCompletion(requirement: RequirementRecord, items: WorkItemRecord[]) {
  assertTransition(requirement.status, ['planning', 'not_started', 'in_progress', 'blocked', 'pending_acceptance'], '补录完成');
  const history = new Set(rows<{ workItemId: string }>(
    `SELECT DISTINCT work_item_id AS workItemId FROM progress_updates
     WHERE requirement_id=? AND work_item_id IS NOT NULL AND event_type NOT IN ('note','correction')`, requirement.id,
  ).map((entry) => entry.workItemId));
  const today = todayIso();
  for (const item of items) {
    if (item.status !== 'not_started' || item.progress !== 0 || item.actualStart || item.actualEnd || item.blockedAt || history.has(item.id)) {
      fail(`“${item.title}”已有执行记录，请使用正常完成或实际日期修正`, 'DEPENDENCY_CONFLICT', 409);
    }
    const start = requireDate(item.plannedStart, `${item.title}计划开始`);
    const end = requireDate(item.plannedEnd, `${item.title}计划完成`);
    if (start > end) fail(`“${item.title}”计划完成日期不能早于开始日期`);
    if (end > today) fail(`“${item.title}”计划尚未结束，不能补录完成`, 'DEPENDENCY_CONFLICT', 409);
  }
}

function recordPlannedCompletions(requirement: RequirementRecord, items: WorkItemRecord[], content: string, actor: Actor, expectedRequirementVersion?: number) {
  const now = nowIso();
  if (!items.length) {
    if (expectedRequirementVersion !== undefined) syncStoredRequirementState(requirement.id, now, true, expectedRequirementVersion);
    return;
  }
  const update = sqlite.prepare(`UPDATE work_items SET status='completed', progress=100,
    actual_start=planned_start, actual_end=planned_end, blocked_at=NULL, blocked_reason=NULL,
    version=version+1, updated_at=? WHERE id=? AND version=?`);
  for (const item of items) assertVersionedWrite(update.run(now, item.id, item.version), '工作项');
  const metrics = syncStoredRequirementState(requirement.id, now, true, expectedRequirementVersion);
  appendRequirementEvents(requirement.id, items.map((item) => ({
    eventType: 'complete', content: `${content}（${item.plannedStart} 至 ${item.plannedEnd}）`, workItemId: item.id, workItemPercent: 100,
  })), actor, now, metrics.progress);
  recordAudits(actor, items.map((item) => ({
    action: 'complete', entityType: 'work_item', entityId: item.id,
    summary: `按计划补录完成：${item.title}`, projectId: requirement.projectId,
  })));settleMilestones(requirement.projectId,actor);
}

export function completeWorkItemAsPlanned(id: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => key !== 'expectedVersion' && key !== 'content')) {
    fail('按期完成命令不能提交实际日期、进度或其他工作项字段');
  }
  const current = row<WorkItemRecord>(`${workItemSelect} WHERE w.id=?`, id);
  if (!current) notFound('工作项不存在');
  const requirement = getRequirement(current.requirementId);
  assertExpectedVersion(input, current.version);
  validatePlannedCompletion(requirement, [current]);
  const content = requireText(input.content ?? '历史补录，按计划完成', '补录说明');
  sqlite.transaction(() => {
    recordPlannedCompletions(requirement, [current], content, actor, requirement.version);
    requireActiveProject(requirement.projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), requirement.projectId);
  })();
  return getRequirement(requirement.id).workItems!.find((item) => item.id === id);
}

export function completeRequirementAsPlanned(id: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => key !== 'expectedVersion' && key !== 'content')) {
    fail('按期完成命令不能提交实际日期、进度或其他需求字段');
  }
  const current = getRequirement(id);
  assertExpectedVersion(input, current.version);
  const active = (current.workItems || []).filter((item) => item.status !== 'cancelled');
  if (!active.length) fail('请先添加有效工作项并补齐计划日期', 'DEPENDENCY_CONFLICT', 409);
  const pending = active.filter((item) => item.status !== 'completed');
  if (!pending.length) fail('所有工作项均已完成，请使用正常验收并填写验收说明', 'DEPENDENCY_CONFLICT', 409);
  validatePlannedCompletion(current, pending);
  const content = requireText(input.content ?? '历史补录，按计划完成', '补录说明');
  return sqlite.transaction(() => {
    recordPlannedCompletions(current, pending, content, actor, current.version);
    return acceptRequirement(id, { expectedVersion: current.version + 1, content: `${content}；确认验收` }, actor);
  })();
}

export function reopenRequirementForMilestone(id:string,title:string,actor:Actor){
  const r=getRequirement(id);requireActiveProject(r.projectId,true);assertRequirementOwnerOrManager(requireAuthorizationActor(actor),id);
  if(r.status!=='completed')return;
  sqlite.prepare("UPDATE requirements SET status='pending_acceptance',accepted_at=NULL,accepted_by_account_id=NULL WHERE id=?").run(id);
  syncStoredRequirementState(id,nowIso(),true,r.version);
  appendRequirementEvent(id,'reopen','重新交付里程碑：'+title+'；原验收日期 '+(r.acceptedAt||'无'),actor);
}

export function reopenWorkItem(id: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => !['expectedVersion', 'reason', 'progress'].includes(key))) {
    fail('重开命令不能提交无关的工作项字段');
  }
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
  if (!current.actualStart && input.progress !== undefined && restoredProgress !== 0) {
    fail('无实际开始日期的工作项只能按0%重开，请重开后再开始并更新进度');
  }
  validateWorkItemActualDates(current.actualStart, null);
  const nextStatus = current.actualStart ? 'in_progress' : 'not_started'; const nextProgress = nextStatus === 'not_started' ? 0 : restoredProgress;
  const now = nowIso();
  sqlite.transaction(() => {
    const changed = sqlite.prepare(`UPDATE work_items SET status=?, progress=?, actual_end=NULL, blocked_at=NULL, blocked_reason=NULL,
      version=version+1, updated_at=? WHERE id=? AND version=?`).run(nextStatus, nextProgress, now, id, current.version);
    assertVersionedWrite(changed, '工作项');
    syncStoredRequirementState(current.requirementId, now, true, requirement.version);
    requireActiveProject(requirement.projectId, true);
    assertWorkItemRequirementOwnerOrManager(requireAuthorizationActor(actor), id);
    invalidateForecastReview('work',id);
    appendRequirementEvent(current.requirementId, 'reopen', reason, actor, id, nextProgress, null, now);
    audit(actor, 'reopen', 'work_item', id, `重开工作项：${current.title}`);
    assertProjectAssignees(current.requirementId, [requirement.ownerId, item.ownerId, ...item.collaborators.map((person) => person.id)], true);
  })();
  return getRequirement(current.requirementId).workItems!.find((item) => item.id === id);
}

export function correctWorkItem(id: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => ![
    'expectedVersion', 'reason', 'supersedesId', 'title', 'progress', 'actualStart', 'actualEnd',
  ].includes(key))) fail('工作项纠错不能提交完成说明或未声明字段');
  const current = row<WorkItemRecord>(`${workItemSelect} WHERE w.id=?`, id);
  if (!current) notFound('工作项不存在');
  const requirement = getRequirement(current.requirementId);
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
  validateWorkItemActualDates(actualStart, actualEnd);
  const cancellationHistory = current.status === 'cancelled'
    ? getCancellationHistory([current], new Map([[requirement.id, requirement.status]]))
    : null;
  if (actualStart && cancellationHistory) {
    const cancelledAt = cancellationHistory.workItemDates.get(current.id)!;
    if (actualStart > cancelledAt) fail(`实际开始日期不能晚于取消日期（${cancelledAt}）`);
  }
  const supersedesId = nullableText(input.supersedesId);
  if (supersedesId && !row('SELECT id FROM progress_updates WHERE id=? AND requirement_id=? AND work_item_id=?', supersedesId, current.requirementId, id)) {
    fail('纠错引用记录不存在或不属于当前工作项');
  }
  const title = input.title === undefined ? current.title : requireLabel(input.title, '工作项标题');
  const factsChanged = title !== current.title || progress !== current.progress
    || actualStart !== current.actualStart || actualEnd !== current.actualEnd;
  if (!factsChanged && !supersedesId) fail('没有需要纠错的工作项信息，请修改字段或关联历史记录');
  const now = nowIso();
  // 旧取消数据可能没有取消事件，只能以原 updated_at 推断取消日期。此时保留该时间戳，避免一次纠错把取消上限推迟到今天。
  const itemUpdatedAt = cancellationHistory?.inferredWorkItemIds.has(current.id) ? current.updatedAt : now;
  sqlite.transaction(() => {
    const changed = sqlite.prepare(`UPDATE work_items SET title=?, actual_start=?, actual_end=?, progress=?, version=version+1, updated_at=? WHERE id=? AND version=?`)
      .run(title, actualStart, actualEnd, progress, itemUpdatedAt, id, current.version);
    assertVersionedWrite(changed, '工作项');
    syncStoredRequirementState(current.requirementId, now, true, requirement.version);
    requireActiveProject(requirement.projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), requirement.projectId);
    appendRequirementEvent(current.requirementId, 'correction', reason, actor, id, progress, supersedesId, now);
    audit(actor, 'correct', 'work_item', id, `纠错工作项：${current.title}`);
  })();
  return getRequirement(current.requirementId).workItems!.find((item) => item.id === id);
}

export function deleteWorkItem(id: string, input: JsonObject, actor: Actor, deferAnalysis=false) {
  if (Object.keys(input).some((key) => key !== 'expectedVersion')) fail('删除命令不能提交无关的工作项字段');
  const current = row<WorkItemRecord>(`${workItemSelect} WHERE w.id=?`, id);
  if (!current) notFound('工作项不存在');
  const requirement = getRequirement(current.requirementId, false, !deferAnalysis);
  assertExpectedVersion(input, current.version);
  if (['pending_acceptance', 'completed', 'cancelled'].includes(requirement.status)) fail('当前需求已锁定，不能删除工作项', 'TERMINAL_LOCKED');
  if (!canDeleteWorkItem(current, Boolean(row('SELECT 1 FROM progress_updates WHERE work_item_id=? LIMIT 1', id)))) {
    fail('只有未开始、0%且无执行信息和进展历史的工作项可以删除，其他工作项请使用取消', 'DEPENDENCY_CONFLICT');
  }
  sqlite.transaction(() => {
    if(row('SELECT 1 FROM dependency_edges WHERE source_work_item_id=? OR target_work_item_id=? LIMIT 1',id,id))fail('工作项仍有交付依赖，请先在路径分析中移除关联','DEPENDENCY_CONFLICT');
    sqlite.prepare('UPDATE milestones SET legacy_work_item_id=NULL WHERE legacy_work_item_id=?').run(id);
    const deleted = sqlite.prepare('DELETE FROM work_items WHERE id=? AND version=?').run(id, current.version);
    assertVersionedWrite(deleted, '工作项');
    syncStoredRequirementState(current.requirementId, nowIso(), true, requirement.version);
    requireActiveProject(requirement.projectId, true);
    assertRequirementOwnerOrManager(requireAuthorizationActor(actor), current.requirementId);
    audit(actor, 'delete', 'work_item', id, `删除工作项：${current.title}`, requirement.projectId);
  })();
  return { ok: true };
}

export function reorderWorkItems(requirementId: string, ids: string[], actor: Actor, input: JsonObject = {}) {
  if (Object.keys(input).some((key) => !['ids', 'reason', 'expectedVersion'].includes(key))) {
    fail('工作项排序不能提交未声明字段');
  }
  const requirement = getRequirement(requirementId); assertExpectedVersion(input, requirement.version);
  if (['pending_acceptance', 'completed', 'cancelled'].includes(requirement.status)) fail('当前需求已锁定，不能调整工作项顺序', 'TERMINAL_LOCKED');
  const currentIds = requirement.workItems!.map((item) => item.id);
  if (ids.length !== currentIds.length || new Set(ids).size !== ids.length
    || ids.some((id) => !currentIds.includes(id))) {
    fail('工作项顺序必须包含当前需求的全部工作项，且不能重复');
  }
  const workItemsById = new Map(requirement.workItems!.map((item) => [item.id, item]));
  const movedItems = ids.map((id, index) => ({ item: workItemsById.get(id)!, index }))
    .filter(({ item, index }) => item.sortOrder !== index);
  if (!movedItems.length) {
    sqlite.transaction(() => {
      requireActiveProject(requirement.projectId, true);
      assertRequirementOwnerOrManager(requireAuthorizationActor(actor), requirementId);
    })();
    return requirement.workItems;
  }
  const hasExecution = requirement.workItems!.some((item) => item.status !== 'not_started');
  if (hasExecution && !nullableText(input.reason)) fail('需求已开始执行，调整顺序时必须填写变更原因');
  const reason = hasExecution ? requireText(input.reason, '变更原因') : null;
  const now = nowIso();
  const tx = sqlite.transaction(() => {
    const update = sqlite.prepare(`UPDATE work_items SET sort_order=?, version=version+1, updated_at=?
      WHERE id=? AND requirement_id=? AND sort_order=? AND version=?`);
    for (const { item, index } of movedItems) {
      assertVersionedWrite(update.run(index, now, item.id, requirementId, item.sortOrder, item.version), '工作项');
    }
    syncStoredRequirementState(requirementId, now, true, requirement.version);
    requireActiveProject(requirement.projectId, true);
    assertRequirementOwnerOrManager(requireAuthorizationActor(actor), requirementId);
    if (reason) appendRequirementEvent(requirementId, 'correction', reason, actor, null, null, null, now);
    audit(actor, 'reorder', 'work_item', requirementId, '调整工作项顺序', requirement.projectId);
  });
  tx();
  return getRequirement(requirementId).workItems;
}

export function addProgress(requirementId: string, input: JsonObject, actor: Actor) {
  if(input.requirementPercent!==undefined){if(input.workItemId||input.workItemPercent!==undefined)fail('需求进度不能与工作项进度同时提交');return executeDirectRequirement(requirementId,'progress',{expectedVersion:input.expectedVersion,content:input.content,progress:input.requirementPercent},actor);}
  if (Object.keys(input).some((key) => !['content', 'workItemId', 'workItemPercent', 'expectedVersion'].includes(key))) {
    fail('进展命令不能提交无关的需求或工作项字段');
  }
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
      const changed = sqlite.prepare(`UPDATE work_items SET progress=?, version=version+1, updated_at=? WHERE id=? AND version=?`)
        .run(workItemPercent, now, workItemId, workItem!.version);
      assertVersionedWrite(changed, '工作项');
      syncStoredRequirementState(requirementId, now, true, requirement.version);
    }
    const percent = row<{ progress: number }>('SELECT progress FROM requirements WHERE id=?', requirementId)?.progress ?? requirement.progress;
    sqlite.prepare(`INSERT INTO progress_updates (id, requirement_id, work_item_id, percent, work_item_percent, content, event_type, created_by_account_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, requirementId, workItemId, percent, workItemPercent, content, workItemPercent === null ? 'note' : 'progress', actor.accountId || null, now, now);
    const latestRequirement = row<{ status: string; deletedAt: string | null }>(
      'SELECT status, deleted_at AS deletedAt FROM requirements WHERE id=?', requirementId,
    );
    if (!latestRequirement || latestRequirement.deletedAt) fail('需求已归档，不能追加进展', 'DEPENDENCY_CONFLICT', 409);
    if (workItemId) {
      const latestItem = row<{ status: string }>('SELECT status FROM work_items WHERE id=? AND requirement_id=?', workItemId, requirementId);
      if (!latestItem) notFound('关联工作项不存在');
      if (isTerminalWorkItemStatus(latestItem.status)) fail('已完成或已取消工作项不能再提交进展', 'TERMINAL_LOCKED', 409);
    } else if (['pending_acceptance', 'completed', 'cancelled'].includes(latestRequirement.status)) {
      fail('终态需求已锁定，不能追加进展', 'TERMINAL_LOCKED', 409);
    }
    requireActiveProject(requirement.projectId, true);
    assertCanAddProgress(requireAuthorizationActor(actor), requirementId, workItemId);
    const result = getRequirement(requirementId);
    audit(actor, 'create', 'progress', id, `追加进展：${result.progress}% ${content.slice(0, 50)}`);
    return result;
  });
  return tx();
}

export function updateProgress(id: string, input: JsonObject, _actor: Actor) {
  if (Object.keys(input).some((key) => !['content', 'workItemId', 'workItemPercent', 'expectedVersion'].includes(key))) {
    fail('进展历史修改不能提交未声明字段');
  }
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

function assertArchiveGeneration(input: JsonObject, currentDeletedAt: string) {
  const expectedDeletedAt = requireText(input.expectedDeletedAt, '归档版本');
  if (expectedDeletedAt !== currentDeletedAt) {
    fail('归档内容已被恢复或重新归档，请刷新后重试', 'STALE_WRITE', 409, { deletedAt: currentDeletedAt });
  }
}

function assertOptionalArchiveGeneration(input: JsonObject, currentDeletedAt: string) {
  if (Object.keys(input).some((key) => key !== 'expectedDeletedAt')) fail('归档恢复不能提交未声明字段');
  if (input.expectedDeletedAt === undefined) return;
  assertArchiveGeneration(input, currentDeletedAt);
}

function lockArchiveGeneration(table: 'projects' | 'requirements' | 'people' | 'work_item_templates', id: string, deletedAt: string) {
  const locked = sqlite.prepare(`UPDATE ${table} SET updated_at=updated_at WHERE id=? AND deleted_at=?`).run(id, deletedAt);
  if (!locked.changes) fail('归档内容已被恢复或重新归档，请刷新后重试', 'STALE_WRITE', 409);
  const latest = row<{ deletedAt: string | null }>(`SELECT deleted_at AS deletedAt FROM ${table} WHERE id=?`, id);
  if (latest?.deletedAt !== deletedAt) fail('归档内容已被恢复或重新归档，请刷新后重试', 'STALE_WRITE', 409, { deletedAt: latest?.deletedAt || null });
}

export function permanentlyDeleteArchive(entity: ArchiveEntity, id: string, actor: Actor, input: JsonObject = {}) {
  if (Object.keys(input).some((key) => key !== 'confirmName' && key !== 'expectedDeletedAt')) {
    fail('永久删除不能提交未声明字段');
  }
  const tx = sqlite.transaction(() => {
    if (entity === 'projects') {
      const project = row<{ name: string; deletedAt: string }>('SELECT name, deleted_at AS deletedAt FROM projects WHERE id=? AND deleted_at IS NOT NULL', id);
      if (!project) {
        if (row('SELECT id FROM projects WHERE id=?', id)) fail('只能永久删除已归档项目');
        notFound('归档项目不存在');
      }
      assertArchiveGeneration(input, project.deletedAt);
      if (requireLabel(input.confirmName, '确认名称') !== canonicalizeLabel(project.name)) fail('确认名称与项目名称不一致');
      lockArchiveGeneration('projects', id, project.deletedAt);
      const requirementCount = row<{ count: number }>('SELECT COUNT(*) AS count FROM requirements WHERE project_id=?', id)?.count || 0;
      sqlite.prepare('DELETE FROM requirements WHERE project_id=?').run(id);
      const deleted = sqlite.prepare('DELETE FROM projects WHERE id=? AND deleted_at=?').run(id, project.deletedAt);
      if (!deleted.changes) fail('归档项目已变化，请刷新后重试', 'STALE_WRITE', 409);
      if (isSampleProjectId(id)) deleteOrReleaseSamplePeople(sqlite, nowIso());
      assertCurrentAdmin(actor);
      audit(actor, 'permanent_delete', 'project', id, `永久删除归档项目：${project.name}（含${requirementCount}条需求）`, null);
      return { ok: true };
    }
    if (entity === 'requirements') {
      const requirement = row<{ title: string; projectId: string; deletedAt: string }>('SELECT title, project_id AS projectId, deleted_at AS deletedAt FROM requirements WHERE id=? AND deleted_at IS NOT NULL', id);
      if (!requirement) {
        if (row('SELECT id FROM requirements WHERE id=?', id)) fail('只能永久删除已归档需求');
        notFound('归档需求不存在');
      }
      assertArchiveGeneration(input, requirement.deletedAt);
      if (requireLabel(input.confirmName, '确认名称') !== canonicalizeLabel(requirement.title)) fail('确认名称与需求名称不一致');
      lockArchiveGeneration('requirements', id, requirement.deletedAt);
      const deleted = sqlite.prepare('DELETE FROM requirements WHERE id=? AND deleted_at=?').run(id, requirement.deletedAt);
      if (!deleted.changes) fail('归档需求已变化，请刷新后重试', 'STALE_WRITE', 409);
      assertCurrentAdmin(actor);
      audit(actor, 'permanent_delete', 'requirement', id, `永久删除归档需求：${requirement.title}`, requirement.projectId);
      return { ok: true };
    }
    if (entity === 'people') {
      const person = row<{ name: string; deletedAt: string }>('SELECT name, deleted_at AS deletedAt FROM people WHERE id=? AND deleted_at IS NOT NULL', id);
      if (!person) {
        if (row('SELECT id FROM people WHERE id=?', id)) fail('只能永久删除已归档人员');
        notFound('归档人员不存在');
      }
      assertArchiveGeneration(input, person.deletedAt);
      lockArchiveGeneration('people', id, person.deletedAt);
      const references = row<{ count: number }>(`SELECT
        (SELECT COUNT(*) FROM requirements WHERE owner_id=?) +
        (SELECT COUNT(*) FROM work_items WHERE owner_id=?) +
        (SELECT COUNT(*) FROM work_item_collaborators WHERE person_id=?) +
        (SELECT COUNT(*) FROM issues WHERE owner_id=?) AS count`, id, id, id, id)?.count || 0;
      if (references) fail(`该人员仍被${references}条历史业务记录引用，只能保留归档`, 'DEPENDENCY_CONFLICT', 409, { references });
      sqlite.prepare('DELETE FROM accounts WHERE person_id=? AND is_builtin=0').run(id);
      const deleted = sqlite.prepare('DELETE FROM people WHERE id=? AND deleted_at=?').run(id, person.deletedAt);
      if (!deleted.changes) fail('归档人员已变化，请刷新后重试', 'STALE_WRITE', 409);
      assertCurrentAdmin(actor);
      audit(actor, 'permanent_delete', 'person', id, `永久删除归档人员：${person.name}`);
      return { ok: true };
    }
    if (entity === 'templates') {
      const template = row<{ name: string; projectId: string; deletedAt: string }>('SELECT name, project_id AS projectId, deleted_at AS deletedAt FROM work_item_templates WHERE id=? AND deleted_at IS NOT NULL', id);
      if (!template) {
        if (row('SELECT id FROM work_item_templates WHERE id=?', id)) fail('只能永久删除已归档流程');
        notFound('归档模板不存在');
      }
      assertArchiveGeneration(input, template.deletedAt);
      lockArchiveGeneration('work_item_templates', id, template.deletedAt);
      const references = row<{ count: number }>(`SELECT
        (SELECT COUNT(*) FROM requirements WHERE template_id=?) +
        (SELECT COUNT(*) FROM work_items WHERE template_item_id IN (SELECT id FROM template_items WHERE template_id=?)) AS count`, id, id)?.count || 0;
      if (references) fail(`该流程仍被${references}条历史业务记录引用，只能保留归档快照`, 'DEPENDENCY_CONFLICT', 409, { references });
      const deleted = sqlite.prepare('DELETE FROM work_item_templates WHERE id=? AND deleted_at=?').run(id, template.deletedAt);
      if (!deleted.changes) fail('归档流程已变化，请刷新后重试', 'STALE_WRITE', 409);
      assertCurrentAdmin(actor);
      audit(actor, 'permanent_delete', 'template', id, `永久删除归档模板：${template.name}`, template.projectId);
      return { ok: true };
    }
    fail('归档类型不合法');
  });
  return tx();
}

export { issueStatuses, priorities, requirementStatuses, riskLevels, workItemStatuses };
