import {listenTestApp} from './support/listen';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addBusinessDays, businessDayDelta } from '../src/shared/domain';

const dbPath = path.join(process.cwd(), 'data', `integration-${randomUUID()}.db`);
process.env.DB_PATH = dbPath;
process.env.BACKUP_DIR = path.join(process.cwd(), 'data', `backups-${randomUUID()}`);
process.env.BACKUP_MAX_COUNT = '3';
process.env.SEED_DEMO = '0';
process.env.APP_PASSWORD_HASH = 'scrypt$4c63a6f93ff4f94b031b7e7583592177$b598dbddaf9dd06678ff8756923d9e0a7f2d68eaa45bc644fbf4a73c9298970c7489671dfcfc8be282022c26a3370fb040f3f086a45faa1e1abde04bbe4a51ef';
process.env.SESSION_SECRET = 'test-session-secret-with-more-than-thirty-two-characters';

let app: FastifyInstance;
let origin = '';
let cookie = '';
let projectId = '';
let requirementId = '';
let templateId = '';
let requirementOwnerId = '';
let personId = '';
let collaboratorPersonId = '';
let firstWorkItemId = '';
let secondWorkItemId = '';
let issueId = '';
let memberCookie = '';
let memberAccountId = '';

async function requestMcp(headers: Record<string, string>, payload: Record<string, unknown>) {
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers, body: JSON.stringify(payload) });
  const body = await response.text();
  return { statusCode: response.status, body, json: () => JSON.parse(body) };
}

beforeAll(async () => {
  // 这些排期和当日负载断言使用固定工作日，不依赖运行机器当天是否放假。
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-04T04:00:00Z') });
  const module = await import('../src/server/app');
  app = await module.buildApp();
  await app.ready();
  origin = await listenTestApp(app);
});

afterAll(async () => {
  vi.useRealTimers();
  await app.close();
  const { sqlite } = await import('./support/database');
  if (sqlite.open) sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
  fs.rmSync(process.env.BACKUP_DIR!, { recursive: true, force: true });
});

