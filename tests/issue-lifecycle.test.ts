import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scryptSync } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addBusinessDays, addCalendarDays, businessDaysInclusive, todayIso } from '../src/shared/domain';
import type { AuthorizationActor } from '../src/server/authorization';
import type { IssueRecord } from '../src/server/services/issues';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-manage-issue-lifecycle-'));
const password = 'temporary-issue-lifecycle-password-123';
process.env.DB_PATH = path.join(directory, 'test.db');
process.env.BACKUP_DIR = path.join(directory, 'backups');
process.env.WEB_DIST_DIR = path.join(directory, 'web');
process.env.SEED_DEMO = '0';
process.env.NODE_ENV = 'test';
process.env.APP_PASSWORD_HASH = `scrypt$issue-lifecycle$${scryptSync(password, 'issue-lifecycle', 64).toString('hex')}`;
process.env.SESSION_SECRET = 'issue-lifecycle-temporary-test-secret-123456789';
let app: FastifyInstance;
let cookie = '';
let token = '';
let origin = '';
let projectId = '';
let sequence = 0;
const today = todayIso();
const discoveredAt = addCalendarDays(today, -10);
const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, headers: { cookie }, payload });
const getIssue = async (id: string) => (await app.inject({ url: `/api/issues/${id}`, headers: { cookie } })).json<IssueRecord>();

async function command(protocol: 'REST' | 'MCP', id: string, action: string, input: Record<string, unknown>) {
  if (protocol === 'REST') {
    const response = await post(`/api/issues/${id}/${action}`, input);
    return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
  }
  // MCP使用真实临时socket，避免SDK关闭Fastify模拟socket时产生计时器错误。
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: `${action}_issue`, arguments: { id, ...input } } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number; result?: Record<string, unknown> } & Record<string, unknown> } };
  const content = payload.result.structuredContent;
  return { statusCode: content.statusCode || 200, body: content.result || content };
}

async function createIssue(title = '日期状态校验') {
  const response = await post('/api/issues', { projectId, title, discoveredAt });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<IssueRecord>();
}

it('同毫秒的问题进展按写入顺序展示，列表最近进展与详情一致', async () => {
  const issue = await createIssue('同毫秒历史顺序');
  const { sqlite } = await import('../src/server/database');
  const insert = sqlite.prepare(`INSERT INTO issue_updates
    (id, issue_id, progress, content, event_type, created_at, updated_at) VALUES (?, ?, NULL, ?, 'note', ?, ?)`);
  const instant = `${today}T04:00:00.000Z`;
  // 后写入的UUID刻意更小，不能用随机ID决定“最近”是哪一条。
  insert.run(`zz-${issue.id}`, issue.id, '先写入的说明', instant, instant);
  insert.run(`aa-${issue.id}`, issue.id, '后写入的说明', instant, instant);
  const earlier = `${today}T03:00:00.000Z`;
  insert.run(`later-row-${issue.id}`, issue.id, '更早时间的记录', earlier, earlier);
  const detail = await getIssue(issue.id);
  expect(detail.updates?.map((update) => update.content)).toEqual(['后写入的说明', '先写入的说明', '更早时间的记录']);
  expect(detail.latestUpdate).toBe('后写入的说明');
  const list = (await app.inject({ url: `/api/issues?projectId=${projectId}`, headers: { cookie } })).json();
  expect(list.items.find((entry: IssueRecord) => entry.id === issue.id)).toMatchObject({ latestUpdate: '后写入的说明', latestUpdateAt: instant });
});

it('问题列表的逾期标签与同一次查询的业务日期一致', async () => {
  const dueDate = addBusinessDays(today, -2);
  const created = await post('/api/issues', { projectId, title: '业务日期一致性', discoveredAt: addBusinessDays(dueDate, -1), dueDate });
  expect(created.statusCode, created.body).toBe(200);
  const issue = created.json<IssueRecord>();
  const { listIssues } = await import('../src/server/services/issues');
  expect(listIssues({ projectId }, addBusinessDays(dueDate, -1)).items.find((item) => item.id === issue.id)?.overdue).toBe(false);
  expect(listIssues({ projectId }, today).items.find((item) => item.id === issue.id)?.overdue).toBe(true);
  const { listActionItems } = await import('../src/server/services/actions');
  const actor: AuthorizationActor = {
    type: 'user', id: 'date-consistency-admin', label: 'date-consistency-admin',
    accountId: 'date-consistency-admin', personId: null, globalRole: 'admin',
  };
  const beforeDue = listActionItems({ projectId }, actor, undefined, addBusinessDays(dueDate, -1)).items.find((item) => item.sourceId === issue.id);
  const afterDue = listActionItems({ projectId }, actor, undefined, today).items.find((item) => item.sourceId === issue.id);
  expect(beforeDue?.reasonCodes).toEqual(['unassigned']);
  expect(afterDue?.reasonCodes).toHaveLength(2);
  expect(afterDue?.reasonCodes).toEqual(expect.arrayContaining(['unassigned', 'overdue']));
});

