
import { requireWorkspaceRead } from "../workspace-access";

import { createRequirementInputSchema, updateRequirementInputSchema, requirementCorrectionInputSchema, createWorkItemInputSchema, reasonCommandSchema, rescheduleRequirementInputSchema } from "../../shared/workflow-contracts";

import { executeDirectRequirement, returnRequirement, assertRequirementAcceptor, directStartConditions } from "../services/delivery-execution";
import { isCoordinationEdit, assertCoordinationAccess } from "../services/blocker-coordination";
import { directRequirementCommandSchema, idSchema } from "../../shared/contracts";
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { actorFromRequest, assertCanAddProgress, assertProjectManager, assertProjectReadable, assertProjectResourceManager, assertProjectResourceReadable, assertRequirementOwnerOrManager, projectIdForRequirement } from "../authorization";

import { acceptRequirement, applyRequirementPlan, applyTemplate, archiveRequirement, cancelRequirement, correctRequirement, createRequirement, previewRequirementPlan, reselectRequirementTemplate, rescheduleRequirement, restoreRequirement, updateRequirement } from "../services/requirement-commands";

import { addProgress } from "../services/progress";

import { createWorkItem, reorderWorkItems } from "../services/work-items";

import { getRequirement, listRequirements } from "../services/requirements";

import { completeRequirementAsPlanned } from "../services/planned-completion";

import { applyRequirementPlanInputSchema, applyTemplateInputSchema, archiveRestoreInputSchema, contentCommandSchema, completeAsPlannedInputSchema, expectedVersionInputSchema, progressInputSchema, previewRequirementPlanInputSchema, projectListInputSchema, requirementListInputSchema, reorderWorkItemsInputSchema, reselectRequirementTemplateInputSchema } from "../../shared/contracts";
import { idOf, parsedBody, parsedQuery, requireReady } from './context';

export function registerRequirementsRoutes(app: FastifyInstance) {
  app.get('/api/requirements', { preHandler: requireWorkspaceRead }, async (request) => {
    const input = parsedQuery(request, requirementListInputSchema); const actor = actorFromRequest(request);
    if (input.includeDeleted) assertProjectManager(actor, input.projectId); else assertProjectReadable(actor, input.projectId);
    return listRequirements(input);
  });

  app.get('/api/requirements/:id', { preHandler: requireWorkspaceRead }, async (request) => {
    const id = idOf(request); const input = parsedQuery(request, projectListInputSchema); const actor = actorFromRequest(request); const projectId = projectIdForRequirement(id);
    if (input.includeDeleted) assertProjectResourceManager(actor, projectId, '需求不存在'); else assertProjectResourceReadable(actor, projectId, '需求不存在');
    const requirement = getRequirement(id, input.includeDeleted);
    if (actor.type === 'guest') { const {issueSummary: _issues, ...detail} = requirement; return detail; }
    return requirement;
  });

  app.post('/api/requirements', { preHandler: requireReady }, async (request) => {
    const input = parsedBody(request, createRequirementInputSchema); const actor = actorFromRequest(request); assertProjectManager(actor, input.projectId);
    return createRequirement(input, actor);
  });

  app.patch('/api/requirements/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request), actor = actorFromRequest(request);
    if(isCoordinationEdit(request.body))assertCoordinationAccess('requirement',id,request.body,actor);else assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return updateRequirement(id, parsedBody(request, updateRequirementInputSchema), actor);
  });

  app.post('/api/requirements/:id/correct', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return correctRequirement(id, parsedBody(request, requirementCorrectionInputSchema), actor);
  });

  for(const action of ['start','complete'] as const)app.post('/api/requirements/:id/'+action,{preHandler:requireReady},async request=>executeDirectRequirement(idOf(request),action,parsedBody(request,directRequirementCommandSchema),actorFromRequest(request)));

  app.get('/api/requirements/:id/start-conditions',{preHandler:requireReady},async request=>{const id=idOf(request);assertRequirementOwnerOrManager(actorFromRequest(request),id);return directStartConditions(id);});

  app.post('/api/requirements/:id/rework',{preHandler:requireReady},async request=>returnRequirement(idOf(request),parsedBody(request,reasonCommandSchema.extend({workItemIds:z.array(idSchema).optional(),progress:z.number().int().min(0).max(99).optional()})),actorFromRequest(request)));

  app.post('/api/requirements/:id/accept', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertRequirementAcceptor(id,actor);
    return acceptRequirement(id, parsedBody(request, contentCommandSchema), actor);
  });

  app.post('/api/requirements/:id/complete-as-planned', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return completeRequirementAsPlanned(id, parsedBody(request, completeAsPlannedInputSchema), actor);
  });

  app.post('/api/requirements/:id/cancel', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return cancelRequirement(id, parsedBody(request, reasonCommandSchema), actor);
  });

  app.post('/api/requirements/:id/reschedule', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return rescheduleRequirement(id, parsedBody(request, rescheduleRequirementInputSchema), actor);
  });

  app.post('/api/requirements/:id/reselect-template', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return reselectRequirementTemplate(id, parsedBody(request, reselectRequirementTemplateInputSchema), actor);
  });

  app.delete('/api/requirements/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return archiveRequirement(id, parsedBody(request, expectedVersionInputSchema), actor);
  });

  app.post('/api/requirements/:id/restore', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return restoreRequirement(id, actor, parsedBody(request, archiveRestoreInputSchema));
  });

  app.post('/api/requirements/:id/apply-template', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return applyTemplate(id, parsedBody(request, applyTemplateInputSchema), actor);
  });

  app.post('/api/requirements/:id/plan-preview', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); assertProjectResourceManager(actorFromRequest(request), projectIdForRequirement(id), '需求不存在');
    return previewRequirementPlan(id, parsedBody(request, previewRequirementPlanInputSchema));
  });

  app.post('/api/requirements/:id/apply-plan', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在');
    return applyRequirementPlan(id, parsedBody(request, applyRequirementPlanInputSchema), actor);
  });

  app.post('/api/requirements/:id/work-items', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertRequirementOwnerOrManager(actor, id);
    return createWorkItem(id, parsedBody(request, createWorkItemInputSchema), actor);
  });

  app.post('/api/requirements/:id/reorder-work-items', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertRequirementOwnerOrManager(actor, id);
    const input = parsedBody(request, reorderWorkItemsInputSchema); return reorderWorkItems(id, input.ids, actor, input);
  });

  app.post('/api/requirements/:id/progress', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const input = parsedBody(request, progressInputSchema); const actor = actorFromRequest(request);
    assertCanAddProgress(actor, id, input.workItemId ? String(input.workItemId) : null);
    return addProgress(id, input, actor);
  });
}
