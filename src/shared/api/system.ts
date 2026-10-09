

export type Backup = {
  name: string; size: number; createdAt: string; fingerprint: string;
  restorable?: boolean; validationError?: string | null;
  imported?: boolean;
};

export type ImportedBackup = Backup & {
  originalName: string;
  summary: { projects: number; requirements: number; people: number };
};

export type SystemOverview = {
  status: 'ok';
  service: {
    version: string; startedAt: string; uptimeSeconds: number; environment: string;
    timezone: string; host: string; port: number; protocol: 'http';
  };
  database: {
    path: string; backupDirectory: string; mainSizeBytes: number; walSizeBytes: number;
    shmSizeBytes: number; totalSizeBytes: number; journalMode: string;
    importMaxBytes?: number;
  };
  logging: { level: string; directory: string | null };
  backups: {
    count: number; restorableCount: number; totalSizeBytes: number; lastCreatedAt: string | null; overdue: boolean;
    retentionDays: number; maxCount: number; nextScheduledAt: string;
  };
  lastRestore: {
    operationId: string; outcome: 'pending' | 'succeeded' | 'rolled_back'; backupName: string;
    safetyBackupName: string; updatedAt: string; message: string; failedDatabase: string | null;
  } | null;
};

export type DatabaseIntegrityCheck = { ok: boolean; checkedAt: string; durationMs: number; message: string };

export type ApplicationMode = { issueTrackingOnly: boolean; updatedAt: string | null };

export type SystemBranding = {
  applicationMode?: ApplicationMode;
  systemName: string;
  shortName: string;
  logoUrl: string | null;
  updatedAt: string | null;
};

// Request DTOs are inferred from the same schemas used by REST and MCP.
import type { z } from 'zod';
import type { brandingInputSchema, backupRestoreInputSchema } from '../contracts';
export type BrandingInput = z.input<typeof brandingInputSchema>;
export type BackupRestoreInput = z.input<typeof backupRestoreInputSchema>;
