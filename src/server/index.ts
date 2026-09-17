import process from 'node:process';
import { assertRuntimeConfig, config } from './config';
import { clearDatabaseSwapRollback, rollbackFailedDatabaseSwap } from './database-swap';
import { readRestoreStatus, writeRestoreStatus } from './restore-status';
import { isServerAlreadyRunning } from './startup';
import { getRuntimeLogger, moduleLogger, exitWithLogs } from '../../scripts/runtime-logger.mjs';

const runtime = getRuntimeLogger();
const log = moduleLogger('server');
let exiting = false;
async function fatal(error: unknown) {
  if (exiting) return;
  exiting = true;
  log.fatal({ event: 'server.failed', err: error }, '服务无法继续运行');
  await exitWithLogs(1);
}
process.on('uncaughtException', error => { void fatal(error); });
process.on('unhandledRejection', error => { void fatal(error); });

async function main() {
  if (process.argv.includes('--recover-database-swap')) {
    const pending = readRestoreStatus(config.dbPath);
    const recovered = rollbackFailedDatabaseSwap(config.dbPath);
    if (!recovered) return exitWithLogs(2);
    try {
      writeRestoreStatus(config.dbPath, {
        operationId: pending?.operationId || 'unknown-restore',
        outcome: 'rolled_back',
        backupName: pending?.backupName || '未知备份',
        safetyBackupName: pending?.safetyBackupName || '未知备份',
        updatedAt: new Date().toISOString(),
        message: '恢复数据库启动失败，系统已自动切回原数据库',
        failedDatabase: recovered.failedDatabase,
      });
    } catch (error) { log.error({ event: 'restore.status_failed', err: error }, '数据库自动回滚状态记录失败'); }
    log.warn({ event: 'restore.rolled_back', operationId: pending?.operationId }, `恢复库启动失败，已自动切回原数据库${recovered.failedDatabase ? `；失败库保留于 ${recovered.failedDatabase}` : ''}`);
    return exitWithLogs(0);
  }

  assertRuntimeConfig();

  try {
    if (await isServerAlreadyRunning(config)) {
      log.info({ event: 'server.already_running' }, `项目管理系统已在运行：http://localhost:${config.port}，无需重复启动。`);
      return exitWithLogs(0);
    }
  } catch (error) {
    log.fatal({ event: 'server.start_refused', exitCode: 64 }, error instanceof Error ? error.message : '无法确认服务端口是否可用');
    return exitWithLogs(64); // Refused before opening the database; do not recover a database swap.
  }

  const { buildApp } = await import('./app');
  const { startBackupScheduler } = await import('./backups');
  const app = await buildApp(runtime);
  const scheduler = startBackupScheduler();

  await app.listen({ host: config.host, port: config.port });
  try {
    clearDatabaseSwapRollback(config.dbPath);
  } catch (error) {
    await app.close();
    throw error;
  }
  log.info({ event: 'server.started', url: `http://localhost:${config.port}`, version: config.appVersion,
    logDir: runtime.settings.fileEnabled ? runtime.settings.directory : 'disabled', logLevel: runtime.settings.level }, '项目管理系统已启动');

  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
    if (exiting) return;
    exiting = true;
    clearInterval(scheduler);
    void (async () => {
      const timer = setTimeout(() => app.server.closeAllConnections(), 5000);
      try { await app.close(); log.info({ event: 'server.stopped', signal }, '服务已停止'); }
      catch (error) { log.error({ event: 'server.stop_failed', err: error }, '服务关闭失败'); }
      finally { clearTimeout(timer); await exitWithLogs(0); }
    })();
  });
}

try { await main(); } catch (error) { await fatal(error); }
