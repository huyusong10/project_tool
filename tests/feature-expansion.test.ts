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
let origin = '';
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

async function sendMcp(token: string, payload: Record<string, unknown>) {
  const response = await fetch(`${origin}/mcp`, {
    method: 'POST', headers: mcpHeaders(token), body: JSON.stringify(payload),
  });
  const body = await response.text();
  expect(response.status, body).toBe(200);
  return JSON.parse(body);
}

async function callMcp(token: string, id: number, name: string, args: Record<string, unknown>) {
  return sendMcp(token, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
}

function mcpValue(payload: any) {
  if (payload.result?.structuredContent?.result !== undefined) return payload.result.structuredContent.result;
  return JSON.parse(payload.result.content[0].text);
}

beforeAll(async () => {
  const module = await import('../src/server/app');
  app = await module.buildApp();
  await app.ready();
  origin = await app.listen({ host: '127.0.0.1', port: 0 });
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
  it('行动中心返回服务端采用的业务日期', async () => {
    await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie: adminCookie }, payload: {
      projectId, title: '行动中心日期契约',
    } });
    const response = await app.inject({ method: 'GET', url: `/api/action-items?projectId=${projectId}`, headers: { cookie: adminCookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().asOfDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('普通项目成员可通过 REST 和 MCP 创建未分派问题', async () => {
    const rest = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie: memberCookie }, payload: {
      projectId, title: '成员 REST 提交问题', ownerId,
    } });
    expect(rest.statusCode, rest.body).toBe(200);
    expect(rest.json()).toMatchObject({ title: '成员 REST 提交问题', status: 'in_progress', progress: 0, ownerId: null });

    const issued = await app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie: memberCookie }, payload: { name: '成员创建问题验证' } });
    expect(issued.statusCode, issued.body).toBe(200);
    const mcp = await callMcp(issued.json().token, 800, 'create_issue', {
      projectId, title: '成员 MCP 提交问题', ownerId,
    });
    expect(mcp.result?.isError).not.toBe(true);
    expect(mcpValue(mcp)).toMatchObject({ title: '成员 MCP 提交问题', status: 'in_progress', progress: 0, ownerId: null });
  });

  it('项目管理员创建问题时可以直接指定负责人', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie: adminCookie }, payload: {
      projectId, title: '创建时分配负责人', ownerId,
    } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ title: '创建时分配负责人', status: 'in_progress', ownerId });
  });

  it('无日期套用模板、按计划执行和执行后负责人约束', async () => {
    const draft = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie: adminCookie }, payload: {
      projectId, templateId, title: '只填标题的需求', background: '客户需要缩短交付时间',
      acceptanceCriteria: '关键链路验收通过', referenceUrl: 'https://example.com/spec',
    } });
    expect(draft.statusCode).toBe(200);
    expect(draft.json()).toMatchObject({
      status: 'not_started', priority: 'P2', ownerId: null, templateId, plannedStart: null, plannedEnd: null,
      background: '客户需要缩短交付时间', acceptanceCriteria: '关键链路验收通过', referenceUrl: 'https://example.com/spec',
    });
    expect(draft.json().workItems.length).toBeGreaterThan(0);
    expect((await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie: adminCookie }, payload: {
      projectId, title: '非法链接', referenceUrl: 'ftp://example.com/file',
    } })).statusCode).toBe(400);

    const owned = await app.inject({ method: 'PATCH', url: `/api/requirements/${draft.json().id}`, headers: { cookie: adminCookie }, payload: {
      ownerId, expectedVersion: draft.json().version,
    } });
    expect(owned.json().status).toBe('not_started');
    const planned = await app.inject({ method: 'POST', url: `/api/requirements/${draft.json().id}/apply-plan`, headers: { cookie: adminCookie }, payload: {
      templateId, baseStart: '2026-02-13', expectedVersion: owned.json().version,
    } });
    expect(planned.statusCode).toBe(200);
    expect(planned.json().status).toBe('not_started');
    expect(planned.json().workItems.length).toBeGreaterThan(0);

    const ownerCleared = await app.inject({ method: 'PATCH', url: `/api/requirements/${draft.json().id}`, headers: { cookie: adminCookie }, payload: {
      ownerId: null, expectedVersion: planned.json().version,
    } });
    expect(ownerCleared.json().status).toBe('not_started');
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
    expect(unassigned.statusCode,unassigned.body).toBe(200);
    blockedWorkItemId = first.id;
    const issue = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie: adminCookie }, payload: {
      projectId, requirementId, title: '逾期且未分派的问题', dueDate: '2026-08-31', priority: 'P1',
    } });
    issueId = issue.json().id;

    const actions = await app.inject({ method: 'GET', url: `/api/action-items?projectId=${projectId}&pageSize=100`, headers: { cookie: adminCookie } });
    expect(actions.statusCode).toBe(200);
    const draftAction = actions.json().items.find((item: any) => item.id === `requirement:${draft.json().id}`);
    expect(draftAction.reasonCodes).toEqual(expect.arrayContaining(['missing_owner', 'incomplete_schedule']));
    expect(draftAction.severity).toBe('low');expect(draftAction.processingPriority).toBe('P2');
    const workAction = actions.json().items.find((item: any) => item.id === `work_item:${blockedWorkItemId}`);
    expect(workAction.reasonCodes).toEqual(expect.arrayContaining(['unassigned']));
    expect(workAction.severity).toBe('medium');
    expect(workAction.targetPath).toContain(`/requirements/${requirementId}?workItemId=${blockedWorkItemId}`);
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
    const filtered=(await app.inject({url:`/api/action-items?projectId=${projectId}&reason=unassigned&pageSize=100`,headers:{cookie:adminCookie}})).json();
    expect(filtered.items.every((i:{reasonCodes:string[]})=>i.reasonCodes.includes('unassigned'))).toBe(true);
    expect(filtered.summary).toEqual(actions.json().summary);
    expect((await app.inject({ method: 'GET', url: `/api/action-items?projectId=${projectId}&reason=unknown`, headers: { cookie: adminCookie } })).statusCode).toBe(400);
    const { sqlite } = await import('../src/server/database');
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='action_items'").get()).toEqual({ count: 0 });
  });

  it('工作全部完成后关闭待处理行动并锁定普通修改', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie: adminCookie }, payload: {
      projectId, templateId, title: '已完成历史缺负责人', plannedStart: '2026-02-13',
    } });
    expect(created.statusCode, created.body).toBe(200);
    let current = created.json();
    expect(current).toMatchObject({ status: 'not_started', ownerId: null });
    for (const original of current.workItems) {
      const item = current.workItems.find((entry: { id: string }) => entry.id === original.id);
      const completed = await app.inject({ method: 'POST', url: `/api/work-items/${item.id}/complete-as-planned`, headers: { cookie: adminCookie }, payload: {
        expectedVersion: item.version,
      } });
      expect(completed.statusCode, completed.body).toBe(200);
      current = (await app.inject({ method: 'GET', url: `/api/requirements/${created.json().id}`, headers: { cookie: adminCookie } })).json();
    }
    expect(current).toMatchObject({ status: 'completed', ownerId: null, progress: 100 });

    const actions=(await app.inject({url:`/api/action-items?projectId=${projectId}&pageSize=100`,headers:{cookie:adminCookie}})).json();
    expect(actions.items.some((i:{sourceId:string})=>i.sourceId===current.id)).toBe(false);
    const edited=await app.inject({method:'PATCH',url:`/api/requirements/${current.id}`,headers:{cookie:adminCookie},payload:{ownerId:replacementId,expectedVersion:current.version}});
    expect(edited.statusCode).toBe(409);
    const rescheduled=await app.inject({method:'POST',url:`/api/requirements/${current.id}/reschedule`,headers:{cookie:adminCookie},payload:{expectedVersion:current.version,scheduleMode:'start',plannedStart:'2026-02-14',reason:'不应调整'}});
    expect(rescheduled.statusCode).toBe(409);
  });

  it('已完成需求的历史延期不再计为待处理行动', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie: adminCookie }, payload: {
      projectId, templateId, ownerId: replacementId, title: '延期后已完成需求', plannedStart: '2026-02-13',
    } });
    const completed = await app.inject({ method: 'POST', url: `/api/requirements/${created.json().id}/complete-as-planned`, headers: { cookie: adminCookie }, payload: {
      expectedVersion: created.json().version,
    } });
    expect(completed.statusCode, completed.body).toBe(200);
    const lastItem = completed.json().workItems.at(-1);
    const corrected = await app.inject({ method: 'POST', url: `/api/work-items/${lastItem.id}/correct`, headers: { cookie: adminCookie }, payload: {
      actualStart: lastItem.actualStart, actualEnd: '2026-09-04', reason: '补录实际延期完成日', expectedVersion: lastItem.version,
    } });
    expect(corrected.statusCode, corrected.body).toBe(200);
    const latest = (await app.inject({ method: 'GET', url: `/api/requirements/${created.json().id}`, headers: { cookie: adminCookie } })).json();
    expect(latest).toMatchObject({ status: 'completed', delayed: true });

    const mine = (await app.inject({ method: 'GET', url: '/api/my-work', headers: { cookie: replacementCookie } })).json();
    expect(mine.requirements.find((item: { id: string }) => item.id === latest.id)?.actionCount).toBe(0);
    const actions = (await app.inject({ method: 'GET', url: `/api/action-items?projectId=${projectId}&pageSize=100`, headers: { cookie: replacementCookie } })).json();
    expect(actions.items.some((item: { sourceType: string; sourceId: string }) => item.sourceType === 'requirement' && item.sourceId === latest.id)).toBe(false);
  });

  it('资料完整性独立于执行状态；服务端仍拒绝缺少需求负责人的启动', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie: adminCookie }, payload: {
      projectId, templateId, title: '未开始但已分派工作项', plannedStart: '2026-09-04',
    } });
    expect(created.json().status).toBe('not_started');
    const initialItem = created.json().workItems[0];
    const assigned = await app.inject({ method: 'PATCH', url: `/api/work-items/${initialItem.id}`, headers: { cookie: adminCookie }, payload: {
      ownerId, expectedVersion: initialItem.version,
    } });
    expect(assigned.statusCode, assigned.body).toBe(200);
    const mine = (await app.inject({ method: 'GET', url: '/api/my-work', headers: { cookie: ownerCookie } })).json();
    expect(mine.items.find((item: { id: string }) => item.id === initialItem.id)).toMatchObject({ requirementStatus: 'not_started' });
    const started = await app.inject({ method: 'POST', url: `/api/work-items/${initialItem.id}/start`, headers: { cookie: ownerCookie }, payload: {
      expectedVersion: assigned.json().version,
    } });
    expect(started.statusCode).toBe(409);
    expect(started.json().code).toBe('DEPENDENCY_CONFLICT');
  });

  it('MCP与REST共用查询结果、权限和业务错误码', async () => {
    const issued = await app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie: replacementCookie }, payload: { name: '功能扩充MCP' } });
    const token = issued.json().token as string;
    const tools = await sendMcp(token, {
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    });
    const toolNames = tools.result.tools.map((tool: { name: string }) => tool.name);
    expect(toolNames).toEqual(expect.arrayContaining([
      'get_my_work', 'list_action_items', 'list_issues', 'get_issue', 'list_project_members', 'set_project_member_role',
      'list_person_candidates', 'copy_template', 'get_analytics_catalog', 'query_analytics', 'correct_requirement',
    ]));
    const toolDescriptions = new Map(tools.result.tools.map((tool: { name: string; description?: string }) => [tool.name, tool.description || '']));
    expect(toolDescriptions.get('update_requirement')).toContain('负责人和说明');
    expect(toolDescriptions.get('reopen_work_item')).toContain('需求负责人或项目经理');
    expect(toolDescriptions.get('correct_requirement')).toContain('保持');

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
    const mcpInvalid = await callMcp(token, 7, 'list_action_items', { projectId, reason: 'unknown' });
    expect(mcpInvalid.result).toMatchObject({
      isError: true,
      structuredContent: { statusCode: 400, error: { code: 'VALIDATION_ERROR' } },
    });
    for (const [path, tool] of [['/api/dashboard?projectId=%20', 'dashboard_summary'], ['/api/archives?projectId=%20', 'list_archives']] as const) {
      const restInvalidProject = await app.inject({ method: 'GET', url: path, headers: { cookie: replacementCookie } });
      expect(restInvalidProject.statusCode).toBe(400);
      expect(restInvalidProject.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
      const mcpInvalidProject = await callMcp(token, 70 + path.length, tool, { projectId: ' ' });
      expect(mcpInvalidProject.result).toMatchObject({
        isError: true,
        structuredContent: { statusCode: 400, error: { code: 'VALIDATION_ERROR' } },
      });
    }
    const restInvalidCopy = await app.inject({
      method: 'POST', url: '/api/projects/%20/templates/%20/copy', headers: { cookie: replacementCookie },
    });
    expect(restInvalidCopy.statusCode).toBe(400);
    expect(restInvalidCopy.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    const mcpInvalidCopy = await callMcp(token, 71, 'copy_template', { projectId: ' ', sourceTemplateId: ' ' });
    expect(mcpInvalidCopy.result).toMatchObject({
      isError: true,
      structuredContent: { statusCode: 400, error: { code: 'VALIDATION_ERROR' } },
    });
    const adminIssued = await app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie: adminCookie }, payload: { name: '审计范围MCP' } });
    const adminToken = adminIssued.json().token as string;
    const restProjectAudit = await app.inject({
      method: 'GET', url: `/api/audit?projectId=${projectId}&limit=500`, headers: { cookie: adminCookie },
    });
    expect(restProjectAudit.statusCode).toBe(200);
    const mcpProjectAudit = mcpValue(await callMcp(adminToken, 72, 'list_audit_logs', { projectId, limit: 500 }));
    expect(mcpProjectAudit).toEqual(restProjectAudit.json());
    const restManagerCandidate = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie: adminCookie }, payload: {
      name: `REST候选经理-${randomUUID()}`, jobTitle: '候选经理',
    } });
    const restManager = await app.inject({
      method: 'POST', url: `/api/projects/${projectId}/people/${restManagerCandidate.json().id}`, headers: { cookie: adminCookie }, payload: { role: 'manager' },
    });
    expect(restManager.statusCode).toBe(200);
    expect(restManager.json()).toMatchObject({ projectRole: 'manager' });
    const mcpManagerCandidate = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie: adminCookie }, payload: {
      name: `MCP候选经理-${randomUUID()}`, jobTitle: '候选经理',
    } });
    const mcpManager = await callMcp(adminToken, 73, 'add_project_person', {
      projectId, personId: mcpManagerCandidate.json().id, role: 'manager',
    });
    expect(mcpManager.result?.isError).not.toBe(true);
    expect(mcpValue(mcpManager)).toMatchObject({ projectRole: 'manager' });
    const otherProject = await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie: adminCookie }, payload: {
      name: `问题不可迁移项目-${randomUUID()}`,
    } });
    const issueBeforeMove = (await app.inject({ method: 'GET', url: `/api/issues/${issueId}`, headers: { cookie: adminCookie } })).json();
    const restIssueMove = await app.inject({ method: 'PATCH', url: `/api/issues/${issueId}`, headers: { cookie: adminCookie }, payload: {
      projectId: otherProject.json().id, expectedVersion: issueBeforeMove.version,
    } });
    expect(restIssueMove.statusCode).toBe(400);
    expect(restIssueMove.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    const mcpIssueMove = await callMcp(adminToken, 74, 'update_issue', {
      id: issueId, projectId: otherProject.json().id, expectedVersion: issueBeforeMove.version,
    });
    expect(mcpIssueMove.result).toMatchObject({
      isError: true,
      structuredContent: { statusCode: 400, error: { code: 'VALIDATION_ERROR' } },
    });
    const templateBeforeMove = (await app.inject({
      method: 'GET', url: `/api/templates?projectId=${projectId}`, headers: { cookie: adminCookie },
    })).json().find((entry: { id: string }) => entry.id === templateId);
    const restTemplateMove = await app.inject({ method: 'PATCH', url: `/api/templates/${templateId}`, headers: { cookie: adminCookie }, payload: {
      projectId: otherProject.json().id, expectedUpdatedAt: templateBeforeMove.updatedAt,
    } });
    expect(restTemplateMove.statusCode).toBe(400);
    expect(restTemplateMove.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    const mcpTemplateMove = await callMcp(adminToken, 75, 'update_template', {
      id: templateId, projectId: otherProject.json().id, expectedUpdatedAt: templateBeforeMove.updatedAt,
    });
    expect(mcpTemplateMove.result).toMatchObject({
      isError: true,
      structuredContent: { statusCode: 400, error: { code: 'VALIDATION_ERROR' } },
    });
    const foreignTemplate = (await app.inject({
      method: 'GET', url: `/api/templates?projectId=${otherProject.json().id}`, headers: { cookie: adminCookie },
    })).json()[0];
    const foreignItems = templateBeforeMove.items.map((entry: Record<string, unknown>, index: number) => ({
      ...entry, id: index === 0 ? foreignTemplate.items[0].id : entry.id,
    }));
    const restForeignTemplateItem = await app.inject({ method: 'PATCH', url: `/api/templates/${templateId}`, headers: { cookie: adminCookie }, payload: {
      items: foreignItems, expectedUpdatedAt: templateBeforeMove.updatedAt,
    } });
    expect(restForeignTemplateItem.statusCode).toBe(400);
    expect(restForeignTemplateItem.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    const mcpForeignTemplateItem = await callMcp(adminToken, 77, 'update_template', {
      id: templateId, items: foreignItems, expectedUpdatedAt: templateBeforeMove.updatedAt,
    });
    expect(mcpForeignTemplateItem.result).toMatchObject({
      isError: true,
      structuredContent: { statusCode: 400, error: { code: 'VALIDATION_ERROR' } },
    });
    const clientIdentifiedItem = [{
      id: `client-item-${randomUUID()}`, title: '不应接受客户端ID', startOffsetDays: 0, durationDays: 1, sortOrder: 0,
    }];
    const restIdentifiedTemplate = await app.inject({ method: 'POST', url: '/api/templates', headers: { cookie: adminCookie }, payload: {
      projectId, name: `REST客户端步骤ID-${randomUUID()}`, items: clientIdentifiedItem,
    } });
    expect(restIdentifiedTemplate.statusCode).toBe(400);
    expect(restIdentifiedTemplate.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    const mcpIdentifiedTemplate = await callMcp(adminToken, 78, 'create_template', {
      projectId, name: `MCP客户端步骤ID-${randomUUID()}`, items: clientIdentifiedItem,
    });
    expect(mcpIdentifiedTemplate.result).toMatchObject({
      isError: true,
      structuredContent: { statusCode: 400, error: { code: 'VALIDATION_ERROR' } },
    });
    const newTemplateItems = templateBeforeMove.items.map(({ id: _id, ...entry }: Record<string, unknown>) => entry);
    const restVersionedTemplate = await app.inject({ method: 'POST', url: '/api/templates', headers: { cookie: adminCookie }, payload: {
      projectId, name: `REST带版本新流程-${randomUUID()}`, items: newTemplateItems, expectedUpdatedAt: templateBeforeMove.updatedAt,
    } });
    expect(restVersionedTemplate.statusCode).toBe(400);
    expect(restVersionedTemplate.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    const mcpVersionedTemplate = await callMcp(adminToken, 85, 'create_template', {
      projectId, name: `MCP带版本新流程-${randomUUID()}`, items: newTemplateItems, expectedUpdatedAt: templateBeforeMove.updatedAt,
    });
    expect(mcpVersionedTemplate.result).toMatchObject({
      isError: true,
      structuredContent: { statusCode: 400, error: { code: 'VALIDATION_ERROR' } },
    });
    const restIgnoredCreateMode = await app.inject({ method: 'POST', url: '/api/requirements', headers: { cookie: adminCookie }, payload: {
      projectId, title: `REST冲突创建模式-${randomUUID()}`, plannedStart: '2026-09-07', scheduleMode: 'deadline',
    } });
    expect(restIgnoredCreateMode.statusCode).toBe(400);
    expect(restIgnoredCreateMode.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    const mcpIgnoredCreateMode = await callMcp(adminToken, 79, 'create_requirement', {
      projectId, title: `MCP冲突创建模式-${randomUUID()}`, plannedStart: '2026-09-07', scheduleMode: 'deadline',
    });
    expect(mcpIgnoredCreateMode.result).toMatchObject({
      isError: true,
      structuredContent: { statusCode: 400, error: { code: 'VALIDATION_ERROR' } },
    });
    const requirementBeforeSortedCreate = (await app.inject({
      method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie: adminCookie },
    })).json();
    const sortedCreateInput = {
      title: `指定排序新增-${randomUUID()}`, sortOrder: 0, expectedVersion: requirementBeforeSortedCreate.version, reason: '验证新增排序语义',
    };
    const restSortedCreate = await app.inject({
      method: 'POST', url: `/api/requirements/${requirementId}/work-items`, headers: { cookie: adminCookie }, payload: sortedCreateInput,
    });
    expect(restSortedCreate.statusCode).toBe(400);
    expect(restSortedCreate.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    const mcpSortedCreate = await callMcp(adminToken, 80, 'create_work_item', { requirementId, ...sortedCreateInput });
    expect(mcpSortedCreate.result).toMatchObject({
      isError: true,
      structuredContent: { statusCode: 400, error: { code: 'VALIDATION_ERROR' } },
    });
    const requirementBeforeExecutionCreate = (await app.inject({
      method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie: adminCookie },
    })).json();
    const executionCreateInput = {
      title: `带执行态新增-${randomUUID()}`,
      expectedVersion: requirementBeforeExecutionCreate.version,
      reason: '验证新建执行态字段',
      status: 'completed',
      progress: 100,
      actualStart: '2026-09-01',
      actualEnd: '2026-09-02',
    };
    const restExecutionCreate = await app.inject({
      method: 'POST', url: `/api/requirements/${requirementId}/work-items`, headers: { cookie: adminCookie }, payload: executionCreateInput,
    });
    expect(restExecutionCreate.statusCode).toBe(400);
    expect(restExecutionCreate.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    const mcpExecutionCreate = await callMcp(adminToken, 86, 'create_work_item', { requirementId, ...executionCreateInput });
    expect(mcpExecutionCreate.result).toMatchObject({
      isError: true,
      structuredContent: { statusCode: 400, error: { code: 'VALIDATION_ERROR' } },
    });
    const requirementBeforeDualAssignees = (await app.inject({
      method: 'GET', url: `/api/requirements/${requirementId}`, headers: { cookie: adminCookie },
    })).json();
    const dualAssigneeItem = requirementBeforeDualAssignees.workItems.find((entry: { status: string }) => entry.status === 'not_started');
    const dualAssigneesInput = { collaboratorIds: [], assigneeIds: [], expectedVersion: dualAssigneeItem.version, reason: '验证双字段冲突' };
    const restDualAssignees = await app.inject({
      method: 'PATCH', url: `/api/work-items/${dualAssigneeItem.id}`, headers: { cookie: adminCookie }, payload: dualAssigneesInput,
    });
    expect(restDualAssignees.statusCode).toBe(400);
    expect(restDualAssignees.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    const mcpDualAssignees = await callMcp(adminToken, 81, 'update_work_item', { id: dualAssigneeItem.id, ...dualAssigneesInput });
    expect(mcpDualAssignees.result).toMatchObject({
      isError: true,
      structuredContent: { statusCode: 400, error: { code: 'VALIDATION_ERROR' } },
    });
    const restIssueWithExecution = await app.inject({ method: 'POST', url: '/api/issues', headers: { cookie: adminCookie }, payload: {
      projectId, title: `REST带执行态问题-${randomUUID()}`, progress: 50, expectedVersion: 1,
    } });
    expect(restIssueWithExecution.statusCode).toBe(400);
    expect(restIssueWithExecution.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    const mcpIssueWithExecution = await callMcp(adminToken, 82, 'create_issue', {
      projectId, title: `MCP带执行态问题-${randomUUID()}`, progress: 50, expectedVersion: 1,
    });
    expect(mcpIssueWithExecution.result).toMatchObject({
      isError: true,
      structuredContent: { statusCode: 400, error: { code: 'VALIDATION_ERROR' } },
    });
    const invalidProjectCreate = {
      name: `REST带默认流程项目-${randomUUID()}`,
      defaultTemplateId: templateId,
      expectedUpdatedAt: new Date().toISOString(),
    };
    const restProjectWithUpdateFields = await app.inject({
      method: 'POST', url: '/api/projects', headers: { cookie: adminCookie }, payload: invalidProjectCreate,
    });
    expect(restProjectWithUpdateFields.statusCode).toBe(400);
    expect(restProjectWithUpdateFields.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    const mcpProjectWithUpdateFields = await callMcp(adminToken, 83, 'create_project', {
      ...invalidProjectCreate, name: `MCP带默认流程项目-${randomUUID()}`,
    });
    expect(mcpProjectWithUpdateFields.result).toMatchObject({
      isError: true,
      structuredContent: { statusCode: 400, error: { code: 'VALIDATION_ERROR' } },
    });
    const invalidPersonCreate = {
      name: `REST停用人员-${randomUUID()}`,
      jobTitle: '契约验证',
      active: false,
      expectedUpdatedAt: new Date().toISOString(),
    };
    const restPersonWithUpdateFields = await app.inject({
      method: 'POST', url: '/api/people', headers: { cookie: adminCookie }, payload: invalidPersonCreate,
    });
    expect(restPersonWithUpdateFields.statusCode).toBe(400);
    expect(restPersonWithUpdateFields.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    const mcpPersonWithUpdateFields = await callMcp(adminToken, 84, 'create_person', {
      ...invalidPersonCreate, name: `MCP停用人员-${randomUUID()}`,
    });
    expect(mcpPersonWithUpdateFields.result).toMatchObject({
      isError: true,
      structuredContent: { statusCode: 400, error: { code: 'VALIDATION_ERROR' } },
    });
    const personBeforeProjectEdit = (await app.inject({
      method: 'GET', url: `/api/people?projectId=${projectId}`, headers: { cookie: adminCookie },
    })).json().find((entry: { id: string }) => entry.id === ownerId);
    const restPersonProjectEdit = await app.inject({ method: 'PATCH', url: `/api/people/${ownerId}`, headers: { cookie: adminCookie }, payload: {
      projectId: otherProject.json().id, expectedUpdatedAt: personBeforeProjectEdit.updatedAt,
    } });
    expect(restPersonProjectEdit.statusCode).toBe(400);
    expect(restPersonProjectEdit.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    const mcpPersonProjectEdit = await callMcp(adminToken, 76, 'update_person', {
      id: ownerId, projectId: otherProject.json().id, expectedUpdatedAt: personBeforeProjectEdit.updatedAt,
    });
    expect(mcpPersonProjectEdit.result).toMatchObject({
      isError: true,
      structuredContent: { statusCode: 400, error: { code: 'VALIDATION_ERROR' } },
    });
    const invalidAnalytics = { range: { from: '2026-09-01', to: '2026-09-30' }, panels: [{}] };
    const restInvalidAnalytics = await app.inject({
      method: 'POST', url: '/api/analytics/query', headers: { cookie: replacementCookie }, payload: invalidAnalytics,
    });
    expect(restInvalidAnalytics.statusCode).toBe(400);
    expect(restInvalidAnalytics.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    const mcpInvalidAnalytics = await callMcp(token, 8, 'query_analytics', invalidAnalytics);
    expect(mcpInvalidAnalytics.result).toMatchObject({
      isError: true,
      structuredContent: { statusCode: 400, error: { code: 'VALIDATION_ERROR' } },
    });
    const restInvalidProgress = await app.inject({
      method: 'PATCH', url: '/api/progress/missing-progress', headers: { cookie: replacementCookie }, payload: { workItemPercent: 100 },
    });
    expect(restInvalidProgress.statusCode).toBe(400);
    const mcpInvalidProgress = await callMcp(token, 9, 'update_progress', { id: 'missing-progress', workItemPercent: 100 });
    expect(mcpInvalidProgress.error).toMatchObject({code:-32602});
    const restInvalidIssueUpdate = await app.inject({
      method: 'PATCH', url: '/api/issues/missing-issue/updates/missing-update', headers: { cookie: replacementCookie }, payload: { progress: 100 },
    });
    expect(restInvalidIssueUpdate.statusCode).toBe(400);
    const mcpInvalidIssueUpdate = await callMcp(token, 10, 'update_issue_update', { id: 'missing-issue', updateId: 'missing-update', progress: 100 });
    expect(mcpInvalidIssueUpdate.error).toMatchObject({code:-32602});
    expect(JSON.stringify(mcpValue(await callMcp(token, 11, 'list_issues', { projectId: `  ${projectId}  ` })))).toContain(issueId);
    const restInvalidIssueFilters = await app.inject({
      method: 'GET', url: `/api/issues?projectId=${projectId}&status=resolved&active=true`, headers: { cookie: replacementCookie },
    });
    expect(restInvalidIssueFilters.statusCode).toBe(400);
    const mcpInvalidIssueFilters = await callMcp(token, 14, 'list_issues', { projectId, status: 'resolved', active: true });
    expect(mcpInvalidIssueFilters.result).toMatchObject({
      isError: true,
      structuredContent: { statusCode: 400, error: { code: restInvalidIssueFilters.json().code } },
    });
    const pendingItem = current.workItems.find((item: { status: string }) => item.status === 'not_started');
    expect(pendingItem).toBeTruthy();
    const restOptionalCompleteCommand = await app.inject({
      method: 'POST', url: `/api/work-items/${pendingItem.id}/complete`, headers: { cookie: replacementCookie }, payload: { expectedVersion: pendingItem.version },
    });
    expect(restOptionalCompleteCommand.statusCode).toBe(409);
    expect(restOptionalCompleteCommand.json()).toMatchObject({ code: 'INVALID_TRANSITION' });
    const mcpOptionalCompleteCommand = await callMcp(token, 12, 'complete_work_item', { id: pendingItem.id, expectedVersion: pendingItem.version });
    expect(mcpOptionalCompleteCommand.result).toMatchObject({
      isError: true,
      structuredContent: { statusCode: 409, error: { code: 'INVALID_TRANSITION' } },
    });
    const restIncompleteIssueCommand = await app.inject({
      method: 'POST', url: '/api/issues/missing-issue/resolve', headers: { cookie: replacementCookie }, payload: { expectedVersion: 1 },
    });
    expect(restIncompleteIssueCommand.statusCode).toBe(404);
    const mcpIncompleteIssueCommand = await callMcp(token, 13, 'resolve_issue', { id: 'missing-issue', expectedVersion: 1 });
    expect(mcpIncompleteIssueCommand.result).toMatchObject({
      isError: true,
      structuredContent: { statusCode: 404, error: { code: 'NOT_FOUND' } },
    });
  });
});
