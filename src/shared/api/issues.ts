

export type IssueUpdate = {
  id: string; issueId: string; progress: number | null; content: string; eventType: string; supersedesId?: string | null;
  createdByAccountId: string | null; createdByName: string | null; createdAt: string; updatedAt: string;
};

export type Issue = {
  nextReviewAt?:string|null;
  id: string; projectId: string; projectName: string; requirementId: string | null; requirementTitle: string | null;
  sourceRef: string | null; title: string; impact: string | null; reporter: string | null;
  ownerId: string | null; ownerName: string | null; status: string; priority: string; progress: number;
  discoveredAt: string; dueDate: string | null; resolvedAt: string | null;
  version: number; createdAt: string; updatedAt: string; latestUpdate: string | null; latestUpdateAt: string | null;
  overdue: boolean; updates?: IssueUpdate[];
};

export type IssuePage = {
  items: Issue[]; total: number; page: number; pageSize: number; pages: number;
  summary: {
    total: number; inProgress: number; deferred: number; resolved: number;
    active: number; highPriority: number; overdue: number; unassigned: number; closureRate: number;
  };
};

// Request DTOs are inferred from the same schemas used by REST and MCP.
import type { z } from 'zod';
import type { createIssueInputSchema, updateIssueInputSchema, issueUpdateInputSchema } from '../contracts';
export type CreateIssueInput = z.input<typeof createIssueInputSchema>;
export type UpdateIssueInput = z.input<typeof updateIssueInputSchema>;
export type IssueUpdateInput = z.input<typeof issueUpdateInputSchema>;
