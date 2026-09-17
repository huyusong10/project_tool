import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import http from 'node:http';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-transfer-'));
process.env.DB_PATH = path.join(directory, 'target.db');
process.env.BACKUP_DIR = path.join(directory, 'backups');
process.env.ADMIN_PASSWORD = 'Target-admin-2026!';
process.env.SESSION_SECRET = 'transfer-test-session-secret-with-more-than-32-characters';
process.env.DATABASE_IMPORT_MAX_MB = '2';
process.env.SEED_DEMO = '0';
process.env.NODE_ENV = 'test';

let app: FastifyInstance;
let cookie: string;
let exported: { name: string; fingerprint: string };
let uploaded: { name: string; fingerprint: string };
let source: Buffer;
let releaseRequest: (() => void) | undefined;
let enteredRequest: (() => void) | undefined;

beforeAll(async () => {
  app = await (await import('../src/server/app')).buildApp();
  app.get('/api/test/slow', async () => {
    enteredRequest?.();
    await new Promise<void>((resolve) => { releaseRequest = resolve; });
    return { ok: true };
  });
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: 'Target-admin-2026!' } });
  expect(login.statusCode).toBe(200);
  cookie = String(login.headers['set-cookie']).split(';')[0];
  await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie }, payload: { name: '迁移项目' } });
  await app.inject({ method: 'POST', url: '/api/people', headers: { cookie }, payload: { name: '迁移用户' } });
});

