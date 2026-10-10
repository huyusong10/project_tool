import {listenTestApp} from './support/listen';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scryptSync } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PlanPreview, Requirement, WorkItemTemplate } from '../src/client/types';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-manage-plan-preview-'));
const password = 'temporary-plan-preview-password';
process.env.DB_PATH = path.join(directory, 'test.db');
process.env.BACKUP_DIR = path.join(directory, 'backups');
process.env.WEB_DIST_DIR = path.join(directory, 'web');
process.env.SEED_DEMO = '0';
process.env.NODE_ENV = 'test';
process.env.APP_PASSWORD_HASH = `scrypt$preview$${scryptSync(password, 'preview', 64).toString('hex')}`;
process.env.SESSION_SECRET = 'plan-preview-temporary-secret-123456789';
let app: FastifyInstance;
let cookie = '';
let token = '';
let origin = '';
let sequence = 0;
type Preview = PlanPreview;
const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, headers: { cookie }, payload });
const detail = async (id: string) => (await app.inject({ url: `/api/requirements/${id}`, headers: { cookie } })).json<Requirement>();

async function businessState() {
  const { sqlite } = await import('./support/database');
  // MCP鉴权会更新Token最后使用时间；这里只比较计划、执行记录和业务审计。
  return ['requirements', 'work_items', 'progress_updates', 'audit_logs'].map((table) => sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
}

async function plan(protocol: 'REST' | 'MCP', action: 'preview' | 'apply', requirementId: string, input: Record<string, unknown>) {
  if (protocol === 'REST') {
    const response = await post(`/api/requirements/${requirementId}/${action === 'preview' ? 'plan-preview' : 'apply-plan'}`, input);
    return { statusCode: response.statusCode, body: response.json() };
  }
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: `${action}_requirement_plan`, arguments: { requirementId, ...input } } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number; result?: unknown; error?: string } } };
  const content = payload.result.structuredContent;
  return { statusCode: content.statusCode || 200, body: content.result ?? content };
}

async function fixture() {
  const projectId = (await post('/api/projects', { name: `补全预览${++sequence}` })).json().id;
  const template = (await post('/api/templates', { projectId, name: '补全流程', items: [
    { title: '实现', startOffsetDays: 0, durationDays: 2, sortOrder: 0 },
  ] })).json<WorkItemTemplate>();
  const created = await post('/api/requirements', { projectId, title: '补全需求' });
  expect(created.statusCode, created.body).toBe(200);
  return { template, requirement: created.json<Requirement>(), input: { templateId: template.id, baseStart: '2026-09-01' } };
}

it('创建时排期越界返回400且回滚需求、工作项和审计，随后仍可正常创建', async () => {
  const { template, requirement } = await fixture();
  const baseline = await businessState();
  const created = await post('/api/requirements', { projectId: requirement.projectId, templateId: template.id, title: '越界排期', plannedStart: '9999-12-31' });
  expect(created.statusCode, created.body).toBe(400);
  expect(created.json()).toMatchObject({ code: 'VALIDATION_ERROR', error: '排期超出支持的日期范围，请调整日期或工期' });
  expect(await businessState()).toEqual(baseline);
  const valid = await post('/api/requirements', { projectId: requirement.projectId, templateId: template.id, title: '正常排期', plannedStart: '2026-09-01' });
  expect(valid.statusCode, valid.body).toBe(200);
  expect(valid.json().workItems[0]).toMatchObject({ plannedStart: '2026-09-01', plannedEnd: '2026-09-02' });
});

it.each(['REST', 'MCP'] as const)('%s补全排期越界不改变原需求和记录', async protocol => {
  const { requirement, input } = await fixture();
  const baseline = await businessState();
  for (const action of ['preview', 'apply'] as const) {
    const response = await plan(protocol, action, requirement.id, { ...input, baseStart: '9999-12-31', ...(action === 'apply' ? { expectedVersion: requirement.version } : {}) });
    expect(response.statusCode).toBe(400);
    expect(protocol === 'MCP' ? response.body.error : response.body).toMatchObject({ code: 'VALIDATION_ERROR', error: '排期超出支持的日期范围，请调整日期或工期' });
    expect(await businessState()).toEqual(baseline);
  }
});

it('人员并发读取合法的最后两日，不把查询上限计算溢出当作五年超限', async () => {
  const { requirement } = await fixture();
  const response = await app.inject({ url: `/api/analytics/people-concurrency?projectId=${requirement.projectId}&from=9999-12-30&to=9999-12-31`, headers: { cookie } });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json()).toMatchObject({ dates: ['9999-12-30', '9999-12-31'], people: [] });
});

