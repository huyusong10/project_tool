import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireReady } from './routes';
import { actorFromRequest } from './authorization';
import { acceptanceId } from '../shared/paths';
import { pathQuery } from '../shared/path-contracts';
import { readPathAnalysis, pathProjectForRequirement, addDependency, removeDependency, reviewDependencies, updatePathEstimate, previewDependencyPlan, applyDependencyPlan } from './services/paths';
const params = z.object({ id: z.string().min(1) });
export function registerPathRoutes(root: FastifyInstance) {
  root.register(async app => {
  app.addHook('preHandler', requireReady);
  app.get('/api/projects/:id/path-analysis', async request => readPathAnalysis(params.parse(request.params).id, pathQuery.parse(request.query).target, actorFromRequest(request)));
  app.get('/api/requirements/:id/path-analysis', async request => {
    const { id } = params.parse(request.params); return readPathAnalysis(pathProjectForRequirement(id), pathQuery.parse(request.query).target || acceptanceId(id), actorFromRequest(request));
  });
  app.get('/api/projects/:id/dependencies', async request => readPathAnalysis(params.parse(request.params).id, undefined, actorFromRequest(request)).dependencies);
  app.post('/api/projects/:id/dependencies', async request => addDependency(params.parse(request.params).id, request.body, actorFromRequest(request)));
  app.delete('/api/dependencies/:id', async request => removeDependency(params.parse(request.params).id, request.body, actorFromRequest(request)));
  app.post('/api/requirements/:id/dependency-review', async request => reviewDependencies(params.parse(request.params).id, request.body, actorFromRequest(request)));
  app.patch('/api/work-items/:id/path-estimate', async request => updatePathEstimate(params.parse(request.params).id, request.body, actorFromRequest(request)));
  app.post('/api/requirements/:id/dependency-plan/preview', async request => previewDependencyPlan(params.parse(request.params).id, request.body, actorFromRequest(request)));
  app.post('/api/requirements/:id/dependency-plan/apply', async request => applyDependencyPlan(params.parse(request.params).id, request.body, actorFromRequest(request)));
  });
}
