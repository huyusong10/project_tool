import {listenTestApp} from './support/listen';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { RequirementRecord, WorkItemRecord } from '../src/server/services/requirements';
import type { Requirement } from '../src/client/types';
import { addCalendarDays, todayIso } from '../src/shared/domain';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'history-completion-'));
process.env.DB_PATH = path.join(directory, 'test.db');
process.env.BACKUP_DIR = path.join(directory, 'backups');
process.env.SEED_DEMO = '0';
process.env.APP_PASSWORD_HASH = 'scrypt$4c63a6f93ff4f94b031b7e7583592177$b598dbddaf9dd06678ff8756923d9e0a7f2d68eaa45bc644fbf4a73c9298970c7489671dfcfc8be282022c26a3370fb040f3f086a45faa1e1abde04bbe4a51ef';
process.env.SESSION_SECRET = 'history-completion-test-session-secret-123456789';
let app: FastifyInstance;
let origin = '';
let cookie = '';
let projectId = '';
let token = '';

const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, headers: { cookie }, payload });
async function createHistory() {
  const created = await post('/api/requirements', {templateId: await defaultTemplate(projectId),  projectId, title: '历史需求', plannedStart: '2020-01-02' });
  expect(created.statusCode, created.body).toBe(200);
  return created.json<RequirementRecord>();
}
async function getRequirement(id: string) {
  return (await app.inject({ method: 'GET', url: `/api/requirements/${id}`, headers: { cookie } })).json<RequirementRecord>();
}
async function mcp(name: string, args: Record<string, unknown>, bearer = token) {
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${bearer}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  const body = await response.text();
  expect(response.status, body).toBe(200);
  return JSON.parse(body).result;
}

beforeAll(async () => {
  app = await (await import('../src/server/app')).buildApp();
  origin = await listenTestApp(app);
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: '41_xc7q0qOjo4Inw!' } });
  cookie = String(login.headers['set-cookie']).split(';')[0];
  projectId = (await post('/api/projects', { name: '历史补录测试' })).json().id;
  token = (await post('/api/tokens', { name: '历史补录测试' })).json().token;
});

