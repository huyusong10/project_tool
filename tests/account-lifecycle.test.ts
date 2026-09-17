import {listenTestApp} from './support/listen';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scryptSync } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {mcpRequest} from './mcp-request';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-manage-account-lifecycle-'));
const adminPassword = 'temporary-admin-password-123';
const memberPassword = 'temporary-member-password-123';
process.env.DB_PATH = path.join(directory, 'test.db');
process.env.BACKUP_DIR = path.join(directory, 'backups');
process.env.WEB_DIST_DIR = path.join(directory, 'web');
process.env.SEED_DEMO = '0';
process.env.NODE_ENV = 'test';
process.env.APP_PASSWORD_HASH = `scrypt$lifecycle-test$${scryptSync(adminPassword, 'lifecycle-test', 64).toString('hex')}`;
process.env.SESSION_SECRET = 'account-lifecycle-temporary-test-secret-123456789';
let app: FastifyInstance;
let adminCookie = '';
let projectId = '';
let sequence = 0;
let testOrigin = '';
let adminToken = '';

const login = (username: string, password: string) => app.inject({ method: 'POST', url: '/api/login', payload: { username, password } });
const cookieOf = (response: { headers: Record<string, unknown> }) => String(response.headers['set-cookie']).split(';')[0];
const projects = (cookie: string) => app.inject({ url: '/api/projects', headers: { cookie } });
const changeStatus = (accountId: string, status: string) => app.inject({ method: 'PATCH', url: `/api/accounts/${accountId}`, headers: { cookie: adminCookie }, payload: { status } });
const mcp = async (token: string, name = 'list_projects', args: Record<string, unknown> = {}) => {
  // Use the shared real-socket helper; OS-assigned test ports can be blocked by fetch.
  return mcpRequest(testOrigin,token,name,args);
};

async function createIdentity() {
  const username = `生命周期成员${++sequence}`;
  const created = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie: adminCookie }, payload: { name: username, projectId } });
  expect(created.statusCode, created.body).toBe(200);
  const initial = await login(username, '888888');
  expect(initial.statusCode, initial.body).toBe(200);
  const changed = await app.inject({ method: 'POST', url: '/api/account/change-password', headers: { cookie: cookieOf(initial) }, payload: {
    currentPassword: '888888', newPassword: memberPassword,
  } });
  expect(changed.statusCode, changed.body).toBe(200);
  const cookie = cookieOf(changed);
  const token = await app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie }, payload: { name: '生命周期验证' } });
  expect(token.statusCode, token.body).toBe(200);
  return { username, personId: created.json().id as string, accountId: initial.json().accountId as string, cookie, token: token.json().token as string };
}

beforeAll(async () => {
  app = await (await import('../src/server/app')).buildApp();
  testOrigin = await listenTestApp(app);
  const admin = await login('admin', adminPassword);
  expect(admin.statusCode, admin.body).toBe(200);
  adminCookie = cookieOf(admin);
  const token = await app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie: adminCookie }, payload: { name: '管理员生命周期测试' } });
  expect(token.statusCode, token.body).toBe(200);
  adminToken = token.json().token;
  const project = await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie: adminCookie }, payload: { name: '账号生命周期验证' } });
  expect(project.statusCode, project.body).toBe(200);
  projectId = project.json().id;
});

