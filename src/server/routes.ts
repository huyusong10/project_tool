import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config';
import { createSessionToken, verifyPassword, verifySessionToken, type Actor } from './auth';
import {
  addProgress, applyRequirementPlan, applyTemplate, archivePerson, archiveProject, archiveRequirement, archiveTemplate,
  blockWorkItem, cancelWorkItem, completeWorkItem, createPerson, createProject, createRequirement, createTemplate,
  createWorkItem, deleteProgress, deleteWorkItem, getDashboard, getPeopleConcurrency, getRequirement, issueToken,
  listArchives, listAudit, listPeople, listProjects, listRequirements, listTemplates, listTokens, previewRequirementPlan,
  permanentlyDeleteArchive, reorderWorkItems, restorePerson, restoreProject, restoreRequirement, restoreTemplate, revokeToken, startWorkItem,
  unblockWorkItem, updatePerson, updateProgress, updateProject, updateRequirement, updateTemplate, updateWorkItem,
} from './services';
import { createBackup, listBackups, scheduleRestore } from './backups';

const userActor = (): Actor => ({ type: 'user', id: config.appUsername, label: config.appUsername });

function sessionOf(request: FastifyRequest) {
  return verifySessionToken(request.cookies.pm_session);
}

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  if (!sessionOf(request)) return reply.code(401).send({ error: '请先登录' });
}

function body(request: FastifyRequest) {
  return (request.body || {}) as Record<string, unknown>;
}

