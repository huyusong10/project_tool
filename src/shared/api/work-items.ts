

export type WorkItemCancellationImpact = {
  revision: number;
  dependencies: Array<{ id: string; sourceTitle: string; targetTitle: string }>;
  milestones: Array<{ id: string; title: string }>;
};
export type WorkItem = import('../forecast-basis').ExecutionMetadata & {
  cancellationImpact?: WorkItemCancellationImpact;
  referenceLinks?: import('../reference-links').ReferenceLink[];
  jiraLinks?: import('../jira-links').JiraEntry[];
  workStage?:import('../execution-stage').WorkStage|null; progressWeight?:number|null;
  durationDays?:number|null;
  dependencyRevision?:number; unmetPredecessors?:Array<{id:string;title:string}>;
  id: string; requirementId: string; templateItemId: string | null; title: string; ownerId: string | null; ownerName: string | null;
  collaborators: Array<{ id: string; name: string; jobTitle: string | null }>;
  assigneeIds: string[]; assigneeNames: string[];
  status: string; plannedStart: string | null; plannedEnd: string | null; actualStart: string | null; actualEnd: string | null;
  cancelledAt?: string | null;
  forecastEnd: string | null; blockedAt: string | null; blockedReason: string | null;
  milestoneLabel: string | null;
  progress: number;
  sortOrder: number; version: number; createdAt: string; updatedAt: string;
};

// Request DTOs are inferred from the same schemas used by REST and MCP.
import type { z } from 'zod';
import type { createWorkItemInputSchema, updateWorkItemInputSchema, startWorkItemInputSchema } from '../contracts';
export type CreateWorkItemInput = z.input<typeof createWorkItemInputSchema>;
export type UpdateWorkItemInput = z.input<typeof updateWorkItemInputSchema>;
export type StartWorkItemInput = z.input<typeof startWorkItemInputSchema>;
