import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { config } from '../src/server/config';
import { openDatabase } from '../src/server/database';
import { buildApp } from '../src/server/app';
import { createSessionToken, hashPassword } from '../src/server/auth';
import { runWithDatabase, type DatabaseContext } from '../src/server/database-context';
import type { JiraPr, PrCandidate, PrGeneration, PrPreview, PrStep, PrTargetPlan } from '../src/shared/jira-pr';
import { prMarker } from '../src/server/services/jira-pr-execution';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-jira-pr-'));
let context: DatabaseContext, app: FastifyInstance, cookie: string, second: string, projectId: string, requirementId: string;
let status = 'testing', updated = 1, hidden = false, required = false, ambiguous = false, failTransition = false, timeoutComment = false, hideComments = false;
let failComment = false, timeoutTransition = false, comments: Array<{ id: string; body: string; created: string }> = [], writes: string[] = [];
let afterComment: (() => Promise<void> | void) | undefined;
let workflowAvailable = false, futureUnavailable = false, populatedRequired = false;
const names: Record<string, string> = { testing: '测试', acceptance: '验收', done: '完成' };
const root = () => `/api/projects/${projectId}/jira`;
const request = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', route: string, body?: unknown, login = cookie) => app.inject({ method, url: route.startsWith('/') ? route : root() + '/' + route, headers: { cookie: login, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
const parse = async <T = JiraPr>(promise: ReturnType<typeof request>): Promise<T> => { const r = await promise; expect(r.statusCode, r.body).toBe(200); return r.json(); };
const connect = (login = cookie, token = 'test-token') => parse(request('PUT', '/api/me/jira-connection', { token }, login));
const json = (data: unknown, code = 200) => new Response(JSON.stringify(data), { status: code });
const edit = (pr: JiraPr) => ({ version: pr.version, items: pr.items.map(i => ({ requirementId: i.requirementId, decisionRequired: i.decisionRequired, steps: i.steps.map(({ id, kind, body, sourceIds, target, transitionId, transitionName }) => ({ id, kind, body, sourceIds, target, transitionId, transitionName })) })) });
const load = (id: string) => parse(request('GET', 'prs/' + id));
const prepare = (p: JiraPr, login = cookie) => parse<PrPreview>(request('POST', `prs/${p.id}/prepare`, { version: p.version }, login));
const push = (p: JiraPr, preview: PrPreview, login = cookie) => parse(request('POST', `prs/${p.id}/execute`, { previewId: preview.id }, login));
const ledger = () => context.sqlite.prepare('SELECT state,comment_id AS commentId FROM jira_progress_sync ORDER BY progress_id').all() as Array<{ state: string; commentId: string | null }>;
function addSource(id: string, createdAt = '2026-01-01T01:00:00.000Z', requirement = requirementId) {
  context.sqlite.prepare('INSERT INTO progress_updates(id,requirement_id,percent,content,event_type,created_at,updated_at) VALUES (?,?,50,?,?,?,?)').run(id, requirement, '完成接口实现，开始联调。', 'progress', createdAt, createdAt);
}
async function generate(current?: JiraPr) {
  const g = await parse<PrGeneration>(request('POST', 'prs/generate-preview', { scope: { featureIds: [null], excludedRequirementIds: [] }, prId: current?.id, version: current?.version }));
  return parse(request('POST', 'prs/generations/' + g.id + '/apply'));
}
async function commentOnly(pr: JiraPr) {
  pr.items[0].decisionRequired = false;
  Object.assign(pr.items[0].steps[0], { kind: 'comment', target: null, transitionId: null, transitionName: null });
  return parse(request('PUT', 'prs/' + pr.id, edit(pr)));
}
async function multi(pr: JiraPr) {
  workflowAvailable = true;
  pr.items[0].decisionRequired = false;
  const first = pr.items[0].steps[0]; Object.assign(first, { target: { id: 'acceptance', name: '验收' }, transitionId: 'pass', transitionName: '测试通过' });
  const step: PrStep = { ...structuredClone(first), id: 'second-step', body: '验收完成，申请完成。', sourceIds: [], target: { id: 'done', name: '完成' }, transitionId: null, transitionName: null };
  pr.items[0].steps.push(step); return parse(request('PUT', 'prs/' + pr.id, edit(pr)));
}
beforeAll(async () => {
  context = await openDatabase({ ...config, dbPath: path.join(directory, 'test.db'), backupDir: path.join(directory, 'backups'), seedDemo: false, nodeEnv: 'test', appPasswordHash: hashPassword('test-password'), sessionSecret: 'a-session-secret-with-over-32-characters', jiraEnabled: true, jiraBaseUrl: 'https://jira.example.test', jiraEncryptionKey: 'a'.repeat(64), jiraApiVersion: '2' });
  app = await buildApp(undefined, context); await app.ready();
  const admin = context.sqlite.prepare('SELECT id FROM accounts WHERE is_builtin=1').get() as { id: string };
  cookie = context.config.sessionCookieName + '=' + runWithDatabase(context, () => createSessionToken(admin.id, 0));
  context.sqlite.prepare("INSERT INTO accounts(id,username,normalized_username,password_hash,global_role,status,must_change_password,session_version,is_builtin,created_at,updated_at) VALUES ('pr-second','second','second',?,'admin','active',0,0,0,?,?)").run(hashPassword('test-password'), new Date().toISOString(), new Date().toISOString());
  second = context.config.sessionCookieName + '=' + runWithDatabase(context, () => createSessionToken('pr-second', 0));
  projectId = (await parse<{ id: string }>(request('POST', '/api/projects', { name: 'PR test project' }))).id;
  requirementId = (await parse<{ id: string }>(request('POST', '/api/requirements', { projectId, title: '接口开发' }))).id;
});
beforeEach(async () => {
  context.sqlite.exec('DELETE FROM jira_progress_sync; DELETE FROM jira_prs; DELETE FROM jira_operations; DELETE FROM jira_connections; DELETE FROM jira_bindings; DELETE FROM progress_updates; DELETE FROM work_items;');
  context.config.jiraEnabled = true; context.config.jiraBaseUrl = 'https://jira.example.test';
  context.sqlite.prepare("UPDATE requirements SET feature_id=NULL,phase_id=NULL,execution_mode='direct',status='completed',progress=100,actual_start='2026-08-03',actual_end='2026-08-07',deleted_at=NULL WHERE id=?").run(requirementId);
  status = 'testing'; updated = 1; hidden = required = ambiguous = failTransition = timeoutComment = hideComments = failComment = timeoutTransition = false; comments = []; writes = []; afterComment = undefined;
  workflowAvailable = futureUnavailable = populatedRequired = false;
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)), auth = new Headers(init?.headers).get('authorization');
    if (!['Bearer test-token', 'Bearer second-token'].includes(auth || '')) return json({}, 401);
    if (url.pathname.endsWith('/myself')) return json({ displayName: auth === 'Bearer second-token' ? 'Second' : 'Tester', name: 'tester' });
    if (url.pathname.endsWith('/project/TEST/statuses')) return json([{ id: 'story', name: 'Story', statuses: Object.entries(names).map(([id, name]) => ({ id, name })) }]);
    if (hidden) return json({}, 403);
    if (url.pathname.endsWith('/workflowscheme')) return workflowAvailable ? json({ defaultWorkflow: 'Test workflow', issueTypeMappings: {} }) : json({}, 403);
    if (url.pathname.endsWith('/workflows')) return json({ layout: { statuses: Object.entries(names).map(([id, name]) => ({ id: 'node-' + id, name, statusId: id })), transitions: [{ actionId: 'pass', name: '测试通过', sourceId: 'node-testing', targetId: 'node-acceptance' }, { actionId: 'finish', name: '验收通过', sourceId: 'node-acceptance', targetId: 'node-done' }] } });
    if (url.pathname.endsWith('/transitions')) {
      if (init?.method === 'POST') {
        const id = JSON.parse(String(init.body)).transition.id; writes.push('transition:' + id);
        if (failTransition) return json({}, 400);
        status = id === 'pass' || id === '11' ? 'acceptance' : 'done'; updated++;
        if (timeoutTransition) throw new Error('timeout');
        return new Response(null, { status: 204 });
      }
      const transition = { id: status === 'testing' ? 'pass' : 'finish', name: status === 'testing' ? '测试通过' : '验收通过', to: { id: status === 'testing' ? 'acceptance' : 'done', name: status === 'testing' ? '验收' : '完成' }, fields: required ? { evidence: { required: true, name: '验收资料' } } : populatedRequired ? { summary: { required: true, name: '概要' }, issuetype: { required: true, name: '问题类型' } } : {} };
      return json({ transitions: status === 'done' || futureUnavailable && status !== 'testing' ? [] : ambiguous ? [transition, { ...transition, id: 'other' }] : [transition] });
    }
    if (url.pathname.endsWith('/comment')) {
      if (init?.method === 'POST') {
        writes.push('comment'); if (failComment) return json({}, 403);
        const comment = { id: String(comments.length + 1), body: JSON.parse(String(init.body)).body, created: new Date().toISOString() };
        comments.push(comment); updated++; await afterComment?.();
        if (timeoutComment) throw new Error('timeout');
        return json(comment, 201);
      }
      const startAt = Number(url.searchParams.get('startAt') || 0), visible = hideComments ? [] : comments;
      return json({ comments: visible.slice(startAt, startAt + 1), startAt, total: visible.length });
    }
    if (url.pathname.includes('/issue/')) return json({ id: '101', key: 'TEST-1', fields: { summary: '接口开发', issuetype: { id: 'story', name: 'Story' }, status: { id: status, name: names[status] }, updated: String(updated) } });
    return json({}, 404);
  }));
  await connect();
  await parse(request('POST', 'bindings', { requirementId, key: 'TEST-1' }));
  addSource('source-1');
});
afterAll(async () => { vi.unstubAllGlobals(); await app?.close(); context?.close(); fs.rmSync(directory, { recursive: true, force: true }); });

