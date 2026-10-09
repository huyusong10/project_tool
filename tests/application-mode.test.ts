import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ApplicationMode } from '../src/shared/api/system';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-application-mode-'));
process.env.DB_PATH = path.join(directory, 'test.db');
process.env.BACKUP_DIR = path.join(directory, 'backups');
process.env.SEED_DEMO = '0';
process.env.ADMIN_PASSWORD = '';
process.env.APP_PASSWORD_HASH = 'scrypt$4c63a6f93ff4f94b031b7e7583592177$b598dbddaf9dd06678ff8756923d9e0a7f2d68eaa45bc644fbf4a73c9298970c7489671dfcfc8be282022c26a3370fb040f3f086a45faa1e1abde04bbe4a51ef';
process.env.SESSION_SECRET = 'application-mode-test-secret-with-more-than-thirty-two-characters';
process.env.NODE_ENV = 'test';

let app: FastifyInstance;
let cookie: string;
let mode: ApplicationMode;

beforeAll(async () => {
  app = await (await import('../src/server/app')).buildApp();
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: '41_xc7q0qOjo4Inw!' } });
  expect(login.statusCode).toBe(200);
  const header = login.headers['set-cookie']!;
  cookie = (Array.isArray(header) ? header[0] : header).split(';')[0];
});

afterAll(async () => {
  await app?.close();
  (await import('../src/server/database-context')).getDefaultDatabase()?.close();
  if (path.dirname(directory) !== fs.realpathSync(os.tmpdir())) throw new Error('测试目录超出临时目录');
  fs.rmSync(directory, { recursive: true, force: true });
});

const readMode = async () => (await app.inject({ method: 'GET', url: '/api/branding' })).json().applicationMode as ApplicationMode;
const saveMode = (issueTrackingOnly: boolean, expectedUpdatedAt: string | null) => app.inject({
  method: 'PUT', url: '/api/system/application-mode', headers: { cookie }, payload: { issueTrackingOnly, expectedUpdatedAt },
});

it('默认完整模式，只有管理员可以修改，输入严格校验', async () => {
  mode = await readMode();
  expect(mode).toEqual({ issueTrackingOnly: false, updatedAt: null });
  expect((await app.inject({ method: 'PUT', url: '/api/system/application-mode', payload: { issueTrackingOnly: true, expectedUpdatedAt: null } })).statusCode).toBe(401);
  const person = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie }, payload: { name: '模式普通用户' } });
  expect(person.statusCode).toBe(200);
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: '模式普通用户', password: '888888' } });
  const header = login.headers['set-cookie']!;
  let memberCookie = (Array.isArray(header) ? header[0] : header).split(';')[0];
  const changed = await app.inject({ method: 'POST', url: '/api/account/change-password', headers: { cookie: memberCookie }, payload: { currentPassword: '888888', newPassword: 'Mode-member-password' } });
  const changedHeader = changed.headers['set-cookie']!;
  memberCookie = (Array.isArray(changedHeader) ? changedHeader[0] : changedHeader).split(';')[0];
  expect((await app.inject({ method: 'PUT', url: '/api/system/application-mode', headers: { cookie: memberCookie }, payload: { issueTrackingOnly: true, expectedUpdatedAt: null } })).statusCode).toBe(403);
  for (const payload of [{ issueTrackingOnly: 'true', expectedUpdatedAt: null }, { issueTrackingOnly: true }, { issueTrackingOnly: true, expectedUpdatedAt: null, extra: 1 }]) {
    expect((await app.inject({ method: 'PUT', url: '/api/system/application-mode', headers: { cookie }, payload })).statusCode).toBe(400);
  }
  expect(await readMode()).toEqual(mode);
});

it('全局保存并记录审计，旧版本不能覆盖，不影响品牌设置', async () => {
  const saved = await saveMode(true, mode.updatedAt);
  expect(saved.statusCode).toBe(200);
  mode = saved.json();
  expect(mode).toEqual({ issueTrackingOnly: true, updatedAt: expect.any(String) });
  expect(await readMode()).toEqual(mode);
  expect((await saveMode(false, null)).statusCode).toBe(409);
  expect((await saveMode(true, mode.updatedAt)).json()).toEqual(mode);
  const branding = await app.inject({ method: 'PUT', url: '/api/system/branding', headers: { cookie }, payload: { systemName: '遗留问题', shortName: 'IT' } });
  expect(branding.json().applicationMode).toEqual(mode);
  const audit = await app.inject({ method: 'GET', url: '/api/audit/search?entityType=application_mode', headers: { cookie } });
  expect(audit.json().items).toHaveLength(1);
  expect(audit.json().items[0].summary).toBe('仅启用问题跟踪功能');
});

it('服务重启保留模式，原有需求及问题处理继续有效，关闭后保留数据', async () => {
  await app.close();
  (await import('../src/server/database-context')).getDefaultDatabase()!.close();
  app = await (await import('../src/server/app')).buildApp();
  await app.ready();
  expect(await readMode()).toEqual(mode);
  const project = (await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie }, payload: { name: '遗留项目' } })).json();
  const requirement = (await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie }, payload: { projectId: project.id, title: '历史需求' } })).json();
  const created = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie }, payload: { projectId: project.id, requirementId: requirement.id, title: '历史问题' } });
  expect(created.statusCode).toBe(200);
  const issue = created.json();
  const resolved = await app.inject({ method: 'POST', url: `/api/issues/${issue.id}/resolve`, headers: { cookie }, payload: { expectedVersion: issue.version, content: '遗留问题处理完成' } });
  expect(resolved.statusCode).toBe(200);
  expect(resolved.json()).toMatchObject({ status: 'resolved', requirementId: requirement.id });
  const restored = await saveMode(false, mode.updatedAt);
  expect(restored.statusCode).toBe(200);
  expect(await readMode()).toEqual(restored.json());
  const list = await app.inject({ method: 'GET', url: '/api/issues?projectId=' + project.id, headers: { cookie } });
  expect(list.json().items).toEqual([expect.objectContaining({ id: issue.id, requirementId: requirement.id, status: 'resolved' })]);
});
