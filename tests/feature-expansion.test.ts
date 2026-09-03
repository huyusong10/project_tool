import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const dbPath = path.join(process.cwd(), 'data', `feature-expansion-${randomUUID()}.db`);
const backupDir = path.join(process.cwd(), 'data', `feature-expansion-backups-${randomUUID()}`);
process.env.DB_PATH = dbPath;
process.env.BACKUP_DIR = backupDir;
process.env.SEED_DEMO = '0';
process.env.APP_PASSWORD_HASH = 'scrypt$4c63a6f93ff4f94b031b7e7583592177$b598dbddaf9dd06678ff8756923d9e0a7f2d68eaa45bc644fbf4a73c9298970c7489671dfcfc8be282022c26a3370fb040f3f086a45faa1e1abde04bbe4a51ef';
process.env.SESSION_SECRET = 'feature-expansion-test-session-secret-123456789';

let app: FastifyInstance;
let adminCookie = '';
let ownerCookie = '';
let replacementCookie = '';
let memberCookie = '';
let viewerCookie = '';
let projectId = '';
let templateId = '';
let ownerId = '';
let replacementId = '';
let viewerId = '';
let requirementId = '';
let blockedWorkItemId = '';
let issueId = '';

function responseCookie(response: { headers: Record<string, unknown> }) {
  const value = response.headers['set-cookie'];
  return String(Array.isArray(value) ? value[0] : value).split(';')[0];
}

async function readyCookie(username: string, nextPassword: string) {
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username, password: '888888' } });
  let cookie = responseCookie(login);
  const changed = await app.inject({ method: 'POST', url: '/api/account/change-password', headers: { cookie }, payload: {
    currentPassword: '888888', newPassword: nextPassword,
  } });
  cookie = responseCookie(changed);
  return cookie;
}

const mcpHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  accept: 'application/json, text/event-stream',
  'content-type': 'application/json',
});

async function callMcp(token: string, id: number, name: string, args: Record<string, unknown>) {
  const response = await app.inject({ method: 'POST', url: '/mcp', headers: mcpHeaders(token), payload: {
    jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args },
  } });
  expect(response.statusCode).toBe(200);
  return response.json();
}

function mcpValue(payload: any) {
  if (payload.result?.structuredContent?.result !== undefined) return payload.result.structuredContent.result;
  return JSON.parse(payload.result.content[0].text);
}

beforeAll(async () => {
  const module = await import('../src/server/app');
  app = await module.buildApp();
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: '41_xc7q0qOjo4Inw!' } });
  adminCookie = responseCookie(login);
  const project = await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie: adminCookie }, payload: { name: '功能扩充验收项目' } });
  projectId = project.json().id;
  templateId = project.json().defaultTemplateId;
  for (const person of [
    { key: 'owner', name: '需求负责人' },
    { key: 'replacement', name: '接任负责人' },
    { key: 'member', name: '普通成员' },
    { key: 'viewer', name: '项目查看者' },
  ]) {
    const created = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie: adminCookie }, payload: {
      projectId, name: person.name, jobTitle: '测试角色',
    } });
    if (person.key === 'owner') ownerId = created.json().id;
    if (person.key === 'replacement') replacementId = created.json().id;
    if (person.key === 'viewer') viewerId = created.json().id;
  }
  ownerCookie = await readyCookie('需求负责人', 'owner-password-123');
  replacementCookie = await readyCookie('接任负责人', 'replacement-password-123');
  memberCookie = await readyCookie('普通成员', 'member-password-123');
  viewerCookie = await readyCookie('项目查看者', 'viewer-password-123');
  const viewerRole = await app.inject({ method: 'PUT', url: `/api/projects/${projectId}/members/${viewerId}`, headers: { cookie: adminCookie }, payload: { role: 'viewer' } });
  expect(viewerRole.statusCode).toBe(200);
});

afterAll(async () => {
  await app.close();
  const { sqlite } = await import('../src/server/database');
  if (sqlite.open) sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
});

