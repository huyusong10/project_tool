import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scryptSync } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { getRequirement, RequirementRecord } from '../src/server/services/requirements';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-manage-deletion-'));
const password = 'temporary-deletion-password-123';
process.env.DB_PATH = path.join(directory, 'test.db');
process.env.BACKUP_DIR = path.join(directory, 'backups');
process.env.WEB_DIST_DIR = path.join(directory, 'web');
process.env.SEED_DEMO = '0';
process.env.NODE_ENV = 'test';
process.env.APP_PASSWORD_HASH = `scrypt$deletion$${scryptSync(password, 'deletion', 64).toString('hex')}`;
process.env.SESSION_SECRET = 'deletion-temporary-test-secret-123456789';
let app: FastifyInstance;
let cookie = '';
let token = '';
let origin = '';
let projectId = '';
let templateId = '';
let ownerId = '';
let sequence = 0;
const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, headers: { cookie }, payload });
const detail = async (id: string) => (await app.inject({ url: `/api/requirements/${id}`, headers: { cookie } })).json<ReturnType<typeof getRequirement>>();
async function createRequirement() {
  const created = await post('/api/requirements', { projectId, ownerId, templateId, title: `删除场景${++sequence}`, plannedStart: '2020-01-02' });
  expect(created.statusCode, created.body).toBe(200);
  return created.json<RequirementRecord>();
}
async function remove(protocol: 'REST' | 'MCP', id: string, expectedVersion: number) {
  if (protocol === 'REST') {
    const response = await app.inject({ method: 'DELETE', url: `/api/work-items/${id}`, headers: { cookie }, payload: { expectedVersion } });
    return { statusCode: response.statusCode, body: response.json() };
  }
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'delete_work_item', arguments: { id, expectedVersion } } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number; result: unknown } } };
  return { statusCode: payload.result.structuredContent.statusCode || 200, body: payload.result.structuredContent.result };
}
beforeAll(async () => {
  app = await (await import('../src/server/app')).buildApp();
  origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password } });
  expect(login.statusCode, login.body).toBe(200);
  cookie = String(login.headers['set-cookie']).split(';')[0];
  token = (await post('/api/tokens', { name: '删除验证' })).json().token;
  projectId = (await post('/api/projects', { name: '删除验证' })).json().id;
  ownerId = (await post('/api/people', { projectId, name: '删除测试负责人' })).json().id;
  templateId = (await post('/api/templates', { projectId, name: '分段计划', items: [
    { title: '实现', startOffsetDays: 0, durationDays: 1, sortOrder: 0 },
    { title: '验收准备', startOffsetDays: 3, durationDays: 2, sortOrder: 1 },
  ] })).json().id;
});
afterAll(async () => {
  await app?.close();
  const { sqlite } = await import('../src/server/database');
  if (sqlite.open) sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

it('工作项排序审计保留所属项目', async () => {
  const requirement = await createRequirement();
  const response = await post(`/api/requirements/${requirement.id}/reorder-work-items`, {
    ids: requirement.workItems!.map((item) => item.id).reverse(), expectedVersion: requirement.version,
  });
  expect(response.statusCode, response.body).toBe(200);
  const { sqlite } = await import('../src/server/database');
  expect(sqlite.prepare("SELECT project_id AS projectId FROM audit_logs WHERE action='reorder' AND entity_id=? ORDER BY rowid DESC LIMIT 1").get(requirement.id)).toEqual({ projectId });
});

for (const protocol of ['REST', 'MCP'] as const) {
  it(`${protocol}删除安全工作项后同步需求计划，只生成一次删除记录`, async () => {
    const before = await createRequirement();
    const item = before.workItems!.at(-1)!;
    const deleted = await remove(protocol, item.id, item.version);
    expect(deleted).toEqual({ statusCode: 200, body: { ok: true } });
    const after = await detail(before.id);
    expect(after.version).toBe(before.version + 1);
    expect(after.workItems).toEqual([before.workItems![0]]);
    expect(after.plannedEnd).toBe(before.workItems![0].plannedEnd);
    expect((await remove(protocol, item.id, item.version)).statusCode).toBe(404);
    const { sqlite } = await import('../src/server/database');
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='delete' AND entity_id=?").get(item.id)).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT project_id AS projectId FROM audit_logs WHERE action='delete' AND entity_id=?").get(item.id)).toEqual({ projectId });
  });

  it(`${protocol}其他工作项的说明不阻止安全删除，旧版本提交不能删除`, async () => {
    const before = await createRequirement();
    const item = before.workItems!.at(-1)!;
    expect((await post(`/api/requirements/${before.id}/progress`, { workItemId: before.workItems![0].id, content: '保留其他工作项说明' })).statusCode).toBe(200);
    const updated = await app.inject({ method: 'PATCH', url: `/api/work-items/${item.id}`, headers: { cookie }, payload: { title: '变更后的验收准备', expectedVersion: item.version } });
    expect(updated.statusCode, updated.body).toBe(200);
    const current = await detail(before.id);
    expect((await remove(protocol, item.id, item.version)).statusCode).toBe(409);
    expect(await detail(before.id)).toEqual(current);
    expect((await remove(protocol, item.id, updated.json().version)).statusCode).toBe(200);
    const after = await detail(before.id);
    expect(after.workItems).toEqual([before.workItems![0]]);
    expect(after.progressUpdates).toEqual(current.progressUpdates);
  });

  it.each(['note', 'blocked_reason', 'cancelled_requirement'])(`${protocol}保留%s历史，不允许删除且不产生部分写入`, async (scenario) => {
    const requirement = await createRequirement();
    const item = requirement.workItems!.at(-1)!;
    const { sqlite } = await import('../src/server/database');
    if (scenario === 'note') {
      const response = await post(`/api/requirements/${requirement.id}/progress`, { workItemId: item.id, content: '尚未开始时的工作说明' });
      expect(response.statusCode, response.body).toBe(200);
    } else if (scenario === 'cancelled_requirement') {
      sqlite.prepare("UPDATE requirements SET status='cancelled' WHERE id=?").run(requirement.id);
    } else {
      // 数据库允许保留阻塞原因，但这类历史记录不能物理删除。
      sqlite.prepare('UPDATE work_items SET blocked_reason=? WHERE id=?').run('等待外部确认', item.id);
    }
    const before = await detail(requirement.id);
    const deleted = await remove(protocol, item.id, item.version);
    expect(deleted.statusCode, JSON.stringify(deleted.body)).toBe(409);
    expect(await detail(requirement.id)).toEqual(before);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='delete' AND entity_id=?").get(item.id)).toEqual({ n: 0 });
  });
}
