import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, scryptSync } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Requirement } from '../src/client/types';
import type { ActionItem } from '../src/shared/action-items';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-assignment-handoff-'));
const password = 'assignment-handoff-isolated-password';
Object.assign(process.env, { DB_PATH: path.join(directory, 'test.db'), BACKUP_DIR: path.join(directory, 'backups'), WEB_DIST_DIR: path.join(directory, 'web'), NODE_ENV: 'test', SEED_DEMO: '0', APP_PASSWORD_HASH: `scrypt$handoff$${scryptSync(password, 'handoff', 64).toString('hex')}`, SESSION_SECRET: 'assignment-handoff-isolated-session-secret-123' });
let app: FastifyInstance, cookie = '', sequence = 0;
const request = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>, auth = cookie) => app.inject({ method, url, headers: { cookie: auth }, payload });
const detail = async (id: string) => (await request('GET', '/api/requirements/' + id)).json<Requirement>();
const actions = async (projectId: string) => (await request('GET', '/api/action-items?projectId=' + projectId)).json<{ items: ActionItem[] }>();
beforeAll(async () => {
  app = await (await import('../src/server/app')).buildApp();
  const login = await request('POST', '/api/login', { username: 'admin', password }, '');
  cookie = String(login.headers['set-cookie']).split(';')[0];
});
afterAll(async () => { await app.close(); const { sqlite } = await import('./support/database'); sqlite.close(); fs.rmSync(directory, { recursive: true, force: true }); });
async function fixture() {
  const projectId = (await request('POST', '/api/projects', { name: '责任交接' + ++sequence })).json().id as string;
  const person = async (role: string) => (await request('POST', '/api/people', { projectId, name: role + sequence })).json() as { id: string; name: string };
  const owner = await person('需求负责人'), previous = await person('原执行人'), next = await person('新执行人');
  const templateId = (await request('POST', '/api/templates', { projectId, name: '交接流程', items: [{ title: '验证交付', startOffsetDays: 0, durationDays: 1, sortOrder: 0 }] })).json().id;
  const created = await request('POST', '/api/requirements', { projectId, ownerId: owner.id, templateId,  title: '交接中的需求' });
  expect(created.statusCode, created.body).toBe(200);
  const r = created.json<Requirement>(), w = r.workItems[0];
  const assigned = await request('PATCH', '/api/work-items/' + w.id, { expectedVersion: w.version, ownerId: previous.id });
  expect(assigned.statusCode, assigned.body).toBe(200);
  const accounts = (await request('GET', '/api/accounts')).json<Array<{ id: string; personId: string; updatedAt: string }>>();
  const account = accounts.find(a => a.personId === previous.id)!;
  const disable = async () => {
    const fresh = (await request('GET', '/api/accounts')).json<Array<{ id: string; updatedAt: string }>>().find(a => a.id === account.id)!;
    const response = await request('PATCH', '/api/accounts/' + account.id, { status: 'disabled', expectedUpdatedAt: fresh.updatedAt });
    expect(response.statusCode, response.body).toBe(200);
  };
  return { projectId, r: await detail(r.id), previous, next, disable };
}

it('停用执行账号后，已有工作项提示责任缺口；更换执行人清除此行动，原计划不变', async () => {
  const { projectId, r, next, disable } = await fixture();
  const w = r.workItems[0];
  await disable();
  expect((await actions(projectId)).items).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: w.id, ownerId: null, ownerName: '项目经理', reasonCodes: expect.arrayContaining(['owner_unavailable']) })]));
  const response = await request('PATCH', '/api/work-items/' + w.id, { expectedVersion: w.version, ownerId: next.id });
  expect(response.statusCode, response.body).toBe(200);
  const changed = (await detail(r.id)).workItems[0];
  expect(changed).toMatchObject({ ownerId: next.id, plannedStart: w.plannedStart, plannedEnd: w.plannedEnd, progress: w.progress, actualStart: w.actualStart, actualEnd: w.actualEnd });
  expect((await actions(projectId)).items.filter(a => a.sourceId === w.id && a.reasonCodes.includes('owner_unavailable'))).toHaveLength(0);
  expect((await request('POST', `/api/work-items/${w.id}/start`, { expectedVersion: changed.version })).statusCode).toBe(200);
});

