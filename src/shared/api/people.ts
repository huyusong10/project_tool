

export type Person = {
  id: string; name: string; jobTitle: string | null; active: boolean | number;
  projectRole?: 'viewer' | 'member' | 'manager'; username?: string | null; accountStatus?: 'active' | 'disabled' | null;
  accountDeletedAt?: string | null;
  membershipUpdatedAt?: string | null;
  createdAt: string; updatedAt: string; deletedAt?: string | null;
};

// Request DTOs are inferred from the same schemas used by REST and MCP.
import type { z } from 'zod';
import type { createPersonInputSchema, updatePersonInputSchema } from '../contracts';
export type CreatePersonInput = z.input<typeof createPersonInputSchema>;
export type UpdatePersonInput = z.input<typeof updatePersonInputSchema>;
