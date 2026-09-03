import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, type ZodType } from 'zod';
import { config } from './config';
import { createSessionToken, verifyPassword } from './auth';
import {
  actorFromRequest, assertAdmin, assertCanAddProgress, assertProgressOwnerOrManager,
  assertProjectManager, assertProjectMember, assertProjectReadable, assertProjectResourceManager, assertProjectResourceReadable,
  assertRequirementOwnerOrManager, assertWorkItemParticipantOrManager, assertWorkItemRequirementOwnerOrManager,
  canManageProject, canUpdateIssueProgress, isAdmin,
  managedProjectIds, projectIdForIssue, projectIdForRequirement, projectIdForTemplate, projectIdForWorkItem, sessionActor,
} from './authorization';
import {
  changeOwnPassword, deleteAccount, findAccountForLogin, getMyWork, listAccounts, markLogin, openAccountForPerson,
  resetAccountPassword, updateAccount,
} from './accounts';
import {
  acceptRequirement, addIssueUpdate, addProgress, addProjectPerson, applyRequirementPlan, applyTemplate, archivePerson, archiveProject, archiveRequirement, archiveTemplate,
  blockWorkItem, cancelRequirement, cancelWorkItem, completeWorkItem, copyTemplate, correctIssue, correctWorkItem, createPerson, createProject, createRequirement, createTemplate,
  createIssue, createWorkItem, deleteIssueUpdate, deleteProgress, deleteWorkItem, getDashboard, getIssue, getPeopleConcurrency, getRequirement, issueToken,
  listActionItems, listArchives, listAudit, listIssues, listPeople, listPeopleCandidates, listProjects, listRequirements, listTemplates, listTokens, previewRequirementPlan,
  permanentlyDeleteArchive, recordAudit, removeProjectPerson, reorderWorkItems, reopenIssue, reopenWorkItem, reselectRequirementTemplate, rescheduleRequirement, resolveIssue, restorePerson, restoreProject, restoreRequirement, restoreTemplate, resumeIssue, revokeToken, searchAudit, startWorkItem,
  deferIssue, unblockWorkItem, updateIssue, updateIssueUpdate, updatePerson, updateProgress, updateProject, updateRequirement, updateTemplate, updateWorkItem,
} from './services';
import { createBackup, deleteBackup, listBackups, scheduleRestore } from './backups';
import { checkDatabaseIntegrity, getSystemOverview } from './system';
import { getBranding, getBrandingLogo, updateBranding } from './branding';
import {
  getAnalyticsCatalog, getAnalyticsLayout, queryAnalytics, resetAnalyticsLayout, saveAnalyticsLayout,
} from './analytics';
import {
  actionItemsInputSchema,
  archiveDeleteInputSchema,
  archiveParamsSchema,
  contentCommandSchema,
  createRequirementInputSchema,
  expectedVersionInputSchema,
  idParamsSchema,
  issueInputSchema,
  issueListInputSchema,
  issueUpdateInputSchema,
  issueUpdateParamsSchema,
  personInputSchema,
  progressInputSchema,
  projectInputSchema,
  projectMemberInputSchema,
  projectParamsSchema,
  projectPersonParamsSchema,
  reasonCommandSchema,
  rescheduleRequirementInputSchema,
  reselectRequirementTemplateInputSchema,
  templateInputSchema,
  updateRequirementInputSchema,
  workItemCommandSchema,
  workItemInputSchema,
} from '../shared/contracts';

const recordSchema = z.record(z.string(), z.unknown());
const querySchema = z.object({
  projectId: z.string().optional(), includeDeleted: z.string().optional(), q: z.string().optional(),
  limit: z.string().optional(), page: z.string().optional(), pageSize: z.string().optional(),
}).passthrough();

function parse<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value ?? {});
}

function params<T>(request: FastifyRequest, schema: ZodType<T>) {
  return parse(schema, request.params);
}