afterAll(async () => {
  await app?.close();
  const { sqlite } = await import('./support/database');
  if (sqlite.open) sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

it('登录拒绝结构化凭据和未知字段', async () => {
  const structured = await app.inject({ method: 'POST', url: '/api/login', payload: {
    username: ['admin'], password: [adminPassword],
  } });
  const unknown = await app.inject({ method: 'POST', url: '/api/login', payload: {
    username: 'admin', password: adminPassword, remember_me: true,
  } });
  expect([structured.statusCode, unknown.statusCode]).toEqual([400, 400]);
  expect(structured.headers['set-cookie']).toBeUndefined();
  expect(unknown.headers['set-cookie']).toBeUndefined();
});

it('停用后再启用不会复活旧Cookie，重新登录可用，Token保留原有恢复语义', async () => {
  const identity = await createIdentity();
  expect((await projects(identity.cookie)).statusCode).toBe(200);
  const initialTool = await mcp(identity.token);
  expect(initialTool.statusCode).toBe(200);
  expect(JSON.parse(initialTool.body).result.structuredContent.result).toEqual(expect.arrayContaining([expect.objectContaining({ id: projectId })]));
  expect((await changeStatus(identity.accountId, 'disabled')).statusCode).toBe(200);
  expect((await projects(identity.cookie)).statusCode).toBe(401);
  expect((await mcp(identity.token)).statusCode).toBe(401);
  expect((await changeStatus(identity.accountId, 'active')).statusCode).toBe(200);
  expect((await projects(identity.cookie)).statusCode).toBe(401);
  const fresh = await login(identity.username, memberPassword);
  expect(fresh.statusCode, fresh.body).toBe(200);
  expect((await projects(cookieOf(fresh))).statusCode).toBe(200);
  expect((await mcp(identity.token)).statusCode).toBe(200);
});

it('普通成员不能通过includeDeleted读取已归档项目', async () => {
  const identity = await createIdentity();
  const created = await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie: adminCookie }, payload: { name: `归档可见性${++sequence}` } });
  const archivedProjectId = created.json().id as string;
  expect((await app.inject({ method: 'PUT', url: `/api/projects/${archivedProjectId}/members/${identity.personId}`, headers: { cookie: adminCookie }, payload: { role: 'member' } })).statusCode).toBe(200);
  expect((await projects(identity.cookie)).json().some((project: { id: string }) => project.id === archivedProjectId)).toBe(true);
  expect((await app.inject({ method: 'DELETE', url: `/api/projects/${archivedProjectId}`, headers: { cookie: adminCookie }, payload: {
    expectedUpdatedAt: created.json().updatedAt,
  } })).statusCode).toBe(200);
  const memberProjects = await app.inject({ url: '/api/projects?includeDeleted=true', headers: { cookie: identity.cookie } });
  expect(memberProjects.statusCode, memberProjects.body).toBe(200);
  expect(memberProjects.json().some((project: { id: string }) => project.id === archivedProjectId)).toBe(false);
  expect((await app.inject({ url: '/api/projects?includeDeleted=true', headers: { cookie: adminCookie } })).json()
    .some((project: { id: string }) => project.id === archivedProjectId)).toBe(true);
});

it('普通成员不能绕过归档中心读取项目归档资源', async () => {
  const identity = await createIdentity();
  const requirement = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie: adminCookie }, payload: {
    projectId, title: `归档权限需求${++sequence}`,
  } });
  const template = await app.inject({ method: 'POST', url: '/api/templates', headers: { cookie: adminCookie }, payload: {
    projectId, name: `归档权限流程${++sequence}`, items: [{ title: '步骤', startOffsetDays: 0, durationDays: 1, sortOrder: 0 }],
  } });
  const person = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie: adminCookie }, payload: {
    projectId, name: `归档权限人员${++sequence}`,
  } });
  const { sqlite } = await import('./support/database');
  const archivedAt = new Date().toISOString();
  sqlite.prepare('UPDATE requirements SET deleted_at=? WHERE id=?').run(archivedAt, requirement.json().id);
  sqlite.prepare('UPDATE work_item_templates SET deleted_at=? WHERE id=?').run(archivedAt, template.json().id);
  sqlite.prepare('UPDATE people SET deleted_at=?, active=0 WHERE id=?').run(archivedAt, person.json().id);

  expect((await app.inject({ url: `/api/requirements?projectId=${projectId}&includeDeleted=true`, headers: { cookie: identity.cookie } })).statusCode).toBe(403);
  expect((await app.inject({ url: `/api/requirements/${requirement.json().id}?includeDeleted=true`, headers: { cookie: identity.cookie } })).statusCode).toBe(403);
  expect((await app.inject({ url: `/api/templates?projectId=${projectId}&includeDeleted=true`, headers: { cookie: identity.cookie } })).statusCode).toBe(403);
  expect((await app.inject({ url: `/api/people?projectId=${projectId}&includeDeleted=true`, headers: { cookie: identity.cookie } })).statusCode).toBe(403);
  const mcpResult = JSON.parse((await mcp(identity.token, 'list_requirements', { projectId, includeDeleted: true })).body);
  expect(mcpResult.result.structuredContent.statusCode).toBe(403);
  expect((await app.inject({ url: `/api/requirements?projectId=${projectId}`, headers: { cookie: identity.cookie } })).statusCode).toBe(200);
});

