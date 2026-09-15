import {initializeWorkspaceOrder} from './workspace-migration';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { config } from './config';
import { sqlite } from './database';
import { inspectDatabaseConsistency } from './database-validation';
import { activatePreparedDatabase, cleanupFailedDatabaseSwaps, databaseSwapRollbackPath } from './database-swap';
import { clearRestoreStatus, readRestoreStatus, writeRestoreStatus, type RestoreStatus } from './restore-status';
import { AppError, fail, notFound } from './errors';
import { pauseDatabaseRequests, resumeDatabaseRequests } from './database-maintenance';

fs.mkdirSync(config.backupDir, { recursive: true });

const INCOMPLETE_BACKUP_RETENTION_MS = 24 * 60 * 60 * 1000;
const INCOMPLETE_BACKUP_PATTERN = /^project-manage-(?:pre-migration-)?\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z?\.db\.partial-[0-9a-f-]{36}$/;
const IMPORT_NAME_PATTERN = /^project-manage-import-[0-9a-f-]{36}\.db$/;
const INCOMPLETE_IMPORT_PATTERN = /^\.database-import-[0-9a-f-]{36}(?:\.validation)?(?:-wal|-shm|-journal)?$/;

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

function backupFingerprint(filename: string, stat: fs.Stats) {
  return createHash('sha256').update([
    filename, stat.size, stat.mtimeMs, stat.birthtimeMs, stat.ino,
  ].join('\0')).digest('hex');
}

function backupDescriptor(filename: string) {
  const target = safeBackupPath(filename);
  if (!fs.existsSync(target)) notFound('备份不存在');
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('备份文件类型不合法');
  return {
    name: filename,
    size: stat.size,
    createdAt: backupCreatedAt(filename, stat),
    fingerprint: backupFingerprint(filename, stat),
    imported: IMPORT_NAME_PATTERN.test(filename),
    path: target,
  };
}

function assertBackupFingerprint(backup: ReturnType<typeof backupDescriptor>, expectedFingerprint?: string) {
  if (expectedFingerprint === undefined || expectedFingerprint === backup.fingerprint) return;
  fail('备份文件已变化，请刷新列表后重新确认', 'STALE_WRITE', 409, { currentFingerprint: backup.fingerprint });
}

function assertBackupUnchanged(filename: string, fingerprint: string) {
  try {
    const current = backupDescriptor(filename);
    assertBackupFingerprint(current, fingerprint);
    return current;
  } catch (error) {
    if (error instanceof AppError && error.code === 'STALE_WRITE') throw error;
    fail('备份文件已变化，请刷新列表后重新确认', 'STALE_WRITE', 409, { currentFingerprint: null });
  }
}