async function metrics() {
  const response = await post('/api/analytics/query', { projectId, range: { from: discoveredAt, to: today }, panels: [
    { id: 'resolved', title: '闭环问题', dataset: 'issues', measure: 'resolved_count', visualization: 'kpi', size: 'small', timeScope: 'range' },
    { id: 'average', title: '平均闭环周期', dataset: 'issues', measure: 'average_resolution_days', visualization: 'kpi', size: 'small', timeScope: 'range' },
  ] });
  expect(response.statusCode, response.body).toBe(200);
  const results = response.json().results as Array<{ panelId: string; rows: Array<{ value: number }>; error?: string }>;
  expect(results.every((result) => !result.error)).toBe(true);
  return Object.fromEntries(results.map((result) => [result.panelId, result.rows[0].value]));
}

async function actionIds() {
  const response = await app.inject({ url: `/api/action-items?projectId=${projectId}`, headers: { cookie } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().items.map((item: { id: string }) => item.id) as string[];
}

beforeAll(async () => {
  app = await (await import('../src/server/app')).buildApp();
  origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password } });
  expect(login.statusCode, login.body).toBe(200);
  cookie = String(login.headers['set-cookie']).split(';')[0];
  token = (await post('/api/tokens', { name: '问题生命周期验证' })).json().token;
});

beforeEach(async () => {
  const project = await post('/api/projects', { name: `问题生命周期${++sequence}` });
  expect(project.statusCode, project.body).toBe(200);
  projectId = project.json().id;
});

