import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const dbPath = path.join(process.cwd(), 'data', `integration-${randomUUID()}.db`);
process.env.DB_PATH = dbPath;
process.env.BACKUP_DIR = path.join(process.cwd(), 'data', `backups-${randomUUID()}`);
process.env.BACKUP_MAX_COUNT = '3';
process.env.APP_USERNAME = 'tester';
process.env.APP_PASSWORD_HASH = 'scrypt$4c63a6f93ff4f94b031b7e7583592177$b598dbddaf9dd06678ff8756923d9e0a7f2d68eaa45bc644fbf4a73c9298970c7489671dfcfc8be282022c26a3370fb040f3f086a45faa1e1abde04bbe4a51ef';
process.env.SESSION_SECRET = 'test-session-secret-with-more-than-thirty-two-characters';

let app: FastifyInstance;
let cookie = '';
let projectId = '';
let requirementId = '';
let templateId = '';
let personId = '';
let collaboratorPersonId = '';
let firstWorkItemId = '';
let secondWorkItemId = '';
let issueId = '';
let memberCookie = '';
let memberAccountId = '';

beforeAll(async () => {
  const module = await import('../src/server/app');
  app = await module.buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  const { sqlite } = await import('../src/server/database');
  if (sqlite.open) sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
  fs.rmSync(process.env.BACKUP_DIR!, { recursive: true, force: true });
});

