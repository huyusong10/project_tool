import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scryptSync } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Requirement } from '../src/client/types';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-rework-journey-'));
const password = 'isolated-rework-journey-password';
Object.assign(process.env, {
  DB_PATH: path.join(directory, 'test.db'), BACKUP_DIR: path.join(directory, 'backups'),
  WEB_DIST_DIR: path.join(directory, 'web'), SEED_DEMO: '0', NODE_ENV: 'test',
  APP_PASSWORD_HASH: `scrypt$rework$${scryptSync(password, 'rework', 64).toString('hex')}`,
  SESSION_SECRET: 'rework-journey-isolated-session-secret-123456',
});
let app: FastifyInstance, cookie = '', origin = '', token = '', sequence = 0;
const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, headers: { cookie }, payload });
const get = async <T>(url: string) => (await app.inject({ url, headers: { cookie } })).json<T>();
const detail = (id: string) => get<Requirement>('/api/requirements/' + id);
const summary = (projectId: string) => get<{ acceptedCount: number; reworkCount: number; reacceptedCount: number }>(`/api/projects/${projectId}/delivery-commitments/summary`);
const command = async (id: string, action: string, payload: Record<string, unknown>) => post(`/api/requirements/${id}/${action}`, { expectedVersion: (await detail(id)).version, ...payload });

