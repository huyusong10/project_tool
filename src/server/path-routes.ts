import {listDeliveryCommitments,getDeliveryCommitment,deliveryCommitmentSummary} from './services/commitments';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireReady } from './routes';
import { actorFromRequest } from './authorization';
import { acceptanceId } from '../shared/paths';
import { pathQuery } from '../shared/path-contracts';
import { readPathAnalysis, pathProjectForRequirement, addDependency, removeDependency, reviewDependencies, updatePathEstimate, previewDependencyPlan, applyDependencyPlan } from './services/paths';
import { applyDependencyChanges, getDependencyChangeReceipt, previewDependencyChanges } from './services/path-changes';
import {milestoneCommand,readDiagramLayouts} from './services/milestones';
const params = z.object({ id: z.string().min(1) });
export function registerPathRoutes(root: FastifyInstance) {
  root.register(async app => {
  app.addHook('preHandler', requireReady);
  app.get('/api/projects/:id/diagram-layouts',async request=>readDiagramLayouts(params.parse(request.params).id,actorFromRequest(request)));
  for(const action of ['achieve','reopen'] as const)app.post('/api/milestones/:id/'+action,async request=>milestoneCommand(params.parse(request.params).id,action,z.object({expectedVersion:z.number().int().positive()}).strict().parse(request.body),actorFromRequest(request)));
  app.get('/api/projects/:id/delivery-commitments/summary',async request=>{const q=z.object({from:z.string().optional(),to:z.string().optional()}).parse(request.query);return deliveryCommitmentSummary(params.parse(request.params).id,actorFromRequest(request),q.from,q.to);});
  app.get('/api/projects/:id/delivery-commitments', async request => listDeliveryCommitments(params.parse(request.params).id,actorFromRequest(request)));
  app.get('/api/projects/:id/delivery-commitments/:commitmentId', async request => {const p=z.object({id:z.string(),commitmentId:z.string()}).parse(request.params);return getDeliveryCommitment(p.id,p.commitmentId,actorFromRequest(request));});
  app.post('/api/projects/:id/dependency-changes/preview', async request => previewDependencyChanges(params.parse(request.params).id, request.body, actorFromRequest(request)));
  app.post('/api/projects/:id/dependency-changes/apply', async request => applyDependencyChanges(params.parse(request.params).id, request.body, actorFromRequest(request)));
  app.get('/api/projects/:id/dependency-changes/:batchId', async request => {
    const p = z.object({ id: z.string(), batchId: z.string().uuid() }).parse(request.params);
    return getDependencyChangeReceipt(p.id, p.batchId, actorFromRequest(request));
  });
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
