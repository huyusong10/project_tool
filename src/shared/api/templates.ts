

export type TemplateItem = {
  workStage?:import('../execution-stage').WorkStage|null;milestoneKind?:import('../execution-stage').MilestoneKind;
  kind?:'work'|'milestone';arrangement?:'early'|'late';arrangementAnchor?:string|null;confirmationMode?:'auto'|'manual';
  predecessorIds?: string[];
  id: string; templateId: string; title: string; sortOrder: number;
  startOffsetDays: number; durationDays: number; milestoneLabel: string | null; deletedAt?: string | null;
};

export type WorkItemTemplate = {
  layout?:{positions:Record<string,{x:number;y:number}>;version:number;direction:'right'|'down'};
  dependencyMode?: 'legacy' | 'dependencies';
  id: string; projectId: string; name: string; description: string; createdAt: string; updatedAt: string; deletedAt?: string | null; items: TemplateItem[];
};

// Request DTOs are inferred from the same schemas used by REST and MCP.
import type { z } from 'zod';
import type { createTemplateInputSchema, updateTemplateInputSchema } from '../contracts';
export type CreateTemplateInput = z.input<typeof createTemplateInputSchema>;
export type UpdateTemplateInput = z.input<typeof updateTemplateInputSchema>;
