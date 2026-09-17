import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'noop-updates-'));
process.env.DB_PATH = path.join(directory, 'test.db');
process.env.BACKUP_DIR = path.join(directory, 'backups');
process.env.SEED_DEMO = '0';
process.env.APP_PASSWORD_HASH = 'scrypt$4c63a6f93ff4f94b031b7e7583592177$b598dbddaf9dd06678ff8756923d9e0a7f2d68eaa45bc644fbf4a73c9298970c7489671dfcfc8be282022c26a3370fb040f3f086a45faa1e1abde04bbe4a51ef';
process.env.SESSION_SECRET = 'noop-updates-test-session-secret-123456789';

let app: FastifyInstance;
let origin = '';
let cookie = '';
let token = '';
let projectId = '';

const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, headers: { cookie }, payload });
const patch = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url, headers: { cookie }, payload });
const put = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'PUT', url, headers: { cookie }, payload });

async function callMcp(name: string, args: Record<string, unknown>) {
  const response = await fetch(`${origin}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await response.text();
  expect(response.status, body).toBe(200);
  return JSON.parse(body).result.structuredContent.result;
}

beforeAll(async () => {
  app = await (await import('../src/server/app')).buildApp();
  origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: '41_xc7q0qOjo4Inw!' } });
  cookie = String(login.headers['set-cookie']).split(';')[0];
  projectId = (await post('/api/projects', { name: '空操作测试' })).json().id;
  token = (await post('/api/tokens', { name: '空操作测试' })).json().token;
});

afterAll(async () => {
  await app?.close();
  const { sqlite } = await import('./support/database');
  if (sqlite.open) sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

it('REST和MCP保存未变化的需求、工作项与问题时不增加版本或审计', async () => {
  const person = (await post('/api/people', { projectId, name: '负责人' })).json();
  const requirement = (await post('/api/requirements', {templateId: await defaultTemplate(projectId),
    projectId, title: '保持不变的需求', ownerId: person.id, background: '背景', plannedStart: '2020-01-02',
  })).json();
  const workItem = requirement.workItems[0];
  const issue = (await post('/api/issues', {
    projectId, requirementId: requirement.id, title: '保持不变的问题', ownerId: person.id,
    impact: '影响', reporter: '提出人', sourceRef: 'SRC-1', priority: 'P1', discoveredAt: '2020-01-02',
  })).json();
  const { sqlite } = await import('./support/database');
  const auditCount = () => Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE (entity_type='requirement' AND entity_id=?) OR (entity_type='work_item' AND entity_id=?) OR (entity_type='issue' AND entity_id=?)`)
    .get(requirement.id, workItem.id, issue.id) as { count: number }).count);
  const initialAuditCount = auditCount();

  const restRequirement = await patch(`/api/requirements/${requirement.id}`, {
    title: requirement.title, ownerId: person.id, background: '背景', expectedVersion: requirement.version,
  });
  expect(restRequirement.statusCode, restRequirement.body).toBe(200);
  expect(restRequirement.json().version).toBe(requirement.version);
  expect((await callMcp('update_requirement', { id: requirement.id, expectedVersion: requirement.version })).version)
    .toBe(requirement.version);

  const sameSchedule = await post(`/api/requirements/${requirement.id}/reschedule`, {
    scheduleMode: 'start', plannedStart: requirement.plannedStart, expectedVersion: requirement.version,
  });
  expect(sameSchedule.statusCode, sameSchedule.body).toBe(200);
  expect(sameSchedule.json().version).toBe(requirement.version);
  expect((await callMcp('reschedule_requirement', {
    id: requirement.id, scheduleMode: 'deadline', plannedEnd: requirement.plannedEnd, expectedVersion: requirement.version,
  })).version).toBe(requirement.version);

  const restWorkItem = await patch(`/api/work-items/${workItem.id}`, {
    title: workItem.title, assigneeIds: [], plannedStart: workItem.plannedStart,
    plannedEnd: workItem.plannedEnd, expectedVersion: workItem.version,
  });
  expect(restWorkItem.statusCode, restWorkItem.body).toBe(200);
  expect(restWorkItem.json().version).toBe(workItem.version);
  expect((await callMcp('update_work_item', { id: workItem.id, expectedVersion: workItem.version })).version)
    .toBe(workItem.version);

  const restIssue = await patch(`/api/issues/${issue.id}`, {
    title: issue.title, impact: issue.impact, reporter: issue.reporter, sourceRef: issue.sourceRef,
    ownerId: issue.ownerId, requirementId: issue.requirementId, priority: issue.priority,
    discoveredAt: issue.discoveredAt, dueDate: issue.dueDate, expectedVersion: issue.version,
  });
  expect(restIssue.statusCode, restIssue.body).toBe(200);
  expect(restIssue.json().version).toBe(issue.version);
  expect((await callMcp('update_issue', { id: issue.id, expectedVersion: issue.version })).version).toBe(issue.version);

  const currentRequirement = (await app.inject({ url: `/api/requirements/${requirement.id}`, headers: { cookie } })).json();
  expect(currentRequirement.version).toBe(requirement.version);
  expect(currentRequirement.workItems.find((item: { id: string }) => item.id === workItem.id).version).toBe(workItem.version);
  expect(auditCount()).toBe(initialAuditCount);
});

