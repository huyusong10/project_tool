

export type ProgressUpdate = {
  jiraSyncState?: import('../jira-pr').JiraProgressSyncState; jiraPrId?: string | null; jiraCommentId?: string | null; jiraSyncedAt?: string | null;
  jiraManualAccountId?: string | null; jiraManualReason?: string | null; jiraManualUrl?: string | null;
  id: string; requirementId: string; workItemId: string | null; workItemTitle: string | null;
  percent: number; workItemPercent: number | null; content: string; eventType: string; supersedesId?: string | null;
  createdByAccountId?: string | null; createdByName?: string | null; createdAt: string; updatedAt: string;
};

// Request DTOs are inferred from the same schemas used by REST and MCP.
import type { z } from 'zod';
import type { progressInputSchema } from '../contracts';
export type ProgressInput = z.input<typeof progressInputSchema>;