afterAll(async () => {
  await app?.close();
  const { sqlite } = await import('./support/database');
  if (sqlite.open) sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

it('重新排期保存前后日期和说明，重复提交不追加记录，说明不阻止未执行需求重选流程', async () => {
  const before = await createHistory();
  const changed = await post(`/api/requirements/${before.id}/reschedule`, {
    expectedVersion: before.version, scheduleMode: 'start', plannedStart: '2026-09-22', reason: '客户调整交付日期。',
  });
  expect(changed.statusCode, changed.body).toBe(200);
  const after = changed.json<Requirement>();
  expect(after.progressUpdates).toHaveLength(1);
  expect(after.progressUpdates![0]).toMatchObject({ eventType: 'note', workItemId: null, percent: before.progress, createdByName: 'admin' });
  const content = after.progressUpdates![0].content;
  for (const value of [before.plannedStart, before.plannedEnd, after.plannedStart, after.plannedEnd, '客户调整交付日期。']) expect(content).toContain(value!);
  for (const item of after.workItems!) expect(item).toMatchObject({ status: 'not_started', progress: 0, actualStart: null, actualEnd: null });
  const repeated = await post(`/api/requirements/${before.id}/reschedule`, { expectedVersion: after.version, scheduleMode: 'start', plannedStart: after.plannedStart, reason: '相同日期不重复记事' });
  expect(repeated.statusCode, repeated.body).toBe(200);
  expect(repeated.json().progressUpdates).toEqual(after.progressUpdates);
  const stale = await post(`/api/requirements/${before.id}/reschedule`, { expectedVersion: before.version, scheduleMode: 'start', plannedStart: '2026-09-23', reason: '过期修改' });
  expect(stale.statusCode).toBe(409);
  expect((await app.inject({ url: `/api/requirements/${before.id}`, headers: { cookie } })).json<Requirement>().progressUpdates).toEqual(after.progressUpdates);
  const nextTemplate = await post('/api/templates', { projectId, name: '排期后重选流程', items: [{ title: '新工作', startOffsetDays: 0, durationDays: 1, sortOrder: 0 }] });
  const replaced = await post(`/api/requirements/${before.id}/reselect-template`, { expectedVersion: after.version, scheduleMode: 'start', templateId: nextTemplate.json().id, plannedStart: '2026-09-22', confirmTemplateReset: true });
  expect(replaced.statusCode, replaced.body).toBe(200);
  expect(replaced.json().progressUpdates).toEqual(after.progressUpdates);
});

it('按计划补录工作项、整条需求原子完成，重复提交不生成记录，按工作日期计入完成趋势', async () => {
  const { sqlite } = await import('./support/database');
  let requirement = await createHistory();
  const first = requirement.workItems![0];
  const completed = await post(`/api/work-items/${first.id}/complete-as-planned`, { expectedVersion: first.version });
  expect(completed.statusCode, completed.body).toBe(200);
  expect(completed.json()).toMatchObject({ status: 'completed', progress: 100, actualStart: first.plannedStart, actualEnd: first.plannedEnd });
  requirement = await getRequirement(requirement.id);
  expect(requirement.progress).toBeLessThan(100);
  expect(sqlite.prepare(`SELECT percent, work_item_percent AS workItemPercent FROM progress_updates
    WHERE requirement_id=? AND work_item_id=? AND event_type='complete'`).get(requirement.id, first.id))
    .toEqual({ percent: requirement.progress, workItemPercent: 100 });
  const cancelled = requirement.workItems!.at(-1)!;
  expect((await post(`/api/work-items/${cancelled.id}/cancel`, { expectedVersion: cancelled.version, reason: '取消历史范围' })).statusCode).toBe(200);
  requirement = await getRequirement(requirement.id);
  const result = await post(`/api/requirements/${requirement.id}/complete-as-planned`, { expectedVersion: requirement.version });
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json()).toMatchObject({ status: 'completed', progress: 100 });
  expect(withoutForecastRevision(result.json().workItems.find((item: { id: string }) => item.id === first.id))).toEqual(withoutForecastRevision(completed.json()));
  expect(result.json().workItems.find((item: { id: string }) => item.id === cancelled.id).status).toBe('cancelled');
  const repeated = await post(`/api/requirements/${requirement.id}/complete-as-planned`, { expectedVersion: requirement.version });
  expect(repeated.statusCode).toBe(409);
  expect((await getRequirement(requirement.id))).toEqual(result.json());
  const dashboard = await app.inject({ method: 'GET', url: `/api/dashboard?projectId=${projectId}`, headers: { cookie } });
  expect(dashboard.json().summary.completed).toBe(1);
  expect(dashboard.json().charts.weeks.reduce((sum:number,week:{completed:number})=>sum+week.completed,0)).toBe(0);
});

it('缺排期、未来计划和已有执行记录均拒绝，整条补录失败不会部分写入', async () => {
  const { sqlite } = await import('./support/database');
  const requirement = await createHistory();
  const item = requirement.workItems!.at(-1)!;
  for (const scenario of ['missing', 'future', 'executed']) {
    sqlite.prepare('UPDATE work_items SET planned_end=?, actual_start=?, status=?, progress=? WHERE id=?').run(
      scenario === 'missing' ? null : scenario === 'future' ? addCalendarDays(todayIso(), 30) : item.plannedEnd,
      scenario === 'executed' ? item.plannedStart : null, scenario === 'executed' ? 'in_progress' : 'not_started', scenario === 'executed' ? 20 : 0, item.id,
    );
    const before = await getRequirement(requirement.id);
    const result = await post(`/api/requirements/${requirement.id}/complete-as-planned`, { expectedVersion: before.version });
    expect(result.statusCode, result.body).toBe(scenario === 'missing' ? 400 : 409);
    expect(await getRequirement(requirement.id)).toEqual(before);
  }
});

it('调整旧版非工作日排期时以需求锚点统一重算', async () => {
  const { sqlite } = await import('./support/database');
  const requirement = await createHistory();
  const retained = requirement.workItems![0];
  sqlite.prepare('DELETE FROM work_items WHERE requirement_id=? AND id<>?').run(requirement.id, retained.id);
  sqlite.prepare(`UPDATE work_items SET planned_start='2026-09-04', planned_end='2026-09-06' WHERE id=?`).run(retained.id);
  const before = await getRequirement(requirement.id);
  expect(before).toMatchObject({ plannedStart: '2026-09-04', plannedEnd: '2026-09-06' });

  const aligned = await post(`/api/requirements/${requirement.id}/reschedule`, {
    scheduleMode: 'deadline', plannedEnd: '2026-09-04', expectedVersion: before.version,
  });
  expect(aligned.statusCode, aligned.body).toBe(200);
  expect(aligned.json<RequirementRecord>()).toMatchObject({ plannedStart: '2026-09-04', plannedEnd: '2026-09-04' });

  const adjusted = await post(`/api/requirements/${requirement.id}/reschedule`, {
    scheduleMode: 'deadline', plannedEnd: '2026-09-11', expectedVersion: aligned.json<RequirementRecord>().version,
  });
  expect(adjusted.statusCode, adjusted.body).toBe(200);
  expect(adjusted.json<RequirementRecord>()).toMatchObject({ plannedStart: '2026-09-11', plannedEnd: '2026-09-11' });
  expect(adjusted.json<RequirementRecord>().workItems).toEqual([
    expect.objectContaining({ id: retained.id, plannedStart: '2026-09-11', plannedEnd: '2026-09-11' }),
  ]);
});

it('整体调期不改写已取消工作项的历史计划', async () => {
  let requirement = await createHistory();
  const cancelledSource = requirement.workItems!.at(-1)!;
  const cancelled = await post(`/api/work-items/${cancelledSource.id}/cancel`, {
    expectedVersion: cancelledSource.version, reason: '保留取消时的历史计划',
  });
  expect(cancelled.statusCode, cancelled.body).toBe(200);
  const cancelledSnapshot = cancelled.json<WorkItemRecord>();
  requirement = await getRequirement(requirement.id);
  const activeBefore = requirement.workItems!.find((item) => item.status !== 'cancelled')!;

  const adjusted = await post(`/api/requirements/${requirement.id}/reschedule`, {
    scheduleMode: 'start', plannedStart: '2020-03-02', expectedVersion: requirement.version,
    reason: '调整剩余有效工作项计划',
  });
  expect(adjusted.statusCode, adjusted.body).toBe(200);
  expect(withoutForecastRevision(adjusted.json<RequirementRecord>().workItems!.find((item) => item.id === cancelledSnapshot.id)!)).toEqual(withoutForecastRevision(cancelledSnapshot));
  expect(adjusted.json<RequirementRecord>().workItems!.find((item) => item.id === activeBefore.id)?.plannedStart)
    .not.toBe(activeBefore.plannedStart);
});

it('未开始工作项的非执行纠错不阻止历史补录', async () => {
  const requirement = await createHistory();
  const item = requirement.workItems![0];
  const corrected = await post(`/api/work-items/${item.id}/correct`, {
    expectedVersion: item.version,
    title: `${item.title}（修正）`,
    reason: '修正历史工作项标题',
  });
  expect(corrected.statusCode, corrected.body).toBe(200);
  const afterCorrection = await getRequirement(requirement.id);
  const rescheduled = await post(`/api/requirements/${requirement.id}/reschedule`, {
    expectedVersion: afterCorrection.version,
    scheduleMode: 'start',
    plannedStart: '2020-01-03',
  });
  expect(rescheduled.statusCode, rescheduled.body).toBe(200);
  const rescheduledItem = rescheduled.json<RequirementRecord>().workItems!.find((entry) => entry.id === item.id)!;
  const completed = await post(`/api/work-items/${item.id}/complete-as-planned`, {
    expectedVersion: rescheduledItem.version,
  });
  expect(completed.statusCode, completed.body).toBe(200);
  expect(completed.json()).toMatchObject({ status: 'completed', progress: 100, actualStart: rescheduledItem.plannedStart, actualEnd: rescheduledItem.plannedEnd });
});

it('全部工作项已完成后不能重复补录', async () => {
  let requirement = await createHistory();
  for (const initial of requirement.workItems!) {
    const current = requirement.workItems!.find((item) => item.id === initial.id)!;
    const completed = await post(`/api/work-items/${current.id}/complete-as-planned`, { expectedVersion: current.version });
    expect(completed.statusCode, completed.body).toBe(200);
    requirement = await getRequirement(requirement.id);
  }
  expect(requirement.status).toBe('completed');
  const result = await post(`/api/requirements/${requirement.id}/complete-as-planned`, { expectedVersion: requirement.version });
  expect(result.statusCode, result.body).toBe(409);
  expect((await getRequirement(requirement.id)).status).toBe('completed');
});

it('REST/MCP共用补录规则，普通成员不能补录', async () => {
  const requirement = await createHistory();
  const item = requirement.workItems![0];
  const done = await mcp('complete_work_item_as_planned', { id: item.id, expectedVersion: item.version });
  expect(done.structuredContent.result).toMatchObject({ status: 'completed', actualEnd: item.plannedEnd });
  const stale = await mcp('complete_work_item_as_planned', { id: item.id, expectedVersion: item.version });
  expect(stale.structuredContent.statusCode).toBe(409);
  const current = await getRequirement(requirement.id);
  const accepted = await mcp('complete_requirement_as_planned', { id: current.id, expectedVersion: current.version });
  expect(accepted.structuredContent.result.status).toBe('completed');

  await post('/api/people', { projectId, name: '补录普通成员' });
  const login = await post('/api/login', { username: '补录普通成员', password: '888888' });
  let memberCookie = String(login.headers['set-cookie']).split(';')[0];
  const changed = await app.inject({ method: 'POST', url: '/api/account/change-password', headers: { cookie: memberCookie }, payload: { currentPassword: '888888', newPassword: 'member-history-password-123' } });
  memberCookie = String(changed.headers['set-cookie']).split(';')[0];
  const memberToken = (await app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie: memberCookie }, payload: { name: '成员测试' } })).json().token;
  for (const [source, id, tool] of [['requirements', current.id, 'complete_requirement_as_planned'], ['work-items', item.id, 'complete_work_item_as_planned']]) {
    const rest = await app.inject({ method: 'POST', url: `/api/${source}/${id}/complete-as-planned`, headers: { cookie: memberCookie }, payload: { expectedVersion: 1 } });
    expect(rest.statusCode, rest.body).toBe(403);
    const denied = await mcp(tool, { id, expectedVersion: 1 }, memberToken);
    expect(denied.structuredContent.statusCode).toBe(403);
  }
});

