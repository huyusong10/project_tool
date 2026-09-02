import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config';
import { sqlite } from './database';

fs.mkdirSync(config.backupDir, { recursive: true });

function backupFilename(date = new Date()) {
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  const localTime = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
  return `project-manage-${localTime}.db`;
}

function safeBackupPath(filename: string) {
  if (path.basename(filename) !== filename || !filename.toLowerCase().endsWith('.db') || filename.includes('\0')) throw new Error('备份文件名不合法');
  const resolved = path.resolve(config.backupDir, filename);
  if (path.dirname(resolved) !== path.resolve(config.backupDir)) throw new Error('备份文件不合法');
  return resolved;
}

function backupCreatedAt(filename: string, stat: fs.Stats) {
  const match = /^project-manage-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})\.db$/.exec(filename);
  if (!match) return stat.mtime.toISOString();
  const [, year, month, day, hour, minute, second, millisecond] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), Number(millisecond)).toISOString();
}

export function listBackups() {
  return fs.readdirSync(config.backupDir)
    .filter((name) => name.toLowerCase().endsWith('.db'))
    .map((name) => {
      const stat = fs.statSync(path.join(config.backupDir, name));
      return { name, size: stat.size, createdAt: backupCreatedAt(name, stat) };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}

export async function createBackup() {
  let timestamp = new Date();
  let name = backupFilename(timestamp);
  while (fs.existsSync(safeBackupPath(name))) {
    timestamp = new Date(timestamp.getTime() + 1);
    name = backupFilename(timestamp);
  }
  const destination = safeBackupPath(name);
  await sqlite.backup(destination);
  cleanupOldBackups();
  const stat = fs.statSync(destination);
  return { name, size: stat.size, createdAt: backupCreatedAt(name, stat) };
}

export function deleteBackup(filename: string) {
  const target = safeBackupPath(filename);
  if (!fs.existsSync(target)) throw new Error('备份不存在');
  fs.unlinkSync(target);
  return { ok: true, name: filename };
}

export function cleanupOldBackups() {
  const cutoff = Date.now() - config.backupRetentionDays * 86400000;
  for (const backup of listBackups()) {
    if (new Date(backup.createdAt).getTime() < cutoff) fs.unlinkSync(safeBackupPath(backup.name));
  }
  for (const backup of listBackups().slice(config.backupMaxCount)) fs.unlinkSync(safeBackupPath(backup.name));
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
    const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    if (now.getHours() === 2 && lastScheduledBackup !== day) {
      lastScheduledBackup = day;
      try { await createBackup(); } catch (error) { console.error('自动备份失败', error); }
    }
  };
  void check();
  return setInterval(() => void check(), 15 * 60 * 1000);
}