export function openBackupDownload(filename: string, expectedFingerprint: string) {
  const backup = backupDescriptor(filename);
  assertBackupFingerprint(backup, expectedFingerprint);
  const fd = fs.openSync(backup.path, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || backupFingerprint(filename, stat) !== backup.fingerprint) {
      fail('备份文件已变化，请刷新列表后重新下载', 'STALE_WRITE', 409);
    }
    // 固定已打开的文件，目录清理或同名替换不会把下载改绑到另一份备份。
    return { stream: fs.createReadStream(backup.path, { fd, autoClose: true }), size: stat.size };
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

type PublicBackup = Omit<ReturnType<typeof backupDescriptor>, 'path'>;

function isTransientBackupEntryError(error: unknown) {
  if (error instanceof AppError) return error.code === 'NOT_FOUND' || error.code === 'VALIDATION_ERROR';
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

export function listBackups() {
  const backups: PublicBackup[] = [];
  for (const entry of fs.readdirSync(config.backupDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.toLowerCase().endsWith('.db')) continue;
    try {
      const { path: _path, ...backup } = backupDescriptor(entry.name);
      backups.push(backup);
    } catch (error) {
      // 目录扫描后文件可能已被清理、替换或改成非普通文件，不应拖垮其他备份的列表。
      if (!isTransientBackupEntryError(error)) throw error;
    }
  }
  return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}

let backupInProgress = false;
let restoreScheduled = false;

type RestoreAudit = {
  actorType: 'user' | 'token';
  actorId: string;
  entityId: string;
  summary: string;
};

export async function createBackup(options: {
  cleanup?: boolean;
  duringRestore?: boolean;
  beforeCommit?: (backup: PublicBackup) => void;
} = {}) {
  if (backupInProgress) fail('已有数据库备份任务正在执行', 'DEPENDENCY_CONFLICT', 409);
  if (restoreScheduled && !options.duringRestore) fail('数据库恢复任务正在执行，暂不能创建备份', 'DEPENDENCY_CONFLICT', 409);
  backupInProgress = true;
  let destination: string | undefined;
  let temporaryDestination: string | undefined;
  let published = false;
  try {
    let timestamp = new Date();
    let name = backupFilename(timestamp);
    while (fs.existsSync(safeBackupPath(name))) {
      timestamp = new Date(timestamp.getTime() + 1);
      name = backupFilename(timestamp);
    }
    destination = safeBackupPath(name);
    temporaryDestination = `${destination}.partial-${randomUUID()}`;
    await sqlite.backup(temporaryDestination);
    if (fs.existsSync(destination)) fail('备份文件名发生冲突，请重试', 'DEPENDENCY_CONFLICT', 409);
    fs.renameSync(temporaryDestination, destination);
    temporaryDestination = undefined;
    published = true;
    const { path: _path, ...backup } = backupDescriptor(name);
    options.beforeCommit?.(backup);
    if (options.cleanup !== false) {
      try { cleanupOldBackups(); } catch (error) { console.error('清理过期数据库备份失败', error); }
    }
    return backup;
  } catch (error) {
    if (temporaryDestination && fs.existsSync(temporaryDestination)) fs.rmSync(temporaryDestination, { force: true });
    if (published && destination && fs.existsSync(destination)) fs.rmSync(destination, { force: true });
    throw error;
  } finally {
    backupInProgress = false;
  }
}

export function deleteBackup(
  filename: string,
  expectedFingerprint?: string,
  beforeDelete?: (backup: PublicBackup) => void,
) {
  if (backupInProgress) fail('数据库备份任务正在执行，暂不能删除备份', 'DEPENDENCY_CONFLICT', 409);
  if (restoreScheduled) fail('数据库恢复任务正在执行，暂不能删除备份', 'DEPENDENCY_CONFLICT', 409);
  const backup = backupDescriptor(filename);
  assertBackupFingerprint(backup, expectedFingerprint);
  const remove = () => {
    const { path: _path, ...publicBackup } = backup;
    beforeDelete?.(publicBackup);
    // 审计或其他同步工作执行期间文件仍可能被外部替换，删除前再次固定同一对象。
    const current = assertBackupUnchanged(filename, backup.fingerprint);
    fs.unlinkSync(current.path);
    return { ok: true, name: filename };
  };
  return beforeDelete ? sqlite.transaction(remove)() : remove();
}

function cleanupBackupIfUnchanged(backup: PublicBackup) {
  try {
    const current = assertBackupUnchanged(backup.name, backup.fingerprint);
    fs.unlinkSync(current.path);
    return true;
  } catch (error) {
    // 文件已由外部替换或清理时，本轮不再根据旧列表决定新对象的去留。
    if (error instanceof AppError && error.code === 'STALE_WRITE') return false;
    throw error;
  }
}

export function cleanupOldBackups() {
  const cutoff = Date.now() - config.backupRetentionDays * 86400000;
  const skipped = new Set<string>();
  for (const backup of listBackups()) {
    if (new Date(backup.createdAt).getTime() < cutoff && !cleanupBackupIfUnchanged(backup)) skipped.add(backup.name);
  }
  const countCandidates = listBackups().filter((item) => !skipped.has(item.name));
  if (countCandidates.length > config.backupMaxCount) {
    // 无效文件保留在列表中供管理员诊断，但不能挤占可恢复备份的保留名额。
    for (const backup of listRestorableBackups()
      .filter((item) => item.restorable && !skipped.has(item.name))
      .slice(config.backupMaxCount)) {
      cleanupBackupIfUnchanged(backup);
    }
  }
  const incompleteCutoff = Date.now() - INCOMPLETE_BACKUP_RETENTION_MS;
  for (const entry of fs.readdirSync(config.backupDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink() || ![INCOMPLETE_BACKUP_PATTERN, INCOMPLETE_IMPORT_PATTERN].some((pattern) => pattern.test(entry.name))) continue;
    const target = path.join(config.backupDir, entry.name);
    try {
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.mtimeMs >= incompleteCutoff) continue;
      const fingerprint = backupFingerprint(entry.name, stat);
      const current = fs.lstatSync(target);
      if (current.isFile() && !current.isSymbolicLink() && backupFingerprint(entry.name, current) === fingerprint) fs.unlinkSync(target);
    } catch (error) {
      if (!isTransientBackupEntryError(error)) throw error;
    }
  }
  try {
    cleanupFailedDatabaseSwaps(config.dbPath, {
      retentionDays: config.backupRetentionDays,
      maxCount: 3,
      preserveFile: readRestoreStatus(config.dbPath)?.failedDatabase,
    });
  } catch (error) { console.error('清理数据库恢复失败文件失败', error); }
}

function validateDatabaseFile(source: string) {
  let checkDb: InstanceType<typeof Database> | undefined;
  let integrity: Array<{ integrity_check: string }>;
  try {
    checkDb = new Database(source, { readonly: true });
    integrity = checkDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
    const requiredTables = ['__drizzle_migrations', 'projects', 'requirements', 'work_items', 'people', 'audit_logs'];
    const tables = new Set((checkDb.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as Array<{ name: string }>)
      .map((table) => table.name));
    if (requiredTables.some((table) => !tables.has(table))) fail('备份文件不是有效的项目管理数据库');
    const journal = JSON.parse(fs.readFileSync(path.join(config.rootDir, 'drizzle', 'meta', '_journal.json'), 'utf8')) as {
      entries?: Array<{ when?: number }>;
    };
    const latestSupportedMigration = Math.max(0, ...(journal.entries || []).map((entry) => Number(entry.when) || 0));
    const backupMigration = Number((checkDb.prepare('SELECT MAX(created_at) AS value FROM __drizzle_migrations').get() as {
      value?: number | null;
    })?.value || 0);
    if (backupMigration > latestSupportedMigration) {
      fail('备份由更高版本系统创建，当前版本不能恢复', 'DEPENDENCY_CONFLICT', 409);
    }
    const foreignKeyViolations = checkDb.pragma('foreign_key_check') as Array<Record<string, unknown>>;
    if (foreignKeyViolations.length) fail('备份数据库存在关联数据异常', 'DEPENDENCY_CONFLICT', 409);
  } catch (error) {
    if (error instanceof AppError) throw error;
    fail('备份数据库文件无效');
  } finally {
    checkDb?.close();
  }
  if (integrity[0]?.integrity_check !== 'ok') fail('备份数据库校验失败', 'DEPENDENCY_CONFLICT', 409);
  return source;
}

const backupValidationCache = new Map<string, { restorable: boolean; validationError: string | null }>();

function validateBackupSnapshot(backup: PublicBackup, fullValidation = false) {
  const validationCopy = path.join(config.backupDir, `.backup-validation-${randomUUID()}`);
  try {
    fs.copyFileSync(safeBackupPath(backup.name), validationCopy);
    assertBackupUnchanged(backup.name, backup.fingerprint);
    validateDatabaseFile(validationCopy);
    if (fullValidation) migrateAndValidateRestoreCopy(validationCopy);
  } finally {
    removeRestoreFiles(validationCopy);
  }
}

export function listRestorableBackups() {
  const backups = listBackups();
  const activeFingerprints = new Set(backups.map((backup) => backup.fingerprint));
  for (const fingerprint of backupValidationCache.keys()) {
    if (!activeFingerprints.has(fingerprint)) backupValidationCache.delete(fingerprint);
  }
  return backups.map((backup) => {
    let validation = backupValidationCache.get(backup.fingerprint);
    if (!validation) {
      try {
        validateBackupSnapshot(backup, true);
        validation = { restorable: true, validationError: null };
      } catch (error) {
        validation = {
          restorable: false,
          validationError: error instanceof AppError ? error.message : '备份文件无法读取或校验',
        };
      }
      backupValidationCache.set(backup.fingerprint, validation);
    }
    return { ...backup, ...validation };
  });
}

function migrateAndValidateRestoreCopy(replacement: string) {
  let restoreDb: InstanceType<typeof Database> | undefined;
  try {
    restoreDb = new Database(replacement);
    // 迁移仅作用于固定下来的恢复副本；DELETE 模式保证待替换内容完整落在单个文件中。
    restoreDb.pragma('journal_mode = DELETE');
    restoreDb.pragma('foreign_keys = OFF');
    try {
      migrate(drizzle(restoreDb), { migrationsFolder: path.join(config.rootDir, 'drizzle') });
      initializeWorkspaceOrder(restoreDb);
    } finally {
      restoreDb.pragma('foreign_keys = ON');
    }
    const integrity = restoreDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (integrity[0]?.integrity_check !== 'ok') fail('备份数据库校验失败', 'DEPENDENCY_CONFLICT', 409);
    const consistency = inspectDatabaseConsistency(restoreDb);
    if (consistency.phases) fail('备份中的 Phase 归属或交付记录不一致', 'DEPENDENCY_CONFLICT', 409);
    if (consistency.foreignKeys) fail('备份数据库存在关联数据异常', 'DEPENDENCY_CONFLICT', 409);
    if (consistency.projectScope.projectDefaults || consistency.projectScope.requirementTemplates || consistency.projectScope.workItemTemplates) {
      fail('备份数据库存在跨项目流程引用，不能恢复', 'DEPENDENCY_CONFLICT', 409);
    }
    if (consistency.state.workItems || consistency.state.requirements || consistency.state.issues) {
      fail(`备份数据库状态不一致，不能恢复：工作项${consistency.state.workItems}、需求${consistency.state.requirements}、问题${consistency.state.issues}`, 'DEPENDENCY_CONFLICT', 409);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    fail('备份数据库文件无效');
  } finally {
    restoreDb?.close();
  }
}

export async function importBackup(
  stream: Readable,
  originalName: string,
  beforeCommit: (backup: PublicBackup) => void,
) {
  if (!originalName.toLowerCase().endsWith('.db') || /[\x00-\x1f/\\]/.test(originalName) || originalName.length > 255) fail('请选择项目管理系统导出的 .db 文件');
  if (backupInProgress || restoreScheduled) fail('已有数据库维护任务正在执行', 'DEPENDENCY_CONFLICT', 409);
  backupInProgress = true;
  const id = randomUUID();
  const temporary = path.join(config.backupDir, `.database-import-${id}`);
  const validationCopy = `${temporary}.validation`;
  const name = `project-manage-import-${id}.db`;
  const destination = safeBackupPath(name);
  let published = false;
  let size = 0;
  try {
    const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      callback(size > config.databaseImportMaxBytes
        ? new AppError(`数据库文件不能超过 ${config.databaseImportMaxBytes / 1024 / 1024} MB`, 413)
        : null, chunk);
    } });
    // 不把 HTTP 输入流交给 pipeline 销毁，超限时仍能返回明确的 413 响应。
    const failed = (error: Error) => limiter.destroy(error);
    stream.once('error', failed);
    stream.pipe(limiter);
    try {
      await pipeline(limiter, fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    } finally {
      stream.unpipe(limiter);
      if (stream.destroyed || stream.readableEnded) stream.off('error', failed);
      else stream.resume();
    }
    if (!size) fail('数据库文件为空');
    validateDatabaseFile(temporary);
    fs.copyFileSync(temporary, validationCopy);
    migrateAndValidateRestoreCopy(validationCopy);
    applyImportedAccounts(validationCopy);
    const check = new Database(validationCopy, { readonly: true });
    let summary: { projects: number; requirements: number; people: number };
    try {
      summary = check.prepare(`SELECT (SELECT COUNT(*) FROM projects) AS projects,
        (SELECT COUNT(*) FROM requirements) AS requirements, (SELECT COUNT(*) FROM people) AS people`).get() as typeof summary;
    } finally { check.close(); }
    if (restoreScheduled) fail('数据库恢复任务正在执行，请稍后重新上传', 'DEPENDENCY_CONFLICT', 409);
    fs.renameSync(temporary, destination);
    published = true;
    const { path: _path, ...backup } = backupDescriptor(name);
    beforeCommit(backup);
    backupValidationCache.set(backup.fingerprint, { restorable: true, validationError: null });
    // 预览阶段保留文件，取消后仍可在备份列表下载、恢复或删除。
    return { ...backup, originalName, summary, restorable: true };
  } catch (error) {
    if (published) fs.rmSync(destination, { force: true });
    throw error;
  } finally {
    for (const filename of [temporary, validationCopy]) {
      try { removeRestoreFiles(filename); }
      catch (error) { console.error('清理数据库导入临时文件失败', error); }
    }
    backupInProgress = false;
  }
}