it('200个工作项整单补录保持常量级查询准备并写全事件和审计', async () => {
  const { sqlite } = await import('./support/database');
  const requirement = await createHistory();
  const now = new Date().toISOString();
  sqlite.prepare('DELETE FROM work_items WHERE requirement_id=?').run(requirement.id);
  const insert = sqlite.prepare(`INSERT INTO work_items
    (id,requirement_id,title,status,planned_start,planned_end,progress,sort_order,version,created_at,updated_at)
    VALUES (?, ?, ?, 'not_started', '2020-01-02', '2020-01-03', 0, ?, 1, ?, ?)`);
  sqlite.transaction(() => {
    for (let index = 0; index < 200; index += 1) insert.run(randomUUID(), requirement.id, `批量历史工作项 ${index + 1}`, index, now, now);
  })();
  const current = await getRequirement(requirement.id);

  const originalPrepare = sqlite.prepare.bind(sqlite);
  let prepareCount = 0;
  sqlite.prepare = ((...args: Parameters<typeof sqlite.prepare>) => {
    prepareCount += 1;
    return originalPrepare(...args);
  }) as typeof sqlite.prepare;
  let completed;
  try {
    completed = await post(`/api/requirements/${requirement.id}/complete-as-planned`, { expectedVersion: current.version });
  } finally {
    sqlite.prepare = originalPrepare as typeof sqlite.prepare;
  }

  expect(completed.statusCode, completed.body).toBe(200);
  expect(completed.json<RequirementRecord>()).toMatchObject({ status: 'completed', progress: 100, version: current.version + 1 });
  expect(completed.json<RequirementRecord>().workItems).toHaveLength(200);
  // Delivery metrics now read the complete project graph on command boundaries.
  expect(prepareCount).toBeLessThan(85);
  expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM progress_updates
    WHERE requirement_id=? AND work_item_id IS NOT NULL AND event_type='complete'`).get(requirement.id)).toEqual({ count: 200 });
  expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE project_id=? AND entity_type='work_item' AND action='complete'
      AND entity_id IN (SELECT id FROM work_items WHERE requirement_id=?)`).get(projectId, requirement.id)).toEqual({ count: 200 });
});

async function defaultTemplate(projectId:string){const response=await app.inject({url:"/api/templates?projectId="+projectId,headers:{cookie}});return response.json<Array<{id:string}>>()[0].id;}
import { withoutForecastRevision } from './fixtures/forecast-snapshot';
