import { startConditions } from './services/paths';
import { randomUUID } from 'node:crypto';
import { sqlite } from './database';
import { hashPassword, normalizeUsername, verifyPassword, type Actor } from './auth';
import { addCalendarDays, deriveWorkItemStatus, isOverdueByWorkday, startOfWeekIso, todayIso } from '../shared/domain';
import { canonicalizeLabel, textSafetyIssue } from '../shared/search';
import { isBusinessDay } from '../shared/workday';
import { listRequirements } from './services/requirements';
import { deriveRequirementActionReasons, deriveWorkItemActionReasons } from './services/actions';
import { AppError, type AppErrorCode } from './errors';
import { accountPersonAvailableSql } from './account-access';
import { assertExpectedUpdatedAt, chunkValues, nextUpdatedAt } from './services/support';
import { assertAdmin, requireAuthorizationActor } from './authorization';

type JsonObject = Record<string, unknown>;
const nowIso = () => new Date().toISOString();

function fail(message: string, statusCode = 400): never {
  const code: AppErrorCode = statusCode === 403
    ? 'FORBIDDEN'
    : statusCode === 404
      ? 'NOT_FOUND'
      : statusCode === 409
        ? 'DEPENDENCY_CONFLICT'
        : 'VALIDATION_ERROR';
  throw new AppError(message, statusCode, code);
}

function audit(actor: Actor, action: string, entityId: string | null, summary: string) {
  sqlite.prepare(`INSERT INTO audit_logs (id, actor_type, actor_id, action, entity_type, entity_id, summary, created_at)
    VALUES (?, ?, ?, ?, 'account', ?, ?, ?)`).run(randomUUID(), actor.type, actor.id, action, entityId, summary, nowIso());
}

function assertAccountPersonAvailable(personId: string | null) {
  if (!personId) return;
  if (!sqlite.prepare('SELECT 1 FROM people WHERE id=? AND active=1 AND deleted_at IS NULL').get(personId)) {
    fail('人员已停用或归档，请先恢复人员', 409);
  }
}

function assertActiveAdministratorRemains() {
  const active = sqlite.prepare(`SELECT 1 FROM accounts
    WHERE global_role='admin' AND status='active' AND deleted_at IS NULL LIMIT 1`).get();
  if (!active) fail('系统至少需要保留一个可用管理员', 409);
}

function assertCurrentAdministrator(actor: Actor, selfUpdateAccountId?: string) {
  if (selfUpdateAccountId && actor.accountId === selfUpdateAccountId) return;
  if (!actor.accountId) {
    if (actor.globalRole !== 'admin') fail('此功能仅管理员可用', 403);
    return;
  }
  assertAdmin(requireAuthorizationActor(actor));
}

function uniqueUsername(username: string, exceptId?: string) {
  const issue = textSafetyIssue(username, false);
  if (issue) fail(issue === 'line_break' ? '登录名不能包含换行' : '登录名包含不支持的控制字符');
  const value = canonicalizeLabel(username);
  if (!value) fail('登录名不能为空');
  if (value.length > 64) fail('登录名不能超过64个字符');
  const normalized = normalizeUsername(value);
  const duplicate = sqlite.prepare(`SELECT id FROM accounts WHERE normalized_username=? ${exceptId ? 'AND id<>?' : ''} LIMIT 1`)
    .get(...[normalized, ...(exceptId ? [exceptId] : [])]);
  if (duplicate) fail('登录名已存在');
  return { username: value, normalized };
}

function availableUsername(base: string, personId: string) {
  let username = canonicalizeLabel(base) || `user-${personId.slice(0, 6)}`;
  let normalized = normalizeUsername(username);
  if (sqlite.prepare('SELECT 1 FROM accounts WHERE normalized_username=?').get(normalized)) {
    username = `${username}-${personId.slice(0, 6)}`;
    normalized = normalizeUsername(username);
  }
  return { username, normalized };
}

