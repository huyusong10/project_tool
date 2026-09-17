

export type Project = {
  id: string; name: string; status: string; plannedStart: string | null; plannedEnd: string | null;
  defaultTemplateId: string | null; createdAt: string; updatedAt: string; deletedAt?: string | null;
  guestVisible?: boolean; publicReadOnly?: boolean; isSample: boolean; projectRole?: 'viewer' | 'member' | 'manager'; canManage?: boolean;
};

// Request DTOs are inferred from the same schemas used by REST and MCP.
import type { z } from 'zod';
import type { createProjectInputSchema, projectInputSchema, projectArchiveInputSchema, projectMemberMutationInputSchema } from '../contracts';
export type CreateProjectInput = z.input<typeof createProjectInputSchema>;
export type ProjectInput = z.input<typeof projectInputSchema>;
export type ProjectArchiveInput = z.input<typeof projectArchiveInputSchema>;
export type ProjectMemberMutationInput = z.input<typeof projectMemberMutationInputSchema>;
