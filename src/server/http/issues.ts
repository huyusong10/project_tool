

import { reasonCommandSchema } from "../../shared/workflow-contracts";

import type { FastifyInstance } from 'fastify';

import { actorFromRequest, assertProjectMember, assertProjectReadable, assertProjectResourceManager, assertProjectResourceReadable, canManageProject, canUpdateIssueProgress, projectIdForIssue } from "../authorization";

import { addIssueUpdate, correctIssue, createIssue, deleteIssueUpdate, getIssue, listIssues, reopenIssue, resolveIssue, resumeIssue, deferIssue, updateIssue, updateIssueUpdate } from "../services/issues";

import { contentCommandSchema, createIssueInputSchema, emptyCommandInputSchema, issueCorrectionInputSchema, issueListInputSchema, issueUpdateHistoryInputSchema, issueUpdateInputSchema, issueUpdateParamsSchema, reopenIssueInputSchema, updateIssueInputSchema } from "../../shared/contracts";
import { params, idOf, parsedBody, parsedQuery, requireReady } from './context';

export function registerIssuesRoutes(app: FastifyInstance) {
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
}
