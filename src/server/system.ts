import fs from 'node:fs';
import { config } from './config';
import { sqlite } from './database';
import { listRestorableBackups } from './backups';
import { readRestoreStatus } from './restore-status';

const serviceStartedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();

function fileSize(filename: string) {
  try {
    return fs.statSync(filename).size;
  } catch {
    return 0;
  }
}

function nextBackupAt(now = new Date()) {
  const next = new Date(now);
  next.setHours(2, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

export function getSystemOverview() {
  const backups = listRestorableBackups();
  const restorableBackups = backups.filter((backup) => backup.restorable);
  const lastBackupAt = restorableBackups[0]?.createdAt ?? null;
  const mainSizeBytes = fileSize(config.dbPath);
  const walSizeBytes = fileSize(`${config.dbPath}-wal`);
  const shmSizeBytes = fileSize(`${config.dbPath}-shm`);
  const journalMode = String(sqlite.pragma('journal_mode', { simple: true }) || '').toUpperCase();
  const now = Date.now();

  return {
    status: 'ok',
    service: {
      version: config.appVersion,
      startedAt: serviceStartedAt,
      uptimeSeconds: Math.floor(process.uptime()),
      environment: config.nodeEnv,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
      host: config.host,
      port: config.port,
      protocol: 'http',
    },
    database: {
      path: config.dbPath,
      backupDirectory: config.backupDir,
      mainSizeBytes,
      walSizeBytes,
      shmSizeBytes,
      totalSizeBytes: mainSizeBytes + walSizeBytes + shmSizeBytes,
      journalMode,
      importMaxBytes: config.databaseImportMaxBytes,
    },
    backups: {
      count: backups.length,
      restorableCount: restorableBackups.length,
      totalSizeBytes: backups.reduce((total, backup) => total + backup.size, 0),
      lastCreatedAt: lastBackupAt,
      overdue: !lastBackupAt || now - new Date(lastBackupAt).getTime() > 26 * 60 * 60 * 1000,
      retentionDays: config.backupRetentionDays,
      maxCount: config.backupMaxCount,
      nextScheduledAt: nextBackupAt(),
    },
    lastRestore: readRestoreStatus(config.dbPath),
  };
}

export function checkDatabaseIntegrity() {
  const startedAt = Date.now();
  try {
    const rows = sqlite.pragma('integrity_check') as Array<{ integrity_check: string }>;
    const messages = rows.map((row) => row.integrity_check);
    const ok = messages.length === 1 && messages[0] === 'ok';
    return {
      ok,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      message: ok ? '数据库结构与数据页校验正常' : messages.slice(0, 5).join('；'),
    };
  } catch (error) {
    console.error('[system] database integrity check failed', error);
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      message: '数据库完整性检查失败',
    };
  }
}
