

import { randomUUID } from 'node:crypto';

import { getDatabaseContext } from '../database-context';

import type { Actor } from '../auth';

import { createAccountForPerson } from '../accounts';

import { projectRoles, type ProjectRole } from '../../shared/domain';

import { normalizeSearchText } from '../../shared/search';

import { AppError, fail, notFound } from '../errors';

import { assertProjectManager, requireAuthorizationActor } from '../authorization';

import { recordAudit as audit } from './audit';

import { assertExpectedUpdatedAt, ensureEnum, nextUpdatedAt, nowIso, nullableLabel, nullableText, requireActiveProject, requireLabel, row, rows, type JsonObject } from './support';

import { assertCurrentAdmin } from './admin-guard';

import { assertOptionalArchiveGeneration } from './archive-guards';

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
  // 账号增长后旧统计可能仍选择逐人扫描账号表，使用既有人员唯一索引保持单次查找。
  const candidates = rows<{
    id: string; name: string; jobTitle: string | null; username: string | null; active: number; deletedAt: string | null;
    existingProjectRole: ProjectRole | null; searchRank: number;
  }>(`SELECT p.id, p.name, p.job_title AS jobTitle, a.username,
      p.active, p.deleted_at AS deletedAt, pp.project_role AS existingProjectRole,
      MAX(search_score(p.name, ?) + 100,
        search_score(COALESCE(a.username, ''), ?) + 50,
        search_score(COALESCE(p.job_title, ''), ?)) AS searchRank
    FROM people p
    LEFT JOIN accounts a INDEXED BY idx_accounts_person ON a.person_id=p.id AND a.deleted_at IS NULL
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
    getDatabaseContext().sqlite.transaction(() => {
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
  getDatabaseContext().sqlite.transaction(() => {
    if (current) {
      const changed = getDatabaseContext().sqlite.prepare(`UPDATE project_people SET project_role=?, updated_at=?
        WHERE project_id=? AND person_id=? AND updated_at IS ?`).run(projectRole, updatedAt, projectId, personId, current.updatedAt);
      if (!changed.changes) throw new AppError('项目成员关系已被其他用户修改，请刷新后重试', 409, 'STALE_WRITE');
    } else {
      getDatabaseContext().sqlite.prepare(`INSERT INTO project_people (project_id, person_id, project_role, created_at, updated_at)
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
  getDatabaseContext().sqlite.transaction(() => {
    const result = getDatabaseContext().sqlite.prepare('DELETE FROM project_people WHERE project_id=? AND person_id=? AND updated_at IS ?')
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
  getDatabaseContext().sqlite.transaction(() => {
    getDatabaseContext().sqlite.prepare('INSERT INTO people (id, name, job_title, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)')
      .run(id, name, nullableLabel(input.jobTitle, '岗位'), now, now);
    if (projectId) getDatabaseContext().sqlite.prepare('INSERT INTO project_people (project_id, person_id, created_at, updated_at) VALUES (?, ?, ?, ?)').run(projectId, id, now, now);
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
    getDatabaseContext().sqlite.transaction(() => {
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
  getDatabaseContext().sqlite.transaction(() => {
    const changed = getDatabaseContext().sqlite.prepare(`UPDATE people SET name=?, job_title=?, active=?, updated_at=?
      WHERE id=? AND updated_at=? AND deleted_at IS NULL`).run(
      name, jobTitle, active, updatedAt, id, current.updatedAt,
    );
    if (!changed.changes) fail('人员已被其他用户修改，请重新打开后再保存', 'STALE_WRITE', 409);
    if (linkedAccount && accountUpdatedAt) {
      const accountChanged = getDatabaseContext().sqlite.prepare(`UPDATE accounts SET status=?, session_version=session_version+1, updated_at=?
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
  getDatabaseContext().sqlite.transaction(() => {
    const changed = getDatabaseContext().sqlite.prepare(`UPDATE people SET deleted_at=?, active=0, updated_at=?
      WHERE id=? AND updated_at=? AND deleted_at IS NULL`).run(updatedAt, updatedAt, id, person.updatedAt);
    if (!changed.changes) fail('人员已被其他用户修改，请重新打开后再归档', 'STALE_WRITE', 409);
    if (linkedAccount && accountUpdatedAt) {
      const accountChanged = getDatabaseContext().sqlite.prepare(`UPDATE accounts SET status='disabled', session_version=session_version+1, updated_at=?
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
  getDatabaseContext().sqlite.transaction(() => {
    const changed = getDatabaseContext().sqlite.prepare(`UPDATE people SET deleted_at=NULL, active=1, updated_at=?
      WHERE id=? AND updated_at=? AND deleted_at=?`).run(updatedAt, id, person.updatedAt, person.deletedAt);
    if (!changed.changes) fail('归档人员已被其他用户修改，请重新读取后再恢复', 'STALE_WRITE', 409);
    if (account && !account.deletedAt && accountUpdatedAt) {
      const accountChanged = getDatabaseContext().sqlite.prepare(`UPDATE accounts SET status='active', session_version=session_version+1, updated_at=?
        WHERE id=? AND updated_at=? AND deleted_at IS NULL`).run(accountUpdatedAt, account.id, account.updatedAt);
      if (!accountChanged.changes) fail('关联账号已被其他用户修改，请重新读取后再恢复', 'STALE_WRITE', 409);
    } else if (!account) createAccountForPerson(id, person.name, true);
    assertCurrentAdmin(actor);
    audit(actor, 'restore', 'person', id, `恢复人员：${person.name}`);
  })();
  return listPeople(true).find((item: any) => item.id === id);
}