it('合法边界的单日计划可以创建及读取，查询不修改计划与历史',async()=>{
  const {requirement}=await fixture();
  const template=(await post('/api/templates',{projectId:requirement.projectId,name:'合法边界单日流程',items:[{title:'单日工作',startOffsetDays:0,durationDays:1,sortOrder:0}]})).json<WorkItemTemplate>();
  for(const date of ['0100-01-01','9999-12-31']){
    const created=await post('/api/requirements',{projectId:requirement.projectId,templateId:template.id,title:`单日计划${date}`,plannedStart:date});
    expect(created.statusCode,created.body).toBe(200);
    const item=created.json<Requirement>();
    expect(item).toMatchObject({plannedStart:date,plannedEnd:date,workItems:[{plannedStart:date,plannedEnd:date}]});
    const baseline=await businessState();
    expect(await detail(item.id)).toEqual(item);
    for(const url of [`/api/projects/${requirement.projectId}/path-analysis`,`/api/dashboard?projectId=${requirement.projectId}`]){
      const read=await app.inject({url,headers:{cookie}});expect(read.statusCode,read.body).toBe(200);
    }
    expect(await businessState()).toEqual(baseline);
  }
});

beforeAll(async () => {
  app = await (await import('../src/server/app')).buildApp();
  origin = await listenTestApp(app);
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password } });
  expect(login.statusCode).toBe(200);
  cookie = String(login.headers['set-cookie']).split(';')[0];
  token = (await post('/api/tokens', { name: '补全预览验证' })).json().token;
});

