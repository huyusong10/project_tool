import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const dbPath = path.join(process.cwd(), 'data', `project-permissions-${randomUUID()}.db`);
process.env.DB_PATH = dbPath;
process.env.BACKUP_DIR = path.join(process.cwd(), 'data', `project-permissions-backups-${randomUUID()}`);
process.env.SEED_DEMO = '0';
process.env.APP_PASSWORD_HASH = 'scrypt$4c63a6f93ff4f94b031b7e7583592177$b598dbddaf9dd06678ff8756923d9e0a7f2d68eaa45bc644fbf4a73c9298970c7489671dfcfc8be282022c26a3370fb040f3f086a45faa1e1abde04bbe4a51ef';
process.env.SESSION_SECRET = 'project-permissions-test-secret-more-than-thirty-two-characters';

let app: FastifyInstance;

beforeAll(async () => {
  const module = await import('../src/server/app');
  app = await module.buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  const { sqlite } = await import('./support/database');
  if (sqlite.open) sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
  fs.rmSync(process.env.BACKUP_DIR!, { recursive: true, force: true });
});

describe('项目内项目经理配置', () => {
  it('账号接口只管平台权限，项目经理在项目内任免并保护最后一名经理', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: '41_xc7q0qOjo4Inw!' } });
    const setCookie = login.headers['set-cookie'];
    const adminCookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie!).split(';')[0];

    const project = await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie: adminCookie }, payload: { name: '权限分层测试项目' } });
    const projectId = project.json().id as string;
    const first = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie: adminCookie }, payload: { projectId, name: '项目经理甲', jobTitle: '产品经理' } });
    const second = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie: adminCookie }, payload: { projectId, name: '项目经理乙', jobTitle: '研发经理' } });
    const firstId = first.json().id as string;
    const secondId = second.json().id as string;
    const accounts = (await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie: adminCookie } })).json();
    const firstAccount = accounts.find((account: { personId: string }) => account.personId === firstId);

    const rejected = await app.inject({ method: 'PATCH', url: `/api/accounts/${firstAccount.id}`, headers: { cookie: adminCookie }, payload: {
      role: 'project_manager', managedProjectIds: [projectId],
    } });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error).toContain('项目设置');

    expect((await app.inject({ method: 'PUT', url: `/api/projects/${projectId}/members/${firstId}`, headers: { cookie: adminCookie }, payload: { role: 'manager' } })).statusCode).toBe(200);
    const firstLogin = await app.inject({ method: 'POST', url: '/api/login', payload: { username: '项目经理甲', password: '888888' } });
    let managerCookie = String(firstLogin.headers['set-cookie']).split(';')[0];
    const changed = await app.inject({ method: 'POST', url: '/api/account/change-password', headers: { cookie: managerCookie }, payload: {
      currentPassword: '888888', newPassword: 'project-manager-123',
    } });
    managerCookie = String(changed.headers['set-cookie']).split(';')[0];

    expect((await app.inject({ method: 'PUT', url: `/api/projects/${projectId}/members/${secondId}`, headers: { cookie: managerCookie }, payload: { role: 'manager' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: `/api/projects/${projectId}/members/${secondId}`, headers: { cookie: managerCookie }, payload: { role: 'member' } })).statusCode).toBe(200);

    const lastManagerDemotion = await app.inject({ method: 'PUT', url: `/api/projects/${projectId}/members/${firstId}`, headers: { cookie: managerCookie }, payload: { role: 'member' } });
    expect(lastManagerDemotion.statusCode).toBe(409);
    expect(lastManagerDemotion.json().error).toContain('至少需要保留一名项目经理');

    const secondSnapshot = (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/members`, headers: { cookie: adminCookie } })).json()
      .find((person: { id: string }) => person.id === secondId);
    expect(secondSnapshot.membershipUpdatedAt).toEqual(expect.any(String));
    const promotedSecond = await app.inject({ method: 'PUT', url: `/api/projects/${projectId}/members/${secondId}`, headers: { cookie: adminCookie }, payload: {
      role: 'manager', expectedMembershipUpdatedAt: secondSnapshot.membershipUpdatedAt,
    } });
    expect(promotedSecond.statusCode).toBe(200);
    expect(promotedSecond.json().membershipUpdatedAt).not.toBe(secondSnapshot.membershipUpdatedAt);
    const staleRole = await app.inject({ method: 'PUT', url: `/api/projects/${projectId}/members/${secondId}`, headers: { cookie: adminCookie }, payload: {
      role: 'viewer', expectedMembershipUpdatedAt: secondSnapshot.membershipUpdatedAt,
    } });
    expect(staleRole.statusCode).toBe(409);
    expect(staleRole.json().code).toBe('STALE_WRITE');
    const staleRemoval = await app.inject({ method: 'DELETE', url: `/api/projects/${projectId}/members/${secondId}`, headers: { cookie: adminCookie }, payload: {
      expectedMembershipUpdatedAt: secondSnapshot.membershipUpdatedAt,
    } });
    expect(staleRemoval.statusCode).toBe(409);
    expect(staleRemoval.json().code).toBe('STALE_WRITE');

    const listed = (await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie: adminCookie } })).json()
      .find((account: { personId: string }) => account.personId === firstId);
    expect(listed).toMatchObject({ globalRole: 'user', role: 'project_manager' });
    expect(listed.managedProjects).toEqual([{ id: projectId, name: '权限分层测试项目' }]);

    expect((await app.inject({ method: 'DELETE', url: `/api/projects/${projectId}`, headers: { cookie: adminCookie } })).statusCode).toBe(200);
    const archivedSession = (await app.inject({ method: 'GET', url: '/api/session', headers: { cookie: managerCookie } })).json();
    expect(archivedSession).toMatchObject({ authenticated: true, role: 'user', managedProjectIds: [] });
  });
});
