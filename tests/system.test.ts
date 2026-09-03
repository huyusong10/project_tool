import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const dbPath = path.join(process.cwd(), 'data', `system-${randomUUID()}.db`);
const backupDir = path.join(process.cwd(), 'data', `system-backups-${randomUUID()}`);
process.env.DB_PATH = dbPath;
process.env.BACKUP_DIR = backupDir;
process.env.BACKUP_MAX_COUNT = '10';
process.env.SEED_DEMO = '0';
process.env.APP_PASSWORD_HASH = 'scrypt$4c63a6f93ff4f94b031b7e7583592177$b598dbddaf9dd06678ff8756923d9e0a7f2d68eaa45bc644fbf4a73c9298970c7489671dfcfc8be282022c26a3370fb040f3f086a45faa1e1abde04bbe4a51ef';
process.env.SESSION_SECRET = 'system-test-session-secret-with-more-than-thirty-two-characters';
process.env.NODE_ENV = 'test';

let app: FastifyInstance;
let cookie = '';

beforeAll(async () => {
  const module = await import('../src/server/app');
  app = await module.buildApp();
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: '41_xc7q0qOjo4Inw!' } });
  const setCookie = login.headers['set-cookie'];
  cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie!).split(';')[0];
});

afterAll(async () => {
  await app.close();
  const { sqlite } = await import('../src/server/database');
  if (sqlite.open) sqlite.close();
  for (const suffix of ['', '-wal', '-shm', '.restore']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
});

describe('系统管理API', () => {
  it('仅管理员可查看概览并执行数据库完整性检查', async () => {
    const defaultBranding = await app.inject({ method: 'GET', url: '/api/branding' });
    expect(defaultBranding.statusCode).toBe(200);
    expect(defaultBranding.json()).toMatchObject({ systemName: '项目管理', shortName: 'PM', logoUrl: null });
    expect((await app.inject({ method: 'GET', url: '/api/system/overview' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/system/database-check' })).statusCode).toBe(401);

    expect((await app.inject({ method: 'POST', url: '/api/people', headers: { cookie }, payload: { name: '系统检查普通用户', jobTitle: '测试工程师' } })).statusCode).toBe(200);
    const memberLogin = await app.inject({ method: 'POST', url: '/api/login', payload: { username: '系统检查普通用户', password: '888888' } });
    const memberSetCookie = memberLogin.headers['set-cookie'];
    let memberCookie = (Array.isArray(memberSetCookie) ? memberSetCookie[0] : memberSetCookie!).split(';')[0];
    const changed = await app.inject({ method: 'POST', url: '/api/account/change-password', headers: { cookie: memberCookie }, payload: { currentPassword: '888888', newPassword: 'System-user-2026!' } });
    const changedSetCookie = changed.headers['set-cookie'];
    memberCookie = (Array.isArray(changedSetCookie) ? changedSetCookie[0] : changedSetCookie!).split(';')[0];
    expect((await app.inject({ method: 'GET', url: '/api/system/overview', headers: { cookie: memberCookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/system/database-check', headers: { cookie: memberCookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/system/branding', headers: { cookie: memberCookie }, payload: { systemName: '无权修改', shortName: 'NO' } })).statusCode).toBe(403);

    const logoDataUrl = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')}`;
    const updatedBranding = await app.inject({ method: 'PUT', url: '/api/system/branding', headers: { cookie }, payload: { systemName: '研发项目管理', shortName: 'RDM', logoDataUrl } });
    expect(updatedBranding.statusCode).toBe(200);
    expect(updatedBranding.json()).toEqual(expect.objectContaining({ systemName: '研发项目管理', shortName: 'RDM', logoUrl: expect.stringContaining('/api/branding/logo?v=') }));
    const logo = await app.inject({ method: 'GET', url: '/api/branding/logo' });
    expect(logo.statusCode).toBe(200);
    expect(logo.headers['content-type']).toContain('image/png');
    expect((await app.inject({ method: 'PUT', url: '/api/system/branding', headers: { cookie }, payload: { systemName: '研发项目管理', shortName: 'RDM', logoDataUrl: 'data:image/png;base64,bm90LWltYWdl' } })).statusCode).toBe(400);
    const removedLogo = await app.inject({ method: 'PUT', url: '/api/system/branding', headers: { cookie }, payload: { systemName: '项目管理', shortName: 'PM', logoDataUrl: null } });
    expect(removedLogo.json()).toMatchObject({ systemName: '项目管理', shortName: 'PM', logoUrl: null });
    expect((await app.inject({ method: 'GET', url: '/api/branding/logo' })).statusCode).toBe(404);

    const overview = await app.inject({ method: 'GET', url: '/api/system/overview', headers: { cookie } });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({
      status: 'ok',
      service: { version: '1.0.0', protocol: 'http' },
      database: { journalMode: 'WAL' },
      backups: { count: 0, overdue: true, retentionDays: 30, maxCount: 10 },
    });

    const check = await app.inject({ method: 'POST', url: '/api/system/database-check', headers: { cookie } });
    expect(check.statusCode).toBe(200);
    expect(check.json()).toEqual(expect.objectContaining({ ok: true, checkedAt: expect.any(String), durationMs: expect.any(Number) }));
    const brandingAudit = await app.inject({ method: 'GET', url: '/api/audit/search?entityType=system_branding&action=update&pageSize=20', headers: { cookie } });
    expect(brandingAudit.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ entityType: 'system_branding', action: 'update', summary: expect.not.stringContaining('base64') })]));
  });

  it('备份统计准确，恢复准备会校验目标并生成当前数据库安全备份', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/backups', headers: { cookie } });
    expect(created.statusCode).toBe(200);
    const firstBackup = created.json() as { name: string; size: number; createdAt: string };

    const overview = (await app.inject({ method: 'GET', url: '/api/system/overview', headers: { cookie } })).json();
    expect(overview.backups).toMatchObject({ count: 1, totalSizeBytes: firstBackup.size, lastCreatedAt: firstBackup.createdAt, overdue: false });

    const { prepareRestore } = await import('../src/server/backups');
    const prepared = await prepareRestore(firstBackup.name);
    expect(prepared.safetyBackup.name).not.toBe(firstBackup.name);
    expect(fs.existsSync(path.join(backupDir, prepared.safetyBackup.name))).toBe(true);

    const audit = await app.inject({ method: 'GET', url: '/api/audit/search?entityType=backup&action=create&pageSize=20', headers: { cookie } });
    expect(audit.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ entityId: firstBackup.name, action: 'create' })]));

    fs.writeFileSync(path.join(backupDir, 'project-manage-invalid.db'), 'not a sqlite database');
    const countBeforeInvalidRestore = fs.readdirSync(backupDir).length;
    const invalidRestore = await app.inject({ method: 'POST', url: '/api/backups/restore', headers: { cookie }, payload: { name: 'project-manage-invalid.db' } });
    expect(invalidRestore.statusCode).toBe(400);
    expect(fs.readdirSync(backupDir)).toHaveLength(countBeforeInvalidRestore);
  });
});
