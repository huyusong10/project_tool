import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import Database from 'better-sqlite3';

const root = path.resolve(import.meta.dirname, '..');
const password = process.env.PROJECT_MANAGE_NEW_PASSWORD || '';
if (password.length < 10) {
  console.error('密码至少需要10个字符。');
  process.exit(1);
}
const salt = randomBytes(16).toString('hex');
const passwordHash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
const sessionSecret = randomBytes(48).toString('base64url');
const content = [
  'HOST=0.0.0.0',
  'PORT=3210',
  'DB_PATH=./data/project-manage.db',
  'BACKUP_DIR=./data/backups',
  `APP_PASSWORD_HASH=${passwordHash}`,
  `SESSION_SECRET=${sessionSecret}`,
  'SESSION_HOURS=12',
  'HIGH_RISK_DELAY_DAYS=3',
  'BACKUP_RETENTION_DAYS=30',
  'SEED_DEMO=0',
  '',
].join('\n');
fs.writeFileSync(path.join(root, '.env'), content, { encoding: 'utf8', mode: 0o600 });
const databasePath = path.join(root, 'data', 'project-manage.db');
if (fs.existsSync(databasePath)) {
  const db = new Database(databasePath);
  const hasAccounts = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts'").get();
  if (hasAccounts) db.prepare(`UPDATE accounts SET password_hash=?, must_change_password=0,
    session_version=session_version+1, status='active', updated_at=? WHERE is_builtin=1`).run(passwordHash, new Date().toISOString());
  db.close();
}
console.log('admin账号配置已更新。');
