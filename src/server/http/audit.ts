

import type { FastifyInstance } from 'fastify';

import { actorFromRequest, assertProjectManager, isAdmin } from "../authorization";

import { listAudit, searchAudit } from "../services/audit";

import { auditListInputSchema } from "../../shared/contracts";
import { auditSearchQuerySchema, parsedQuery, requireReady } from './context';

export function registerAuditRoutes(app: FastifyInstance) {
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
}
