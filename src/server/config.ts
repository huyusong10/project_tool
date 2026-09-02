import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const rootDir = process.cwd();

export const config = {
  rootDir,
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 3210),
  dbPath: path.resolve(rootDir, process.env.DB_PATH || './data/project-manage.db'),
  backupDir: path.resolve(rootDir, process.env.BACKUP_DIR || './data/backups'),
  appUsername: process.env.APP_USERNAME || 'admin',
  appPasswordHash: process.env.APP_PASSWORD_HASH || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  sessionHours: Number(process.env.SESSION_HOURS || 12),
  highRiskDelayDays: Number(process.env.HIGH_RISK_DELAY_DAYS || 3),
  backupRetentionDays: Number(process.env.BACKUP_RETENTION_DAYS || 30),
  seedDemo: process.env.SEED_DEMO === '1',
  nodeEnv: process.env.NODE_ENV || 'development',
};

export function assertRuntimeConfig() {
  if (!config.appPasswordHash) throw new Error('缺少 APP_PASSWORD_HASH，请先运行 configure.ps1。');
  if (config.sessionSecret.length < 32) throw new Error('SESSION_SECRET 至少需要32个字符，请先运行 configure.ps1。');
}