afterAll(async () => {
  await app?.close();
  const { sqlite } = await import('../src/server/database');
  if (sqlite.open) sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

for (const protocol of ['REST', 'MCP'] as const) {
  it(`${protocol}：问题状态命令拒绝会被静默忽略的字段`, async () => {
    const resolveTarget = await createIssue(`解决命令字段-${protocol}`);
    expect((await command(protocol, resolveTarget.id, 'resolve', {
      expectedVersion: resolveTarget.version, content: '确认闭环', progress: 20,
    })).statusCode).toBe(400);
    expect(await getIssue(resolveTarget.id)).toEqual(resolveTarget);
    expect((await command(protocol, resolveTarget.id, 'resolve', {
      expectedVersion: resolveTarget.version, content: '确认闭环', resolution: '拼错的闭环字段',
    })).statusCode).toBe(400);
    expect(await getIssue(resolveTarget.id)).toEqual(resolveTarget);

    const deferTarget = await createIssue(`挂起命令字段-${protocol}`);
    expect((await command(protocol, deferTarget.id, 'defer', {
      expectedVersion: deferTarget.version, reason: '暂时挂起', content: '不会生效的另一段说明',
    })).statusCode).toBe(400);
    expect(await getIssue(deferTarget.id)).toEqual(deferTarget);
  });

  it.each(['in_progress', 'deferred'])(`${protocol}：%s问题不能通过纠错伪造解决日期`, async (status) => {
    let issue = await createIssue();
    if (status === 'deferred') {
      expect((await command(protocol, issue.id, 'defer', { expectedVersion: issue.version, reason: '暂时挂起' })).statusCode).toBe(200);
      issue = await getIssue(issue.id);
    }
    const response = await command(protocol, issue.id, 'correct', { expectedVersion: issue.version, reason: '修正说明', resolvedAt: today });
    expect(response.statusCode, JSON.stringify(response.body)).toBe(400);
    expect(await getIssue(issue.id)).toEqual(issue);
    expect(await metrics()).toEqual({ resolved: 0, average: 0 });
    expect(await actionIds()).toContain(`issue:${issue.id}`);
  });

  it(`${protocol}：解决、历史日期纠错和重开同步更新详情、分析和行动项`, async () => {
    let issue = await createIssue();
    expect((await command(protocol, issue.id, 'resolve', { expectedVersion: issue.version, content: '处理完成' })).statusCode).toBe(200);
    issue = await getIssue(issue.id);
    expect(issue).toMatchObject({ status: 'resolved', resolvedAt: today, progress: 100 });
    expect(await actionIds()).not.toContain(`issue:${issue.id}`);
    for (const resolvedAt of [addCalendarDays(discoveredAt, -1), addCalendarDays(today, 1)]) {
      const rejected = await command(protocol, issue.id, 'correct', { expectedVersion: issue.version, reason: '更正解决日期', resolvedAt });
      expect(rejected.statusCode, JSON.stringify(rejected.body)).toBe(400);
      expect(await getIssue(issue.id)).toEqual(issue);
    }
    const resolvedAt = addCalendarDays(today, -2);
    expect((await command(protocol, issue.id, 'correct', { expectedVersion: issue.version, reason: '补齐真实闭环时间', resolvedAt })).statusCode).toBe(200);
    issue = await getIssue(issue.id);
    expect(issue).toMatchObject({ status: 'resolved', resolvedAt, progress: 100 });
    expect(await metrics()).toEqual({ resolved: 1, average: businessDaysInclusive(discoveredAt, resolvedAt) });
    expect((await command(protocol, issue.id, 'reopen', { expectedVersion: issue.version, reason: '验证时重新出现', progress: 20 })).statusCode).toBe(200);
    expect(await getIssue(issue.id)).toMatchObject({ status: 'in_progress', progress: 20, resolvedAt: null });
    expect(await metrics()).toEqual({ resolved: 0, average: 0 });
    expect(await actionIds()).toContain(`issue:${issue.id}`);
  });

  it(`${protocol}：未来发现的问题不能产生早于发现日期的解决记录`, async () => {
    const created = await post('/api/issues', { projectId, title: '未来发现日期', discoveredAt: addCalendarDays(today, 1) });
    expect(created.statusCode, created.body).toBe(200);
    const issue = created.json<IssueRecord>();
    const rejected = await command(protocol, issue.id, 'resolve', { expectedVersion: issue.version, content: '确认解决' });
    expect(rejected.statusCode, JSON.stringify(rejected.body)).toBe(400);
    expect(await getIssue(issue.id)).toEqual(issue);
    const corrected = await app.inject({ method: 'PATCH', url: `/api/issues/${issue.id}`, headers: { cookie }, payload: { expectedVersion: issue.version, discoveredAt } });
    expect(corrected.statusCode, corrected.body).toBe(200);
    expect((await command(protocol, issue.id, 'resolve', { expectedVersion: corrected.json().version, content: '修正发现日期后解决' })).statusCode).toBe(200);
  });
}

it('可以修复过去已写入的错误解决日期，原始历史保持不变', async () => {
  const issue = await createIssue('历史解决日期不一致');
  expect((await command('REST', issue.id, 'resolve', { expectedVersion: issue.version, content: '原始解决说明' })).statusCode).toBe(200);
  const { sqlite } = await import('../src/server/database');
  sqlite.prepare('UPDATE issues SET resolved_at=? WHERE id=?').run(addCalendarDays(discoveredAt, -1), issue.id);
  const before = await getIssue(issue.id);
  expect((await command('REST', issue.id, 'correct', { expectedVersion: before.version, reason: '修复历史日期', resolvedAt: today })).statusCode).toBe(200);
  const after = await getIssue(issue.id);
  expect(after).toMatchObject({ status: 'resolved', progress: 100, resolvedAt: today });
  expect(after.updates).toEqual(expect.arrayContaining(before.updates!));
  expect(after.updates).toHaveLength(before.updates!.length + 1);
  expect(await metrics()).toEqual({ resolved: 1, average: businessDaysInclusive(discoveredAt, today) });
});

for (const protocol of ['REST', 'MCP'] as const) {
  it(`${protocol}：问题说明显式提交版本时拒绝旧版本写入`, async () => {
    const issue = await createIssue(`说明版本校验-${protocol}`);
    const input = { content: '带显式版本的问题说明', expectedVersion: issue.version + 1 };
    let statusCode: number;
    if (protocol === 'REST') {
      statusCode = (await post(`/api/issues/${issue.id}/updates`, input)).statusCode;
    } else {
      const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
        authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
      }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
        name: 'add_issue_update', arguments: { id: issue.id, ...input },
      } }) });
      const payload = await response.json() as { result: { structuredContent: { statusCode?: number } } };
      statusCode = payload.result.structuredContent.statusCode || response.status;
    }
    expect(statusCode).toBe(409);
    expect(await getIssue(issue.id)).toEqual(issue);
  });
}