describe('自动化项目管理API', () => {
  it('未登录用户只看到开放项目，不能写入业务数据', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/projects' })).json()).toEqual([]);
    expect((await app.inject({ method: 'POST', url: '/api/projects', payload: { name: '无权限' } })).statusCode).toBe(401);
  });

  it('登录后创建项目内流程和自动排期需求', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: '41_xc7q0qOjo4Inw!' } });
    const setCookie = login.headers['set-cookie'];
    cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie!).split(';')[0];
    const project = await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie }, payload: { name: '集成测试项目' } });
    expect(project.statusCode).toBe(200);
    projectId = project.json().id;
    const requirementOwner = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie }, payload: {
      projectId, name: '王需求', jobTitle: '需求负责人',
    } });
    expect(requirementOwner.statusCode).toBe(200);
    requirementOwnerId = requirementOwner.json().id;
    const initialFlows = await app.inject({ method: 'GET', url: '/api/templates?projectId=' + projectId, headers: { cookie } });
    expect(initialFlows.json()).toHaveLength(1);
    expect(project.json().defaultTemplateId).toBe(initialFlows.json()[0].id);
    const template = await app.inject({ method: 'POST', url: '/api/templates', headers: { cookie }, payload: {
      projectId, name: '并行交付模板', description: '设计与开发并行启动，测试提前介入。', items: [
        { title: '设计', startOffsetDays: 0, durationDays: 2, milestoneLabel: '需求基线', sortOrder: 0 },
        { title: '开发', startOffsetDays: 0, durationDays: 3, milestoneLabel: '接口基线', sortOrder: 1 },
        { title: '测试', startOffsetDays: 2, durationDays: 2, sortOrder: 2 },
      ],
    } });
    expect(template.statusCode).toBe(200); templateId = template.json().id;
    expect(template.json().description).toBe('设计与开发并行启动，测试提前介入。');
    expect(template.json().items.map((item: { milestoneLabel: string | null }) => item.milestoneLabel)).toEqual(['需求基线', '接口基线', null]);
    const originalIds = template.json().items.map((item: { id: string }) => item.id);
    const updated = await app.inject({ method: 'PATCH', url: `/api/templates/${templateId}`, headers: { cookie }, payload: {
      name: '并行交付模板', description: '根据复盘调整工期，保留并行交付策略。', expectedUpdatedAt: template.json().updatedAt,
      items: template.json().items.map((item: any) => ({
        id: item.id, title: item.title, startOffsetDays: item.startOffsetDays, durationDays: item.durationDays + 1,
        milestoneLabel: item.milestoneLabel, sortOrder: item.sortOrder,
      })),
    } });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json().items.map((item: { id: string }) => item.id)).toEqual(originalIds);
    expect(updated.json().description).toBe('根据复盘调整工期，保留并行交付策略。');
    expect(updated.json().updatedAt).not.toBe(template.json().updatedAt);
    const staleTemplate = await app.inject({ method: 'PATCH', url: `/api/templates/${templateId}`, headers: { cookie }, payload: {
      description: '旧窗口覆盖的新说明', expectedUpdatedAt: template.json().updatedAt,
    } });
    expect(staleTemplate.statusCode).toBe(409);
    expect(staleTemplate.json().code).toBe('STALE_WRITE');
    const staleTemplateArchive = await app.inject({ method: 'DELETE', url: `/api/templates/${templateId}`, headers: { cookie }, payload: {
      expectedUpdatedAt: template.json().updatedAt,
    } });
    expect(staleTemplateArchive.statusCode).toBe(409);
    expect(staleTemplateArchive.json().code).toBe('STALE_WRITE');
    expect((await app.inject({ method: 'GET', url: `/api/templates?projectId=${projectId}`, headers: { cookie } })).json()
      .find((item: { id: string }) => item.id === templateId).description).toBe('根据复盘调整工期，保留并行交付策略。');

    const updatedProject = await app.inject({ method: 'PATCH', url: '/api/projects/' + projectId, headers: { cookie }, payload: {
      defaultTemplateId: templateId, expectedUpdatedAt: project.json().updatedAt,
    } });
    expect(updatedProject.statusCode, updatedProject.body).toBe(200);
    expect(updatedProject.json().updatedAt).not.toBe(project.json().updatedAt);
    const staleProject = await app.inject({ method: 'PATCH', url: '/api/projects/' + projectId, headers: { cookie }, payload: {
      name: '旧窗口覆盖项目名', expectedUpdatedAt: project.json().updatedAt,
    } });
    expect(staleProject.statusCode).toBe(409);
    expect(staleProject.json().code).toBe('STALE_WRITE');
    const staleProjectArchive = await app.inject({ method: 'DELETE', url: `/api/projects/${projectId}`, headers: { cookie }, payload: {
      expectedUpdatedAt: project.json().updatedAt,
    } });
    expect(staleProjectArchive.statusCode).toBe(409);
    expect(staleProjectArchive.json().code).toBe('STALE_WRITE');
    expect((await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie } })).json()
      .find((item: { id: string }) => item.id === projectId).name).toBe('集成测试项目');
    const requirement = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie }, payload: {
      projectId, title: '自动排期需求', ownerId: requirementOwnerId, plannedStart: '2026-09-04', templateId,
    } });
    expect(requirement.statusCode).toBe(200); requirementId = requirement.json().id;
    expect(requirement.json().priority).toBe('P2');
    expect(requirement.json()).toMatchObject({ templateId, templateName: '并行交付模板' });
    expect(requirement.json().workItems).toHaveLength(3);
    expect(requirement.json().workItems[0]).toMatchObject({ plannedStart: '2026-09-04', plannedEnd: '2026-09-08', milestoneLabel: '需求基线' });
    expect(requirement.json().workItems[1].milestoneLabel).toBe('接口基线');
    expect(requirement.json().workItems[1].plannedStart).toBe('2026-09-04');
    expect(requirement.json().plannedEnd).toBe('2026-09-10');
    expect(requirement.json().status).toBe('not_started');
    firstWorkItemId = requirement.json().workItems[0].id;
  });

  it('活跃项目经二次确认后可强制归档且不会使当前会话失效', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: '41_xc7q0qOjo4Inw!' } });
    const setCookie = login.headers['set-cookie'];
    const archiveCookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie!).split(';')[0];
    const project = await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie: archiveCookie }, payload: { name: '强制归档验证项目' } });
    const archiveProjectId = project.json().id as string;
    const requirement = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie: archiveCookie }, payload: {
      projectId: archiveProjectId, title: '仍在推进的需求',  plannedStart: '2026-09-03', templateId: project.json().defaultTemplateId,
    } });
    await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie: archiveCookie }, payload: {
      projectId: archiveProjectId, requirementId: requirement.json().id, title: '仍未解决的问题', priority: 'P1', discoveredAt: '2026-09-03',
    } });

    const blocked = await app.inject({ method: 'DELETE', url: `/api/projects/${archiveProjectId}`, headers: { cookie: archiveCookie } });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT', details: { requirements: 1, issues: 1 } });

    const secondRequirement = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie: archiveCookie }, payload: {
      projectId: archiveProjectId, title: '确认后新增的需求',
    } });
    expect(secondRequirement.statusCode).toBe(200);
    const secondIssue = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie: archiveCookie }, payload: {
      projectId: archiveProjectId, title: '确认后新增的问题', priority: 'P2', discoveredAt: '2026-09-03',
    } });
    expect(secondIssue.statusCode).toBe(200);
    const changedImpact = await app.inject({ method: 'DELETE', url: `/api/projects/${archiveProjectId}`, headers: { cookie: archiveCookie }, payload: {
      force: true, expectedRequirements: 1, expectedIssues: 1,
    } });
    expect(changedImpact.statusCode).toBe(409);
    expect(changedImpact.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT', details: { requirements: 2, issues: 2 } });
    expect((await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: archiveCookie } })).json()
      .some((item: { id: string }) => item.id === archiveProjectId)).toBe(true);

    const forced = await app.inject({ method: 'DELETE', url: `/api/projects/${archiveProjectId}`, headers: { cookie: archiveCookie }, payload: {
      force: true, expectedRequirements: 2, expectedIssues: 2,
    } });
    expect(forced.statusCode).toBe(200);
    expect(forced.json()).toMatchObject({ ok: true, forced: true, dependencies: { requirements: 2, issues: 2 } });
    expect((await app.inject({ method: 'GET', url: '/api/session', headers: { cookie: archiveCookie } })).json()).toMatchObject({ authenticated: true, username: 'admin' });
    expect((await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: archiveCookie } })).json().some((item: { id: string }) => item.id === archiveProjectId)).toBe(false);
    const archivedWrite = await app.inject({ method: 'PATCH', url: `/api/requirements/${requirement.json().id}`, headers: { cookie: archiveCookie }, payload: {
      title: '不应写入的标题', expectedVersion: requirement.json().version,
    } });
    expect(archivedWrite.statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/action-items?projectId=${archiveProjectId}`, headers: { cookie: archiveCookie } })).statusCode).toBe(403);
    const archivedProject = (await app.inject({ method: 'GET', url: '/api/archives', headers: { cookie: archiveCookie } })).json().projects
      .find((item: { id: string }) => item.id === archiveProjectId);
    expect((await app.inject({ method: 'DELETE', url: `/api/archives/projects/${archiveProjectId}`, headers: { cookie: archiveCookie }, payload: {
      confirmName: '强制归档验证项目', expectedDeletedAt: archivedProject.deletedAt,
    } })).statusCode).toBe(200);
  });

  it('人员姓名唯一、岗位可维护并可恢复归档', async () => {
    const person = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie }, payload: { projectId, name: '张三', jobTitle: '前端开发' } });
    expect(person.statusCode).toBe(200); personId = person.json().id;
    const updated = await app.inject({ method: 'PATCH', url: `/api/people/${personId}`, headers: { cookie }, payload: {
      name: '张三', jobTitle: '技术负责人', expectedUpdatedAt: person.json().updatedAt,
    } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ name: '张三', jobTitle: '技术负责人' });
    expect(updated.json().updatedAt).not.toBe(person.json().updatedAt);
    const stale = await app.inject({ method: 'PATCH', url: `/api/people/${personId}`, headers: { cookie }, payload: {
      jobTitle: '旧窗口岗位', expectedUpdatedAt: person.json().updatedAt,
    } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('STALE_WRITE');
    expect((await app.inject({ method: 'GET', url: '/api/people', headers: { cookie } })).json()
      .find((item: { id: string }) => item.id === personId).jobTitle).toBe('技术负责人');
    expect((await app.inject({ method: 'POST', url: '/api/people', headers: { cookie }, payload: { projectId, name: '  张三  ' } })).statusCode).toBe(400);
    await app.inject({ method: 'DELETE', url: `/api/people/${personId}`, headers: { cookie } });
    const archives = await app.inject({ method: 'GET', url: '/api/archives', headers: { cookie } });
    expect(archives.json().people.some((item: { id: string }) => item.id === personId)).toBe(true);
    expect((await app.inject({ method: 'POST', url: `/api/people/${personId}/restore`, headers: { cookie } })).statusCode).toBe(200);
    const collaborator = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie }, payload: { projectId, name: '李四', jobTitle: '后端开发' } });
    expect(collaborator.statusCode).toBe(200); collaboratorPersonId = collaborator.json().id;
    expect((await app.inject({ method: 'GET', url: `/api/people?projectId=${projectId}`, headers: { cookie } })).json().map((item: { name: string }) => item.name)).toEqual(expect.arrayContaining(['李四', '张三']));
    expect((await app.inject({ method: 'DELETE', url: `/api/projects/${projectId}/people/${collaboratorPersonId}`, headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/people?projectId=${projectId}`, headers: { cookie } })).json().some((item: { id: string }) => item.id === collaboratorPersonId)).toBe(false);
    expect((await app.inject({ method: 'POST', url: `/api/projects/${projectId}/people/${collaboratorPersonId}`, headers: { cookie } })).statusCode).toBe(200);
  });

  it('拒绝非法日期和超长人员并发范围', async () => {
    const invalidRequirement = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie }, payload: {
      projectId, title: '非法日期需求', plannedStart: '2026-02-31', templateId,
    } });
    expect(invalidRequirement.statusCode).toBe(400);
    expect(invalidRequirement.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    const concurrency = await app.inject({ method: 'GET', url: `/api/analytics/people-concurrency?projectId=${projectId}&from=2026-01-01&to=2031-01-06`, headers: { cookie } });
    expect(concurrency.statusCode).toBe(400);
  });

  it('公共问题支持看板、筛选搜索、进展和闭环', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie }, payload: {
      projectId, requirementId, title: '公共证书问题', impact: '影响项目联调', reporter: '测试人员',
      ownerId: personId, priority: 'P1', discoveredAt: '2026-09-01', dueDate: '2000-01-01',
    } });
    expect(created.statusCode).toBe(200); issueId = created.json().id;
    expect(created.json()).toMatchObject({ title: '公共证书问题', status: 'in_progress', progress: 0, ownerId: personId, ownerName: '张三', overdue: true });
    const update = await app.inject({ method: 'POST', url: `/api/issues/${issueId}/updates`, headers: { cookie }, payload: { content: '测试证书已经申请' } });
    expect(update.json().updates[0].content).toBe('测试证书已经申请');
    const searched = await app.inject({ method: 'GET', url: `/api/issues?projectId=${projectId}&q=${encodeURIComponent('测试证书')}&overdue=true`, headers: { cookie } });
    expect(searched.statusCode).toBe(200);
    expect(searched.json().items).toEqual([expect.objectContaining({ id: issueId, overdue: true })]);
    expect(searched.json().summary).toMatchObject({ total: 1, active: 1, inProgress: 1, highPriority: 1, overdue: 1, closureRate: 0 });
    const linkedDashboard = await app.inject({ method: 'GET', url: `/api/dashboard?projectId=${projectId}`, headers: { cookie } });
    expect(linkedDashboard.json().requirements[0].issueSummary).toEqual({ active: 1, overdue: 1 });
    expect((await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie } })).json().issueSummary).toEqual({ active: 1, overdue: 1 });
    expect((await app.inject({ method: 'PATCH', url: `/api/issues/${issueId}`, headers: { cookie }, payload: { status: 'resolved', expectedVersion: created.json().version } })).statusCode).toBe(400);
    const resolved = await app.inject({ method: 'POST', url: `/api/issues/${issueId}/resolve`, headers: { cookie }, payload: { content: '证书已签发，问题闭环', expectedVersion: created.json().version } });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toMatchObject({ status: 'resolved', overdue: false });
    expect(resolved.json().resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(resolved.json().updates.map((item: { content: string }) => item.content)).toEqual(expect.arrayContaining(['测试证书已经申请', '证书已签发，问题闭环']));
    expect((await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie } })).json().issueSummary).toEqual({ active: 0, overdue: 0 });
    const publicIssue = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie }, payload: {
      projectId, title: '公共部署风险', impact: '影响多个需求交付', priority: 'P0', discoveredAt: '2026-09-01', dueDate: '2000-01-01',
    } });
    const dashboard = await app.inject({ method: 'GET', url: `/api/dashboard?projectId=${projectId}`, headers: { cookie } });
    expect(dashboard.json().issues.summary).toMatchObject({ total: 2, active: 1, resolved: 1, highPriority: 1, overdue: 1, closureRate: 50 });
    expect(dashboard.json().issues.attention).toEqual([expect.objectContaining({ id: publicIssue.json().id, title: '公共部署风险', overdue: true })]);
    expect(dashboard.json().requirements[0].issueSummary).toEqual({ active: 0, overdue: 0 });
    const activeIssues = await app.inject({ method: 'GET', url: `/api/issues?projectId=${projectId}&active=true`, headers: { cookie } });
    expect(activeIssues.json().items).toEqual([expect.objectContaining({ id: publicIssue.json().id, status: 'in_progress' })]);
    const futureHigh = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie }, payload: {
      projectId, title: '未来高优先级问题', ownerId: personId, priority: 'P0', discoveredAt: '2026-09-01', dueDate: '2999-12-31',
    } });
    const overdueLow = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie }, payload: {
      projectId, title: '逾期低优先级问题', ownerId: personId, priority: 'P3', discoveredAt: '2026-09-01', dueDate: '2000-01-02',
    } });
    const ordered = await app.inject({ method: 'GET', url: `/api/issues?projectId=${projectId}&status=in_progress`, headers: { cookie } });
    expect(ordered.json().items.slice(0, 2).map((item: { id: string }) => item.id)).toEqual([publicIssue.json().id, overdueLow.json().id]);
    const deferred = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie }, payload: {
      projectId, title: '等待外部条件的问题', priority: 'P2', discoveredAt: '2026-09-01', dueDate: '2000-01-03',
    } });
    const deferredByCommand = await app.inject({ method: 'POST', url: `/api/issues/${deferred.json().id}/defer`, headers: { cookie }, payload: { reason: '等待外部环境', expectedVersion: deferred.json().version } });
    expect(deferredByCommand.json()).toMatchObject({ status: 'deferred', dueDate: null, overdue: false });
    const deferredByUpdate = await app.inject({ method: 'POST', url: `/api/issues/${futureHigh.json().id}/defer`, headers: { cookie }, payload: { reason: '等待排期', expectedVersion: futureHigh.json().version } });
    expect(deferredByUpdate.json()).toMatchObject({ status: 'deferred', dueDate: null, overdue: false });
    const dashboardWithoutDeferred = await app.inject({ method: 'GET', url: `/api/dashboard?projectId=${projectId}`, headers: { cookie } });
    expect(dashboardWithoutDeferred.json().issues.attention.every((item: { status: string }) => item.status === 'in_progress')).toBe(true);

    const attentionTarget = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie }, payload: {
      projectId, title: '不能被挂起问题挤出的热点', priority: 'P3', discoveredAt: '2026-09-01', dueDate: '2999-12-31',
    } });
    const temporaryIssueIds = [attentionTarget.json().id as string];
    for (let index = 0; index < 10; index += 1) {
      const blocker = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie }, payload: {
        projectId, title: `热点截断挂起项${index}`, priority: 'P0', discoveredAt: '2026-09-01', dueDate: '2999-12-31',
      } });
      temporaryIssueIds.push(blocker.json().id);
      const deferredBlocker = await app.inject({ method: 'POST', url: `/api/issues/${blocker.json().id}/defer`, headers: { cookie }, payload: {
        reason: '构造热点截断边界', expectedVersion: blocker.json().version,
      } });
      expect(deferredBlocker.statusCode, deferredBlocker.body).toBe(200);
    }
    const crowdedDashboard = await app.inject({ method: 'GET', url: `/api/dashboard?projectId=${projectId}`, headers: { cookie } });
    expect(crowdedDashboard.json().issues.attention).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: attentionTarget.json().id, status: 'in_progress' }),
    ]));
    const { sqlite } = await import('./support/database');
    const placeholders = temporaryIssueIds.map(() => '?').join(',');
    sqlite.transaction(() => {
      sqlite.prepare(`DELETE FROM issue_updates WHERE issue_id IN (${placeholders})`).run(...temporaryIssueIds);
      sqlite.prepare(`DELETE FROM issues WHERE id IN (${placeholders})`).run(...temporaryIssueIds);
    })();
  });

  it('统计目录公开，项目查询和个人布局受账号权限保护', async () => {
    const catalog = await app.inject({ method: 'GET', url: '/api/analytics/catalog' });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().datasets.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining(['requirements', 'work_items', 'issues', 'people', 'progress']),
    );
    const guestLayout = await app.inject({ method: 'GET', url: '/api/analytics/layout' });
    expect(guestLayout.statusCode).toBe(401);

    const panels = [
      { id: 'active-test', title: '活跃需求', dataset: 'requirements', measure: 'active_count', visualization: 'kpi', size: 'small', timeScope: 'snapshot' },
      { id: 'issue-trend-test', title: '问题趋势', dataset: 'issues', measure: 'count', secondaryMeasure: 'resolved_count', dimension: 'week', visualization: 'line', size: 'medium', timeScope: 'range', sort: 'asc' },
    ];
    const queried = await app.inject({ method: 'POST', url: '/api/analytics/query', headers: { cookie }, payload: {
      projectId, range: { from: '2026-09-01', to: '2026-09-30' }, panels,
    } });
    expect(queried.statusCode).toBe(200);
    expect(queried.json().results[0]).toMatchObject({ panelId: 'active-test', snapshot: true, rows: [{ value: 1 }] });
    expect(queried.json().results[1].rows[0]).toMatchObject({ value: 5, secondaryValue: 1 });
    expect((await app.inject({ method: 'POST', url: '/api/analytics/query', headers: { cookie }, payload: {
      projectId, range: { from: '2026-10-01', to: '2026-09-01' }, panels: [panels[0]],
    } })).statusCode).toBe(400);

    const { sqlite } = await import('./support/database');
    const now = new Date().toISOString();
    const archivedRequirementId = randomUUID();
    const archivedIssueId = randomUUID();
    sqlite.prepare(`INSERT INTO requirements
      (id,project_id,title,status,progress,risk_level,priority,created_at,updated_at,deleted_at)
      VALUES (?,?,'已归档分析需求','not_started',0,'low','P2',?,?,?)`).run(archivedRequirementId, projectId, now, now, now);
    sqlite.prepare(`INSERT INTO issues
      (id,project_id,requirement_id,title,status,priority,discovered_at,created_at,updated_at)
      VALUES (?,?,?,'归档需求中的问题','in_progress','P2','2026-09-01',?,?)`).run(archivedIssueId, projectId, archivedRequirementId, now, now);
    const archiveExcluded = await app.inject({ method: 'POST', url: '/api/analytics/query', headers: { cookie }, payload: {
      projectId, range: { from: '2026-09-01', to: '2026-09-30' }, panels,
    } });
    expect(archiveExcluded.json().results[0].rows[0].value).toBe(1);
    expect(archiveExcluded.json().results[1].rows[0]).toMatchObject({ value: 5, secondaryValue: 1 });
    const hiddenIssues = await app.inject({ method: 'GET', url: `/api/issues?projectId=${projectId}`, headers: { cookie } });
    expect(hiddenIssues.json().items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: archivedIssueId })]));
    const hiddenIssueDetail = await app.inject({ method: 'GET', url: `/api/issues/${archivedIssueId}`, headers: { cookie } });
    expect(hiddenIssueDetail.statusCode).toBe(404);
    expect(hiddenIssueDetail.json()).toMatchObject({ code: 'NOT_FOUND' });
    sqlite.prepare('DELETE FROM issues WHERE id=?').run(archivedIssueId);
    sqlite.prepare('DELETE FROM requirements WHERE id=?').run(archivedRequirementId);

    const malformedIssueId = randomUUID();
    sqlite.prepare(`INSERT INTO issues
      (id,project_id,title,status,priority,discovered_at,created_at,updated_at)
      VALUES (?,?,'日期损坏的问题','in_progress','P2','bad',?,?)`).run(malformedIssueId, projectId, now, now);
    const isolatedFailure = await app.inject({ method: 'POST', url: '/api/analytics/query', headers: { cookie }, payload: {
      projectId, range: { from: '2026-09-01', to: '2026-09-30' }, panels: [panels[0], {
        id: 'broken-panel', title: '损坏面板', dataset: 'issues', measure: 'count', dimension: 'week', visualization: 'line', size: 'medium', timeScope: 'snapshot',
      }],
    } });
    expect(isolatedFailure.statusCode).toBe(200);
    expect(isolatedFailure.json().results[0].error).toBeUndefined();
    expect(isolatedFailure.json().results[1].error).toBe('图表查询失败');
    sqlite.prepare('DELETE FROM issues WHERE id=?').run(malformedIssueId);

    const requirementIds = [randomUUID(), randomUUID()];
    const insertRequirement = sqlite.prepare(`INSERT INTO requirements
      (id,project_id,title,status,planned_start,planned_end,progress,risk_level,priority,accepted_at,created_at,updated_at)
      VALUES (?,? ,?,'completed','2026-09-01','2026-09-10',100,'low','P2',?,?,?)`);
    const insertWorkItem = sqlite.prepare(`INSERT INTO work_items
      (id,requirement_id,title,status,planned_start,planned_end,actual_start,actual_end,progress,sort_order,created_at,updated_at)
      VALUES (?,? ,?,'completed','2026-09-01','2026-09-10','2026-09-01',?,100, ?,?,?)`);
    insertRequirement.run(requirementIds[0], projectId, '按期完成需求', '2026-09-09', now, now);
    insertWorkItem.run(randomUUID(), requirementIds[0], '先完成工作项', '2026-09-08', 0, now, now);
    insertWorkItem.run(randomUUID(), requirementIds[0], '最后完成工作项', '2026-09-09', 1, now, now);
    insertRequirement.run(requirementIds[1], projectId, '延期完成需求', '2026-09-11', now, now);
    insertWorkItem.run(randomUUID(), requirementIds[1], '延期工作项', '2026-09-11', 0, now, now);
    const onTime = await app.inject({ method: 'POST', url: '/api/analytics/query', headers: { cookie }, payload: {
      projectId, range: { from: '2026-09-01', to: '2026-09-30' }, panels: [{
        id: 'on-time-test', title: '按期率', dataset: 'requirements', measure: 'on_time_rate', visualization: 'kpi', size: 'small', timeScope: 'range',
      }],
    } });
    expect(onTime.json().results[0].rows[0].value).toBe(50);
    expect(onTime.json().results[0].rows[0].sampleCount).toBe(2);
    const noSamples = await app.inject({ method: 'POST', url: '/api/analytics/query', headers: { cookie }, payload: {
      projectId, range: { from: '2030-01-01', to: '2030-01-31' }, panels: [{
        id: 'no-samples', title: '按期率', dataset: 'requirements', measure: 'on_time_rate', visualization: 'kpi', size: 'small', timeScope: 'range',
      }],
    } });
    expect(noSamples.json().results[0].rows[0]).toMatchObject({ value: 0, sampleCount: 0 });
    sqlite.prepare(`DELETE FROM requirements WHERE id IN (?,?)`).run(...requirementIds);

    expect((await app.inject({ method: 'PUT', url: '/api/analytics/layout', payload: { version: 1, panels: [panels[0]] } })).statusCode).toBe(401);
    const initialLayout = await app.inject({ method: 'GET', url: '/api/analytics/layout', headers: { cookie } });
    expect(initialLayout.json()).toMatchObject({ source: 'default', updatedAt: null });
    const saved = await app.inject({ method: 'PUT', url: '/api/analytics/layout', headers: { cookie }, payload: {
      version: 1, panels: [panels[0]], expectedUpdatedAt: initialLayout.json().updatedAt,
    } });
    expect(saved.json()).toMatchObject({ source: 'personal', canCustomize: true, updatedAt: expect.any(String), layout: { version: 1, panels: [{ id: 'active-test' }] } });
    const staleSave = await app.inject({ method: 'PUT', url: '/api/analytics/layout', headers: { cookie }, payload: {
      version: 1, panels: [panels[1]], expectedUpdatedAt: initialLayout.json().updatedAt,
    } });
    expect(staleSave.statusCode).toBe(409);
    expect(staleSave.json()).toMatchObject({ code: 'STALE_WRITE', details: { currentUpdatedAt: saved.json().updatedAt } });
    expect((await app.inject({ method: 'GET', url: '/api/analytics/layout', headers: { cookie } })).json()).toMatchObject({
      source: 'personal', updatedAt: saved.json().updatedAt, layout: { panels: [{ id: 'active-test' }] },
    });
    const otherLogin = await app.inject({ method: 'POST', url: '/api/login', payload: { username: '李四', password: '888888' } });
    const otherCookie = String(otherLogin.headers['set-cookie']).split(';')[0];
    expect((await app.inject({ method: 'GET', url: '/api/analytics/layout', headers: { cookie: otherCookie } })).statusCode).toBe(403);
    const invalid = await app.inject({ method: 'PUT', url: '/api/analytics/layout', headers: { cookie }, payload: {
      version: 1, panels: [{ ...panels[0], dataset: 'sql' }],
    } });
    expect(invalid.statusCode).toBe(400);

    const session = (await app.inject({ method: 'GET', url: '/api/session', headers: { cookie } })).json();
    sqlite.prepare('UPDATE analytics_layouts SET config_json=? WHERE account_id=?').run('{broken', session.accountId);
    const malformedLayout = await app.inject({ method: 'GET', url: '/api/analytics/layout', headers: { cookie } });
    expect(malformedLayout.json()).toMatchObject({ source: 'default', updatedAt: saved.json().updatedAt, layout: { version: 1 } });
    const staleReset = await app.inject({ method: 'DELETE', url: '/api/analytics/layout', headers: { cookie }, payload: { expectedUpdatedAt: null } });
    expect(staleReset.statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: '/api/analytics/layout', headers: { cookie } })).json()).toMatchObject({ updatedAt: saved.json().updatedAt });
    const reset = await app.inject({ method: 'DELETE', url: '/api/analytics/layout', headers: { cookie }, payload: { expectedUpdatedAt: malformedLayout.json().updatedAt } });
    expect(reset.json()).toMatchObject({ source: 'default', canCustomize: true, updatedAt: null });
    const audit = await app.inject({ method: 'GET', url: '/api/audit/search?entityType=analytics_layout&pageSize=20', headers: { cookie } });
    expect(audit.json().items.map((item: { action: string }) => item.action)).toEqual(expect.arrayContaining(['update', 'reset']));
  });

  it('工作项事件自动推导状态、工期加权进度和进展快照', async () => {
    const initial = (await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie } })).json().workItems.find((item: { id: string }) => item.id === firstWorkItemId);
    const singleOwner = await app.inject({ method: 'PATCH', url: `/api/work-items/${firstWorkItemId}`, headers: { cookie }, payload: { ownerId: personId, expectedVersion: initial.version } });
    expect(singleOwner.json()).toMatchObject({ ownerId: personId, collaborators: [], assigneeIds: [personId] });
    const collaborative = await app.inject({ method: 'PATCH', url: `/api/work-items/${firstWorkItemId}`, headers: { cookie }, payload: { ownerId: personId, assigneeIds: [personId, collaboratorPersonId], expectedVersion: singleOwner.json().version } });
    expect(collaborative.json().collaborators).toEqual([expect.objectContaining({ id: collaboratorPersonId, name: '李四' })]);
    expect(collaborative.json().assigneeIds).toEqual([personId, collaboratorPersonId]);
    const started = await app.inject({ method: 'POST', url: `/api/work-items/${firstWorkItemId}/start`, headers: { cookie }, payload: { expectedVersion: collaborative.json().version } });
    expect(started.json().status).toBe('in_progress');
    const completed = await app.inject({ method: 'POST', url: `/api/work-items/${firstWorkItemId}/complete`, headers: { cookie }, payload: { expectedVersion: started.json().version } });
    expect(completed.json().status).toBe('completed');
    const rejectedProgress = await app.inject({ method: 'POST', url: `/api/requirements/${requirementId}/progress`, headers: { cookie }, payload: { content: '尝试覆盖终态', workItemId: firstWorkItemId, workItemPercent: 99, expectedVersion: completed.json().version } });
    expect(rejectedProgress.statusCode).toBe(409);
    expect(rejectedProgress.json().code).toBe('TERMINAL_LOCKED');
    const progress = (await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie } })).json();
    expect(progress.progress).toBeGreaterThan(0);
    expect(progress.progressUpdates[0]).toMatchObject({ content: '完成工作项', eventType: 'complete' });
    const dashboard = await app.inject({ method: 'GET', url: `/api/dashboard?projectId=${projectId}`, headers: { cookie } });
    expect(dashboard.json().requirements[0].recentProgressUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: '完成工作项', workItemId: firstWorkItemId, workItemPercent: 100 }),
    ]));

    const second = progress.workItems[1];
    secondWorkItemId = second.id;
    const assigned = await app.inject({ method: 'PATCH', url: `/api/work-items/${second.id}`, headers: { cookie }, payload: { ownerId: personId, assigneeIds: [personId, collaboratorPersonId], expectedVersion: second.version, reason: '安排后续开发负责人' } });
    const secondStarted = await app.inject({ method: 'POST', url: `/api/work-items/${second.id}/start`, headers: { cookie }, payload: { expectedVersion: assigned.json().version } });
    const retired = await app.inject({ method:'POST', url:`/api/work-items/${second.id}/block`, headers:{cookie}, payload:{expectedVersion:secondStarted.json().version,reason:'等待依赖'} });
    expect(retired.statusCode).toBe(410);

  });

  it('工作项排序必须提交完整且唯一的同需求ID集合', async () => {
    const before = (await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie } })).json();
    const original = before.workItems.map((item: { id: string; sortOrder: number }) => ({ id: item.id, sortOrder: item.sortOrder }));
    const missing = await app.inject({ method: 'POST', url: `/api/requirements/${requirementId}/reorder-work-items`, headers: { cookie }, payload: {
      expectedVersion: before.version,
    } });
    expect(missing.statusCode).toBe(400);
    const partial = await app.inject({ method: 'POST', url: `/api/requirements/${requirementId}/reorder-work-items`, headers: { cookie }, payload: {
      ids: [before.workItems[0].id], reason: '验证不完整排序', expectedVersion: before.version,
    } });
    expect(partial.statusCode).toBe(400);
    const duplicate = await app.inject({ method: 'POST', url: `/api/requirements/${requirementId}/reorder-work-items`, headers: { cookie }, payload: {
      ids: before.workItems.map(() => before.workItems[0].id), reason: '验证重复排序', expectedVersion: before.version,
    } });
    expect(duplicate.statusCode).toBe(400);
    const after = (await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie } })).json();
    expect(after.workItems.map((item: { id: string; sortOrder: number }) => ({ id: item.id, sortOrder: item.sortOrder }))).toEqual(original);
  });

  it('人员自动创建账号、首次改密并按本人和项目角色授权', async () => {
    const accounts = await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie } });
    const userAccount = accounts.json().find((item: { personId: string }) => item.personId === collaboratorPersonId);
    const builtin = accounts.json().find((item: { isBuiltin: boolean }) => item.isBuiltin);
    expect(userAccount).toMatchObject({ username: '李四', role: 'user', mustChangePassword: true });
    expect(builtin).toMatchObject({ username: 'admin', role: 'admin' });
    expect((await app.inject({ method: 'PATCH', url: `/api/accounts/${builtin.id}`, headers: { cookie }, payload: { role: 'user' } })).statusCode).toBe(400);

    const firstLogin = await app.inject({ method: 'POST', url: '/api/login', payload: { username: '李四', password: '888888' } });
    let userCookie = String(firstLogin.headers['set-cookie']).split(';')[0];
    expect(firstLogin.json()).toMatchObject({ role: 'user', mustChangePassword: true });
    expect((await app.inject({ method: 'GET', url: '/api/my-work', headers: { cookie: userCookie } })).statusCode).toBe(403);
    const changed = await app.inject({ method: 'POST', url: '/api/account/change-password', headers: { cookie: userCookie }, payload: { currentPassword: '888888', newPassword: 'new-password-123' } });
    userCookie = String(changed.headers['set-cookie']).split(';')[0];
    memberCookie = userCookie;
    memberAccountId = userAccount.id;
    expect((await app.inject({ method: 'GET', url: '/api/my-work', headers: { cookie: userCookie } })).json().items.some((item: { id: string }) => item.id === secondWorkItemId)).toBe(true);
    const userIssue = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie: userCookie }, payload: {
      projectId, requirementId, title: '普通用户提交的问题', reporter: '李四', priority: 'P1',
    } });
    expect(userIssue.statusCode).toBe(200);
    expect(userIssue.json()).toMatchObject({ status: 'in_progress', ownerId: null, reporter: '李四' });
    expect((await app.inject({ method: 'POST', url: `/api/issues/${userIssue.json().id}/updates`, headers: { cookie: userCookie }, payload: { content: '已经补充复现步骤' } })).statusCode).toBe(200);
    const assignedIssue = await app.inject({ method: 'PATCH', url: `/api/issues/${userIssue.json().id}`, headers: { cookie }, payload: { ownerId: collaboratorPersonId, expectedVersion: userIssue.json().version } });
    expect(assignedIssue.json()).toMatchObject({ ownerId: collaboratorPersonId, status: 'in_progress', progress: 0 });
    const ownerProgress = await app.inject({ method: 'POST', url: `/api/issues/${userIssue.json().id}/updates`, headers: { cookie: userCookie }, payload: { content: '修复方案已完成验证', progress: 60, expectedVersion: assignedIssue.json().version } });
    expect(ownerProgress.json()).toMatchObject({ progress: 60, status: 'in_progress' });
    expect(ownerProgress.json().updates[0]).toMatchObject({ progress: 60, createdByName: '李四' });
    expect((await app.inject({ method: 'POST', url: `/api/issues/${userIssue.json().id}/updates`, headers: { cookie: userCookie }, payload: { content: '尝试自行关闭', progress: 100, expectedVersion: ownerProgress.json().version } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: `/api/issues/${userIssue.json().id}`, headers: { cookie: userCookie }, payload: { status: 'resolved', updateContent: '自行关闭' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/api/work-items/${secondWorkItemId}`, headers: { cookie: userCookie }, payload: { plannedEnd: '2026-12-31' } })).statusCode).toBe(403);
    const currentSecond = (await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie: userCookie } })).json().workItems.find((item: { id: string }) => item.id === secondWorkItemId);
    expect((await app.inject({ method: 'POST', url: `/api/requirements/${requirementId}/progress`, headers: { cookie: userCookie }, payload: { workItemId: secondWorkItemId, workItemPercent: 20, content: '协作联调已开始', expectedVersion: currentSecond.version } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie: userCookie }, payload: { projectId, title: '越权需求',  plannedStart: '2026-09-08', templateId } })).statusCode).toBe(403);

    const rejectedGlobalPromotion = await app.inject({ method: 'PATCH', url: `/api/accounts/${userAccount.id}`, headers: { cookie }, payload: { role: 'project_manager', managedProjectIds: [projectId] } });
    expect(rejectedGlobalPromotion.statusCode).toBe(400);
    const promoted = await app.inject({ method: 'PUT', url: `/api/projects/${projectId}/members/${collaboratorPersonId}`, headers: { cookie }, payload: { role: 'manager' } });
    expect(promoted.json()).toMatchObject({ projectRole: 'manager' });
    const issueBeforeClose = (await app.inject({ method: 'GET', url: `/api/issues/${userIssue.json().id}`, headers: { cookie: userCookie } })).json();
    const managerClosedIssue = await app.inject({ method: 'POST', url: `/api/issues/${userIssue.json().id}/resolve`, headers: { cookie: userCookie }, payload: { content: '项目经理确认问题已解决', expectedVersion: issueBeforeClose.version } });
    expect(managerClosedIssue.statusCode).toBe(200);
    expect(managerClosedIssue.json()).toMatchObject({ status: 'resolved', progress: 100 });
    expect(managerClosedIssue.json().updates[0].content).toBe('项目经理确认问题已解决');
    expect((await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie: userCookie }, payload: { projectId, title: '经理创建需求',  plannedStart: '2026-09-08', templateId } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/templates', headers: { cookie: userCookie }, payload: { projectId, name: '经理创建的流程', items: [{ title: '工作', startOffsetDays: 0, durationDays: 1, sortOrder: 0 }] } })).statusCode).toBe(200);
  });

  it('严格隔离项目数据，并落实观察者、经理任免和成员安全移除规则', async () => {
    const isolatedProject = await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie }, payload: { name: '权限隔离项目' } });
    const isolatedProjectId = isolatedProject.json().id as string;
    const outsider = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie }, payload: {
      projectId: isolatedProjectId, name: '隔离项目成员', jobTitle: '测试工程师',
    } });
    const outsiderId = outsider.json().id as string;
    const outsiderLogin = await app.inject({ method: 'POST', url: '/api/login', payload: { username: '隔离项目成员', password: '888888' } });
    let outsiderCookie = String(outsiderLogin.headers['set-cookie']).split(';')[0];
    const changed = await app.inject({ method: 'POST', url: '/api/account/change-password', headers: { cookie: outsiderCookie }, payload: {
      currentPassword: '888888', newPassword: 'isolated-password-123',
    } });
    outsiderCookie = String(changed.headers['set-cookie']).split(';')[0];

    const visibleProjects = await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: outsiderCookie } });
    expect(visibleProjects.json().map((item: { id: string }) => item.id)).toEqual([isolatedProjectId]);
    expect((await app.inject({ method: 'GET', url: `/api/requirements?projectId=${projectId}`, headers: { cookie: outsiderCookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie: outsiderCookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/issues/${issueId}`, headers: { cookie: outsiderCookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/analytics/query', headers: { cookie: outsiderCookie }, payload: {
      projectId, range: { from: '2026-09-01', to: '2026-09-30' }, panels: [{
        id: 'cross-project', title: '越权统计', dataset: 'requirements', measure: 'active_count', visualization: 'kpi', size: 'small', timeScope: 'snapshot',
      }],
    } })).statusCode).toBe(403);

    const rejectedCrossProjectFlow = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie }, payload: {
      projectId: isolatedProjectId, title: '错误跨项目流程',  plannedStart: '2026-09-10', templateId,
    } });
    expect(rejectedCrossProjectFlow.statusCode).toBe(400);
    const copied = await app.inject({ method: 'POST', url: `/api/projects/${isolatedProjectId}/templates/${templateId}/copy`, headers: { cookie } });
    expect(copied.statusCode).toBe(200);
    expect(copied.json()).toMatchObject({ projectId: isolatedProjectId, name: '并行交付模板（副本）' });
    const isolatedRequirement = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie }, payload: {
      projectId: isolatedProjectId, title: '独立流程需求',  plannedStart: '2026-09-10', templateId: copied.json().id,
    } });
    expect(isolatedRequirement.statusCode).toBe(200);

    expect((await app.inject({ method: 'PUT', url: `/api/projects/${projectId}/members/${personId}`, headers: { cookie: memberCookie }, payload: { role: 'manager' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: `/api/projects/${projectId}/members/${personId}`, headers: { cookie: memberCookie }, payload: { role: 'member' } })).statusCode).toBe(200);
    const lastManagerRemoval = await app.inject({ method: 'DELETE', url: `/api/projects/${projectId}/members/${collaboratorPersonId}`, headers: { cookie: memberCookie } });
    expect(lastManagerRemoval.statusCode).toBe(409);
    expect(lastManagerRemoval.json().error).toContain('至少需要保留一名项目经理');
    const blockedRemoval = await app.inject({ method: 'DELETE', url: `/api/projects/${projectId}/members/${personId}`, headers: { cookie: memberCookie } });
    expect(blockedRemoval.statusCode).toBe(409);
    expect(blockedRemoval.json().details).toEqual(expect.objectContaining({ workItems: expect.any(Number), issues: expect.any(Number) }));
    expect(blockedRemoval.json().details.workItems + blockedRemoval.json().details.issues).toBeGreaterThan(0);

    expect((await app.inject({ method: 'PUT', url: `/api/projects/${isolatedProjectId}/members/${outsiderId}`, headers: { cookie }, payload: { role: 'viewer' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/dashboard?projectId=${isolatedProjectId}`, headers: { cookie: outsiderCookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie: outsiderCookie }, payload: {
      projectId: isolatedProjectId, title: '观察者不能提交', priority: 'P2', discoveredAt: '2026-09-02',
    } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/audit?projectId=${projectId}`, headers: { cookie: memberCookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/audit', headers: { cookie: memberCookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/api/people/${outsiderId}`, headers: { cookie }, payload: { active: 'false' } })).json().active).toBe(0);
    expect((await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: outsiderCookie } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PATCH', url: `/api/people/${outsiderId}`, headers: { cookie }, payload: { active: 'true' } })).json().active).toBe(1);
  });

  it('补全计划预览只回填空值且不覆盖已有结束日期', async () => {
    const before = (await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie } })).json();
    const item = before.workItems[2];
    const cleared = await app.inject({ method: 'PATCH', url: `/api/work-items/${item.id}`, headers: { cookie }, payload: { plannedStart: '', expectedVersion: item.version, reason: '验证补全计划能力' } });
    expect(cleared.statusCode).toBe(200);
    const afterClear = (await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie } })).json();
    const preview = await app.inject({ method: 'POST', url: `/api/requirements/${requirementId}/plan-preview`, headers: { cookie }, payload: { templateId, baseStart: before.plannedStart } });
    const entry = preview.json().entries.find((value: { workItemId: string }) => value.workItemId === item.id);
    expect(entry).toMatchObject({ currentStart: null, currentEnd: item.plannedEnd, willChange: true });
    await app.inject({ method: 'POST', url: `/api/requirements/${requirementId}/apply-plan`, headers: { cookie }, payload: { templateId, baseStart: before.plannedStart, templateItemIds: [entry.templateItemId], expectedVersion: afterClear.version, reason: '补全测试工作项排期' } });
    const after = (await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie } })).json().workItems.find((value: { id: string }) => value.id === item.id);
    expect(after.plannedStart).toBe(entry.proposedStart);
    expect(after.plannedEnd).toBe(item.plannedEnd);
  });

  it('需求排期随工作项编辑、新增、删除、取消和重开统一聚合', async () => {
    const flow = await app.inject({ method: 'POST', url: '/api/templates', headers: { cookie }, payload: {
      projectId, name: `排期聚合-${randomUUID().slice(0, 6)}`, items: [
        { title: '设计', startOffsetDays: 0, durationDays: 2, sortOrder: 0 },
        { title: '交付', startOffsetDays: 3, durationDays: 2, sortOrder: 1 },
      ],
    } });
    const created = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie }, payload: {
      projectId, title: '排期聚合验证', ownerId: requirementOwnerId, plannedStart: '2026-09-07', templateId: flow.json().id,
    } });
    expect(created.json()).toMatchObject({ plannedStart: '2026-09-07', scheduleComplete: true });
    const [first, second] = created.json().workItems;

    const moved = await app.inject({ method: 'PATCH', url: `/api/work-items/${first.id}`, headers: { cookie }, payload: {
      plannedStart: '2026-08-17', expectedVersion: first.version,
    } });
    expect(moved.statusCode).toBe(200);
    let aggregate = (await app.inject({ method: 'GET', url: `/api/requirements/${created.json().id}`, headers: { cookie } })).json();
    expect(aggregate).toMatchObject({ plannedStart: '2026-08-17', plannedEnd: second.plannedEnd, scheduleComplete: true });
    const dashboard = (await app.inject({ method: 'GET', url: `/api/dashboard?projectId=${projectId}`, headers: { cookie } })).json();
    expect(dashboard.requirements.find((item: { id: string }) => item.id === created.json().id))
      .toMatchObject({ plannedStart: '2026-08-17', plannedEnd: second.plannedEnd });

    const custom = await app.inject({ method: 'POST', url: `/api/requirements/${created.json().id}/work-items`, headers: { cookie }, payload: {
      title: '前置评审', plannedStart: '2026-08-14', plannedEnd: '2026-08-14', expectedVersion: aggregate.version,
    } });
    expect(custom.statusCode).toBe(200);
    aggregate = (await app.inject({ method: 'GET', url: `/api/requirements/${created.json().id}`, headers: { cookie } })).json();
    expect(aggregate.plannedStart).toBe('2026-08-14');

    const removed = await app.inject({ method: 'DELETE', url: `/api/work-items/${custom.json().id}`, headers: { cookie }, payload: {
      expectedVersion: custom.json().version,
    } });
    expect(removed.statusCode).toBe(200);
    aggregate = (await app.inject({ method: 'GET', url: `/api/requirements/${created.json().id}`, headers: { cookie } })).json();
    expect(aggregate.plannedStart).toBe('2026-08-17');

    const currentFirst = aggregate.workItems.find((item: { id: string }) => item.id === first.id);
    const cancelled = await app.inject({ method: 'POST', url: `/api/work-items/${first.id}/cancel`, headers: { cookie }, payload: {
      reason: '暂时取消前置项', expectedVersion: currentFirst.version,
    } });
    expect(cancelled.statusCode).toBe(200);
    aggregate = (await app.inject({ method: 'GET', url: `/api/requirements/${created.json().id}`, headers: { cookie } })).json();
    expect(aggregate.plannedStart).toBe(second.plannedStart);

    const reopened = await app.inject({ method: 'POST', url: `/api/work-items/${first.id}/reopen`, headers: { cookie }, payload: {
      reason: '恢复前置项', expectedVersion: cancelled.json().version,
    } });
    expect(reopened.statusCode).toBe(200);
    aggregate = (await app.inject({ method: 'GET', url: `/api/requirements/${created.json().id}`, headers: { cookie } })).json();
    expect(aggregate.plannedStart).toBe('2026-08-17');

    const delta = businessDayDelta('2026-08-17', '2026-09-07');
    const shifted = await app.inject({ method: 'POST', url: `/api/requirements/${created.json().id}/reschedule`, headers: { cookie }, payload: {
      scheduleMode: 'start', plannedStart: '2026-09-07', expectedVersion: aggregate.version, reason: '按聚合起点整体调整',
    } });
    expect(shifted.statusCode).toBe(200);
    expect(shifted.json()).toMatchObject({ plannedStart: '2026-09-07', scheduleComplete: true });
    expect(shifted.json().workItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.id, plannedStart: '2026-09-07' }),
      expect.objectContaining({ id: second.id, plannedStart: addBusinessDays(second.plannedStart, delta), plannedEnd: addBusinessDays(second.plannedEnd, delta) }),
    ]));
  });

  it('人员并发统计使用负责人和计划/实际区间', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/analytics/people-concurrency?projectId=${projectId}&personId=${personId}`, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().asOfDate).toBe('2026-09-04');
    const person = response.json().people[0];
    expect(person.name).toBe('张三');
    expect(person.currentCount).toBeGreaterThanOrEqual(1);
    const collaboratorResponse = await app.inject({ method: 'GET', url: `/api/analytics/people-concurrency?projectId=${projectId}&personId=${collaboratorPersonId}`, headers: { cookie } });
    expect(collaboratorResponse.json().people[0]).toMatchObject({ name: '李四' });
    expect(collaboratorResponse.json().people[0].currentCount).toBeGreaterThanOrEqual(1);
  });

  it('已启动工作项随需求取消后仍保留取消前的实际投入', async () => {
    vi.setSystemTime(new Date('2026-09-04T04:00:00Z'));
    try {
      const created = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie }, payload: {
        projectId, title: '取消前实际投入', ownerId: requirementOwnerId, templateId, plannedStart: '2026-09-04',
      } });
      const item = created.json().workItems[0];
      const assigned = await app.inject({ method: 'PATCH', url: `/api/work-items/${item.id}`, headers: { cookie }, payload: {
        ownerId: personId, expectedVersion: item.version,
      } });
      const started = await app.inject({ method: 'POST', url: `/api/work-items/${item.id}/start`, headers: { cookie }, payload: {
        expectedVersion: assigned.json().version,
      } });
      expect(started.statusCode, started.body).toBe(200);
      vi.setSystemTime(new Date('2026-09-07T04:00:00Z'));
      const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: '41_xc7q0qOjo4Inw!' } });
      const setCookie = login.headers['set-cookie'];
      const laterCookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie!).split(';')[0];
      const current = await app.inject({ method: 'GET', url: `/api/requirements/${created.json().id}`, headers: { cookie: laterCookie } });
      const cancelled = await app.inject({ method: 'POST', url: `/api/requirements/${created.json().id}/cancel`, headers: { cookie: laterCookie }, payload: {
        reason: '停止历史项目', expectedVersion: current.json().version,
      } });
      expect(cancelled.statusCode, cancelled.body).toBe(200);
      expect(cancelled.json()).toMatchObject({ actualStart: '2026-09-04', actualEnd: null, observationEnd: '2026-09-07' });
      vi.setSystemTime(new Date('2026-09-08T04:00:00Z'));
      const nextLogin = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: '41_xc7q0qOjo4Inw!' } });
      const nextSetCookie = nextLogin.headers['set-cookie'];
      const nextCookie = (Array.isArray(nextSetCookie) ? nextSetCookie[0] : nextSetCookie!).split(';')[0];
      const cancelledItem = cancelled.json().workItems.find((entry: { id: string }) => entry.id === item.id);
      expect(cancelledItem.cancelledAt).toBe('2026-09-07');
      const invalidCorrection = await app.inject({ method: 'POST', url: `/api/work-items/${item.id}/correct`, headers: { cookie: nextCookie }, payload: {
        actualStart: '2026-09-08', reason: '错误地移到取消之后', expectedVersion: cancelledItem.version,
      } });
      expect(invalidCorrection.statusCode).toBe(400);
      expect(invalidCorrection.json().error).toContain('不能晚于取消日期');
      const { getPeopleConcurrency } = await import('../src/server/services');
      const result = getPeopleConcurrency({ projectId, personId, from: '2026-09-04', to: '2026-09-08' });
      const itemIds = (date: string) => result.people[0].days.find((day) => day.date === date)?.items.map((entry) => entry.id) || [];
      expect(itemIds('2026-09-04')).toContain(item.id);
      expect(itemIds('2026-09-07')).toContain(item.id);
      expect(itemIds('2026-09-08')).not.toContain(item.id);
    } finally {
      vi.setSystemTime(new Date('2026-09-04T04:00:00Z'));
    }
  });

  it('补充流程拒绝数组冒充数据版本', async () => {
    const current = (await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie } })).json();
    const response = await app.inject({ method: 'POST', url: `/api/requirements/${requirementId}/apply-template`, headers: { cookie }, payload: {
      templateId, expectedVersion: [current.version],
    } });
    expect(response.statusCode, response.body).toBe(400);
  });

  it('周末并发区间没有工作日，不能虚构当日负载', async () => {
    const { getPeopleConcurrency } = await import('../src/server/services');
    vi.setSystemTime(new Date('2026-09-05T04:00:00Z'));
    try {
      const result = getPeopleConcurrency({ projectId, personId, from: '2026-09-05', to: '2026-09-06' });
      expect(result.dates).toEqual([]);
      expect(result.people[0]).toMatchObject({ name: '张三', days: [], currentCount: 0, peakCount: 0 });
      expect(result.currentTop).toEqual([]);
    } finally { vi.setSystemTime(new Date('2026-09-04T04:00:00Z')); }
  });

  it('只能永久删除归档内容并安全处理关联数据', async () => {
    const project = await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie }, payload: {
      name: '待永久删除项目',
    } });
    const disposableProjectId = project.json().id as string;
    const originalDefaultTemplateId = project.json().defaultTemplateId as string;
    const template = await app.inject({ method: 'POST', url: '/api/templates', headers: { cookie }, payload: {
      projectId: disposableProjectId, name: '待永久删除模板', items: [{ title: '临时工作项', startOffsetDays: 0, durationDays: 1, sortOrder: 0 }],
    } });
    const disposableTemplateId = template.json().id as string;
    expect((await app.inject({ method: 'PATCH', url: `/api/projects/${disposableProjectId}`, headers: { cookie }, payload: { defaultTemplateId: disposableTemplateId } })).statusCode).toBe(200);
    const requirement = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie }, payload: {
      projectId: disposableProjectId, title: '待永久删除需求',  plannedStart: '2026-09-07', templateId: disposableTemplateId,
    } });
    const disposableRequirementId = requirement.json().id as string;
    const disposableWorkItemId = requirement.json().workItems[0].id as string;
    const person = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie }, payload: { projectId: disposableProjectId, name: '待永久删除人员', jobTitle: '临时岗位' } });
    const disposablePersonId = person.json().id as string;
    const assigned = await app.inject({ method: 'PATCH', url: `/api/work-items/${disposableWorkItemId}`, headers: { cookie }, payload: { ownerId: disposablePersonId, expectedVersion: requirement.json().workItems[0].version } });
    expect(assigned.statusCode).toBe(200);

    expect((await app.inject({ method: 'DELETE', url: `/api/archives/projects/${disposableProjectId}`, headers: { cookie } })).statusCode).toBe(400);

    expect((await app.inject({ method: 'DELETE', url: `/api/people/${disposablePersonId}`, headers: { cookie } })).statusCode).toBe(409);
    const unassigned = await app.inject({ method: 'PATCH', url: `/api/work-items/${disposableWorkItemId}`, headers: { cookie }, payload: { ownerId: null, expectedVersion: assigned.json().version } });
    expect(unassigned.statusCode).toBe(200);
    await app.inject({ method: 'DELETE', url: `/api/people/${disposablePersonId}`, headers: { cookie } });
    const personArchive = (await app.inject({ method: 'GET', url: '/api/archives', headers: { cookie } })).json().people
      .find((item: { id: string }) => item.id === disposablePersonId);
    expect((await app.inject({ method: 'DELETE', url: `/api/archives/people/${disposablePersonId}`, headers: { cookie }, payload: {
      expectedDeletedAt: personArchive.deletedAt,
    } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/requirements/${disposableRequirementId}`, headers: { cookie } })).json().workItems[0].ownerId).toBeNull();

    expect((await app.inject({ method: 'PATCH', url: `/api/projects/${disposableProjectId}`, headers: { cookie }, payload: { defaultTemplateId: originalDefaultTemplateId } })).statusCode).toBe(200);
    await app.inject({ method: 'DELETE', url: `/api/templates/${disposableTemplateId}`, headers: { cookie } });
    const templateArchive = (await app.inject({ method: 'GET', url: '/api/archives', headers: { cookie } })).json().templates
      .find((item: { id: string }) => item.id === disposableTemplateId);
    expect((await app.inject({ method: 'DELETE', url: `/api/archives/templates/${disposableTemplateId}`, headers: { cookie }, payload: {
      expectedDeletedAt: templateArchive.deletedAt,
    } })).statusCode).toBe(409);
    const beforeCancel = (await app.inject({ method: 'GET', url: `/api/requirements/${disposableRequirementId}`, headers: { cookie } })).json();
    const cancelled = await app.inject({ method: 'POST', url: `/api/requirements/${disposableRequirementId}/cancel`, headers: { cookie }, payload: { reason: '清理测试数据', expectedVersion: beforeCancel.version } });
    expect(cancelled.statusCode).toBe(200);
    await app.inject({ method: 'DELETE', url: `/api/requirements/${disposableRequirementId}`, headers: { cookie }, payload: { expectedVersion: cancelled.json().version } });
    const archivePreview = (await app.inject({ method: 'GET', url: '/api/archives', headers: { cookie } })).json();
    expect(archivePreview.requirements.find((item: { id: string }) => item.id === disposableRequirementId))
      .toMatchObject({ workItemCount: 1, progressCount: 1, linkedIssueCount: 0 });
    const requirementArchive = archivePreview.requirements.find((item: { id: string }) => item.id === disposableRequirementId);
    expect((await app.inject({ method: 'DELETE', url: `/api/archives/requirements/${disposableRequirementId}`, headers: { cookie }, payload: {
      confirmName: '待永久删除需求', expectedDeletedAt: requirementArchive.deletedAt,
    } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/archives', headers: { cookie } })).json().requirements.some((item: { id: string }) => item.id === disposableRequirementId)).toBe(false);
    expect((await app.inject({ method: 'DELETE', url: `/api/archives/templates/${disposableTemplateId}`, headers: { cookie }, payload: {
      expectedDeletedAt: templateArchive.deletedAt,
    } })).statusCode).toBe(200);
    const { sqlite } = await import('./support/database');
    expect(sqlite.prepare("SELECT project_id AS projectId FROM audit_logs WHERE action='permanent_delete' AND entity_type='requirement' AND entity_id=?").get(disposableRequirementId)).toEqual({ projectId: disposableProjectId });
    expect(sqlite.prepare("SELECT project_id AS projectId FROM audit_logs WHERE action='permanent_delete' AND entity_type='template' AND entity_id=?").get(disposableTemplateId)).toEqual({ projectId: disposableProjectId });

    await app.inject({ method: 'DELETE', url: `/api/projects/${disposableProjectId}`, headers: { cookie } });
    const projectArchivePreview = (await app.inject({ method: 'GET', url: '/api/archives', headers: { cookie } })).json();
    expect(projectArchivePreview.projects.find((item: { id: string }) => item.id === disposableProjectId))
      .toMatchObject({ requirementCount: 0, workItemCount: 0, issueCount: 0, templateCount: 1 });
    const disposableProjectArchive = projectArchivePreview.projects.find((item: { id: string }) => item.id === disposableProjectId);
    expect((await app.inject({ method: 'DELETE', url: `/api/archives/projects/${disposableProjectId}`, headers: { cookie }, payload: {
      confirmName: '待永久删除项目', expectedDeletedAt: disposableProjectArchive.deletedAt,
    } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/projects?includeDeleted=true', headers: { cookie } })).json().some((item: { id: string }) => item.id === disposableProjectId)).toBe(false);
  });

  it('Token归属个人，并随账号停用和撤销立即失效', async () => {
    const tokenResponse = await app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie: memberCookie }, payload: { name: '测试Token', expiresInDays: 90 } });
    expect(tokenResponse.statusCode).toBe(200);
    const tokenId = tokenResponse.json().id as string;
    const token = tokenResponse.json().token as string;
    expect((await app.inject({ method: 'GET', url: '/api/tokens', headers: { cookie: memberCookie } })).json()).toEqual([
      expect.objectContaining({ id: tokenId, accountId: memberAccountId }),
    ]);
    expect((await app.inject({ method: 'GET', url: '/api/tokens', headers: { cookie } })).json().some((item: { id: string }) => item.id === tokenId)).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/api/admin/tokens', headers: { cookie } })).json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: tokenId, accountId: memberAccountId })]),
    );
    expect((await app.inject({ method: 'DELETE', url: `/api/tokens/${tokenId}`, headers: { cookie } })).statusCode).toBe(403);
    const headers = { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json' };
    const initialize = await requestMcp(headers, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'vitest', version: '1.0.0' } } });
    expect(initialize.statusCode).toBe(200);
    await requestMcp(headers, { jsonrpc: '2.0', method: 'notifications/initialized' });
    const call = await requestMcp(headers, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'people_concurrency', arguments: { projectId } } });
    expect(call.statusCode).toBe(200);
    expect(JSON.stringify(call.json())).toContain('张三');
    const write = await requestMcp(headers, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'add_progress', arguments: { requirementId, content: 'MCP来源识别测试' } } });
    expect(write.statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/api/accounts/${memberAccountId}`, headers: { cookie }, payload: { status: 'disabled' } })).statusCode).toBe(200);
    expect((await requestMcp(headers, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_projects', arguments: {} } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PATCH', url: `/api/accounts/${memberAccountId}`, headers: { cookie }, payload: { status: 'active' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: memberCookie } })).statusCode).toBe(401);
    const freshLogin = await app.inject({ method: 'POST', url: '/api/login', payload: { username: '李四', password: 'new-password-123' } });
    expect(freshLogin.statusCode).toBe(200);
    memberCookie = String(freshLogin.headers['set-cookie']).split(';')[0];
    expect((await requestMcp(headers, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_projects', arguments: {} } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/tokens/${tokenId}`, headers: { cookie } })).statusCode).toBe(200);
    expect((await requestMcp(headers, { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'list_projects', arguments: {} } })).statusCode).toBe(401);
  });

  it('手动备份可主动删除，操作日志支持筛选搜索', async () => {
    const created = [];
    for (let index = 0; index < 4; index += 1) created.push(await app.inject({ method: 'POST', url: '/api/backups', headers: { cookie } }));
    const response = created.at(-1)!;
    const backupPath = path.join(process.env.BACKUP_DIR!, response.json().name);
    const backups = (await app.inject({ method: 'GET', url: '/api/backups', headers: { cookie } })).json();
    expect(backups).toHaveLength(3);
    expect(backups.map((item: { name: string }) => item.name)).not.toContain(created[0].json().name);
    expect(fs.existsSync(path.join(process.env.BACKUP_DIR!, created[0].json().name))).toBe(false);
    const localTime = new Date(response.json().createdAt);
    const filenameTime = /project-manage-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-\d{3}\.db/.exec(response.json().name)!;
    expect(filenameTime.slice(1, 7).map(Number)).toEqual([localTime.getFullYear(), localTime.getMonth() + 1, localTime.getDate(), localTime.getHours(), localTime.getMinutes(), localTime.getSeconds()]);
    const Database = (await import('better-sqlite3')).default;
    const backupDb = new Database(backupPath, { readonly: true });
    expect((backupDb.pragma('integrity_check') as Array<{ integrity_check: string }>)[0].integrity_check).toBe('ok'); backupDb.close();
    const audit = await app.inject({ method: 'GET', url: '/api/audit', headers: { cookie } });
    expect(audit.json().some((item: { action: string }) => item.action === 'complete')).toBe(true);
    expect(audit.json().some((item: { action: string }) => item.action === 'permanent_delete')).toBe(true);
    expect(audit.json().some((item: { actorType: string; actorName: string }) => item.actorType === 'user' && item.actorName === 'admin')).toBe(true);
    expect(audit.json().some((item: { actorType: string; actorName: string; tokenName: string }) => item.actorType === 'token' && item.actorName === '李四' && item.tokenName === '测试Token')).toBe(true);
    const actorFiltered = await app.inject({ method: 'GET', url: '/api/audit/search?q=admin&page=1&pageSize=20', headers: { cookie } });
    expect(actorFiltered.json().items.every((item: { actorName: string }) => item.actorName === 'admin')).toBe(true);
    const filtered = await app.inject({ method: 'GET', url: '/api/audit/search?q=%E5%AE%8C%E6%88%90&action=complete&page=1&pageSize=20', headers: { cookie } });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().items.every((item: { action: string; summary: string }) => item.action === 'complete' && item.summary.includes('完成'))).toBe(true);
    const changedTime = new Date(Date.now() + 2000);
    fs.utimesSync(backupPath, changedTime, changedTime);
    const staleDelete = await app.inject({ method: 'DELETE', url: `/api/backups/${encodeURIComponent(response.json().name)}`, headers: { cookie }, payload: {
      expectedFingerprint: response.json().fingerprint,
    } });
    expect(staleDelete.statusCode).toBe(409);
    expect(fs.existsSync(backupPath)).toBe(true);
    const currentBackup = (await app.inject({ method: 'GET', url: '/api/backups', headers: { cookie } })).json()
      .find((item: { name: string }) => item.name === response.json().name);
    expect((await app.inject({ method: 'DELETE', url: `/api/backups/${encodeURIComponent(response.json().name)}`, headers: { cookie }, payload: {
      expectedFingerprint: currentBackup.fingerprint,
    } })).statusCode).toBe(200);
    expect(fs.existsSync(backupPath)).toBe(false);
    const backupAudit = await app.inject({ method: 'GET', url: '/api/audit/search?entityType=backup&pageSize=20', headers: { cookie } });
    expect(backupAudit.json().items.some((item: { action: string }) => item.action === 'delete')).toBe(true);
  });

  it('流程变更不回写需求，重选流程经确认后清空旧数据并重建计划', async () => {
    const before = (await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie } })).json();
    const workItemSnapshot = before.workItems.map((item: any) => ({ id: item.id, title: item.title, milestoneLabel: item.milestoneLabel, plannedStart: item.plannedStart, plannedEnd: item.plannedEnd, actualStart: item.actualStart, actualEnd: item.actualEnd }));
    const sourceTemplate = (await app.inject({ method: 'GET', url: `/api/templates?projectId=${projectId}`, headers: { cookie } })).json().find((item: { id: string }) => item.id === templateId);
    const changedTemplate = await app.inject({ method: 'PATCH', url: `/api/templates/${templateId}`, headers: { cookie }, payload: {
      name: sourceTemplate.name, description: sourceTemplate.description,
      items: sourceTemplate.items.map((item: any, index: number) => ({
        id: item.id, title: index === 0 ? `${item.title}（新版）` : item.title, startOffsetDays: item.startOffsetDays,
        durationDays: item.durationDays + 1, milestoneLabel: index === 0 ? '新版需求基线' : item.milestoneLabel, sortOrder: item.sortOrder,
      })),
    } });
    expect(changedTemplate.statusCode).toBe(200);
    const afterTemplateEdit = (await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie } })).json();
    expect(afterTemplateEdit.workItems.map((item: any) => ({ id: item.id, title: item.title, milestoneLabel: item.milestoneLabel, plannedStart: item.plannedStart, plannedEnd: item.plannedEnd, actualStart: item.actualStart, actualEnd: item.actualEnd }))).toEqual(workItemSnapshot);

    const replacement = await app.inject({ method: 'POST', url: '/api/templates', headers: { cookie }, payload: {
      projectId, name: '重选流程测试', items: [{ title: '重新梳理', startOffsetDays: 0, durationDays: 2, milestoneLabel: '重规划基线', sortOrder: 0 }],
    } });
    const blockedReset = await app.inject({ method: 'POST', url: `/api/requirements/${requirementId}/reselect-template`, headers: { cookie }, payload: { templateId: replacement.json().id, plannedStart: '2026-09-14', expectedVersion: afterTemplateEdit.version, reason: '尝试重选' } });
    expect(blockedReset.statusCode).toBe(409);
    expect(blockedReset.json().code).toBe('INVALID_TRANSITION');

    const fresh = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie }, payload: {
      projectId, title: '未开始重选流程需求',  ownerId: personId, plannedStart: '2026-09-11', templateId,
    } });
    await app.inject({ method: 'POST', url: `/api/requirements/${fresh.json().id}/progress`, headers: { cookie }, payload: { content: '保留需求级设计说明' } });
    const resetPayload = { templateId: replacement.json().id, plannedStart: '2026-09-14', expectedVersion: fresh.json().version };
    const reset = await app.inject({ method: 'POST', url: `/api/requirements/${fresh.json().id}/reselect-template`, headers: { cookie }, payload: resetPayload });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({ templateId: replacement.json().id, templateName: '重选流程测试', plannedStart: '2026-09-14', progress: 0 });
    expect(reset.json().progressUpdates).toEqual([expect.objectContaining({ content: '保留需求级设计说明', eventType: 'note' })]);
    expect(reset.json().workItems).toEqual([expect.objectContaining({ title: '重新梳理', milestoneLabel: '重规划基线', status: 'not_started', ownerId: null, actualStart: null, actualEnd: null, plannedStart: '2026-09-14', plannedEnd: '2026-09-15' })]);
    expect(reset.json().workItems.some((item: { id: string }) => workItemSnapshot.some((old: { id: string }) => old.id === item.id))).toBe(false);
  });

  it('编辑需求可正排倒排并保留自定义工作项排期', async () => {
    const beforeCustom = (await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie } })).json();
    const custom = await app.inject({ method: 'POST', url: `/api/requirements/${requirementId}/work-items`, headers: { cookie }, payload: {
      title: '自定义联调窗口', milestoneLabel: '联调基线', plannedStart: '2026-09-16', plannedEnd: '2026-09-18',
      expectedVersion: beforeCustom.version, reason: '执行中补充联调阶段',
    } });
    expect(custom.statusCode).toBe(200);
    expect(custom.json().milestoneLabel).toBe('联调基线');
    const customId = custom.json().id;
    const renamedMilestone = await app.inject({ method: 'PATCH', url: `/api/work-items/${customId}`, headers: { cookie }, payload: { milestoneLabel: '联调冻结基线', expectedVersion: custom.json().version, reason: '明确里程碑名称' } });
    expect(renamedMilestone.json().milestoneLabel).toBe('联调冻结基线');

    const beforeForward = (await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie } })).json();
    const forwardDelta = businessDayDelta(beforeForward.plannedStart, '2026-10-08');
    const directScheduleWrite = await app.inject({ method: 'PATCH', url: `/api/requirements/${requirementId}`, headers: { cookie }, payload: {
      plannedStart: '2026-10-08', expectedVersion: beforeForward.version,
    } });
    expect(directScheduleWrite.statusCode).toBe(400);
    const forward = await app.inject({ method: 'POST', url: `/api/requirements/${requirementId}/reschedule`, headers: { cookie }, payload: {
      scheduleMode: 'start', plannedStart: '2026-10-08', expectedVersion: beforeForward.version, reason: '整体顺延交付计划',
    } });
    expect(forward.statusCode).toBe(200);
    expect(forward.json().plannedStart).toBe('2026-10-08');
    expect(forward.json().workItems).toEqual(expect.arrayContaining([expect.objectContaining({
      id: customId, plannedStart: addBusinessDays('2026-09-16', forwardDelta), plannedEnd: addBusinessDays('2026-09-18', forwardDelta), actualStart: null,
    })]));

    const customAfterForward = forward.json().workItems.find((item: { id: string }) => item.id === customId);
    const manual = await app.inject({ method: 'PATCH', url: `/api/work-items/${customId}`, headers: { cookie }, payload: {
      plannedStart: '2026-10-08', plannedEnd: '2026-10-13', expectedVersion: customAfterForward.version, reason: '手工调整联调窗口',
    } });
    expect(manual.statusCode).toBe(200);
    expect(manual.json()).toMatchObject({ plannedStart: '2026-10-08', plannedEnd: '2026-10-13', actualStart: null });

    const beforeBackward = (await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie } })).json();
    const backwardDelta = businessDayDelta(beforeBackward.plannedEnd, '2026-10-16');
    const backward = await app.inject({ method: 'POST', url: `/api/requirements/${requirementId}/reschedule`, headers: { cookie }, payload: {
      scheduleMode: 'deadline', plannedEnd: '2026-10-16', expectedVersion: beforeBackward.version, reason: '按截止时间倒排顺延',
    } });
    expect(backward.statusCode).toBe(200);
    expect(backward.json()).toMatchObject({ plannedStart: addBusinessDays(beforeBackward.plannedStart, backwardDelta), plannedEnd: '2026-10-16' });
    expect(backward.json().workItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: customId, plannedStart: addBusinessDays(manual.json().plannedStart, backwardDelta), plannedEnd: addBusinessDays(manual.json().plannedEnd, backwardDelta), actualStart: null }),
    ]));
  });

  it('统一状态机执行自动完成、终态锁定、返工、历史只追加和版本冲突', async () => {
    const flow = await app.inject({ method: 'POST', url: '/api/templates', headers: { cookie }, payload: {
      projectId, name: `状态机验证-${randomUUID().slice(0, 6)}`,
      items: [{ title: '唯一执行项', startOffsetDays: 0, durationDays: 1, sortOrder: 0 }],
    } });
    const created = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie }, payload: {
      projectId, title: '状态机验收需求',  ownerId: personId, plannedStart: '2026-11-02', templateId: flow.json().id,
    } });
    const item = created.json().workItems[0];
    const assigned = await app.inject({ method: 'PATCH', url: `/api/work-items/${item.id}`, headers: { cookie }, payload: {
      ownerId: personId, expectedVersion: item.version,
    } });
    expect((await app.inject({ method: 'POST', url: `/api/work-items/${item.id}/start`, headers: { cookie } })).json().code).toBe('VALIDATION_ERROR');
    const started = await app.inject({ method: 'POST', url: `/api/work-items/${item.id}/start`, headers: { cookie }, payload: { expectedVersion: assigned.json().version } });
    const stale = await app.inject({ method: 'POST', url: `/api/requirements/${created.json().id}/progress`, headers: { cookie }, payload: {
      workItemId: item.id, workItemPercent: 20, content: '旧页面提交', expectedVersion: assigned.json().version,
    } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'STALE_WRITE', currentVersion: started.json().version });
    const progressed = await app.inject({ method: 'POST', url: `/api/requirements/${created.json().id}/progress`, headers: { cookie }, payload: {
      workItemId: item.id, workItemPercent: 50, content: '执行过半', expectedVersion: started.json().version,
    } });
    const progressedItem = progressed.json().workItems[0];
    const lower = await app.inject({ method: 'POST', url: `/api/requirements/${created.json().id}/progress`, headers: { cookie }, payload: {
      workItemId: item.id, workItemPercent: 40, content: '尝试降低', expectedVersion: progressedItem.version,
    } });
    expect(lower.statusCode).toBe(400);
    const completed = await app.inject({ method: 'POST', url: `/api/work-items/${item.id}/complete`, headers: { cookie }, payload: {
      content: '执行完成，提交验收', expectedVersion: progressedItem.version,
    } });
    const pending = (await app.inject({ method: 'GET', url: `/api/requirements/${created.json().id}`, headers: { cookie } })).json();
    expect(pending).toMatchObject({ status: 'completed', progress: 100, acceptedAt: null });
    const terminalEdit = await app.inject({ method: 'PATCH', url: `/api/requirements/${created.json().id}`, headers: { cookie }, payload: {
      title: '完成后维护标题', expectedVersion: pending.version,
    } });
    expect(terminalEdit.statusCode,terminalEdit.body).toBe(200);expect(terminalEdit.json()).toMatchObject({status:'completed',progress:100,title:'完成后维护标题'});
    const historyId = pending.progressUpdates[0].id;
    expect((await app.inject({ method: 'PATCH', url: `/api/progress/${historyId}`, headers: { cookie }, payload: { content: '覆盖历史' } })).json().code).toBe('HISTORY_IMMUTABLE');
    expect((await app.inject({ method: 'DELETE', url: `/api/progress/${historyId}`, headers: { cookie } })).json().code).toBe('HISTORY_IMMUTABLE');
    const reopened = await app.inject({ method: 'POST', url: `/api/work-items/${item.id}/reopen`, headers: { cookie }, payload: {
      reason: '验收发现遗漏，返工', progress: 80, expectedVersion: completed.json().version,
    } });
    expect(reopened.json()).toMatchObject({ status: 'in_progress', progress: 80, actualEnd: null });
    expect((await app.inject({ method: 'GET', url: `/api/requirements/${created.json().id}`, headers: { cookie } })).json()).toMatchObject({
      status: 'in_progress', acceptedAt: null, acceptedByAccountId: null,
    });

    const issue = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie }, payload: {
      projectId, title: '状态机问题', priority: 'P2', discoveredAt: '2026-09-02', dueDate: '2026-09-10',
    } });
    const issueAssigned = await app.inject({ method: 'PATCH', url: `/api/issues/${issue.json().id}`, headers: { cookie }, payload: { ownerId: personId, expectedVersion: issue.json().version } });
    const issueProgress = await app.inject({ method: 'POST', url: `/api/issues/${issue.json().id}/updates`, headers: { cookie }, payload: { content: '处理中', progress: 30, expectedVersion: issueAssigned.json().version } });
    const resolved = await app.inject({ method: 'POST', url: `/api/issues/${issue.json().id}/resolve`, headers: { cookie }, payload: { content: '问题闭环', expectedVersion: issueProgress.json().version } });
    expect((await app.inject({ method: 'POST', url: `/api/issues/${issue.json().id}/updates`, headers: { cookie }, payload: { content: '终态追加' } })).json().code).toBe('TERMINAL_LOCKED');
    const issueReopened = await app.inject({ method: 'POST', url: `/api/issues/${issue.json().id}/reopen`, headers: { cookie }, payload: { reason: '问题复现', progress: 20, expectedVersion: resolved.json().version } });
    expect(issueReopened.json()).toMatchObject({ status: 'in_progress', progress: 20, resolvedAt: null });
  });

  it('删除账号会终止登录但保留人员和业务归属', async () => {
    const name = `待删除账号-${randomUUID().slice(0, 6)}`;
    const createdPerson = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie }, payload: {
      projectId, name, jobTitle: '临时协作人员',
    } });
    expect(createdPerson.statusCode).toBe(200);
    const accountsBefore = (await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie } })).json();
    const disposable = accountsBefore.find((account: { personId: string }) => account.personId === createdPerson.json().id);
    const builtin = accountsBefore.find((account: { isBuiltin: boolean }) => account.isBuiltin);
    expect(disposable).toBeTruthy();
    expect((await app.inject({ method: 'DELETE', url: `/api/accounts/${builtin.id}`, headers: { cookie } })).statusCode).toBe(400);

    const promoted = await app.inject({ method: 'PUT', url: `/api/projects/${projectId}/members/${createdPerson.json().id}`, headers: { cookie }, payload: { role: 'manager' } });
    expect(promoted.json().projectRole).toBe('manager');
    const removed = await app.inject({ method: 'DELETE', url: `/api/accounts/${disposable.id}`, headers: { cookie } });
    expect(removed.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie } })).json()
      .some((account: { id: string }) => account.id === disposable.id)).toBe(false);
    expect((await app.inject({ method: 'POST', url: '/api/login', payload: { username: name, password: '888888' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/api/people?projectId=${projectId}`, headers: { cookie } })).json()
      .some((person: { id: string }) => person.id === createdPerson.json().id)).toBe(true);

    const { sqlite } = await import('./support/database');
    expect(sqlite.prepare('SELECT status,deleted_at AS deletedAt FROM accounts WHERE id=?').get(disposable.id))
      .toMatchObject({ status: 'disabled', deletedAt: expect.any(String) });
    expect(sqlite.prepare('SELECT project_role AS projectRole FROM project_people WHERE project_id=? AND person_id=?')
      .get(projectId, createdPerson.json().id)).toEqual({ projectRole: 'manager' });

    expect((await app.inject({ method: 'POST', url: `/api/people/${createdPerson.json().id}/account`, headers: { cookie: memberCookie } })).statusCode).toBe(403);
    const opened = await app.inject({ method: 'POST', url: `/api/people/${createdPerson.json().id}/account`, headers: { cookie } });
    expect(opened.statusCode).toBe(200);
    expect(opened.json()).toMatchObject({
      temporaryPassword: '888888',
      account: { id: disposable.id, username: name, status: 'active', role: 'project_manager', globalRole: 'user', mustChangePassword: true },
    });
    expect((await app.inject({ method: 'POST', url: `/api/people/${createdPerson.json().id}/account`, headers: { cookie } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/login', payload: { username: name, password: '888888' } })).statusCode).toBe(200);
    expect(sqlite.prepare('SELECT project_role AS projectRole FROM project_people WHERE project_id=? AND person_id=?')
      .get(projectId, createdPerson.json().id)).toEqual({ projectRole: 'manager' });
  });
});