it('新增和批量草稿都拒绝把工作分派给已停用账号，预览不留下对象', async () => {
  const { projectId, r, previous, disable } = await fixture();
  await disable();
  const before = await detail(r.id);
  const invalid = await request('POST', `/api/requirements/${r.id}/work-items`, { expectedVersion: before.version, title: '不能交给停用账号', ownerId: previous.id });
  expect(invalid.statusCode, invalid.body).toBe(400);
  expect(await detail(r.id)).toEqual(before);
  const graph = (await request('GET', `/api/projects/${projectId}/path-analysis`)).json();
  const preview = await request('POST', `/api/projects/${projectId}/dependency-changes/preview`, { expectedRevision: graph.revision, target: 'project', changes: { add: [], remove: [], estimates: [], entities: [{ op: 'create', entity: 'work', id: randomUUID(), requirementId: r.id, data: { title: '草稿也不能分派', ownerId: previous.id, durationDays: 1 } }] } });
  expect(preview.statusCode, preview.body).toBe(400);
  expect(await detail(r.id)).toEqual(before);
});

it('进行中交接保留进度和开始日期；旧账号失效，新执行人接着完成工作', async () => {
  const { r, previous, next, disable } = await fixture();
  const login = async (name: string) => {
    const signed = await request('POST', '/api/login', { username: name, password: '888888' }, '');
    const auth = String(signed.headers['set-cookie']).split(';')[0];
    const changed = await request('POST', '/api/account/change-password', { currentPassword: '888888', newPassword: 'handoff-member-password-123' }, auth);
    expect(changed.statusCode, changed.body).toBe(200);
    return String(changed.headers['set-cookie']).split(';')[0];
  };
  const oldCookie = await login(previous.name), newCookie = await login(next.name);
  let w = r.workItems[0];
  const start = await request('POST', `/api/work-items/${w.id}/start`, { expectedVersion: w.version }, oldCookie);
  expect(start.statusCode, start.body).toBe(200);
  const progressed = await request('POST', `/api/requirements/${r.id}/progress`, { expectedVersion: start.json().version, workItemId: w.id, workItemPercent: 40, content: '完成第一部分' }, oldCookie);
  expect(progressed.statusCode, progressed.body).toBe(200);
  w = (await detail(r.id)).workItems[0];
  await disable();
  expect((await request('POST', `/api/work-items/${w.id}/complete`, { expectedVersion: w.version, content: '停用后误提交' }, oldCookie)).statusCode).toBe(401);
  const assigned = await request('PATCH', '/api/work-items/' + w.id, { expectedVersion: w.version, ownerId: next.id, reason: '人员交接，剩余工作由新执行人继续' });
  expect(assigned.statusCode, assigned.body).toBe(200);
  expect(assigned.json()).toMatchObject({ actualStart: w.actualStart, progress: 40, status: 'in_progress' });
  const completed = await request('POST', `/api/work-items/${w.id}/complete`, { expectedVersion: assigned.json().version, content: '接手后完成剩余部分' }, newCookie);
  expect(completed.statusCode, completed.body).toBe(200);
  expect(await detail(r.id)).toMatchObject({ status: 'completed', acceptedAt: null, progress: 100 });
});

it('主负责和协作者同时失效时，可以先移除旧协作者再交接，不被未改动的旧归属卡住', async () => {
  const { projectId, r, previous, next, disable } = await fixture();
  const w = r.workItems[0];
  const assigned = await request('PATCH', '/api/work-items/' + w.id, { expectedVersion: w.version, assigneeIds: [previous.id, next.id] });
  expect(assigned.statusCode).toBe(200);
  await disable();
  const account = (await request('GET', '/api/accounts')).json<Array<{ id: string; personId: string; updatedAt: string }>>().find(a => a.personId === next.id)!;
  expect((await request('PATCH', '/api/accounts/' + account.id, { status: 'disabled', expectedUpdatedAt: account.updatedAt })).statusCode).toBe(200);
  const graph = (await request('GET', `/api/projects/${projectId}/path-analysis`)).json();
  const input = { expectedRevision: graph.revision, target: 'project', changes: { add: [], remove: [], estimates: [], entities: [{ op: 'update', entity: 'work', id: w.id, expectedVersion: assigned.json().version, data: { assigneeIds: [previous.id] } }] } };
  const preview = await request('POST', `/api/projects/${projectId}/dependency-changes/preview`, input);
  expect(preview.statusCode, preview.body).toBe(200);
  const removed = await request('PATCH', '/api/work-items/' + w.id, { expectedVersion: assigned.json().version, assigneeIds: [previous.id] });
  expect(removed.statusCode, removed.body).toBe(200);
  expect(removed.json().ownerId).toBe(previous.id);
  expect(removed.json().collaborators).toEqual([]);
  const changed = await request('PATCH', '/api/work-items/' + w.id, { expectedVersion: removed.json().version, ownerId: r.ownerId });
  expect(changed.statusCode, changed.body).toBe(200);
  const rejected = await request('PATCH', '/api/work-items/' + w.id, { expectedVersion: changed.json().version, assigneeIds: [r.ownerId, next.id] });
  expect(rejected.statusCode).toBe(400);
});


