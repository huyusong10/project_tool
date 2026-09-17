

import type { FastifyInstance } from 'fastify';

import { actorFromRequest, assertProjectManager, assertProjectReadable, assertProjectResourceManager, projectIdForTemplate } from "../authorization";

import { archiveTemplate, createTemplate, listTemplates, restoreTemplate, updateTemplate } from "../services/templates";

import { archiveRestoreInputSchema, createTemplateInputSchema, projectResourceListInputSchema, templateCommandSchema, updateTemplateInputSchema } from "../../shared/contracts";
import { idOf, parsedBody, parsedQuery, requireReady } from './context';

export function registerTemplatesRoutes(app: FastifyInstance) {
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
}
