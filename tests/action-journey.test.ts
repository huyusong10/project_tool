import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scryptSync } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Requirement } from '../src/client/types';
import type { ActionItemsPage } from '../src/shared/action-items';
import type { PathAnalysis } from '../src/shared/paths';
import { addBusinessDays, todayIso } from '../src/shared/domain';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-action-journey-'));
const password = 'isolated-action-journey-password';
Object.assign(process.env, {
  DB_PATH: path.join(directory, 'test.db'), BACKUP_DIR: path.join(directory, 'backups'),
  WEB_DIST_DIR: path.join(directory, 'web'), SEED_DEMO: '0', NODE_ENV: 'test',
  APP_PASSWORD_HASH: `scrypt$actions$${scryptSync(password, 'actions', 64).toString('hex')}`,
  SESSION_SECRET: 'action-journey-secret-more-than-thirty-two-characters',
});
let app: FastifyInstance, admin = '', sequence = 0;
const cookieOf = (r: { headers: Record<string, unknown> }) => String(r.headers['set-cookie']).split(';')[0];
async function request(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>, cookie = admin) {
  const response = await app.inject({ method, url, payload, headers: { cookie } });
  expect(response.statusCode, response.body).toBe(200);
  return response;
}
beforeAll(async () => {
  app = await (await import('../src/server/app')).buildApp();
  await app.ready();
  admin = cookieOf(await request('POST', '/api/login', { username: 'admin', password }, ''));
});
afterAll(async () => {
  await app.close();
  (await import('../src/server/database')).sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

async function fixture(mode: 'direct' | 'work_items') {
  const project = (await request('POST', '/api/projects', { name: '行动旅程' + ++sequence })).json();
  const person = async (name: string) => {
    const p = (await request('POST', '/api/people', { projectId: project.id, name: name + sequence })).json();
    const initial = cookieOf(await request('POST', '/api/login', { username: p.name, password: '888888' }, ''));
    const cookie = cookieOf(await request('POST', '/api/account/change-password', { currentPassword: '888888', newPassword: password }, initial));
    return { ...p, cookie } as { id: string; name: string; cookie: string };
  };
  const owner = await person('需求主责'), executor = mode === 'direct' ? owner : await person('工作项主责');
  const coordinator = await person('问题协调');
  let requirement = (await request('POST', '/api/requirements', { projectId: project.id, ownerId: owner.id, title: '需要跟进的交付', executionMode: mode, durationDays: 2 })).json<Requirement>();
  const detail = async () => (await request('GET', '/api/requirements/' + requirement.id)).json<Requirement>();
  if (mode === 'work_items') {
    await request('POST', `/api/requirements/${requirement.id}/work-items`, { expectedVersion: requirement.version, title: '待跟进的接口', ownerId: executor.id, plannedStart: todayIso(), plannedEnd: addBusinessDays(todayIso(), 1) });
    requirement = await detail();
  }
  const sourceId = mode === 'direct' ? requirement.id : requirement.workItems[0].id;
  const command = async (action: string, data: Record<string, unknown> = {}) => {
    const r = await detail(), item = mode === 'direct' ? r : r.workItems[0];
    return request('POST', `/api/${mode === 'direct' ? 'requirements' : 'work-items'}/${sourceId}/${action}`, { expectedVersion: item.version, ...data }, executor.cookie);
  };
  const actions = async (cookie = executor.cookie, query = '') => (await request('GET', `/api/action-items?projectId=${project.id}&pageSize=100${query}`, undefined, cookie)).json<ActionItemsPage>();
  return { project, owner, executor, coordinator, requirement, sourceId, detail, command, actions };
}

it('撤出已开工需求不会让工作项负责人的阻塞行动消失，未开工候选仍不产生补齐行动', async () => {
  const f = await fixture('work_items');
  await f.command('start');
  await f.command('block', { reason: '等待核对环境' });
  expect((await f.actions()).items.find(item => item.sourceId === f.sourceId)?.reasonCodes).toContain('blocked');
  const current = await f.detail();
  await request('PATCH', '/api/requirements/' + current.id, { expectedVersion: current.version, deliveryScope: 'candidate', reason: '移出本期交付，现有工作继续' });
  expect((await f.detail()).workItems[0].status).toBe('blocked');
  const item = (await f.actions()).items.find(item => item.sourceId === f.sourceId);
  expect(item?.reasonCodes).toContain('blocked');
  expect(item?.targetPath).toContain('action=follow-up');
  await f.command('unblock');
  expect((await f.actions()).items.find(item => item.sourceId === f.sourceId)?.reasonCodes || []).not.toContain('blocked');
  const waiting = (await request('POST', '/api/requirements', { projectId: f.project.id, ownerId: f.executor.id, title: '候选尚未安排', executionMode: 'work_items', deliveryScope: 'candidate' })).json<Requirement>();
  await request('POST', `/api/requirements/${waiting.id}/work-items`, { expectedVersion: waiting.version, title: '候选未分派工作' });
  expect((await f.actions()).items.some(item => item.requirementId === waiting.id)).toBe(false);
});

it.each(['direct', 'work_items'] as const)('%s：问题解决后交给执行人确认解阻，不沿用问题的下次跟进日期或路径浏览入口', async mode => {
  const f = await fixture(mode);
  if (mode === 'work_items') {
    const analysis = async () => (await request('GET', `/api/projects/${f.project.id}/path-analysis`)).json<PathAnalysis>();
    await request('POST', `/api/requirements/${f.requirement.id}/dependency-review`, { expectedRevision: (await analysis()).revision, reviewed: true, forecastAcceptance: addBusinessDays(todayIso(), 1) });
    await request('PATCH', `/api/work-items/${f.sourceId}/path-estimate`, { expectedRevision: (await analysis()).revision, durationDays: 2, unblockEstimate: todayIso() });
  }
  const issue = (await request('POST', '/api/issues', { projectId: f.project.id, ownerId: f.coordinator.id, title: '供应环境恢复', discoveredAt: todayIso(), nextReviewAt: addBusinessDays(todayIso(), 5) })).json();
  await f.command('start');
  await f.command('block', { reason: '供应环境不可用', blockedIssueId: issue.id });
  if (mode === 'work_items') {
    const analysis = (await request('GET', `/api/projects/${f.project.id}/path-analysis`)).json<PathAnalysis>();
    expect(analysis.blockers.find(item => item.workItemId === f.sourceId)?.critical).toBe(true);
  }
  const grouped = (await f.actions(f.coordinator.cookie)).items.find(item => item.sourceId === issue.id);
  expect(grouped).toMatchObject({ sourceType: 'issue', ownerId: f.coordinator.id });
  await request('POST', `/api/issues/${issue.id}/resolve`, { expectedVersion: issue.version, content: '环境已经恢复' });
  const current = await f.detail();
  expect(mode === 'direct' ? current.status : current.workItems[0].status).toBe('blocked');
  expect((mode === 'direct' ? current : current.workItems[0]).blockerCoordination).toMatchObject({ coordinatorId: f.executor.id, nextReviewAt: null, issueResolved: true });
  const item = (await f.actions(f.executor.cookie, '&ownerId=' + f.executor.id)).items.find(item => item.sourceId === f.sourceId);
  expect(item).toMatchObject({ ownerId: f.executor.id, ownerName: f.executor.name });
  expect(item?.reasonCodes).toContain('blocker_resolved');
  expect.soft(item?.nextReviewAt).toBeNull();
  const target = new URL(item!.targetPath, 'http://localhost');
  expect(target.pathname).toBe('/requirements/' + f.requirement.id);
  expect(target.searchParams.get('view')).toBeNull();
  if (mode === 'work_items') expect(target.searchParams.get('workItemId')).toBe(f.sourceId);
  expect((await f.actions(f.coordinator.cookie)).items.some(entry => entry.reasonCodes.includes('blocker_resolved'))).toBe(false);
  const denied = await app.inject({ method: 'POST', url: `/api/${mode === 'direct' ? 'requirements' : 'work-items'}/${f.sourceId}/unblock`, headers: { cookie: f.coordinator.cookie }, payload: { expectedVersion: mode === 'direct' ? current.version : current.workItems[0].version } });
  expect(denied.statusCode).toBe(403);
  await f.command('unblock');
  expect((await f.actions()).items.some(entry => entry.reasonCodes.includes('blocker_resolved'))).toBe(false);
  expect((await request('GET', '/api/issues/' + issue.id)).json()).toMatchObject({ status: 'resolved', nextReviewAt: addBusinessDays(todayIso(), 5) });
});
