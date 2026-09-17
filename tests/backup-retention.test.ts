import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-manage-backup-retention-'));
const backupDir = path.join(directory, 'backups');
process.env.DB_PATH = path.join(directory, 'test.db');
process.env.BACKUP_DIR = backupDir;
process.env.SEED_DEMO = '0';
process.env.NODE_ENV = 'test';
process.env.APP_PASSWORD_HASH = 'scrypt$test$00';
process.env.SESSION_SECRET = 'backup-retention-test-secret-more-than-32-chars';
process.env.BACKUP_RETENTION_DAYS = '30';
process.env.BACKUP_MAX_COUNT = '1';

let sqlite: import('better-sqlite3').Database;

beforeAll(async () => {
  ({ sqlite } = await import('./support/database'));
});

afterAll(() => {
  if (sqlite.open) sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

it('不可恢复文件不挤占有效备份的数量上限', async () => {
  fs.mkdirSync(backupDir, { recursive: true });
  const oldValid = path.join(backupDir, 'valid-old.db');
  const newValid = path.join(backupDir, 'valid-new.db');
  const invalid = path.join(backupDir, 'invalid-newest.db');
  await sqlite.backup(oldValid);
  await sqlite.backup(newValid);
  fs.writeFileSync(invalid, 'not-a-sqlite-database');
  const now = Date.now();
  fs.utimesSync(oldValid, new Date(now), new Date(now));
  fs.utimesSync(newValid, new Date(now + 60_000), new Date(now + 60_000));
  fs.utimesSync(invalid, new Date(now + 120_000), new Date(now + 120_000));

  const { cleanupOldBackups } = await import('../src/server/backups');
  cleanupOldBackups();

  expect(fs.existsSync(invalid)).toBe(true);
  expect(fs.existsSync(newValid)).toBe(true);
  expect(fs.existsSync(oldValid)).toBe(false);
});