describe('Jira PR drafts and source ledger', () => {
  it('plans one final target as a read-only operation, then publishes its whole route', async () => {
    workflowAvailable = true;
    const pr = await commentOnly(await generate());
    const before = context.sqlite.prepare('SELECT status,progress FROM requirements WHERE id=?').get(requirementId);
    const plan = await parse<PrTargetPlan>(request('POST', `prs/${pr.id}/target-preview`, { version: pr.version, requirementId, targetId: 'done' }));
    expect(plan.steps!.map(s => s.transitionId)).toEqual(['pass', 'finish']);
    expect(plan.steps!.flatMap(s => s.sourceIds)).toEqual(['source-1']); expect(writes).toEqual([]);
    expect((await load(pr.id)).items[0].steps[0].kind).toBe('comment');
    pr.items[0].steps = plan.steps!;
    const saved = await parse(request('PUT', `prs/${pr.id}`, edit(pr)));
    await push(saved, await prepare(saved));
    expect(writes).toEqual(['comment', 'transition:pass', 'comment', 'transition:finish']);
    expect(context.sqlite.prepare('SELECT status,progress FROM requirements WHERE id=?').get(requirementId)).toEqual(before);
  });
  it('preserves edited text and source ownership when shortening a route', async () => {
    workflowAvailable = true;
    let pr = await generate();
    pr.items[0].steps[1].body = '人工补充：不能被改变目标删除';
    pr = await parse(request('PUT', `prs/${pr.id}`, edit(pr)));
    const plan = await parse<PrTargetPlan>(request('POST', `prs/${pr.id}/target-preview`, { version: pr.version, requirementId, targetId: 'acceptance' }));
    expect(plan.retainedComments).toBe(1); expect(plan.steps!.find(s => s.kind === 'comment')?.body).toContain('不能被改变目标删除');
    expect(plan.steps!.filter(s => s.kind === 'transition').map(s => s.target?.id)).toEqual(['acceptance']);
    expect(plan.steps!.flatMap(s => s.sourceIds)).toEqual(['source-1']); expect(writes).toEqual([]);
  });
  it('offers entire alternative routes, not an arbitrary transition to the same target', async () => {
    workflowAvailable = ambiguous = true;
    const pr = await generate();
    const input = { version: pr.version, requirementId, targetId: 'done', regenerate: true };
    const choices = await parse<PrTargetPlan>(request('POST', `prs/${pr.id}/target-preview`, input));
    expect(choices.steps).toBeNull(); expect(choices.routes).toHaveLength(2);
    const chosen = await parse<PrTargetPlan>(request('POST', `prs/${pr.id}/target-preview`, { ...input, routeIds: choices.routes[1].map(e => e.id) }));
    expect(chosen.steps!.map(s => s.transitionId)).toEqual(['other', 'finish']);
    expect((await request('POST', `prs/${pr.id}/target-preview`, { ...input, routeIds: ['invented'] })).statusCode).toBe(409);
    expect(writes).toEqual([]);
  });
  it('keeps a matching manually edited comment and never drops sources assigned to a generated comment', async () => {
    workflowAvailable = true;
    let pr = await generate();
    pr.items[0].steps[0].body = '人工保留的阶段说明';
    const secondStep = pr.items[0].steps[1];
    secondStep.sourceIds = pr.items[0].steps[0].sourceIds;
    pr.items[0].steps[0].sourceIds = [];
    pr = await parse(request('PUT', `prs/${pr.id}`, edit(pr)));
    const plan = await parse<PrTargetPlan>(request('POST', `prs/${pr.id}/target-preview`, { version: pr.version, requirementId, targetId: 'done' }));
    expect(plan.steps!.find(s => s.id === pr.items[0].steps[0].id)?.body).toBe('人工保留的阶段说明');
    expect(plan.steps!.flatMap(s => s.sourceIds)).toEqual(['source-1']); expect(writes).toEqual([]);
  });
  it('rejects unreachable targets, stale drafts, changed bindings and another account without a token', async () => {
    const pr = await generate(), input = { version: pr.version, requirementId, targetId: 'done' };
    expect((await request('POST', `prs/${pr.id}/target-preview`, input)).statusCode).toBe(400);
    workflowAvailable = true;
    expect((await request('POST', `prs/${pr.id}/target-preview`, input, second)).statusCode).not.toBe(200);
    expect((await request('POST', `prs/${pr.id}/target-preview`, { ...input, version: pr.version + 1 })).statusCode).toBe(409);
    context.sqlite.prepare("UPDATE jira_bindings SET issue_key='TEST-2'").run();
    expect((await request('POST', `prs/${pr.id}/target-preview`, input)).statusCode).toBe(409);
    expect(writes).toEqual([]);
  });
  it('does not replace a posted comment when its transition failed', async () => {
    workflowAvailable = failTransition = true;
    const pr = await generate(), partial = await push(pr, await prepare(pr));
    expect(partial.items[0].steps[0].comment.state).toBe('success');
    const result = await request('POST', `prs/${pr.id}/target-preview`, { version: partial.version, requirementId, targetId: null, regenerate: true });
    expect(result.statusCode).toBe(400); expect(result.body).toContain('已有评论发布成功');
  });
  it('generates the real remaining workflow path and publishes one comment per step', async () => {
    workflowAvailable = true;
    const pr = await generate();
    expect(pr.items[0].steps.map(s => s.transitionId)).toEqual(['pass', 'finish']);
    expect(pr.items[0].steps.map(s => s.target?.id)).toEqual(['acceptance', 'done']);
    expect(pr.items[0].steps[0].sourceIds).toEqual(['source-1']); expect(pr.items[0].steps[1].sourceIds).toEqual([]);
    expect(pr.items[0].steps[1].body).not.toContain('完成接口实现');
    expect(writes).toEqual([]);
    const pushed = await push(pr, await prepare(pr));
    expect(pushed.state).toBe('completed'); expect(comments).toHaveLength(2);
    expect(writes).toEqual(['comment', 'transition:pass', 'comment', 'transition:finish']);
  });
  it('publishes complete human comments once across a route and does not collect them in the next PR', async () => {
    workflowAvailable = true;
    const note = '发现 10 个 bug，部分文件需要解密。\n\n- 请保留完整说明\n- 报告：https://example.test/report';
    context.sqlite.prepare('UPDATE progress_updates SET content=? WHERE id=?').run(note, 'source-1');
    addSource('source-2', '2026-01-02T01:00:00.000Z');
    context.sqlite.prepare('UPDATE progress_updates SET content=? WHERE id=?').run(note, 'source-2');
    addSource('source-3', '2026-01-03T01:00:00.000Z');
    context.sqlite.prepare("UPDATE progress_updates SET event_type='correction',content=? WHERE id=?").run('整理需求说明并补充链接，交付状态不变。', 'source-3');
    addSource('source-4', '2026-01-04T01:00:00.000Z');
    context.sqlite.prepare("UPDATE progress_updates SET event_type='complete',content='工作完成' WHERE id=?").run('source-4');
    const pr = await generate(), bodies = pr.items[0].steps.map(s => s.body).join('\n');
    expect(bodies.split(note)).toHaveLength(3);
    expect(bodies).toContain('整理需求说明并补充链接，交付状态不变。');
    expect(bodies).not.toMatch(/历时|工作完成|全部修复/);
    expect(pr.items[0].steps.flatMap(s => s.sourceIds)).toHaveLength(4);
    await push(pr, await prepare(pr));
    expect(comments.map(c => c.body).join('\n').split(note)).toHaveLength(3);
    expect(ledger().every(s => s.state === 'synced')).toBe(true);
    expect((await generate()).items).toEqual([]);
    expect(writes).toEqual(['comment', 'transition:pass', 'comment', 'transition:finish']);
  });
  it('previews compact replacement text without overwriting a manually edited draft', async () => {
    workflowAvailable = true;
    let pr = await generate();
    pr.items[0].steps[0].body = '已经人工编辑的会议结论，不自动覆盖。';
    pr = await parse(request('PUT', 'prs/' + pr.id, edit(pr)));
    const before = ledger();
    const preview = await parse<PrTargetPlan>(request('POST', `prs/${pr.id}/target-preview`, { version: pr.version, requirementId, targetId: 'done', regenerate: true }));
    expect(preview.steps![0].body).toContain('进展摘要');
    expect(preview.steps![0].body).toContain('完成接口实现，开始联调。');
    expect(preview.steps![0].body).not.toContain('历时');
    expect((await load(pr.id)).items[0].steps[0].body).toBe('已经人工编辑的会议结论，不自动覆盖。');
    expect(ledger()).toEqual(before); expect(writes).toEqual([]);
  });
  it('uses current values for required transition fields without inventing missing evidence', async () => {
    workflowAvailable = populatedRequired = true;
    const pr = await generate(); await prepare(pr); expect(writes).toEqual([]);
    required = true;
    const result = await request('POST', 'prs/' + pr.id + '/prepare', { version: pr.version });
    expect(result.statusCode).toBe(400); expect(result.body).toContain('验收资料'); expect(writes).toEqual([]);
  });
  it('rejects an invalid future route before sending its first comment', async () => {
    const pr = await multi(await generate());
    pr.items[0].steps[1].target = { id: 'testing', name: '测试' };
    const saved = await parse(request('PUT', 'prs/' + pr.id, edit(pr)));
    expect((await request('POST', 'prs/' + pr.id + '/prepare', { version: saved.version })).statusCode).toBe(400);
    expect(writes).toEqual([]);
  });
  it('adds a bound requirement without pending progress from the draft workspace', async () => {
    const pr = await generate();
    const empty = await parse(request('PUT', 'prs/' + pr.id, { version: pr.version, items: [] }));
    context.sqlite.prepare('DELETE FROM progress_updates').run(); status = 'done';
    const added = await parse(request('POST', 'prs/' + pr.id + '/items', { version: empty.version, requirementId }));
    expect(added.items[0].sources).toEqual([]); expect(added.items[0].steps[0].kind).toBe('comment');
    expect((await request('POST', 'prs/' + pr.id + '/items', { version: added.version, requirementId })).statusCode).toBe(400);
    expect(writes).toEqual([]);
  });
  it('opens an empty draft when everything is up to date, then allows an explicit comment', async () => {
    context.sqlite.prepare('DELETE FROM progress_updates').run(); status = 'done';
    const pr = await generate(); expect(pr.items).toEqual([]);
    const added = await parse(request('POST', 'prs/' + pr.id + '/items', { version: pr.version, requirementId }));
    expect(added.items[0].steps[0].kind).toBe('comment'); expect(added.items[0].sources).toEqual([]); expect(writes).toEqual([]);
  });
  it('includes all history with a compact snapshot summary and full comments without writing Jira', async () => {
    const pr = await generate();
    expect(pr.items[0].sources.map(s => s.id)).toEqual(['source-1']);
    expect(pr.items[0].steps[0].body).toContain('2026-01-01'); expect(pr.items[0].steps[0].body).toContain('2026-08-07 需求已完成');
    expect(pr.items[0].steps[0].body).not.toContain('历时');
    expect(pr.items[0].steps[0].body).toContain('完成接口实现'); expect(pr.items[0].steps[0].target?.id).toBe('done');
    expect(pr.items[0].steps[0].transitionId).toBeNull(); expect(ledger()[0].state).toBe('in_pr'); expect(writes).toEqual([]);
    const details = await parse<{ progressUpdates: Array<{ jiraSyncState: string; jiraPrId: string }> }>(request('GET', '/api/requirements/' + requirementId));
    expect(details.progressUpdates[0]).toMatchObject({ jiraSyncState: 'in_pr', jiraPrId: pr.id });
  });
  it('keeps one shared active PR and validates concurrent editing', async () => {
    const pr = await generate(); await connect(second, 'second-token');
    expect((await parse(request('GET', 'prs/' + pr.id, undefined, second))).id).toBe(pr.id);
    const g = await parse<PrGeneration>(request('POST', 'prs/generate-preview', { scope: { featureIds: [null] } }));
    expect((await request('POST', 'prs/generations/' + g.id + '/apply')).statusCode).toBe(409);
    await commentOnly(pr); expect((await request('PUT', 'prs/' + pr.id, edit(pr), second)).statusCode).toBe(409);
    expect(writes).toEqual([]);
  });
  it('returns removed and abandoned sources to pending but never releases published sources', async () => {
    let pr = await generate(); const input = edit(pr); input.items = [];
    pr = await parse(request('PUT', 'prs/' + pr.id, input)); expect(ledger()[0].state).toBe('pending');
    pr = await generate(pr); expect(pr.items[0].sources).toHaveLength(1);
    await parse(request('POST', 'prs/' + pr.id + '/close', { version: pr.version })); expect(ledger()[0].state).toBe('pending');
    pr = await commentOnly(await generate()); pr = await push(pr, await prepare(pr)); expect(pr.state).toBe('completed'); expect(ledger()[0].state).toBe('synced');
    expect((await parse<PrCandidate[]>(request('GET', 'prs/candidates')))[0].sources[0].jiraSyncState).toBe('synced');
  });
  it('ignores and restores old progress without affecting execution data', async () => {
    await parse(request('PUT', 'prs/progress-state', { ids: ['source-1'], ignored: true })); expect(ledger()[0].state).toBe('ignored');
    await parse(request('PUT', 'prs/progress-state', { ids: ['source-1'], ignored: false })); expect(ledger()[0].state).toBe('pending');
    expect(writes).toEqual([]);
  });
  it('includes archived requirements and leaves unbound records pending', async () => {
    context.sqlite.prepare('UPDATE requirements SET deleted_at=? WHERE id=?').run(new Date().toISOString(), requirementId);
    const pr = await generate(); expect(pr.items[0].sources).toHaveLength(1);
    await parse(request('POST', 'prs/' + pr.id + '/close', { version: pr.version }));
    context.sqlite.exec('DELETE FROM jira_bindings');
    const g = await parse<PrGeneration>(request('POST', 'prs/generate-preview', { scope: { featureIds: [null] } }));
    expect(g.items).toHaveLength(0); expect(g.warnings[0]).toContain('未关联'); expect(ledger()[0].state).toBe('pending');
  });
  it('adds only new sources and preserves edited comments', async () => {
    let pr = await commentOnly(await generate()); pr.items[0].steps[0].body = '人工修改的正文';
    pr = await parse(request('PUT', 'prs/' + pr.id, edit(pr))); addSource('source-2', '2026-09-01T01:00:00.000Z');
    const g = await parse<PrGeneration>(request('POST', 'prs/generate-preview', { scope: pr.scope, prId: pr.id, version: pr.version }));
    expect(g.items[0].sources.map(s => s.id)).toEqual(['source-2']); expect(ledger().find(s => s.state === 'in_pr')).toBeTruthy();
    pr = await parse(request('POST', 'prs/generations/' + g.id + '/apply'));
    expect(pr.items[0].steps[0].body).toBe('人工修改的正文'); expect(pr.items[0].steps).toHaveLength(2);
  });
  it('does not change sources when only regenerating a comment preview', async () => {
    const pr = await generate(), before = ledger();
    await parse(request('POST', 'prs/' + pr.id + '/comment-preview', { requirementId, sourceIds: ['source-1'], target: null }));
    expect(ledger()).toEqual(before); expect((await load(pr.id)).version).toBe(pr.version); expect(writes).toEqual([]);
  });
  it('regenerates with the collected work overview rather than newer execution data', async () => {
    const pr = await generate();
    context.sqlite.prepare("UPDATE requirements SET status='in_progress',progress=20,actual_end=NULL WHERE id=?").run(requirementId);
    addSource('later-source', new Date(Date.now() + 1000).toISOString());
    const result = await parse<{ body: string }>(request('POST', 'prs/' + pr.id + '/comment-preview', { requirementId, sourceIds: ['source-1'], target: null }));
    expect(result.body).toContain('2026-08-07 需求已完成'); expect(result.body).not.toContain('历时'); expect(result.body).not.toContain('20%');
    expect((await parse<PrCandidate[]>(request('GET', 'prs/candidates'))).find(r => r.requirementId === requirementId)!.sources.find(s => s.id === 'later-source')!.jiraSyncState).toBe('pending');
    expect(writes).toEqual([]);
  });
  it('loads local source states without a token but cannot borrow another manager credentials', async () => {
    await parse(request('DELETE', '/api/me/jira-connection')); vi.mocked(fetch).mockClear();
    const rows = await parse<PrCandidate[]>(request('GET', 'prs/candidates')); expect(rows[0].sources[0].jiraSyncState).toBe('pending'); expect(fetch).not.toHaveBeenCalled();
    await connect(second, 'second-token');
    expect((await request('POST', 'prs/generate-preview', { scope: { featureIds: [null] } })).statusCode).toBe(409); expect(writes).toEqual([]);
  });
  it('honors feature selection and individual exclusions without consuming omitted history', async () => {
    const other = await parse<{ id: string }>(request('POST', '/api/requirements', { projectId, title: '另一个 Feature 的需求' }));
    addSource('other-source', '2026-01-01T01:00:00.000Z', other.id);
    const g = await parse<PrGeneration>(request('POST', 'prs/generate-preview', { scope: { featureIds: [null], excludedRequirementIds: [requirementId] } })); expect(g.items).toHaveLength(0); expect(ledger()).toHaveLength(0);
    const pr = await generate(); expect(pr.items.map(i => i.requirementId)).toEqual([requirementId]);
    const otherRow = (await parse<PrCandidate[]>(request('GET', 'prs/candidates'))).find(r => r.requirementId === other.id)!; expect(otherRow.sources[0].jiraSyncState).toBe('pending');
  });
  it('supports an explicit comment draft with no new sources and no state difference', async () => {
    context.sqlite.prepare("DELETE FROM progress_updates WHERE id='source-1'").run(); status = 'done';
    const g = await parse<PrGeneration>(request('POST', 'prs/generate-preview', { scope: { featureIds: [null], manualRequirementIds: [requirementId] } }));
    expect(g.items[0].steps[0].kind).toBe('comment'); expect(g.items[0].sources).toHaveLength(0);
    const pr = await parse(request('POST', 'prs/generations/' + g.id + '/apply')); expect(pr.items).toHaveLength(1); expect(writes).toEqual([]);
  });
  it('does not grant remote access to a project reader with a personal token', async () => {
    const person = await parse<{ id: string }>(request('POST', '/api/people', { name: 'PR reader' }));
    context.sqlite.prepare("INSERT INTO project_people(project_id,person_id,project_role,created_at) VALUES (?,?,'viewer',?)").run(projectId, person.id, new Date().toISOString());
    const account = context.sqlite.prepare('SELECT id,session_version AS version FROM accounts WHERE person_id=?').get(person.id) as { id: string; version: number };
    context.sqlite.prepare('UPDATE accounts SET must_change_password=0 WHERE id=?').run(account.id);
    const login = context.config.sessionCookieName + '=' + runWithDatabase(context, () => createSessionToken(account.id, account.version));
    await connect(login); vi.mocked(fetch).mockClear();
    expect((await request('GET', 'prs/candidates', undefined, login)).statusCode).toBe(403);
    expect((await request('POST', 'prs/generate-preview', { scope: { featureIds: [null] } }, login)).statusCode).toBe(403); expect(fetch).not.toHaveBeenCalled();
  });
});