describe('自动化项目管理API', () => {
  it('未登录用户不能读取或写入业务数据', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/projects' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/projects', payload: { name: '无权限' } })).statusCode).toBe(401);
  });

  it('登录后创建项目内流程和自动排期需求', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: '41_xc7q0qOjo4Inw!' } });
    const setCookie = login.headers['set-cookie'];
    cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie!).split(';')[0];
    const project = await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie }, payload: { name: '集成测试项目' } });
    expect(project.statusCode).toBe(200);
    projectId = project.json().id;
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
      name: '并行交付模板', description: '根据复盘调整工期，保留并行交付策略。', items: template.json().items.map((item: any) => ({ ...item, durationDays: item.durationDays + 1 })),
    } });
    expect(updated.json().items.map((item: { id: string }) => item.id)).toEqual(originalIds);
    expect(updated.json().description).toBe('根据复盘调整工期，保留并行交付策略。');

    expect((await app.inject({ method: 'PATCH', url: '/api/projects/' + projectId, headers: { cookie }, payload: { defaultTemplateId: templateId } })).statusCode).toBe(200);
    const requirement = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie }, payload: {
      projectId, title: '自动排期需求', priority: 'P1', plannedStart: '2026-09-04', templateId,
    } });
    expect(requirement.statusCode).toBe(200); requirementId = requirement.json().id;
    expect(requirement.json().priority).toBe('P1');
    expect(requirement.json()).toMatchObject({ templateId, templateName: '并行交付模板' });
    expect(requirement.json().workItems).toHaveLength(3);
    expect(requirement.json().workItems[0]).toMatchObject({ plannedStart: '2026-09-04', plannedEnd: '2026-09-08', milestoneLabel: '需求基线' });
    expect(requirement.json().workItems[1].milestoneLabel).toBe('接口基线');
    expect(requirement.json().workItems[1].plannedStart).toBe('2026-09-04');
    expect(requirement.json().plannedEnd).toBe('2026-09-10');
    expect(requirement.json().status).toBe('not_started');
    firstWorkItemId = requirement.json().workItems[0].id;
  });

  it('人员姓名唯一、岗位可维护并可恢复归档', async () => {
    const person = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie }, payload: { projectId, name: '张三', jobTitle: '前端开发' } });
    expect(person.statusCode).toBe(200); personId = person.json().id;
    const updated = await app.inject({ method: 'PATCH', url: `/api/people/${personId}`, headers: { cookie }, payload: { name: '张三', jobTitle: '技术负责人' } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ name: '张三', jobTitle: '技术负责人' });
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

  it('公共问题支持看板、筛选搜索、进展和闭环', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie }, payload: {
      projectId, requirementId, title: '公共证书问题', impact: '影响项目联调', reporter: '测试人员',
      ownerId: personId, status: 'in_progress', priority: 'P1', discoveredAt: '2026-09-01', dueDate: '2000-01-01',
    } });
    expect(created.statusCode).toBe(200); issueId = created.json().id;
    expect(created.json()).toMatchObject({ title: '公共证书问题', ownerName: '张三', overdue: true });
    const update = await app.inject({ method: 'POST', url: `/api/issues/${issueId}/updates`, headers: { cookie }, payload: { content: '测试证书已经申请' } });
    expect(update.json().updates[0].content).toBe('测试证书已经申请');
    const searched = await app.inject({ method: 'GET', url: `/api/issues?projectId=${projectId}&q=${encodeURIComponent('测试证书')}&overdue=true`, headers: { cookie } });
    expect(searched.statusCode).toBe(200);
    expect(searched.json().items).toEqual([expect.objectContaining({ id: issueId, overdue: true })]);
    expect(searched.json().summary).toMatchObject({ total: 1, active: 1, inProgress: 1, highPriority: 1, overdue: 1, closureRate: 0 });
    const linkedDashboard = await app.inject({ method: 'GET', url: `/api/dashboard?projectId=${projectId}`, headers: { cookie } });
    expect(linkedDashboard.json().requirements[0].issueSummary).toEqual({ active: 1, overdue: 1 });
    expect((await app.inject({ method: 'PATCH', url: `/api/issues/${issueId}`, headers: { cookie }, payload: { status: 'resolved' } })).statusCode).toBe(400);
    const resolved = await app.inject({ method: 'PATCH', url: `/api/issues/${issueId}`, headers: { cookie }, payload: { status: 'resolved', updateContent: '证书已签发，问题闭环' } });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toMatchObject({ status: 'resolved', overdue: false });
    expect(resolved.json().resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(resolved.json().updates.map((item: { content: string }) => item.content)).toEqual(expect.arrayContaining(['测试证书已经申请', '证书已签发，问题闭环']));
    const publicIssue = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie }, payload: {
      projectId, title: '公共部署风险', impact: '影响多个需求交付', status: 'open', priority: 'P0', discoveredAt: '2026-09-01', dueDate: '2000-01-01',
    } });
    const dashboard = await app.inject({ method: 'GET', url: `/api/dashboard?projectId=${projectId}`, headers: { cookie } });
    expect(dashboard.json().issues.summary).toMatchObject({ total: 2, active: 1, resolved: 1, highPriority: 1, overdue: 1, closureRate: 50 });
    expect(dashboard.json().issues.attention).toEqual([expect.objectContaining({ id: publicIssue.json().id, title: '公共部署风险', overdue: true })]);
    expect(dashboard.json().requirements[0].issueSummary).toEqual({ active: 0, overdue: 0 });
    const activeIssues = await app.inject({ method: 'GET', url: `/api/issues?projectId=${projectId}&active=true`, headers: { cookie } });
    expect(activeIssues.json().items).toEqual([expect.objectContaining({ id: publicIssue.json().id, status: 'open' })]);
    const futureHigh = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie }, payload: {
      projectId, title: '未来高优先级问题', ownerId: personId, status: 'in_progress', priority: 'P0', discoveredAt: '2026-09-01', dueDate: '2999-12-31',
    } });
    const overdueLow = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie }, payload: {
      projectId, title: '逾期低优先级问题', ownerId: personId, status: 'in_progress', priority: 'P3', discoveredAt: '2026-09-01', dueDate: '2000-01-02',
    } });
    const ordered = await app.inject({ method: 'GET', url: `/api/issues?projectId=${projectId}&status=in_progress`, headers: { cookie } });
    expect(ordered.json().items.slice(0, 2).map((item: { id: string }) => item.id)).toEqual([overdueLow.json().id, futureHigh.json().id]);
    const deferred = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie }, payload: {
      projectId, title: '等待外部条件的问题', status: 'deferred', priority: 'P2', discoveredAt: '2026-09-01', dueDate: '2000-01-03',
    } });
    expect(deferred.json()).toMatchObject({ status: 'deferred', dueDate: null, overdue: false });
    const deferredByUpdate = await app.inject({ method: 'PATCH', url: `/api/issues/${futureHigh.json().id}`, headers: { cookie }, payload: { status: 'deferred' } });
    expect(deferredByUpdate.json()).toMatchObject({ status: 'deferred', dueDate: null, overdue: false });
    const dashboardWithoutDeferred = await app.inject({ method: 'GET', url: `/api/dashboard?projectId=${projectId}`, headers: { cookie } });
    expect(dashboardWithoutDeferred.json().issues.attention.every((item: { status: string }) => ['open', 'in_progress'].includes(item.status))).toBe(true);
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

    const { sqlite } = await import('../src/server/database');
    const now = new Date().toISOString();
    const archivedRequirementId = randomUUID();
    const archivedIssueId = randomUUID();
    sqlite.prepare(`INSERT INTO requirements
      (id,project_id,title,status,progress,risk_level,priority,created_at,updated_at,deleted_at)
      VALUES (?,?,'已归档分析需求','planning',0,'low','P2',?,?,?)`).run(archivedRequirementId, projectId, now, now, now);
    sqlite.prepare(`INSERT INTO issues
      (id,project_id,requirement_id,title,status,priority,discovered_at,created_at,updated_at)
      VALUES (?,?,?,'归档需求中的问题','open','P2','2026-09-01',?,?)`).run(archivedIssueId, projectId, archivedRequirementId, now, now);
    const archiveExcluded = await app.inject({ method: 'POST', url: '/api/analytics/query', headers: { cookie }, payload: {
      projectId, range: { from: '2026-09-01', to: '2026-09-30' }, panels,
    } });
    expect(archiveExcluded.json().results[0].rows[0].value).toBe(1);
    expect(archiveExcluded.json().results[1].rows[0]).toMatchObject({ value: 5, secondaryValue: 1 });
    sqlite.prepare('DELETE FROM issues WHERE id=?').run(archivedIssueId);
    sqlite.prepare('DELETE FROM requirements WHERE id=?').run(archivedRequirementId);

    const malformedIssueId = randomUUID();
    sqlite.prepare(`INSERT INTO issues
      (id,project_id,title,status,priority,discovered_at,created_at,updated_at)
      VALUES (?,?,'日期损坏的问题','open','P2','bad',?,?)`).run(malformedIssueId, projectId, now, now);
    const isolatedFailure = await app.inject({ method: 'POST', url: '/api/analytics/query', headers: { cookie }, payload: {
      projectId, range: { from: '2026-09-01', to: '2026-09-30' }, panels: [panels[0], {
        id: 'broken-panel', title: '损坏面板', dataset: 'issues', measure: 'count', dimension: 'week', visualization: 'line', size: 'medium', timeScope: 'snapshot',
      }],
    } });
    expect(isolatedFailure.statusCode).toBe(200);
    expect(isolatedFailure.json().results[0].error).toBeUndefined();
    expect(isolatedFailure.json().results[1].error).toBeTruthy();
    sqlite.prepare('DELETE FROM issues WHERE id=?').run(malformedIssueId);

    const requirementIds = [randomUUID(), randomUUID()];
    const insertRequirement = sqlite.prepare(`INSERT INTO requirements
      (id,project_id,title,status,planned_start,planned_end,progress,risk_level,priority,created_at,updated_at)
      VALUES (?,? ,?,'completed','2026-09-01','2026-09-10',100,'low','P2',?,?)`);
    const insertWorkItem = sqlite.prepare(`INSERT INTO work_items
      (id,requirement_id,title,status,planned_start,planned_end,actual_start,actual_end,sort_order,created_at,updated_at)
      VALUES (?,? ,?,'completed','2026-09-01','2026-09-10','2026-09-01',?, ?,?,?)`);
    insertRequirement.run(requirementIds[0], projectId, '按期完成需求', now, now);
    insertWorkItem.run(randomUUID(), requirementIds[0], '先完成工作项', '2026-09-08', 0, now, now);
    insertWorkItem.run(randomUUID(), requirementIds[0], '最后完成工作项', '2026-09-09', 1, now, now);
    insertRequirement.run(requirementIds[1], projectId, '延期完成需求', now, now);
    insertWorkItem.run(randomUUID(), requirementIds[1], '延期工作项', '2026-09-11', 0, now, now);
    const onTime = await app.inject({ method: 'POST', url: '/api/analytics/query', headers: { cookie }, payload: {
      projectId, range: { from: '2026-09-01', to: '2026-09-30' }, panels: [{
        id: 'on-time-test', title: '按期率', dataset: 'requirements', measure: 'on_time_rate', visualization: 'kpi', size: 'small', timeScope: 'range',
      }],
    } });
    expect(onTime.json().results[0].rows[0].value).toBe(50);
    sqlite.prepare(`DELETE FROM requirements WHERE id IN (?,?)`).run(...requirementIds);

    expect((await app.inject({ method: 'PUT', url: '/api/analytics/layout', payload: { version: 1, panels: [panels[0]] } })).statusCode).toBe(401);
    const saved = await app.inject({ method: 'PUT', url: '/api/analytics/layout', headers: { cookie }, payload: { version: 1, panels: [panels[0]] } });
    expect(saved.json()).toMatchObject({ source: 'personal', canCustomize: true, layout: { version: 1, panels: [{ id: 'active-test' }] } });
    expect((await app.inject({ method: 'GET', url: '/api/analytics/layout', headers: { cookie } })).json()).toMatchObject({ source: 'personal' });
    const otherLogin = await app.inject({ method: 'POST', url: '/api/login', payload: { username: '李四', password: '888888' } });
    const otherCookie = String(otherLogin.headers['set-cookie']).split(';')[0];
    expect((await app.inject({ method: 'GET', url: '/api/analytics/layout', headers: { cookie: otherCookie } })).statusCode).toBe(403);
    const invalid = await app.inject({ method: 'PUT', url: '/api/analytics/layout', headers: { cookie }, payload: {
      version: 1, panels: [{ ...panels[0], dataset: 'sql' }],
    } });
    expect(invalid.statusCode).toBe(400);

    const session = (await app.inject({ method: 'GET', url: '/api/session', headers: { cookie } })).json();
    sqlite.prepare('UPDATE analytics_layouts SET config_json=? WHERE account_id=?').run('{broken', session.accountId);
    expect((await app.inject({ method: 'GET', url: '/api/analytics/layout', headers: { cookie } })).json()).toMatchObject({ source: 'default', layout: { version: 1 } });
    const reset = await app.inject({ method: 'DELETE', url: '/api/analytics/layout', headers: { cookie } });
    expect(reset.json()).toMatchObject({ source: 'default', canCustomize: true });
    const audit = await app.inject({ method: 'GET', url: '/api/audit/search?entityType=analytics_layout&pageSize=20', headers: { cookie } });
    expect(audit.json().items.map((item: { action: string }) => item.action)).toEqual(expect.arrayContaining(['update', 'reset']));
  });

  it('工作项事件自动推导状态、工期加权进度和进展快照', async () => {
    const singleOwner = await app.inject({ method: 'PATCH', url: `/api/work-items/${firstWorkItemId}`, headers: { cookie }, payload: { ownerId: personId } });
    expect(singleOwner.json()).toMatchObject({ ownerId: personId, collaborators: [], assigneeIds: [personId] });
    const collaborative = await app.inject({ method: 'PATCH', url: `/api/work-items/${firstWorkItemId}`, headers: { cookie }, payload: { ownerId: personId, assigneeIds: [personId, collaboratorPersonId] } });
    expect(collaborative.json().collaborators).toEqual([expect.objectContaining({ id: collaboratorPersonId, name: '李四' })]);
    expect(collaborative.json().assigneeIds).toEqual([personId, collaboratorPersonId]);
    expect((await app.inject({ method: 'POST', url: `/api/work-items/${firstWorkItemId}/start`, headers: { cookie } })).json().status).toBe('in_progress');
    const completed = await app.inject({ method: 'POST', url: `/api/work-items/${firstWorkItemId}/complete`, headers: { cookie } });
    expect(completed.json().status).toBe('completed');
    const progress = await app.inject({ method: 'POST', url: `/api/requirements/${requirementId}/progress`, headers: { cookie }, payload: { content: '完成设计评审', workItemId: firstWorkItemId, workItemPercent: 100 } });
    expect(progress.json().progress).toBe(30);
    expect(progress.json().progressUpdates[0]).toMatchObject({ percent: 30, content: '完成设计评审' });
    const dashboard = await app.inject({ method: 'GET', url: `/api/dashboard?projectId=${projectId}`, headers: { cookie } });
    expect(dashboard.json().requirements[0].recentProgressUpdates).toEqual([
      expect.objectContaining({ content: '完成设计评审', workItemId: firstWorkItemId }),
    ]);

    const second = progress.json().workItems[1];
    secondWorkItemId = second.id;
    await app.inject({ method: 'PATCH', url: `/api/work-items/${second.id}`, headers: { cookie }, payload: { ownerId: personId, assigneeIds: [personId, collaboratorPersonId] } });
    const blocked = await app.inject({ method: 'POST', url: `/api/work-items/${second.id}/block`, headers: { cookie }, payload: { reason: '接口未确定' } });
    expect(blocked.json().status).toBe('blocked');
    expect((await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie } })).json().riskLevel).toBe('high');
    expect((await app.inject({ method: 'POST', url: `/api/work-items/${second.id}/unblock`, headers: { cookie } })).json().status).toBe('not_started');
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
      projectId, requirementId, title: '普通用户提交的问题', reporter: '李四', priority: 'P1', status: 'resolved', ownerId: personId,
    } });
    expect(userIssue.statusCode).toBe(200);
    expect(userIssue.json()).toMatchObject({ status: 'open', ownerId: null, reporter: '李四' });
    expect((await app.inject({ method: 'POST', url: `/api/issues/${userIssue.json().id}/updates`, headers: { cookie: userCookie }, payload: { content: '已经补充复现步骤' } })).statusCode).toBe(200);
    const assignedIssue = await app.inject({ method: 'PATCH', url: `/api/issues/${userIssue.json().id}`, headers: { cookie }, payload: { ownerId: collaboratorPersonId, status: 'in_progress', progress: 0 } });
    expect(assignedIssue.json()).toMatchObject({ ownerId: collaboratorPersonId, status: 'in_progress', progress: 0 });
    const ownerProgress = await app.inject({ method: 'POST', url: `/api/issues/${userIssue.json().id}/updates`, headers: { cookie: userCookie }, payload: { content: '修复方案已完成验证', progress: 60 } });
    expect(ownerProgress.json()).toMatchObject({ progress: 60, status: 'in_progress' });
    expect(ownerProgress.json().updates[0]).toMatchObject({ progress: 60, createdByName: '李四' });
    expect((await app.inject({ method: 'POST', url: `/api/issues/${userIssue.json().id}/updates`, headers: { cookie: userCookie }, payload: { content: '尝试自行关闭', progress: 100 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: `/api/issues/${userIssue.json().id}`, headers: { cookie: userCookie }, payload: { status: 'resolved', updateContent: '自行关闭' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/api/work-items/${secondWorkItemId}`, headers: { cookie: userCookie }, payload: { plannedEnd: '2026-12-31' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/work-items/${secondWorkItemId}/start`, headers: { cookie: userCookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/requirements/${requirementId}/progress`, headers: { cookie: userCookie }, payload: { workItemId: secondWorkItemId, workItemPercent: 20, content: '协作联调已开始' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie: userCookie }, payload: { projectId, title: '越权需求', priority: 'P2', plannedStart: '2026-09-08', templateId } })).statusCode).toBe(403);

    const promoted = await app.inject({ method: 'PATCH', url: `/api/accounts/${userAccount.id}`, headers: { cookie }, payload: { username: '李四', status: 'active', role: 'project_manager', managedProjectIds: [projectId] } });
    expect(promoted.json()).toMatchObject({ role: 'project_manager' });
    const managerClosedIssue = await app.inject({ method: 'PATCH', url: `/api/issues/${userIssue.json().id}`, headers: { cookie: userCookie }, payload: { status: 'resolved', updateContent: '项目经理确认问题已解决' } });
    expect(managerClosedIssue.statusCode).toBe(200);
    expect(managerClosedIssue.json()).toMatchObject({ status: 'resolved', progress: 100 });
    expect(managerClosedIssue.json().updates[0].content).toBe('项目经理确认问题已解决');
    expect((await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie: userCookie }, payload: { projectId, title: '经理创建需求', priority: 'P2', plannedStart: '2026-09-08', templateId } })).statusCode).toBe(200);
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
    expect((await app.inject({ method: 'GET', url: `/api/requirements?projectId=${projectId}`, headers: { cookie: outsiderCookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie: outsiderCookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/issues/${issueId}`, headers: { cookie: outsiderCookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/analytics/query', headers: { cookie: outsiderCookie }, payload: {
      projectId, range: { from: '2026-09-01', to: '2026-09-30' }, panels: [{
        id: 'cross-project', title: '越权统计', dataset: 'requirements', measure: 'active_count', visualization: 'kpi', size: 'small', timeScope: 'snapshot',
      }],
    } })).statusCode).toBe(403);

    const rejectedCrossProjectFlow = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie }, payload: {
      projectId: isolatedProjectId, title: '错误跨项目流程', priority: 'P2', plannedStart: '2026-09-10', templateId,
    } });
    expect(rejectedCrossProjectFlow.statusCode).toBe(400);
    const copied = await app.inject({ method: 'POST', url: `/api/projects/${isolatedProjectId}/templates/${templateId}/copy`, headers: { cookie } });
    expect(copied.statusCode).toBe(200);
    expect(copied.json()).toMatchObject({ projectId: isolatedProjectId, name: '并行交付模板（副本）' });
    const isolatedRequirement = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie }, payload: {
      projectId: isolatedProjectId, title: '独立流程需求', priority: 'P2', plannedStart: '2026-09-10', templateId: copied.json().id,
    } });
    expect(isolatedRequirement.statusCode).toBe(200);

    expect((await app.inject({ method: 'PUT', url: `/api/projects/${projectId}/members/${personId}`, headers: { cookie: memberCookie }, payload: { role: 'manager' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/projects/${projectId}/members/${collaboratorPersonId}`, headers: { cookie: memberCookie } })).statusCode).toBe(403);
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
    await app.inject({ method: 'PATCH', url: `/api/work-items/${item.id}`, headers: { cookie }, payload: { plannedStart: '' } });
    const preview = await app.inject({ method: 'POST', url: `/api/requirements/${requirementId}/plan-preview`, headers: { cookie }, payload: { templateId, baseStart: before.plannedStart } });
    const entry = preview.json().entries.find((value: { workItemId: string }) => value.workItemId === item.id);
    expect(entry).toMatchObject({ currentStart: null, currentEnd: item.plannedEnd, willChange: true });
    await app.inject({ method: 'POST', url: `/api/requirements/${requirementId}/apply-plan`, headers: { cookie }, payload: { templateId, baseStart: before.plannedStart, templateItemIds: [entry.templateItemId] } });
    const after = (await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie } })).json().workItems.find((value: { id: string }) => value.id === item.id);
    expect(after.plannedStart).toBe(entry.proposedStart);
    expect(after.plannedEnd).toBe(item.plannedEnd);
  });

  it('人员并发统计使用负责人和计划/实际区间', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/analytics/people-concurrency?projectId=${projectId}&personId=${personId}`, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const person = response.json().people[0];
    expect(person.name).toBe('张三');
    expect(person.currentCount).toBeGreaterThanOrEqual(1);
    const collaboratorResponse = await app.inject({ method: 'GET', url: `/api/analytics/people-concurrency?projectId=${projectId}&personId=${collaboratorPersonId}`, headers: { cookie } });
    expect(collaboratorResponse.json().people[0]).toMatchObject({ name: '李四' });
    expect(collaboratorResponse.json().people[0].currentCount).toBeGreaterThanOrEqual(1);
  });

  it('只能永久删除归档内容并安全处理关联数据', async () => {
    const project = await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie }, payload: {
      name: '待永久删除项目',
    } });
    const disposableProjectId = project.json().id as string;
    const template = await app.inject({ method: 'POST', url: '/api/templates', headers: { cookie }, payload: {
      projectId: disposableProjectId, name: '待永久删除模板', items: [{ title: '临时工作项', startOffsetDays: 0, durationDays: 1, sortOrder: 0 }],
    } });
    const disposableTemplateId = template.json().id as string;
    expect((await app.inject({ method: 'PATCH', url: `/api/projects/${disposableProjectId}`, headers: { cookie }, payload: { defaultTemplateId: disposableTemplateId } })).statusCode).toBe(200);
    const requirement = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie }, payload: {
      projectId: disposableProjectId, title: '待永久删除需求', priority: 'P2', plannedStart: '2026-09-07', templateId: disposableTemplateId,
    } });
    const disposableRequirementId = requirement.json().id as string;
    const disposableWorkItemId = requirement.json().workItems[0].id as string;
    const person = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie }, payload: { projectId: disposableProjectId, name: '待永久删除人员', jobTitle: '临时岗位' } });
    const disposablePersonId = person.json().id as string;
    await app.inject({ method: 'PATCH', url: `/api/work-items/${disposableWorkItemId}`, headers: { cookie }, payload: { ownerId: disposablePersonId } });

    expect((await app.inject({ method: 'DELETE', url: `/api/archives/projects/${disposableProjectId}`, headers: { cookie } })).statusCode).toBe(400);

    await app.inject({ method: 'DELETE', url: `/api/people/${disposablePersonId}`, headers: { cookie } });
    expect((await app.inject({ method: 'DELETE', url: `/api/archives/people/${disposablePersonId}`, headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/requirements/${disposableRequirementId}`, headers: { cookie } })).json().workItems[0].ownerId).toBeNull();

    await app.inject({ method: 'DELETE', url: `/api/templates/${disposableTemplateId}`, headers: { cookie } });
    expect((await app.inject({ method: 'DELETE', url: `/api/archives/templates/${disposableTemplateId}`, headers: { cookie } })).statusCode).toBe(200);
    const afterTemplateDelete = (await app.inject({ method: 'GET', url: `/api/requirements/${disposableRequirementId}`, headers: { cookie } })).json();
    expect(afterTemplateDelete.workItems[0].templateItemId).toBeNull();
    const projectAfterTemplateDelete = (await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie } })).json().find((item: { id: string }) => item.id === disposableProjectId);
    expect(projectAfterTemplateDelete.defaultTemplateId).toBeNull();

    await app.inject({ method: 'DELETE', url: `/api/requirements/${disposableRequirementId}`, headers: { cookie } });
    expect((await app.inject({ method: 'DELETE', url: `/api/archives/requirements/${disposableRequirementId}`, headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/archives', headers: { cookie } })).json().requirements.some((item: { id: string }) => item.id === disposableRequirementId)).toBe(false);

    await app.inject({ method: 'DELETE', url: `/api/projects/${disposableProjectId}`, headers: { cookie } });
    expect((await app.inject({ method: 'DELETE', url: `/api/archives/projects/${disposableProjectId}`, headers: { cookie } })).statusCode).toBe(200);
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
    const initialize = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'vitest', version: '1.0.0' } } } });
    expect(initialize.statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    const call = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'people_concurrency', arguments: { projectId } } } });
    expect(call.statusCode).toBe(200);
    expect(JSON.stringify(call.json())).toContain('张三');
    const write = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'add_progress', arguments: { requirementId, content: 'MCP来源识别测试' } } } });
    expect(write.statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/api/accounts/${memberAccountId}`, headers: { cookie }, payload: { status: 'disabled' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_projects', arguments: {} } } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PATCH', url: `/api/accounts/${memberAccountId}`, headers: { cookie }, payload: { status: 'active' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_projects', arguments: {} } } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/tokens/${tokenId}`, headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'list_projects', arguments: {} } } })).statusCode).toBe(401);
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
    expect((await app.inject({ method: 'DELETE', url: `/api/backups/${encodeURIComponent(response.json().name)}`, headers: { cookie } })).statusCode).toBe(200);
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
      items: sourceTemplate.items.map((item: any, index: number) => ({ ...item, title: index === 0 ? `${item.title}（新版）` : item.title, milestoneLabel: index === 0 ? '新版需求基线' : item.milestoneLabel, durationDays: item.durationDays + 1 })),
    } });
    expect(changedTemplate.statusCode).toBe(200);
    const afterTemplateEdit = (await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie } })).json();
    expect(afterTemplateEdit.workItems.map((item: any) => ({ id: item.id, title: item.title, milestoneLabel: item.milestoneLabel, plannedStart: item.plannedStart, plannedEnd: item.plannedEnd, actualStart: item.actualStart, actualEnd: item.actualEnd }))).toEqual(workItemSnapshot);

    const replacement = await app.inject({ method: 'POST', url: '/api/templates', headers: { cookie }, payload: {
      projectId, name: '重选流程测试', items: [{ title: '重新梳理', startOffsetDays: 0, durationDays: 2, milestoneLabel: '重规划基线', sortOrder: 0 }],
    } });
    const resetPayload = { templateId: replacement.json().id, plannedStart: '2026-09-14' };
    expect((await app.inject({ method: 'PATCH', url: `/api/requirements/${requirementId}`, headers: { cookie }, payload: resetPayload })).statusCode).toBe(400);
    const reset = await app.inject({ method: 'PATCH', url: `/api/requirements/${requirementId}`, headers: { cookie }, payload: { ...resetPayload, confirmTemplateReset: true } });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({ templateId: replacement.json().id, templateName: '重选流程测试', plannedStart: '2026-09-14', progress: 0, progressUpdates: [] });
    expect(reset.json().workItems).toEqual([expect.objectContaining({ title: '重新梳理', milestoneLabel: '重规划基线', status: 'not_started', ownerId: null, actualStart: null, actualEnd: null, plannedStart: '2026-09-14', plannedEnd: '2026-09-15' })]);
    expect(reset.json().workItems.some((item: { id: string }) => workItemSnapshot.some((old: { id: string }) => old.id === item.id))).toBe(false);
  });

  it('编辑需求可正排倒排并保留自定义工作项排期', async () => {
    const custom = await app.inject({ method: 'POST', url: `/api/requirements/${requirementId}/work-items`, headers: { cookie }, payload: {
      title: '自定义联调窗口', milestoneLabel: '联调基线', plannedStart: '2026-09-16', plannedEnd: '2026-09-18', actualStart: '2026-09-10',
    } });
    expect(custom.statusCode).toBe(200);
    expect(custom.json().milestoneLabel).toBe('联调基线');
    const customId = custom.json().id;
    const renamedMilestone = await app.inject({ method: 'PATCH', url: `/api/work-items/${customId}`, headers: { cookie }, payload: { milestoneLabel: '联调冻结基线' } });
    expect(renamedMilestone.json().milestoneLabel).toBe('联调冻结基线');

    const forward = await app.inject({ method: 'PATCH', url: `/api/requirements/${requirementId}`, headers: { cookie }, payload: {
      scheduleMode: 'start', plannedStart: '2026-10-05',
    } });
    expect(forward.statusCode).toBe(200);
    expect(forward.json()).toMatchObject({ plannedStart: '2026-10-05', plannedEnd: '2026-10-09' });
    expect(forward.json().workItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '重新梳理', plannedStart: '2026-10-05', plannedEnd: '2026-10-06' }),
      expect.objectContaining({ id: customId, plannedStart: '2026-10-07', plannedEnd: '2026-10-09', actualStart: '2026-09-10' }),
    ]));

    const manual = await app.inject({ method: 'PATCH', url: `/api/work-items/${customId}`, headers: { cookie }, payload: {
      plannedStart: '2026-10-08', plannedEnd: '2026-10-13',
    } });
    expect(manual.statusCode).toBe(200);
    expect(manual.json()).toMatchObject({ plannedStart: '2026-10-08', plannedEnd: '2026-10-13', actualStart: '2026-09-10' });

    const backward = await app.inject({ method: 'PATCH', url: `/api/requirements/${requirementId}`, headers: { cookie }, payload: {
      scheduleMode: 'deadline', plannedEnd: '2026-10-16',
    } });
    expect(backward.statusCode).toBe(200);
    expect(backward.json()).toMatchObject({ plannedStart: '2026-10-08', plannedEnd: '2026-10-16' });
    expect(backward.json().workItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '重新梳理', plannedStart: '2026-10-08', plannedEnd: '2026-10-09' }),
      expect.objectContaining({ id: customId, plannedStart: '2026-10-13', plannedEnd: '2026-10-16', actualStart: '2026-09-10' }),
    ]));
  });
});