function applyImportedAccounts(replacement: string) {
  if (!/^scrypt\$[0-9a-f]+\$[0-9a-f]{128}$/i.test(config.appPasswordHash)) {
    fail('请先配置本机 ADMIN_PASSWORD 或通过 configure.ps1 设置管理员密码');
  }
  const database = new Database(replacement);
  try {
    database.transaction(() => {
      const builtin = database.prepare('SELECT id FROM accounts WHERE is_builtin=1').all() as Array<{ id: string }>;
      if (builtin.length > 1) fail('导入数据库存在多个内置 admin 账号');
      if (!builtin.length) {
        const id = randomUUID();
        const now = new Date().toISOString();
        database.prepare(`INSERT INTO accounts (id, username, normalized_username, password_hash,
          global_role, status, must_change_password, session_version, is_builtin, created_at, updated_at)
          VALUES (?, 'admin', 'admin', ?, 'admin', 'active', 0, 0, 1, ?, ?)`).run(id, config.appPasswordHash, now, now);
        builtin.push({ id });
      }
      database.prepare(`UPDATE accounts SET username='admin', normalized_username='admin', password_hash=?,
        global_role='admin', status='active', must_change_password=0, deleted_at=NULL, person_id=NULL, updated_at=?
        WHERE id=?`).run(config.appPasswordHash, new Date().toISOString(), builtin[0].id);
      // 会话版本使用新随机值，防止较旧快照重新激活仍留在浏览器中的会话。
      const updateSession = database.prepare('UPDATE accounts SET session_version=? WHERE id=?');
      for (const account of database.prepare('SELECT id FROM accounts').all() as Array<{ id: string }>) {
        updateSession.run(
          Number.parseInt(randomUUID().replaceAll('-', '').slice(0, 12), 16), account.id);
      }
    })();
  } finally { database.close(); }
}