function query(request: FastifyRequest) {
  return parse(querySchema, request.query);
}

function idOf(request: FastifyRequest) {
  return params(request, idParamsSchema).id;
}

function sessionOf(request: FastifyRequest) {
  return sessionActor(request.cookies.pm_session);
}

function body(request: FastifyRequest) {
  return parse(recordSchema, request.body);
}

function parsedBody<T>(request: FastifyRequest, schema: ZodType<T>) {
  return parse(schema, request.body);
}

function parsedQuery<T>(request: FastifyRequest, schema: ZodType<T>) {
  return parse(schema, request.query);
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
  app.get('/api/branding', async () => getBranding());
  app.get('/api/branding/logo', async (_request, reply) => {
    const logo = getBrandingLogo();
    if (!logo) return reply.code(404).send({ error: '尚未配置系统Logo' });
    return reply
      .type(logo.mimeType)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(logo.content);
  });

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
  app.patch('/api/accounts/:id', { preHandler: requireAdmin }, async (request) => updateAccount(idOf(request), body(request), actorFromRequest(request)));
  app.post('/api/accounts/:id/reset-password', { preHandler: requireAdmin }, async (request) => resetAccountPassword(idOf(request), actorFromRequest(request)));
  app.delete('/api/accounts/:id', { preHandler: requireAdmin }, async (request) => deleteAccount(idOf(request), actorFromRequest(request)));
  app.post('/api/people/:id/account', { preHandler: requireAdmin }, async (request) => openAccountForPerson(idOf(request), actorFromRequest(request)));
  app.get('/api/my-work', { preHandler: requireReady }, async (request) => getMyWork(actorFromRequest(request).accountId));

  app.get('/api/projects', { preHandler: requireReady }, async (request) => listProjects(query(request).includeDeleted === 'true', actorFromRequest(request)));
  app.post('/api/projects', { preHandler: requireAdmin }, async (request) => createProject(parsedBody(request, projectInputSchema), actorFromRequest(request)));
  app.patch('/api/projects/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectManager(actor, id);
    return updateProject(id, parsedBody(request, projectInputSchema), actor);
  });
  app.delete('/api/projects/:id', { preHandler: requireAdmin }, async (request) => {
    const input = request.body ? body(request) : {};
    return archiveProject(idOf(request), actorFromRequest(request), { force: input.force === true });
  });
  app.post('/api/projects/:id/restore', { preHandler: requireAdmin }, async (request) => restoreProject(idOf(request), actorFromRequest(request)));
  app.get('/api/dashboard', { preHandler: requireReady }, async (request) => {
    const projectId = String(query(request).projectId || ''); const actor = actorFromRequest(request); assertProjectReadable(actor, projectId);
    return { ...getDashboard(projectId), actions: listActionItems({ projectId, page: 1, pageSize: 5 }, actor) };
  });
  app.get('/api/action-items', { preHandler: requireReady }, async (request) => {
    const input = parsedQuery(request, actionItemsInputSchema); const actor = actorFromRequest(request);
    assertProjectReadable(actor, input.projectId);
    return listActionItems(input, actor);
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
    const input = query(request); const projectId = String(input.projectId || ''); assertProjectReadable(actorFromRequest(request), projectId);
    return listRequirements({
      projectId,
      includeDeleted: input.includeDeleted === 'true',
      status: typeof input.status === 'string' ? input.status : undefined,
      view: typeof input.view === 'string' ? input.view : undefined,
    });
  });
  app.get('/api/requirements/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); assertProjectResourceReadable(actorFromRequest(request), projectIdForRequirement(id), '需求不存在');
    return getRequirement(id, query(request).includeDeleted === 'true');
  });
  app.post('/api/requirements', { preHandler: requireReady }, async (request) => {
    const input = parsedBody(request, createRequirementInputSchema); const actor = actorFromRequest(request); assertProjectManager(actor, input.projectId);
    return createRequirement(input, actor);
  });
  app.patch('/api/requirements/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return updateRequirement(id, parsedBody(request, updateRequirementInputSchema), actor);
  });
  app.post('/api/requirements/:id/accept', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return acceptRequirement(id, parsedBody(request, contentCommandSchema), actor);
  });
  app.post('/api/requirements/:id/cancel', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return cancelRequirement(id, parsedBody(request, reasonCommandSchema), actor);
  });
  app.post('/api/requirements/:id/reschedule', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return rescheduleRequirement(id, parsedBody(request, rescheduleRequirementInputSchema), actor);
  });
  app.post('/api/requirements/:id/reselect-template', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return reselectRequirementTemplate(id, parsedBody(request, reselectRequirementTemplateInputSchema), actor);
  });
  app.delete('/api/requirements/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return archiveRequirement(id, parsedBody(request, expectedVersionInputSchema), actor);
  });
  app.post('/api/requirements/:id/restore', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return restoreRequirement(id, actor);
  });
  app.post('/api/requirements/:id/apply-template', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return applyTemplate(id, body(request), actor);
  });
  app.post('/api/requirements/:id/plan-preview', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); assertProjectResourceManager(actorFromRequest(request), projectIdForRequirement(id), '需求不存在');
    return previewRequirementPlan(id, body(request));
  });
  app.post('/api/requirements/:id/apply-plan', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return applyRequirementPlan(id, body(request), actor);
  });
  app.post('/api/requirements/:id/work-items', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertRequirementOwnerOrManager(actor, id);
    return createWorkItem(id, parsedBody(request, workItemInputSchema), actor);
  });
  app.post('/api/requirements/:id/reorder-work-items', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertRequirementOwnerOrManager(actor, id);
    const input = body(request); return reorderWorkItems(id, input.ids as string[], actor, input);
  });
  app.post('/api/requirements/:id/progress', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const input = parsedBody(request, progressInputSchema); const actor = actorFromRequest(request);
    assertCanAddProgress(actor, id, input.workItemId ? String(input.workItemId) : null);
    return addProgress(id, input, actor);
  });

  app.patch('/api/work-items/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const input = parsedBody(request, workItemInputSchema); const actor = actorFromRequest(request);
    assertWorkItemRequirementOwnerOrManager(actor, id);
    return updateWorkItem(id, input, actor);
  });
  for (const [action, handler] of [
    ['start', (id: string, input: any, actor: any) => startWorkItem(id, input, actor)],
    ['complete', (id: string, input: any, actor: any) => completeWorkItem(id, input, actor)],
    ['block', (id: string, input: any, actor: any) => blockWorkItem(id, input, actor)],
    ['unblock', (id: string, input: any, actor: any) => unblockWorkItem(id, input, actor)],
  ] as const) {
    app.post(`/api/work-items/:id/${action}`, { preHandler: requireReady }, async (request) => {
      const id = idOf(request); const actor = actorFromRequest(request); assertWorkItemParticipantOrManager(actor, id);
      return handler(id, parsedBody(request, workItemCommandSchema), actor);
    });
  }
  app.post('/api/work-items/:id/cancel', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertWorkItemRequirementOwnerOrManager(actor, id);
    return cancelWorkItem(id, parsedBody(request, workItemCommandSchema), actor);
  });
  app.post('/api/work-items/:id/reopen', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertWorkItemRequirementOwnerOrManager(actor, id);
    return reopenWorkItem(id, parsedBody(request, workItemCommandSchema), actor);
  });
  app.post('/api/work-items/:id/correct', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForWorkItem(id), '工作项不存在');
    return correctWorkItem(id, parsedBody(request, workItemCommandSchema), actor);
  });
  app.delete('/api/work-items/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertWorkItemRequirementOwnerOrManager(actor, id);
    return deleteWorkItem(id, parsedBody(request, workItemCommandSchema), actor);
  });
  app.patch('/api/progress/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); const input = body(request);
    assertProgressOwnerOrManager(actor, id, Object.prototype.hasOwnProperty.call(input, 'workItemId') ? (input.workItemId ? String(input.workItemId) : null) : undefined);
    return updateProgress(id, input, actor);
  });
  app.delete('/api/progress/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProgressOwnerOrManager(actor, id);
    return deleteProgress(id, actor);
  });

  app.get('/api/issues', { preHandler: requireReady }, async (request) => {
    const input = parsedQuery(request, issueListInputSchema); assertProjectReadable(actorFromRequest(request), input.projectId);
    return listIssues(input);
  });
  app.get('/api/issues/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); assertProjectResourceReadable(actorFromRequest(request), projectIdForIssue(id), '问题不存在');
    return getIssue(id);
  });
  app.post('/api/issues', { preHandler: requireReady }, async (request) => {
    const input = parsedBody(request, issueInputSchema); const actor = actorFromRequest(request); const projectId = String(input.projectId || '');
    assertProjectMember(actor, projectId);
    return createIssue(canManageProject(actor, projectId) ? input : { ...input, ownerId: null, progress: 0 }, actor);
  });
  app.patch('/api/issues/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在');
    return updateIssue(id, parsedBody(request, issueInputSchema), actor);
  });
  for (const [action, handler] of [
    ['defer', deferIssue], ['resume', resumeIssue], ['resolve', resolveIssue], ['reopen', reopenIssue], ['correct', correctIssue],
  ] as const) {
    app.post(`/api/issues/:id/${action}`, { preHandler: requireReady }, async (request) => {
      const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在');
      return handler(id, parsedBody(request, workItemCommandSchema), actor);
    });
  }
  app.post('/api/issues/:id/updates', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); const projectId = projectIdForIssue(id);
    assertProjectResourceReadable(actor, projectId, '问题不存在'); assertProjectMember(actor, projectId);
    return addIssueUpdate(id, parsedBody(request, issueUpdateInputSchema), actor, {
      canSetProgress: canUpdateIssueProgress(actor, id),
      canResolve: canManageProject(actor, projectId),
    });
  });
  app.patch('/api/issues/:id/updates/:updateId', { preHandler: requireReady }, async (request) => {
    const { id, updateId } = params(request, issueUpdateParamsSchema); const actor = actorFromRequest(request);
    assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在');
    return updateIssueUpdate(id, updateId, body(request), actor);
  });
  app.delete('/api/issues/:id/updates/:updateId', { preHandler: requireReady }, async (request) => {
    const { id, updateId } = params(request, issueUpdateParamsSchema); const actor = actorFromRequest(request);
    assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在');
    return deleteIssueUpdate(id, updateId, actor);
  });

  app.get('/api/people', { preHandler: requireReady }, async (request) => {
    const input = query(request); const actor = actorFromRequest(request); const projectId = String(input.projectId || '');
    if (projectId) assertProjectReadable(actor, projectId); else assertAdmin(actor);
    return listPeople(input.includeDeleted === 'true', projectId || undefined);
  });
  app.get('/api/people/candidates', { preHandler: requireReady }, async (request) => {
    const input = query(request); const projectId = String(input.projectId || ''); assertProjectManager(actorFromRequest(request), projectId);
    return listPeopleCandidates(projectId, String(input.q || ''));
  });
  app.post('/api/people', { preHandler: requireAdmin }, async (request) => createPerson(parsedBody(request, personInputSchema), actorFromRequest(request)));
  app.patch('/api/people/:id', { preHandler: requireAdmin }, async (request) => updatePerson(idOf(request), parsedBody(request, personInputSchema), actorFromRequest(request)));
  app.delete('/api/people/:id', { preHandler: requireAdmin }, async (request) => archivePerson(idOf(request), actorFromRequest(request)));
  app.post('/api/people/:id/restore', { preHandler: requireAdmin }, async (request) => restorePerson(idOf(request), actorFromRequest(request)));
  app.get('/api/projects/:projectId/members', { preHandler: requireReady }, async (request) => {
    const { projectId } = params(request, projectParamsSchema); assertProjectReadable(actorFromRequest(request), projectId);
    return listPeople(false, projectId);
  });
  app.put('/api/projects/:projectId/members/:personId', { preHandler: requireReady }, async (request) => {
    const { projectId, personId } = params(request, projectPersonParamsSchema); const actor = actorFromRequest(request);
    assertProjectManager(actor, projectId); return addProjectPerson(projectId, personId, actor, parsedBody(request, projectMemberInputSchema).role);
  });
  app.delete('/api/projects/:projectId/members/:personId', { preHandler: requireReady }, async (request) => {
    const { projectId, personId } = params(request, projectPersonParamsSchema); const actor = actorFromRequest(request);
    assertProjectManager(actor, projectId); return removeProjectPerson(projectId, personId, actor);
  });
  app.post('/api/projects/:projectId/people/:personId', { preHandler: requireReady }, async (request) => {
    const { projectId, personId } = params(request, projectPersonParamsSchema); const actor = actorFromRequest(request);
    assertProjectManager(actor, projectId); return addProjectPerson(projectId, personId, actor, parsedBody(request, projectMemberInputSchema).role);
  });
  app.delete('/api/projects/:projectId/people/:personId', { preHandler: requireReady }, async (request) => {
    const { projectId, personId } = params(request, projectPersonParamsSchema); const actor = actorFromRequest(request);
    assertProjectManager(actor, projectId); return removeProjectPerson(projectId, personId, actor);
  });

  app.get('/api/templates', { preHandler: requireReady }, async (request) => {
    const input = query(request); const projectId = String(input.projectId || ''); assertProjectReadable(actorFromRequest(request), projectId);
    return listTemplates(projectId, input.includeDeleted === 'true');
  });
  app.post('/api/templates', { preHandler: requireReady }, async (request) => {
    const input = parsedBody(request, templateInputSchema); assertProjectManager(actorFromRequest(request), String(input.projectId || ''));
    return createTemplate(input, actorFromRequest(request));
  });
  app.patch('/api/templates/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); assertProjectResourceManager(actorFromRequest(request), projectIdForTemplate(id), '流程设计不存在');
    return updateTemplate(id, parsedBody(request, templateInputSchema), actorFromRequest(request));
  });
  app.delete('/api/templates/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); assertProjectResourceManager(actorFromRequest(request), projectIdForTemplate(id), '流程设计不存在');
    return archiveTemplate(id, actorFromRequest(request));
  });
  app.post('/api/templates/:id/restore', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); assertProjectResourceManager(actorFromRequest(request), projectIdForTemplate(id), '流程设计不存在');
    return restoreTemplate(id, actorFromRequest(request));
  });
  app.post('/api/projects/:projectId/templates/:sourceTemplateId/copy', { preHandler: requireReady }, async (request) => {
    const { projectId, sourceTemplateId } = params(request, z.object({ projectId: z.string().min(1), sourceTemplateId: z.string().min(1) })); const actor = actorFromRequest(request);
    assertProjectManager(actor, projectId); assertProjectResourceReadable(actor, projectIdForTemplate(sourceTemplateId), '来源流程不存在');
    return copyTemplate(projectId, sourceTemplateId, actor);
  });

  app.get('/api/analytics/people-concurrency', { preHandler: requireReady }, async (request) => {
    const input = query(request); const actor = actorFromRequest(request); const projectId = String(input.projectId || '');
    if (projectId) assertProjectReadable(actor, projectId); else assertAdmin(actor);
    return getPeopleConcurrency({ ...input, projectId: projectId || undefined, includeExternalAggregate: Boolean(projectId && canManageProject(actor, projectId)) });
  });
  app.get('/api/archives', { preHandler: requireReady }, async (request) => {
    const actor = actorFromRequest(request); const projectId = String(query(request).projectId || '');
    if (isAdmin(actor) && !projectId) return listArchives();
    assertProjectManager(actor, projectId); return listArchives(projectId);
  });
  app.delete('/api/archives/:entity/:id', { preHandler: requireAdmin }, async (request) => {
    const { entity, id } = params(request, archiveParamsSchema);
    return permanentlyDeleteArchive(entity, id, actorFromRequest(request), parsedBody(request, archiveDeleteInputSchema));
  });

  app.get('/api/tokens', { preHandler: requireReady }, async (request) => listTokens(actorFromRequest(request).accountId));
  app.post('/api/tokens', { preHandler: requireReady }, async (request) => issueToken(body(request), actorFromRequest(request)));
  app.delete('/api/tokens/:id', { preHandler: requireReady }, async (request) => revokeToken(idOf(request), actorFromRequest(request)));
  app.get('/api/admin/tokens', { preHandler: requireAdmin }, async () => listTokens(undefined, true));
  app.delete('/api/admin/tokens/:id', { preHandler: requireAdmin }, async (request) => revokeToken(idOf(request), actorFromRequest(request), true));
  app.get('/api/audit', { preHandler: requireReady }, async (request) => {
    const input = query(request); const actor = actorFromRequest(request); const projectId = String(input.projectId || '');
    if (!isAdmin(actor)) assertProjectManager(actor, projectId);
    return listAudit(Number(input.limit || 100), projectId || undefined);
  });
  app.get('/api/audit/search', { preHandler: requireReady }, async (request) => {
    const input = query(request); const actor = actorFromRequest(request); const projectId = String(input.projectId || '');
    if (!isAdmin(actor)) assertProjectManager(actor, projectId);
    return searchAudit({
      q: input.q,
      actorType: typeof input.actorType === 'string' ? input.actorType : undefined,
      action: typeof input.action === 'string' ? input.action : undefined,
      entityType: typeof input.entityType === 'string' ? input.entityType : undefined,
      projectId: projectId || undefined,
      from: typeof input.from === 'string' ? input.from : undefined,
      to: typeof input.to === 'string' ? input.to : undefined,
      page: input.page ? Number(input.page) : undefined,
      pageSize: input.pageSize ? Number(input.pageSize) : undefined,
    });
  });

  app.get('/api/system/overview', { preHandler: requireAdmin }, async () => getSystemOverview());
  app.post('/api/system/database-check', { preHandler: requireAdmin }, async () => checkDatabaseIntegrity());
  app.put('/api/system/branding', { preHandler: requireAdmin }, async (request) => {
    const actor = actorFromRequest(request);
    const result = updateBranding(body(request));
    recordAudit(actor, 'update', 'system_branding', 'default', `更新系统品牌：${result.systemName}（${result.shortName}）`);
    return result;
  });
  app.get('/api/backups', { preHandler: requireAdmin }, async () => listBackups());
  app.post('/api/backups', { preHandler: requireAdmin }, async (request) => {
    const actor = actorFromRequest(request); const result = await createBackup();
    recordAudit(actor, 'create', 'backup', result.name, `创建数据库备份：${result.name}`); return result;
  });
  app.delete('/api/backups/:name', { preHandler: requireAdmin }, async (request) => {
    const { name } = params(request, z.object({ name: z.string().min(1) })); const actor = actorFromRequest(request);
    const result = deleteBackup(name); recordAudit(actor, 'delete', 'backup', name, `删除数据库备份：${name}`); return result;
  });
  app.post('/api/backups/restore', { preHandler: requireAdmin }, async (request) => {
    const name = String(body(request).name || ''); const actor = actorFromRequest(request);
    const result = await scheduleRestore(name);
    recordAudit(actor, 'restore', 'backup', name, `恢复数据库备份：${name}；恢复前备份：${result.safetyBackupName}`);
    return result;
  });
}
