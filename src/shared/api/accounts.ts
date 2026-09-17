

export type Session = {
  authenticated: boolean; accountId?: string; username: string | null; httpWarning: boolean;
  role: 'guest' | 'user' | 'project_manager' | 'admin'; globalRole: 'guest' | 'user' | 'admin';
  personId: string | null; mustChangePassword: boolean; managedProjectIds: string[];
};

export type Account = {
  id: string; username: string; personId: string | null; personName: string | null; jobTitle: string | null;
  globalRole: 'user' | 'admin'; role: 'user' | 'project_manager' | 'admin'; status: 'active' | 'disabled';
  mustChangePassword: boolean; isBuiltin: boolean; lastLoginAt: string | null; createdAt: string; updatedAt: string;
  managedProjects: Array<{ id: string; name: string }>;
  activeAssignments: { requirements: number; workItems: number; issues: number };
};

// Request DTOs are inferred from the same schemas used by REST and MCP.
import type { z } from 'zod';
import type { accountInputSchema, openAccountInputSchema } from '../contracts';
export type AccountInput = z.input<typeof accountInputSchema>;
export type OpenAccountInput = z.input<typeof openAccountInputSchema>;
