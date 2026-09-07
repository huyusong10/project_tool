import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addBusinessDays, todayIso } from '../src/shared/domain';

const dbPath = path.join(process.cwd(), 'data', `deep-regressions-${randomUUID()}.db`);
const backupDir = path.join(process.cwd(), 'data', `deep-regressions-backups-${randomUUID()}`);
process.env.DB_PATH = dbPath;
process.env.BACKUP_DIR = backupDir;
process.env.SEED_DEMO = '0';
process.env.APP_PASSWORD_HASH = 'scrypt$4c63a6f93ff4f94b031b7e7583592177$b598dbddaf9dd06678ff8756923d9e0a7f2d68eaa45bc644fbf4a73c9298970c7489671dfcfc8be282022c26a3370fb040f3f086a45faa1e1abde04bbe4a51ef';
process.env.SESSION_SECRET = 'deep-regression-test-session-secret-123456789';

let app: FastifyInstance;
let origin = '';
let adminCookie = '';
let memberCookie = '';
let projectId = '';
let templateId = '';
let personId = '';
let requirementId = '';
let workItemId = '';
let issueId = '';

function cookieOf(response: { headers: Record<string, unknown> }) {
  const value = response.headers['set-cookie'];
  return String(Array.isArray(value) ? value[0] : value).split(';')[0];
}

beforeAll(async () => {
  // 归档后的单日负载校验应始终覆盖一个工作日。
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-04T04:00:00Z') });
  const module = await import('../src/server/app');
  app = await module.buildApp();
  await app.ready();
  origin = await app.listen({ host: '127.0.0.1', port: 0 });
  adminCookie = cookieOf(await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: '41_xc7q0qOjo4Inw!' } }));
  const project = await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie: adminCookie }, payload: { name: '深度回归项目' } });
  projectId = project.json().id;
  const person = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie: adminCookie }, payload: {
    projectId, name: '深测负责人', jobTitle: '测试',
  } });
  personId = person.json().id;
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: '深测负责人', password: '888888' } });
  const initialCookie = cookieOf(login);
  const changed = await app.inject({ method: 'POST', url: '/api/account/change-password', headers: { cookie: initialCookie }, payload: {
    currentPassword: '888888', newPassword: 'deep-owner-password-123',
  } });
  memberCookie = cookieOf(changed);
  const template = await app.inject({ method: 'POST', url: '/api/templates', headers: { cookie: adminCookie }, payload: {
    projectId, name: '单工作项流程', items: [{ title: '实现', startOffsetDays: 0, durationDays: 3, sortOrder: 0 }],
  } });
  templateId = template.json().id;
});

afterAll(async () => {
  vi.useRealTimers();
  await app.close();
  const { sqlite } = await import('../src/server/database');
  if (sqlite.open) sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
});

