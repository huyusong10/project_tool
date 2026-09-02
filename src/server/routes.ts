import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config';
import { createSessionToken, verifyPassword } from './auth';
import {
  actorFromRequest, assertAdmin, assertCanAddProgress, assertProgressOwnerOrManager,
  assertProjectManager, assertProjectMember, assertWorkItemParticipantOrManager, canManageProject, isAdmin,
  managedProjectIds, projectIdForIssue, projectIdForRequirement, projectIdForWorkItem, sessionActor,
} from './authorization';
import {
  changeOwnPassword, findAccountForLogin, getMyWork, listAccounts, markLogin,
  resetAccountPassword, updateAccount,
} from './accounts';
import {
  addIssueUpdate, addProgress, addProjectPerson, applyRequirementPlan, applyTemplate, archivePerson, archiveProject, archiveRequirement, archiveTemplate,
  blockWorkItem, cancelWorkItem, completeWorkItem, createPerson, createProject, createRequirement, createTemplate,
  createIssue, createWorkItem, deleteProgress, deleteWorkItem, getDashboard, getIssue, getPeopleConcurrency, getRequirement, issueToken,
  listArchives, listAudit, listIssues, listPeople, listProjects, listRequirements, listTemplates, listTokens, previewRequirementPlan,
  permanentlyDeleteArchive, recordAudit, removeProjectPerson, reorderWorkItems, restorePerson, restoreProject, restoreRequirement, restoreTemplate, revokeToken, searchAudit, startWorkItem,
  unblockWorkItem, updateIssue, updatePerson, updateProgress, updateProject, updateRequirement, updateTemplate, updateWorkItem,
} from './services';
import { createBackup, deleteBackup, listBackups, scheduleRestore } from './backups';

function sessionOf(request: FastifyRequest) {
  return sessionActor(request.cookies.pm_session);
}

function body(request: FastifyRequest) {
  return (request.body || {}) as Record<string, unknown>;
}

async function requireAuthenticated(request: FastifyRequest, reply: FastifyReply) {
  request.actor = sessionOf(request);
  if (!request.actor) return reply.code(401).send({ error: '请先登录' });
}

async function requireReady(request: FastifyRequest, reply: FastifyReply) {
  await requireAuthenticated(request, reply);
  if (reply.sent) return;
  if (request.actor?.mustChangePassword) return reply.code(403).send({ error: '请先修改初始密码', code: 'PASSWORD_CHANGE_REQUIRED' });
}

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await requireReady(request, reply);
  if (reply.sent) return;
  assertAdmin(actorFromRequest(request));
}

function sessionPayload(actor: ReturnType<typeof sessionOf>) {
  if (!actor) return { authenticated: false, username: null, httpWarning: true, role: 'guest', globalRole: 'guest', personId: null, mustChangePassword: false, managedProjectIds: [] };
  const projects = managedProjectIds(actor);
  return {
    authenticated: true, accountId: actor.accountId, username: actor.label, httpWarning: true,
    globalRole: actor.globalRole, role: isAdmin(actor) ? 'admin' : projects.length ? 'project_manager' : 'user',
    personId: actor.personId, mustChangePassword: actor.mustChangePassword, managedProjectIds: projects,
  };
}

function setSessionCookie(reply: FastifyReply, accountId: string, sessionVersion: number) {
  reply.setCookie('pm_session', createSessionToken(accountId, sessionVersion), {
    httpOnly: true, sameSite: 'strict', secure: false, path: '/', maxAge: config.sessionHours * 60 * 60,
  });
}