function removeRestoreFiles(replacement: string) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const target = `${replacement}${suffix}`;
    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
  }
}

function validateBackup(filename: string, expectedFingerprint?: string) {
  const backup = backupDescriptor(filename);
  assertBackupFingerprint(backup, expectedFingerprint);
  return backup;
}

export async function prepareRestore(filename: string, expectedFingerprint?: string, options: {
  importDatabase?: boolean;
  beforeSafetyBackup?: () => Promise<void>;
} = {}) {
  if (options.importDatabase && !IMPORT_NAME_PATTERN.test(filename)) fail('请先上传并校验要导入的数据库');
  const backup = validateBackup(filename, expectedFingerprint);
  const replacement = `${config.dbPath}.restore`;
  if (fs.existsSync(databaseSwapRollbackPath(config.dbPath))) {
    fail('上次数据库恢复的回滚文件尚未清理，暂不能再次恢复', 'DEPENDENCY_CONFLICT', 409);
  }
  removeRestoreFiles(replacement);
  try {
    // 先按已确认的指纹固定文件；结构检查、迁移和业务校验都只打开副本，避免在原备份旁生成 WAL 文件。
    fs.copyFileSync(backup.path, replacement);
    // 复制期间若同名文件被替换或改写，副本不再能证明来自用户确认的对象，直接废弃。
    assertBackupUnchanged(filename, backup.fingerprint);
    validateDatabaseFile(replacement);
    migrateAndValidateRestoreCopy(replacement);
    if (options.importDatabase) applyImportedAccounts(replacement);
    await options.beforeSafetyBackup?.();
    const safetyBackup = await createBackup({ cleanup: false, duringRestore: true });
    return { source: replacement, safetyBackup };
  } catch (error) {
    removeRestoreFiles(replacement);
    throw error;
  }
}