it('保持启用、修改登录名和修改角色不踢出会话，角色权限立即更新', async () => {
  const identity = await createIdentity();
  expect((await changeStatus(identity.accountId, 'active')).statusCode).toBe(200);
  const updated = await app.inject({ method: 'PATCH', url: `/api/accounts/${identity.accountId}`, headers: { cookie: adminCookie }, payload: { username: `${identity.username}新`, role: 'admin' } });
  expect(updated.statusCode, updated.body).toBe(200);
  expect((await app.inject({ url: '/api/accounts', headers: { cookie: identity.cookie } })).statusCode).toBe(200);
  expect((await app.inject({ method: 'PATCH', url: `/api/accounts/${identity.accountId}`, headers: { cookie: adminCookie }, payload: { role: 'user' } })).statusCode).toBe(200);
  expect((await projects(identity.cookie)).statusCode).toBe(200);
  expect((await app.inject({ url: '/api/accounts', headers: { cookie: identity.cookie } })).statusCode).toBe(403);
});

it('账号编辑拒绝旧页面覆盖较新的资料', async () => {
  const identity = await createIdentity();
  const { sqlite } = await import('./support/database');
  sqlite.prepare('UPDATE accounts SET updated_at=? WHERE id=?').run('2099-01-01T00:00:00.000Z', identity.accountId);
  const listed = await app.inject({ url: '/api/accounts', headers: { cookie: adminCookie } });
  const original = listed.json().find((account: { id: string }) => account.id === identity.accountId);
  expect((await login(identity.username, memberPassword)).statusCode).toBe(200);
  expect((await app.inject({ url: '/api/accounts', headers: { cookie: adminCookie } })).json()
    .find((account: { id: string }) => account.id === identity.accountId).updatedAt).toBe(original.updatedAt);
  const updated = await app.inject({ method: 'PATCH', url: `/api/accounts/${identity.accountId}`, headers: { cookie: adminCookie }, payload: {
    username: `${identity.username}新`, expectedUpdatedAt: original.updatedAt,
  } });
  expect(updated.statusCode, updated.body).toBe(200);
  expect(Date.parse(updated.json().updatedAt)).toBeGreaterThan(Date.parse(original.updatedAt));
  const stale = await app.inject({ method: 'PATCH', url: `/api/accounts/${identity.accountId}`, headers: { cookie: adminCookie }, payload: {
    username: `${identity.username}旧窗口`, expectedUpdatedAt: original.updatedAt,
  } });
  expect(stale.statusCode, stale.body).toBe(409);
  expect(stale.json().code).toBe('STALE_WRITE');
  expect((await app.inject({ url: '/api/accounts', headers: { cookie: adminCookie } })).json()
    .find((account: { id: string }) => account.id === identity.accountId).username).toBe(`${identity.username}新`);
});

