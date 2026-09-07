import fs from 'node:fs';
import path from 'node:path';

export type RestoreStatus = {
  operationId: string;
  outcome: 'pending' | 'succeeded' | 'rolled_back';
  backupName: string;
  safetyBackupName: string;
  updatedAt: string;
  message: string;
  failedDatabase: string | null;
};

export function restoreStatusPath(databasePath: string) {
  return `${databasePath}.restore-status.json`;
}

export function readRestoreStatus(databasePath: string): RestoreStatus | null {
  try {
    const value = JSON.parse(fs.readFileSync(restoreStatusPath(databasePath), 'utf8')) as Partial<RestoreStatus>;
    if (typeof value.operationId !== 'string' || !value.operationId
      || !['pending', 'succeeded', 'rolled_back'].includes(String(value.outcome))
      || typeof value.backupName !== 'string' || !value.backupName
      || typeof value.safetyBackupName !== 'string' || !value.safetyBackupName
      || typeof value.updatedAt !== 'string' || !value.updatedAt
      || typeof value.message !== 'string' || !value.message) return null;
    return {
      operationId: value.operationId,
      outcome: value.outcome as RestoreStatus['outcome'],
      backupName: value.backupName,
      safetyBackupName: value.safetyBackupName,
      updatedAt: value.updatedAt,
      message: value.message,
      failedDatabase: typeof value.failedDatabase === 'string' ? value.failedDatabase.split(/[\\/]/).at(-1) || path.basename(value.failedDatabase) : null,
    };
  } catch {
    return null;
  }
}

export function writeRestoreStatus(databasePath: string, status: RestoreStatus) {
  fs.writeFileSync(restoreStatusPath(databasePath), `${JSON.stringify(status)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function clearRestoreStatus(databasePath: string) {
  const target = restoreStatusPath(databasePath);
  if (fs.existsSync(target)) fs.rmSync(target, { force: true });
}
