import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, scryptSync } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Requirement, WorkItem, ProgressUpdate } from '../src/client/types';
import type { DependencyChanges, DependencyChangePreview, DependencyChangeReceipt } from '../src/shared/path-contracts';
import type { readPathGraph } from '../src/server/services/path-graph';
import { projectPathGraph } from '../src/shared/path-projection';
import { addBusinessDays, todayIso } from '../src/shared/domain';
import type { PathAnalysis } from '../src/shared/paths';
import { mcpRequest, mcpRpcRequest } from './mcp-request';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-mcp-queries-'));
const password = 'mcp-query-test-password';
Object.assign(process.env, { DB_PATH: path.join(directory, 'test.db'), BACKUP_DIR: path.join(directory, 'backups'),
  WEB_DIST_DIR: path.join(directory, 'web'), SEED_DEMO: '0', NODE_ENV: 'test',
  APP_PASSWORD_HASH: `scrypt$queries$${scryptSync(password, 'queries', 64).toString('hex')}`,
  SESSION_SECRET: 'mcp-query-test-secret-more-than-thirty-two-characters' });
let app: FastifyInstance, origin: string, cookie: string, token: string;
type Graph = Awaited<ReturnType<typeof readPathGraph>>;
type Page<T> = { items: T[]; total: number; page: number; pageSize: number; pages: number; snapshot?: number };
async function callRaw(name: string, args: Record<string, unknown>, bearer = token) {
  const response = await mcpRequest(origin, bearer, name, args);
  expect(response.statusCode, response.body).toBe(200);
  return JSON.parse(response.body).result;
}
async function call<T>(name: string, args: Record<string, unknown> = {}, bearer = token): Promise<T> {
  const result = await callRaw(name, args, bearer);
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  return result.structuredContent.result;
}
async function post<T = Record<string, string>>(url: string, payload: Record<string, unknown>, auth = cookie): Promise<T> {
  const response = await app.inject({ method: 'POST', url, payload, headers: { cookie: auth } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<T>();
}
async function get<T>(url: string, auth = cookie): Promise<T> {
  const response = await app.inject({ url, headers: { cookie: auth } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<T>();
}
beforeAll(async () => {
  app = await (await import('../src/server/app')).buildApp();
  origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password } });
  cookie = String(login.headers['set-cookie']).split(';')[0];
  token = (await post('/api/tokens', { name: 'MCP查询验证' })).token;
});
afterAll(async () => {
  await app?.close();
  const { sqlite } = await import('../src/server/database');
  if (sqlite.open) sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

async function fixture() {
  const projectId = (await post('/api/projects', { name: '查询验证' + randomUUID() })).id;
  const owner = await post('/api/people', { projectId, name: '负责人' + randomUUID() });
  const collaborator = await post('/api/people', { projectId, name: '协作者' + randomUUID() });
  const keys = { a: randomUUID(), b: randomUUID(), w1: randomUUID(), w2: randomUUID(), w3: randomUUID(), m: randomUUID() };
  const start = addBusinessDays(todayIso(), 0), end = addBusinessDays(start, 1);
  const changes: DependencyChanges = { add: [
    { clientId: randomUUID(), sourceRequirementId: keys.a, sourceWorkItemId: keys.w1, targetRequirementId: keys.a, targetWorkItemId: keys.w2 },
    { clientId: randomUUID(), sourceRequirementId: keys.a, sourceWorkItemId: keys.w2, targetRequirementId: keys.b, targetWorkItemId: keys.w3 },
    { clientId: randomUUID(), sourceRequirementId: keys.b, sourceWorkItemId: keys.w3, targetRequirementId: keys.b, targetWorkItemId: null, targetMilestoneId: keys.m },
  ], remove: [], estimates: [], entities: [
    { entity: 'requirement', op: 'create', id: keys.a, data: { title: '接口交付',  ownerId: owner.id } },
    { entity: 'requirement', op: 'create', id: keys.b, data: { title: '页面交付',  ownerId: collaborator.id } },
    { entity: 'work', op: 'create', id: keys.w1, requirementId: keys.a, data: { title: '设计 <外部&输入>', ownerId: owner.id, assigneeIds: [owner.id, collaborator.id], durationDays: 2, plannedStart: start, plannedEnd: end } },
    { entity: 'work', op: 'create', id: keys.w2, requirementId: keys.a, data: { title: '开发', durationDays: 2 } },
    { entity: 'work', op: 'create', id: keys.w3, requirementId: keys.b, data: { title: '联调', ownerId: collaborator.id, durationDays: 1 } },
    { entity: 'milestone', op: 'create', id: keys.m, requirementId: keys.b, data: { title: '确认交付', confirmationMode: 'manual' } },
  ], layouts: [{ scope: 'requirement:' + keys.a, direction: 'right', expectedVersion: 0, positions: { [keys.w1]: { x: 24, y: 60 }, [keys.w2]: { x: 420, y: 60 } } }] };
  const analysis = await call<PathAnalysis>('get_path_analysis', { projectId });
  const input = { projectId, expectedRevision: analysis.revision, changes };
  const preview = await call<DependencyChangePreview>('preview_dependency_changes', input);
  expect((await call<PathAnalysis>('get_path_analysis', { projectId })).requirements).toHaveLength(0);
  const body = { ...input, previewToken: preview.previewToken, batchId: randomUUID() };
  const receipt = await call<DependencyChangeReceipt>('apply_dependency_changes', body);
  expect(await call('apply_dependency_changes', body)).toEqual(receipt);
  expect(await call('get_dependency_change_receipt', { projectId, batchId: body.batchId })).toMatchObject({ status: 'applied', ...receipt });
  const ids = Object.fromEntries(Object.entries(keys).map(([k, id]) => [k, receipt.addedIds[id]])) as typeof keys;
  return { projectId, owner, collaborator, ids, start, end };
}

it('MCP发布可发现的查询工具、严格输入与只读标记，批次描述包含实体、布局及回执', async () => {
  const response = await mcpRpcRequest(origin, token, 'tools/list', {});
  const tools = JSON.parse(response.body).result.tools as Array<{ name: string; description: string; inputSchema: { properties: Record<string, unknown> }; annotations: { readOnlyHint: boolean } }>;
  for (const name of ['get_work_item', 'list_work_items', 'query_requirements', 'list_progress_updates', 'get_path_graph', 'get_project_change_version'])
    expect(tools.find(t => t.name === name)?.annotations.readOnlyHint).toBe(true);
  expect(tools.find(t => t.name === 'apply_dependency_changes')?.annotations.readOnlyHint).toBe(false);
  expect(tools.find(t => t.name === 'preview_dependency_changes')?.description).toContain('layouts');
  expect(tools.find(t => t.name === 'get_path_graph')?.inputSchema.properties).toHaveProperty('rootNodeId');
});

it('独立工作项读取与需求详情一致，筛选负责人/协作者/日期、分页与REST一致', async () => {
  const f = await fixture();
  const detail = await call<Requirement>('get_requirement', { id: f.ids.a });
  const item = await call<WorkItem>('get_work_item', { id: f.ids.w1 });
  expect(item).toMatchObject(detail.workItems.find(w => w.id === f.ids.w1)!);
  expect(await get('/api/work-items/' + f.ids.w1)).toEqual(item);
  const input = { projectId: f.projectId, participantId: f.collaborator.id, active: true, from: f.start, to: f.end, pageSize: 1 };
  const page = await call<Page<WorkItem>>('list_work_items', input);
  expect(page.total).toBe(1); expect(page.items.map(w => w.id)).toEqual([f.ids.w1]);
  expect(await get('/api/work-items?' + new URLSearchParams(Object.entries(input).map(([k, v]) => [k, String(v)])))).toEqual(page);
  const ownerOnly = await call<Page<WorkItem>>('list_work_items', { projectId: f.projectId, ownerId: f.collaborator.id });
  expect(ownerOnly.items.map(w => w.id)).toEqual([f.ids.w3]);
  expect((await call<Page<WorkItem>>('list_work_items', { projectId: f.projectId, unassigned: true })).items.map(w => w.id)).toEqual([f.ids.w2]);
  const first = await call<Page<WorkItem>>('list_work_items', { projectId: f.projectId, pageSize: 2 });
  const second = await call<Page<WorkItem>>('list_work_items', { projectId: f.projectId, pageSize: 2, page: 2 });
  expect(new Set([...first.items, ...second.items].map(w => w.id)).size).toBe(3);
  expect((await call<Page<WorkItem>>('list_work_items', { projectId: f.projectId, page: 99 })).items).toEqual([]);
});

it('需求分页默认精简字段，支持参与人和关键词，兼容原列表数组及工作项', async () => {
  const f = await fixture();
  const input = { projectId: f.projectId, participantId: f.collaborator.id, q: '接口', pageSize: 1 };
  const page = await call<Page<Requirement>>('query_requirements', input);
  expect(page.total).toBe(1); expect(page.items[0].id).toBe(f.ids.a); expect(page.items[0]).not.toHaveProperty('workItems');
  expect(await get('/api/requirements/query?' + new URLSearchParams(Object.entries(input).map(([k, v]) => [k, String(v)])))).toEqual(page);
  expect((await call<Page<Requirement>>('query_requirements', { ...input, includeWorkItems: true })).items[0].workItems).toHaveLength(2);
  expect((await call<Page<Requirement>>('query_requirements', { projectId: f.projectId, ownerId: f.owner.id })).items.map(r => r.id)).toEqual([f.ids.a]);
  const legacy = await call<Requirement[]>('list_requirements', { projectId: f.projectId });
  expect(Array.isArray(legacy)).toBe(true); expect(legacy.flatMap(r => r.workItems)).toHaveLength(3);
});

it('REST、MCP和延期筛选按工作完成日期计算，等待或确认验收不增加延期', async () => {
  const f = await fixture(), { sqlite } = await import('../src/server/database');
  sqlite.prepare("UPDATE work_items SET status='completed',progress=100,planned_start='2026-08-19',planned_end='2026-08-28',actual_start='2026-08-19',actual_end='2026-08-28' WHERE requirement_id IN (?,?)").run(f.ids.a, f.ids.b);
  sqlite.prepare("UPDATE work_items SET actual_end='2026-09-01' WHERE id=?").run(f.ids.w3);
  for (const acceptedAt of [null, '2026-09-04T10:46:36.014Z']) {
    sqlite.prepare('UPDATE requirements SET status=?,progress=100,accepted_at=? WHERE id IN (?,?)').run('completed', acceptedAt, f.ids.a, f.ids.b);
    const rest = await get<Requirement>('/api/requirements/' + f.ids.a);
    expect(rest).toMatchObject({ status: 'completed', progress: 100,
      acceptedAt, effectiveEnd: '2026-08-28', finishVariance: 0, delayed: false });
    expect(await call<Requirement>('get_requirement', { id: f.ids.a })).toEqual(rest);
    const input = { projectId: f.projectId, view: 'delayed' };
    const page = await call<Page<Requirement>>('query_requirements', input);
    expect(page.items.map(r => r.id)).toEqual([f.ids.b]);
    expect(page.items[0]).toMatchObject({ effectiveEnd: '2026-09-01', finishVariance: 2, delayed: true });
    expect(await get('/api/requirements/query?' + new URLSearchParams(input))).toEqual(page);
    expect((await call<Requirement[]>('list_requirements', input)).map(r => r.id)).toEqual([f.ids.b]);
    const dashboard = await get<import('../src/client/types').Dashboard>('/api/dashboard?projectId=' + f.projectId);
    expect(dashboard.summary.delayed).toBe(1);
    expect(dashboard.overview?.counts.attention).toBe(0);
    expect(dashboard.overview?.counts.delayed).toBe(0);
    const mcpDashboard = await call<import('../src/client/types').Dashboard>('dashboard_summary', { projectId: f.projectId });
    expect(mcpDashboard.overview).toEqual(dashboard.overview);
    expect(mcpDashboard.featureOverview).toEqual(dashboard.featureOverview);
    expect(mcpDashboard.featureOverview?.asOfDate).toBe(dashboard.asOfDate);
    expect(dashboard.requirements.find(r => r.id === f.ids.a)).toMatchObject({ finishVariance: 0, delayed: false });
  }
});

it('MCP、REST和主页面对不完整排期返回未知计划进度，不把部分结束日期报为延期', async () => {
  const f = await fixture(), { sqlite } = await import('../src/server/database');
  const start = addBusinessDays(todayIso(), -5), end = addBusinessDays(todayIso(), -3);
  sqlite.prepare("UPDATE work_items SET status='completed',progress=100,planned_start=?,planned_end=?,actual_start=?,actual_end=? WHERE id=?").run(start, end, start, end, f.ids.w1);
  sqlite.prepare("UPDATE requirements SET status='in_progress',planned_start=?,planned_end=? WHERE id=?").run(start, end, f.ids.a);
  const expected = { scheduleComplete: false, plannedProgress: null, scheduleVarianceDays: null, finishVariance: 0, delayed: false };
  const rest = await get<Requirement>('/api/requirements/' + f.ids.a);
  expect(rest.progress).toBeGreaterThan(0);
  expect(rest).toMatchObject(expected);
  expect(await call('get_requirement', { id: f.ids.a })).toEqual(rest);
  expect((await call<Page<Requirement>>('query_requirements', { projectId: f.projectId })).items.find(r => r.id === f.ids.a)).toMatchObject(expected);
  const analysis = await call<PathAnalysis>('get_path_analysis', { projectId: f.projectId, target: 'acceptance:' + f.ids.a });
  expect(analysis).toMatchObject({ targetDate: null, deadlineSlack: null });
  expect(analysis.requirements.find(r => r.id === f.ids.a)).toMatchObject(expected);
  const dashboard = await get<{ requirements: Requirement[] }>('/api/dashboard?projectId=' + f.projectId);
  expect(dashboard.requirements.find(r => r.id === f.ids.a)).toMatchObject(expected);
  expect((await call<Page<Requirement>>('query_requirements', { projectId: f.projectId, view: 'delayed' })).items).toHaveLength(0);
});

it('进展按北京时间自然日筛选，同时间倒序和snapshot分页不受新记录影响', async () => {
  const f = await fixture(), { sqlite } = await import('../src/server/database');
  const insert = sqlite.prepare(`INSERT INTO progress_updates(id,requirement_id,work_item_id,percent,content,event_type,created_by_account_id,created_at,updated_at) VALUES (?,?,?,0,?,'note',?,?,?)`);
  const author = (await get<{ accountId: string }>('/api/session')).accountId;
  const entries = ['2026-09-09T15:59:59.999Z', '2026-09-09T16:00:00.000Z', '2026-09-10T15:59:59.999Z', '2026-09-10T16:00:00.000Z'];
  const ids = entries.map((at, index) => { const id = randomUUID(); insert.run(id, f.ids.a, f.ids.w1, '进展' + index, author, at, at); return id; });
  const input = { projectId: f.projectId, workItemId: f.ids.w1, authorAccountId: author, q: '进展', eventType: 'note', from: '2026-09-10', to: '2026-09-10', pageSize: 1 };
  const first = await call<Page<ProgressUpdate>>('list_progress_updates', input);
  expect(first.total).toBe(2); expect(first.items[0].id).toBe(ids[2]);
  expect(await get('/api/progress-updates?' + new URLSearchParams(Object.entries(input).map(([k, v]) => [k, String(v)])))).toEqual(first);
  const added = randomUUID(); insert.run(added, f.ids.a, f.ids.w1, '进展新写入', author, entries[2], entries[2]);
  const second = await call<Page<ProgressUpdate>>('list_progress_updates', { ...input, page: 2, snapshot: first.snapshot });
  expect(second.total).toBe(2); expect(second.items[0].id).toBe(ids[1]);
  expect((await call<Page<ProgressUpdate>>('list_progress_updates', input)).items[0].id).toBe(added);
});

it('图形批次经MCP创建节点/里程碑/连线/布局，读回与网页投影一致且上下游不包含兄弟分支', async () => {
  const f = await fixture();
  const input = { projectId: f.projectId, view: 'requirement', requirementId: f.ids.a };
  const graph = await call<Graph>('get_path_graph', input);
  const analysis = await call<PathAnalysis>('get_path_analysis', { projectId: f.projectId, target: 'acceptance:' + f.ids.a });
  const projected = projectPathGraph(analysis, f.ids.a);
  expect(graph.cards).toEqual(projected.cards); expect(graph.links).toEqual(projected.links);
  expect(graph.savedLayout).toMatchObject({ scope: 'requirement:' + f.ids.a, version: 1, positions: { [f.ids.w1]: { x: 24, y: 60 }, [f.ids.w2]: { x: 420, y: 60 } } });
  expect(await get('/api/projects/' + f.projectId + '/path-graph?view=requirement&requirementId=' + f.ids.a)).toEqual(graph);
  const local = await call<Graph>('get_path_graph', { ...input, rootNodeId: f.ids.w2, traversal: 'upstream', depth: 1 });
  expect(local.cards.some(c => c.id === f.ids.w1)).toBe(true); expect(local.cards.some(c => c.id === f.ids.w3)).toBe(false);
  expect(local.links.every(e => local.cards.some(c => c.id === e.source) && local.cards.some(c => c.id === e.target))).toBe(true);
  expect(local.omittedNodes).toBeGreaterThan(0);
  const single = await call<Graph>('get_path_graph', { ...input, rootNodeId: f.ids.w2, depth: 0 });
  expect(single.cards.map(c => c.id)).toEqual([f.ids.w2]); expect(single.links).toEqual([]);
  expect(single.savedLayout.omittedPositions).toBe(1);
  expect(single.cards[0].hiddenCount).toBeGreaterThan(0);
  const summary = await call<Graph>('get_path_graph', { projectId: f.projectId });
  expect(summary.cards.map(c => c.id).sort()).toEqual([f.ids.a, f.ids.b].sort());
  expect(summary.links).toHaveLength(1);
  const milestoneGraph = await call<Graph>('get_path_graph', { projectId: f.projectId, view: 'requirement', requirementId: f.ids.b });
  expect(milestoneGraph.cards.some(c => c.id === f.ids.m && c.kind === 'milestone')).toBe(true);
  expect((await callRaw('get_path_graph', { ...input, maxNodes: 1 })).structuredContent.statusCode).toBe(400);
});

it('自动布局和SVG只读、正确转义标题；布局变更版本可通过MCP轻量检查', async () => {
  const f = await fixture(), input = { projectId: f.projectId, view: 'requirement', requirementId: f.ids.a };
  const before = await call<PathAnalysis>('get_path_analysis', { projectId: f.projectId });
  const version = await call('get_project_change_version', { projectId: f.projectId });
  expect(await get('/api/projects/' + f.projectId + '/change-version')).toEqual(version);
  const graph = await call<Graph>('get_path_graph', { ...input, format: 'svg', direction: 'down' });
  expect(graph.svg).toContain('&lt;外部&amp;输入&gt;'); expect(graph.svg).not.toContain('<外部&输入>');
  expect(graph.layout?.nodeWidth).toBe(280);
  expect(graph.links.every(e => (graph.layout?.edges[e.id].points.length || 0) >= 2)).toBe(true);
  expect(await call('get_project_change_version', { projectId: f.projectId })).toEqual(version);
  expect(await call('get_path_analysis', { projectId: f.projectId })).toEqual(before);
  const changes = { layouts: [{ scope: 'global', direction: 'right', expectedVersion: 0, positions: { [f.ids.a]: { x: 10, y: 10 } } }] };
  const batch = { projectId: f.projectId, expectedRevision: before.revision, changes };
  const preview = await call<DependencyChangePreview>('preview_dependency_changes', batch);
  await call('apply_dependency_changes', { ...batch, previewToken: preview.previewToken, batchId: randomUUID() });
  expect(await call('get_project_change_version', { projectId: f.projectId })).not.toEqual(version);
  expect((await call<PathAnalysis>('get_path_analysis', { projectId: f.projectId })).revision).toBe(before.revision);
});

it('所有新查询隔离项目权限，外部对象ID不泄露详情，成员可读取本项目', async () => {
  const own = await fixture(), foreign = await fixture();
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: own.owner.name, password: '888888' } });
  let memberCookie = String(login.headers['set-cookie']).split(';')[0];
  const changed = await app.inject({ method: 'POST', url: '/api/account/change-password', headers: { cookie: memberCookie }, payload: { currentPassword: '888888', newPassword: password } });
  memberCookie = String(changed.headers['set-cookie']).split(';')[0];
  const memberToken = (await post('/api/tokens', { name: '成员读取' }, memberCookie)).token;
  for (const tool of ['query_requirements', 'list_work_items', 'list_progress_updates', 'get_path_graph', 'get_project_change_version']) {
    expect((await callRaw(tool, { projectId: foreign.projectId }, memberToken)).structuredContent.statusCode).toBe(403);
    await call(tool, { projectId: own.projectId }, memberToken);
  }
  expect((await callRaw('get_work_item', { id: foreign.ids.w1 }, memberToken)).structuredContent.statusCode).toBe(404);
  expect((await callRaw('get_path_graph', { projectId: own.projectId, view: 'requirement', requirementId: foreign.ids.a }, memberToken)).structuredContent.statusCode).toBe(404);
  expect((await call<Page<WorkItem>>('list_work_items', { projectId: own.projectId, requirementId: foreign.ids.a }, memberToken)).total).toBe(0);
  expect((await callRaw('query_requirements', { projectId: own.projectId, includeDeleted: true }, memberToken)).structuredContent.statusCode).toBe(403);
  expect((await app.inject({ url: '/api/work-items/' + foreign.ids.w1, headers: { cookie: memberCookie } })).statusCode).toBe(404);
});