export function registerApiRoutes(app: FastifyInstance) {
  app.decorateRequest('actor', null);
  app.get('/api/session', async (request) => sessionPayload(sessionOf(request)));
  app.post('/api/login', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = body(request); const account = findAccountForLogin(String(input.username || ''));
    if (!account || !verifyPassword(String(input.password || ''), account.passwordHash)) return reply.code(401).send({ error: '用户名或密码错误' });
    if (account.status !== 'active') return reply.code(403).send({ error: '账号已停用，请联系管理员' });
    markLogin(account.id); setSessionCookie(reply, account.id, account.sessionVersion);
    return sessionPayload(sessionActor(createSessionToken(account.id, account.sessionVersion)));
  });
  app.post('/api/logout', async (_request, reply) => { reply.clearCookie('pm_session', { path: '/' }); return { ok: true }; });
  app.post('/api/account/change-password', { preHandler: requireAuthenticated }, async (request, reply) => {
    const actor = actorFromRequest(request); const input = body(request);
    const result = changeOwnPassword(actor.accountId, String(input.currentPassword || ''), String(input.newPassword || ''), actor);
    setSessionCookie(reply, actor.accountId, result.sessionVersion);
    return { ...result, session: sessionPayload(sessionActor(createSessionToken(actor.accountId, result.sessionVersion))) };
  });
  app.get('/api/accounts', { preHandler: requireAdmin }, async () => listAccounts());
  app.patch('/api/accounts/:id', { preHandler: requireAdmin }, async (request) => updateAccount((request.params as any).id, body(request), actorFromRequest(request)));
  app.post('/api/accounts/:id/reset-password', { preHandler: requireAdmin }, async (request) => resetAccountPassword((request.params as any).id, actorFromRequest(request)));
  app.get('/api/my-work', { preHandler: requireReady }, async (request) => getMyWork(actorFromRequest(request).accountId));

  app.get('/api/projects', async (request) => listProjects((request.query as any).includeDeleted === 'true'));
  app.post('/api/projects', { preHandler: requireAdmin }, async (request) => createProject(body(request), actorFromRequest(request)));
  app.patch('/api/projects/:id', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectManager(actor, id);
    return updateProject(id, body(request), actor);
  });
  app.delete('/api/projects/:id', { preHandler: requireAdmin }, async (request) => archiveProject((request.params as any).id, actorFromRequest(request)));
  app.post('/api/projects/:id/restore', { preHandler: requireAdmin }, async (request) => restoreProject((request.params as any).id, actorFromRequest(request)));
  app.get('/api/dashboard', async (request) => getDashboard((request.query as any).projectId));

  app.get('/api/requirements', async (request) => listRequirements(request.query as any));
  app.get('/api/requirements/:id', async (request) => getRequirement((request.params as any).id, (request.query as any).includeDeleted === 'true'));
  app.post('/api/requirements', { preHandler: requireReady }, async (request) => {
    const input = body(request); const actor = actorFromRequest(request); assertProjectManager(actor, String(input.projectId || ''));
    return createRequirement(input, actor);
  });
  app.patch('/api/requirements/:id', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectManager(actor, projectIdForRequirement(id));
    return updateRequirement(id, body(request), actor);
  });
  app.delete('/api/requirements/:id', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectManager(actor, projectIdForRequirement(id));
    return archiveRequirement(id, actor);
  });
  app.post('/api/requirements/:id/restore', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectManager(actor, projectIdForRequirement(id));
    return restoreRequirement(id, actor);
  });
  app.post('/api/requirements/:id/apply-template', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectManager(actor, projectIdForRequirement(id));
    return applyTemplate(id, String(body(request).templateId), actor);
  });
  app.post('/api/requirements/:id/plan-preview', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; assertProjectManager(actorFromRequest(request), projectIdForRequirement(id));
    return previewRequirementPlan(id, body(request));
  });
  app.post('/api/requirements/:id/apply-plan', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectManager(actor, projectIdForRequirement(id));
    return applyRequirementPlan(id, body(request), actor);
  });
  app.post('/api/requirements/:id/work-items', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectManager(actor, projectIdForRequirement(id));
    return createWorkItem(id, body(request), actor);
  });
  app.post('/api/requirements/:id/reorder-work-items', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectManager(actor, projectIdForRequirement(id));
    return reorderWorkItems(id, body(request).ids as string[], actor);
  });
  app.post('/api/requirements/:id/progress', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const input = body(request); const actor = actorFromRequest(request);
    assertCanAddProgress(actor, id, input.workItemId ? String(input.workItemId) : null);
    return addProgress(id, input, actor);
  });

  app.patch('/api/work-items/:id', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const input = body(request); const actor = actorFromRequest(request);
    if (!canManageProject(actor, projectIdForWorkItem(id))) {
      assertWorkItemParticipantOrManager(actor, id);
      const forbiddenKeys = Object.keys(input).filter((key) => !['actualStart', 'actualEnd'].includes(key));
      if (forbiddenKeys.length) { const error = new Error('普通用户只能修正自己工作项的实际日期') as Error & { statusCode: number }; error.statusCode = 403; throw error; }
    }
    return updateWorkItem(id, input, actor);
  });
  for (const [action, handler] of [
    ['start', (id: string, _input: any, actor: any) => startWorkItem(id, actor)],
    ['complete', (id: string, _input: any, actor: any) => completeWorkItem(id, actor)],
    ['block', (id: string, input: any, actor: any) => blockWorkItem(id, input, actor)],
    ['unblock', (id: string, _input: any, actor: any) => unblockWorkItem(id, actor)],
  ] as const) {
    app.post(`/api/work-items/:id/${action}`, { preHandler: requireReady }, async (request) => {
      const id = (request.params as any).id; const actor = actorFromRequest(request); assertWorkItemParticipantOrManager(actor, id);
      return handler(id, body(request), actor);
    });
  }
  app.post('/api/work-items/:id/cancel', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectManager(actor, projectIdForWorkItem(id));
    return cancelWorkItem(id, actor);
  });
  app.delete('/api/work-items/:id', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectManager(actor, projectIdForWorkItem(id));
    return deleteWorkItem(id, actor);
  });
  app.patch('/api/progress/:id', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); const input = body(request);
    assertProgressOwnerOrManager(actor, id, Object.prototype.hasOwnProperty.call(input, 'workItemId') ? (input.workItemId ? String(input.workItemId) : null) : undefined);
    return updateProgress(id, input, actor);
  });
  app.delete('/api/progress/:id', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProgressOwnerOrManager(actor, id);
    return deleteProgress(id, actor);
  });

  app.get('/api/issues', async (request) => listIssues(request.query as any));
  app.get('/api/issues/:id', async (request) => getIssue((request.params as any).id));
  app.post('/api/issues', { preHandler: requireReady }, async (request) => {
    const input = body(request); const actor = actorFromRequest(request); const projectId = String(input.projectId || '');
    assertProjectMember(actor, projectId);
    return createIssue(canManageProject(actor, projectId) ? input : { ...input, status: 'open', ownerId: null }, actor);
  });
  app.patch('/api/issues/:id', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectManager(actor, projectIdForIssue(id));
    return updateIssue(id, body(request), actor);
  });
  app.post('/api/issues/:id/updates', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectMember(actor, projectIdForIssue(id));
    return addIssueUpdate(id, body(request), actor);
  });

  app.get('/api/people', async (request) => listPeople((request.query as any).includeDeleted === 'true', (request.query as any).projectId));
  app.post('/api/people', { preHandler: requireAdmin }, async (request) => createPerson(body(request), actorFromRequest(request)));
  app.patch('/api/people/:id', { preHandler: requireAdmin }, async (request) => updatePerson((request.params as any).id, body(request), actorFromRequest(request)));
  app.delete('/api/people/:id', { preHandler: requireAdmin }, async (request) => archivePerson((request.params as any).id, actorFromRequest(request)));
  app.post('/api/people/:id/restore', { preHandler: requireAdmin }, async (request) => restorePerson((request.params as any).id, actorFromRequest(request)));
  app.post('/api/projects/:projectId/people/:personId', { preHandler: requireReady }, async (request) => {
    const { projectId, personId } = request.params as { projectId: string; personId: string }; const actor = actorFromRequest(request);
    assertProjectManager(actor, projectId); return addProjectPerson(projectId, personId, actor);
  });
  app.delete('/api/projects/:projectId/people/:personId', { preHandler: requireReady }, async (request) => {
    const { projectId, personId } = request.params as { projectId: string; personId: string }; const actor = actorFromRequest(request);
    assertProjectManager(actor, projectId); return removeProjectPerson(projectId, personId, actor);
  });

  app.get('/api/templates', async (request) => listTemplates((request.query as any).includeDeleted === 'true'));
  app.post('/api/templates', { preHandler: requireAdmin }, async (request) => createTemplate(body(request), actorFromRequest(request)));
  app.patch('/api/templates/:id', { preHandler: requireAdmin }, async (request) => updateTemplate((request.params as any).id, body(request), actorFromRequest(request)));
  app.delete('/api/templates/:id', { preHandler: requireAdmin }, async (request) => archiveTemplate((request.params as any).id, actorFromRequest(request)));
  app.post('/api/templates/:id/restore', { preHandler: requireAdmin }, async (request) => restoreTemplate((request.params as any).id, actorFromRequest(request)));

  app.get('/api/analytics/people-concurrency', async (request) => getPeopleConcurrency(request.query as any));
  app.get('/api/archives', { preHandler: requireAdmin }, async () => listArchives());
  app.delete('/api/archives/:entity/:id', { preHandler: requireAdmin }, async (request) => {
    const { entity, id } = request.params as { entity: 'projects' | 'requirements' | 'people' | 'templates'; id: string };
    return permanentlyDeleteArchive(entity, id, actorFromRequest(request));
  });

  app.get('/api/tokens', { preHandler: requireAdmin }, async () => listTokens());
  app.post('/api/tokens', { preHandler: requireAdmin }, async (request) => issueToken(body(request), actorFromRequest(request)));
  app.delete('/api/tokens/:id', { preHandler: requireAdmin }, async (request) => revokeToken((request.params as any).id, actorFromRequest(request)));
  app.get('/api/audit', { preHandler: requireAdmin }, async (request) => listAudit(Number((request.query as any).limit || 100)));
  app.get('/api/audit/search', { preHandler: requireAdmin }, async (request) => searchAudit(request.query as any));

  app.get('/api/backups', { preHandler: requireAdmin }, async () => listBackups());
  app.post('/api/backups', { preHandler: requireAdmin }, async () => createBackup());
  app.delete('/api/backups/:name', { preHandler: requireAdmin }, async (request) => {
    const name = String((request.params as any).name || ''); const actor = actorFromRequest(request);
    const result = deleteBackup(name); recordAudit(actor, 'delete', 'backup', name, `删除数据库备份：${name}`); return result;
  });
  app.post('/api/backups/restore', { preHandler: requireAdmin }, async (request) => scheduleRestore(String(body(request).name || '')));
}
