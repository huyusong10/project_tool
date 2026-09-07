import process from 'node:process';
import { assertRuntimeConfig, config } from './config';
import { clearDatabaseSwapRollback, rollbackFailedDatabaseSwap } from './database-swap';
import { readRestoreStatus, writeRestoreStatus } from './restore-status';

if (process.argv.includes('--recover-database-swap')) {
  const pending = readRestoreStatus(config.dbPath);
  const recovered = rollbackFailedDatabaseSwap(config.dbPath);
  if (!recovered) process.exit(2);
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
  } catch (error) { console.error('数据库自动回滚状态记录失败', error); }
  console.warn(`恢复库启动失败，已自动切回原数据库${recovered.failedDatabase ? `；失败库保留于 ${recovered.failedDatabase}` : ''}`);
  process.exit(0);
}

assertRuntimeConfig();

const { buildApp } = await import('./app');
const { startBackupScheduler } = await import('./backups');
const app = await buildApp();
startBackupScheduler();

await app.listen({ host: config.host, port: config.port });
try {
  clearDatabaseSwapRollback(config.dbPath);
} catch (error) {
  await app.close();
  throw error;
}
console.log(`项目管理系统已启动：http://localhost:${config.port}`);
