
import { workspaceSession } from "../workspace-access";
import { listWorkspaceProjects } from "../services/projects";

import type { FastifyInstance } from 'fastify';

import { actorFromRequest, assertProjectManager, assertProjectReadable, assertProjectResourceReadable, projectIdForTemplate } from "../authorization";

import { addProjectPerson, listPeople, removeProjectPerson } from "../services/people";
import { archiveProject, createProject, restoreProject, updateProject } from "../services/projects";
import { copyTemplate } from "../services/templates";

import { archiveRestoreInputSchema, copyTemplateInputSchema, createProjectInputSchema, emptyCommandInputSchema, projectArchiveInputSchema, projectInputSchema, projectListInputSchema, projectMemberCommandSchema, projectMemberInputSchema, projectParamsSchema, projectPersonParamsSchema } from "../../shared/contracts";
import { params, idOf, parsedBody, parsedQuery, requireReady, requireAdmin } from './context';

export function registerProjectsRoutes(app: FastifyInstance) {
  app.get('/api/projects', { preHandler: workspaceSession }, async (request) => {
    const input = parsedQuery(request, projectListInputSchema);
    return listWorkspaceProjects(Boolean(input.includeDeleted), actorFromRequest(request));
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

  app.post('/api/projects/:projectId/templates/:sourceTemplateId/copy', { preHandler: requireReady }, async (request) => {
    const { projectId, sourceTemplateId } = params(request, copyTemplateInputSchema); const actor = actorFromRequest(request);
    parsedBody(request, emptyCommandInputSchema);
    assertProjectManager(actor, projectId); assertProjectResourceReadable(actor, projectIdForTemplate(sourceTemplateId), '来源流程不存在');
    return copyTemplate(projectId, sourceTemplateId, actor);
  });
}
