import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scryptSync } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { RequirementRecord } from '../src/server/services/requirements';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-manage-cancellation-'));
const password = 'temporary-cancellation-password-123';
process.env.DB_PATH = path.join(directory, 'test.db');
process.env.BACKUP_DIR = path.join(directory, 'backups');
process.env.WEB_DIST_DIR = path.join(directory, 'web');
process.env.SEED_DEMO = '0';
process.env.NODE_ENV = 'test';
process.env.APP_PASSWORD_HASH = `scrypt$cancellation$${scryptSync(password, 'cancellation', 64).toString('hex')}`;
process.env.SESSION_SECRET = 'cancellation-temporary-test-secret-123456789';
let app: FastifyInstance;
let cookie = '';
let token = '';
let origin = '';
let sequence = 0;
type Detail = RequirementRecord & { progressUpdates: Array<{ id: string; percent: number; eventType: string; workItemId: string | null }> };
const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, headers: { cookie }, payload });
const detail = async (id: string) => (await app.inject({ url: `/api/requirements/${id}`, headers: { cookie } })).json<Detail>();

async function cancel(protocol: 'REST' | 'MCP', requirement: Detail) {
  const input = { expectedVersion: requirement.version, reason: '调整范围，取消需求' };
  if (protocol === 'REST') {
    const response = await post(`/api/requirements/${requirement.id}/cancel`, input);
    return { statusCode: response.statusCode, body: response.json<Detail>() };
  }
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'cancel_requirement', arguments: { id: requirement.id, ...input } } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number; result: Detail } } };
  return { statusCode: payload.result.structuredContent.statusCode || 200, body: payload.result.structuredContent.result };
}

async function createScenario(scenario: string) {
  const projectId = (await post('/api/projects', { name: `取消需求${++sequence}` })).json().id;
  const ownerId = (await post('/api/people', { projectId, name: `取消测试成员${sequence}` })).json().id;
  const templateId = (await post('/api/templates', { projectId, name: '分段计划', items: [
    { title: '实现', startOffsetDays: 0, durationDays: 1, sortOrder: 0 },
    { title: '验收准备', startOffsetDays: 3, durationDays: 2, sortOrder: 1 },
  ] })).json().id;
  const created = await post('/api/requirements', { projectId, ownerId, templateId, title: `取消场景：${scenario}`, ...(scenario === 'planning' ? {} : { plannedStart: '2020-01-02' }) });
  expect(created.statusCode, created.body).toBe(200);
  const requirement = created.json<Detail>();
  if (scenario === 'planning') return detail(requirement.id);
  if (scenario === 'mixed' || scenario === 'pending_acceptance') {
    const completedItems = scenario === 'mixed' ? requirement.workItems!.slice(0, 1) : requirement.workItems!;
    for (const item of completedItems) {
      const completed = await post(`/api/work-items/${item.id}/complete-as-planned`, { expectedVersion: item.version });
      expect(completed.statusCode, completed.body).toBe(200);
    }
  }
  if (scenario === 'mixed' || scenario === 'executing') {
    const item = requirement.workItems![scenario === 'mixed' ? 1 : 0];
    const assigned = await app.inject({ method: 'PATCH', url: `/api/work-items/${item.id}`, headers: { cookie }, payload: { expectedVersion: item.version, ownerId, reason: '安排剩余工作' } });
    expect(assigned.statusCode, assigned.body).toBe(200);
    const started = await post(`/api/work-items/${item.id}/start`, { expectedVersion: assigned.json().version });
    expect(started.statusCode, started.body).toBe(200);
    const progressed = await post(`/api/requirements/${requirement.id}/progress`, { workItemId: item.id, expectedVersion: started.json().version, content: '保留执行进度', workItemPercent: 40 });
    expect(progressed.statusCode, progressed.body).toBe(200);
    const progressedItem = progressed.json<Detail>().workItems!.find((entry) => entry.id === item.id)!;
    const blocked = await post(`/api/work-items/${item.id}/block`, { expectedVersion: progressedItem.version, reason: '等待外部输入' });
    expect(blocked.statusCode, blocked.body).toBe(200);
  }
  return detail(requirement.id);
}

beforeAll(async () => {
  app = await (await import('../src/server/app')).buildApp();
  origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password } });
  expect(login.statusCode, login.body).toBe(200);
  cookie = String(login.headers['set-cookie']).split(';')[0];
  token = (await post('/api/tokens', { name: '取消需求验证' })).json().token;
});

