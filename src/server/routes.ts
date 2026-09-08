import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, type ZodType } from 'zod';
import { todayIso } from '../shared/domain';
import { config } from './config';
import { createSessionToken, verifyPassword } from './auth';
import {
  actorFromRequest, assertAdmin, assertCanAddProgress, assertProgressOwnerOrManager,
  assertProjectManager, assertProjectMember, assertProjectReadable, assertProjectResourceManager, assertProjectResourceReadable,
  assertRequirementOwnerOrManager, assertWorkItemParticipantOrManager, assertWorkItemRequirementOwnerOrManager,
  canManageProject, canUpdateIssueProgress, isAdmin,
  managedProjectIds, projectIdForIssue, projectIdForRequirement, projectIdForTemplate, projectIdForWorkItem, requireAuthorizationActor, sessionActor,
} from './authorization';
import {
  changeOwnPassword, deleteAccount, findAccountForLogin, getMyWork, listAccounts, markLogin, openAccountForPerson,
  resetAccountPassword, updateAccount,
} from './accounts';
import {
  acceptRequirement, addIssueUpdate, addProgress, addProjectPerson, applyRequirementPlan, applyTemplate, archivePerson, archiveProject, archiveRequirement, archiveTemplate,
  blockWorkItem, cancelRequirement, cancelWorkItem, completeWorkItem, copyTemplate, correctIssue, correctRequirement, correctWorkItem, createPerson, createProject, createRequirement, createTemplate,
  createIssue, createWorkItem, deleteIssueUpdate, deleteProgress, deleteWorkItem, getDashboard, getIssue, getPeopleConcurrency, getRequirement, issueToken,
  listActionItems, listArchives, listAudit, listIssues, listPeople, listPeopleCandidates, listProjects, listRequirements, listTemplates, listTokens, previewRequirementPlan,
  permanentlyDeleteArchive, recordAudit, removeProjectPerson, reorderWorkItems, reopenIssue, reopenWorkItem, reselectRequirementTemplate, rescheduleRequirement, resolveIssue, restorePerson, restoreProject, restoreRequirement, restoreTemplate, resumeIssue, revokeToken, searchAudit, startWorkItem,
  deferIssue, unblockWorkItem, updateIssue, updateIssueUpdate, updatePerson, updateProgress, updateProject, updateRequirement, updateTemplate, updateWorkItem,
} from './services';
import { createBackup, deleteBackup, listRestorableBackups, recordRestoreAudit, scheduleRestore } from './backups';
import { completeRequirementAsPlanned, completeWorkItemAsPlanned } from './services';
import { checkDatabaseIntegrity, getSystemOverview } from './system';
import { getBranding, getBrandingLogo, updateBranding } from './branding';
import {
  getAnalyticsCatalog, getAnalyticsLayout, queryAnalytics, resetAnalyticsLayout, saveAnalyticsLayout,
} from './analytics';
import {
  accountCommandSchema,
  accountInputSchema,
  analyticsQueryInputSchema,
  apiTokenInputSchema,
  actionItemsInputSchema,
  applyRequirementPlanInputSchema,
  applyTemplateInputSchema,
  archiveListInputSchema,
  archiveDeleteInputSchema,
  archiveRestoreInputSchema,
  archiveParamsSchema,
  auditListInputSchema,
  backupDeleteInputSchema,
  backupRestoreInputSchema,
  brandingInputSchema,
  changePasswordInputSchema,
  contentCommandSchema,
  optionalContentCommandSchema,
  completeAsPlannedInputSchema,
  copyTemplateInputSchema,
  createIssueInputSchema,
  createPersonInputSchema,
  createProjectInputSchema,
  createRequirementInputSchema,
  createTemplateInputSchema,
  createWorkItemInputSchema,
  emptyCommandInputSchema,
  expectedVersionInputSchema,
  idParamsSchema,
  issueCorrectionInputSchema,
  issueListInputSchema,
  issueUpdateHistoryInputSchema,
  issueUpdateInputSchema,
  issueUpdateParamsSchema,
  loginInputSchema,
  openAccountInputSchema,
  personCommandSchema,
  updatePersonInputSchema,
  peopleListInputSchema,
  personCandidatesInputSchema,
  progressInputSchema,
  progressHistoryUpdateInputSchema,
  previewRequirementPlanInputSchema,
  peopleConcurrencyInputSchema,
  projectArchiveInputSchema,
  projectInputSchema,
  projectListInputSchema,
  projectMemberCommandSchema,
  projectMemberInputSchema,
  projectParamsSchema,
  projectPersonParamsSchema,
  projectResourceListInputSchema,
  projectScopeInputSchema,
  reasonCommandSchema,
  requirementCorrectionInputSchema,
  reopenIssueInputSchema,
  reopenWorkItemInputSchema,
  requirementListInputSchema,
  reorderWorkItemsInputSchema,
  rescheduleRequirementInputSchema,
  reselectRequirementTemplateInputSchema,
  templateCommandSchema,
  updateTemplateInputSchema,
  updateRequirementInputSchema,
  updateIssueInputSchema,
  updateWorkItemInputSchema,
  workItemCorrectionSchema,
} from '../shared/contracts';