it('自行修改密码保持账号版本单调并替换当前会话', async () => {
  const identity = await createIdentity();
  const { sqlite } = await import('./support/database');
  const futureVersion = '2099-01-01T00:00:00.000Z';
  sqlite.prepare('UPDATE accounts SET updated_at=? WHERE id=?').run(futureVersion, identity.accountId);
  const nextPassword = `${memberPassword}-new`;
  const changed = await app.inject({ method: 'POST', url: '/api/account/change-password', headers: { cookie: identity.cookie }, payload: {
    currentPassword: memberPassword, newPassword: nextPassword,
  } });
  expect(changed.statusCode, changed.body).toBe(200);
  const current = sqlite.prepare('SELECT updated_at AS updatedAt FROM accounts WHERE id=?').get(identity.accountId) as { updatedAt: string };
  expect(Date.parse(current.updatedAt)).toBeGreaterThan(Date.parse(futureVersion));
  expect((await login(identity.username, memberPassword)).statusCode).toBe(401);
  expect((await login(identity.username, nextPassword)).statusCode).toBe(200);
  expect((await projects(cookieOf(changed))).statusCode).toBe(200);
});

it('修改密码拒绝会被隐式转成字符串的结构化值', async () => {
  const identity = await createIdentity();
  const changed = await app.inject({ method: 'POST', url: '/api/account/change-password', headers: { cookie: identity.cookie }, payload: {
    currentPassword: memberPassword, newPassword: ['unexpected', 'password'],
  } });
  expect(changed.statusCode, changed.body).toBe(400);
  expect((await login(identity.username, memberPassword)).statusCode).toBe(200);
  expect((await projects(identity.cookie)).statusCode).toBe(200);
});

it('修改密码拒绝未知字段且不改变密码或当前会话', async () => {
  const identity = await createIdentity();
  const nextPassword = `${memberPassword}-unknown-field`;
  const changed = await app.inject({ method: 'POST', url: '/api/account/change-password', headers: { cookie: identity.cookie }, payload: {
    currentPassword: memberPassword, newPassword: nextPassword, new_password: `${nextPassword}-typo`,
  } });
  expect(changed.statusCode, changed.body).toBe(400);
  expect((await login(identity.username, memberPassword)).statusCode).toBe(200);
  expect((await login(identity.username, nextPassword)).statusCode).toBe(401);
  expect((await projects(identity.cookie)).statusCode).toBe(200);
});

it('重复撤销同一Token保持第一次撤销时间且只记录一次审计', async () => {
  const issued = await app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie: adminCookie }, payload: { name: `重复撤销验证${++sequence}` } });
  expect(issued.statusCode, issued.body).toBe(200);
  const id = issued.json().id as string;
  expect((await app.inject({ method: 'DELETE', url: `/api/tokens/${id}`, headers: { cookie: adminCookie } })).statusCode).toBe(200);
  const { sqlite } = await import('./support/database');
  const first = sqlite.prepare('SELECT revoked_at AS revokedAt FROM api_tokens WHERE id=?').get(id) as { revokedAt: string };
  expect((await app.inject({ method: 'DELETE', url: `/api/tokens/${id}`, headers: { cookie: adminCookie } })).statusCode).toBe(200);
  const second = sqlite.prepare('SELECT revoked_at AS revokedAt FROM api_tokens WHERE id=?').get(id) as { revokedAt: string };
  expect(second.revokedAt).toBe(first.revokedAt);
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE entity_type='api_token' AND entity_id=? AND action='revoke'").get(id)).toEqual({ count: 1 });
});

it('撤销Token拒绝意外请求体且Token仍可使用', async () => {
  const issued = await app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie: adminCookie }, payload: { name: `撤销请求体校验${++sequence}` } });
  expect(issued.statusCode, issued.body).toBe(200);
  const removed = await app.inject({ method: 'DELETE', url: `/api/tokens/${issued.json().id}`, headers: { cookie: adminCookie }, payload: {
    expectedUpdatedAt: new Date().toISOString(),
  } });
  expect(removed.statusCode, removed.body).toBe(400);
  const listed = (await app.inject({ method: 'GET', url: '/api/tokens', headers: { cookie: adminCookie } })).json() as Array<{ id: string; revokedAt: string | null }>;
  expect(listed.find((item) => item.id === issued.json().id)?.revokedAt).toBeNull();
  expect((await mcp(issued.json().token)).statusCode).toBe(200);
});