export function recordRestoreAudit(replacement: string, audit: RestoreAudit) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const insertSql = `INSERT INTO audit_logs
    (id, actor_type, actor_id, action, entity_type, entity_id, summary, created_at)
    VALUES (?, ?, ?, 'restore', 'backup', ?, ?, ?)`;
  const restoredDatabase = new Database(replacement);
  let restoredWritten = false;
  try {
    sqlite.transaction(() => {
      sqlite.prepare(insertSql).run(id, audit.actorType, audit.actorId, audit.entityId, audit.summary, createdAt);
      restoredDatabase.prepare(insertSql).run(id, audit.actorType, audit.actorId, audit.entityId, audit.summary, createdAt);
      restoredWritten = true;
    })();
  } catch (error) {
    if (restoredWritten) restoredDatabase.prepare('DELETE FROM audit_logs WHERE id=?').run(id);
    throw error;
  } finally {
    restoredDatabase.close();
  }
  return { id, createdAt };
}

export async function scheduleRestore(
  filename: string,
  expectedFingerprint?: string,
  beforeSchedule?: (safetyBackup: PublicBackup, replacement: string) => void,
  options: { importDatabase?: boolean } = {},
) {
  options = { ...options, importDatabase: options.importDatabase || IMPORT_NAME_PATTERN.test(filename) };
  if (restoreScheduled) fail('已有数据库恢复任务正在执行', 'DEPENDENCY_CONFLICT', 409);
  restoreScheduled = true;
  const replacement = `${config.dbPath}.restore`;
  const operationId = randomUUID();
  const previousStatus = readRestoreStatus(config.dbPath);
  let statusWritten = false;
  let pendingStatus: RestoreStatus | undefined;
  let safetyBackup: Awaited<ReturnType<typeof createBackup>> | undefined;
  try {
    const prepared = await prepareRestore(filename, expectedFingerprint, { ...options, beforeSafetyBackup: pauseDatabaseRequests });
    safetyBackup = prepared.safetyBackup;
    pendingStatus = {
      operationId,
      outcome: 'pending',
      backupName: filename,
      safetyBackupName: safetyBackup.name,
      updatedAt: new Date().toISOString(),
      message: '数据库恢复已安排，正在等待服务重启',
      failedDatabase: null,
    };
    writeRestoreStatus(config.dbPath, pendingStatus);
    statusWritten = true;
    beforeSchedule?.(safetyBackup, replacement);
  } catch (error) {
    removeRestoreFiles(replacement);
    if (safetyBackup) {
      const safetyPath = safeBackupPath(safetyBackup.name);
      if (fs.existsSync(safetyPath)) fs.rmSync(safetyPath, { force: true });
    }
    if (statusWritten) {
      try {
        if (previousStatus) writeRestoreStatus(config.dbPath, previousStatus);
        else clearRestoreStatus(config.dbPath);
      } catch (statusError) { console.error('数据库恢复状态回滚失败', statusError); }
    }
    restoreScheduled = false;
    resumeDatabaseRequests();
    throw error;
  }

  setTimeout(() => {
    let databaseClosed = false;
    try {
      sqlite.pragma('wal_checkpoint(TRUNCATE)');
      sqlite.close();
      databaseClosed = true;
      activatePreparedDatabase(config.dbPath, replacement);
      try {
        writeRestoreStatus(config.dbPath, {
          ...pendingStatus!,
          outcome: 'succeeded',
          updatedAt: new Date().toISOString(),
          message: '数据库恢复已完成',
        });
      } catch (error) { console.error('数据库恢复成功状态记录失败', error); }
      try { cleanupOldBackups(); } catch (error) { console.error('数据库恢复后清理旧备份失败', error); }
      process.exit(75);
    } catch (error) {
      console.error('数据库恢复切换失败', error);
      try {
        writeRestoreStatus(config.dbPath, {
          ...pendingStatus!,
          outcome: 'rolled_back',
          updatedAt: new Date().toISOString(),
          message: databaseClosed ? '数据库恢复切换失败，系统已保留或恢复原数据库' : '数据库恢复未生效，当前数据库保持不变',
        });
      } catch (statusError) { console.error('数据库恢复失败状态记录失败', statusError); }
      if (!databaseClosed && sqlite.open) {
        restoreScheduled = false;
        resumeDatabaseRequests();
        removeRestoreFiles(replacement);
        return;
      }
      if (fs.existsSync(config.dbPath) || fs.existsSync(databaseSwapRollbackPath(config.dbPath))) process.exit(75);
      process.exit(1);
    }
  }, 800);
  return {
    ok: true,
    message: '目标备份已通过校验，当前数据库已安全备份，服务即将自动重启。',
    safetyBackupName: safetyBackup!.name,
    operationId,
  };
}

