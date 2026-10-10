import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scryptSync } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { MyWork, Requirement } from '../src/client/types';
import { todayIso } from '../src/shared/domain';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-my-work-journey-'));
const password = 'isolated-work-journey-password';
Object.assign(process.env, {
  DB_PATH: path.join(directory, 'test.db'), BACKUP_DIR: path.join(directory, 'backups'),
  WEB_DIST_DIR: path.join(directory, 'web'), SEED_DEMO: '0', NODE_ENV: 'test',
  APP_PASSWORD_HASH: `scrypt$journey$${scryptSync(password, 'journey', 64).toString('hex')}`,
  SESSION_SECRET: 'my-work-journey-secret-more-than-thirty-two-characters',
});
let app: FastifyInstance, admin = '', sequence = 0;
const cookieOf = (r: { headers: Record<string, unknown> }) => String(r.headers['set-cookie']).split(';')[0];
async function request(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>, cookie = admin) {
  const result = await app.inject({ method, url, payload, headers: { cookie } });
  expect(result.statusCode, result.body).toBe(200);
  return result;
}
beforeAll(async () => {
  app = await (await import('../src/server/app')).buildApp();
  await app.ready();
  admin = cookieOf(await request('POST', '/api/login', { username: 'admin', password }, ''));
});
afterAll(async () => {
  await app.close();
  (await import('./support/database')).sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

async function fixture() {
  const project = (await request('POST', '/api/projects', { name: '我的工作旅程' + ++sequence })).json();
  const owner = (await request('POST', '/api/people', { projectId: project.id, name: '主责旅程' + sequence })).json();
  const collaborator = (await request('POST', '/api/people', { projectId: project.id, name: '协作旅程' + sequence })).json();
  const login = cookieOf(await request('POST', '/api/login', { username: collaborator.name, password: '888888' }, ''));
  const member = cookieOf(await request('POST', '/api/account/change-password', { currentPassword: '888888', newPassword: password }, login));
  const r = (await request('POST', '/api/requirements', { projectId: project.id, title: '协作交付',  ownerId: owner.id })).json<Requirement>();
  await request('POST', `/api/requirements/${r.id}/work-items`, { expectedVersion: r.version, title: '无排期的协作工作', ownerId: owner.id, collaboratorIds: [collaborator.id] });
  const detail = async () => (await request('GET', '/api/requirements/' + r.id)).json<Requirement>();
  const myWork = async () => (await request('GET', '/api/my-work', undefined, member)).json<MyWork>();
  const work = (await detail()).workItems[0];
  const command = async (action: string, data: Record<string, unknown> = {}) => {
    const current = (await detail()).workItems[0];
    return request('POST', `/api/work-items/${work.id}/${action}`, { expectedVersion: current.version, ...data }, member);
  };
  return { detail, myWork, command, work, owner, collaborator };
}

it('协作成员从我的工作开始、补充说明到完成；自动完成且不伪造验收事实', async () => {
  const { detail, myWork, command, work } = await fixture();
  expect((await myWork()).items[0]).toMatchObject({ id: work.id, assignmentType: 'collaborator', plannedStart: null, plannedEnd: null });
  await command('start');
  const before = await detail();
  await request('POST', `/api/requirements/${before.id}/progress`, { workItemId: work.id, expectedVersion: before.workItems[0].version, content: '接口负责人正在核对' });
  expect((await detail()).workItems[0]).toMatchObject({ status: 'in_progress', progress: 0, actualEnd: null });
  await command('complete', { content: '接口已核对并交付' });
  const completed = await detail(), result = await myWork();
  expect(completed).toMatchObject({ status: 'completed', acceptedAt: null, progress: 100 });
  expect(result.summary).toMatchObject({ inProgress: 0, blocked: 0, completed: 1 });
  expect(result.completionTrend.reduce((sum, item) => sum + item.completed, 0)).toBe(1);
  expect(result.items[0]).toMatchObject({ status: 'completed', actualEnd: todayIso(), requirementStatus: 'completed' });
});

it('我的工作与详情共用估算、参与人和执行记录，只返回本人参与项', async () => {
  const { detail, myWork, command, work, owner } = await fixture();
  const r = await detail();
  await request('POST', `/api/requirements/${r.id}/work-items`, { expectedVersion: r.version, title: '其他人的工作', ownerId: owner.id });
  await command('start');
  const analysis = (await request('GET', `/api/projects/${r.projectId}/path-analysis`)).json();
  await request('PATCH', `/api/work-items/${work.id}/path-estimate`, { expectedRevision: analysis.revision, durationDays: 3 });
  const { forecastBasis: _basis, blockerCoordination: _coordination, ...blocked } = (await detail()).workItems[0];
  expect(blocked.durationDays).toBe(3);
  expect(blocked.forecastReview).toBeNull();
  const result = await myWork();
  expect(result.items).toHaveLength(1);
  expect(result.items.find(item => item.id === work.id)).toMatchObject(blocked);
  expect(result.requirements).toEqual([]);
});

it('取消工作从我的工作移除，保留需求历史且不计为完成', async () => {
  const { detail, myWork, command, work } = await fixture();
  await command('start');
  await request('POST', `/api/work-items/${work.id}/cancel`, { expectedVersion: (await detail()).workItems[0].version, reason: '这一项不再交付' });
  const after=await detail(),result=await myWork();
  expect(after.workItems).toEqual([]);
  expect(after.progressUpdates).toEqual(expect.arrayContaining([expect.objectContaining({workItemId:work.id,eventType:'cancel'})]));
  expect(result.items.some(item=>item.id===work.id)).toBe(false);
  expect(result.summary).toMatchObject({ total: 0, completed: 0, blocked: 0 });
  expect(result.completionTrend).toEqual([]);
});