it('项目、人员、流程和成员角色保存原值时保持时间戳及审计不变', async () => {
  const project = (await app.inject({ url: '/api/projects', headers: { cookie } })).json()
    .find((item: { id: string }) => item.id === projectId);
  const person = (await post('/api/people', { projectId, name: '管理资料负责人', jobTitle: '开发' })).json();
  const template = (await app.inject({ url: `/api/templates?projectId=${projectId}`, headers: { cookie } })).json()
    .find((item: { id: string }) => item.id === project.defaultTemplateId);
  const member = (await app.inject({ url: `/api/projects/${projectId}/members`, headers: { cookie } })).json()
    .find((item: { id: string }) => item.id === person.id);
  const { sqlite } = await import('./support/database');
  const initialAuditCount = Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM audit_logs WHERE
    (entity_type='project' AND entity_id=?) OR (entity_type='person' AND entity_id=?) OR (entity_type='template' AND entity_id=?)`)
    .get(projectId, person.id, template.id) as { count: number }).count);

  const restProject = await patch(`/api/projects/${projectId}`, {
    name: project.name, status: project.status, plannedStart: project.plannedStart, plannedEnd: project.plannedEnd,
    defaultTemplateId: project.defaultTemplateId, expectedUpdatedAt: project.updatedAt,
  });
  expect(restProject.statusCode, restProject.body).toBe(200);
  expect(restProject.json().updatedAt).toBe(project.updatedAt);
  expect((await callMcp('update_project', { id: projectId, expectedUpdatedAt: project.updatedAt })).updatedAt)
    .toBe(project.updatedAt);

  const restPerson = await patch(`/api/people/${person.id}`, {
    name: person.name, jobTitle: person.jobTitle, active: true, expectedUpdatedAt: person.updatedAt,
  });
  expect(restPerson.statusCode, restPerson.body).toBe(200);
  expect(restPerson.json().updatedAt).toBe(person.updatedAt);
  expect((await callMcp('update_person', { id: person.id, expectedUpdatedAt: person.updatedAt })).updatedAt)
    .toBe(person.updatedAt);

  const restTemplate = await patch(`/api/templates/${template.id}`, {
    name: template.name, description: template.description, expectedUpdatedAt: template.updatedAt,
    items: template.items.map(({ id, title, startOffsetDays, durationDays, milestoneLabel, sortOrder }: Record<string, unknown>) => ({
      id, title, startOffsetDays, durationDays, milestoneLabel, sortOrder,
    })),
  });
  expect(restTemplate.statusCode, restTemplate.body).toBe(200);
  expect(restTemplate.json().updatedAt).toBe(template.updatedAt);
  expect((await callMcp('update_template', { id: template.id, expectedUpdatedAt: template.updatedAt })).updatedAt)
    .toBe(template.updatedAt);

  const restMember = await put(`/api/projects/${projectId}/members/${person.id}`, {
    role: member.projectRole, expectedMembershipUpdatedAt: member.membershipUpdatedAt,
  });
  expect(restMember.statusCode, restMember.body).toBe(200);
  expect(restMember.json().membershipUpdatedAt).toBe(member.membershipUpdatedAt);
  expect((await callMcp('set_project_member_role', {
    projectId, personId: person.id, role: member.projectRole, expectedMembershipUpdatedAt: member.membershipUpdatedAt,
  })).membershipUpdatedAt).toBe(member.membershipUpdatedAt);

  expect(Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM audit_logs WHERE
    (entity_type='project' AND entity_id=?) OR (entity_type='person' AND entity_id=?) OR (entity_type='template' AND entity_id=?)`)
    .get(projectId, person.id, template.id) as { count: number }).count)).toBe(initialAuditCount);
});

