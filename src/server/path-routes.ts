import {requireWorkspaceRead} from './workspace-access';
import {dependencyChangesInput,applyDependencyChangesInput,pathEstimateInput} from '../shared/workflow-contracts';
import {listDeliveryCommitments,getDeliveryCommitment,deliveryCommitmentSummary} from './services/commitments';
import {projectChangeVersion} from './services/project-change-version';
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

  app.get('/api/projects/:id/change-version',{preHandler:requireWorkspaceRead},async request=>projectChangeVersion(params.parse(request.params).id,actorFromRequest(request)));
  app.get('/api/projects/:id/diagram-layouts',{preHandler:requireWorkspaceRead},async request=>readDiagramLayouts(params.parse(request.params).id,actorFromRequest(request)));
  for(const action of ['achieve','reopen'] as const)app.post('/api/milestones/:id/'+action,{preHandler:requireReady},async request=>milestoneCommand(params.parse(request.params).id,action,z.object({expectedVersion:z.number().int().positive()}).strict().parse(request.body),actorFromRequest(request)));
  app.get('/api/projects/:id/delivery-commitments/summary',{preHandler:requireReady},async request=>{const q=z.object({from:z.string().optional(),to:z.string().optional()}).parse(request.query);return deliveryCommitmentSummary(params.parse(request.params).id,actorFromRequest(request),q.from,q.to);});
  app.get('/api/projects/:id/delivery-commitments',{preHandler:requireReady},async request => listDeliveryCommitments(params.parse(request.params).id,actorFromRequest(request)));
  app.get('/api/projects/:id/delivery-commitments/:commitmentId',{preHandler:requireReady},async request => {const p=z.object({id:z.string(),commitmentId:z.string()}).parse(request.params);return getDeliveryCommitment(p.id,p.commitmentId,actorFromRequest(request));});
  app.post('/api/projects/:id/dependency-changes/preview',{preHandler:requireReady},async request => previewDependencyChanges(params.parse(request.params).id, dependencyChangesInput.parse(request.body), actorFromRequest(request)));
  app.post('/api/projects/:id/dependency-changes/apply',{preHandler:requireReady},async request => applyDependencyChanges(params.parse(request.params).id, applyDependencyChangesInput.parse(request.body), actorFromRequest(request)));
  app.get('/api/projects/:id/dependency-changes/:batchId',{preHandler:requireReady},async request => {
    const p = z.object({ id: z.string(), batchId: z.string().uuid() }).parse(request.params);
    return getDependencyChangeReceipt(p.id, p.batchId, actorFromRequest(request));
  });
  app.get('/api/projects/:id/path-analysis',{preHandler:requireWorkspaceRead},async request => readPathAnalysis(params.parse(request.params).id, pathQuery.parse(request.query).target, actorFromRequest(request)));
  app.get('/api/requirements/:id/path-analysis',{preHandler:requireWorkspaceRead},async request => {
    const { id } = params.parse(request.params); return readPathAnalysis(pathProjectForRequirement(id), pathQuery.parse(request.query).target || acceptanceId(id), actorFromRequest(request));
  });
  app.get('/api/projects/:id/dependencies',{preHandler:requireWorkspaceRead},async request => readPathAnalysis(params.parse(request.params).id, undefined, actorFromRequest(request)).dependencies);
  app.post('/api/projects/:id/dependencies',{preHandler:requireReady},async request => addDependency(params.parse(request.params).id, request.body, actorFromRequest(request)));
  app.delete('/api/dependencies/:id',{preHandler:requireReady},async request => removeDependency(params.parse(request.params).id, request.body, actorFromRequest(request)));
  app.post('/api/requirements/:id/dependency-review',{preHandler:requireReady},async request => reviewDependencies(params.parse(request.params).id, request.body, actorFromRequest(request)));
  app.patch('/api/work-items/:id/path-estimate',{preHandler:requireReady},async request => updatePathEstimate(params.parse(request.params).id, pathEstimateInput.parse(request.body), actorFromRequest(request)));
  app.post('/api/requirements/:id/dependency-plan/preview',{preHandler:requireReady},async request => previewDependencyPlan(params.parse(request.params).id, request.body, actorFromRequest(request)));
  app.post('/api/requirements/:id/dependency-plan/apply',{preHandler:requireReady},async request => applyDependencyPlan(params.parse(request.params).id, request.body, actorFromRequest(request)));
  });
}