afterAll(async () => {
  await app?.close();
  const { sqlite } = await import('../src/server/database');
  if (sqlite.open) sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

for (const protocol of ['REST', 'MCP'] as const) {
  it.each(['mixed', 'executing', 'planning', 'pending_acceptance'])(`${protocol}取消%s需求：存储、详情、取消记录和看板聚合一致`, async (scenario) => {
    const before = await createScenario(scenario);
    if (scenario === 'mixed' || scenario === 'executing') {
      expect(before.status).toBe('blocked');
      expect(before.progress).toBeGreaterThan(0);
      expect(before.progress).toBeLessThan(100);
    } else expect(before.status).toBe(scenario);
    const response = await cancel(protocol, before);
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    const cancelled = response.body;
    expect(cancelled).toMatchObject({ status: 'cancelled', acceptedAt: null, version: before.version + 1 });
    const { sqlite } = await import('../src/server/database');
    const stored = sqlite.prepare('SELECT status, progress, planned_start AS plannedStart, planned_end AS plannedEnd, risk_level AS riskLevel, version FROM requirements WHERE id=?').get(before.id);
    expect(stored).toEqual({ status: cancelled.status, progress: cancelled.progress, plannedStart: cancelled.plannedStart, plannedEnd: cancelled.plannedEnd, riskLevel: cancelled.riskLevel, version: cancelled.version });
    const cancelEvents = cancelled.progressUpdates.filter((event) => event.eventType === 'cancel' && !event.workItemId);
    expect(cancelEvents).toHaveLength(1);
    expect(cancelEvents[0].percent).toBe(cancelled.progress);
    expect(cancelled.progressUpdates).toEqual(expect.arrayContaining(before.progressUpdates));
    for (const item of before.workItems!) {
      const after = cancelled.workItems!.find((entry) => entry.id === item.id)!;
      if (item.status === 'completed') expect(after).toEqual(item);
      else expect(after).toMatchObject({ status: 'cancelled', version: item.version + 1, progress: item.progress, actualStart: item.actualStart, actualEnd: null, blockedAt: null, blockedReason: null });
      expect([after.plannedStart, after.plannedEnd]).toEqual([item.plannedStart, item.plannedEnd]);
    }
    expect(await detail(before.id)).toEqual(cancelled);
    const dashboard = await app.inject({ url: `/api/dashboard?projectId=${before.projectId}`, headers: { cookie } });
    expect(dashboard.statusCode, dashboard.body).toBe(200);
    expect(dashboard.json().summary).toMatchObject({ completed: 0, active: 0, highRisk: 0 });
    expect(dashboard.json().requirements.find((entry: { id: string }) => entry.id === before.id)).toMatchObject({ status: 'cancelled', progress: cancelled.progress, plannedStart: cancelled.plannedStart, plannedEnd: cancelled.plannedEnd });
    const actions = await app.inject({ url: `/api/action-items?projectId=${before.projectId}`, headers: { cookie } });
    expect(actions.statusCode, actions.body).toBe(200);
    expect(actions.json().items).toEqual([]);
    expect((await cancel(protocol, before)).statusCode).toBe(409);
    expect(await detail(before.id)).toEqual(cancelled);
    const archived = await app.inject({ method: 'DELETE', url: `/api/requirements/${before.id}`, headers: { cookie }, payload: { expectedVersion: cancelled.version } });
    expect(archived.statusCode, archived.body).toBe(200);
    expect(sqlite.prepare('SELECT version, deleted_at AS deletedAt FROM requirements WHERE id=?').get(before.id)).toEqual({
      version: cancelled.version + 1,
      deletedAt: expect.any(String),
    });
    const restored = await post(`/api/requirements/${before.id}/restore`, {});
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json()).toMatchObject({
      status: 'cancelled', progress: cancelled.progress, plannedStart: cancelled.plannedStart,
      plannedEnd: cancelled.plannedEnd, version: cancelled.version + 2,
    });
    const staleArchive = await app.inject({ method: 'DELETE', url: `/api/requirements/${before.id}`, headers: { cookie }, payload: { expectedVersion: cancelled.version } });
    expect(staleArchive.statusCode).toBe(409);
  });
}
