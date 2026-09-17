import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, scryptSync } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Dashboard, MyWork, Requirement } from '../src/client/types';
import { dailyProgressTrend } from '../src/client/progress-trend';
import { todayIso } from '../src/shared/domain';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-manage-history-order-'));
const password = 'temporary-history-order-password';
process.env.DB_PATH = path.join(directory, 'test.db');
process.env.BACKUP_DIR = path.join(directory, 'backups');
process.env.WEB_DIST_DIR = path.join(directory, 'web');
process.env.SEED_DEMO = '0';
process.env.NODE_ENV = 'test';
process.env.APP_PASSWORD_HASH = `scrypt$history-order$${scryptSync(password, 'history-order', 64).toString('hex')}`;
process.env.SESSION_SECRET = 'history-order-temporary-session-secret-123456789';
let app: FastifyInstance;
let origin = '';
let adminCookie = '';
let memberCookie = '';
let memberPersonId = '';
let token = '';
let projectId = '';
let requirementId = '';
let siblingId = '';
const expectedPrimary: string[] = [];
const expectedAll: string[] = [];
const post = (url: string, payload: Record<string, unknown>, cookie = adminCookie) => app.inject({ method: 'POST', url, headers: { cookie }, payload });
const cookieOf = (response: { headers: Record<string, unknown> }) => String(response.headers['set-cookie']).split(';')[0];

async function read<T>(protocol: 'REST' | 'MCP', url: string, tool: string, args: Record<string, unknown> = {}): Promise<T> {
  if (protocol === 'REST') {
    const response = await app.inject({ url, headers: { cookie: memberCookie } });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<T>();
  }
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }) });
  expect(response.status).toBe(200);
  const body = await response.json() as { result: { isError?: boolean; structuredContent: { result: T } } };
  expect(body.result.isError).not.toBe(true);
  return body.result.structuredContent.result;
}

beforeAll(async () => {
  app = await (await import('../src/server/app')).buildApp();
  origin = await app.listen({ host: '127.0.0.1', port: 0 });
  adminCookie = cookieOf(await post('/api/login', { username: 'admin', password }));
  projectId = (await post('/api/projects', { name: '历史排序验证' })).json().id;
  const person = (await post('/api/people', { projectId, name: '历史排序成员' })).json();
  memberPersonId = person.id;
  memberCookie = cookieOf(await post('/api/login', { username: person.name, password: '888888' }));
  memberCookie = cookieOf(await post('/api/account/change-password', { currentPassword: '888888', newPassword: password }, memberCookie));
  token = (await post('/api/tokens', { name: '历史排序验证' }, memberCookie)).json().token;
  const session = (await app.inject({ url: '/api/session', headers: { cookie: memberCookie } })).json();
  requirementId = (await post('/api/requirements', { projectId, title: '主要需求' })).json().id;
  siblingId = (await post('/api/requirements', { projectId, title: '另一条需求' })).json().id;
  const foreignProject = (await post('/api/projects', { name: '不可见的项目' })).json().id;
  const foreignRequirement = (await post('/api/requirements', { projectId: foreignProject, title: '不可见需求' })).json().id;
  const { sqlite } = await import('./support/database');
  const insert = sqlite.prepare(`INSERT INTO progress_updates
    (id, requirement_id, percent, content, event_type, created_by_account_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'note', ?, ?, ?)`);
  const instant = '2026-09-03T12:00:00.000Z';
  // 随机ID与写入顺序相反，同时交错两条需求，覆盖三个位置的截取限制。
  for (let index = 9; index >= 0; index -= 1) {
    const id = `reverse-${index}`;
    insert.run(id, requirementId, 90 - index * 10, `记录${id}`, session.accountId, instant, instant);
    expectedPrimary.unshift(id); expectedAll.unshift(id);
    if (index === 1) {
      insert.run('sibling', siblingId, 5, '另一条需求的记录', session.accountId, instant, instant);
      expectedAll.unshift('sibling');
    }
  }
  insert.run('late-old-time', requirementId, 0, '早时间晚写入', session.accountId, '2026-09-02T12:00:00.000Z', instant);
  expectedPrimary.push('late-old-time');
  insert.run('inaccessible', foreignRequirement, 0, '不能泄露', session.accountId, '2026-09-04T12:00:00.000Z', instant);
});

