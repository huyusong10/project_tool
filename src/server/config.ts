import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const rootDir = process.cwd();

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readAppVersion() {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof packageJson.version === 'string' ? packageJson.version : '1.0.0';
  } catch {
    return '1.0.0';
  }
}

export const config = {
  rootDir,
  webDistDir: path.resolve(rootDir, process.env.WEB_DIST_DIR || './dist'),
  appVersion: process.env.APP_VERSION || readAppVersion(),
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 3210),
  dbPath: path.resolve(rootDir, process.env.DB_PATH || './data/project-manage.db'),
  backupDir: path.resolve(rootDir, process.env.BACKUP_DIR || './data/backups'),
  appPasswordHash: process.env.APP_PASSWORD_HASH || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  sessionCookieName: process.env.SESSION_COOKIE_NAME || 'pm_session',
  sessionHours: Number(process.env.SESSION_HOURS || 12),
  highRiskDelayDays: positiveInteger(process.env.HIGH_RISK_DELAY_DAYS, 3),
  backupRetentionDays: positiveInteger(process.env.BACKUP_RETENTION_DAYS, 30),
  backupMaxCount: Math.max(1, Math.floor(Number(process.env.BACKUP_MAX_COUNT || 100) || 100)),
  seedDemo: process.env.SEED_DEMO !== '0',
  nodeEnv: process.env.NODE_ENV || 'development',
};

export function assertRuntimeConfig() {
  if (!config.appPasswordHash) throw new Error('缺少 APP_PASSWORD_HASH，请先运行 configure.ps1。');
  if (config.sessionSecret.length < 32) throw new Error('SESSION_SECRET 至少需要32个字符，请先运行 configure.ps1。');
  if (!/^[A-Za-z0-9_-]+$/.test(config.sessionCookieName)) throw new Error('SESSION_COOKIE_NAME 只能包含字母、数字、下划线和连字符。');
}
