import type { FastifyInstance } from 'fastify';
import { requireWorkspaceRead } from './workspace-access';
import { actorFromRequest } from './authorization';
import { idParamsSchema } from '../shared/contracts';
import { queryRequirements, queryWorkItems, readWorkItem, queryProgressUpdates } from './services/queries';
import { readPathGraph } from './services/path-graph';

export function registerQueryRoutes(root: FastifyInstance) {
  root.register(async app => {
    app.addHook('preHandler', requireWorkspaceRead);
    app.get('/api/requirements/query', async request => queryRequirements(request.query, actorFromRequest(request)));
    app.get('/api/work-items', async request => queryWorkItems(request.query, actorFromRequest(request)));
    app.get('/api/work-items/:id', async request => readWorkItem(idParamsSchema.parse(request.params).id, actorFromRequest(request)));
    app.get('/api/progress-updates', async request => queryProgressUpdates(request.query, actorFromRequest(request)));
    app.get('/api/projects/:id/path-graph', async request => readPathGraph({
      ...(request.query as Record<string, unknown>), projectId: idParamsSchema.parse(request.params).id,
    }, actorFromRequest(request)));
  });
}
