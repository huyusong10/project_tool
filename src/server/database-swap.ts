import fs from 'node:fs';
import path from 'node:path';

export function databaseSwapRollbackPath(databasePath: string) {
  return `${databasePath}.pre-restore`;
}

/** 启动早期调用：只有目标库缺失时才把中断切换留下的原库放回。 */
export function recoverInterruptedDatabaseSwap(databasePath: string) {
  const rollback = databaseSwapRollbackPath(databasePath);
  if (!fs.existsSync(databasePath) && fs.existsSync(rollback)) fs.renameSync(rollback, databasePath);
}

/** 新库完成启动校验后，旧库回滚文件才可以删除。 */
export function clearDatabaseSwapRollback(databasePath: string) {
  const rollback = databaseSwapRollbackPath(databasePath);
  if (fs.existsSync(databasePath) && fs.existsSync(rollback)) fs.rmSync(rollback, { force: true });
}

function failedRestorePath(databasePath: string, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  let target = `${databasePath}.failed-restore-${stamp}`;
  let suffix = 1;
  while (fs.existsSync(target)) target = `${databasePath}.failed-restore-${stamp}-${suffix++}`;
  return target;
}

/** Node 已退出后调用：归档启动失败的新库并恢复原库。没有恢复标记时不做任何操作。 */
export function rollbackFailedDatabaseSwap(databasePath: string) {
  const rollback = databaseSwapRollbackPath(databasePath);
  if (!fs.existsSync(rollback)) return null;
  const failed = failedRestorePath(databasePath);
  const movedSuffixes: string[] = [];
  let movedDatabase = false;
  try {
    if (fs.existsSync(databasePath)) {
      fs.renameSync(databasePath, failed);
      movedDatabase = true;
      for (const suffix of ['-wal', '-shm', '-journal']) {
        if (!fs.existsSync(`${databasePath}${suffix}`)) continue;
        fs.renameSync(`${databasePath}${suffix}`, `${failed}${suffix}`);
        movedSuffixes.push(suffix);
      }
    }
    fs.renameSync(rollback, databasePath);
  } catch (error) {
    if (movedDatabase && !fs.existsSync(databasePath) && fs.existsSync(failed)) fs.renameSync(failed, databasePath);
    for (const suffix of movedSuffixes) {
      if (!fs.existsSync(`${databasePath}${suffix}`) && fs.existsSync(`${failed}${suffix}`)) {
        fs.renameSync(`${failed}${suffix}`, `${databasePath}${suffix}`);
      }
    }
    throw error;
  }
  return { failedDatabase: movedDatabase ? failed : null };
}

export function cleanupFailedDatabaseSwaps(databasePath: string, options: {
  retentionDays: number;
  maxCount?: number;
  preserveFile?: string | null;
  now?: Date;
}) {
  const directory = fs.realpathSync.native(path.dirname(databasePath));
  const prefix = `${path.basename(databasePath)}.failed-restore-`;
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.startsWith(prefix));
  const sidecarPattern = /-(?:wal|shm|journal)$/;
  const mainFiles = files.filter((entry) => !sidecarPattern.test(entry.name)).map((entry) => {
    const target = path.join(directory, entry.name);
    return { name: entry.name, target, modifiedAt: fs.statSync(target).mtimeMs };
  }).sort((left, right) => right.modifiedAt - left.modifiedAt || right.name.localeCompare(left.name));
  const maxCount = Math.max(1, Math.floor(options.maxCount ?? 3));
  const cutoff = (options.now ?? new Date()).getTime() - Math.max(1, options.retentionDays) * 86_400_000;
  const retained = new Set(mainFiles.slice(0, maxCount).map((file) => file.name));
  const removed: string[] = [];
  for (const file of mainFiles) {
    if (file.name === options.preserveFile || file.modifiedAt >= cutoff && retained.has(file.name)) continue;
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const target = `${file.target}${suffix}`;
      if (fs.existsSync(target)) fs.rmSync(target, { force: true });
    }
    removed.push(file.name);
  }
  const remainingMainFiles = new Set(mainFiles.filter((file) => !removed.includes(file.name)).map((file) => file.name));
  for (const entry of files.filter((file) => sidecarPattern.test(file.name))) {
    const parent = entry.name.replace(sidecarPattern, '');
    if (!remainingMainFiles.has(parent)) fs.rmSync(path.join(directory, entry.name), { force: true });
  }
  return removed;
}

/**
 * 在同一目录内切换数据库。安装新库失败时立即放回原库；若进程在中间退出，启动恢复函数继续完成回滚。
 */
export function activatePreparedDatabase(databasePath: string, replacement: string) {
  const rollback = databaseSwapRollbackPath(databasePath);
  if (fs.existsSync(rollback)) throw new Error('上次数据库恢复的回滚文件尚未清理');
  fs.renameSync(databasePath, rollback);
  try {
    // 原连接已经完成 WAL checkpoint；旧旁文件不能跟随新数据库启动。
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const target = `${databasePath}${suffix}`;
      if (fs.existsSync(target)) fs.rmSync(target, { force: true });
    }
    fs.renameSync(replacement, databasePath);
  } catch (error) {
    if (!fs.existsSync(databasePath) && fs.existsSync(rollback)) fs.renameSync(rollback, databasePath);
    throw error;
  }
}
