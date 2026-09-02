import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const username = process.argv[2]?.trim() || 'user';
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
  `APP_USERNAME=${username.replace(/[\r\n=]/g, '')}`,
  `APP_PASSWORD_HASH=${passwordHash}`,
  `SESSION_SECRET=${sessionSecret}`,
  'SESSION_HOURS=12',
  'HIGH_RISK_DELAY_DAYS=3',
  'BACKUP_RETENTION_DAYS=30',
  'SEED_DEMO=0',
  '',
].join('\n');
fs.writeFileSync(path.join(root, '.env'), content, { encoding: 'utf8', mode: 0o600 });
console.log('本地用户配置已更新。');