afterAll(async () => {
  releaseRequest?.();
  await app.close();
  const { sqlite } = await import('./support/database');
  sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

it('管理员导出独立 SQLite 快照；下载要求登录、权限和最新指纹', async () => {
  const created = await app.inject({ method: 'POST', url: '/api/backups', headers: { cookie } });
  expect(created.statusCode).toBe(200);
  exported = created.json();
  const url = `/api/backups/${exported.name}/download?expectedFingerprint=${exported.fingerprint}`;
  expect((await app.inject({ url })).statusCode).toBe(401);
  const memberLogin = await app.inject({ method: 'POST', url: '/api/login', payload: { username: '迁移用户', password: '888888' } });
  const memberCookie = String(memberLogin.headers['set-cookie']).split(';')[0];
  expect((await app.inject({ url, headers: { cookie: memberCookie } })).statusCode).toBe(403);
  expect((await app.inject({ url: `/api/backups/${exported.name}/download?expectedFingerprint=${'0'.repeat(64)}`, headers: { cookie } })).statusCode).toBe(409);
  const downloaded = await app.inject({ url, headers: { cookie } });
  expect(downloaded.statusCode).toBe(200);
  expect(downloaded.headers['content-type']).toContain('application/vnd.sqlite3');
  expect(downloaded.headers['content-disposition']).toContain('attachment;');
  expect(downloaded.headers['cache-control']).toBe('no-store');
  expect(downloaded.rawPayload.subarray(0, 16).toString()).toBe('SQLite format 3\0');
  expect(downloaded.rawPayload).toEqual(fs.readFileSync(path.join(directory, 'backups', exported.name)));
  const sourcePath = path.join(directory, 'source.db');
  fs.writeFileSync(sourcePath, downloaded.rawPayload);
  const db = new Database(sourcePath);
  const { hashPassword } = await import('../src/server/auth');
  db.prepare('UPDATE accounts SET password_hash=? WHERE is_builtin=1').run(hashPassword('Source-admin-2026!'));
  db.close();
  source = fs.readFileSync(sourcePath);
});

it('上传只保存文件和预览；导入副本改用本机 admin 密码并注销会话，普通账号保持原密码', async () => {
  const result = await app.inject({ method: 'POST', url: '/api/backups/import?filename=source.db', headers: { cookie, 'content-type': 'application/octet-stream' }, payload: source });
  expect(result.statusCode, result.body).toBe(200);
  uploaded = result.json();
  expect(result.json()).toMatchObject({ imported: true, originalName: 'source.db', restorable: true, summary: { projects: 1, people: 1 } });
  const { sqlite } = await import('./support/database');
  const { prepareRestore } = await import('../src/server/backups');
  const { verifyPassword } = await import('../src/server/auth');
  const oldAccounts = sqlite.prepare('SELECT id, password_hash, session_version, is_builtin FROM accounts ORDER BY id').all() as Array<{ id: string; password_hash: string; session_version: number; is_builtin: number }>;
  expect(fs.existsSync(`${process.env.DB_PATH}.restore`)).toBe(false);
  const prepared = await prepareRestore(uploaded.name, uploaded.fingerprint, { importDatabase: true });
  const restored = new Database(prepared.source);
  try {
    const accounts = restored.prepare('SELECT id, password_hash, session_version, is_builtin FROM accounts ORDER BY id').all() as typeof oldAccounts;
    for (const account of accounts) {
      const previous = oldAccounts.find((item) => item.id === account.id)!;
      expect(account.session_version).not.toBe(previous.session_version);
      expect(verifyPassword(account.is_builtin ? 'Target-admin-2026!' : '888888', account.password_hash)).toBe(true);
    }
    expect(restored.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally { restored.close(); }
  expect(sqlite.prepare('SELECT id, password_hash, session_version, is_builtin FROM accounts ORDER BY id').all()).toEqual(oldAccounts);
  expect(fs.existsSync(path.join(directory, 'backups', prepared.safetyBackup.name))).toBe(true);
  // 原上传文件继续保留源密码，只有最终用于替换的副本应用本机配置。
  const original = new Database(path.join(directory, 'backups', uploaded.name));
  try { expect(verifyPassword('Source-admin-2026!', (original.prepare('SELECT password_hash AS hash FROM accounts WHERE is_builtin=1').get() as { hash: string }).hash)).toBe(true); }
  finally { original.close(); }
});

it('拒绝无权限、空文件、损坏文件、路径文件名、非数据库请求及超过上限的上传', async () => {
  const files = fs.readdirSync(path.join(directory, 'backups')).sort();
  const upload = (payload: Buffer, filename = 'source.db', headers: Record<string, string> = { cookie }) => app.inject({ method: 'POST', url: `/api/backups/import?filename=${encodeURIComponent(filename)}`, headers: { ...headers, 'content-type': 'application/octet-stream' }, payload });
  expect((await upload(source, 'source.db', {})).statusCode).toBe(401);
  expect((await upload(Buffer.alloc(0))).statusCode).toBe(400);
  expect((await upload(Buffer.from('broken'))).statusCode).toBe(400);
  expect((await upload(source, '../source.db')).statusCode).toBe(400);
  expect((await upload(Buffer.alloc(2 * 1024 * 1024 + 1))).statusCode).toBe(413);
  expect((await app.inject({ method: 'POST', url: '/api/backups/import?filename=source.db', headers: { cookie }, payload: {} })).statusCode).toBe(400);
  expect(fs.readdirSync(path.join(directory, 'backups')).sort()).toEqual(files);
});

it('更高版本和关联损坏的文件不能导入，校验失败不留下临时文件', async () => {
  const filename = path.join(directory, 'invalid.db');
  for (const sql of ['UPDATE __drizzle_migrations SET created_at=9999999999999', 'PRAGMA foreign_keys=OFF; UPDATE accounts SET person_id=\'missing\' WHERE is_builtin=0']) {
    fs.writeFileSync(filename, source);
    const db = new Database(filename);
    db.exec(sql); db.close();
    const result = await app.inject({ method: 'POST', url: '/api/backups/import?filename=invalid.db', headers: { cookie, 'content-type': 'application/octet-stream' }, payload: fs.readFileSync(filename) });
    expect(result.statusCode, result.body).toBe(409);
  }
  expect(fs.readdirSync(path.join(directory, 'backups')).some((name) => name.startsWith('.database-import-'))).toBe(false);
});

it('传输中断和未知长度超限会清理文件并释放上传锁', async () => {
  const { importBackup } = await import('../src/server/backups');
  const interrupted = Readable.from((async function* () { yield source.subarray(0, 100); throw new Error('传输中断'); })());
  await expect(importBackup(interrupted, 'source.db', () => undefined)).rejects.toThrow('传输中断');
  await expect(importBackup(Readable.from([Buffer.alloc(2 * 1024 * 1024 + 1)]), 'source.db', () => undefined)).rejects.toMatchObject({ statusCode: 413 });
  expect(fs.readdirSync(path.join(directory, 'backups')).some((name) => name.startsWith('.database-import-'))).toBe(false);
  await expect(importBackup(Readable.from([source]), 'source.db', () => { throw new Error('管理员已失权'); })).rejects.toThrow('管理员已失权');
});

it('替换前等待既有请求结束，期间阻止 REST/MCP，失败后恢复访问', async () => {
  const { scheduleRestore } = await import('../src/server/backups');
  const entered = new Promise<void>((resolve) => { enteredRequest = resolve; });
  const slow = app.inject({ url: '/api/test/slow' });
  await entered;
  const restoring = scheduleRestore(uploaded.name, uploaded.fingerprint, () => { throw new Error('测试取消切换'); }, { importDatabase: true });
  const failure = expect(restoring).rejects.toThrow('测试取消切换');
  expect((await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie }, payload: { name: '不能写入' } })).statusCode).toBe(503);
  expect((await app.inject({ method: 'POST', url: '/mcp', payload: {} })).statusCode).toBe(503);
  expect((await app.inject({ url: '/api/system/overview', headers: { cookie } })).statusCode).toBe(200);
  releaseRequest?.();
  await slow; await failure;
  expect((await app.inject({ url: '/api/projects', headers: { cookie } })).statusCode).toBe(200);
  expect(fs.existsSync(`${process.env.DB_PATH}.restore`)).toBe(false);
});

it('安全备份失败或确认指纹过期时不切换数据库', async () => {
  const { sqlite } = await import('./support/database');
  const { scheduleRestore } = await import('../src/server/backups');
  const backup = vi.spyOn(sqlite, 'backup').mockRejectedValueOnce(new Error('磁盘空间不足'));
  await expect(scheduleRestore(uploaded.name, uploaded.fingerprint)).rejects.toThrow('磁盘空间不足');
  backup.mockRestore();
  const result = await app.inject({ method: 'POST', url: '/api/backups/import/restore', headers: { cookie }, payload: { name: uploaded.name, expectedFingerprint: '0'.repeat(64) } });
  expect(result.statusCode).toBe(409);
  expect(sqlite.open).toBe(true);
  expect(fs.existsSync(`${process.env.DB_PATH}.restore`)).toBe(false);
  expect((await app.inject({ url: '/api/projects', headers: { cookie } })).statusCode).toBe(200);
});

it('真实 HTTP 分块上传超限返回 413；客户端断开后能继续维护数据库', async () => {
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const url = `${address}/api/backups/import?filename=stream.db`;
  const status = await new Promise<number>((resolve, reject) => {
    const request = http.request(url, { method: 'POST', headers: { cookie, 'content-type': 'application/octet-stream' } }, (response) => {
      response.resume(); response.on('end', () => resolve(response.statusCode!));
    });
    request.on('error', reject);
    request.write(Buffer.alloc(1024 * 1024));
    request.end(Buffer.alloc(1024 * 1024 + 1));
  });
  expect(status).toBe(413);
  const request = http.request(url, { method: 'POST', headers: { cookie, 'content-type': 'application/octet-stream' } });
  request.on('error', () => undefined);
  request.write(source.subarray(0, 100));
  const partials = () => fs.readdirSync(path.join(directory, 'backups')).filter((name) => name.startsWith('.database-import-'));
  await vi.waitFor(() => expect(partials().length).toBe(1));
  request.destroy();
  await vi.waitFor(() => expect(partials()).toEqual([]));
  expect((await app.inject({ method: 'POST', url: '/api/backups', headers: { cookie } })).statusCode).toBe(200);
});

it('旧版本数据库先迁移，缺少内置账号时使用本机配置创建 admin', async () => {
  const folder = path.join(directory, 'old-migrations');
  fs.mkdirSync(path.join(folder, 'meta'), { recursive: true });
  const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8'));
  journal.entries = journal.entries.slice(0, 1);
  for (const entry of journal.entries) fs.copyFileSync(`drizzle/${entry.tag}.sql`, path.join(folder, `${entry.tag}.sql`));
  fs.writeFileSync(path.join(folder, 'meta', '_journal.json'), JSON.stringify(journal));
  const oldPath = path.join(directory, 'old.db');
  const old = new Database(oldPath);
  try {
    migrate(drizzle(old), { migrationsFolder: folder });
    old.prepare("INSERT INTO projects(id,name,created_at,updated_at) VALUES('legacy-project','旧项目',?,?)").run('2026-01-01', '2026-01-01');
  } finally { old.close(); }
  const response = await app.inject({ method: 'POST', url: '/api/backups/import?filename=old.db', headers: { cookie, 'content-type': 'application/octet-stream' }, payload: fs.readFileSync(oldPath) });
  expect(response.statusCode, response.body).toBe(200);
  const { prepareRestore } = await import('../src/server/backups');
  const { verifyPassword } = await import('../src/server/auth');
  const input = response.json();
  const prepared = await prepareRestore(input.name, input.fingerprint, { importDatabase: true });
  const migrated = new Database(prepared.source);
  try {
    expect(migrated.prepare('SELECT name FROM projects').all()).toEqual([{ name: '旧项目' }]);
    const account = migrated.prepare('SELECT username, password_hash AS hash FROM accounts WHERE is_builtin=1').get() as { username: string; hash: string };
    expect(account.username).toBe('admin');
    expect(verifyPassword('Target-admin-2026!', account.hash)).toBe(true);
    expect(migrated.prepare('SELECT name FROM sqlite_schema WHERE name=\'source_documents\'').get()).toBeTruthy();
  } finally { migrated.close(); }
});