it('创建Token拒绝会被JavaScript隐式转换的无效有效期', async () => {
  for (const expiresInDays of [true, 1.5, '1.5', 0, 3651]) {
    const response = await app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie: adminCookie }, payload: {
      name: '无效有效期', expiresInDays,
    } });
    expect(response.statusCode, response.body).toBe(400);
  }
  const compatible = await app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie: adminCookie }, payload: {
    name: '字符串有效期', expiresInDays: '90',
  } });
  expect(compatible.statusCode, compatible.body).toBe(200);
});

it('创建Token拒绝错拼有效期字段且不留下Token', async () => {
  const before = (await app.inject({ method: 'GET', url: '/api/tokens', headers: { cookie: adminCookie } })).json() as Array<{ id: string }>;
  const response = await app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie: adminCookie }, payload: {
    name: `错误有效期Token${++sequence}`, expiresInDays: 30, expires_in_days: 3650,
  } });
  expect(response.statusCode, response.body).toBe(400);
  const after = (await app.inject({ method: 'GET', url: '/api/tokens', headers: { cookie: adminCookie } })).json() as Array<{ id: string }>;
  expect(after).toEqual(before);
});

it('旧确认框不能重置或删除已变化的账号', async () => {
  const identity = await createIdentity();
  const original = (await app.inject({ url: '/api/accounts', headers: { cookie: adminCookie } })).json()
    .find((account: { id: string }) => account.id === identity.accountId);
  const updated = await app.inject({ method: 'PATCH', url: `/api/accounts/${identity.accountId}`, headers: { cookie: adminCookie }, payload: {
    username: `${identity.username}新`, expectedUpdatedAt: original.updatedAt,
  } });
  expect(updated.statusCode, updated.body).toBe(200);
  const staleInput = { expectedUpdatedAt: original.updatedAt };
  const reset = await app.inject({ method: 'POST', url: `/api/accounts/${identity.accountId}/reset-password`, headers: { cookie: adminCookie }, payload: staleInput });
  expect(reset.statusCode, reset.body).toBe(409);
  expect(reset.json().code).toBe('STALE_WRITE');
  const removed = await app.inject({ method: 'DELETE', url: `/api/accounts/${identity.accountId}`, headers: { cookie: adminCookie }, payload: staleInput });
  expect(removed.statusCode, removed.body).toBe(409);
  expect(removed.json().code).toBe('STALE_WRITE');
  expect((await login(`${identity.username}新`, memberPassword)).statusCode).toBe(200);
});