it('账号、个人分析布局和系统品牌空保存不制造版本、缓存或审计变化', async () => {
  const { sqlite } = await import('./support/database');
  const admin = (await app.inject({ url: '/api/accounts', headers: { cookie } })).json()
    .find((item: { username: string }) => item.username === 'admin');
  const accountAuditCount = () => Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE entity_type='account' AND entity_id=? AND action='update'`).get(admin.id) as { count: number }).count);
  const initialAccountAuditCount = accountAuditCount();
  const initialSessionVersion = (sqlite.prepare('SELECT session_version AS sessionVersion FROM accounts WHERE id=?')
    .get(admin.id) as { sessionVersion: number }).sessionVersion;
  const account = await patch(`/api/accounts/${admin.id}`, {
    username: admin.username, role: 'admin', status: admin.status, expectedUpdatedAt: admin.updatedAt,
  });
  expect(account.statusCode, account.body).toBe(200);
  expect(account.json().updatedAt).toBe(admin.updatedAt);
  expect(accountAuditCount()).toBe(initialAccountAuditCount);
  expect((sqlite.prepare('SELECT session_version AS sessionVersion FROM accounts WHERE id=?').get(admin.id) as { sessionVersion: number }).sessionVersion)
    .toBe(initialSessionVersion);

  const initialBranding = (await app.inject({ url: '/api/branding' })).json();
  const initialBrandingAudit = Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE entity_type='system_branding' AND entity_id='default'`).get() as { count: number }).count);
  const defaultBranding = await put('/api/system/branding', {
    systemName: initialBranding.systemName, shortName: initialBranding.shortName, expectedUpdatedAt: initialBranding.updatedAt,
  });
  expect(defaultBranding.statusCode, defaultBranding.body).toBe(200);
  expect(defaultBranding.json().updatedAt).toBe(initialBranding.updatedAt);
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM system_meta WHERE key='system-branding'").get()).toEqual({ count: 0 });
  expect(Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE entity_type='system_branding' AND entity_id='default'`).get() as { count: number }).count)).toBe(initialBrandingAudit);

  const changedBranding = await put('/api/system/branding', {
    systemName: '空操作测试系统', shortName: '空测', expectedUpdatedAt: initialBranding.updatedAt,
  });
  expect(changedBranding.statusCode, changedBranding.body).toBe(200);
  const changedBrandingAudit = Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE entity_type='system_branding' AND entity_id='default'`).get() as { count: number }).count);
  const sameBranding = await put('/api/system/branding', {
    systemName: changedBranding.json().systemName, shortName: changedBranding.json().shortName,
    expectedUpdatedAt: changedBranding.json().updatedAt,
  });
  expect(sameBranding.statusCode, sameBranding.body).toBe(200);
  expect(sameBranding.json().updatedAt).toBe(changedBranding.json().updatedAt);
  expect(Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE entity_type='system_branding' AND entity_id='default'`).get() as { count: number }).count)).toBe(changedBrandingAudit);

  const initialLayout = (await app.inject({ url: '/api/analytics/layout', headers: { cookie } })).json();
  const establishedLayout = await put('/api/analytics/layout', { ...initialLayout.layout, expectedUpdatedAt: initialLayout.updatedAt });
  expect(establishedLayout.statusCode, establishedLayout.body).toBe(200);
  const layoutAuditCount = () => Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE entity_type='analytics_layout' AND entity_id=?`).get(admin.id) as { count: number }).count);
  const establishedLayoutAudits = layoutAuditCount();
  const sameLayout = await put('/api/analytics/layout', {
    ...establishedLayout.json().layout, expectedUpdatedAt: establishedLayout.json().updatedAt,
  });
  expect(sameLayout.statusCode, sameLayout.body).toBe(200);
  expect(sameLayout.json().updatedAt).toBe(establishedLayout.json().updatedAt);
  expect(layoutAuditCount()).toBe(establishedLayoutAudits);

  const reset = await app.inject({ method: 'DELETE', url: '/api/analytics/layout', headers: { cookie }, payload: {
    expectedUpdatedAt: establishedLayout.json().updatedAt,
  } });
  expect(reset.statusCode, reset.body).toBe(200);
  const resetAuditCount = layoutAuditCount();
  const repeatedReset = await app.inject({ method: 'DELETE', url: '/api/analytics/layout', headers: { cookie }, payload: { expectedUpdatedAt: null } });
  expect(repeatedReset.statusCode, repeatedReset.body).toBe(200);
  expect(repeatedReset.json().updatedAt).toBeNull();
  expect(layoutAuditCount()).toBe(resetAuditCount);
});

