import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scryptSync } from 'node:crypto';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import { expect, it } from 'vitest';

it('配置脚本保存可读取的 admin 密码，保留部署参数并更新指定数据库', () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), 'data', 'configure-test-'));
  try {
    fs.mkdirSync(path.join(directory, 'scripts'));
    fs.copyFileSync(path.join(process.cwd(), 'scripts', 'configure.mjs'), path.join(directory, 'scripts', 'configure.mjs'));
    fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}');
    fs.writeFileSync(path.join(directory, '.env'), 'PORT=3987\nDB_PATH=custom.db\nBACKUP_DIR=custom-backups\nSESSION_COOKIE_NAME=custom-cookie\n');
    const database = new Database(path.join(directory, 'custom.db'));
    database.exec(`CREATE TABLE accounts (password_hash TEXT, must_change_password INTEGER, session_version INTEGER,
      status TEXT, updated_at TEXT, is_builtin INTEGER);
      INSERT INTO accounts VALUES ('old', 1, 4, 'disabled', '', 1);`);
    database.close();
    const password = '记得 # "$abc\\path-2026!';
    const result = spawnSync(process.execPath, [path.join(directory, 'scripts', 'configure.mjs')], {
      windowsHide: true, encoding: 'utf8', env: { ...process.env, PROJECT_MANAGE_NEW_PASSWORD: password },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain(password);
    const settings = dotenv.parse(fs.readFileSync(path.join(directory, '.env')));
    expect(settings).toMatchObject({ ADMIN_PASSWORD: password, PORT: '3987', DB_PATH: 'custom.db', BACKUP_DIR: 'custom-backups', SESSION_COOKIE_NAME: 'custom-cookie' });
    const [, salt, hash] = settings.APP_PASSWORD_HASH.split('$');
    expect(scryptSync(password, salt, 64).toString('hex')).toBe(hash);
    const updated = new Database(path.join(directory, 'custom.db'));
    try {
      expect(updated.prepare('SELECT password_hash, session_version, status, must_change_password FROM accounts').get())
        .toEqual({ password_hash: settings.APP_PASSWORD_HASH, session_version: 5, status: 'active', must_change_password: 0 });
    } finally { updated.close(); }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