it('旧未开通页面不能跨过开通删除代际重新启用账号', async () => {
  const identity = await createIdentity();
  const original = (await app.inject({ url: '/api/accounts', headers: { cookie: adminCookie } })).json()
    .find((account: { id: string }) => account.id === identity.accountId);
  const firstDelete = await app.inject({ method: 'DELETE', url: `/api/accounts/${identity.accountId}`, headers: { cookie: adminCookie }, payload: {
    expectedUpdatedAt: original.updatedAt,
  } });
  expect(firstDelete.statusCode, firstDelete.body).toBe(200);
  const firstSnapshot = (await app.inject({ url: '/api/people', headers: { cookie: adminCookie } })).json()
    .find((person: { id: string }) => person.id === identity.personId);
  expect(firstSnapshot.accountDeletedAt).toEqual(expect.any(String));

  const firstOpen = await app.inject({ method: 'POST', url: `/api/people/${identity.personId}/account`, headers: { cookie: adminCookie }, payload: {
    expectedAccountDeletedAt: firstSnapshot.accountDeletedAt,
  } });
  expect(firstOpen.statusCode, firstOpen.body).toBe(200);
  expect(Date.parse(firstOpen.json().account.updatedAt)).toBeGreaterThan(Date.parse(firstSnapshot.accountDeletedAt));
  const secondDelete = await app.inject({ method: 'DELETE', url: `/api/accounts/${identity.accountId}`, headers: { cookie: adminCookie }, payload: {
    expectedUpdatedAt: firstOpen.json().account.updatedAt,
  } });
  expect(secondDelete.statusCode, secondDelete.body).toBe(200);
  const secondSnapshot = (await app.inject({ url: '/api/people', headers: { cookie: adminCookie } })).json()
    .find((person: { id: string }) => person.id === identity.personId);
  expect(Date.parse(secondSnapshot.accountDeletedAt)).toBeGreaterThan(Date.parse(firstSnapshot.accountDeletedAt));

  const staleOpen = await app.inject({ method: 'POST', url: `/api/people/${identity.personId}/account`, headers: { cookie: adminCookie }, payload: {
    expectedAccountDeletedAt: firstSnapshot.accountDeletedAt,
  } });
  expect(staleOpen.statusCode, staleOpen.body).toBe(409);
  expect(staleOpen.json().code).toBe('STALE_WRITE');
  const currentOpen = await app.inject({ method: 'POST', url: `/api/people/${identity.personId}/account`, headers: { cookie: adminCookie }, payload: {
    expectedAccountDeletedAt: secondSnapshot.accountDeletedAt,
  } });
  expect(currentOpen.statusCode, currentOpen.body).toBe(200);
  expect(Date.parse(currentOpen.json().account.updatedAt)).toBeGreaterThan(Date.parse(secondSnapshot.accountDeletedAt));
});

