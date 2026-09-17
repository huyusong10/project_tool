import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  activatePreparedDatabase,
  cleanupFailedDatabaseSwaps,
  clearDatabaseSwapRollback,
  databaseSwapRollbackPath,
  recoverInterruptedDatabaseSwap,
  rollbackFailedDatabaseSwap,
} from '../src/server/database-swap';

const directories: string[] = [];

function temporaryPaths() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'database-swap-'));
  directories.push(directory);
  return {
    database: path.join(directory, 'current.db'),
    replacement: path.join(directory, 'current.db.restore'),
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('数据库恢复文件切换', () => {
  it('安装新库后保留旧库至启动校验完成，并删除旧WAL旁文件', () => {
    const { database, replacement } = temporaryPaths();
    fs.writeFileSync(database, 'old');
    fs.writeFileSync(`${database}-wal`, 'old-wal');
    fs.writeFileSync(`${database}-shm`, 'old-shm');
    fs.writeFileSync(replacement, 'new');

    activatePreparedDatabase(database, replacement);

    expect(fs.readFileSync(database, 'utf8')).toBe('new');
    expect(fs.existsSync(replacement)).toBe(false);
    expect(fs.readFileSync(databaseSwapRollbackPath(database), 'utf8')).toBe('old');
    expect(fs.existsSync(`${database}-wal`)).toBe(false);
    expect(fs.existsSync(`${database}-shm`)).toBe(false);
    clearDatabaseSwapRollback(database);
    expect(fs.existsSync(databaseSwapRollbackPath(database))).toBe(false);
  });

  it('安装新库失败时立即放回原库', () => {
    const { database, replacement } = temporaryPaths();
    fs.writeFileSync(database, 'old');

    expect(() => activatePreparedDatabase(database, replacement)).toThrow();
    expect(fs.readFileSync(database, 'utf8')).toBe('old');
    expect(fs.existsSync(databaseSwapRollbackPath(database))).toBe(false);
  });

  it('启动时恢复中断切换，已存在新库时等待校验后再清理旧库', () => {
    const { database } = temporaryPaths();
    const rollback = databaseSwapRollbackPath(database);
    fs.writeFileSync(rollback, 'old');
    recoverInterruptedDatabaseSwap(database);
    expect(fs.readFileSync(database, 'utf8')).toBe('old');
    expect(fs.existsSync(rollback)).toBe(false);

    fs.writeFileSync(database, 'new');
    fs.writeFileSync(rollback, 'old-again');
    recoverInterruptedDatabaseSwap(database);
    expect(fs.readFileSync(database, 'utf8')).toBe('new');
    expect(fs.existsSync(rollback)).toBe(true);
    clearDatabaseSwapRollback(database);
    expect(fs.existsSync(rollback)).toBe(false);
  });

  it('数据库模块校验完成后仍保留原库直到服务监听成功', () => {
    const { database } = temporaryPaths();
    const backupDirectory = path.join(path.dirname(database), 'backups');
    new Database(database).close();
    fs.writeFileSync(databaseSwapRollbackPath(database), 'previous-database');
    const script = `const fs = await import('node:fs'); const database = await (await import('./src/server/database.ts')).initializeDatabase(); console.log('rollback=' + fs.existsSync(process.env.DB_PATH + '.pre-restore')); database.sqlite.close();`;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--eval', script], {
      cwd: process.cwd(),
      env: { ...process.env, DB_PATH: database, BACKUP_DIR: backupDirectory, SEED_DEMO: '0', NODE_ENV: 'test' },
      encoding: 'utf8',
    });
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toContain('rollback=true');
    expect(fs.readFileSync(databaseSwapRollbackPath(database), 'utf8')).toBe('previous-database');
  });

  it('恢复库启动失败时归档失败库及旁文件，并切回原库', () => {
    const { database } = temporaryPaths();
    const rollback = databaseSwapRollbackPath(database);
    fs.writeFileSync(database, 'invalid-new');
    fs.writeFileSync(`${database}-wal`, 'invalid-wal');
    fs.writeFileSync(rollback, 'valid-old');

    const recovered = rollbackFailedDatabaseSwap(database);

    expect(fs.readFileSync(database, 'utf8')).toBe('valid-old');
    expect(fs.existsSync(rollback)).toBe(false);
    expect(recovered?.failedDatabase).toBeTruthy();
    expect(fs.readFileSync(recovered!.failedDatabase!, 'utf8')).toBe('invalid-new');
    expect(fs.readFileSync(`${recovered!.failedDatabase!}-wal`, 'utf8')).toBe('invalid-wal');
    expect(rollbackFailedDatabaseSwap(database)).toBeNull();
  });

  it('失败库只保留最近数量和当前状态引用，旁文件随主文件清理', () => {
    const { database } = temporaryPaths();
    fs.writeFileSync(database, 'current');
    const now = new Date('2026-09-05T12:00:00.000Z');
    const createFailure = (name: string, modifiedAt: string) => {
      const target = `${database}.failed-restore-${name}`;
      fs.writeFileSync(target, name);
      fs.writeFileSync(`${target}-wal`, `${name}-wal`);
      fs.utimesSync(target, new Date(modifiedAt), new Date(modifiedAt));
      return target;
    };
    const newest = createFailure('newest', '2026-09-05T11:00:00.000Z');
    const recent = createFailure('recent', '2026-09-04T11:00:00.000Z');
    const overCount = createFailure('over-count', '2026-09-03T11:00:00.000Z');
    const referencedOld = createFailure('referenced-old', '2026-07-01T00:00:00.000Z');
    fs.writeFileSync(`${database}.failed-restore-orphan-wal`, 'orphan');

    const removed = cleanupFailedDatabaseSwaps(database, {
      retentionDays: 30,
      maxCount: 2,
      preserveFile: path.basename(referencedOld),
      now,
    });

    expect(removed).toEqual([path.basename(overCount)]);
    expect(fs.existsSync(newest)).toBe(true);
    expect(fs.existsSync(recent)).toBe(true);
    expect(fs.existsSync(referencedOld)).toBe(true);
    expect(fs.existsSync(`${overCount}-wal`)).toBe(false);
    expect(fs.existsSync(`${database}.failed-restore-orphan-wal`)).toBe(false);
    expect(fs.readFileSync(database, 'utf8')).toBe('current');
  });
});
