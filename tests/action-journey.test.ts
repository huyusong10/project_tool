import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scryptSync } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Requirement } from '../src/client/types';
import type { ActionItemsPage } from '../src/shared/action-items';

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
  (await import('./support/database')).sqlite.close();
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
  let requirement = (await request('POST', '/api/requirements', { projectId: project.id, ownerId: owner.id, title: '需要跟进的交付',  durationDays: 2 })).json<Requirement>();
  const detail = async () => (await request('GET', '/api/requirements/' + requirement.id)).json<Requirement>();
  if (mode === 'work_items') {
    await request('POST', `/api/requirements/${requirement.id}/work-items`, { expectedVersion: requirement.version, title: '待跟进的接口', ownerId: executor.id, plannedStart: addBusinessDays(todayIso(), 0), plannedEnd: addBusinessDays(todayIso(), 1) });
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

it('未安排需求与未分派工作都进入同一行动列表',async()=>{
 const f=await fixture('work_items');
 const waiting=(await request('POST','/api/requirements',{projectId:f.project.id,ownerId:f.executor.id,title:'尚未安排的需求'})).json<Requirement>();
 await request('POST',`/api/requirements/${waiting.id}/work-items`,{expectedVersion:waiting.version,title:'未分派工作'});
 const actions=await f.actions(admin);
 expect(actions.items.some(i=>i.requirementId===waiting.id)).toBe(true);
 const assignment=actions.items.find(i=>i.sourceType==='work_item'&&i.requirementId===waiting.id)!;
 expect(new URL(assignment.targetPath,'http://localhost').searchParams.get('detailTab')).toBe('basic');
 expect(actions.items.flatMap(i=>i.reasonCodes)).not.toEqual(expect.arrayContaining(['blocked','candidate','forecast_review']));
});
it.each(['direct','work_items'] as const)('%s 问题和工作分别推进，不需要解阻确认',async mode=>{
 const f=await fixture(mode);
 const issue=(await request('POST','/api/issues',{projectId:f.project.id,requirementId:f.requirement.id,ownerId:f.coordinator.id,title:'环境待恢复',discoveredAt:todayIso()})).json();
 await f.command('start');
 const r=await f.detail(),item=mode==='direct'?r:r.workItems[0];
 await request('POST',`/api/requirements/${r.id}/progress`,{expectedVersion:item.version,...mode==='work_items'?{workItemId:item.id}:{},content:'等待环境恢复'});
 await request('POST',`/api/issues/${issue.id}/resolve`,{expectedVersion:issue.version,content:'环境已恢复'});
 const before=await f.detail();expect(mode==='direct'?before.status:before.workItems[0].status).toBe('in_progress');
 await f.command('complete',{content:'验证完成'});
 expect(await f.detail()).toMatchObject({status:'completed',progress:100,acceptedAt:null});
 expect((await f.actions()).items.some(i=>i.requirementId===r.id)).toBe(false);
});
