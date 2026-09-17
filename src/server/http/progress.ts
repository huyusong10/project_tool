

import type { FastifyInstance } from 'fastify';

import { actorFromRequest, assertProgressOwnerOrManager } from "../authorization";

import { deleteProgress, updateProgress } from "../services/progress";

import { emptyCommandInputSchema, progressHistoryUpdateInputSchema } from "../../shared/contracts";
import { idOf, parsedBody, requireReady } from './context';

export function registerProgressRoutes(app: FastifyInstance) {
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
}