it('MCP图形批次遇到旧布局版本整批拒绝，未创建实体也没有成功回执', async () => {
  const f = await fixture(), before = await call<PathAnalysis>('get_path_analysis', { projectId: f.projectId });
  const input = { projectId: f.projectId, expectedRevision: before.revision, changes: {
    entities: [{ entity: 'milestone', op: 'create', id: randomUUID(), data: { title: '不应保存' } }],
    layouts: [{ scope: 'requirement:' + f.ids.a, direction: 'right', expectedVersion: 1, positions: { [f.ids.w1]: { x: 100, y: 100 } } }],
  } };
  const preview = await call<DependencyChangePreview>('preview_dependency_changes', input);
  const concurrent = { projectId: f.projectId, expectedRevision: before.revision, changes: {
    layouts: [{ ...input.changes.layouts[0], positions: { [f.ids.w1]: { x: 200, y: 200 } } }],
  } };
  const concurrentPreview = await call<DependencyChangePreview>('preview_dependency_changes', concurrent);
  await call('apply_dependency_changes', { ...concurrent, previewToken: concurrentPreview.previewToken, batchId: randomUUID() });
  const latest = await call<PathAnalysis>('get_path_analysis', { projectId: f.projectId });
  const batchId = randomUUID();
  expect((await callRaw('apply_dependency_changes', { ...input, previewToken: preview.previewToken, batchId })).structuredContent.statusCode).toBe(409);
  expect(await call('get_path_analysis', { projectId: f.projectId })).toEqual(latest);
  expect(await call('get_dependency_change_receipt', { projectId: f.projectId, batchId })).toEqual({ status: 'not_found' });
});

