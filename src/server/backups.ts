import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config';
import { sqlite } from './database';

fs.mkdirSync(config.backupDir, { recursive: true });

function backupFilename(date = new Date()) {
  return `project-manage-${date.toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`;
}

function safeBackupPath(filename: string) {
  if (!/^project-manage-[0-9T-]+\.db$/.test(filename)) throw new Error('备份文件名不合法');
  const resolved = path.resolve(config.backupDir, filename);
  if (path.dirname(resolved) !== path.resolve(config.backupDir)) throw new Error('备份文件不合法');
  return resolved;
}

export function listBackups() {
  return fs.readdirSync(config.backupDir)
    .filter((name) => name.endsWith('.db'))
    .map((name) => {
      const stat = fs.statSync(path.join(config.backupDir, name));
      return { name, size: stat.size, createdAt: stat.birthtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

export async function createBackup() {
  const name = backupFilename();
  const destination = safeBackupPath(name);
  await sqlite.backup(destination);
  cleanupOldBackups();
  return { name, size: fs.statSync(destination).size, createdAt: new Date().toISOString() };
}

export function cleanupOldBackups() {
  const cutoff = Date.now() - config.backupRetentionDays * 86400000;
  for (const backup of listBackups()) {
    if (new Date(backup.createdAt).getTime() < cutoff) fs.unlinkSync(safeBackupPath(backup.name));
  }
}

export function scheduleRestore(filename: string) {
  const source = safeBackupPath(filename);
  if (!fs.existsSync(source)) throw new Error('备份不存在');
  const checkDb = new Database(source, { readonly: true });
  const integrity = checkDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
  checkDb.close();
  if (integrity[0]?.integrity_check !== 'ok') throw new Error('备份数据库校验失败');

  setTimeout(() => {
    sqlite.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const target = `${config.dbPath}${suffix}`;
      if (fs.existsSync(target)) fs.rmSync(target, { force: true });
    }
    fs.copyFileSync(source, config.dbPath);
    process.exit(75);
  }, 500);
  return { ok: true, message: '恢复已通过校验，服务即将自动重启。' };
}

let lastScheduledBackup = '';

export function startBackupScheduler() {
  cleanupOldBackups();
  const check = async () => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (now.getHours() === 2 && lastScheduledBackup !== day) {
      lastScheduledBackup = day;
      try { await createBackup(); } catch (error) { console.error('自动备份失败', error); }
    }
  };
  void check();
  return setInterval(() => void check(), 15 * 60 * 1000);
}
