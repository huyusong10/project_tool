import type { WorkItem } from './work-items';
import type { ProgressUpdate } from './progress';

export type Requirement = import('../delivery').DeliveryFields & import('../intake').Organization & Partial<import('../delivery').ProcessingResult> & {
  sortOrder?:number;readinessIssues?:string[];
  stageResetAt?:string|null;executionStage?:import('../execution-stage').ExecutionStage;milestones?:import('../paths').PathMilestone[];
  pathRisk?: import('../paths').PathRisk;
  id: string; projectId: string; projectName: string; templateId: string | null; templateName: string | null; title: string; ownerId: string | null; ownerName: string | null;
  referenceLinks?: import('../reference-links').ReferenceLink[]; sourceNotes?: string | null; background?: string | null; acceptanceCriteria?: string | null; referenceUrl?: string | null;
  status: string; plannedStart: string | null; plannedEnd: string | null; progress: number; plannedProgress: number | null; progressGap: number;
  asOfDate?: string; scheduleComplete?: boolean;
  actualStart?: string | null; actualEnd?: string | null;
  acceptedAt: string | null; acceptedByAccountId: string | null; version: number;
  riskLevel: string; riskEvaluated: boolean; riskReason: string; priority: string; createdAt: string; updatedAt: string; deletedAt?: string | null;
  workItems: WorkItem[]; progressUpdates?: ProgressUpdate[]; recentProgressUpdates?: ProgressUpdate[]; delayed: boolean; highRisk: boolean;
  issueSummary?: { active: number; overdue: number };
  finishVariance: number; durationVariance: number; effectiveEnd: string | null;
  scheduleVarianceDays?: number | null; scheduleReferenceDate?: string | null;
};

export type PlanPreview = {
  requirementId: string; templateId: string; baseStart: string;
  requirementVersion: number; previewToken: string;
  entries: Array<{
    templateItemId: string; workItemId: string | null; title: string; currentStart: string | null; currentEnd: string | null;
    milestoneLabel?: string | null; proposedStart: string; proposedEnd: string; willChange: boolean; reason: 'missing_item' | 'missing_plan' | 'terminal' | 'unchanged';
  }>;
};

// Request DTOs are inferred from the same schemas used by REST and MCP.
import type { z } from 'zod';
import type { createRequirementInputSchema, updateRequirementInputSchema, requirementCorrectionInputSchema, rescheduleRequirementInputSchema, applyRequirementPlanInputSchema } from '../contracts';
export type CreateRequirementInput = z.input<typeof createRequirementInputSchema>;
export type UpdateRequirementInput = z.input<typeof updateRequirementInputSchema>;
export type RequirementCorrectionInput = z.input<typeof requirementCorrectionInputSchema>;
export type RescheduleRequirementInput = z.input<typeof rescheduleRequirementInputSchema>;
export type ApplyRequirementPlanInput = z.input<typeof applyRequirementPlanInputSchema>;
