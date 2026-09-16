import type { FastifyRequest } from 'fastify';
import { sqlite } from './database';
import { verifySessionToken, type AccountRole, type Actor } from './auth';
import type { ProjectRole } from '../shared/domain';
import { forbidden, notFound } from './errors';
import { accountPersonAvailableSql } from './account-access';

export type SessionActor = Actor & {
  accountId: string;
  personId: string | null;
  globalRole: AccountRole;
  mustChangePassword: boolean;
  sessionVersion: number;
};

declare module 'fastify' {
  interface FastifyRequest {
    actor: SessionActor | null;
  }
}

export type AuthorizationActor = Pick<Actor, 'type' | 'id' | 'label'> & {
  accountId: string;
  personId: string | null;
  globalRole: AccountRole;
};

export function requireAuthorizationActor(actor: Actor): AuthorizationActor {
  if (actor.type === 'guest') return { type: 'guest', id: 'guest', label: '游客', accountId: '', personId: null, globalRole: 'user' };
  if (!actor.accountId || !actor.globalRole) forbidden('当前账号状态无效，请重新登录');
  const current = sqlite.prepare(`SELECT a.person_id AS personId, a.global_role AS globalRole
    FROM accounts a WHERE a.id=? AND a.status='active' AND a.deleted_at IS NULL
      AND ${accountPersonAvailableSql}`).get(actor.accountId) as {
      personId: string | null; globalRole: AccountRole;
    } | undefined;
  if (!current) forbidden('当前账号或人员状态已变化，请重新登录');
  return {
    type: actor.type, id: actor.id, label: actor.label,
    accountId: actor.accountId, personId: current.personId, globalRole: current.globalRole,
  };
}

export function sessionActor(token?: string): SessionActor | null {
  const payload = verifySessionToken(token);
  if (!payload) return null;
  const account = sqlite.prepare(`SELECT id, username, person_id AS personId, global_role AS globalRole,
    must_change_password AS mustChangePassword, session_version AS sessionVersion
    FROM accounts a WHERE id=? AND status='active' AND deleted_at IS NULL
      AND ${accountPersonAvailableSql}`).get(payload.accountId) as {
      id: string; username: string; personId: string | null; globalRole: AccountRole;
      mustChangePassword: number; sessionVersion: number;
    } | undefined;
  if (!account || account.sessionVersion !== payload.sessionVersion) return null;
  return {
    type: 'user', id: account.id, label: account.username, accountId: account.id,
    personId: account.personId, globalRole: account.globalRole,
    mustChangePassword: Boolean(account.mustChangePassword), sessionVersion: account.sessionVersion,
  };
}

export function actorFromRequest(request: FastifyRequest): SessionActor {
  if (!request.actor) forbidden('请先登录');
  return request.actor!;
}

export function managedProjectIds(actor: AuthorizationActor) {
  if (!actor.personId) return [];
  return (sqlite.prepare(`SELECT pp.project_id AS projectId FROM project_people pp
    JOIN projects p ON p.id=pp.project_id
    WHERE pp.person_id=? AND pp.project_role='manager' AND p.deleted_at IS NULL
    ORDER BY pp.project_id`).all(actor.personId) as Array<{ projectId: string }>)
    .map((item) => item.projectId);
}

export function isAdmin(actor: Pick<SessionActor, 'globalRole'>) {
  return actor.globalRole === 'admin';
}

function isActiveProject(projectId: string) {
  return Boolean(sqlite.prepare('SELECT 1 FROM projects WHERE id=? AND deleted_at IS NULL').get(projectId));
}

export function accessibleProjectIds(actor: AuthorizationActor) {
  if (isAdmin(actor)) {
    return (sqlite.prepare('SELECT id FROM projects WHERE deleted_at IS NULL ORDER BY created_at DESC').all() as Array<{ id: string }>).map((item) => item.id);
  }
  if (!actor.personId) return [];
  return (sqlite.prepare(`SELECT pp.project_id AS projectId FROM project_people pp
    JOIN projects p ON p.id=pp.project_id WHERE pp.person_id=? AND p.deleted_at IS NULL
    ORDER BY p.created_at DESC`).all(actor.personId) as Array<{ projectId: string }>).map((item) => item.projectId);
}

