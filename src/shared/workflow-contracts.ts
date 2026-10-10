import {z} from 'zod';
import * as contracts from './contracts';
import * as paths from './path-contracts';

// Public inputs exclude retired workflow fields; historical records keep their internal shape.
const retiredRequirement = {deliveryScope:true,executionMode:true,acceptanceOwnerId:true,unblockEstimate:true,priority:true} as const;
const retiredCoordination = {blockedCoordinatorId:true,blockedNextReviewAt:true,blockedIssueId:true} as const;
export const createRequirementInputSchema=z.object(contracts.createRequirementInputSchema.shape).omit(retiredRequirement).strict();
export const updateRequirementInputSchema=z.object(contracts.updateRequirementInputSchema.shape).omit({...retiredRequirement,...retiredCoordination}).strict();
export const requirementCorrectionInputSchema=z.object(contracts.requirementCorrectionInputSchema.shape).omit({...retiredRequirement,...retiredCoordination}).strict();
export const createWorkItemInputSchema=z.object(contracts.createWorkItemInputSchema.shape).omit(retiredCoordination).strict();
export const updateWorkItemInputSchema=z.object(contracts.updateWorkItemInputSchema.shape).omit(retiredCoordination).strict();
export const startWorkItemInputSchema=z.object({ownerId:contracts.optionalIdSchema,requirementOwnerId:contracts.optionalIdSchema,expectedRequirementVersion:contracts.expectedVersionSchema.optional(),expectedVersion:contracts.expectedVersionSchema,reason:contracts.optionalTextSchema}).strict();
export const reasonCommandSchema=z.object({expectedVersion:contracts.expectedVersionSchema,reason:z.string().trim().optional()}).strict();
export const cancelWorkItemInputSchema=reasonCommandSchema.extend({expectedDependencyRevision:z.number().int().nonnegative().optional()});
export const rescheduleRequirementInputSchema=z.object({expectedVersion:contracts.expectedVersionSchema,scheduleMode:z.enum(['start','deadline']),plannedStart:contracts.optionalDateSchema,plannedEnd:contracts.optionalDateSchema,reason:contracts.optionalTextSchema}).strict();
export const editorEntityChange=paths.editorEntityChange.extend({data:paths.editorEntityChange.shape.data.unwrap().omit({...retiredRequirement,...retiredCoordination,reviewForecast:true}).strict().default({})});
export const pathEstimateInput=z.object(paths.pathEstimateInput.shape).omit({unblockEstimate:true,reviewForecast:true}).strict();
export const dependencyChanges=paths.dependencyChanges.omit({commitment:true}).extend({
  entities:z.array(editorEntityChange).max(4000).optional(),
  estimates:z.array(pathEstimateInput.omit({expectedRevision:true}).extend({workItemId:contracts.idSchema})).max(2000).default([]),
});
export const dependencyChangesInput=paths.dependencyChangesInput.extend({changes:dependencyChanges});
export const applyDependencyChangesInput=paths.applyDependencyChangesInput.extend({changes:dependencyChanges});