export function createAccountForPerson(personId: string, name: string, active = true) {
  const existing = sqlite.prepare('SELECT id FROM accounts WHERE person_id=?').get(personId) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = randomUUID(); const now = nowIso(); const login = availableUsername(name, personId);
  sqlite.prepare(`INSERT INTO accounts
    (id, username, normalized_username, password_hash, person_id, global_role, status, must_change_password, session_version, is_builtin, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'user', ?, 1, 0, 0, ?, ?)`)
    .run(id, login.username, login.normalized, hashPassword('888888'), personId, active ? 'active' : 'disabled', now, now);
  return id;
}

export function findAccountForLogin(username: string) {
  return sqlite.prepare(`SELECT id, username, password_hash AS passwordHash, person_id AS personId,
    global_role AS globalRole, status, must_change_password AS mustChangePassword,
    session_version AS sessionVersion, is_builtin AS isBuiltin, ${accountPersonAvailableSql} AS personAvailable
    FROM accounts a WHERE normalized_username=? AND deleted_at IS NULL`).get(normalizeUsername(username)) as {
      id: string; username: string; passwordHash: string; personId: string | null;
      globalRole: 'user' | 'admin'; status: 'active' | 'disabled'; mustChangePassword: number;
      sessionVersion: number; isBuiltin: number; personAvailable: number;
    } | undefined;
}

export function markLogin(accountId: string, expectedSessionVersion: number, expectedPasswordHash: string) {
  const loggedAt = nowIso();
  return sqlite.transaction(() => {
    const changed = sqlite.prepare(`UPDATE accounts AS a SET last_login_at=?
      WHERE a.id=? AND a.session_version=? AND a.password_hash=? AND a.status='active' AND a.deleted_at IS NULL
        AND ${accountPersonAvailableSql}`).run(loggedAt, accountId, expectedSessionVersion, expectedPasswordHash);
    if (!changed.changes) return false;
    return Boolean(sqlite.prepare(`SELECT 1 FROM accounts a
      WHERE a.id=? AND a.session_version=? AND a.password_hash=? AND a.status='active' AND a.deleted_at IS NULL
        AND ${accountPersonAvailableSql}`).get(accountId, expectedSessionVersion, expectedPasswordHash));
  })();
}

export function listAccounts() {
  const accounts = sqlite.prepare(`SELECT a.id, a.username, a.person_id AS personId, p.name AS personName,
    p.job_title AS jobTitle, a.global_role AS globalRole, a.status,
    a.must_change_password AS mustChangePassword, a.is_builtin AS isBuiltin,
    a.last_login_at AS lastLoginAt, a.created_at AS createdAt, a.updated_at AS updatedAt
    FROM accounts a LEFT JOIN people p ON p.id=a.person_id
    WHERE a.deleted_at IS NULL ORDER BY a.is_builtin DESC, a.username`).all() as any[];
  const roles = sqlite.prepare(`SELECT pp.person_id AS personId, pp.project_id AS projectId, pr.name AS projectName
    FROM project_people pp JOIN projects pr ON pr.id=pp.project_id
    WHERE pp.project_role='manager' AND pr.deleted_at IS NULL ORDER BY pr.name`).all() as any[];
  const assignments = sqlite.prepare(`SELECT p.id AS personId,
    (SELECT COUNT(*) FROM requirements r
      WHERE r.owner_id=p.id AND r.deleted_at IS NULL AND r.status NOT IN ('completed','cancelled')) AS requirements,
    (SELECT COUNT(DISTINCT w.id) FROM work_items w LEFT JOIN work_item_collaborators c ON c.work_item_id=w.id AND c.person_id=p.id
      JOIN requirements r ON r.id=w.requirement_id
      WHERE r.deleted_at IS NULL AND w.status NOT IN ('completed','cancelled')
        AND (w.owner_id=p.id OR c.person_id IS NOT NULL)) AS workItems,
    (SELECT COUNT(*) FROM issues i WHERE i.owner_id=p.id AND i.status<>'resolved') AS issues
    FROM people p`).all() as Array<{ personId: string; requirements: number; workItems: number; issues: number }>;
  const assignmentsByPerson = new Map(assignments.map(({ personId, requirements, workItems, issues }) => [
    personId, { requirements: Number(requirements), workItems: Number(workItems), issues: Number(issues) },
  ]));
  return accounts.map((account) => {
    const managedProjects = roles.filter((role) => role.personId === account.personId)
      .map(({ projectId, projectName }) => ({ id: projectId, name: projectName }));
    return {
      ...account,
      mustChangePassword: Boolean(account.mustChangePassword),
      isBuiltin: Boolean(account.isBuiltin),
      role: account.globalRole === 'admin' ? 'admin' : managedProjects.length ? 'project_manager' : 'user',
      managedProjects,
      activeAssignments: account.personId
        ? assignmentsByPerson.get(account.personId) || { requirements: 0, workItems: 0, issues: 0 }
        : { requirements: 0, workItems: 0, issues: 0 },
    };
  });
}