export function projectRole(actor: AuthorizationActor, projectId: string): ProjectRole | null {
  if (!isActiveProject(projectId)) return null;
  if (isAdmin(actor)) return 'manager';
  if (!actor.personId) return null;
  return (sqlite.prepare('SELECT project_role AS projectRole FROM project_people WHERE project_id=? AND person_id=?')
    .get(projectId, actor.personId) as { projectRole: ProjectRole } | undefined)?.projectRole || null;
}

export function canManageProject(actor: AuthorizationActor, projectId: string) {
  if (!isActiveProject(projectId)) return false;
  if (isAdmin(actor)) return true;
  if (!actor.personId) return false;
  return Boolean(sqlite.prepare(`SELECT 1 FROM project_people WHERE project_id=? AND person_id=? AND project_role='manager'`)
    .get(projectId, actor.personId));
}

export function canReadProject(actor: AuthorizationActor, projectId: string) {
  if (actor.type === 'guest') return Boolean(sqlite.prepare('SELECT 1 FROM projects WHERE id=? AND guest_visible=1 AND deleted_at IS NULL').get(projectId));
  if (!isActiveProject(projectId)) return false;
  if (isAdmin(actor)) return true;
  if (!actor.personId) return false;
  return Boolean(sqlite.prepare('SELECT 1 FROM project_people WHERE project_id=? AND person_id=?')
    .get(projectId, actor.personId));
}

export function canContributeProject(actor: AuthorizationActor, projectId: string) {
  const role = projectRole(actor, projectId);
  return role === 'member' || role === 'manager';
}

export function assertAdmin(actor: AuthorizationActor) {
  if (!isAdmin(actor)) forbidden('此功能仅管理员可用');
}

export function assertProjectManager(actor: AuthorizationActor, projectId: string) {
  if (!canManageProject(actor, projectId)) forbidden('只有当前项目的项目经理或管理员可以执行此操作');
}

export function assertProjectReadable(actor: AuthorizationActor, projectId: string) {
  if (!canReadProject(actor, projectId)) forbidden('没有访问当前项目的权限');
}

export function assertProjectResourceReadable(actor: AuthorizationActor, projectId: string, message = '资源不存在') {
  if (!canReadProject(actor, projectId)) notFound(message);
}

export function assertProjectResourceManager(actor: AuthorizationActor, projectId: string, message = '资源不存在') {
  assertProjectResourceReadable(actor, projectId, message);
  assertProjectManager(actor, projectId);
}

export function assertProjectMember(actor: AuthorizationActor, projectId: string) {
  if (!canContributeProject(actor, projectId)) forbidden('只有当前项目成员可以提交问题或追加进展');
}

export function projectIdForRequirement(requirementId: string) {
  const value = sqlite.prepare('SELECT project_id AS projectId FROM requirements WHERE id=?').get(requirementId) as { projectId: string } | undefined;
  if (!value) notFound('需求不存在');
  return value.projectId;
}

export function projectIdForWorkItem(workItemId: string) {
  const value = sqlite.prepare(`SELECT r.project_id AS projectId FROM work_items w
    JOIN requirements r ON r.id=w.requirement_id WHERE w.id=? AND r.deleted_at IS NULL`).get(workItemId) as { projectId: string } | undefined;
  if (!value) notFound('工作项不存在');
  return value.projectId;
}

export function isRequirementOwner(actor: AuthorizationActor, requirementId: string) {
  if (!actor.personId) return false;
  return Boolean(sqlite.prepare('SELECT 1 FROM requirements WHERE id=? AND owner_id=? AND deleted_at IS NULL')
    .get(requirementId, actor.personId));
}

export function isRequirementOwnerForWorkItem(actor: AuthorizationActor, workItemId: string) {
  if (!actor.personId) return false;
  return Boolean(sqlite.prepare(`SELECT 1 FROM work_items w
    JOIN requirements r ON r.id=w.requirement_id
    WHERE w.id=? AND r.owner_id=? AND r.deleted_at IS NULL`).get(workItemId, actor.personId));
}

export function assertRequirementOwnerOrManager(actor: AuthorizationActor, requirementId: string) {
  const projectId = projectIdForRequirement(requirementId);
  assertProjectResourceReadable(actor, projectId, '需求不存在');
  if (canManageProject(actor, projectId)) return;
  if (!canContributeProject(actor, projectId) || !isRequirementOwner(actor, requirementId)) {
    forbidden('只有需求负责人、项目经理或管理员可以管理该需求的工作项');
  }
}

