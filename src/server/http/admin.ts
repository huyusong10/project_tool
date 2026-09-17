

import type { FastifyInstance } from 'fastify';

import { actorFromRequest } from "../authorization";

import { listTokens, revokeToken } from "../services/tokens";

import { emptyCommandInputSchema } from "../../shared/contracts";
import { idOf, parsedBody, requireAdmin } from './context';

export function registerAdminRoutes(app: FastifyInstance) {
  app.get('/api/admin/tokens', { preHandler: requireAdmin }, async () => listTokens(undefined, true));

  app.delete('/api/admin/tokens/:id', { preHandler: requireAdmin }, async (request) => {
    parsedBody(request, emptyCommandInputSchema);
    return revokeToken(idOf(request), actorFromRequest(request), true);
  });
}