describe('第二轮深度回归', () => {
  it('限制审计与流程参数，并正确执行问题范围和分页筛选', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/audit?limit=abc', headers: { cookie: adminCookie } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/audit/search?from=2026-09-05&to=2026-09-04', headers: { cookie: adminCookie } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/api/requirements?projectId=${projectId}&status=unknown`, headers: { cookie: adminCookie } })).statusCode).toBe(400);
    const excessiveItems = Array.from({ length: 201 }, (_, index) => ({ title: `步骤${index}`, startOffsetDays: 0, durationDays: 1, sortOrder: index }));
    expect((await app.inject({ method: 'POST', url: '/api/templates', headers: { cookie: adminCookie }, payload: {
      projectId, name: '超大流程', items: excessiveItems,
    } })).statusCode).toBe(400);

    const draft = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie: adminCookie }, payload: {
      projectId, title: '筛选用需求', templateId,
    } });
    const linked = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie: adminCookie }, payload: {
      projectId, requirementId: draft.json().id, title: '需求问题',
    } });
    const publicIssue = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie: adminCookie }, payload: { projectId, title: '公共问题' } });
    const page = await app.inject({ method: 'GET', url: `/api/issues?projectId=${projectId}&scope=requirement&pageSize=1`, headers: { cookie: adminCookie } });
    expect(page.statusCode).toBe(200);
    expect(page.json()).toMatchObject({ total: 1, pageSize: 1 });
    expect(page.json().items[0].id).toBe(linked.json().id);
    const lastPage = await app.inject({ method: 'GET', url: `/api/issues?projectId=${projectId}&scope=requirement&page=99&pageSize=1`, headers: { cookie: adminCookie } });
    expect(lastPage.json()).toMatchObject({ total: 1, page: 1, pages: 1, items: [expect.objectContaining({ id: linked.json().id })] });
    for (const query of ['status=resolved&active=true', `scope=public&requirementId=${draft.json().id}`, `ownerId=${personId}&unassigned=true`]) {
      const conflict = await app.inject({ method: 'GET', url: `/api/issues?projectId=${projectId}&${query}`, headers: { cookie: adminCookie } });
      expect(conflict.statusCode, conflict.body).toBe(400);
      expect(conflict.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    expect((await app.inject({ method: 'POST', url: `/api/issues/${linked.json().id}/resolve`, headers: { cookie: adminCookie }, payload: {
      expectedVersion: linked.json().version, content: '筛选前闭环',
    } })).statusCode).toBe(200);
    const active = await app.inject({ method: 'GET', url: `/api/issues?projectId=${projectId}&status=active`, headers: { cookie: adminCookie } });
    expect(active.statusCode).toBe(200);
    expect(active.json().items.map((item: { id: string }) => item.id)).toEqual([publicIssue.json().id]);
  });

  it('审计日志使用稳定快照翻页，并按服务本地日期筛选', async () => {
    const { sqlite } = await import('../src/server/database');
    const createdAt = '2026-09-03T16:30:00.000Z';
    const insert = sqlite.prepare(`INSERT INTO audit_logs
      (id, actor_type, actor_id, action, entity_type, entity_id, project_id, summary, created_at)
      VALUES (?, 'user', NULL, 'probe', 'audit_paging', NULL, NULL, ?, ?)`);
    for (let index = 0; index < 25; index += 1) insert.run(`audit-page-${index}`, `分页记录${index}`, createdAt);

    const firstResponse = await app.inject({ method: 'GET', url: '/api/audit/search?entityType=audit_paging&from=2026-09-04&to=2026-09-04&pageSize=20', headers: { cookie: adminCookie } });
    expect(firstResponse.statusCode).toBe(200);
    const first = firstResponse.json();
    expect(first).toMatchObject({ total: 25, page: 1, pages: 2 });
    expect(first.items.map((item: { id: string }) => item.id)).toEqual(Array.from({ length: 20 }, (_, offset) => `audit-page-${24 - offset}`));

    insert.run('audit-page-new', '翻页后新增记录', createdAt);
    const secondResponse = await app.inject({ method: 'GET', url: `/api/audit/search?entityType=audit_paging&from=2026-09-04&to=2026-09-04&page=2&pageSize=20&snapshot=${first.snapshot}`, headers: { cookie: adminCookie } });
    const second = secondResponse.json();
    expect(second).toMatchObject({ total: 25, page: 2, snapshot: first.snapshot });
    expect(second.items.map((item: { id: string }) => item.id)).toEqual(Array.from({ length: 5 }, (_, offset) => `audit-page-${4 - offset}`));
    expect(new Set([...first.items, ...second.items].map((item: { id: string }) => item.id)).size).toBe(25);
  });

  it('统计分析按上海业务日归集UTC跨日的创建与进展', async () => {
    const analyticsProject = await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie: adminCookie }, payload: {
      name: '业务日期统计项目',
    } });
    const analyticsProjectId = analyticsProject.json().id;
    const requirement = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie: adminCookie }, payload: {
      projectId: analyticsProjectId, title: '凌晨创建需求',
    } });
    const requirementId = requirement.json().id;
    const { sqlite } = await import('../src/server/database');
    const utcPreviousDay = '2026-09-03T16:30:00.000Z';
    sqlite.prepare('UPDATE requirements SET created_at=? WHERE id=?').run(utcPreviousDay, requirementId);
    sqlite.prepare(`INSERT INTO progress_updates
      (id, requirement_id, percent, content, event_type, created_at, updated_at)
      VALUES (?, ?, 0, '凌晨补充说明', 'note', ?, ?)`)
      .run(randomUUID(), requirementId, utcPreviousDay, utcPreviousDay);
    const panels = [
      { id: 'created', title: '新建需求', dataset: 'requirements', measure: 'count', visualization: 'kpi', size: 'small', timeScope: 'range' },
      { id: 'updated', title: '进展更新', dataset: 'progress', measure: 'update_count', visualization: 'kpi', size: 'small', timeScope: 'range' },
    ];
    const query = (date: string) => app.inject({ method: 'POST', url: '/api/analytics/query', headers: { cookie: adminCookie }, payload: {
      projectId: analyticsProjectId, range: { from: date, to: date }, panels,
    } });

    const localDay = await query('2026-09-04');
    expect(localDay.statusCode, localDay.body).toBe(200);
    expect(localDay.json()).toMatchObject({ asOfDate: todayIso(), range: { from: '2026-09-04', to: '2026-09-04' } });
    expect(localDay.json().results.map((result: { rows: Array<{ value: number }> }) => result.rows[0].value)).toEqual([1, 1]);
    const utcDay = await query('2026-09-03');
    expect(utcDay.statusCode, utcDay.body).toBe(200);
    expect(utcDay.json().results.map((result: { rows: Array<{ value: number }> }) => result.rows[0].value)).toEqual([0, 0]);
  });

  it('归档流程不能在草稿首次排期时继续生成工作项', async () => {
    const createdTemplate = await app.inject({ method: 'POST', url: '/api/templates', headers: { cookie: adminCookie }, payload: {
      projectId, name: '待归档流程', items: [{ title: '归档步骤', startOffsetDays: 0, durationDays: 1, sortOrder: 0 }],
    } });
    const draft = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie: adminCookie }, payload: {
      projectId, title: '待首次排期', templateId: createdTemplate.json().id,
    } });
    await app.inject({ method: 'DELETE', url: `/api/templates/${createdTemplate.json().id}`, headers: { cookie: adminCookie } });
    const scheduled = await app.inject({ method: 'POST', url: `/api/requirements/${draft.json().id}/reschedule`, headers: { cookie: adminCookie }, payload: {
      scheduleMode: 'start', plannedStart: '2026-09-04', expectedVersion: draft.json().version,
    } });
    expect(scheduled.statusCode).toBe(409);
    const current = await app.inject({ method: 'GET', url: `/api/requirements/${draft.json().id}`, headers: { cookie: adminCookie } });
    expect(current.json()).toMatchObject({ status: 'planning', plannedStart: null, workItems: [] });
  });

  it('终态工作完成后不计入未来负载，失效负责人不能直接重开', async () => {
    // 动态取未来工作日：并发统计对“今天及以前”走实际负载口径，硬编码日期会随时间推移翻转分支。
    const futureDay = addBusinessDays(todayIso(), 5);
    const requirement = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie: adminCookie }, payload: {
      projectId, title: '终态重开校验', ownerId: personId, templateId, plannedStart: futureDay,
    } });
    requirementId = requirement.json().id;
    const initialItem = requirement.json().workItems[0];
    workItemId = initialItem.id;
    const assigned = await app.inject({ method: 'PATCH', url: `/api/work-items/${workItemId}`, headers: { cookie: adminCookie }, payload: {
      ownerId: personId, expectedVersion: initialItem.version,
    } });
    const started = await app.inject({ method: 'POST', url: `/api/work-items/${workItemId}/start`, headers: { cookie: adminCookie }, payload: {
      expectedVersion: assigned.json().version,
    } });
    const completed = await app.inject({ method: 'POST', url: `/api/work-items/${workItemId}/complete`, headers: { cookie: adminCookie }, payload: {
      content: '完成', expectedVersion: started.json().version,
    } });
    const pending = await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie: adminCookie } });
    await app.inject({ method: 'POST', url: `/api/requirements/${requirementId}/accept`, headers: { cookie: adminCookie }, payload: {
      content: '验收', expectedVersion: pending.json().version,
    } });
    const future = await app.inject({ method: 'GET', url: `/api/analytics/people-concurrency?projectId=${projectId}&personId=${personId}&from=${futureDay}&to=${futureDay}`, headers: { cookie: adminCookie } });
    expect(future.json().people[0].days[0].count).toBe(0);
    expect(future.json().asOfDate).toBe(todayIso());
    const analytics = await app.inject({ method: 'POST', url: '/api/analytics/query', headers: { cookie: adminCookie }, payload: {
      projectId, range: { from: futureDay, to: futureDay }, panels: [{
        id: 'peak', title: '区间峰值', dataset: 'people', measure: 'peak_concurrency', dimension: 'person',
        visualization: 'bar', size: 'medium', timeScope: 'range', sort: 'desc', limit: 10,
      }],
    } });
    expect(analytics.statusCode).toBe(200);
    expect(analytics.json().results[0].rows).toEqual([{ key: '深测负责人', label: '深测负责人', value: 0 }]);

    issueId = (await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie: adminCookie }, payload: {
      projectId, requirementId, title: '终态问题', ownerId: personId,
    } })).json().id;
    const issue = await app.inject({ method: 'GET', url: `/api/issues/${issueId}`, headers: { cookie: adminCookie } });
    const resolved = await app.inject({ method: 'POST', url: `/api/issues/${issueId}/resolve`, headers: { cookie: adminCookie }, payload: {
      content: '解决', expectedVersion: issue.json().version,
    } });
    expect((await app.inject({ method: 'DELETE', url: `/api/projects/${projectId}/members/${personId}`, headers: { cookie: adminCookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/work-items/${workItemId}/reopen`, headers: { cookie: adminCookie }, payload: {
      reason: '返工', expectedVersion: completed.json().version,
    } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/api/issues/${issueId}/reopen`, headers: { cookie: adminCookie }, payload: {
      reason: '复现', expectedVersion: resolved.json().version,
    } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'PUT', url: `/api/projects/${projectId}/members/${personId}`, headers: { cookie: adminCookie }, payload: { role: 'member' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/work-items/${workItemId}/reopen`, headers: { cookie: adminCookie }, payload: {
      reason: '恢复资格后返工', expectedVersion: completed.json().version,
    } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/issues/${issueId}/reopen`, headers: { cookie: adminCookie }, payload: {
      reason: '恢复资格后复现', expectedVersion: resolved.json().version,
    } })).statusCode).toBe(200);
  });

  it('取消或归档父需求后，子资源重开不会产生隐藏写入', async () => {
    const cancelled = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie: adminCookie }, payload: {
      projectId, title: '取消需求', ownerId: personId, templateId, plannedStart: '2026-09-04',
    } });
    const cancelledResult = await app.inject({ method: 'POST', url: `/api/requirements/${cancelled.json().id}/cancel`, headers: { cookie: adminCookie }, payload: {
      reason: '取消', expectedVersion: cancelled.json().version,
    } });
    const cancelledItem = cancelledResult.json().workItems[0];
    expect((await app.inject({ method: 'POST', url: `/api/work-items/${cancelledItem.id}/reopen`, headers: { cookie: adminCookie }, payload: {
      reason: '误重开', expectedVersion: cancelledItem.version,
    } })).statusCode).toBe(409);

    const archivedIssue = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie: adminCookie }, payload: {
      projectId, requirementId: cancelled.json().id, title: '归档问题', ownerId: personId,
    } });
    const resolved = await app.inject({ method: 'POST', url: `/api/issues/${archivedIssue.json().id}/resolve`, headers: { cookie: adminCookie }, payload: {
      content: '解决', expectedVersion: archivedIssue.json().version,
    } });
    const current = await app.inject({ method: 'GET', url: `/api/requirements/${cancelled.json().id}`, headers: { cookie: adminCookie } });
    expect((await app.inject({ method: 'DELETE', url: `/api/requirements/${cancelled.json().id}`, headers: { cookie: adminCookie }, payload: {
      expectedVersion: current.json().version,
    } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/work-items/${cancelledItem.id}/reopen`, headers: { cookie: adminCookie }, payload: {
      reason: '归档后重开', expectedVersion: cancelledItem.version,
    } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/issues/${archivedIssue.json().id}/reopen`, headers: { cookie: adminCookie }, payload: {
      reason: '归档后重开', expectedVersion: resolved.json().version,
    } })).statusCode).toBe(409);
    const { sqlite } = await import('../src/server/database');
    expect(sqlite.prepare('SELECT status FROM work_items WHERE id=?').get(cancelledItem.id)).toMatchObject({ status: 'cancelled' });
    expect(sqlite.prepare('SELECT status FROM issues WHERE id=?').get(archivedIssue.json().id)).toMatchObject({ status: 'resolved' });
  });

  it('密码重置撤销MCP Token，归档项目也不能继续追加进展', async () => {
    const tokenResponse = await app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie: memberCookie }, payload: { name: '重置校验' } });
    const token = tokenResponse.json().token;
    const mcpHeaders = { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json' };
    const mcpStatus = async (id: number) => {
      const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: mcpHeaders, body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/list', params: {} }) });
      await response.text();
      return response.status;
    };
    expect(await mcpStatus(1)).toBe(200);
    const accounts = (await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie: adminCookie } })).json();
    const accountId = accounts.find((account: { personId: string }) => account.personId === personId).id;
    expect((await app.inject({ method: 'POST', url: `/api/accounts/${accountId}/reset-password`, headers: { cookie: adminCookie } })).statusCode).toBe(200);
    expect(await mcpStatus(2)).toBe(401);

    const { sqlite } = await import('../src/server/database');
    const before = (sqlite.prepare('SELECT COUNT(*) AS count FROM progress_updates WHERE requirement_id=?').get(requirementId) as { count: number }).count;
    expect((await app.inject({ method: 'DELETE', url: `/api/projects/${projectId}`, headers: { cookie: adminCookie }, payload: { force: true } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/requirements/${requirementId}/progress`, headers: { cookie: adminCookie }, payload: { content: '不应写入' } })).statusCode).toBe(403);
    const after = (sqlite.prepare('SELECT COUNT(*) AS count FROM progress_updates WHERE requirement_id=?').get(requirementId) as { count: number }).count;
    expect(after).toBe(before);
    const { getPeopleConcurrency } = await import('../src/server/services');
    expect(getPeopleConcurrency({ personId, from: todayIso(), to: todayIso() }).people[0].days[0].count).toBe(0);
    const refreshedAccounts = (await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie: adminCookie } })).json();
    expect(refreshedAccounts.find((account: { personId: string }) => account.personId === personId).activeAssignments)
      .toMatchObject({ requirements: 1, workItems: 1, issues: 1 });
  });
});
