import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config';
import { getDatabaseContext } from './database-context';
import { canReadProject, projectIdForRequirement, projectIdForWorkItem, recordProjectAccessFailure, sessionActor, type SessionActor } from './authorization';
import { forbidden, notFound } from './errors';
import { recordLogIdentity, recordProjectContext, updateLogContext } from './log-context';
import { idSchema } from '../shared/contracts';

/** Internal read-only identity. It has no account, membership, token, or write permissions. */
export const guestActor: SessionActor = {
  type: 'guest', id: 'guest', label: '游客', accountId: '', personId: null,
  globalRole: 'user', mustChangePassword: false, sessionVersion: 0,
};

export function isGuestProject(projectId: string) {
  const project = getDatabaseContext().sqlite.prepare('SELECT name FROM projects WHERE id=? AND guest_visible=1 AND deleted_at IS NULL').get(projectId) as { name: string } | undefined;
  recordProjectContext(projectId, project?.name);
  return Boolean(project);
}

export async function workspaceSession(request: FastifyRequest, reply: FastifyReply) {
  const cookie = request.cookies[config.sessionCookieName], actor = sessionActor(cookie);
  if (cookie && !actor) {
    reply.clearCookie(config.sessionCookieName, { path: '/' });
    return reply.code(401).send({ error: '登录状态已失效，请重新登录' });
  }
  request.actor = actor || guestActor;
  if (!actor) recordLogIdentity(guestActor);
  if (request.actor.mustChangePassword) return reply.code(403).send({ error: '请先修改初始密码', code: 'PASSWORD_CHANGE_REQUIRED' });
  reply.header('Cache-Control', 'private, no-store');
}

/** Only attach to explicitly selected workspace GET routes, never to writes or MCP. */
export async function requireWorkspaceRead(request: FastifyRequest, reply: FastifyReply) {
  await workspaceSession(request, reply);
  if (reply.sent) return;
  const params = request.params as Record<string, string>;
  const query = request.query as Record<string, string>;
  // Validate supplied IDs before resource lookup, including whitespace-only values.
  for (const key of ['id', 'projectId']) if (params[key] !== undefined) params[key] = idSchema.parse(params[key]);
  if (query.projectId !== undefined) query.projectId = idSchema.parse(query.projectId);
  let projectId = params.projectId || query.projectId;
  const route = request.routeOptions.url || '';
  if (route.startsWith('/api/projects/:id/')) projectId = params.id;
  else if (route.startsWith('/api/requirements/:id')) projectId = projectIdForRequirement(params.id);
  else if (route === '/api/work-items/:id') projectId = projectIdForWorkItem(params.id);
  if (!projectId) {
    // The platform people directory remains admin-only in its route handler.
    if (request.actor?.globalRole === 'admin') return;
    forbidden('请指定可访问的项目');
  }
  if (request.actor!.type !== 'guest' && canReadProject(request.actor!, projectId)) return;
  if (!isGuestProject(projectId)) { recordProjectAccessFailure(request.actor!, projectId, 'workspace'); notFound('项目不存在或未开放游客浏览'); }
  updateLogContext({ accessMode: 'guest' });
  request.actor = guestActor;
}
