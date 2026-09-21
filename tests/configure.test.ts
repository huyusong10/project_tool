import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scryptSync } from 'node:crypto';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import { expect, it } from 'vitest';

it.each(process.platform === 'win32' ? ['node', 'powershell'] : ['node'])('配置脚本保存可读取的 admin 密码，保留部署参数并更新指定数据库（%s）', runner => {
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
    fs.copyFileSync(path.join(process.cwd(), 'configure.ps1'), path.join(directory, 'configure.ps1'));
    const harness = path.join(directory, 'exercise.ps1');
    fs.writeFileSync(harness, `\uFEFF$ErrorActionPreference = 'Stop'
function Read-Host {
  param([Parameter(Position=0)][string]$Prompt, [switch]$AsSecureString)
  $secure = [System.Security.SecureString]::new()
  foreach ($character in $env:PROJECT_MANAGE_TEST_PASSWORD.ToCharArray()) { $secure.AppendChar($character) }
  return $secure
}
& (Join-Path $PSScriptRoot 'configure.ps1')
if (Test-Path Env:PROJECT_MANAGE_NEW_PASSWORD) { throw 'Temporary password was not cleared' }
`);
    const shell = runner === 'powershell';
    const result = spawnSync(shell ? 'powershell.exe' : process.execPath, shell ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', harness] : [path.join(directory, 'scripts', 'configure.mjs')], {
      windowsHide: true, encoding: 'utf8', env: { ...process.env, PROJECT_MANAGE_NEW_PASSWORD: shell ? undefined : password, PROJECT_MANAGE_TEST_PASSWORD: password },
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

it.skipIf(process.platform !== 'win32')('双击首次启动先安装依赖再配置，已有配置和构建不重复执行', () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), 'data', 'startup-batch-test-'));
  try {
    fs.copyFileSync(path.join(process.cwd(), 'start.bat'), path.join(directory, 'start.bat'));
    fs.writeFileSync(path.join(directory, 'configure.ps1'), `if (-not (Test-Path node_modules)) { exit 23 }
Add-Content sequence.log 'configure'
New-Item -ItemType File .env | Out-Null
`);
    fs.writeFileSync(path.join(directory, 'run-server.ps1'), `if (-not (Test-Path .env) -or -not (Test-Path dist-server/index.js)) { exit 24 }
Add-Content sequence.log 'serve'
`);
    fs.writeFileSync(path.join(directory, 'npm.cmd'), `@echo off
if "%1"=="install" (
  echo install>>sequence.log
  mkdir node_modules
  exit /b 0
)
if "%1"=="run" if "%2"=="build" (
  echo build>>sequence.log
  mkdir dist-server
  echo fixture>dist-server\\index.js
  exit /b 0
)
exit /b 25
`.replaceAll('\n', '\r\n'));
    const run = () => spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', '.\\start.bat'], {cwd: directory, windowsHide: true, encoding: 'utf8'});
    const fresh = run();
    expect(fresh.status, fresh.stderr + fresh.stdout).toBe(0);
    expect(fs.readFileSync(path.join(directory, 'sequence.log'), 'utf8').trim().split(/\r?\n/)).toEqual(['install', 'configure', 'build', 'serve']);
    const existing = run();
    expect(existing.status, existing.stderr + existing.stdout).toBe(0);
    expect(fs.readFileSync(path.join(directory, 'sequence.log'), 'utf8').trim().split(/\r?\n/)).toEqual(['install', 'configure', 'build', 'serve', 'serve']);
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});