export function assertWorkItemRequirementOwnerOrManager(actor: AuthorizationActor, workItemId: string) {
  const projectId = projectIdForWorkItem(workItemId);
  assertProjectResourceReadable(actor, projectId, '工作项不存在');
  if (canManageProject(actor, projectId)) return;
  if (!canContributeProject(actor, projectId) || !isRequirementOwnerForWorkItem(actor, workItemId)) {
    forbidden('只有需求负责人、项目经理或管理员可以管理该工作项');
  }
}

export function projectIdForIssue(issueId: string) {
  const value = sqlite.prepare('SELECT project_id AS projectId FROM issues WHERE id=?').get(issueId) as { projectId: string } | undefined;
  if (!value) notFound('问题不存在');
  return value.projectId;
}

export function projectIdForTemplate(templateId: string) {
  const value = sqlite.prepare('SELECT project_id AS projectId FROM work_item_templates WHERE id=?').get(templateId) as { projectId: string } | undefined;
  if (!value) notFound('流程设计不存在');
  return value.projectId;
}

export function canUpdateIssueProgress(actor: AuthorizationActor, issueId: string) {
  const projectId = projectIdForIssue(issueId);
  if (canManageProject(actor, projectId)) return true;
  if (!canContributeProject(actor, projectId)) return false;
  if (!actor.personId) return false;
  return Boolean(sqlite.prepare('SELECT 1 FROM issues WHERE id=? AND owner_id=?').get(issueId, actor.personId));
}

export function projectIdForProgress(progressId: string) {
  const value = sqlite.prepare(`SELECT r.project_id AS projectId FROM progress_updates u
    JOIN requirements r ON r.id=u.requirement_id WHERE u.id=? AND r.deleted_at IS NULL`).get(progressId) as { projectId: string } | undefined;
  if (!value) notFound('进展记录不存在');
  return value.projectId;
}

export function isWorkItemAssignee(actor: AuthorizationActor, workItemId: string) {
  if (!actor.personId) return false;
  return Boolean(sqlite.prepare(`SELECT 1 FROM work_items w WHERE w.id=? AND
    (w.owner_id=? OR EXISTS (SELECT 1 FROM work_item_collaborators c WHERE c.work_item_id=w.id AND c.person_id=?))`)
    .get(workItemId, actor.personId, actor.personId));
}

export function assertWorkItemParticipantOrManager(actor: AuthorizationActor, workItemId: string) {
  const projectId = projectIdForWorkItem(workItemId);
  assertProjectResourceReadable(actor, projectId, '工作项不存在');
  if (!canManageProject(actor, projectId) && (!canContributeProject(actor, projectId)
    || !isWorkItemAssignee(actor, workItemId) && !isRequirementOwnerForWorkItem(actor, workItemId))) {
    forbidden('只能操作分配给自己的工作项');
  }
}

export function assertProgressOwnerOrManager(actor: AuthorizationActor, progressId: string, nextWorkItemId?: string | null) {
  const projectId = projectIdForProgress(progressId);
  assertProjectResourceReadable(actor, projectId, '进展记录不存在');
  if (canManageProject(actor, projectId)) return;
  const progress = sqlite.prepare('SELECT created_by_account_id AS accountId, work_item_id AS workItemId FROM progress_updates WHERE id=?').get(progressId) as { accountId: string | null; workItemId: string | null } | undefined;
  if (!progress || progress.accountId !== actor.accountId) forbidden('只能修改或删除自己填写的进展');
  const workItemId = nextWorkItemId === undefined ? progress.workItemId : nextWorkItemId;
  if (!workItemId || !isWorkItemAssignee(actor, workItemId)) forbidden('普通用户的进展必须关联自己的工作项');
}

export function assertCanAddProgress(actor: AuthorizationActor, requirementId: string, workItemId: string | null) {
  const requirement = sqlite.prepare('SELECT project_id AS projectId FROM requirements WHERE id=? AND deleted_at IS NULL')
    .get(requirementId) as { projectId: string } | undefined;
  if (!requirement) notFound('需求不存在');
  const projectId = requirement.projectId;
  if (canManageProject(actor, projectId)) return;
  if (!canContributeProject(actor, projectId)) forbidden('只有当前项目成员可以追加说明');
  if (isRequirementOwner(actor, requirementId)) return;
  if (!workItemId) forbidden('只有需求负责人、项目经理或管理员可以追加需求级说明');
  if (!isWorkItemAssignee(actor, workItemId)) forbidden('普通用户只能更新分配给自己的工作项');
}