afterAll(async () => {
  await app?.close();
  const { sqlite } = await import('./support/database');
  if (sqlite.open) sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

for (const protocol of ['REST', 'MCP'] as const) {
  it(`${protocol}详情历史与每天最终进度使用同一个事件顺序`, async () => {
    const detail = await read<Requirement>(protocol, `/api/requirements/${requirementId}`, 'get_requirement', { id: requirementId });
    expect(detail.progressUpdates?.map((entry) => entry.id)).toEqual(expectedPrimary);
    expect(dailyProgressTrend(detail.progressUpdates || [])).toEqual([
      { date: '2026-09-02', actualProgress: 0 }, { date: '2026-09-03', actualProgress: 90 },
    ]);
  });

  it(`${protocol}主页每条需求只取最近三条且不会被随机ID挤掉`, async () => {
    const dashboard = await read<Dashboard>(protocol, `/api/dashboard?projectId=${projectId}`, 'dashboard_summary', { projectId });
    expect(dashboard.asOfDate).toBe(todayIso());
    const recent = dashboard.requirements.find((entry) => entry.id === requirementId)!.recentProgressUpdates!;
    expect(recent.map((entry) => entry.id)).toEqual(expectedPrimary.slice(0, 3));
    expect(recent.map((entry) => entry.eventType)).toEqual(['note', 'note', 'note']);
    expect(Object.keys(recent[0])).not.toContain('writeOrder');
    expect(dashboard.requirements.find((entry) => entry.id === siblingId)!.recentProgressUpdates!.map((entry) => entry.id)).toEqual(['sibling']);
  });

  it(`${protocol}我的工作按同时间写入顺序取最近八条，仍过滤无权项目`, async () => {
    const mine = await read<MyWork>(protocol, '/api/my-work', 'get_my_work');
    expect(mine.asOfDate).toBe(todayIso());
    expect(mine.recentProgress.map((entry) => entry.id)).toEqual(expectedAll.slice(0, 8));
    expect(mine.recentProgress.map((entry) => entry.eventType)).toEqual(Array(8).fill('note'));
  });
}

it('我的工作对超过900条负责需求分块统计问题行动且不漏首尾批次', async () => {
  const { sqlite } = await import('./support/database');
  const now = new Date().toISOString();
  const requirementIds = Array.from({ length: 901 }, () => randomUUID());
  const insertRequirement = sqlite.prepare(`INSERT INTO requirements
    (id,project_id,title,owner_id,status,progress,risk_level,priority,created_at,updated_at)
    VALUES (?, ?, ?, ?, 'not_started', 0, 'low', 'P2', ?, ?)`);
  const insertIssue = sqlite.prepare(`INSERT INTO issues
    (id,project_id,requirement_id,title,status,priority,progress,discovered_at,created_at,updated_at)
    VALUES (?, ?, ?, ?, 'in_progress', 'P2', 0, '2026-09-03', ?, ?)`);
  sqlite.transaction(() => {
    requirementIds.forEach((id, index) => insertRequirement.run(id, projectId, `分块负责需求 ${index + 1}`, memberPersonId, now, now));
    insertIssue.run(randomUUID(), projectId, requirementIds[0], '首批未分派问题', now, now);
    insertIssue.run(randomUUID(), projectId, requirementIds.at(-1), '尾批未分派问题', now, now);
  })();

  const originalPrepare = sqlite.prepare.bind(sqlite);
  const parameterCounts: number[] = [];
  sqlite.prepare = ((...args: Parameters<typeof sqlite.prepare>) => {
    const sql = String(args[0]);
    if (sql.includes(' IN (')) parameterCounts.push(sql.match(/\?/g)?.length || 0);
    return originalPrepare(...args);
  }) as typeof sqlite.prepare;
  let response;
  try {
    response = await app.inject({ url: '/api/my-work', headers: { cookie: memberCookie } });
  } finally {
    sqlite.prepare = originalPrepare as typeof sqlite.prepare;
  }

  expect(response.statusCode, response.body).toBe(200);
  const owned = response.json<MyWork>().requirements.filter((item) => item.title.startsWith('分块负责需求'));
  expect(owned).toHaveLength(901);
  expect(owned.find((item) => item.id === requirementIds[0])?.actionCount).toBe(2);
  expect(owned.find((item) => item.id === requirementIds.at(-1))?.actionCount).toBe(2);
  expect(Math.max(...parameterCounts)).toBeLessThanOrEqual(900);
});