it('开通账号拒绝静默忽略账号编辑字段', async () => {
  const identity = await createIdentity();
  const original = (await app.inject({ url: '/api/accounts', headers: { cookie: adminCookie } })).json()
    .find((account: { id: string }) => account.id === identity.accountId);
  expect((await app.inject({
    method: 'DELETE', url: `/api/accounts/${identity.accountId}`, headers: { cookie: adminCookie },
    payload: { expectedUpdatedAt: original.updatedAt },
  })).statusCode).toBe(200);
  const person = (await app.inject({ url: '/api/people', headers: { cookie: adminCookie } })).json()
    .find((entry: { id: string }) => entry.id === identity.personId);
  const opened = await app.inject({
    method: 'POST', url: `/api/people/${identity.personId}/account`, headers: { cookie: adminCookie }, payload: {
      expectedAccountDeletedAt: person.accountDeletedAt,
      username: `自定义-${identity.username}`,
      role: 'admin',
      status: 'disabled',
      expectedUpdatedAt: original.updatedAt,
    },
  });
  expect(opened.statusCode, opened.body).toBe(400);
  expect(opened.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  expect((await login(identity.username, memberPassword)).statusCode).toBe(401);
});

it('账号管理命令拒绝未知字段且不执行敏感操作', async () => {
  const identity = await createIdentity();
  const original = (await app.inject({ url: '/api/accounts', headers: { cookie: adminCookie } })).json()
    .find((account: { id: string }) => account.id === identity.accountId);
  const updated = await app.inject({ method: 'PATCH', url: `/api/accounts/${identity.accountId}`, headers: { cookie: adminCookie }, payload: {
    status: 'disabled', expectedUpdatedAt: original.updatedAt, account_status: 'active',
  } });
  const reset = await app.inject({ method: 'POST', url: `/api/accounts/${identity.accountId}/reset-password`, headers: { cookie: adminCookie }, payload: {
    expectedUpdatedAt: original.updatedAt, expected_updated_at: original.updatedAt,
  } });
  const removed = await app.inject({ method: 'DELETE', url: `/api/accounts/${identity.accountId}`, headers: { cookie: adminCookie }, payload: {
    expectedUpdatedAt: original.updatedAt, expected_updated_at: original.updatedAt,
  } });
  expect([updated.statusCode, reset.statusCode, removed.statusCode]).toEqual([400, 400, 400]);
  expect((await login(identity.username, memberPassword)).statusCode).toBe(200);
  expect((await projects(identity.cookie)).statusCode).toBe(200);

  const deleted = await app.inject({ method: 'DELETE', url: `/api/accounts/${identity.accountId}`, headers: { cookie: adminCookie }, payload: {
    expectedUpdatedAt: original.updatedAt,
  } });
  expect(deleted.statusCode, deleted.body).toBe(200);
  const person = (await app.inject({ url: '/api/people', headers: { cookie: adminCookie } })).json()
    .find((entry: { id: string }) => entry.id === identity.personId);
  const opened = await app.inject({ method: 'POST', url: `/api/people/${identity.personId}/account`, headers: { cookie: adminCookie }, payload: {
    expectedAccountDeletedAt: person.accountDeletedAt, expected_account_deleted_at: person.accountDeletedAt,
  } });
  expect(opened.statusCode, opened.body).toBe(400);
  expect((await login(identity.username, memberPassword)).statusCode).toBe(401);
});

it('旧确认框不能归档已变化人员，归档也不会倒退关联账号版本', async () => {
  const identity = await createIdentity();
  const original = (await app.inject({ url: '/api/people', headers: { cookie: adminCookie } })).json()
    .find((person: { id: string }) => person.id === identity.personId);
  const updated = await app.inject({ method: 'PATCH', url: `/api/people/${identity.personId}`, headers: { cookie: adminCookie }, payload: {
    jobTitle: '新岗位', expectedUpdatedAt: original.updatedAt,
  } });
  expect(updated.statusCode, updated.body).toBe(200);
  const stale = await app.inject({ method: 'DELETE', url: `/api/people/${identity.personId}`, headers: { cookie: adminCookie }, payload: {
    expectedUpdatedAt: original.updatedAt,
  } });
  expect(stale.statusCode, stale.body).toBe(409);
  expect(stale.json().code).toBe('STALE_WRITE');
  const { sqlite } = await import('./support/database');
  const accountVersion = '2099-01-01T00:00:00.000Z';
  sqlite.prepare('UPDATE accounts SET updated_at=? WHERE id=?').run(accountVersion, identity.accountId);
  const archived = await app.inject({ method: 'DELETE', url: `/api/people/${identity.personId}`, headers: { cookie: adminCookie }, payload: {
    expectedUpdatedAt: updated.json().updatedAt,
  } });
  expect(archived.statusCode, archived.body).toBe(200);
  const account = sqlite.prepare('SELECT status, updated_at AS updatedAt FROM accounts WHERE id=?').get(identity.accountId) as { status: string; updatedAt: string };
  expect(account.status).toBe('disabled');
  expect(Date.parse(account.updatedAt)).toBeGreaterThan(Date.parse(accountVersion));
  const restored = await app.inject({ method: 'POST', url: `/api/people/${identity.personId}/restore`, headers: { cookie: adminCookie } });
  expect(restored.statusCode, restored.body).toBe(200);
  const restoredAccount = sqlite.prepare('SELECT status, updated_at AS updatedAt FROM accounts WHERE id=?').get(identity.accountId) as { status: string; updatedAt: string };
  expect(restoredAccount.status).toBe('active');
  expect(Date.parse(restoredAccount.updatedAt)).toBeGreaterThan(Date.parse(account.updatedAt));
});

it.each(['inactive', 'archived'] as const)('%s人员不能绕过人员恢复入口直接启用账号', async (state) => {
  const identity = await createIdentity();
  const disabled = await app.inject({ method: state === 'inactive' ? 'PATCH' : 'DELETE', url: `/api/people/${identity.personId}`, headers: { cookie: adminCookie },
    ...(state === 'inactive' ? { payload: { active: false } } : {}),
  });
  expect(disabled.statusCode, disabled.body).toBe(200);
  const enabled = await changeStatus(identity.accountId, 'active');
  expect(enabled.statusCode, enabled.body).toBe(409);
  expect(enabled.json().error).toContain('恢复人员');
  expect((await projects(identity.cookie)).statusCode).toBe(401);
  expect((await mcp(identity.token)).statusCode).toBe(401);
  const restored = await app.inject({ method: state === 'inactive' ? 'PATCH' : 'POST', url: `/api/people/${identity.personId}${state === 'archived' ? '/restore' : ''}`, headers: { cookie: adminCookie },
    ...(state === 'inactive' ? { payload: { active: true } } : {}),
  });
  expect(restored.statusCode, restored.body).toBe(200);
  expect((await login(identity.username, memberPassword)).statusCode).toBe(200);
  expect((await projects(identity.cookie)).statusCode).toBe(401);
  expect((await mcp(identity.token)).statusCode).toBe(200);
});

it.each(['inactive', 'archived'] as const)('历史不一致数据：账号启用但人员%s时，登录、REST与MCP都拒绝', async (state) => {
  const identity = await createIdentity();
  const { sqlite } = await import('./support/database');
  // 仅污染本测试的临时库，模拟旧版本留下的状态不一致，不调整账号或会话版本。
  sqlite.prepare('UPDATE people SET active=?, deleted_at=? WHERE id=?').run(state === 'inactive' ? 0 : 1, state === 'archived' ? new Date().toISOString() : null, identity.personId);
  const deniedLogin = await login(identity.username, memberPassword);
  const rest = await projects(identity.cookie);
  const tool = await mcp(identity.token);
  expect.soft(deniedLogin.statusCode).toBe(403);
  expect.soft(deniedLogin.headers['set-cookie']).toBeUndefined();
  expect.soft(rest.statusCode).toBe(401);
  expect.soft(tool.statusCode).toBe(401);
  expect.soft((await app.inject({ url: '/api/session', headers: { cookie: identity.cookie } })).json().authenticated).toBe(false);
  expect((await projects(adminCookie)).statusCode).toBe(200);
});

it.each(['REST', 'MCP'] as const)('%s保存人员资料携带原active值，不改变登录状态或注销现有会话', async (channel) => {
  const { sqlite } = await import('./support/database');
  for (const loginAllowed of [true, false]) {
    const identity = await createIdentity();
    if (!loginAllowed) expect((await changeStatus(identity.accountId, 'disabled')).statusCode).toBe(200);
    const before = sqlite.prepare('SELECT status, session_version AS version FROM accounts WHERE id=?').get(identity.accountId);
    const input = { name: identity.username, jobTitle: '资料已更新', active: true };
    if (channel === 'REST') {
      const saved = await app.inject({ method: 'PATCH', url: `/api/people/${identity.personId}`, headers: { cookie: adminCookie }, payload: input });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(saved.json()).toMatchObject({ jobTitle: '资料已更新', active: 1 });
    } else {
      const saved = await mcp(adminToken, 'update_person', { id: identity.personId, ...input });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(JSON.parse(saved.body).result.structuredContent.result).toMatchObject({ jobTitle: '资料已更新', active: 1 });
    }
    expect.soft(sqlite.prepare('SELECT status, session_version AS version FROM accounts WHERE id=?').get(identity.accountId)).toEqual(before);
    expect.soft((await projects(identity.cookie)).statusCode).toBe(loginAllowed ? 200 : 401);
    expect.soft((await mcp(identity.token)).statusCode).toBe(loginAllowed ? 200 : 401);
    expect.soft((await login(identity.username, memberPassword)).statusCode).toBe(loginAllowed ? 200 : 403);
  }
});