afterAll(async () => {
  await app?.close();
  const { sqlite } = await import('./support/database');
  if (sqlite.open) sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

for (const protocol of ['REST', 'MCP'] as const) {
  it(`${protocol}模板修改后拒绝旧预览，重新预览后才按显示日期写入`, async () => {
    const { template, requirement, input } = await fixture();
    const initial = await plan(protocol, 'preview', requirement.id, input);
    expect(initial.statusCode).toBe(200);
    const preview = initial.body as Preview;
    const updated = await app.inject({ method: 'PATCH', url: `/api/templates/${template.id}`, headers: { cookie }, payload: {
      name: template.name,
      items: template.items.map(({ id, title, startOffsetDays, milestoneLabel, sortOrder }) => ({
        id, title, startOffsetDays, durationDays: 4, milestoneLabel, sortOrder,
      })),
    } });
    expect(updated.statusCode, updated.body).toBe(200);
    const beforeApply = await detail(requirement.id);
    expect(beforeApply.version).toBe(requirement.version);
    const storedBefore = await businessState();
    const applied = await plan(protocol, 'apply', requirement.id, { ...input, expectedVersion: requirement.version, previewToken: preview.previewToken });
    expect(applied.statusCode).toBe(409);
    expect(await detail(requirement.id)).toEqual(beforeApply);
    expect(await businessState()).toEqual(storedBefore);
    const fresh = (await plan(protocol, 'preview', requirement.id, input)).body as Preview;
    expect(fresh.previewToken).not.toBe(preview.previewToken);
    expect(fresh.requirementVersion).toBe(requirement.version);
    const accepted = await plan(protocol, 'apply', requirement.id, { ...input, expectedVersion: fresh.requirementVersion, previewToken: fresh.previewToken });
    expect(accepted.statusCode).toBe(200);
    const saved = await detail(requirement.id);
    expect(saved.workItems[0]).toMatchObject({ plannedStart: fresh.entries[0].proposedStart, plannedEnd: fresh.entries[0].proposedEnd });
    expect((await plan(protocol, 'apply', requirement.id, { ...input, expectedVersion: fresh.requirementVersion, previewToken: fresh.previewToken })).statusCode).toBe(409);
    expect(await detail(requirement.id)).toEqual(saved);
  });

  it(`${protocol}预览使用保留后的真实日期，拒绝补成倒置区间且不写任何记录`, async () => {
    const { template, requirement, input } = await fixture();
    const created = await post(`/api/requirements/${requirement.id}/work-items`, {
      title: template.items[0].title, plannedEnd: '2026-09-04', expectedVersion: requirement.version,
    });
    expect(created.statusCode, created.body).toBe(200);
    const before = await detail(requirement.id);
    const preview = (await plan(protocol, 'preview', requirement.id, input)).body as Preview;
    expect(preview.entries[0]).toMatchObject({ currentEnd: '2026-09-04', proposedStart: '2026-09-01', proposedEnd: '2026-09-04', willChange: true });
    const invalidInput = { ...input, baseStart: '2026-09-07' };
    const invalidPreview = (await plan(protocol, 'preview', requirement.id, invalidInput)).body as Preview;
    const storedBefore = await businessState();
    const invalid = await plan(protocol, 'apply', requirement.id, { ...invalidInput, expectedVersion: before.version, previewToken: invalidPreview.previewToken });
    expect(invalid.statusCode).toBe(400);
    expect(await detail(requirement.id)).toEqual(before);
    expect(await businessState()).toEqual(storedBefore);
    const valid = await plan(protocol, 'apply', requirement.id, { ...input, expectedVersion: before.version, previewToken: preview.previewToken });
    expect(valid.statusCode).toBe(200);
    expect((await detail(requirement.id)).workItems[0]).toMatchObject({ plannedStart: '2026-09-01', plannedEnd: '2026-09-04' });
  });

  it(`${protocol}应用计划拒绝未知日期字段且不部分写入`, async () => {
    const { requirement, input } = await fixture();
    const preview = (await plan(protocol, 'preview', requirement.id, input)).body as Preview;
    const before = await detail(requirement.id);
    const storedBefore = await businessState();
    const applied = await plan(protocol, 'apply', requirement.id, {
      ...input, expectedVersion: preview.requirementVersion, previewToken: preview.previewToken,
      base_start: '2026-09-02',
    });
    expect(applied.statusCode).toBe(400);
    expect(await detail(requirement.id)).toEqual(before);
    expect(await businessState()).toEqual(storedBefore);
  });
}

it('旧预览不能搭配新日期或最新需求版本，旧客户端不传预览标识仍兼容', async () => {
  const { requirement, input } = await fixture();
  const preview = (await plan('REST', 'preview', requirement.id, input)).body as Preview;
  const moved = await plan('REST', 'apply', requirement.id, { ...input, baseStart: '2026-09-03', expectedVersion: requirement.version, previewToken: preview.previewToken });
  expect(moved.statusCode).toBe(409);
  expect(await detail(requirement.id)).toEqual(requirement);
  const edited = await app.inject({ method: 'PATCH', url: `/api/requirements/${requirement.id}`, headers: { cookie }, payload: { title: '并发编辑', expectedVersion: requirement.version } });
  expect(edited.statusCode).toBe(200);
  const latest = edited.json<Requirement>();
  const stale = await plan('REST', 'apply', requirement.id, { ...input, expectedVersion: latest.version, previewToken: preview.previewToken });
  expect(stale.statusCode).toBe(409);
  expect(await detail(requirement.id)).toEqual(latest);
  expect((await plan('REST', 'apply', requirement.id, { ...input, expectedVersion: latest.version })).statusCode).toBe(200);
});

it('取消后再次套用模板会新建工作，不恢复旧工作', async () => {
  const { template, requirement, input } = await fixture();
  const created = await post(`/api/requirements/${requirement.id}/work-items`, {
    title: template.items[0].title, expectedVersion: requirement.version,
  });
  expect(created.statusCode, created.body).toBe(200);
  const item = created.json<Requirement['workItems'][number]>();
  const cancelled = await post(`/api/work-items/${item.id}/cancel`, {
    expectedVersion: item.version, reason: '该步骤不再执行',
  });
  expect(cancelled.statusCode, cancelled.body).toBe(200);
  const current = await detail(requirement.id);

  const preview = (await plan('REST', 'preview', requirement.id, input)).body as Preview;
  expect(preview.entries[0]).toMatchObject({
    workItemId: null, currentStart: null, currentEnd: null, willChange: true, reason: 'missing_item',
  });
  const applied = await plan('REST', 'apply', requirement.id, {
    ...input, expectedVersion: current.version, previewToken: preview.previewToken,
    templateItemIds: [template.items[0].id], reason: '尝试补全终态项',
  });
  expect(applied.statusCode).toBe(200);
  const saved=await detail(requirement.id);
  expect(saved.workItems.some(entry=>entry.id===item.id)).toBe(false);
  expect(saved.workItems.find(entry=>entry.title===item.title)).toMatchObject({status:'not_started',progress:0,plannedStart:preview.entries[0].proposedStart});
});

it('补全计划优先匹配同名的有效工作项而非已取消历史项', async () => {
  const { template, requirement, input } = await fixture();
  const historical = await post(`/api/requirements/${requirement.id}/work-items`, {
    title: template.items[0].title, expectedVersion: requirement.version,
  });
  expect(historical.statusCode, historical.body).toBe(200);
  const cancelled = await post(`/api/work-items/${historical.json().id}/cancel`, {
    expectedVersion: historical.json().version, reason: '保留旧步骤',
  });
  expect(cancelled.statusCode, cancelled.body).toBe(200);
  const afterCancel = await detail(requirement.id);
  const replacement = await post(`/api/requirements/${requirement.id}/work-items`, {
    title: template.items[0].title, expectedVersion: afterCancel.version, reason: '新增替代步骤',
  });
  expect(replacement.statusCode, replacement.body).toBe(200);
  const active = replacement.json<Requirement['workItems'][number]>();
  const current = await detail(requirement.id);

  const preview = (await plan('REST', 'preview', requirement.id, input)).body as Preview;
  expect(preview.entries[0]).toMatchObject({ workItemId: active.id, willChange: true, reason: 'missing_plan' });
  const applied = await plan('REST', 'apply', requirement.id, {
    ...input, expectedVersion: current.version, previewToken: preview.previewToken,
    templateItemIds: [template.items[0].id], reason: '补全替代步骤',
  });
  expect(applied.statusCode).toBe(200);
  const saved = await detail(requirement.id);
  expect(saved.workItems.find((entry) => entry.id === active.id)).toMatchObject({
    plannedStart: preview.entries[0].proposedStart, plannedEnd: preview.entries[0].proposedEnd,
  });
  expect(saved.workItems.some(entry=>entry.id===historical.json().id)).toBe(false);
});
