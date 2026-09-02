import type { FastifyRequest } from 'fastify';
import { sqlite } from './database';
import { verifySessionToken, type AccountRole, type Actor } from './auth';

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

function forbidden(message = '没有执行此操作的权限'): never {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = 403;
  throw error;
}

export function sessionActor(token?: string): SessionActor | null {
  const payload = verifySessionToken(token);
  if (!payload) return null;
  const account = sqlite.prepare(`SELECT id, username, person_id AS personId, global_role AS globalRole,
    must_change_password AS mustChangePassword, session_version AS sessionVersion
    FROM accounts WHERE id=? AND status='active'`).get(payload.accountId) as {
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

export function managedProjectIds(actor: SessionActor) {
  if (!actor.personId) return [];
  return (sqlite.prepare(`SELECT project_id AS projectId FROM project_people
    WHERE person_id=? AND project_role='manager' ORDER BY project_id`).all(actor.personId) as Array<{ projectId: string }>)
    .map((item) => item.projectId);
}

export function isAdmin(actor: Pick<SessionActor, 'globalRole'>) {
  return actor.globalRole === 'admin';
}

export function canManageProject(actor: SessionActor, projectId: string) {
  if (isAdmin(actor)) return true;
  if (!actor.personId) return false;
  return Boolean(sqlite.prepare(`SELECT 1 FROM project_people WHERE project_id=? AND person_id=? AND project_role='manager'`)
    .get(projectId, actor.personId));
}

export function isProjectMember(actor: SessionActor, projectId: string) {
  if (isAdmin(actor)) return true;
  if (!actor.personId) return false;
  return Boolean(sqlite.prepare('SELECT 1 FROM project_people WHERE project_id=? AND person_id=?')
    .get(projectId, actor.personId));
}

export function assertAdmin(actor: SessionActor) {
  if (!isAdmin(actor)) forbidden('此功能仅管理员可用');
}

export function assertProjectManager(actor: SessionActor, projectId: string) {
  if (!canManageProject(actor, projectId)) forbidden('只有当前项目的项目经理或管理员可以执行此操作');
}

export function assertProjectMember(actor: SessionActor, projectId: string) {
  if (!isProjectMember(actor, projectId)) forbidden('只有当前项目成员可以提交问题或追加进展');
}

export function projectIdForRequirement(requirementId: string) {
  const value = sqlite.prepare('SELECT project_id AS projectId FROM requirements WHERE id=?').get(requirementId) as { projectId: string } | undefined;
  if (!value) throw new Error('需求不存在');
  return value.projectId;
}

export function projectIdForWorkItem(workItemId: string) {
  const value = sqlite.prepare(`SELECT r.project_id AS projectId FROM work_items w
    JOIN requirements r ON r.id=w.requirement_id WHERE w.id=?`).get(workItemId) as { projectId: string } | undefined;
  if (!value) throw new Error('工作项不存在');
  return value.projectId;
}

export function projectIdForIssue(issueId: string) {
  const value = sqlite.prepare('SELECT project_id AS projectId FROM issues WHERE id=?').get(issueId) as { projectId: string } | undefined;
  if (!value) throw new Error('问题不存在');
  return value.projectId;
}

export function projectIdForProgress(progressId: string) {
  const value = sqlite.prepare(`SELECT r.project_id AS projectId FROM progress_updates u
    JOIN requirements r ON r.id=u.requirement_id WHERE u.id=?`).get(progressId) as { projectId: string } | undefined;
  if (!value) throw new Error('进展记录不存在');
  return value.projectId;
}

export function isWorkItemAssignee(actor: SessionActor, workItemId: string) {
  if (!actor.personId) return false;
  return Boolean(sqlite.prepare(`SELECT 1 FROM work_items w WHERE w.id=? AND
    (w.owner_id=? OR EXISTS (SELECT 1 FROM work_item_collaborators c WHERE c.work_item_id=w.id AND c.person_id=?))`)
    .get(workItemId, actor.personId, actor.personId));
}

export function assertWorkItemParticipantOrManager(actor: SessionActor, workItemId: string) {
  const projectId = projectIdForWorkItem(workItemId);
  if (!canManageProject(actor, projectId) && !isWorkItemAssignee(actor, workItemId)) {
    forbidden('只能操作分配给自己的工作项');
  }
}

export function assertProgressOwnerOrManager(actor: SessionActor, progressId: string, nextWorkItemId?: string | null) {
  const projectId = projectIdForProgress(progressId);
  if (canManageProject(actor, projectId)) return;
  const progress = sqlite.prepare('SELECT created_by_account_id AS accountId, work_item_id AS workItemId FROM progress_updates WHERE id=?').get(progressId) as { accountId: string | null; workItemId: string | null } | undefined;
  if (!progress || progress.accountId !== actor.accountId) forbidden('只能修改或删除自己填写的进展');
  const workItemId = nextWorkItemId === undefined ? progress.workItemId : nextWorkItemId;
  if (!workItemId || !isWorkItemAssignee(actor, workItemId)) forbidden('普通用户的进展必须关联自己的工作项');
}

export function assertCanAddProgress(actor: SessionActor, requirementId: string, workItemId: string | null) {
  const projectId = projectIdForRequirement(requirementId);
  if (canManageProject(actor, projectId)) return;
  if (!workItemId || !isWorkItemAssignee(actor, workItemId)) forbidden('普通用户添加进展时必须关联自己的工作项');
}
