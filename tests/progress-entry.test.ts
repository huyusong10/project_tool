import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scryptSync } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Requirement } from '../src/client/types';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-manage-progress-entry-'));
const password = 'temporary-progress-contract-password';
process.env.DB_PATH = path.join(directory, 'test.db');
process.env.BACKUP_DIR = path.join(directory, 'backups');
process.env.WEB_DIST_DIR = path.join(directory, 'web');
process.env.SEED_DEMO = '0';
process.env.NODE_ENV = 'test';
process.env.APP_PASSWORD_HASH = `scrypt$progress$${scryptSync(password, 'progress', 64).toString('hex')}`;
process.env.SESSION_SECRET = 'progress-contract-temporary-secret-123456789';
let app: FastifyInstance;
let cookie = '';
let token = '';
let origin = '';
let projectId = '';
let ownerId = '';
let templateId = '';
let sequence = 0;
const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, headers: { cookie }, payload });
const detail = async (id: string) => (await app.inject({ url: `/api/requirements/${id}`, headers: { cookie } })).json<Requirement>();

async function write(protocol: 'REST' | 'MCP', requirementId: string, input: Record<string, unknown>) {
  if (protocol === 'REST') {
    const response = await post(`/api/requirements/${requirementId}/progress`, input);
    return { statusCode: response.statusCode, body: response.json() };
  }
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'add_progress', arguments: { requirementId, ...input } } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number; result?: unknown } } };
  return { statusCode: payload.result.structuredContent.statusCode || 200, body: payload.result.structuredContent.result ?? payload.result.structuredContent };
}

async function fixture(status: string) {
  const created = await post('/api/requirements', { projectId, templateId, ownerId, title: `进展契约${++sequence}`, plannedStart: '2020-01-02' });
  expect(created.statusCode, created.body).toBe(200);
  const requirement = created.json<Requirement>();
  let item = requirement.workItems[0];
  const assigned = await app.inject({ method: 'PATCH', url: `/api/work-items/${item.id}`, headers: { cookie }, payload: { ownerId, expectedVersion: item.version } });
  expect(assigned.statusCode, assigned.body).toBe(200);
  item = assigned.json();
  if (status !== 'not_started') {
    const started = await post(`/api/work-items/${item.id}/start`, { expectedVersion: item.version });
    expect(started.statusCode, started.body).toBe(200);
    item = started.json();
    if (status !== 'in_progress') {
      const action = status === 'completed' ? 'complete' : status === 'cancelled' ? 'cancel' : 'block';
      const changed = await post(`/api/work-items/${item.id}/${action}`, {
        expectedVersion: item.version,
        ...(action === 'complete' ? { content: '完成测试工作' } : { reason: '验证关联说明' }),
      });
      expect(changed.statusCode, changed.body).toBe(200);
    }
  }
  return detail(requirement.id);
}

beforeAll(async () => {
  app = await (await import('../src/server/app')).buildApp();
  origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password } });
  expect(login.statusCode).toBe(200);
  cookie = String(login.headers['set-cookie']).split(';')[0];
  token = (await post('/api/tokens', { name: '进展契约验证' })).json().token;
  projectId = (await post('/api/projects', { name: '进展契约项目' })).json().id;
  ownerId = (await post('/api/people', { projectId, name: '进展负责人' })).json().id;
  templateId = (await post('/api/templates', { projectId, name: '单工作项流程', items: [{ title: '实现', startOffsetDays: 0, durationDays: 2, sortOrder: 0 }] })).json().id;
});

afterAll(async () => {
  await app?.close();
  const { sqlite } = await import('../src/server/database');
  if (sqlite.open) sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

for (const protocol of ['REST', 'MCP'] as const) {
  it.each(['not_started', 'in_progress', 'blocked', 'completed', 'cancelled'])(`${protocol}与表单一致地处理%s工作项，始终保留关联`, async (status) => {
    const before = await fixture(status);
    const item = before.workItems[0];
    const content = `${protocol}记录${status}工作项`;
    const response = await write(protocol, before.id, { content, workItemId: item.id, expectedVersion: item.version, ...(status === 'in_progress' ? { workItemPercent: 60 } : {}) });
    if (['completed', 'cancelled'].includes(status)) {
      expect(response.statusCode).toBe(409);
      expect(await detail(before.id)).toEqual(before);
      return;
    }
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    const saved = await detail(before.id);
    expect(saved.progressUpdates?.filter((entry) => entry.content === content)).toEqual([expect.objectContaining({
      workItemId: item.id, eventType: status === 'in_progress' ? 'progress' : 'note', workItemPercent: status === 'in_progress' ? 60 : null,
    })]);
    expect(saved.workItems[0]).toMatchObject({ status, progress: status === 'in_progress' ? 60 : item.progress, version: item.version + (status === 'in_progress' ? 1 : 0) });
  });

  it(`${protocol}拒绝旧版本和降低完成度，失败不追加记录`, async () => {
    const before = await fixture('in_progress');
    const item = before.workItems[0];
    expect((await write('REST', before.id, { content: '另一个窗口的进展', workItemId: item.id, expectedVersion: item.version, workItemPercent: 50 })).statusCode).toBe(200);
    const current = await detail(before.id);
    expect((await write(protocol, before.id, { content: '旧草稿', workItemId: item.id, expectedVersion: item.version, workItemPercent: 60 })).statusCode).toBe(409);
    expect(await detail(before.id)).toEqual(current);
    expect((await write(protocol, before.id, { content: '低于最新完成度', workItemId: item.id, expectedVersion: current.workItems[0].version, workItemPercent: 40 })).statusCode).toBe(400);
    expect(await detail(before.id)).toEqual(current);
    expect((await write(protocol, before.id, { content: '核对后的进展', workItemId: item.id, expectedVersion: current.workItems[0].version, workItemPercent: 75 })).statusCode).toBe(200);
    expect((await detail(before.id)).workItems[0].progress).toBe(75);
  });
}
