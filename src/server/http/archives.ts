

import type { FastifyInstance } from 'fastify';

import { actorFromRequest, assertProjectManager, isAdmin } from "../authorization";

import { listArchives, permanentlyDeleteArchive } from "../services/archives";

import { archiveListInputSchema, archiveDeleteInputSchema, archiveParamsSchema } from "../../shared/contracts";
import { params, parsedBody, parsedQuery, requireReady, requireAdmin } from './context';

export function registerArchivesRoutes(app: FastifyInstance) {
  app.get('/api/archives', { preHandler: requireReady }, async (request) => {
    const actor = actorFromRequest(request); const { projectId = '' } = parsedQuery(request, archiveListInputSchema);
    if (isAdmin(actor) && !projectId) return listArchives();
    assertProjectManager(actor, projectId); return listArchives(projectId);
  });

  app.delete('/api/archives/:entity/:id', { preHandler: requireAdmin }, async (request) => {
    const { entity, id } = params(request, archiveParamsSchema);
    return permanentlyDeleteArchive(entity, id, actorFromRequest(request), parsedBody(request, archiveDeleteInputSchema));
  });
}
