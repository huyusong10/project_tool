

export type ApiToken = { id: string; name: string; prefix: string; accountId: string; accountName?: string | null; expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null; createdAt: string };

// Request DTOs are inferred from the same schemas used by REST and MCP.
import type { z } from 'zod';
import type { apiTokenInputSchema } from '../contracts';
export type ApiTokenInput = z.input<typeof apiTokenInputSchema>;