it('个人分析布局拒绝错拼并发字段且不覆盖或删除当前布局', async () => {
  const initial = (await app.inject({ url: '/api/analytics/layout', headers: { cookie } })).json();
  const established = await put('/api/analytics/layout', {
    version: 1, panels: [initial.layout.panels[0]], expectedUpdatedAt: initial.updatedAt,
  });
  expect(established.statusCode, established.body).toBe(200);
  const before = (await app.inject({ url: '/api/analytics/layout', headers: { cookie } })).json();
  const overwritten = await put('/api/analytics/layout', {
    version: 1, panels: [initial.layout.panels[1]], expected_updated_at: before.updatedAt,
  });
  const removed = await app.inject({ method: 'DELETE', url: '/api/analytics/layout', headers: { cookie }, payload: {
    expected_updated_at: before.updatedAt,
  } });
  const panelWithUnknownField = await put('/api/analytics/layout', {
    version: 1, panels: [{ ...initial.layout.panels[0], measure_id: initial.layout.panels[0].measure }], expectedUpdatedAt: before.updatedAt,
  });
  const panelWithStructuredId = await put('/api/analytics/layout', {
    version: 1, panels: [{ ...initial.layout.panels[0], id: [initial.layout.panels[0].id] }], expectedUpdatedAt: before.updatedAt,
  });
  expect([overwritten.statusCode, removed.statusCode, panelWithUnknownField.statusCode, panelWithStructuredId.statusCode])
    .toEqual([400, 400, 400, 400]);
  expect((await app.inject({ url: '/api/analytics/layout', headers: { cookie } })).json()).toEqual(before);
});

