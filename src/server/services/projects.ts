

import { randomUUID } from 'node:crypto';

import { getDatabaseContext } from '../database-context';

import type { Actor } from '../auth';

import { archiveUnusedSamplePeople, isSampleProjectId, restoreSamplePeople } from '../sample-project';

import { projectStatuses, type ProjectRole } from '../../shared/domain';
import type { Project } from '../../shared/api/projects';

import { fail, notFound } from '../errors';

import { assertProjectManager, requireAuthorizationActor } from '../authorization';

import { recordAudit as audit } from './audit';

import { assertExpectedUpdatedAt, ensureEnum, nowIso, nextUpdatedAt, nullableDate, nullableText, requireLabel, row, rows, type JsonObject } from './support';

import { assertCurrentAdmin } from './admin-guard';

import { createInitialProjectFlow } from './template-defaults';

import { assertOptionalArchiveGeneration } from './archive-guards';

export type ProjectRecord = Project & { guestVisible: boolean };

const projectSelect = `SELECT id, name, status, planned_start AS plannedStart, planned_end AS plannedEnd,
  default_template_id AS defaultTemplateId, guest_visible AS guestVisible, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt FROM projects`;

function withProjectMeta<T extends { id: string; guestVisible?: boolean }>(project: T): T & { isSample: boolean; guestVisible: boolean } {
  return { ...project, guestVisible: Boolean(project.guestVisible), isSample: isSampleProjectId(project.id) };
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

export function listWorkspaceProjects(includeDeleted: boolean, actor: Actor): ProjectRecord[] {
  const memberProjects = actor.type === 'guest' ? [] : listProjects(includeDeleted, actor);
  const memberIds = new Set(memberProjects.map(p => p.id));
  const publicProjects = rows<Omit<ProjectRecord, 'isSample'>>(`${projectSelect} WHERE guest_visible=1 AND deleted_at IS NULL ORDER BY created_at DESC`)
    .filter(p => !memberIds.has(p.id))
    .map(p => ({ ...withProjectMeta(p), defaultTemplateId: null, publicReadOnly: true, canManage: false }));
  return [...memberProjects, ...publicProjects];
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
  getDatabaseContext().sqlite.transaction(() => {
    getDatabaseContext().sqlite.prepare(`INSERT INTO projects (id, name, status, planned_start, planned_end, default_template_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`).run(id, name, status, plannedStart, plannedEnd, now, now);
    const defaultTemplateId = createInitialProjectFlow(id, now);
    getDatabaseContext().sqlite.prepare('UPDATE projects SET default_template_id=? WHERE id=?').run(defaultTemplateId, id);
    assertCurrentAdmin(actor);
    audit(actor, 'create', 'project', id, `创建项目：${name}`);
  })();
  return withProjectMeta(row<Omit<ProjectRecord, 'isSample'>>(`${projectSelect} WHERE id=?`, id)!);
}

export function updateProject(id: string, input: JsonObject, actor: Actor): ProjectRecord {
  if (Object.keys(input).some((key) => ![
    'name', 'plannedStart', 'plannedEnd', 'defaultTemplateId', 'status', 'expectedUpdatedAt', 'guestVisible',
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
  if (input.guestVisible !== undefined && typeof input.guestVisible !== 'boolean') fail('游客浏览开关必须为布尔值');
  const guestVisible = input.guestVisible === undefined ? Boolean(current.guestVisible) : input.guestVisible;
  const changedFields = guestVisible !== Boolean(current.guestVisible) || name !== current.name || status !== current.status || plannedStart !== current.plannedStart
    || plannedEnd !== current.plannedEnd || defaultTemplateId !== current.defaultTemplateId;
  if (!changedFields) {
    getDatabaseContext().sqlite.transaction(() => {
      if (defaultTemplateId && !row('SELECT id FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL', defaultTemplateId, id)) {
        fail('默认流程已被归档，请刷新后重新选择', 'DEPENDENCY_CONFLICT', 409);
      }
      assertProjectManager(requireAuthorizationActor(actor), id);
    })();
    return withProjectMeta(current);
  }
  const updatedAt = nextUpdatedAt(current.updatedAt);
  getDatabaseContext().sqlite.transaction(() => {
    const changed = getDatabaseContext().sqlite.prepare(`UPDATE projects SET name=?, status=?, planned_start=?, planned_end=?, default_template_id=?, guest_visible=?, updated_at=?
      WHERE id=? AND updated_at=? AND deleted_at IS NULL`).run(
      name, status,
      plannedStart, plannedEnd, defaultTemplateId, Number(guestVisible), updatedAt, id, current.updatedAt,
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
  getDatabaseContext().sqlite.transaction(() => {
    const changed = getDatabaseContext().sqlite.prepare(`UPDATE projects SET deleted_at=?, updated_at=?
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
    if (isSampleProjectId(id)) archiveUnusedSamplePeople(getDatabaseContext().sqlite, now, actor.accountId);
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
  getDatabaseContext().sqlite.transaction(() => {
    const changed = getDatabaseContext().sqlite.prepare(`UPDATE projects SET deleted_at=NULL, updated_at=?
      WHERE id=? AND deleted_at=? AND updated_at=?`).run(now, id, existing.deletedAt, existing.updatedAt);
    if (!changed.changes) fail('归档项目已变化，请刷新后再恢复', 'STALE_WRITE', 409);
    if (isSampleProjectId(id)) restoreSamplePeople(getDatabaseContext().sqlite, now);
    assertCurrentAdmin(actor);
    audit(actor, 'restore', 'project', id, '恢复项目');
  })();
  return withProjectMeta(row<Omit<ProjectRecord, 'isSample'>>(`${projectSelect} WHERE id=?`, id)!);
}
