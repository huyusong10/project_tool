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
  it('访客只能读取，未登录写入返回401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/projects' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/projects', payload: { name: '无权限' } })).statusCode).toBe(401);
  });

  it('登录后创建结构化模板、项目和自动排期需求', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: '41_xc7q0qOjo4Inw!' } });
    const setCookie = login.headers['set-cookie'];
    cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie!).split(';')[0];
    const template = await app.inject({ method: 'POST', url: '/api/templates', headers: { cookie }, payload: {
      name: '并行交付模板', description: '设计与开发并行启动，测试提前介入。', items: [
        { title: '设计', startOffsetDays: 0, durationDays: 2, sortOrder: 0 },
        { title: '开发', startOffsetDays: 0, durationDays: 3, sortOrder: 1 },
        { title: '测试', startOffsetDays: 2, durationDays: 2, sortOrder: 2 },
      ],
    } });
    expect(template.statusCode).toBe(200); templateId = template.json().id;
    expect(template.json().description).toBe('设计与开发并行启动，测试提前介入。');
    const originalIds = template.json().items.map((item: { id: string }) => item.id);
    const updated = await app.inject({ method: 'PATCH', url: `/api/templates/${templateId}`, headers: { cookie }, payload: {
      name: '并行交付模板', description: '根据复盘调整工期，保留并行交付策略。', items: template.json().items.map((item: any) => ({ ...item, durationDays: item.durationDays + 1 })),
    } });
    expect(updated.json().items.map((item: { id: string }) => item.id)).toEqual(originalIds);
    expect(updated.json().description).toBe('根据复盘调整工期，保留并行交付策略。');

    const project = await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie }, payload: { name: '集成测试项目', defaultTemplateId: templateId } });
    projectId = project.json().id;
    const requirement = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie }, payload: {
      projectId, title: '自动排期需求', priority: 'P1', plannedStart: '2026-09-04', templateId,
    } });
    expect(requirement.statusCode).toBe(200); requirementId = requirement.json().id;
    expect(requirement.json().priority).toBe('P1');
    expect(requirement.json()).toMatchObject({ templateId, templateName: '并行交付模板' });
    expect(requirement.json().workItems).toHaveLength(3);
    expect(requirement.json().workItems[0]).toMatchObject({ plannedStart: '2026-09-04', plannedEnd: '2026-09-08' });
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
    expect((await app.inject({ method: 'GET', url: `/api/people?projectId=${projectId}` })).json().map((item: { name: string }) => item.name)).toEqual(expect.arrayContaining(['李四', '张三']));
    expect((await app.inject({ method: 'DELETE', url: `/api/projects/${projectId}/people/${collaboratorPersonId}`, headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/people?projectId=${projectId}` })).json().some((item: { id: string }) => item.id === collaboratorPersonId)).toBe(false);
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
    const searched = await app.inject({ method: 'GET', url: `/api/issues?projectId=${projectId}&q=${encodeURIComponent('测试证书')}&overdue=true` });
    expect(searched.statusCode).toBe(200);
    expect(searched.json().items).toEqual([expect.objectContaining({ id: issueId, overdue: true })]);
    expect(searched.json().summary).toMatchObject({ total: 1, active: 1, inProgress: 1, highPriority: 1, overdue: 1, closureRate: 0 });
    const linkedDashboard = await app.inject({ method: 'GET', url: `/api/dashboard?projectId=${projectId}` });
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
    const dashboard = await app.inject({ method: 'GET', url: `/api/dashboard?projectId=${projectId}` });
    expect(dashboard.json().issues.summary).toMatchObject({ total: 2, active: 1, resolved: 1, highPriority: 1, overdue: 1, closureRate: 50 });
    expect(dashboard.json().issues.attention).toEqual([expect.objectContaining({ id: publicIssue.json().id, title: '公共部署风险', overdue: true })]);
    expect(dashboard.json().requirements[0].issueSummary).toEqual({ active: 0, overdue: 0 });
    const activeIssues = await app.inject({ method: 'GET', url: `/api/issues?projectId=${projectId}&active=true` });
    expect(activeIssues.json().items).toEqual([expect.objectContaining({ id: publicIssue.json().id, status: 'open' })]);
    const futureHigh = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie }, payload: {
      projectId, title: '未来高优先级问题', ownerId: personId, status: 'in_progress', priority: 'P0', discoveredAt: '2026-09-01', dueDate: '2999-12-31',
    } });
    const overdueLow = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie }, payload: {
      projectId, title: '逾期低优先级问题', ownerId: personId, status: 'in_progress', priority: 'P3', discoveredAt: '2026-09-01', dueDate: '2000-01-02',
    } });
    const ordered = await app.inject({ method: 'GET', url: `/api/issues?projectId=${projectId}&status=in_progress` });
    expect(ordered.json().items.slice(0, 2).map((item: { id: string }) => item.id)).toEqual([overdueLow.json().id, futureHigh.json().id]);
    const deferred = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie }, payload: {
      projectId, title: '等待外部条件的问题', status: 'deferred', priority: 'P2', discoveredAt: '2026-09-01', dueDate: '2000-01-03',
    } });
    expect(deferred.json()).toMatchObject({ status: 'deferred', dueDate: null, overdue: false });
    const deferredByUpdate = await app.inject({ method: 'PATCH', url: `/api/issues/${futureHigh.json().id}`, headers: { cookie }, payload: { status: 'deferred' } });
    expect(deferredByUpdate.json()).toMatchObject({ status: 'deferred', dueDate: null, overdue: false });
    const dashboardWithoutDeferred = await app.inject({ method: 'GET', url: `/api/dashboard?projectId=${projectId}` });
    expect(dashboardWithoutDeferred.json().issues.attention.every((item: { status: string }) => ['open', 'in_progress'].includes(item.status))).toBe(true);
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
    const progress = await app.inject({ method: 'POST', url: `/api/requirements/${requirementId}/progress`, headers: { cookie }, payload: { content: '完成设计评审', workItemId: firstWorkItemId } });
    expect(progress.json().progress).toBe(30);
    expect(progress.json().progressUpdates[0]).toMatchObject({ percent: 30, content: '完成设计评审' });
    const dashboard = await app.inject({ method: 'GET', url: `/api/dashboard?projectId=${projectId}` });
    expect(dashboard.json().requirements[0].recentProgressUpdates).toEqual([
      expect.objectContaining({ content: '完成设计评审', workItemId: firstWorkItemId }),
    ]);

    const second = progress.json().workItems[1];
    secondWorkItemId = second.id;
    await app.inject({ method: 'PATCH', url: `/api/work-items/${second.id}`, headers: { cookie }, payload: { ownerId: personId, assigneeIds: [personId, collaboratorPersonId] } });
    const blocked = await app.inject({ method: 'POST', url: `/api/work-items/${second.id}/block`, headers: { cookie }, payload: { reason: '接口未确定' } });
    expect(blocked.json().status).toBe('blocked');
    expect((await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}` })).json().riskLevel).toBe('high');
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
    expect((await app.inject({ method: 'GET', url: '/api/my-work', headers: { cookie: userCookie } })).json().items.some((item: { id: string }) => item.id === secondWorkItemId)).toBe(true);
    const userIssue = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie: userCookie }, payload: {
      projectId, requirementId, title: '普通用户提交的问题', reporter: '李四', priority: 'P1', status: 'resolved', ownerId: personId,
    } });
    expect(userIssue.statusCode).toBe(200);
    expect(userIssue.json()).toMatchObject({ status: 'open', ownerId: null, reporter: '李四' });
    expect((await app.inject({ method: 'POST', url: `/api/issues/${userIssue.json().id}/updates`, headers: { cookie: userCookie }, payload: { content: '已经补充复现步骤' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/api/issues/${userIssue.json().id}`, headers: { cookie: userCookie }, payload: { status: 'resolved', updateContent: '自行关闭' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/api/work-items/${secondWorkItemId}`, headers: { cookie: userCookie }, payload: { plannedEnd: '2026-12-31' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/work-items/${secondWorkItemId}/start`, headers: { cookie: userCookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/requirements/${requirementId}/progress`, headers: { cookie: userCookie }, payload: { workItemId: secondWorkItemId, content: '协作联调已开始' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie: userCookie }, payload: { projectId, title: '越权需求', priority: 'P2', plannedStart: '2026-09-08', templateId } })).statusCode).toBe(403);

    const promoted = await app.inject({ method: 'PATCH', url: `/api/accounts/${userAccount.id}`, headers: { cookie }, payload: { username: '李四', status: 'active', role: 'project_manager', managedProjectIds: [projectId] } });
    expect(promoted.json()).toMatchObject({ role: 'project_manager' });
    const managerClosedIssue = await app.inject({ method: 'PATCH', url: `/api/issues/${userIssue.json().id}`, headers: { cookie: userCookie }, payload: { status: 'resolved', updateContent: '项目经理确认问题已解决' } });
    expect(managerClosedIssue.statusCode).toBe(200);
    expect(managerClosedIssue.json()).toMatchObject({ status: 'resolved' });
    expect(managerClosedIssue.json().updates[0].content).toBe('项目经理确认问题已解决');
    expect((await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie: userCookie }, payload: { projectId, title: '经理创建需求', priority: 'P2', plannedStart: '2026-09-08', templateId } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/templates', headers: { cookie: userCookie }, payload: { name: '越权模板', items: [{ title: '工作', startOffsetDays: 0, durationDays: 1, sortOrder: 0 }] } })).statusCode).toBe(403);
  });

  it('补全计划预览只回填空值且不覆盖已有结束日期', async () => {
    const before = (await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}` })).json();
    const item = before.workItems[2];
    await app.inject({ method: 'PATCH', url: `/api/work-items/${item.id}`, headers: { cookie }, payload: { plannedStart: '' } });
    const preview = await app.inject({ method: 'POST', url: `/api/requirements/${requirementId}/plan-preview`, headers: { cookie }, payload: { templateId, baseStart: before.plannedStart } });
    const entry = preview.json().entries.find((value: { workItemId: string }) => value.workItemId === item.id);
    expect(entry).toMatchObject({ currentStart: null, currentEnd: item.plannedEnd, willChange: true });
    await app.inject({ method: 'POST', url: `/api/requirements/${requirementId}/apply-plan`, headers: { cookie }, payload: { templateId, baseStart: before.plannedStart, templateItemIds: [entry.templateItemId] } });
    const after = (await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}` })).json().workItems.find((value: { id: string }) => value.id === item.id);
    expect(after.plannedStart).toBe(entry.proposedStart);
    expect(after.plannedEnd).toBe(item.plannedEnd);
  });

  it('人员并发统计使用负责人和计划/实际区间', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/analytics/people-concurrency?projectId=${projectId}&personId=${personId}` });
    expect(response.statusCode).toBe(200);
    const person = response.json().people[0];
    expect(person.name).toBe('张三');
    expect(person.currentCount).toBeGreaterThanOrEqual(1);
    const collaboratorResponse = await app.inject({ method: 'GET', url: `/api/analytics/people-concurrency?projectId=${projectId}&personId=${collaboratorPersonId}` });
    expect(collaboratorResponse.json().people[0]).toMatchObject({ name: '李四' });
    expect(collaboratorResponse.json().people[0].currentCount).toBeGreaterThanOrEqual(1);
  });

  it('只能永久删除归档内容并安全处理关联数据', async () => {
    const template = await app.inject({ method: 'POST', url: '/api/templates', headers: { cookie }, payload: {
      name: '待永久删除模板', items: [{ title: '临时工作项', startOffsetDays: 0, durationDays: 1, sortOrder: 0 }],
    } });
    const disposableTemplateId = template.json().id as string;
    const project = await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie }, payload: {
      name: '待永久删除项目', defaultTemplateId: disposableTemplateId,
    } });
    const disposableProjectId = project.json().id as string;
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
    expect((await app.inject({ method: 'GET', url: `/api/requirements/${disposableRequirementId}` })).json().workItems[0].ownerId).toBeNull();

    await app.inject({ method: 'DELETE', url: `/api/templates/${disposableTemplateId}`, headers: { cookie } });
    expect((await app.inject({ method: 'DELETE', url: `/api/archives/templates/${disposableTemplateId}`, headers: { cookie } })).statusCode).toBe(200);
    const afterTemplateDelete = (await app.inject({ method: 'GET', url: `/api/requirements/${disposableRequirementId}` })).json();
    expect(afterTemplateDelete.workItems[0].templateItemId).toBeNull();
    const projectAfterTemplateDelete = (await app.inject({ method: 'GET', url: '/api/projects' })).json().find((item: { id: string }) => item.id === disposableProjectId);
    expect(projectAfterTemplateDelete.defaultTemplateId).toBeNull();

    await app.inject({ method: 'DELETE', url: `/api/requirements/${disposableRequirementId}`, headers: { cookie } });
    expect((await app.inject({ method: 'DELETE', url: `/api/archives/requirements/${disposableRequirementId}`, headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/archives', headers: { cookie } })).json().requirements.some((item: { id: string }) => item.id === disposableRequirementId)).toBe(false);

    await app.inject({ method: 'DELETE', url: `/api/projects/${disposableProjectId}`, headers: { cookie } });
    expect((await app.inject({ method: 'DELETE', url: `/api/archives/projects/${disposableProjectId}`, headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/projects?includeDeleted=true' })).json().some((item: { id: string }) => item.id === disposableProjectId)).toBe(false);
  });

  it('Token只展示一次并可调用新版MCP工具', async () => {
    const tokenResponse = await app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie }, payload: { name: '测试Token', expiresInDays: 90 } });
    const token = tokenResponse.json().token as string;
    const headers = { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json' };
    const initialize = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'vitest', version: '1.0.0' } } } });
    expect(initialize.statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    const call = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'people_concurrency', arguments: { projectId } } } });
    expect(call.statusCode).toBe(200);
    expect(JSON.stringify(call.json())).toContain('张三');
    const write = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'add_progress', arguments: { requirementId, content: 'MCP来源识别测试' } } } });
    expect(write.statusCode).toBe(200);
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
    expect(audit.json().some((item: { actorType: string; actorName: string; tokenName: string }) => item.actorType === 'token' && item.actorName === 'admin' && item.tokenName === '测试Token')).toBe(true);
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
    const before = (await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}` })).json();
    const workItemSnapshot = before.workItems.map((item: any) => ({ id: item.id, title: item.title, plannedStart: item.plannedStart, plannedEnd: item.plannedEnd, actualStart: item.actualStart, actualEnd: item.actualEnd }));
    const sourceTemplate = (await app.inject({ method: 'GET', url: '/api/templates' })).json().find((item: { id: string }) => item.id === templateId);
    const changedTemplate = await app.inject({ method: 'PATCH', url: `/api/templates/${templateId}`, headers: { cookie }, payload: {
      name: sourceTemplate.name, description: sourceTemplate.description,
      items: sourceTemplate.items.map((item: any, index: number) => ({ ...item, title: index === 0 ? `${item.title}（新版）` : item.title, durationDays: item.durationDays + 1 })),
    } });
    expect(changedTemplate.statusCode).toBe(200);
    const afterTemplateEdit = (await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}` })).json();
    expect(afterTemplateEdit.workItems.map((item: any) => ({ id: item.id, title: item.title, plannedStart: item.plannedStart, plannedEnd: item.plannedEnd, actualStart: item.actualStart, actualEnd: item.actualEnd }))).toEqual(workItemSnapshot);

    const replacement = await app.inject({ method: 'POST', url: '/api/templates', headers: { cookie }, payload: {
      name: '重选流程测试', items: [{ title: '重新梳理', startOffsetDays: 0, durationDays: 2, sortOrder: 0 }],
    } });
    const resetPayload = { templateId: replacement.json().id, plannedStart: '2026-09-14' };
    expect((await app.inject({ method: 'PATCH', url: `/api/requirements/${requirementId}`, headers: { cookie }, payload: resetPayload })).statusCode).toBe(400);
    const reset = await app.inject({ method: 'PATCH', url: `/api/requirements/${requirementId}`, headers: { cookie }, payload: { ...resetPayload, confirmTemplateReset: true } });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({ templateId: replacement.json().id, templateName: '重选流程测试', plannedStart: '2026-09-14', progress: 0, progressUpdates: [] });
    expect(reset.json().workItems).toEqual([expect.objectContaining({ title: '重新梳理', status: 'not_started', ownerId: null, actualStart: null, actualEnd: null, plannedStart: '2026-09-14', plannedEnd: '2026-09-15' })]);
    expect(reset.json().workItems.some((item: { id: string }) => workItemSnapshot.some((old: { id: string }) => old.id === item.id))).toBe(false);
  });
});
