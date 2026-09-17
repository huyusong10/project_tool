import {listenTestApp} from './support/listen';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'work-item-assignment-'));
process.env.DB_PATH = path.join(directory, 'test.db');
process.env.BACKUP_DIR = path.join(directory, 'backups');
process.env.SEED_DEMO = '0';
process.env.APP_PASSWORD_HASH = 'scrypt$4c63a6f93ff4f94b031b7e7583592177$b598dbddaf9dd06678ff8756923d9e0a7f2d68eaa45bc644fbf4a73c9298970c7489671dfcfc8be282022c26a3370fb040f3f086a45faa1e1abde04bbe4a51ef';
process.env.SESSION_SECRET = 'work-item-assignment-test-session-secret-123456789';

let app: FastifyInstance;
let cookie = '';
let token = '';
let origin = '';
let projectId = '';

const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, headers: { cookie }, payload });
const patch = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url, headers: { cookie }, payload });

async function callMcp(name: string, args: Record<string, unknown>) {
  const response = await fetch(`${origin}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      connection: 'close',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await response.text();
  expect(response.status, body).toBe(200);
  return JSON.parse(body).result;
}

beforeAll(async () => {
  app = await (await import('../src/server/app')).buildApp();
  origin = await listenTestApp(app);
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: '41_xc7q0qOjo4Inw!' } });
  cookie = String(login.headers['set-cookie']).split(';')[0];
  projectId = (await post('/api/projects', { name: '工作项分派测试' })).json().id;
  token = (await post('/api/tokens', { name: '工作项分派测试' })).json().token;
});

afterAll(async () => {
  await app?.close();
  const { sqlite } = await import('./support/database');
  if (sqlite.open) sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

it('执行后修改协作者无需说明，REST与MCP保留记录并拒绝旧版本', async () => {
  const owner = (await post('/api/people', { projectId, name: '工作项负责人' })).json();
  const firstCollaborator = (await post('/api/people', { projectId, name: '首位协作者' })).json();
  const secondCollaborator = (await post('/api/people', { projectId, name: '后续协作者' })).json();
  const requirement = (await post('/api/requirements', {templateId: await defaultTemplate(projectId),
    projectId, title: '执行中调整协作者', ownerId: owner.id, plannedStart: '2020-01-02',
  })).json();
  const initial = requirement.workItems[0];
  const assigned = await patch(`/api/work-items/${initial.id}`, {
    ownerId: owner.id,
    assigneeIds: [owner.id, firstCollaborator.id, firstCollaborator.id],
    expectedVersion: initial.version,
  });
  expect(assigned.statusCode, assigned.body).toBe(200);
  expect(assigned.json().assigneeIds).toEqual([owner.id, firstCollaborator.id]);
  const started = await post(`/api/work-items/${initial.id}/start`, { expectedVersion: assigned.json().version });
  expect(started.statusCode, started.body).toBe(200);

  const restRejected = await patch(`/api/work-items/${initial.id}`, {
    collaboratorIds: [], expectedVersion: started.json().version,
  });
  expect(restRejected.statusCode,restRejected.body).toBe(200);

  const mcpRejected = await callMcp('update_work_item', {
    id: initial.id, collaboratorIds: [secondCollaborator.id], expectedVersion: started.json().version,
  });
  expect(mcpRejected.structuredContent).toMatchObject({
    statusCode: 409,
    error: { code: 'STALE_WRITE' },
  });

  const changed = await patch(`/api/work-items/${initial.id}`, {
    collaboratorIds: [secondCollaborator.id], reason: '调整执行协作分工', expectedVersion: restRejected.json().version,
  });
  expect(changed.statusCode, changed.body).toBe(200);
  expect(changed.json().assigneeIds).toEqual([owner.id, secondCollaborator.id]);
  const changedByMcp = await callMcp('update_work_item', {
    id: initial.id, collaboratorIds: [firstCollaborator.id], reason: '通过MCP恢复协作分工', expectedVersion: changed.json().version,
  });
  expect(changedByMcp.structuredContent.result.assigneeIds).toEqual([owner.id, firstCollaborator.id]);
  const promoted = await patch(`/api/work-items/${initial.id}`, {
    ownerId: firstCollaborator.id, reason: '将原协作者调整为主负责人', expectedVersion: changedByMcp.structuredContent.result.version,
  });
  expect(promoted.statusCode, promoted.body).toBe(200);
  expect(promoted.json()).toMatchObject({ ownerId: firstCollaborator.id, collaborators: [], assigneeIds: [firstCollaborator.id] });

  const detail = (await app.inject({ method: 'GET', url: `/api/requirements/${requirement.id}`, headers: { cookie } })).json();
  expect(detail.progressUpdates).toEqual(expect.arrayContaining([
    expect.objectContaining({ eventType: 'correction', content: '调整执行协作分工', workItemId: initial.id }),
    expect.objectContaining({ eventType: 'correction', content: '通过MCP恢复协作分工', workItemId: initial.id }),
    expect.objectContaining({ eventType: 'correction', content: '将原协作者调整为主负责人', workItemId: initial.id }),
  ]));
});

it('大批量协作者校验分块执行并完整保存', async () => {
  const { sqlite } = await import('./support/database');
  const requirement = (await post('/api/requirements', {templateId: await defaultTemplate(projectId),  projectId, title: '大批量协作者', plannedStart: '2020-01-02' })).json();
  const item = requirement.workItems[0];
  const now = new Date().toISOString();
  const personIds = Array.from({ length: 901 }, () => randomUUID());
  const insertPerson = sqlite.prepare('INSERT INTO people (id,name,active,created_at,updated_at) VALUES (?,?,1,?,?)');
  const insertAccount = sqlite.prepare("INSERT INTO accounts (id,person_id,username,normalized_username,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?)");
  const insertMembership = sqlite.prepare("INSERT INTO project_people (project_id,person_id,project_role,created_at,updated_at) VALUES (?,?,'member',?,?)");
  sqlite.transaction(() => {
    personIds.forEach((personId, index) => {
      insertPerson.run(personId, `批量协作者${index + 1}`, now, now);
      insertAccount.run(randomUUID(), personId, `batch-${personId}`, `batch-${personId}`, process.env.APP_PASSWORD_HASH, now, now);
      insertMembership.run(projectId, personId, now, now);
    });
  })();

  const originalPrepare = sqlite.prepare.bind(sqlite);
  let maximumParameters = 0;
  sqlite.prepare = ((source: string) => {
    if (source.includes('WHERE id IN (') || source.includes('pp.person_id IN (')) {
      maximumParameters = Math.max(maximumParameters, source.match(/\?/g)?.length || 0);
    }
    return originalPrepare(source);
  }) as typeof sqlite.prepare;
  let response;
  try {
    response = await patch(`/api/work-items/${item.id}`, {
      collaboratorIds: [personIds[0], ...personIds, personIds.at(-1)], expectedVersion: item.version,
    });
  } finally {
    sqlite.prepare = originalPrepare as typeof sqlite.prepare;
  }

  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().collaborators).toHaveLength(901);
  expect(new Set(response.json().assigneeIds)).toEqual(new Set(personIds));
  expect(maximumParameters).toBeLessThanOrEqual(900);
});

async function defaultTemplate(projectId:string){const response=await app.inject({url:"/api/templates?projectId="+projectId,headers:{cookie}});return response.json<Array<{id:string}>>()[0].id;}