export function updateAccount(id: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => !['username', 'role', 'status', 'managedProjectIds', 'expectedUpdatedAt'].includes(key))) {
    fail('账号编辑不能提交未声明字段');
  }
  const current = sqlite.prepare(`SELECT id, username, normalized_username AS normalizedUsername, person_id AS personId,
    global_role AS globalRole, status, is_builtin AS isBuiltin, updated_at AS updatedAt, ${accountPersonAvailableSql} AS personAvailable
    FROM accounts a WHERE id=? AND deleted_at IS NULL`).get(id) as any;
  if (!current) fail('账号不存在', 404);
  assertExpectedUpdatedAt(input, current.updatedAt, '账号');
  const role = input.role === undefined
    ? (current.globalRole === 'admin' ? 'admin' : undefined)
    : String(input.role);
  if (role === 'project_manager' || input.managedProjectIds !== undefined) fail('项目经理请在对应项目的“项目设置”中配置');
  if (role && !['user', 'admin'].includes(role)) fail('账号角色不合法');
  const status = input.status === undefined ? current.status : String(input.status);
  if (!['active', 'disabled'].includes(status)) fail('账号状态不合法');
  if (status === 'active' && !current.personAvailable) fail('人员已停用或归档，请先恢复人员', 409);
  if (current.isBuiltin && (status !== 'active' || (role && role !== 'admin'))) fail('内置admin账号不能停用或降级');
  const login = input.username === undefined
    ? { username: current.username, normalized: current.normalizedUsername }
    : uniqueUsername(String(input.username), id);
  if (current.isBuiltin && login.normalized !== 'admin') fail('内置账号登录名固定为admin');

  const globalRole = role === 'admin' ? 'admin' : role ? 'user' : current.globalRole;
  if (current.globalRole === 'admin' && current.status === 'active' && (globalRole !== 'admin' || status !== 'active')) {
    const remaining = sqlite.prepare(`SELECT COUNT(*) AS count FROM accounts
      WHERE id<>? AND global_role='admin' AND status='active' AND deleted_at IS NULL`).get(id) as { count: number };
    if (!remaining.count) fail('系统至少需要保留一个可用管理员');
  }

  if (login.username === current.username && login.normalized === current.normalizedUsername
    && globalRole === current.globalRole && status === current.status) {
    sqlite.transaction(() => {
      if (status === 'active') assertAccountPersonAvailable(current.personId);
      assertCurrentAdministrator(actor, id);
    })();
    return listAccounts().find((account) => account.id === id)!;
  }

  const updatedAt = nextUpdatedAt(current.updatedAt);
  sqlite.transaction(() => {
    const changed = sqlite.prepare(`UPDATE accounts SET username=?, normalized_username=?, global_role=?, status=?,
      session_version=session_version+?, updated_at=? WHERE id=? AND updated_at=? AND deleted_at IS NULL`)
      .run(login.username, login.normalized, globalRole, status, status !== current.status ? 1 : 0, updatedAt, id, current.updatedAt);
    if (!changed.changes) throw new AppError('账号已被其他用户修改，请重新打开后再保存', 409, 'STALE_WRITE', { currentUpdatedAt: current.updatedAt });
    if (status === 'active') assertAccountPersonAvailable(current.personId);
    if (current.globalRole === 'admin' && current.status === 'active' && (globalRole !== 'admin' || status !== 'active')) {
      assertActiveAdministratorRemains();
    }
    assertCurrentAdministrator(actor, id);
    audit(actor, 'update', id, `更新账号：${login.username}`);
  })();
  return listAccounts().find((account) => account.id === id)!;
}

