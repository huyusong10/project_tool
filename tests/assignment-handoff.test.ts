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

it('工作分解需求拒绝分派给停用账号，保留原负责人编辑及终态历史纠错', async () => {
  const { r, previous, next, disable } = await fixture();
  await disable();
  const before = await detail(r.id);
  const invalid = await request('PATCH', '/api/requirements/' + r.id, { expectedVersion: before.version, ownerId: previous.id });
  expect(invalid.statusCode, invalid.body).toBe(400);
  expect(await detail(r.id)).toEqual(before);

  const { sqlite } = await import('./support/database');
  const storedWork = () => sqlite.prepare('SELECT * FROM work_items WHERE requirement_id=? ORDER BY id').all(r.id);
  const workBefore = storedWork();
  const handed = await request('PATCH', '/api/requirements/' + r.id, { expectedVersion: before.version, ownerId: next.id });
  expect(handed.statusCode, handed.body).toBe(200);
  expect(handed.json()).toMatchObject({ ownerId: next.id, ownerValid: true, version: before.version + 1 });
  expect(storedWork()).toEqual(workBefore);
  expect((await detail(r.id)).progressUpdates).toEqual(before.progressUpdates);

  const account = (await request('GET', '/api/accounts')).json().find((item: { personId: string }) => item.personId === next.id);
  expect((await request('PATCH', '/api/accounts/' + account.id, { status: 'disabled', expectedUpdatedAt: account.updatedAt })).statusCode).toBe(200);
  const current = await detail(r.id);
  const edited = await request('PATCH', '/api/requirements/' + r.id, { expectedVersion: current.version, ownerId: next.id, background: '保留历史负责人，只补充说明' });
  expect(edited.statusCode, edited.body).toBe(200);
  expect(edited.json()).toMatchObject({ ownerId: next.id, ownerValid: false, background: '保留历史负责人，只补充说明' });
  expect(storedWork()).toEqual(workBefore);

  const cancelled = await request('POST', '/api/requirements/' + r.id + '/cancel', { expectedVersion: edited.json().version, reason: '保留已取消需求的历史资料' });
  expect(cancelled.statusCode, cancelled.body).toBe(200);
  const cancelledWork = storedWork();
  const corrected = await request('PATCH', '/api/requirements/' + r.id, { expectedVersion: cancelled.json().version, ownerId: previous.id, reason: '更正原历史负责人' });
  expect(corrected.statusCode, corrected.body).toBe(200);
  expect(corrected.json()).toMatchObject({ ownerId: previous.id, status: 'cancelled' });
  expect(storedWork()).toEqual(cancelledWork);
});

it('问题负责人账号停用后提示交接，拒绝新增分派；交接保留进度和历史', async () => {
  const { projectId, previous, next, disable } = await fixture();
  const created = await request('POST', '/api/issues', { projectId, title: '问题责任交接', ownerId: previous.id });
  expect(created.statusCode, created.body).toBe(200);
  const issue = created.json();
  const progressed = await request('POST', `/api/issues/${issue.id}/updates`, { expectedVersion: issue.version, progress: 40, content: '交接前已核对一部分' });
  expect(progressed.statusCode, progressed.body).toBe(200);
  await disable();
  const before = (await request('GET', '/api/issues/' + issue.id)).json();
  expect(before).toMatchObject({ ownerId: previous.id, progress: 40, status: 'in_progress' });
  expect.soft((await actions(projectId)).items).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: issue.id, ownerId: null, ownerName: '项目经理', reasonCodes: expect.arrayContaining(['owner_unavailable']) })]));
  const invalid = await request('POST', '/api/issues', { projectId, title: '不能分派给停用账号', ownerId: previous.id });
  expect.soft(invalid.statusCode, invalid.body).toBe(400);
  const unassigned = (await request('POST', '/api/issues', { projectId, title: '待分派问题' })).json();
  const invalidUpdate = await request('PATCH', '/api/issues/' + unassigned.id, { ownerId: previous.id, expectedVersion: unassigned.version });
  expect.soft(invalidUpdate.statusCode, invalidUpdate.body).toBe(409);
  expect((await request('GET', '/api/issues/' + unassigned.id)).json()).toMatchObject({ ownerId: null, version: unassigned.version });
  const handed = await request('PATCH', '/api/issues/' + issue.id, { ownerId: next.id, expectedVersion: before.version });
  expect(handed.statusCode, handed.body).toBe(200);
  expect(handed.json()).toMatchObject({ ownerId: next.id, progress: 40, status: 'in_progress', updates: before.updates });
  expect((await actions(projectId)).items.some(item => item.sourceId === issue.id && item.reasonCodes.includes('owner_unavailable'))).toBe(false);
  const resolved = await request('POST', '/api/issues/' + issue.id + '/resolve', { expectedVersion: handed.json().version });
  expect(resolved.statusCode, resolved.body).toBe(200);
  const historical = await request('PATCH', '/api/issues/' + issue.id, { ownerId: previous.id, expectedVersion: resolved.json().version, reason: '保留历史负责人' });
  expect(historical.statusCode, historical.body).toBe(200);
  expect(historical.json()).toMatchObject({ status: 'resolved', progress: 100, ownerId: previous.id });
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

for (const field of ['assigneeIds', 'collaboratorIds'] as const) it(`${field} 调整协作后，记录保存真实旧人员和姓名，负责人接手不丢失原分工`, async () => {
  const { r, previous, next } = await fixture();
  let work = r.workItems[0];
  const assigned = await request('PATCH', '/api/work-items/' + work.id, { expectedVersion: work.version, collaboratorIds: [next.id] });
  expect(assigned.statusCode, assigned.body).toBe(200);
  const started = await request('POST', `/api/work-items/${work.id}/start`, { expectedVersion: assigned.json().version });
  expect(started.statusCode, started.body).toBe(200);
  work = (await detail(r.id)).workItems[0];
  const removed = await request('PATCH', '/api/work-items/' + work.id, { expectedVersion: work.version, [field]: field === 'assigneeIds' ? [previous.id] : [] });
  expect(removed.statusCode, removed.body).toBe(200);
  let fresh = await detail(r.id);
  expect(fresh.progressUpdates?.[0].content).toBe(`协作人员：${next.name} → 未设置`);
  expect(fresh.workItems[0]).toMatchObject({ ownerId: previous.id, collaborators: [], status: work.status, progress: work.progress, actualStart: work.actualStart });
  const restored = await request('PATCH', '/api/work-items/' + work.id, { expectedVersion: fresh.workItems[0].version, collaboratorIds: [next.id] });
  expect(restored.statusCode, restored.body).toBe(200);
  const handed = await request('PATCH', '/api/work-items/' + work.id, { expectedVersion: restored.json().version, ownerId: next.id });
  expect(handed.statusCode, handed.body).toBe(200);
  fresh = await detail(r.id);
  expect(fresh.progressUpdates?.[0].content).toBe(`负责人：${previous.name} → ${next.name}；协作人员：${next.name} → 未设置`);
  expect(fresh.workItems[0]).toMatchObject({ ownerId: next.id, collaborators: [], status: work.status, progress: work.progress, actualStart: work.actualStart });
});


