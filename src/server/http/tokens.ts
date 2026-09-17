

import type { FastifyInstance } from 'fastify';

import { actorFromRequest } from "../authorization";

import { issueToken, listTokens, revokeToken } from "../services/tokens";

import { apiTokenInputSchema, emptyCommandInputSchema } from "../../shared/contracts";
import { idOf, parsedBody, requireReady } from './context';

export function registerTokensRoutes(app: FastifyInstance) {
  app.get('/api/tokens', { preHandler: requireReady }, async (request) => listTokens(actorFromRequest(request).accountId));

  app.post('/api/tokens', { preHandler: requireReady }, async (request) => issueToken(parsedBody(request, apiTokenInputSchema), actorFromRequest(request)));

  app.delete('/api/tokens/:id', { preHandler: requireReady }, async (request) => {
    parsedBody(request, emptyCommandInputSchema);
    return revokeToken(idOf(request), actorFromRequest(request));
  });
}