it('工作项相同排序保持版本不变，真实排序只更新移动项并记录执行中原因', async () => {
  const person = (await post('/api/people', { projectId, name: '排序测试负责人' })).json();
  const requirement = (await post('/api/requirements', {templateId: await defaultTemplate(projectId),
    projectId, title: '工作项排序幂等测试', ownerId: person.id, plannedStart: '2020-01-02',
  })).json();
  const initialIds = requirement.workItems.map((item: { id: string }) => item.id);
  const initialVersions = new Map(requirement.workItems.map((item: { id: string; version: number }) => [item.id, item.version]));
  const { sqlite } = await import('./support/database');
  const reorderAuditCount = () => Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE entity_type='work_item' AND entity_id=? AND action='reorder'`).get(requirement.id) as { count: number }).count);
  const initialAuditCount = reorderAuditCount();

  const sameRest = await post(`/api/requirements/${requirement.id}/reorder-work-items`, {
    ids: initialIds, expectedVersion: requirement.version,
  });
  expect(sameRest.statusCode, sameRest.body).toBe(200);
  expect(sameRest.json().map((item: { id: string }) => item.id)).toEqual(initialIds);
  const sameMcp = await callMcp('reorder_work_items', {
    requirementId: requirement.id, ids: initialIds, expectedVersion: requirement.version,
  });
  expect(sameMcp.map((item: { id: string }) => item.id)).toEqual(initialIds);
  let detail = (await app.inject({ url: `/api/requirements/${requirement.id}`, headers: { cookie } })).json();
  expect(detail.version).toBe(requirement.version);
  expect(detail.workItems.map((item: { id: string; version: number }) => [item.id, item.version]))
    .toEqual(requirement.workItems.map((item: { id: string; version: number }) => [item.id, item.version]));
  expect(reorderAuditCount()).toBe(initialAuditCount);

  const movedIds = [initialIds[1], initialIds[0], ...initialIds.slice(2)];
  const moved = await post(`/api/requirements/${requirement.id}/reorder-work-items`, {
    ids: movedIds, expectedVersion: requirement.version,
  });
  expect(moved.statusCode, moved.body).toBe(200);
  expect(moved.json().map((item: { id: string }) => item.id)).toEqual(movedIds);
  detail = (await app.inject({ url: `/api/requirements/${requirement.id}`, headers: { cookie } })).json();
  expect(detail.version).toBe(requirement.version + 1);
  for (const item of detail.workItems as Array<{ id: string; version: number }>) {
    expect(item.version).toBe(Number(initialVersions.get(item.id)) + (movedIds.indexOf(item.id) < 2 ? 1 : 0));
  }
  expect(reorderAuditCount()).toBe(initialAuditCount + 1);

  const assignedTarget = detail.workItems[0];
  const assigned = await patch(`/api/work-items/${assignedTarget.id}`, {
    ownerId: person.id, expectedVersion: assignedTarget.version,
  });
  expect(assigned.statusCode, assigned.body).toBe(200);
  const started = await post(`/api/work-items/${assignedTarget.id}/start`, { expectedVersion: assigned.json().version });
  expect(started.statusCode, started.body).toBe(200);
  const executing = (await app.inject({ url: `/api/requirements/${requirement.id}`, headers: { cookie } })).json();
  const executingIds = executing.workItems.map((item: { id: string }) => item.id);
  const sameExecuting = await post(`/api/requirements/${requirement.id}/reorder-work-items`, {
    ids: executingIds, expectedVersion: executing.version,
  });
  expect(sameExecuting.statusCode, sameExecuting.body).toBe(200);
  const reorderedExecuting = await post(`/api/requirements/${requirement.id}/reorder-work-items`, {
    ids: [executingIds[1], executingIds[0], ...executingIds.slice(2)],
    reason: '执行中调整交付先后顺序', expectedVersion: executing.version,
  });
  expect(reorderedExecuting.statusCode, reorderedExecuting.body).toBe(200);
  const afterExecutionReorder = (await app.inject({ url: `/api/requirements/${requirement.id}`, headers: { cookie } })).json();
  expect(afterExecutionReorder.progressUpdates).toEqual(expect.arrayContaining([
    expect.objectContaining({ eventType: 'correction', content: '执行中调整交付先后顺序', workItemId: null }),
  ]));
});

async function defaultTemplate(projectId:string){const response=await app.inject({url:"/api/templates?projectId="+projectId,headers:{cookie}});return response.json<Array<{id:string}>>()[0].id;}
