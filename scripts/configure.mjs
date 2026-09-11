import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';

const root = path.resolve(import.meta.dirname, '..');
const password = process.env.PROJECT_MANAGE_NEW_PASSWORD || '';
if (password.length < 10) {
  console.error('密码至少需要10个字符。');
  process.exit(1);
}
const salt = randomBytes(16).toString('hex');
const passwordHash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
const sessionSecret = randomBytes(48).toString('base64url');
const envPath = path.join(root, '.env');
const previous = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {};
function encode(value) {
  const candidates = [value, ...["'", '"', '`'].map((quote) => `${quote}${value}${quote}`)];
  return candidates.find((candidate) => dotenv.parse(`VALUE=${candidate}`).VALUE === value);
}
const settings = {
  HOST: '0.0.0.0', PORT: '3210', DB_PATH: './data/project-manage.db', BACKUP_DIR: './data/backups',
  SESSION_HOURS: '12', HIGH_RISK_DELAY_DAYS: '3', BACKUP_RETENTION_DAYS: '30', BACKUP_MAX_COUNT: '100',
  DATABASE_IMPORT_MAX_MB: '512', SEED_DEMO: '0', ...previous,
  ADMIN_PASSWORD: encode(password) === undefined ? '' : password,
  APP_PASSWORD_HASH: passwordHash, SESSION_SECRET: sessionSecret,
};
const content = Object.entries(settings).map(([key, value]) => {
  const encoded = encode(value);
  if (encoded === undefined) throw new Error(`配置项 ${key} 无法保存，请检查引号和换行。`);
  return `${key}=${encoded}`;
}).join('\n') + '\n';
fs.writeFileSync(envPath, content, { encoding: 'utf8', mode: 0o600 });
const databasePath = path.resolve(root, settings.DB_PATH);
if (fs.existsSync(databasePath)) {
  const db = new Database(databasePath);
  const hasAccounts = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts'").get();
  if (hasAccounts) db.prepare(`UPDATE accounts SET password_hash=?, must_change_password=0,
    session_version=session_version+1, status='active', updated_at=? WHERE is_builtin=1`).run(passwordHash, new Date().toISOString());
  db.close();
}
console.log('admin账号配置已更新。');
console.log(settings.ADMIN_PASSWORD ? '管理员密码已保存到本机 .env 的 ADMIN_PASSWORD；导入数据库后使用该密码。' : '此密码使用 APP_PASSWORD_HASH 保存；导入数据库后使用本次设置的密码。');