beforeAll(async () => {
  app = await (await import('../src/server/app')).buildApp();
  origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const login = await post('/api/login', { username: 'admin', password });
  expect(login.statusCode, login.body).toBe(200);
  cookie = String(login.headers['set-cookie']).split(';')[0];
  token = (await post('/api/tokens', { name: '返工一致性验证' })).json().token;
});
afterAll(async () => {
  await app.close();
  const { sqlite } = await import('../src/server/database');
  sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

async function completedRequirement() {
  const projectId = (await post('/api/projects', { name: '返工旅程' + ++sequence })).json().id as string;
  const ownerId = (await post('/api/people', { projectId, name: '执行人' + sequence })).json().id as string;
  const templateId = (await post('/api/templates', { projectId, name: '交付流程', items: [
    { title: '实现接口', startOffsetDays: 0, durationDays: 1, sortOrder: 0 },
    { title: '回归验证', startOffsetDays: 1, durationDays: 1, sortOrder: 1 },
  ] })).json().id as string;
  const created = await post('/api/requirements', { projectId, ownerId, templateId, title: '需要再次交付的需求', plannedStart: '2020-01-02' });
  expect(created.statusCode, created.body).toBe(200);
  const r = created.json<Requirement>();
  for (const w of r.workItems) {
    const assigned = await app.inject({ method: 'PATCH', url: '/api/work-items/' + w.id, headers: { cookie }, payload: { expectedVersion: w.version, ownerId, reason: '安排交付执行人' } });
    expect(assigned.statusCode, assigned.body).toBe(200);
    const completed = await post(`/api/work-items/${w.id}/complete-as-planned`, { expectedVersion: assigned.json().version });
    expect(completed.statusCode, completed.body).toBe(200);
  }
  expect((await detail(r.id)).status).toBe('pending_acceptance');
  return { r: await detail(r.id), projectId };
}

it.each(['REST', 'MCP'] as const)('%s 工作项重开保留首次验收，记一次需求返工；后续另一工作项重开不重复计数，再次验收另计', async protocol => {
  const { r, projectId } = await completedRequirement();
  expect((await command(r.id, 'accept', { content: '首次交付已验收' })).statusCode).toBe(200);
  expect(await summary(projectId)).toMatchObject({ acceptedCount: 1, reworkCount: 0 });
  const accepted = await detail(r.id);
  for (const w of accepted.workItems) {
    const payload = { expectedVersion: w.version, progress: 40, reason: '发现遗漏，补充验证' };
    if (protocol === 'REST') {
      const response = await post(`/api/work-items/${w.id}/reopen`, payload);
      expect(response.statusCode, response.body).toBe(200);
    } else {
      const response = await fetch(origin + '/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + token, accept: 'application/json, text/event-stream', 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'reopen_work_item', arguments: { id: w.id, ...payload } } }) });
      expect(response.ok).toBe(true);
      const body = await response.json() as { result: { isError?: boolean; structuredContent: { result: { status: string } } } };
      expect(body.result.isError).not.toBe(true);
      expect(body.result.structuredContent.result.status).toBe('in_progress');
    }
  }
  const reopened = await detail(r.id);
  expect(reopened).toMatchObject({ status: 'in_progress', acceptedAt: null, progress: 40 });
  expect(await summary(projectId)).toMatchObject({ acceptedCount: 1, reworkCount: 1, reacceptedCount: 0 });
  for (const w of reopened.workItems) expect((await post(`/api/work-items/${w.id}/complete`, { expectedVersion: w.version, content: '返工验证完成' })).statusCode).toBe(200);
  expect((await command(r.id, 'accept', { content: '再次验收通过' })).statusCode).toBe(200);
  expect(await summary(projectId)).toMatchObject({ acceptedCount: 1, reworkCount: 1, reacceptedCount: 1 });
});

it('重开事务失败时，补存验收、工作项和需求历史一起回滚', async () => {
  const { r, projectId } = await completedRequirement();
  const { sqlite } = await import('../src/server/database');
  sqlite.prepare("UPDATE requirements SET status='completed',progress=100,accepted_at='2020-02-03T10:00:00.000Z' WHERE id=?").run(r.id);
  const before = await detail(r.id), beforeSummary = await summary(projectId);
  const auditCount = sqlite.prepare('SELECT count(*) AS n FROM audit_logs').get();
  sqlite.exec("CREATE TEMP TRIGGER reject_rework_event BEFORE INSERT ON progress_updates WHEN NEW.event_type='reopen' BEGIN SELECT RAISE(ABORT,'injected rework failure'); END;");
  try {
    const w = r.workItems[0];
    const response = await post(`/api/work-items/${w.id}/reopen`, { expectedVersion: w.version, reason: '保存中途失败' });
    expect(response.statusCode).toBe(500);
    expect(await detail(r.id)).toEqual(before);
    expect(await summary(projectId)).toEqual(beforeSummary);
    expect(sqlite.prepare('SELECT count(*) AS n FROM audit_logs').get()).toEqual(auditCount);
    expect(sqlite.prepare("SELECT count(*) AS n FROM progress_updates WHERE requirement_id=? AND event_type='accept'").get(r.id)).toEqual({ n: 0 });
  } finally { sqlite.exec('DROP TRIGGER reject_rework_event'); }
});

it('只有验收日期的历史需求，经工作项重开也不丢失原验收事实', async () => {
  const { r, projectId } = await completedRequirement();
  const { sqlite } = await import('../src/server/database');
  sqlite.prepare("UPDATE requirements SET status='completed',progress=100,accepted_at='2020-02-03T10:00:00.000Z' WHERE id=?").run(r.id);
  expect(await summary(projectId)).toMatchObject({ acceptedCount: 1 });
  const w = r.workItems[0];
  expect((await post(`/api/work-items/${w.id}/reopen`, { expectedVersion: w.version, reason: '核对历史交付' })).statusCode).toBe(200);
  expect((await detail(r.id)).acceptedAt).toBeNull();
  expect(await summary(projectId)).toMatchObject({ acceptedCount: 1, reworkCount: 1 });
  expect(sqlite.prepare("SELECT created_at AS at FROM progress_updates WHERE requirement_id=? AND work_item_id IS NULL AND event_type='accept'").all(r.id)).toEqual([{ at: '2020-02-03T10:00:00.000Z' }]);
});

it('整批退回两个工作项有各自可查询的返工说明；错误端点或旧版本不能留下部分修改', async () => {
  const { r, projectId } = await completedRequirement();
  const before = await detail(r.id);
  const invalid = await command(r.id, 'rework', { workItemIds: [r.workItems[0].id, 'missing-work'], reason: '不完整选择' });
  expect(invalid.statusCode).toBe(400);
  expect(await detail(r.id)).toEqual(before);
  const payload = { expectedVersion: r.version, workItemIds: r.workItems.map(w => w.id), reason: '补充验收发现的问题' };
  const response = await post(`/api/requirements/${r.id}/rework`, payload);
  expect(response.statusCode, response.body).toBe(200);
  const after = response.json<Requirement>();
  expect(await summary(projectId)).toMatchObject({ reworkCount: 1 });
  for (const w of r.workItems) {
    expect(after.workItems.find(v => v.id === w.id)).toMatchObject({ status: 'in_progress', actualStart: w.actualStart, actualEnd: null, progress: 99 });
    expect(after.progressUpdates).toEqual(expect.arrayContaining([expect.objectContaining({ workItemId: w.id, eventType: 'rework', content: expect.stringContaining(payload.reason) })]));
  }
  expect((await post(`/api/requirements/${r.id}/rework`, payload)).statusCode).toBe(409);
  expect(await detail(r.id)).toEqual(after);
});