export function deleteAccount(id: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => key !== 'expectedUpdatedAt')) fail('账号删除不能提交未声明字段');
  const account = sqlite.prepare(`SELECT id, username, person_id AS personId, global_role AS globalRole,
    status, is_builtin AS isBuiltin, updated_at AS updatedAt FROM accounts WHERE id=? AND deleted_at IS NULL`).get(id) as {
      id: string; username: string; personId: string | null; globalRole: 'user' | 'admin';
      status: 'active' | 'disabled'; isBuiltin: number; updatedAt: string;
    } | undefined;
  if (!account) fail('账号不存在', 404);
  assertExpectedUpdatedAt(input, account.updatedAt, '账号');
  if (account.isBuiltin) fail('内置admin账号不能删除');
  if (actor.accountId === id) fail('不能删除当前登录账号');
  if (account.globalRole === 'admin' && account.status === 'active') {
    const remaining = sqlite.prepare(`SELECT COUNT(*) AS count FROM accounts
      WHERE id<>? AND global_role='admin' AND status='active' AND deleted_at IS NULL`).get(id) as { count: number };
    if (!remaining.count) fail('系统至少需要保留一个可用管理员');
  }

  const updatedAt = nextUpdatedAt(account.updatedAt);
  sqlite.transaction(() => {
    const changed = sqlite.prepare(`UPDATE accounts SET status='disabled', deleted_at=?, session_version=session_version+1, updated_at=?
      WHERE id=? AND updated_at=? AND deleted_at IS NULL`).run(updatedAt, updatedAt, id, account.updatedAt);
    if (!changed.changes) throw new AppError('账号已被其他用户修改，请重新打开后再删除', 409, 'STALE_WRITE');
    sqlite.prepare('UPDATE api_tokens SET revoked_at=COALESCE(revoked_at, ?) WHERE account_id=?').run(updatedAt, id);
    if (account.globalRole === 'admin' && account.status === 'active') assertActiveAdministratorRemains();
    assertCurrentAdministrator(actor);
    audit(actor, 'delete', id, `删除账号登录能力：${account.username}`);
  })();
  return { ok: true };
}

export function openAccountForPerson(personId: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => key !== 'expectedAccountDeletedAt')) fail('开通账号不能提交未声明字段');
  const person = sqlite.prepare(`SELECT id, name, active FROM people
    WHERE id=? AND deleted_at IS NULL`).get(personId) as { id: string; name: string; active: number } | undefined;
  if (!person) fail('人员不存在', 404);
  if (!person.active) fail('人员已停用，请先恢复人员', 409);
  const existing = sqlite.prepare(`SELECT id, username, updated_at AS updatedAt, deleted_at AS deletedAt FROM accounts
    WHERE person_id=?`).get(personId) as { id: string; username: string; updatedAt: string; deletedAt: string | null } | undefined;
  const expectedDeletedAt = input.expectedAccountDeletedAt;
  if (expectedDeletedAt !== undefined && expectedDeletedAt !== (existing?.deletedAt || null)) {
    throw new AppError('账号状态已被其他用户修改，请刷新后重试', 409, 'STALE_WRITE', {
      currentAccountDeletedAt: existing?.deletedAt || null,
    });
  }
  if (existing && !existing.deletedAt) fail('该人员已有可用账号', 409);

  let accountId = existing?.id;
  const now = existing ? nextUpdatedAt(existing.updatedAt) : nowIso();
  sqlite.transaction(() => {
    if (existing) {
      const changed = sqlite.prepare(`UPDATE accounts SET password_hash=?, global_role='user', status='active',
        must_change_password=1, session_version=session_version+1, deleted_at=NULL, updated_at=?
        WHERE id=? AND updated_at=? AND deleted_at=?`).run(hashPassword('888888'), now, existing.id, existing.updatedAt, existing.deletedAt);
      if (!changed.changes) throw new AppError('账号状态已被其他用户修改，请刷新后重试', 409, 'STALE_WRITE');
      sqlite.prepare(`UPDATE api_tokens SET revoked_at=COALESCE(revoked_at, ?)
        WHERE account_id=?`).run(now, existing.id);
    } else {
      accountId = createAccountForPerson(personId, person.name, true);
    }
    assertAccountPersonAvailable(personId);
    assertCurrentAdministrator(actor);
    audit(actor, 'create', accountId || null, `${existing ? '重新开通' : '开通'}账号：${existing?.username || person.name}`);
  })();
  return {
    account: listAccounts().find((account) => account.id === accountId)!,
    temporaryPassword: '888888',
  };
}