describe('功能扩充契约', () => {
  it('支持轻量待规划需求、自动就绪和执行后负责人约束', async () => {
    const draft = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie: adminCookie }, payload: {
      projectId, templateId, title: '只填标题的需求', background: '客户需要缩短交付时间',
      acceptanceCriteria: '关键链路验收通过', referenceUrl: 'https://example.com/spec',
    } });
    expect(draft.statusCode).toBe(200);
    expect(draft.json()).toMatchObject({
      status: 'planning', priority: 'P2', ownerId: null, templateId, plannedStart: null, plannedEnd: null,
      background: '客户需要缩短交付时间', acceptanceCriteria: '关键链路验收通过', referenceUrl: 'https://example.com/spec',
    });
    expect(draft.json().workItems).toEqual([]);
    expect((await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie: adminCookie }, payload: {
      projectId, title: '非法链接', referenceUrl: 'ftp://example.com/file',
    } })).statusCode).toBe(400);

    const owned = await app.inject({ method: 'PATCH', url: `/api/requirements/${draft.json().id}`, headers: { cookie: adminCookie }, payload: {
      ownerId, expectedVersion: draft.json().version,
    } });
    expect(owned.json().status).toBe('planning');
    const planned = await app.inject({ method: 'POST', url: `/api/requirements/${draft.json().id}/reschedule`, headers: { cookie: adminCookie }, payload: {
      scheduleMode: 'start', plannedStart: '2026-02-13', expectedVersion: owned.json().version,
    } });
    expect(planned.statusCode).toBe(200);
    expect(planned.json().status).toBe('not_started');
    expect(planned.json().workItems.length).toBeGreaterThan(0);

    const ownerCleared = await app.inject({ method: 'PATCH', url: `/api/requirements/${draft.json().id}`, headers: { cookie: adminCookie }, payload: {
      ownerId: null, expectedVersion: planned.json().version,
    } });
    expect(ownerCleared.json().status).toBe('planning');
    const reassigned = await app.inject({ method: 'PATCH', url: `/api/requirements/${draft.json().id}`, headers: { cookie: adminCookie }, payload: {
      ownerId, expectedVersion: ownerCleared.json().version,
    } });
    expect(reassigned.json().status).toBe('not_started');
    requirementId = reassigned.json().id;

    expect((await app.inject({ method: 'PATCH', url: `/api/requirements/${requirementId}`, headers: { cookie: ownerCookie }, payload: {
      title: '越权修改需求', expectedVersion: reassigned.json().version,
    } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/requirements/${requirementId}/cancel`, headers: { cookie: ownerCookie }, payload: {
      reason: '越权取消', expectedVersion: reassigned.json().version,
    } })).statusCode).toBe(403);

    const first = reassigned.json().workItems[0];
    const assigned = await app.inject({ method: 'PATCH', url: `/api/work-items/${first.id}`, headers: { cookie: ownerCookie }, payload: {
      ownerId, expectedVersion: first.version,
    } });
    expect(assigned.statusCode).toBe(200);
    const started = await app.inject({ method: 'POST', url: `/api/work-items/${first.id}/start`, headers: { cookie: ownerCookie }, payload: {
      expectedVersion: assigned.json().version,
    } });
    expect(started.json().status).toBe('in_progress');
    const executing = (await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie: adminCookie } })).json();
    const rejectedClear = await app.inject({ method: 'PATCH', url: `/api/requirements/${requirementId}`, headers: { cookie: adminCookie }, payload: {
      ownerId: null, expectedVersion: executing.version,
    } });
    expect(rejectedClear.statusCode).toBe(409);
    expect(rejectedClear.json().code).toBe('DEPENDENCY_CONFLICT');

    const replaced = await app.inject({ method: 'PATCH', url: `/api/requirements/${requirementId}`, headers: { cookie: adminCookie }, payload: {
      ownerId: replacementId, expectedVersion: executing.version,
    } });
    expect(replaced.json().ownerId).toBe(replacementId);
    const second = replaced.json().workItems[1];
    expect((await app.inject({ method: 'PATCH', url: `/api/work-items/${second.id}`, headers: { cookie: ownerCookie }, payload: {
      title: '旧负责人无权修改', expectedVersion: second.version, reason: '验证权限转移',
    } })).statusCode).toBe(403);
    const newOwnerEdit = await app.inject({ method: 'PATCH', url: `/api/work-items/${second.id}`, headers: { cookie: replacementCookie }, payload: {
      title: '新负责人可修改', expectedVersion: second.version, reason: '验证权限转移',
    } });
    expect(newOwnerEdit.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/my-work', headers: { cookie: replacementCookie } })).json().requirements)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: requirementId, actionCount: expect.any(Number) })]));
    expect((await app.inject({ method: 'GET', url: '/api/my-work', headers: { cookie: ownerCookie } })).json().requirements)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: requirementId })]));
  });

  it('按来源合并行动原因，固定严重度并按角色过滤', async () => {
    const draft = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie: adminCookie }, payload: {
      projectId, title: '行动中心待规划草稿',
    } });
    const current = (await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie: adminCookie } })).json();
    const first = current.workItems[0];
    const unassigned = await app.inject({ method: 'PATCH', url: `/api/work-items/${first.id}`, headers: { cookie: adminCookie }, payload: {
      ownerId: null, expectedVersion: first.version, reason: '构造未分派阻塞场景',
    } });
    const blocked = await app.inject({ method: 'POST', url: `/api/work-items/${first.id}/block`, headers: { cookie: adminCookie }, payload: {
      reason: '外部依赖未就绪', expectedVersion: unassigned.json().version,
    } });
    expect(blocked.json().status).toBe('blocked');
    blockedWorkItemId = first.id;
    const issue = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie: adminCookie }, payload: {
      projectId, requirementId, title: '逾期且未分派的问题', dueDate: '2026-08-31', priority: 'P1',
    } });
    issueId = issue.json().id;

    const actions = await app.inject({ method: 'GET', url: `/api/action-items?projectId=${projectId}&pageSize=100`, headers: { cookie: adminCookie } });
    expect(actions.statusCode).toBe(200);
    const draftAction = actions.json().items.find((item: any) => item.id === `requirement:${draft.json().id}`);
    expect(draftAction.reasonCodes).toEqual(expect.arrayContaining(['planning', 'missing_owner', 'missing_work_items']));
    expect(draftAction.severity).toBe('low');
    const workAction = actions.json().items.find((item: any) => item.id === `work_item:${blockedWorkItemId}`);
    expect(workAction.reasonCodes).toEqual(expect.arrayContaining(['blocked', 'unassigned']));
    expect(workAction.severity).toBe('high');
    const issueAction = actions.json().items.find((item: any) => item.id === `issue:${issueId}`);
    expect(issueAction.reasonCodes).toEqual(expect.arrayContaining(['overdue', 'unassigned']));
    expect(issueAction.severity).toBe('high');
    const weights = actions.json().items.map((item: any) => ({ high: 3, medium: 2, low: 1 } as Record<string, number>)[String(item.severity)]);
    expect(weights).toEqual([...weights].sort((left, right) => right - left));

    const ownerActions = (await app.inject({ method: 'GET', url: `/api/action-items?projectId=${projectId}&pageSize=100`, headers: { cookie: replacementCookie } })).json();
    expect(ownerActions.items.map((item: any) => item.id)).toEqual(expect.arrayContaining([`work_item:${blockedWorkItemId}`, `issue:${issueId}`]));
    expect(ownerActions.items.map((item: any) => item.id)).not.toContain(`requirement:${draft.json().id}`);
    expect((await app.inject({ method: 'GET', url: `/api/action-items?projectId=${projectId}`, headers: { cookie: memberCookie } })).json().total).toBe(0);
    expect((await app.inject({ method: 'GET', url: `/api/action-items?projectId=${projectId}`, headers: { cookie: viewerCookie } })).json().total).toBe(0);
    const filtered = (await app.inject({ method: 'GET', url: `/api/action-items?projectId=${projectId}&severity=high&reason=blocked`, headers: { cookie: adminCookie } })).json();
    expect(filtered.items).toEqual([expect.objectContaining({ id: `work_item:${blockedWorkItemId}`, severity: 'high' })]);
    expect((await app.inject({ method: 'GET', url: `/api/action-items?projectId=${projectId}&reason=unknown`, headers: { cookie: adminCookie } })).statusCode).toBe(400);
    const { sqlite } = await import('../src/server/database');
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='action_items'").get()).toEqual({ count: 0 });
  });

  it('MCP与REST共用查询结果、权限和业务错误码', async () => {
    const issued = await app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie: replacementCookie }, payload: { name: '功能扩充MCP' } });
    const token = issued.json().token as string;
    const tools = await app.inject({ method: 'POST', url: '/mcp', headers: mcpHeaders(token), payload: {
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    } });
    const toolNames = tools.json().result.tools.map((tool: { name: string }) => tool.name);
    expect(toolNames).toEqual(expect.arrayContaining([
      'get_my_work', 'list_action_items', 'list_issues', 'get_issue', 'update_progress', 'delete_progress',
      'update_issue_update', 'delete_issue_update', 'list_project_members', 'set_project_member_role',
      'list_person_candidates', 'copy_template', 'get_analytics_catalog', 'query_analytics',
    ]));

    const restActions = (await app.inject({ method: 'GET', url: `/api/action-items?projectId=${projectId}&pageSize=100`, headers: { cookie: replacementCookie } })).json();
    const mcpActions = mcpValue(await callMcp(token, 2, 'list_action_items', { projectId, pageSize: 100 }));
    expect(mcpActions).toEqual(restActions);
    expect(JSON.stringify(mcpValue(await callMcp(token, 3, 'get_my_work', {})))).toContain(requirementId);
    expect(JSON.stringify(mcpValue(await callMcp(token, 4, 'list_issues', { projectId })))).toContain(issueId);
    expect(mcpValue(await callMcp(token, 5, 'get_issue', { id: issueId }))).toMatchObject({ id: issueId });

    const current = (await app.inject({ method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie: replacementCookie } })).json();
    const restDenied = await app.inject({ method: 'PATCH', url: `/api/requirements/${requirementId}`, headers: { cookie: replacementCookie }, payload: {
      title: '不允许修改', expectedVersion: current.version,
    } });
    expect(restDenied.statusCode).toBe(403);
    const mcpDenied = await callMcp(token, 6, 'update_requirement', { id: requirementId, title: '不允许修改', expectedVersion: current.version });
    expect(mcpDenied.result).toMatchObject({
      isError: true,
      structuredContent: { statusCode: 403, error: { code: restDenied.json().code } },
    });
  });
});