describe('manual Jira progress confirmation', () => {
  const preview = (ids = ['source-1'], restore = false) => parse<{ version: string; affectedPrIds: string[] }>(request('POST', 'prs/manual-sync-preview', { ids, restore }));
  const confirm = (version: string, restore = false) => request('POST', 'prs/manual-sync', { ids: ['source-1'], version, restore, reason: '已经在 Jira 会议记录中同步', url: 'https://jira.example.test/browse/TEST-1?focusedCommentId=1' });
  it('marks only selected progress, keeps local facts, and distinguishes manual confirmation from a Jira receipt', async () => {
    addSource('source-2'); await parse(request('DELETE', '/api/me/jira-connection'));
    const before = context.sqlite.prepare('SELECT * FROM progress_updates').all();
    const p = await preview(); expect((await confirm(p.version)).statusCode).toBe(200);
    const candidates = await parse<PrCandidate[]>(request('GET', 'prs/candidates'));
    const sources = candidates.find(r => r.requirementId === requirementId)!.sources;
    expect(sources[0]).toMatchObject({ jiraSyncState: 'synced', jiraCommentId: null, jiraPrId: null, jiraManualReason: '已经在 Jira 会议记录中同步' });
    expect(sources[0].jiraManualAccountId).toBeTruthy(); expect(sources[1].jiraSyncState).toBe('pending');
    expect(context.sqlite.prepare('SELECT * FROM progress_updates').all()).toEqual(before); expect(writes).toEqual([]);
    await connect(); const pr = await generate(); expect(pr.items[0].sources.map(s => s.id)).toEqual(['source-2']);
  });
  it('removes claimed source references while preserving edited text and requiring a body review', async () => {
    let pr = await commentOnly(await generate()); pr.items[0].steps[0].body = '已编辑的会议记录'; pr = await parse(request('PUT', 'prs/' + pr.id, edit(pr)));
    const prepared = await prepare(pr), p = await preview(); expect(p.affectedPrIds).toEqual([pr.id]);
    expect((await confirm(p.version)).statusCode).toBe(200);
    expect((await request('POST', 'prs/' + pr.id + '/execute', { previewId: prepared.id })).statusCode).toBe(409);
    pr = await load(pr.id); expect(pr.items[0].reviewRequired).toBe(true); expect(pr.items[0].steps[0].sourceIds).toEqual([]); expect(pr.items[0].steps[0].body).toBe('已编辑的会议记录');
    expect((await request('POST', 'prs/' + pr.id + '/prepare', { version: pr.version })).statusCode).toBe(400);
    const input = edit(pr); const acknowledged = { ...input, items: input.items.map(i => ({ ...i, reviewRequired: false })) };
    pr = await parse(request('PUT', 'prs/' + pr.id, acknowledged)); await prepare(pr); expect(writes).toEqual([]);
  });
  it('rejects stale confirmations and records an explicit undo as pending', async () => {
    const p = await preview(); context.sqlite.prepare("UPDATE progress_updates SET content='纠错内容' WHERE id='source-1'").run();
    expect((await confirm(p.version)).statusCode).toBe(409);
    expect((await confirm((await preview()).version)).statusCode).toBe(200);
    expect((await confirm((await preview(['source-1'], true)).version, true)).statusCode).toBe(200);
    const sources = (await parse<PrCandidate[]>(request('GET', 'prs/candidates'))).find(r => r.requirementId === requirementId)!.sources;
    expect(sources[0]).toMatchObject({ jiraSyncState: 'pending', jiraManualAccountId: null, jiraSyncedAt: null }); expect(writes).toEqual([]);
  });
  it('cannot override uncertain or already-published progress', async () => {
    let pr = await commentOnly(await generate());
    context.sqlite.prepare("UPDATE jira_prs SET payload=json_set(payload,'$.items[0].steps[0].comment.state','unknown') WHERE id=?").run(pr.id);
    expect((await request('POST', 'prs/manual-sync-preview', { ids: ['source-1'] })).statusCode).toBe(409);
    context.sqlite.prepare("UPDATE jira_prs SET payload=json_set(payload,'$.items[0].steps[0].comment.state','pending') WHERE id=?").run(pr.id);
    pr = await push(pr, await prepare(pr)); expect(pr.state).toBe('completed');
    expect((await request('POST', 'prs/manual-sync-preview', { ids: ['source-1'], restore: true })).statusCode).toBe(409);
  });
});
describe('Jira PR explicit publishing', () => {
  it('publishes an ordered sequence with one comment per transition and replay is idempotent', async () => {
    const tables = ['requirements', 'work_items', 'milestones', 'progress_updates']; const snapshot = () => tables.map(t => context.sqlite.prepare('SELECT * FROM ' + t).all());
    const before = snapshot(), pr = await multi(await generate()), preview = await prepare(pr);
    const result = await push(pr, preview); expect(result.state).toBe('completed');
    expect(result.items[0].sources[0].jiraSyncState).toBe('synced'); expect(result.items[0].steps[1].transition.from?.id).toBe('acceptance');
    expect(writes).toEqual(['comment', 'transition:pass', 'comment', 'transition:finish']); expect(comments[0].body).toContain(prMarker(pr.id, pr.items[0].steps[0].id));
    await push(pr, preview); expect(writes).toHaveLength(4); expect(ledger()[0].state).toBe('synced'); expect(snapshot()).toEqual(before);
  });
  it('retains comment success when a transition fails, then resumes without duplicate comments', async () => {
    let pr = await multi(await generate()); failTransition = true;
    pr = await push(pr, await prepare(pr)); expect(pr.items[0].steps[0].comment.state).toBe('success'); expect(pr.items[0].steps[0].transition.state).toBe('failed'); expect(ledger()[0].state).toBe('synced');
    failTransition = false; pr = await push(pr, await prepare(pr)); expect(pr.state).toBe('completed'); expect(comments).toHaveLength(2);
    expect(writes).toEqual(['comment', 'transition:pass', 'transition:pass', 'comment', 'transition:finish']);
  });
  it('does not migrate a status when its comment fails', async () => {
    const pr = await multi(await generate()); failComment = true;
    const result = await push(pr, await prepare(pr)); expect(writes).toEqual(['comment']); expect(result.items[0].steps[0].comment.state).toBe('failed'); expect(ledger()[0].state).toBe('in_pr');
  });
  it('reads back timed-out comments including later pages without resending', async () => {
    let pr = await commentOnly(await generate()); timeoutComment = true;
    comments.push({ id: 'old', body: '旧评论', created: new Date().toISOString() });
    pr = await push(pr, await prepare(pr)); expect(pr.state).toBe('completed'); expect(writes).toEqual(['comment']); expect(ledger()[0].state).toBe('synced');
  });
  it('blocks release, quick writes and retry while a comment result is unknown', async () => {
    let pr = await multi(await generate()); timeoutComment = hideComments = true;
    pr = await push(pr, await prepare(pr)); expect(pr.items[0].steps[0].comment.state).toBe('unknown'); expect(ledger()[0].state).toBe('in_pr');
    expect((await request('POST', 'prs/' + pr.id + '/close', { version: pr.version })).statusCode).toBe(409);
    expect((await request('POST', 'prs/' + pr.id + '/prepare', { version: pr.version })).statusCode).toBe(409);
    const options = await parse<{ bindingVersion: string; credentialVersion: string; issue: { updated: string; status: { id: string } } }>(request('GET', 'requirements/' + requirementId + '/transitions'));
    const quick = await parse<{ id: string }>(request('POST', 'action-preview', { requirementId, transitionId: 'pass', fromId: options.issue.status.id, remoteUpdated: options.issue.updated, bindingVersion: options.bindingVersion, credentialVersion: options.credentialVersion, reason: '' }));
    expect((await request('POST', 'operations/' + quick.id + '/execute')).statusCode).toBe(409);
    hideComments = false;
    pr = await parse(request('POST', 'prs/' + pr.id + '/recheck', { requirementId, stepId: pr.items[0].steps[0].id, part: 'comment' }));
    expect(pr.items[0].steps[0].comment.state).toBe('success'); expect(ledger()[0].state).toBe('synced'); expect(writes).toEqual(['comment']);
  });
  it('keeps a timed-out transition unknown until explicitly checked', async () => {
    let pr = await multi(await generate()); timeoutTransition = true;
    pr = await push(pr, await prepare(pr)); expect(pr.items[0].steps[0].transition.state).toBe('unknown');
    pr = await parse(request('POST', 'prs/' + pr.id + '/recheck', { requirementId, stepId: pr.items[0].steps[0].id, part: 'transition', resolution: 'applied' }));
    expect(pr.items[0].steps[0].transition.state).toBe('success'); expect(writes).toEqual(['comment', 'transition:pass']);
  });
  it('rejects expired, edited, foreign-account and replaced-credential previews', async () => {
    const pr = await commentOnly(await generate()), preview = await prepare(pr); await connect(second, 'second-token');
    expect((await request('POST', 'prs/' + pr.id + '/execute', { previewId: preview.id }, second)).statusCode).toBe(404);
    await connect(); expect((await request('POST', 'prs/' + pr.id + '/execute', { previewId: preview.id })).statusCode).toBe(409);
    const next = await prepare(pr); context.sqlite.prepare("UPDATE jira_operations SET payload=json_set(payload,'$.createdAt','2000-01-01T00:00:00Z') WHERE id=?").run(next.id);
    expect((await request('POST', 'prs/' + pr.id + '/execute', { previewId: next.id })).statusCode).toBe(409); expect(writes).toEqual([]);
  });
  it('rejects remote changes, missing fields and inaccessible targets before any write', async () => {
    let pr = await generate(); expect((await request('POST', 'prs/' + pr.id + '/prepare', { version: pr.version })).statusCode).toBe(400);
    pr = await multi(pr); required = true;
    expect((await request('POST', 'prs/' + pr.id + '/prepare', { version: pr.version })).statusCode).toBe(400); required = false;
    const preview = await prepare(pr); updated++;
    pr = await push(pr, preview); expect(pr.items[0].steps[0].comment.state).toBe('failed'); expect(writes).toEqual([]);
  });
  it('stops after an in-flight comment and never sends its transition', async () => {
    const pr = await multi(await generate());
    afterComment = async () => { await parse(request('POST', 'prs/' + pr.id + '/stop')); };
    const result = await push(pr, await prepare(pr)); expect(writes).toEqual(['comment']); expect(result.state).toBe('active'); expect(ledger()[0].state).toBe('synced');
  });
  it('recovers a restart as uncertain, without sending any request', async () => {
    const pr = await commentOnly(await generate());
    context.sqlite.prepare("UPDATE jira_prs SET state='running',payload=json_set(payload,'$.items[0].steps[0].comment.state','running') WHERE id=?").run(pr.id);
    vi.mocked(fetch).mockClear(); const result = await load(pr.id);
    expect(result.state).toBe('active'); expect(result.items[0].steps[0].comment.state).toBe('unknown'); expect(fetch).not.toHaveBeenCalled(); expect(writes).toEqual([]);
  });
  it('checks a durable marker before publishing after restoring an older database snapshot', async () => {
    let pr = await commentOnly(await generate());
    comments.push({ id: 'restored-comment', body: '已经发布\n\n' + prMarker(pr.id, pr.items[0].steps[0].id), created: new Date().toISOString() });
    pr = await push(pr, await prepare(pr)); expect(pr.state).toBe('completed'); expect(writes).toEqual([]); expect(ledger()[0].commentId).toBe('restored-comment');
  });
  it('invalidates changed bindings, local source corrections, removed tokens and disabled integration', async () => {
    const pr = await commentOnly(await generate()), preview = await prepare(pr);
    context.sqlite.prepare("UPDATE progress_updates SET content='更正后的内容' WHERE id='source-1'").run();
    expect((await request('POST', 'prs/' + pr.id + '/execute', { previewId: preview.id })).statusCode).toBe(409);
    context.sqlite.prepare("UPDATE progress_updates SET content='完成接口实现，开始联调。' WHERE id='source-1'").run();
    context.config.jiraEnabled = false;
    expect((await request('POST', 'prs/' + pr.id + '/execute', { previewId: preview.id })).statusCode).toBe(409); context.config.jiraEnabled = true;
    await parse(request('DELETE', '/api/me/jira-connection'));
    expect((await request('POST', 'prs/' + pr.id + '/execute', { previewId: preview.id })).statusCode).toBe(409); await connect();
    const next = await prepare(pr); context.sqlite.prepare("UPDATE jira_bindings SET issue_id='999' WHERE requirement_id=?").run(requirementId);
    expect((await request('POST', 'prs/' + pr.id + '/execute', { previewId: next.id })).statusCode).toBe(409); expect(writes).toEqual([]);
  });
  it('allows another manager to continue the shared draft using their own connection', async () => {
    const pr = await commentOnly(await generate()); await connect(second, 'second-token');
    const result = await push(pr, await prepare(pr, second), second);
    expect(result.items[0].steps[0].comment.identity).toContain('Second'); expect(result.items[0].steps[0].comment.accountId).toBe('pr-second');
  });
  it('cannot edit or remove a published comment while adjusting unfinished operations', async () => {
    let pr = await multi(await generate()); failTransition = true;
    pr = await push(pr, await prepare(pr));
    const body = edit(pr); body.items[0].steps[0].body = '试图改写已发布内容';
    expect((await request('PUT', 'prs/' + pr.id, body)).statusCode).toBe(400);
    expect((await request('PUT', 'prs/' + pr.id, { version: pr.version, items: [] })).statusCode).toBe(400);
    expect((await request('POST', 'prs/generate-preview', { prId: pr.id, version: pr.version, scope: pr.scope })).statusCode).toBe(400);
    expect(writes).toEqual(['comment', 'transition:pass']);
  });
  it('pauses a future transition that is no longer available before publishing its comment', async () => {
    const pr = await multi(await generate());
    afterComment = () => { futureUnavailable = true; };
    const result = await push(pr, await prepare(pr));
    expect(result.items[0].steps[0].transition.state).toBe('success'); expect(result.items[0].steps[1].comment.state).toBe('failed');
    expect(comments).toHaveLength(1); expect(writes).toEqual(['comment', 'transition:pass']);
  });
  it('does not turn completion or a pure milestone into a guessed path', async () => {
    const pr = await generate(); expect(pr.items[0].steps).toHaveLength(1); expect(pr.items[0].steps[0].transitionId).toBeNull();
    expect((await request('POST', 'prs/' + pr.id + '/prepare', { version: pr.version })).statusCode).toBe(400); expect(writes).toEqual([]);
  });
  it('suggests only a single explicit work stage, not parallel or unclassified work', async () => {
    context.sqlite.prepare("UPDATE requirements SET execution_mode='work_items',status='in_progress',progress=20 WHERE id=?").run(requirementId);
    const addWork = (id: string, stage: string | null) => context.sqlite.prepare("INSERT INTO work_items(id,requirement_id,title,status,work_stage,progress,actual_start,created_at,updated_at) VALUES (?,?,?,'in_progress',?,20,'2026-08-03',?,?)").run(id, requirementId, id, stage, new Date().toISOString(), new Date().toISOString());
    addWork('stage-test', 'testing'); status = 'acceptance';
    const preview = () => parse<PrGeneration>(request('POST', 'prs/generate-preview', { scope: { featureIds: [null] } }));
    const single = await preview(); expect(single.items[0].steps[0].target?.id).toBe('testing'); expect(single.items[0].decisionRequired).toBe(true);
    addWork('stage-dev', 'development');
    const parallel = await preview(); expect(parallel.items[0].steps[0].target).toBeNull(); expect(parallel.items[0].decisionRequired).toBe(true);
    context.sqlite.prepare("UPDATE work_items SET work_stage=NULL WHERE id='stage-dev'").run();
    const unknown = await preview(); expect(unknown.items[0].steps[0].target).toBeNull(); expect(unknown.items[0].decisionRequired).toBe(true); expect(writes).toEqual([]);
  });
  it('groups completed parallel work into a phase result without duration boilerplate', async () => {
    context.sqlite.prepare("UPDATE requirements SET execution_mode='work_items',status='in_progress',progress=20,actual_start=NULL,actual_end=NULL,planned_start='2026-08-01',planned_end='2026-08-31' WHERE id=?").run(requirementId);
    for (const n of [1, 2]) {
      context.sqlite.prepare("INSERT INTO work_items(id,requirement_id,title,status,work_stage,progress,actual_start,actual_end,created_at,updated_at) VALUES (?,?,?,'completed','development',100,'2026-08-03','2026-08-07',?,?)").run('parallel-' + n, requirementId, '并行开发 ' + n, new Date().toISOString(), new Date().toISOString());
      addSource('parallel-source-' + n); context.sqlite.prepare('UPDATE progress_updates SET work_item_id=?,work_item_percent=100 WHERE id=?').run('parallel-' + n, 'parallel-source-' + n);
    }
    const pr = await generate(), body = pr.items[0].steps[0].body;
    expect(body).toContain('2026-08-07 开发已完成'); expect(body).not.toMatch(/历时|工作日|100%/);
    await parse(request('POST', 'prs/' + pr.id + '/close', { version: pr.version }));
    context.sqlite.prepare('DELETE FROM progress_updates WHERE requirement_id=? AND work_item_id IS NOT NULL').run(requirementId);
    context.sqlite.prepare('DELETE FROM work_items WHERE requirement_id=?').run(requirementId);
    context.sqlite.prepare("UPDATE requirements SET execution_mode='direct',actual_start=NULL,actual_end=NULL WHERE id=?").run(requirementId);
    expect((await generate()).items[0].steps[0].body).not.toContain('历时'); expect(writes).toEqual([]);
  });
});