it('MCP 不暴露已移除工具和字段，原始需求可直接完成',async()=>{
 const response=await mcpRpcRequest(origin,token,'tools/list',{}),catalog=JSON.parse(response.body).result.tools as Array<{name:string;inputSchema:{properties:Record<string,unknown>}}>;
 const names=catalog.map(t=>t.name);
 for(const name of ['get_requirement_start_conditions','accept_requirement','block_work_item','unblock_work_item','review_dependencies','list_delivery_commitments','get_delivery_commitment','get_delivery_commitment_summary','update_progress','delete_progress','update_issue_update','delete_issue_update','upsert_source_document','upsert_source_clauses','link_requirement_source'])expect(names).not.toContain(name);
 for(const name of ['create_requirement','update_requirement'])for(const field of ['deliveryScope','executionMode','priority','acceptanceOwnerId','unblockEstimate'])expect(catalog.find(t=>t.name===name)!.inputSchema.properties).not.toHaveProperty(field);
 const f=await fixture(),r=await call<Requirement>('create_requirement',{projectId:f.projectId,title:'原始需求',background:'原文：支持直接执行',ownerId:f.owner.id});
 expect(r).toMatchObject({status:'not_started',workItems:[],background:'原文：支持直接执行'});
 const started=await call<Requirement>('start_requirement',{id:r.id,expectedVersion:r.version});
 const completed=await call<Requirement>('complete_requirement',{id:r.id,expectedVersion:started.version,content:'完成验证'});
 expect(completed).toMatchObject({status:'completed',progress:100,acceptedAt:null,actualEnd:todayIso()});
});

it('REST/MCP一致拒绝非法日期、冲突条件、未声明字段和错误图视图', async () => {
  const f = await fixture();
  for (const [tool, url, fields] of [
    ['query_requirements', '/api/requirements/query', { from: '2026-09-30', to: '2026-09-01' }],
    ['list_work_items', '/api/work-items', { ownerId: f.owner.id, unassigned: true }],
    ['list_work_items', '/api/work-items', { status: 'completed', active: true }],
    ['list_progress_updates', '/api/progress-updates', { from: '2026-02-30' }],
    ['list_progress_updates', '/api/progress-updates', { extra: true }],
    ['get_path_graph', '/api/projects/' + f.projectId + '/path-graph', { view: 'requirement' }],
  ] as const) {
    const input = { projectId: f.projectId, ...fields };
    expect((await callRaw(tool, input)).structuredContent.statusCode).toBe(400);
    expect((await app.inject({ url: url + '?' + new URLSearchParams(Object.entries(input).map(([k, v]) => [k, String(v)])), headers: { cookie } })).statusCode).toBe(400);
  }
});