export function resetAccountPassword(id: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => key !== 'expectedUpdatedAt')) fail('重置密码不能提交未声明字段');
  const account = sqlite.prepare('SELECT username, updated_at AS updatedAt FROM accounts WHERE id=? AND deleted_at IS NULL').get(id) as { username: string; updatedAt: string } | undefined;
  if (!account) fail('账号不存在', 404);
  assertExpectedUpdatedAt(input, account.updatedAt, '账号');
  const updatedAt = nextUpdatedAt(account.updatedAt);
  sqlite.transaction(() => {
    const changed = sqlite.prepare(`UPDATE accounts SET password_hash=?, must_change_password=1,
      session_version=session_version+1, updated_at=? WHERE id=? AND updated_at=? AND deleted_at IS NULL`)
      .run(hashPassword('888888'), updatedAt, id, account.updatedAt);
    if (!changed.changes) throw new AppError('账号已被其他用户修改，请重新打开后再重置密码', 409, 'STALE_WRITE');
    sqlite.prepare('UPDATE api_tokens SET revoked_at=COALESCE(revoked_at, ?) WHERE account_id=?').run(updatedAt, id);
    assertCurrentAdministrator(actor);
    audit(actor, 'reset_password', id, `重置账号密码：${account.username}`);
  })();
  return { ok: true, temporaryPassword: '888888' };
}

export function changeOwnPassword(accountId: string, currentPassword: string, newPassword: string, actor: Actor) {
  const account = sqlite.prepare(`SELECT username, password_hash AS passwordHash, session_version AS sessionVersion,
    updated_at AS updatedAt FROM accounts WHERE id=? AND deleted_at IS NULL`)
    .get(accountId) as { username: string; passwordHash: string; sessionVersion: number; updatedAt: string } | undefined;
  if (!account) fail('账号不存在', 404);
  if (!verifyPassword(currentPassword, account.passwordHash)) fail('当前密码错误');
  if (newPassword.length < 8) fail('新密码至少需要8个字符');
  if (currentPassword === newPassword) fail('新密码不能与当前密码相同');
  const sessionVersion = account.sessionVersion + 1;
  const updatedAt = nextUpdatedAt(account.updatedAt);
  sqlite.transaction(() => {
    const changed = sqlite.prepare(`UPDATE accounts SET password_hash=?, must_change_password=0,
      session_version=?, updated_at=? WHERE id=? AND session_version=? AND updated_at=? AND deleted_at IS NULL`)
      .run(hashPassword(newPassword), sessionVersion, updatedAt, accountId, account.sessionVersion, account.updatedAt);
    if (!changed.changes) throw new AppError('账号已被其他操作修改，请重新登录后再修改密码', 409, 'STALE_WRITE');
    audit(actor, 'change_password', accountId, `修改账号密码：${account.username}`);
  })();
  return { ok: true, sessionVersion };
}