let lastScheduledBackup = '';

function hasBackupSinceDailySchedule(now: Date) {
  const scheduledAt = new Date(now);
  scheduledAt.setHours(2, 0, 0, 0);
  const start = scheduledAt.getTime();
  const end = now.getTime();
  return listBackups().some((backup) => {
    const createdAt = new Date(backup.createdAt).getTime();
    if (!Number.isFinite(createdAt) || createdAt < start || createdAt > end) return false;
    try {
      validateBackupSnapshot(backup);
      return true;
    } catch {
      return false;
    }
  });
}

export function startBackupScheduler() {
  try { cleanupOldBackups(); }
  catch (error) { console.error('启动时清理过期数据库备份失败', error); }
  const check = async () => {
    const now = new Date();
    const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    if (now.getHours() >= 2 && lastScheduledBackup !== day) {
      // 在线备份会先创建目标文件再持续写入；完成前不能据此认定当天备份已经成功。
      if (backupInProgress) return;
      try {
        if (hasBackupSinceDailySchedule(now)) {
          lastScheduledBackup = day;
          return;
        }
        await createBackup();
        lastScheduledBackup = day;
      } catch (error) { console.error('自动备份失败', error); }
    }
  };
  void check();
  return setInterval(() => void check(), 15 * 60 * 1000);
}
