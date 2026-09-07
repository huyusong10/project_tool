import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { clearRestoreStatus, readRestoreStatus, restoreStatusPath, writeRestoreStatus } from '../src/server/restore-status';

const directories: string[] = [];

function temporaryDatabasePath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-status-'));
  directories.push(directory);
  return path.join(directory, 'service.db');
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

it('持久化最近恢复结果并且不向接口暴露失败库完整路径', () => {
  const databasePath = temporaryDatabasePath();
  writeRestoreStatus(databasePath, {
    operationId: 'restore-1', outcome: 'rolled_back', backupName: 'target.db', safetyBackupName: 'safety.db',
    updatedAt: '2026-09-05T00:00:00.000Z', message: '已自动回滚', failedDatabase: 'D:\\private\\service.db.failed-restore',
  });
  expect(readRestoreStatus(databasePath)).toEqual({
    operationId: 'restore-1', outcome: 'rolled_back', backupName: 'target.db', safetyBackupName: 'safety.db',
    updatedAt: '2026-09-05T00:00:00.000Z', message: '已自动回滚', failedDatabase: 'service.db.failed-restore',
  });
  clearRestoreStatus(databasePath);
  expect(fs.existsSync(restoreStatusPath(databasePath))).toBe(false);
  expect(readRestoreStatus(databasePath)).toBeNull();
});

it('损坏或字段不完整的恢复状态按无记录处理', () => {
  const databasePath = temporaryDatabasePath();
  fs.writeFileSync(restoreStatusPath(databasePath), '{broken');
  expect(readRestoreStatus(databasePath)).toBeNull();
  fs.writeFileSync(restoreStatusPath(databasePath), JSON.stringify({ operationId: 'restore-2', outcome: 'succeeded' }));
  expect(readRestoreStatus(databasePath)).toBeNull();
});