const recordSchema = z.record(z.string(), z.unknown());
const auditSearchQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  actorType: z.string().trim().max(50).optional(),
  action: z.string().trim().max(100).optional(),
  entityType: z.string().trim().max(100).optional(),
  projectId: z.string().trim().min(1).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(20).max(100).default(50),
  snapshot: z.coerce.number().int().nonnegative().optional(),
}).strict().refine((input) => !input.from || !input.to || input.from <= input.to, { message: '开始日期不能晚于结束日期', path: ['to'] });

function parse<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value ?? {});
}

function params<T>(request: FastifyRequest, schema: ZodType<T>) {
  return parse(schema, request.params);
}

function idOf(request: FastifyRequest) {
  return params(request, idParamsSchema).id;
}

function sessionOf(request: FastifyRequest) {
  return sessionActor(request.cookies[config.sessionCookieName]);
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
  reply.setCookie(config.sessionCookieName, createSessionToken(accountId, sessionVersion), {
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
    const input = parsedBody(request, loginInputSchema); const account = findAccountForLogin(input.username);
    if (!account || !verifyPassword(input.password, account.passwordHash)) return reply.code(401).send({ error: '用户名或密码错误' });
    if (account.status !== 'active') return reply.code(403).send({ error: '账号已停用，请联系管理员' });
    if (!account.personAvailable) return reply.code(403).send({ error: '人员已停用或归档，请联系管理员恢复人员' });
    if (!markLogin(account.id, account.sessionVersion, account.passwordHash)) {
      return reply.code(409).send({ error: '账号状态已变化，请重新登录', code: 'STALE_WRITE' });
    }
    const token = createSessionToken(account.id, account.sessionVersion);
    const actor = sessionActor(token);
    if (!actor) return reply.code(409).send({ error: '账号状态已变化，请重新登录', code: 'STALE_WRITE' });
    setSessionCookie(reply, account.id, account.sessionVersion);
    return sessionPayload(actor);
  });
  app.post('/api/logout', async (request, reply) => {
    parsedBody(request, emptyCommandInputSchema);
    reply.clearCookie(config.sessionCookieName, { path: '/' });
    return { ok: true };
  });
  app.post('/api/account/change-password', { preHandler: requireAuthenticated }, async (request, reply) => {
    const actor = actorFromRequest(request); const input = parsedBody(request, changePasswordInputSchema);
    const result = changeOwnPassword(actor.accountId, input.currentPassword, input.newPassword, actor);
    setSessionCookie(reply, actor.accountId, result.sessionVersion);
    return { ...result, session: sessionPayload(sessionActor(createSessionToken(actor.accountId, result.sessionVersion))) };
  });
  app.get('/api/accounts', { preHandler: requireAdmin }, async () => listAccounts());
  app.patch('/api/accounts/:id', { preHandler: requireAdmin }, async (request) => updateAccount(idOf(request), parsedBody(request, accountInputSchema), actorFromRequest(request)));
  app.post('/api/accounts/:id/reset-password', { preHandler: requireAdmin }, async (request) => resetAccountPassword(idOf(request), parsedBody(request, accountCommandSchema), actorFromRequest(request)));
  app.delete('/api/accounts/:id', { preHandler: requireAdmin }, async (request) => deleteAccount(idOf(request), parsedBody(request, accountCommandSchema), actorFromRequest(request)));
  app.post('/api/people/:id/account', { preHandler: requireAdmin }, async (request) => openAccountForPerson(idOf(request), parsedBody(request, openAccountInputSchema), actorFromRequest(request)));
  app.get('/api/my-work', { preHandler: requireReady }, async (request) => getMyWork(actorFromRequest(request).accountId));

  app.get('/api/projects', { preHandler: requireReady }, async (request) => {
    const input = parsedQuery(request, projectListInputSchema);
    return listProjects(input.includeDeleted, actorFromRequest(request));
  });
  app.post('/api/projects', { preHandler: requireAdmin }, async (request) => createProject(parsedBody(request, createProjectInputSchema), actorFromRequest(request)));
  app.patch('/api/projects/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectManager(actor, id);
    return updateProject(id, parsedBody(request, projectInputSchema), actor);
  });
  app.delete('/api/projects/:id', { preHandler: requireAdmin }, async (request) => {
    const input = parsedBody(request, projectArchiveInputSchema);
    return archiveProject(idOf(request), actorFromRequest(request), input);
  });
  app.post('/api/projects/:id/restore', { preHandler: requireAdmin }, async (request) => restoreProject(idOf(request), actorFromRequest(request), parsedBody(request, archiveRestoreInputSchema)));
  app.get('/api/dashboard', { preHandler: requireReady }, async (request) => {
    const { projectId } = parsedQuery(request, projectScopeInputSchema); const actor = actorFromRequest(request); assertProjectReadable(actor, projectId);
    const asOfDate = todayIso();
    const dashboard = getDashboard(projectId, asOfDate);
    return { ...dashboard, actions: listActionItems({ projectId, page: 1, pageSize: 5 }, actor, dashboard.requirements, asOfDate) };
  });
  app.get('/api/action-items', { preHandler: requireReady }, async (request) => {
    const input = parsedQuery(request, actionItemsInputSchema); const actor = actorFromRequest(request);
    assertProjectReadable(actor, input.projectId);
    return listActionItems(input, actor);
  });
  app.get('/api/analytics/catalog', async () => getAnalyticsCatalog());
  app.post('/api/analytics/query', { preHandler: requireReady }, async (request) => {
    const input = parsedBody(request, analyticsQueryInputSchema); assertProjectReadable(actorFromRequest(request), input.projectId);
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
    return resetAnalyticsLayout(actor.accountId, body(request), actor);
  });

  app.get('/api/requirements', { preHandler: requireReady }, async (request) => {
    const input = parsedQuery(request, requirementListInputSchema); const actor = actorFromRequest(request);
    if (input.includeDeleted) assertProjectManager(actor, input.projectId); else assertProjectReadable(actor, input.projectId);
    return listRequirements(input);
  });
  app.get('/api/requirements/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const input = parsedQuery(request, projectListInputSchema); const actor = actorFromRequest(request); const projectId = projectIdForRequirement(id);
    if (input.includeDeleted) assertProjectResourceManager(actor, projectId, '需求不存在'); else assertProjectResourceReadable(actor, projectId, '需求不存在');
    return getRequirement(id, input.includeDeleted);
  });
  app.post('/api/requirements', { preHandler: requireReady }, async (request) => {
    const input = parsedBody(request, createRequirementInputSchema); const actor = actorFromRequest(request); assertProjectManager(actor, input.projectId);
    return createRequirement(input, actor);
  });
  app.patch('/api/requirements/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return updateRequirement(id, parsedBody(request, updateRequirementInputSchema), actor);
  });
  app.post('/api/requirements/:id/correct', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return correctRequirement(id, parsedBody(request, requirementCorrectionInputSchema), actor);
  });
  app.post('/api/requirements/:id/accept', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return acceptRequirement(id, parsedBody(request, contentCommandSchema), actor);
  });
  app.post('/api/requirements/:id/complete-as-planned', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return completeRequirementAsPlanned(id, parsedBody(request, completeAsPlannedInputSchema), actor);
  });
  app.post('/api/work-items/:id/complete-as-planned', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForWorkItem(id), '工作项不存在');
    return completeWorkItemAsPlanned(id, parsedBody(request, completeAsPlannedInputSchema), actor);
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
    return restoreRequirement(id, actor, parsedBody(request, archiveRestoreInputSchema));
  });
  app.post('/api/requirements/:id/apply-template', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return applyTemplate(id, parsedBody(request, applyTemplateInputSchema), actor);
  });
  app.post('/api/requirements/:id/plan-preview', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); assertProjectResourceManager(actorFromRequest(request), projectIdForRequirement(id), '需求不存在');
    return previewRequirementPlan(id, parsedBody(request, previewRequirementPlanInputSchema));
  });
  app.post('/api/requirements/:id/apply-plan', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return applyRequirementPlan(id, parsedBody(request, applyRequirementPlanInputSchema), actor);
  });
  app.post('/api/requirements/:id/work-items', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertRequirementOwnerOrManager(actor, id);
    return createWorkItem(id, parsedBody(request, createWorkItemInputSchema), actor);
  });
  app.post('/api/requirements/:id/reorder-work-items', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertRequirementOwnerOrManager(actor, id);
    const input = parsedBody(request, reorderWorkItemsInputSchema); return reorderWorkItems(id, input.ids, actor, input);
  });
  app.post('/api/requirements/:id/progress', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const input = parsedBody(request, progressInputSchema); const actor = actorFromRequest(request);
    assertCanAddProgress(actor, id, input.workItemId ? String(input.workItemId) : null);
    return addProgress(id, input, actor);
  });

  app.patch('/api/work-items/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request);
    assertWorkItemRequirementOwnerOrManager(actor, id);
    return updateWorkItem(id, parsedBody(request, updateWorkItemInputSchema), actor);
  });
  for (const [action, handler, inputSchema] of [
    ['start', (id: string, input: any, actor: any) => startWorkItem(id, input, actor), expectedVersionInputSchema],
    ['complete', (id: string, input: any, actor: any) => completeWorkItem(id, input, actor), optionalContentCommandSchema],
    ['block', (id: string, input: any, actor: any) => blockWorkItem(id, input, actor), reasonCommandSchema],
    ['unblock', (id: string, input: any, actor: any) => unblockWorkItem(id, input, actor), expectedVersionInputSchema],
  ] as const) {
    app.post(`/api/work-items/:id/${action}`, { preHandler: requireReady }, async (request) => {
      const id = idOf(request); const input = parsedBody(request, inputSchema); const actor = actorFromRequest(request);
      assertWorkItemParticipantOrManager(actor, id);
      return handler(id, input, actor);
    });
  }
  app.post('/api/work-items/:id/cancel', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertWorkItemRequirementOwnerOrManager(actor, id);
    return cancelWorkItem(id, parsedBody(request, reasonCommandSchema), actor);
  });
  app.post('/api/work-items/:id/reopen', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertWorkItemRequirementOwnerOrManager(actor, id);
    return reopenWorkItem(id, parsedBody(request, reopenWorkItemInputSchema), actor);
  });
  app.post('/api/work-items/:id/correct', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForWorkItem(id), '工作项不存在');
    return correctWorkItem(id, parsedBody(request, workItemCorrectionSchema), actor);
  });
  app.delete('/api/work-items/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertWorkItemRequirementOwnerOrManager(actor, id);
    return deleteWorkItem(id, parsedBody(request, expectedVersionInputSchema), actor);
  });
  app.patch('/api/progress/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); const input = parsedBody(request, progressHistoryUpdateInputSchema);
    assertProgressOwnerOrManager(actor, id, Object.prototype.hasOwnProperty.call(input, 'workItemId') ? (input.workItemId ? String(input.workItemId) : null) : undefined);
    return updateProgress(id, input, actor);
  });
  app.delete('/api/progress/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); parsedBody(request, emptyCommandInputSchema);
    const actor = actorFromRequest(request); assertProgressOwnerOrManager(actor, id);
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
    const input = parsedBody(request, createIssueInputSchema); const actor = actorFromRequest(request); const projectId = input.projectId;
    assertProjectMember(actor, projectId);
    return createIssue(canManageProject(actor, projectId) ? input : { ...input, ownerId: null }, actor);
  });
  app.patch('/api/issues/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在');
    return updateIssue(id, parsedBody(request, updateIssueInputSchema), actor);
  });
  app.post('/api/issues/:id/defer', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const input = parsedBody(request, reasonCommandSchema); const actor = actorFromRequest(request);
    assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在'); return deferIssue(id, input, actor);
  });
  app.post('/api/issues/:id/resume', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const input = parsedBody(request, reasonCommandSchema); const actor = actorFromRequest(request);
    assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在'); return resumeIssue(id, input, actor);
  });
  app.post('/api/issues/:id/resolve', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const input = parsedBody(request, contentCommandSchema); const actor = actorFromRequest(request);
    assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在'); return resolveIssue(id, input, actor);
  });
  app.post('/api/issues/:id/reopen', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const input = parsedBody(request, reopenIssueInputSchema); const actor = actorFromRequest(request);
    assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在'); return reopenIssue(id, input, actor);
  });
  app.post('/api/issues/:id/correct', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const input = parsedBody(request, issueCorrectionInputSchema); const actor = actorFromRequest(request);
    assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在'); return correctIssue(id, input, actor);
  });
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
    const input = parsedBody(request, issueUpdateHistoryInputSchema);
    assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在');
    return updateIssueUpdate(id, updateId, input, actor);
  });
  app.delete('/api/issues/:id/updates/:updateId', { preHandler: requireReady }, async (request) => {
    const { id, updateId } = params(request, issueUpdateParamsSchema); parsedBody(request, emptyCommandInputSchema);
    const actor = actorFromRequest(request);
    assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在');
    return deleteIssueUpdate(id, updateId, actor);
  });

  app.get('/api/people', { preHandler: requireReady }, async (request) => {
    const input = parsedQuery(request, peopleListInputSchema); const actor = actorFromRequest(request); const projectId = input.projectId || '';
    if (!projectId) assertAdmin(actor);
    else if (input.includeDeleted) assertProjectManager(actor, projectId);
    else assertProjectReadable(actor, projectId);
    return listPeople(input.includeDeleted, projectId || undefined);
  });
  app.get('/api/people/candidates', { preHandler: requireReady }, async (request) => {
    const input = parsedQuery(request, personCandidatesInputSchema); assertProjectManager(actorFromRequest(request), input.projectId);
    return listPeopleCandidates(input.projectId, input.q || '');
  });
  app.post('/api/people', { preHandler: requireAdmin }, async (request) => createPerson(parsedBody(request, createPersonInputSchema), actorFromRequest(request)));
  app.patch('/api/people/:id', { preHandler: requireAdmin }, async (request) => updatePerson(idOf(request), parsedBody(request, updatePersonInputSchema), actorFromRequest(request)));
  app.delete('/api/people/:id', { preHandler: requireAdmin }, async (request) => archivePerson(idOf(request), parsedBody(request, personCommandSchema), actorFromRequest(request)));
  app.post('/api/people/:id/restore', { preHandler: requireAdmin }, async (request) => restorePerson(idOf(request), actorFromRequest(request), parsedBody(request, archiveRestoreInputSchema)));
  app.get('/api/projects/:projectId/members', { preHandler: requireReady }, async (request) => {
    const { projectId } = params(request, projectParamsSchema); assertProjectReadable(actorFromRequest(request), projectId);
    return listPeople(false, projectId);
  });
  app.put('/api/projects/:projectId/members/:personId', { preHandler: requireReady }, async (request) => {
    const { projectId, personId } = params(request, projectPersonParamsSchema); const actor = actorFromRequest(request);
    const input = parsedBody(request, projectMemberInputSchema);
    assertProjectManager(actor, projectId); return addProjectPerson(projectId, personId, actor, input.role, input.expectedMembershipUpdatedAt);
  });
  app.delete('/api/projects/:projectId/members/:personId', { preHandler: requireReady }, async (request) => {
    const { projectId, personId } = params(request, projectPersonParamsSchema); const actor = actorFromRequest(request);
    const input = parsedBody(request, projectMemberCommandSchema);
    assertProjectManager(actor, projectId); return removeProjectPerson(projectId, personId, actor, input.expectedMembershipUpdatedAt);
  });
  app.post('/api/projects/:projectId/people/:personId', { preHandler: requireReady }, async (request) => {
    const { projectId, personId } = params(request, projectPersonParamsSchema); const actor = actorFromRequest(request);
    const input = parsedBody(request, projectMemberInputSchema);
    assertProjectManager(actor, projectId); return addProjectPerson(projectId, personId, actor, input.role, input.expectedMembershipUpdatedAt);
  });
  app.delete('/api/projects/:projectId/people/:personId', { preHandler: requireReady }, async (request) => {
    const { projectId, personId } = params(request, projectPersonParamsSchema); const actor = actorFromRequest(request);
    const input = parsedBody(request, projectMemberCommandSchema);
    assertProjectManager(actor, projectId); return removeProjectPerson(projectId, personId, actor, input.expectedMembershipUpdatedAt);
  });

  app.get('/api/templates', { preHandler: requireReady }, async (request) => {
    const input = parsedQuery(request, projectResourceListInputSchema); const actor = actorFromRequest(request);
    if (input.includeDeleted) assertProjectManager(actor, input.projectId); else assertProjectReadable(actor, input.projectId);
    return listTemplates(input.projectId, input.includeDeleted);
  });
  app.post('/api/templates', { preHandler: requireReady }, async (request) => {
    const input = parsedBody(request, createTemplateInputSchema); assertProjectManager(actorFromRequest(request), input.projectId);
    return createTemplate(input, actorFromRequest(request));
  });
  app.patch('/api/templates/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); assertProjectResourceManager(actorFromRequest(request), projectIdForTemplate(id), '流程设计不存在');
    return updateTemplate(id, parsedBody(request, updateTemplateInputSchema), actorFromRequest(request));
  });
  app.delete('/api/templates/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); assertProjectResourceManager(actorFromRequest(request), projectIdForTemplate(id), '流程设计不存在');
    return archiveTemplate(id, actorFromRequest(request), parsedBody(request, templateCommandSchema));
  });
  app.post('/api/templates/:id/restore', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); assertProjectResourceManager(actorFromRequest(request), projectIdForTemplate(id), '流程设计不存在');
    return restoreTemplate(id, actorFromRequest(request), parsedBody(request, archiveRestoreInputSchema));
  });
  app.post('/api/projects/:projectId/templates/:sourceTemplateId/copy', { preHandler: requireReady }, async (request) => {
    const { projectId, sourceTemplateId } = params(request, copyTemplateInputSchema); const actor = actorFromRequest(request);
    parsedBody(request, emptyCommandInputSchema);
    assertProjectManager(actor, projectId); assertProjectResourceReadable(actor, projectIdForTemplate(sourceTemplateId), '来源流程不存在');
    return copyTemplate(projectId, sourceTemplateId, actor);
  });

  app.get('/api/analytics/people-concurrency', { preHandler: requireReady }, async (request) => {
    const input = parsedQuery(request, peopleConcurrencyInputSchema); const actor = actorFromRequest(request); const projectId = input.projectId || '';
    if (projectId) assertProjectReadable(actor, projectId); else assertAdmin(actor);
    return getPeopleConcurrency({ ...input, projectId: projectId || undefined, includeExternalAggregate: Boolean(projectId && canManageProject(actor, projectId)) });
  });
  app.get('/api/archives', { preHandler: requireReady }, async (request) => {
    const actor = actorFromRequest(request); const { projectId = '' } = parsedQuery(request, archiveListInputSchema);
    if (isAdmin(actor) && !projectId) return listArchives();
    assertProjectManager(actor, projectId); return listArchives(projectId);
  });
  app.delete('/api/archives/:entity/:id', { preHandler: requireAdmin }, async (request) => {
    const { entity, id } = params(request, archiveParamsSchema);
    return permanentlyDeleteArchive(entity, id, actorFromRequest(request), parsedBody(request, archiveDeleteInputSchema));
  });

  app.get('/api/tokens', { preHandler: requireReady }, async (request) => listTokens(actorFromRequest(request).accountId));
  app.post('/api/tokens', { preHandler: requireReady }, async (request) => issueToken(parsedBody(request, apiTokenInputSchema), actorFromRequest(request)));
  app.delete('/api/tokens/:id', { preHandler: requireReady }, async (request) => {
    parsedBody(request, emptyCommandInputSchema);
    return revokeToken(idOf(request), actorFromRequest(request));
  });
  app.get('/api/admin/tokens', { preHandler: requireAdmin }, async () => listTokens(undefined, true));
  app.delete('/api/admin/tokens/:id', { preHandler: requireAdmin }, async (request) => {
    parsedBody(request, emptyCommandInputSchema);
    return revokeToken(idOf(request), actorFromRequest(request), true);
  });
  app.get('/api/audit', { preHandler: requireReady }, async (request) => {
    const input = parsedQuery(request, auditListInputSchema); const actor = actorFromRequest(request); const projectId = input.projectId || '';
    if (!isAdmin(actor)) assertProjectManager(actor, projectId);
    return listAudit(input.limit, projectId || undefined);
  });
  app.get('/api/audit/search', { preHandler: requireReady }, async (request) => {
    const input = parsedQuery(request, auditSearchQuerySchema); const actor = actorFromRequest(request); const projectId = input.projectId || '';
    if (!isAdmin(actor)) assertProjectManager(actor, projectId);
    return searchAudit({
      q: input.q,
      actorType: input.actorType,
      action: input.action,
      entityType: input.entityType,
      projectId: projectId || undefined,
      from: input.from,
      to: input.to,
      page: input.page,
      pageSize: input.pageSize,
      snapshot: input.snapshot,
    });
  });

  app.get('/api/system/overview', { preHandler: requireAdmin }, async () => getSystemOverview());
  app.post('/api/system/database-check', { preHandler: requireAdmin }, async (request) => {
    parsedBody(request, emptyCommandInputSchema);
    return checkDatabaseIntegrity();
  });
  app.put('/api/system/branding', { preHandler: requireAdmin }, async (request) => {
    const actor = actorFromRequest(request);
    return updateBranding(parsedBody(request, brandingInputSchema), actor);
  });
  app.get('/api/backups', { preHandler: requireAdmin }, async () => listRestorableBackups());
  app.post('/api/backups', { preHandler: requireAdmin }, async (request) => {
    parsedBody(request, emptyCommandInputSchema);
    const actor = actorFromRequest(request);
    return createBackup({ beforeCommit: (backup) => {
      assertAdmin(requireAuthorizationActor(actor));
      recordAudit(actor, 'create', 'backup', backup.name, `创建数据库备份：${backup.name}`);
    } });
  });
  app.delete('/api/backups/:name', { preHandler: requireAdmin }, async (request) => {
    const { name } = params(request, z.object({ name: z.string().min(1) }).strict()); const actor = actorFromRequest(request);
    const input = parsedBody(request, backupDeleteInputSchema);
    return deleteBackup(name, input.expectedFingerprint, () => {
      assertAdmin(requireAuthorizationActor(actor));
      recordAudit(actor, 'delete', 'backup', name, `删除数据库备份：${name}`);
    });
  });
  app.post('/api/backups/restore', { preHandler: requireAdmin }, async (request) => {
    const input = parsedBody(request, backupRestoreInputSchema); const actor = actorFromRequest(request);
    return scheduleRestore(input.name, input.expectedFingerprint, (safetyBackup, replacement) => {
      assertAdmin(requireAuthorizationActor(actor));
      recordRestoreAudit(replacement, {
        actorType: actor.type,
        actorId: actor.id,
        entityId: input.name,
        summary: `恢复数据库备份：${input.name}；恢复前备份：${safetyBackup.name}`,
      });
    });
  });
}