export function registerApiRoutes(app: FastifyInstance) {
  app.get('/api/session', async (request) => ({ authenticated: Boolean(sessionOf(request)), username: sessionOf(request)?.username || null, httpWarning: true }));
  app.post('/api/login', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = body(request);
    if (String(input.username || '') !== config.appUsername || !verifyPassword(String(input.password || ''), config.appPasswordHash)) {
      return reply.code(401).send({ error: '用户名或密码错误' });
    }
    reply.setCookie('pm_session', createSessionToken(config.appUsername), {
      httpOnly: true, sameSite: 'strict', secure: false, path: '/', maxAge: config.sessionHours * 60 * 60,
    });
    return { authenticated: true, username: config.appUsername };
  });
  app.post('/api/logout', async (_request, reply) => { reply.clearCookie('pm_session', { path: '/' }); return { ok: true }; });

  app.get('/api/projects', async (request) => listProjects((request.query as any).includeDeleted === 'true'));
  app.post('/api/projects', { preHandler: requireUser }, async (request) => createProject(body(request), userActor()));
  app.patch('/api/projects/:id', { preHandler: requireUser }, async (request) => updateProject((request.params as any).id, body(request), userActor()));
  app.delete('/api/projects/:id', { preHandler: requireUser }, async (request) => archiveProject((request.params as any).id, userActor()));
  app.post('/api/projects/:id/restore', { preHandler: requireUser }, async (request) => restoreProject((request.params as any).id, userActor()));
  app.get('/api/dashboard', async (request) => getDashboard((request.query as any).projectId));

  app.get('/api/requirements', async (request) => listRequirements(request.query as any));
  app.get('/api/requirements/:id', async (request) => getRequirement((request.params as any).id, (request.query as any).includeDeleted === 'true'));
  app.post('/api/requirements', { preHandler: requireUser }, async (request) => createRequirement(body(request), userActor()));
  app.patch('/api/requirements/:id', { preHandler: requireUser }, async (request) => updateRequirement((request.params as any).id, body(request), userActor()));
  app.delete('/api/requirements/:id', { preHandler: requireUser }, async (request) => archiveRequirement((request.params as any).id, userActor()));
  app.post('/api/requirements/:id/restore', { preHandler: requireUser }, async (request) => restoreRequirement((request.params as any).id, userActor()));
  app.post('/api/requirements/:id/apply-template', { preHandler: requireUser }, async (request) => applyTemplate((request.params as any).id, String(body(request).templateId), userActor()));
  app.post('/api/requirements/:id/plan-preview', { preHandler: requireUser }, async (request) => previewRequirementPlan((request.params as any).id, body(request)));
  app.post('/api/requirements/:id/apply-plan', { preHandler: requireUser }, async (request) => applyRequirementPlan((request.params as any).id, body(request), userActor()));
  app.post('/api/requirements/:id/work-items', { preHandler: requireUser }, async (request) => createWorkItem((request.params as any).id, body(request), userActor()));
  app.post('/api/requirements/:id/reorder-work-items', { preHandler: requireUser }, async (request) => reorderWorkItems((request.params as any).id, body(request).ids as string[], userActor()));
  app.post('/api/requirements/:id/progress', { preHandler: requireUser }, async (request) => addProgress((request.params as any).id, body(request), userActor()));

  app.patch('/api/work-items/:id', { preHandler: requireUser }, async (request) => updateWorkItem((request.params as any).id, body(request), userActor()));
  app.post('/api/work-items/:id/start', { preHandler: requireUser }, async (request) => startWorkItem((request.params as any).id, userActor()));
  app.post('/api/work-items/:id/complete', { preHandler: requireUser }, async (request) => completeWorkItem((request.params as any).id, userActor()));
  app.post('/api/work-items/:id/block', { preHandler: requireUser }, async (request) => blockWorkItem((request.params as any).id, body(request), userActor()));
  app.post('/api/work-items/:id/unblock', { preHandler: requireUser }, async (request) => unblockWorkItem((request.params as any).id, userActor()));
  app.post('/api/work-items/:id/cancel', { preHandler: requireUser }, async (request) => cancelWorkItem((request.params as any).id, userActor()));
  app.delete('/api/work-items/:id', { preHandler: requireUser }, async (request) => deleteWorkItem((request.params as any).id, userActor()));
  app.patch('/api/progress/:id', { preHandler: requireUser }, async (request) => updateProgress((request.params as any).id, body(request), userActor()));
  app.delete('/api/progress/:id', { preHandler: requireUser }, async (request) => deleteProgress((request.params as any).id, userActor()));

  app.get('/api/people', async (request) => listPeople((request.query as any).includeDeleted === 'true'));
  app.post('/api/people', { preHandler: requireUser }, async (request) => createPerson(body(request), userActor()));
  app.patch('/api/people/:id', { preHandler: requireUser }, async (request) => updatePerson((request.params as any).id, body(request), userActor()));
  app.delete('/api/people/:id', { preHandler: requireUser }, async (request) => archivePerson((request.params as any).id, userActor()));
  app.post('/api/people/:id/restore', { preHandler: requireUser }, async (request) => restorePerson((request.params as any).id, userActor()));

  app.get('/api/templates', async (request) => listTemplates((request.query as any).includeDeleted === 'true'));
  app.post('/api/templates', { preHandler: requireUser }, async (request) => createTemplate(body(request), userActor()));
  app.patch('/api/templates/:id', { preHandler: requireUser }, async (request) => updateTemplate((request.params as any).id, body(request), userActor()));
  app.delete('/api/templates/:id', { preHandler: requireUser }, async (request) => archiveTemplate((request.params as any).id, userActor()));
  app.post('/api/templates/:id/restore', { preHandler: requireUser }, async (request) => restoreTemplate((request.params as any).id, userActor()));

  app.get('/api/analytics/people-concurrency', async (request) => getPeopleConcurrency(request.query as any));
  app.get('/api/archives', { preHandler: requireUser }, async () => listArchives());
  app.delete('/api/archives/:entity/:id', { preHandler: requireUser }, async (request) => {
    const { entity, id } = request.params as { entity: 'projects' | 'requirements' | 'people' | 'templates'; id: string };
    return permanentlyDeleteArchive(entity, id, userActor());
  });

  app.get('/api/tokens', { preHandler: requireUser }, async () => listTokens());
  app.post('/api/tokens', { preHandler: requireUser }, async (request) => issueToken(body(request), userActor()));
  app.delete('/api/tokens/:id', { preHandler: requireUser }, async (request) => revokeToken((request.params as any).id, userActor()));
  app.get('/api/audit', { preHandler: requireUser }, async (request) => listAudit(Number((request.query as any).limit || 100)));

  app.get('/api/backups', { preHandler: requireUser }, async () => listBackups());
  app.post('/api/backups', { preHandler: requireUser }, async () => createBackup());
  app.post('/api/backups/restore', { preHandler: requireUser }, async (request) => scheduleRestore(String(body(request).name || '')));
}
