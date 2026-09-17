

import { updateWorkItemInputSchema, startWorkItemInputSchema, reasonCommandSchema } from "../../shared/workflow-contracts";

import { isCoordinationEdit, assertCoordinationAccess } from "../services/blocker-coordination";

import type { FastifyInstance } from 'fastify';

import { actorFromRequest, assertProjectResourceManager, assertWorkItemParticipantOrManager, assertWorkItemRequirementOwnerOrManager, projectIdForWorkItem } from "../authorization";

import { blockWorkItem, cancelWorkItem, completeWorkItem, correctWorkItem, deleteWorkItem, reopenWorkItem, startWorkItem, unblockWorkItem, updateWorkItem } from "../services/work-items";

import { completeWorkItemAsPlanned } from "../services/planned-completion";

import { optionalContentCommandSchema, completeAsPlannedInputSchema, expectedVersionInputSchema, reopenWorkItemInputSchema, workItemCorrectionSchema } from "../../shared/contracts";
import { idOf, parsedBody, requireReady } from './context';

export function registerWorkItemsRoutes(app: FastifyInstance) {
  app.post('/api/work-items/:id/complete-as-planned', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForWorkItem(id), '工作项不存在');
    return completeWorkItemAsPlanned(id, parsedBody(request, completeAsPlannedInputSchema), actor);
  });

  app.patch('/api/work-items/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request), actor = actorFromRequest(request);
    if(isCoordinationEdit(request.body))assertCoordinationAccess('work',id,request.body,actor);else assertWorkItemRequirementOwnerOrManager(actor, id);
    return updateWorkItem(id, parsedBody(request, updateWorkItemInputSchema), actor);
  });

  for (const [action, handler, inputSchema] of [
    ['start', (id: string, input: any, actor: any) => startWorkItem(id, input, actor), startWorkItemInputSchema],
    ['complete', (id: string, input: any, actor: any) => completeWorkItem(id, input, actor), optionalContentCommandSchema],
    ['block', (id: string, input: any, actor: any) => blockWorkItem(id, input, actor), reasonCommandSchema],
    ['unblock', (id: string, input: any, actor: any) => unblockWorkItem(id, input, actor), expectedVersionInputSchema],
  ] as const) {
    app.post(`/api/work-items/:id/${action}`, { preHandler: requireReady }, async (request) => {
      const id = idOf(request); const input = parsedBody(request, inputSchema); const actor = actorFromRequest(request);
      assertWorkItemParticipantOrManager(actor, id);
      return handler(id, input, actor);
    });
  }

  app.post('/api/work-items/:id/cancel', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertWorkItemRequirementOwnerOrManager(actor, id);
    return cancelWorkItem(id, parsedBody(request, reasonCommandSchema), actor);
  });

  app.post('/api/work-items/:id/reopen', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertWorkItemRequirementOwnerOrManager(actor, id);
    return reopenWorkItem(id, parsedBody(request, reopenWorkItemInputSchema), actor);
  });

  app.post('/api/work-items/:id/correct', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertProjectResourceManager(actor, projectIdForWorkItem(id), '工作项不存在');
    return correctWorkItem(id, parsedBody(request, workItemCorrectionSchema), actor);
  });

  app.delete('/api/work-items/:id', { preHandler: requireReady }, async (request) => {
    const id = idOf(request); const actor = actorFromRequest(request); assertWorkItemRequirementOwnerOrManager(actor, id);
    return deleteWorkItem(id, parsedBody(request, expectedVersionInputSchema), actor);
  });
}