export function getMyWork(accountId: string) {
  const today = todayIso();
  const account = sqlite.prepare(`SELECT person_id AS personId FROM accounts WHERE id=? AND status='active' AND deleted_at IS NULL`).get(accountId) as { personId: string | null } | undefined;
  if (!account?.personId) return {
    asOfDate: today,
    summary: { total: 0, notStarted: 0, inProgress: 0, blocked: 0, completed: 0, overdue: 0 },
    requirements: [], items: [], completionTrend: [], upcoming: [], recentProgress: [],
  };
  const rawItems = sqlite.prepare(`SELECT w.id, w.requirement_id AS requirementId, r.title AS requirementTitle,
    r.project_id AS projectId, pr.name AS projectName, r.status AS requirementStatus, w.title, w.owner_id AS ownerId,
    owner.name AS ownerName, w.status, w.planned_start AS plannedStart, w.planned_end AS plannedEnd,
    w.actual_start AS actualStart, w.actual_end AS actualEnd, w.forecast_end AS forecastEnd,
    w.blocked_at AS blockedAt, w.blocked_reason AS blockedReason, w.milestone_label AS milestoneLabel,
    w.progress, w.sort_order AS sortOrder, w.version,
    w.created_at AS createdAt, w.updated_at AS updatedAt,
    CASE WHEN w.owner_id=? THEN 'owner' ELSE 'collaborator' END AS assignmentType
    FROM work_items w JOIN requirements r ON r.id=w.requirement_id
    JOIN projects pr ON pr.id=r.project_id LEFT JOIN people owner ON owner.id=w.owner_id
    JOIN project_people access ON access.project_id=r.project_id AND access.person_id=?
    WHERE r.deleted_at IS NULL AND pr.deleted_at IS NULL AND
      (w.owner_id=? OR EXISTS (SELECT 1 FROM work_item_collaborators c WHERE c.work_item_id=w.id AND c.person_id=?))
    ORDER BY CASE WHEN w.actual_end IS NULL THEN 0 ELSE 1 END, COALESCE(w.planned_end, '9999-12-31'), w.updated_at DESC`)
    .all(account.personId, account.personId, account.personId, account.personId) as any[];
  const conditionReqIds=[...new Set(rawItems.filter(i=>i.status==='not_started').map(i=>String(i.requirementId)))];
  const conditions=new Map(chunkValues(conditionReqIds,200).flatMap(ids=>[...startConditions(ids)]));
  const items = rawItems.map((item) => {
    const status = deriveWorkItemStatus(item);
    return { ...item, ...conditions.get(item.id), status, overdue: !['completed', 'cancelled'].includes(status) && isOverdueByWorkday(item.plannedEnd, today) };
  });
  const summary = {
    total: items.filter((item) => item.status !== 'cancelled').length,
    notStarted: items.filter((item) => item.status === 'not_started').length,
    inProgress: items.filter((item) => item.status === 'in_progress').length,
    blocked: items.filter((item) => item.status === 'blocked').length,
    completed: items.filter((item) => item.status === 'completed').length,
    overdue: items.filter((item) => item.overdue).length,
  };
  const accessibleProjects = new Set((sqlite.prepare(`SELECT pp.project_id AS projectId FROM project_people pp
    JOIN projects p ON p.id=pp.project_id WHERE pp.person_id=? AND p.deleted_at IS NULL`)
    .all(account.personId) as Array<{ projectId: string }>).map((item) => item.projectId));
  const ownedRequirements = listRequirements({ ownerId: account.personId }, today)
    .filter((requirement) => accessibleProjects.has(requirement.projectId));
  const requirementIds = ownedRequirements.map((requirement) => requirement.id);
  const issueActionCounts = new Map<string, number>();
  for (const batch of chunkValues(requirementIds, 899)) {
    const placeholders = batch.map(() => '?').join(',');
    const counts = sqlite.prepare(`SELECT requirement_id AS requirementId, COUNT(*) AS count FROM issues
      WHERE requirement_id IN (${placeholders}) AND status<>'resolved'
        AND (owner_id IS NULL OR business_day_delta(due_date, ?)>0)
      GROUP BY requirement_id`).all(...batch, today) as Array<{ requirementId: string; count: number }>;
    counts.forEach((item) => issueActionCounts.set(item.requirementId, Number(item.count)));
  }
  const requirements = ownedRequirements.map((requirement) => {
    const activeItems = (requirement.workItems || []).filter((item) => item.status !== 'cancelled');
    const planningReasons: string[] = [...(requirement.readinessIssues||[])];

    const hasRequirementAction = deriveRequirementActionReasons(requirement).length > 0;
    const workItemActions = activeItems.filter((item) => deriveWorkItemActionReasons(item).length > 0).length;
    return {
      ...requirement,
      id: requirement.id, projectId: requirement.projectId, projectName: requirement.projectName,
      title: requirement.title, status: requirement.status, priority: requirement.priority,
      plannedStart: requirement.plannedStart, plannedEnd: requirement.plannedEnd,
      progress: requirement.progress, riskLevel: requirement.riskLevel, riskEvaluated: requirement.riskEvaluated,
      delayed: requirement.delayed, highRisk: requirement.highRisk, planningReasons,
      actionCount: Number(hasRequirementAction) + workItemActions + (issueActionCounts.get(requirement.id) || 0),
      updatedAt: requirement.updatedAt,
    };
  });
  const direct=ownedRequirements.filter(r=>r.executionMode==='direct'&&r.status!=='cancelled');
  summary.total+=direct.length;summary.notStarted+=direct.filter(r=>r.status==='not_started').length;summary.inProgress+=direct.filter(r=>r.status==='in_progress').length;summary.blocked+=direct.filter(r=>r.status==='blocked').length;summary.completed+=direct.filter(r=>['completed','pending_acceptance'].includes(r.status)).length;summary.overdue+=direct.filter(r=>r.delayed).length;
  const weekly = new Map<string, number>();
  for(const r of direct)if(r.actualEnd&&['completed','pending_acceptance'].includes(r.status)){const key=startOfWeekIso(r.actualEnd);weekly.set(key,(weekly.get(key)||0)+1);}
  for (const item of items.filter((value) => value.actualEnd)) {
    const key = startOfWeekIso(item.actualEnd!);
    weekly.set(key, (weekly.get(key) || 0) + 1);
  }
  const completionTrend = [...weekly.entries()].sort(([left], [right]) => left.localeCompare(right)).slice(-8)
    .map(([week, completed]) => ({ week, completed }));
  const upcomingDates: string[] = [];
  for (let offset = 0; upcomingDates.length < 10; offset += 1) {
    const date = addCalendarDays(today, offset);
    if (isBusinessDay(date)) upcomingDates.push(date);
  }
  const upcoming = upcomingDates.map((date) => ({
    date,
    count: items.filter((item) => !['completed', 'cancelled'].includes(item.status) && item.plannedStart && item.plannedEnd && date >= item.plannedStart && date <= item.plannedEnd).length+direct.filter(r=>!['completed','cancelled','pending_acceptance'].includes(r.status)&&r.plannedStart&&r.plannedEnd&&date>=r.plannedStart&&date<=r.plannedEnd).length,
  }));
  const recentProgress = sqlite.prepare(`SELECT u.id, u.requirement_id AS requirementId, r.title AS requirementTitle,
    u.work_item_id AS workItemId, w.title AS workItemTitle, u.percent, u.work_item_percent AS workItemPercent, u.content,
    u.event_type AS eventType, u.created_at AS createdAt, u.updated_at AS updatedAt
    FROM progress_updates u JOIN requirements r ON r.id=u.requirement_id
    JOIN projects pr ON pr.id=r.project_id
    JOIN project_people access ON access.project_id=r.project_id AND access.person_id=?
    LEFT JOIN work_items w ON w.id=u.work_item_id
    WHERE u.created_by_account_id=? AND r.deleted_at IS NULL AND pr.deleted_at IS NULL
    ORDER BY u.created_at DESC, u.rowid DESC LIMIT 8`).all(account.personId, accountId);
  return { asOfDate: today, summary, requirements, items, completionTrend, upcoming, recentProgress };
}
