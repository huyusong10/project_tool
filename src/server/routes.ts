import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config';
import { createSessionToken, verifyPassword } from './auth';
import {
  actorFromRequest, assertAdmin, assertCanAddProgress, assertProgressOwnerOrManager,
  assertProjectManager, assertProjectMember, assertProjectReadable, assertProjectResourceManager, assertProjectResourceReadable,
  assertWorkItemParticipantOrManager, canManageProject, canUpdateIssueProgress, isAdmin,
  managedProjectIds, projectIdForIssue, projectIdForRequirement, projectIdForTemplate, projectIdForWorkItem, sessionActor,
} from './authorization';
import {
  changeOwnPassword, findAccountForLogin, getMyWork, listAccounts, markLogin,
  resetAccountPassword, updateAccount,
} from './accounts';
import {
  acceptRequirement, addIssueUpdate, addProgress, addProjectPerson, applyRequirementPlan, applyTemplate, archivePerson, archiveProject, archiveRequirement, archiveTemplate,
  blockWorkItem, cancelRequirement, cancelWorkItem, completeWorkItem, copyTemplate, correctIssue, correctWorkItem, createPerson, createProject, createRequirement, createTemplate,
  createIssue, createWorkItem, deleteIssueUpdate, deleteProgress, deleteWorkItem, getDashboard, getIssue, getPeopleConcurrency, getRequirement, issueToken,
  listArchives, listAudit, listIssues, listPeople, listPeopleCandidates, listProjects, listRequirements, listTemplates, listTokens, previewRequirementPlan,
  permanentlyDeleteArchive, recordAudit, removeProjectPerson, reorderWorkItems, reopenIssue, reopenWorkItem, reselectRequirementTemplate, rescheduleRequirement, resolveIssue, restorePerson, restoreProject, restoreRequirement, restoreTemplate, resumeIssue, revokeToken, searchAudit, startIssue, startWorkItem,
  deferIssue, unblockWorkItem, updateIssue, updateIssueUpdate, updatePerson, updateProgress, updateProject, updateRequirement, updateTemplate, updateWorkItem,
} from './services';
import { createBackup, deleteBackup, listBackups, scheduleRestore } from './backups';
import { checkDatabaseIntegrity, getSystemOverview } from './system';
import {
  getAnalyticsCatalog, getAnalyticsLayout, queryAnalytics, resetAnalyticsLayout, saveAnalyticsLayout,
} from './analytics';

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
  app.post('/api/login', { config: { rateLimit: { max: config.nodeEnv === 'test' ? 100 : 8, timeWindow: '1 minute' } } }, async (request, reply) => {
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

  app.get('/api/projects', { preHandler: requireReady }, async (request) => listProjects((request.query as any).includeDeleted === 'true', actorFromRequest(request)));
  app.post('/api/projects', { preHandler: requireAdmin }, async (request) => createProject(body(request), actorFromRequest(request)));
  app.patch('/api/projects/:id', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectManager(actor, id);
    return updateProject(id, body(request), actor);
  });
  app.delete('/api/projects/:id', { preHandler: requireAdmin }, async (request) => archiveProject((request.params as any).id, actorFromRequest(request)));
  app.post('/api/projects/:id/restore', { preHandler: requireAdmin }, async (request) => restoreProject((request.params as any).id, actorFromRequest(request)));
  app.get('/api/dashboard', { preHandler: requireReady }, async (request) => {
    const projectId = String((request.query as any).projectId || ''); assertProjectReadable(actorFromRequest(request), projectId);
    return getDashboard(projectId);
  });
  app.get('/api/analytics/catalog', async () => getAnalyticsCatalog());
  app.post('/api/analytics/query', { preHandler: requireReady }, async (request) => {
    const input = body(request); assertProjectReadable(actorFromRequest(request), String(input.projectId || ''));
    return queryAnalytics(input);
  });
  app.get('/api/analytics/layout', { preHandler: requireReady }, async (request) => {
    const actor = actorFromRequest(request);
    return getAnalyticsLayout(actor.accountId, true);
  });
  app.put('/api/analytics/layout', { preHandler: requireReady }, async (request) => {
    const actor = actorFromRequest(request);
    return saveAnalyticsLayout(actor.accountId, body(request), actor);
  });
  app.delete('/api/analytics/layout', { preHandler: requireReady }, async (request) => {
    const actor = actorFromRequest(request);
    return resetAnalyticsLayout(actor.accountId, actor);
  });

  app.get('/api/requirements', { preHandler: requireReady }, async (request) => {
    const projectId = String((request.query as any).projectId || ''); assertProjectReadable(actorFromRequest(request), projectId);
    return listRequirements({ ...(request.query as any), projectId });
  });
  app.get('/api/requirements/:id', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; assertProjectResourceReadable(actorFromRequest(request), projectIdForRequirement(id), '需求不存在');
    return getRequirement(id, (request.query as any).includeDeleted === 'true');
  });
  app.post('/api/requirements', { preHandler: requireReady }, async (request) => {
    const input = body(request); const actor = actorFromRequest(request); assertProjectManager(actor, String(input.projectId || ''));
    return createRequirement(input, actor);
  });
  app.patch('/api/requirements/:id', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return updateRequirement(id, body(request), actor);
  });
  app.post('/api/requirements/:id/accept', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return acceptRequirement(id, body(request), actor);
  });
  app.post('/api/requirements/:id/cancel', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return cancelRequirement(id, body(request), actor);
  });
  app.post('/api/requirements/:id/reschedule', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return rescheduleRequirement(id, body(request), actor);
  });
  app.post('/api/requirements/:id/reselect-template', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return reselectRequirementTemplate(id, body(request), actor);
  });
  app.delete('/api/requirements/:id', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return archiveRequirement(id, body(request), actor);
  });
  app.post('/api/requirements/:id/restore', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return restoreRequirement(id, actor);
  });
  app.post('/api/requirements/:id/apply-template', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return applyTemplate(id, body(request), actor);
  });
  app.post('/api/requirements/:id/plan-preview', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; assertProjectResourceManager(actorFromRequest(request), projectIdForRequirement(id), '需求不存在');
    return previewRequirementPlan(id, body(request));
  });
  app.post('/api/requirements/:id/apply-plan', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return applyRequirementPlan(id, body(request), actor);
  });
  app.post('/api/requirements/:id/work-items', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return createWorkItem(id, body(request), actor);
  });
  app.post('/api/requirements/:id/reorder-work-items', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    const input = body(request); return reorderWorkItems(id, input.ids as string[], actor, input);
  });
  app.post('/api/requirements/:id/progress', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const input = body(request); const actor = actorFromRequest(request);
    assertCanAddProgress(actor, id, input.workItemId ? String(input.workItemId) : null);
    return addProgress(id, input, actor);
  });

  app.patch('/api/work-items/:id', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const input = body(request); const actor = actorFromRequest(request);
    assertProjectResourceReadable(actor, projectIdForWorkItem(id), '工作项不存在');
    assertProjectResourceManager(actor, projectIdForWorkItem(id), '工作项不存在');
    return updateWorkItem(id, input, actor);
  });
  for (const [action, handler] of [
    ['start', (id: string, input: any, actor: any) => startWorkItem(id, input, actor)],
    ['complete', (id: string, input: any, actor: any) => completeWorkItem(id, input, actor)],
    ['block', (id: string, input: any, actor: any) => blockWorkItem(id, input, actor)],
    ['unblock', (id: string, input: any, actor: any) => unblockWorkItem(id, input, actor)],
  ] as const) {
    app.post(`/api/work-items/:id/${action}`, { preHandler: requireReady }, async (request) => {
      const id = (request.params as any).id; const actor = actorFromRequest(request); assertWorkItemParticipantOrManager(actor, id);
      return handler(id, body(request), actor);
    });
  }
  app.post('/api/work-items/:id/cancel', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForWorkItem(id), '工作项不存在');
    return cancelWorkItem(id, body(request), actor);
  });
  app.post('/api/work-items/:id/reopen', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForWorkItem(id), '工作项不存在');
    return reopenWorkItem(id, body(request), actor);
  });
  app.post('/api/work-items/:id/correct', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForWorkItem(id), '工作项不存在');
    return correctWorkItem(id, body(request), actor);
  });
  app.delete('/api/work-items/:id', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForWorkItem(id), '工作项不存在');
    return deleteWorkItem(id, body(request), actor);
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

  app.get('/api/issues', { preHandler: requireReady }, async (request) => {
    const projectId = String((request.query as any).projectId || ''); assertProjectReadable(actorFromRequest(request), projectId);
    return listIssues({ ...(request.query as any), projectId });
  });
  app.get('/api/issues/:id', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; assertProjectResourceReadable(actorFromRequest(request), projectIdForIssue(id), '问题不存在');
    return getIssue(id);
  });
  app.post('/api/issues', { preHandler: requireReady }, async (request) => {
    const input = body(request); const actor = actorFromRequest(request); const projectId = String(input.projectId || '');
    assertProjectMember(actor, projectId);
    return createIssue(canManageProject(actor, projectId) ? input : { ...input, status: 'open', ownerId: null, progress: 0 }, actor);
  });
  app.patch('/api/issues/:id', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在');
    return updateIssue(id, body(request), actor);
  });
  app.post('/api/issues/:id/start', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); const projectId = projectIdForIssue(id);
    assertProjectResourceReadable(actor, projectId, '问题不存在');
    if (!canUpdateIssueProgress(actor, id)) { const error = new Error('只有问题负责人或项目经理可以开始处理') as Error & { statusCode: number }; error.statusCode = 403; throw error; }
    return startIssue(id, body(request), actor);
  });
  for (const [action, handler] of [
    ['defer', deferIssue], ['resume', resumeIssue], ['resolve', resolveIssue], ['reopen', reopenIssue], ['correct', correctIssue],
  ] as const) {
    app.post(`/api/issues/:id/${action}`, { preHandler: requireReady }, async (request) => {
      const id = (request.params as any).id; const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在');
      return handler(id, body(request), actor);
    });
  }
  app.post('/api/issues/:id/updates', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; const actor = actorFromRequest(request); const projectId = projectIdForIssue(id);
    assertProjectResourceReadable(actor, projectId, '问题不存在'); assertProjectMember(actor, projectId);
    return addIssueUpdate(id, body(request), actor, {
      canSetProgress: canUpdateIssueProgress(actor, id),
      canResolve: canManageProject(actor, projectId),
    });
  });
  app.patch('/api/issues/:id/updates/:updateId', { preHandler: requireReady }, async (request) => {
    const { id, updateId } = request.params as { id: string; updateId: string }; const actor = actorFromRequest(request);
    assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在');
    return updateIssueUpdate(id, updateId, body(request), actor);
  });
  app.delete('/api/issues/:id/updates/:updateId', { preHandler: requireReady }, async (request) => {
    const { id, updateId } = request.params as { id: string; updateId: string }; const actor = actorFromRequest(request);
    assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在');
    return deleteIssueUpdate(id, updateId, actor);
  });

  app.get('/api/people', { preHandler: requireReady }, async (request) => {
    const actor = actorFromRequest(request); const projectId = String((request.query as any).projectId || '');
    if (projectId) assertProjectReadable(actor, projectId); else assertAdmin(actor);
    return listPeople((request.query as any).includeDeleted === 'true', projectId || undefined);
  });
  app.get('/api/people/candidates', { preHandler: requireReady }, async (request) => {
    const projectId = String((request.query as any).projectId || ''); assertProjectManager(actorFromRequest(request), projectId);
    return listPeopleCandidates(projectId, String((request.query as any).q || ''));
  });
  app.post('/api/people', { preHandler: requireAdmin }, async (request) => createPerson(body(request), actorFromRequest(request)));
  app.patch('/api/people/:id', { preHandler: requireAdmin }, async (request) => updatePerson((request.params as any).id, body(request), actorFromRequest(request)));
  app.delete('/api/people/:id', { preHandler: requireAdmin }, async (request) => archivePerson((request.params as any).id, actorFromRequest(request)));
  app.post('/api/people/:id/restore', { preHandler: requireAdmin }, async (request) => restorePerson((request.params as any).id, actorFromRequest(request)));
  app.get('/api/projects/:projectId/members', { preHandler: requireReady }, async (request) => {
    const { projectId } = request.params as { projectId: string }; assertProjectReadable(actorFromRequest(request), projectId);
    return listPeople(false, projectId);
  });
  app.put('/api/projects/:projectId/members/:personId', { preHandler: requireReady }, async (request) => {
    const { projectId, personId } = request.params as { projectId: string; personId: string }; const actor = actorFromRequest(request);
    assertProjectManager(actor, projectId); return addProjectPerson(projectId, personId, actor, body(request).role || 'member');
  });
  app.delete('/api/projects/:projectId/members/:personId', { preHandler: requireReady }, async (request) => {
    const { projectId, personId } = request.params as { projectId: string; personId: string }; const actor = actorFromRequest(request);
    assertProjectManager(actor, projectId); return removeProjectPerson(projectId, personId, actor);
  });
  app.post('/api/projects/:projectId/people/:personId', { preHandler: requireReady }, async (request) => {
    const { projectId, personId } = request.params as { projectId: string; personId: string }; const actor = actorFromRequest(request);
    assertProjectManager(actor, projectId); return addProjectPerson(projectId, personId, actor, body(request).role || 'member');
  });
  app.delete('/api/projects/:projectId/people/:personId', { preHandler: requireReady }, async (request) => {
    const { projectId, personId } = request.params as { projectId: string; personId: string }; const actor = actorFromRequest(request);
    assertProjectManager(actor, projectId); return removeProjectPerson(projectId, personId, actor);
  });

  app.get('/api/templates', { preHandler: requireReady }, async (request) => {
    const projectId = String((request.query as any).projectId || ''); assertProjectReadable(actorFromRequest(request), projectId);
    return listTemplates(projectId, (request.query as any).includeDeleted === 'true');
  });
  app.post('/api/templates', { preHandler: requireReady }, async (request) => {
    const input = body(request); assertProjectManager(actorFromRequest(request), String(input.projectId || ''));
    return createTemplate(input, actorFromRequest(request));
  });
  app.patch('/api/templates/:id', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; assertProjectResourceManager(actorFromRequest(request), projectIdForTemplate(id), '流程设计不存在');
    return updateTemplate(id, body(request), actorFromRequest(request));
  });
  app.delete('/api/templates/:id', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; assertProjectResourceManager(actorFromRequest(request), projectIdForTemplate(id), '流程设计不存在');
    return archiveTemplate(id, actorFromRequest(request));
  });
  app.post('/api/templates/:id/restore', { preHandler: requireReady }, async (request) => {
    const id = (request.params as any).id; assertProjectResourceManager(actorFromRequest(request), projectIdForTemplate(id), '流程设计不存在');
    return restoreTemplate(id, actorFromRequest(request));
  });
  app.post('/api/projects/:projectId/templates/:sourceTemplateId/copy', { preHandler: requireReady }, async (request) => {
    const { projectId, sourceTemplateId } = request.params as { projectId: string; sourceTemplateId: string }; const actor = actorFromRequest(request);
    assertProjectManager(actor, projectId); assertProjectResourceReadable(actor, projectIdForTemplate(sourceTemplateId), '来源流程不存在');
    return copyTemplate(projectId, sourceTemplateId, actor);
  });

  app.get('/api/analytics/people-concurrency', { preHandler: requireReady }, async (request) => {
    const actor = actorFromRequest(request); const projectId = String((request.query as any).projectId || '');
    if (projectId) assertProjectReadable(actor, projectId); else assertAdmin(actor);
    return getPeopleConcurrency({ ...(request.query as any), projectId: projectId || undefined, includeExternalAggregate: Boolean(projectId && canManageProject(actor, projectId)) });
  });
  app.get('/api/archives', { preHandler: requireReady }, async (request) => {
    const actor = actorFromRequest(request); const projectId = String((request.query as any).projectId || '');
    if (isAdmin(actor) && !projectId) return listArchives();
    assertProjectManager(actor, projectId); return listArchives(projectId);
  });
  app.delete('/api/archives/:entity/:id', { preHandler: requireAdmin }, async (request) => {
    const { entity, id } = request.params as { entity: 'projects' | 'requirements' | 'people' | 'templates'; id: string };
    return permanentlyDeleteArchive(entity, id, actorFromRequest(request), body(request));
  });

  app.get('/api/tokens', { preHandler: requireReady }, async (request) => listTokens(actorFromRequest(request).accountId));
  app.post('/api/tokens', { preHandler: requireReady }, async (request) => issueToken(body(request), actorFromRequest(request)));
  app.delete('/api/tokens/:id', { preHandler: requireReady }, async (request) => revokeToken((request.params as any).id, actorFromRequest(request)));
  app.get('/api/admin/tokens', { preHandler: requireAdmin }, async () => listTokens(undefined, true));
  app.delete('/api/admin/tokens/:id', { preHandler: requireAdmin }, async (request) => revokeToken((request.params as any).id, actorFromRequest(request), true));
  app.get('/api/audit', { preHandler: requireReady }, async (request) => {
    const actor = actorFromRequest(request); const projectId = String((request.query as any).projectId || '');
    if (!isAdmin(actor)) assertProjectManager(actor, projectId);
    return listAudit(Number((request.query as any).limit || 100), projectId || undefined);
  });
  app.get('/api/audit/search', { preHandler: requireReady }, async (request) => {
    const actor = actorFromRequest(request); const projectId = String((request.query as any).projectId || '');
    if (!isAdmin(actor)) assertProjectManager(actor, projectId);
    return searchAudit({ ...(request.query as any), projectId: projectId || undefined });
  });

  app.get('/api/system/overview', { preHandler: requireAdmin }, async () => getSystemOverview());
  app.post('/api/system/database-check', { preHandler: requireAdmin }, async () => checkDatabaseIntegrity());
  app.get('/api/backups', { preHandler: requireAdmin }, async () => listBackups());
  app.post('/api/backups', { preHandler: requireAdmin }, async (request) => {
    const actor = actorFromRequest(request); const result = await createBackup();
    recordAudit(actor, 'create', 'backup', result.name, `创建数据库备份：${result.name}`); return result;
  });
  app.delete('/api/backups/:name', { preHandler: requireAdmin }, async (request) => {
    const name = String((request.params as any).name || ''); const actor = actorFromRequest(request);
    const result = deleteBackup(name); recordAudit(actor, 'delete', 'backup', name, `删除数据库备份：${name}`); return result;
  });
  app.post('/api/backups/restore', { preHandler: requireAdmin }, async (request) => {
    const name = String(body(request).name || ''); const actor = actorFromRequest(request);
    const result = await scheduleRestore(name);
    recordAudit(actor, 'restore', 'backup', name, `恢复数据库备份：${name}；恢复前备份：${result.safetyBackupName}`);
    return result;
  });
}
