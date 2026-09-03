import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config';
import { sqlite } from './database';
import { fail, notFound } from './errors';

fs.mkdirSync(config.backupDir, { recursive: true });

function backupFilename(date = new Date()) {
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  const localTime = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
  return `project-manage-${localTime}.db`;
}

function safeBackupPath(filename: string) {
  if (path.basename(filename) !== filename || !filename.toLowerCase().endsWith('.db') || filename.includes('\0')) fail('备份文件名不合法');
  const resolved = path.resolve(config.backupDir, filename);
  if (path.dirname(resolved) !== path.resolve(config.backupDir)) fail('备份文件不合法');
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

export async function createBackup(options: { cleanup?: boolean } = {}) {
  let timestamp = new Date();
  let name = backupFilename(timestamp);
  while (fs.existsSync(safeBackupPath(name))) {
    timestamp = new Date(timestamp.getTime() + 1);
    name = backupFilename(timestamp);
  }
  const destination = safeBackupPath(name);
  await sqlite.backup(destination);
  if (options.cleanup !== false) cleanupOldBackups();
  const stat = fs.statSync(destination);
  return { name, size: stat.size, createdAt: backupCreatedAt(name, stat) };
}

export function deleteBackup(filename: string) {
  const target = safeBackupPath(filename);
  if (!fs.existsSync(target)) notFound('备份不存在');
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

function validateBackup(filename: string) {
  const source = safeBackupPath(filename);
  if (!fs.existsSync(source)) notFound('备份不存在');
  let checkDb: InstanceType<typeof Database> | undefined;
  let integrity: Array<{ integrity_check: string }>;
  try {
    checkDb = new Database(source, { readonly: true });
    integrity = checkDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
  } catch {
    fail('备份数据库文件无效');
  } finally {
    checkDb?.close();
  }
  if (integrity[0]?.integrity_check !== 'ok') fail('备份数据库校验失败', 'DEPENDENCY_CONFLICT', 409);
  return source;
}

export async function prepareRestore(filename: string) {
  const source = validateBackup(filename);
  // 恢复准备期间暂不清理旧备份，避免待恢复的旧文件被保留策略提前删除。
  const safetyBackup = await createBackup({ cleanup: false });
  return { source, safetyBackup };
}

export async function scheduleRestore(filename: string) {
  const { source, safetyBackup } = await prepareRestore(filename);

  setTimeout(() => {
    sqlite.close();
    const replacement = `${config.dbPath}.restore`;
    if (fs.existsSync(replacement)) fs.rmSync(replacement, { force: true });
    fs.copyFileSync(source, replacement);
    for (const suffix of ['', '-wal', '-shm']) {
      const target = `${config.dbPath}${suffix}`;
      if (fs.existsSync(target)) fs.rmSync(target, { force: true });
    }
    fs.renameSync(replacement, config.dbPath);
    cleanupOldBackups();
    process.exit(75);
  }, 800);
  return {
    ok: true,
    message: '目标备份已通过校验，当前数据库已安全备份，服务即将自动重启。',
    safetyBackupName: safetyBackup.name,
  };
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
