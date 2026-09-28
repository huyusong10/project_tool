import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { config } from '../src/server/config';
import { openDatabase } from '../src/server/database';
import { buildApp } from '../src/server/app';
import { hashPassword, createSessionToken } from '../src/server/auth';
import { runWithDatabase, type DatabaseContext } from '../src/server/database-context';
import { jiraConnectionMessages, jiraSetupMessages, jiraSettingsSchema, type JiraIssue, type JiraScan, type JiraProgress } from '../src/shared/jira';
import Database from 'better-sqlite3';
import { createBackup, prepareRestore } from '../src/server/backups';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-jira-'));
let context: DatabaseContext, app: FastifyInstance, cookie: string, secondCookie: string, projectId: string, requirementId: string;
let writes: Array<{ key: string; transition: string }> = [], reads: string[] = [], remote: Record<string, JiraIssue> = {};
let hidden = false, failStep = '', required = false, timeout = false, paginated = false;
const rawIssue = (issue: JiraIssue) => ({ id: issue.id, key: issue.key, fields: { summary: issue.title, issuetype: { id: issue.typeId, name: issue.type }, status: issue.status, updated: issue.updated } });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const api = (suffix: string) => `/api/projects/${projectId}/jira${suffix}`;
const request = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, login = cookie) => app.inject({ method, url, headers: { cookie: login }, ...(payload !== undefined ? { payload: JSON.stringify(payload), headers: { cookie: login, 'content-type': 'application/json' } } : {}) });
const parse = async (promise: ReturnType<typeof request>) => { const response = await promise; expect(response.statusCode, response.body).toBe(200); return response.json(); };
async function connect(login = cookie, token = 'personal-test-token') {
  await parse(request('PUT', '/api/me/jira-connection', { token }, login));
  return parse(request('POST', '/api/me/jira-connection/test', {}, login));
}
async function bind() { return parse(request('POST', api('/bindings'), { requirementId, key: 'TEST-1' })); }
async function readProgress(login = cookie): Promise<JiraProgress> {
  await parse(request('POST', api('/progress/refresh'), {}, login));
  return parse(request('GET', api('/progress'), undefined, login));
}
const scan = async () => await parse(request('POST', api('/scan'), {})) as JiraScan;
function linkRequirement(id: string, keys: string[]) {
  context.sqlite.prepare('UPDATE requirements SET reference_links=?,version=version+1 WHERE id=?').run(JSON.stringify(keys.map(key => ({ title: key, url: 'https://jira.example.test/browse/' + key }))), id);
}
const bindingCount = () => (context.sqlite.prepare('SELECT COUNT(*) AS n FROM jira_bindings').get() as { n: number }).n;
async function preview(transitionId = 'pass', reason = '') {
  const options = await parse(request('GET', api('/requirements/' + requirementId + '/transitions')));
  return parse(request('POST', api('/action-preview'), { requirementId, transitionId, reason, bindingVersion: options.bindingVersion,
    credentialVersion: options.credentialVersion, remoteUpdated: options.issue.updated, fromId: options.issue.status.id }));
}
const execute = (id: string) => request('POST', api('/operations/' + id + '/execute'));
beforeAll(async () => {
  context = await openDatabase({ ...config, dbPath: path.join(directory, 'db.sqlite'), backupDir: path.join(directory, 'backups'), seedDemo: false,
    appPasswordHash: hashPassword('test-password-123'), sessionSecret: 'test-session-secret-more-than-32-characters', nodeEnv: 'test',
    jiraBaseUrl: 'https://jira.example.test', jiraEncryptionKey: 'a'.repeat(64), jiraEnabled: true, jiraApiVersion: '2' });
  app = await buildApp(undefined, context); await app.ready();
  const admin = context.sqlite.prepare("SELECT id FROM accounts WHERE is_builtin=1").get() as { id: string };
  cookie = context.config.sessionCookieName + '=' + runWithDatabase(context, () => createSessionToken(admin.id, 0));
  context.sqlite.prepare("INSERT INTO accounts(id,username,normalized_username,password_hash,global_role,status,must_change_password,session_version,is_builtin,created_at,updated_at) VALUES ('second','second','second',?,'admin','active',0,0,0,?,?)").run(hashPassword('second-password'), new Date().toISOString(), new Date().toISOString());
  secondCookie = context.config.sessionCookieName + '=' + runWithDatabase(context, () => createSessionToken('second', 0));
  const project = await parse(request('POST', '/api/projects', { name: 'Jira test project' })); projectId = project.id;
  const requirement = await parse(request('POST', '/api/requirements', { projectId, title: 'Local requirement' })); requirementId = requirement.id;
});
beforeEach(async () => {
  writes = []; reads = []; hidden = false; failStep = ''; required = false; timeout = false; paginated = false;
  context.config.jiraEnabled = true; context.config.jiraBaseUrl = 'https://jira.example.test'; context.config.jiraEncryptionKey = 'a'.repeat(64); context.config.nodeEnv = 'test';
  context.sqlite.exec("DELETE FROM jira_operations; DELETE FROM jira_bindings; DELETE FROM jira_connections; DELETE FROM jira_ignored; DELETE FROM jira_project_settings; DELETE FROM jira_reference_only; UPDATE requirements SET reference_links='[]',reference_url=NULL; UPDATE work_items SET reference_links='[]';");
  context.sqlite.prepare("UPDATE requirements SET status='completed',progress=100,version=version+1 WHERE id=?").run(requirementId);
  context.sqlite.prepare('UPDATE requirements SET deleted_at=? WHERE id<>?').run(new Date().toISOString(), requirementId);
  remote = { 'TEST-1': { id: '101', key: 'TEST-1', title: 'Remote requirement', typeId: 'story', type: 'Story', status: { id: 'testing', name: '测试' }, updated: '1', url: 'https://jira.example.test/browse/TEST-1' }, 'TEST-2': { id: '102', key: 'TEST-2', title: 'Another task', typeId: 'task', type: 'Task', status: { id: 'waiting', name: '待排期' }, updated: '1', url: 'https://jira.example.test/browse/TEST-2' } };
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)); const auth = new Headers(init?.headers).get('authorization');
    if (auth !== 'Bearer personal-test-token' && auth !== 'Bearer second-test-token') return json({}, 401);
    if (url.pathname.endsWith('/myself')) return json({ displayName: auth.includes('second') ? 'Second' : 'Tester', name: auth.includes('second') ? 'second' : 'tester' });
    if (url.pathname.endsWith('/project')) return json([{ id: 'p1', key: auth.includes('second') ? 'SECOND' : 'TEST', name: 'Visible project' }]);
    if (url.pathname.endsWith('/project/TEST/statuses')) return json([{ id: 'story', name: 'Story', statuses: [{ id: 'done', name: '完成' }] }]);
    if (url.pathname.endsWith('/project/TEST/components')) return json([{ id: 'c1', name: '平台' }]);
    if (url.pathname.endsWith('/user/search')) return json([{ name: 'tester', displayName: 'Tester', emailAddress: 'not-returned@example.test' }]);
    if (url.pathname.endsWith('/jql/autocompletedata/suggestions')) return json({ results: [{ value: 'release' }, { value: 'release' }] });
    if (url.pathname.endsWith('/search')) { reads.push('search:' + url.searchParams.get('jql')); const startAt = Number(url.searchParams.get('startAt')); return json({ startAt, total: paginated ? 2 : 1, issues: [rawIssue(remote[paginated && startAt ? 'TEST-3' : 'TEST-2'])] }); }
    const match = /\/issue\/([^/]+)(.*)/.exec(url.pathname); if (!match) return json({}, 404);
    const issue = remote[match[1]] || Object.values(remote).find(i => i.id === match[1] || i.key === match[1]); if (!issue || hidden && issue.key === 'TEST-1') return json({}, 404);
    if (match[2] === '/remotelink') return json([{ object: { url: 'https://ecc.jereh.cn/pages/viewpage.action?pageId=123', title: 'Design document' } }]);
    if (match[2] === '/transitions') {
      if (init?.method === 'POST') {
        const transition = JSON.parse(String(init.body)).transition.id; writes.push({ key: issue.key, transition });
        if (transition === failStep) return json({}, 400);
        issue.status = transition === 'pass' ? { id: 'acceptance', name: '验收' } : { id: 'done', name: '完成' }; issue.updated = String(Number(issue.updated) + 1);
        if (timeout) throw new Error('simulated timeout');
        return new Response(null, { status: 204 });
      }
      return json({ transitions: issue.status.id === 'testing' ? [{ id: 'pass', name: '测试通过', to: { id: 'acceptance', name: '验收' }, fields: required ? { resolution: { required: true, name: '处理结果' } } : {} }] : issue.status.id === 'acceptance' ? [{ id: 'finish', name: '完成', to: { id: 'done', name: '完成' }, fields: {} }] : [] });
    }
    reads.push(issue.key); return json(rawIssue(issue));
  }));
  await connect();
  await parse(request('PUT', api('/settings'), { expectedVersion: 0, settings: jiraSettingsSchema.parse({ projects: ['TEST'] }) }));
});
afterAll(async () => { vi.unstubAllGlobals(); await app?.close(); context?.close(); fs.rmSync(directory, { recursive: true, force: true }); });

describe('personal Jira REST integration', () => {
  it('shares the main Jira link with project readers without granting remote access', async () => {
    await bind(); const person = await parse(request('POST', '/api/people', { name: 'Jira link reader' }));
    context.sqlite.prepare("INSERT INTO project_people(project_id,person_id,project_role,created_at) VALUES (?,?,'viewer',?)").run(projectId, person.id, new Date().toISOString());
    const account = context.sqlite.prepare('SELECT id,session_version AS version FROM accounts WHERE person_id=?').get(person.id) as { id: string; version: number };
    context.sqlite.prepare("UPDATE accounts SET must_change_password=0 WHERE id=?").run(account.id);
    const login = context.config.sessionCookieName + '=' + runWithDatabase(context, () => createSessionToken(account.id, account.version));
    vi.mocked(fetch).mockClear();
    expect(await parse(request('GET', api('/requirements/' + requirementId + '/link'), undefined, login))).toEqual({ key: 'TEST-1', url: remote['TEST-1'].url });
    expect((await request('GET', api('/requirements/' + requirementId + '/transitions'), undefined, login)).statusCode).toBe(403);
    expect((await request('POST', api('/progress/refresh'), {}, login)).statusCode).toBe(403); expect(fetch).not.toHaveBeenCalled();
  });
  it('cleans obsolete settings and scans while preserving credentials, bindings and receipts', async () => {
    await bind(); const receipt = await preview(); await scan();
    const credential = context.sqlite.prepare('SELECT * FROM jira_connections').all();
    context.sqlite.prepare("UPDATE jira_project_settings SET settings=json_set(settings,'$.writesEnabled',1,'$.statuses',json('[]'),'$.rules',json('[]'),'$.paths',json('[]'))").run();
    context.sqlite.exec(fs.readFileSync(path.join(process.cwd(), 'drizzle/0040_jira_progress_management.sql'), 'utf8'));
    expect((await parse(request('GET', api('/settings')))).settings).toEqual(jiraSettingsSchema.parse({ projects: ['TEST'] }));
    expect(await parse(request('GET', api('/scan')))).toBeNull(); expect(bindingCount()).toBe(1);
    expect(context.sqlite.prepare('SELECT * FROM jira_connections').all()).toEqual(credential);
    expect((await parse(request('GET', api('/operations/' + receipt.id)))).id).toBe(receipt.id); expect(writes).toEqual([]);
  });
  it('marks discovery incomplete if a later page fails and retains its earlier results', async () => {
    paginated = true; const first = await scan();
    vi.mocked(fetch).mockResolvedValueOnce(json({ internal: 'do not expose' }, 500));
    const second = await parse(request('POST', api('/scan'), { startAt: first.nextStartAt, previousId: first.id }));
    expect(second).toMatchObject({ complete: false, total: 2 }); expect(second.rows).toHaveLength(1);
    expect(second.warnings).toHaveLength(1); expect(JSON.stringify(second)).not.toContain('do not expose'); expect(writes).toEqual([]);
  });
  it('does not label an empty remote page complete when Jira reports more results', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ startAt: 0, total: 10, issues: [] }));
    expect((await scan()).complete).toBe(false); expect(writes).toEqual([]);
  });
  it('recomputes discovery associations after binding without rescanning remotely', async () => {
    await scan(); await parse(request('POST', api('/bindings'), { requirementId, key: 'TEST-2' })); vi.mocked(fetch).mockClear();
    expect((await parse(request('GET', api('/scan')))).rows[0]).toMatchObject({ requirementId, association: 'linked' });
    await parse(request('DELETE', api('/bindings/' + requirementId)));
    expect((await parse(request('GET', api('/scan')))).rows[0].requirementId).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  });
  it('does not alter local execution, completion conditions, templates or milestones', async () => {
    const snapshot = () => ['requirements', 'work_items', 'milestones', 'template_items'].map(table => context.sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY id').all());
    const before = snapshot(); await bind(); await readProgress(); const p = await preview(); await parse(execute(p.id));
    expect(snapshot()).toEqual(before);
  });
  it('loads all nonarchived requirements without a token or remote calls', async () => {
    const r = await parse(request('POST', '/api/requirements', { projectId, title: 'Cancelled requirement' }));
    context.sqlite.prepare("UPDATE requirements SET status='cancelled' WHERE id=?").run(r.id);
    await parse(request('DELETE', '/api/me/jira-connection')); vi.mocked(fetch).mockClear();
    const result = await parse(request('GET', api('/progress')));
    expect(result.rows).toEqual(expect.arrayContaining([expect.objectContaining({ requirementId, localStatus: 'completed', binding: null }), expect.objectContaining({ requirementId: r.id, localStatus: 'cancelled' })]));
    context.sqlite.prepare('UPDATE requirements SET deleted_at=? WHERE id=?').run(new Date().toISOString(), r.id);
    expect((await parse(request('GET', api('/progress')))).rows.some((row: { requirementId: string }) => row.requirementId === r.id)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('refreshes requirement links despite duplicate title and work references', async () => {
    const r = await parse(request('POST', '/api/requirements', { projectId, title: 'TEST-1 implementation' }));
    linkRequirement(r.id, ['TEST-1']);
    await parse(request('POST', `/api/requirements/${r.id}/work-items`, { expectedVersion: r.version + 1, title: 'Work', referenceLinks: [{ title: 'TEST-1', url: remote['TEST-1'].url }] }));
    expect(await parse(request('POST', api('/progress/refresh'), {}))).toMatchObject({ total: 1, offset: 1, complete: true });
    const row = (await parse(request('GET', api('/progress')))).rows.find((row: { requirementId: string }) => row.requirementId === r.id);
    expect(row).toMatchObject({ binding: { issueId: '101' }, readState: 'success', issue: { status: { id: 'testing' } } });
    expect(writes).toEqual([]);
  });
  it('isolates progress by account and invalidates only affected references', async () => {
    await bind(); await parse(request('POST', api('/progress/refresh'), {})); await connect(secondCookie, 'second-test-token');
    const row = async (login = cookie) => (await parse(request('GET', api('/progress'), undefined, login))).rows.find((r: { requirementId: string }) => r.requirementId === requirementId);
    expect(await row(secondCookie)).toMatchObject({ binding: { issueId: '101' }, issue: null, readState: 'unread' });
    context.sqlite.prepare('UPDATE requirements SET version=version+1 WHERE id=?').run(requirementId);
    expect(await row()).toMatchObject({ readState: 'success' });
    hidden = true; await parse(request('POST', api('/progress/refresh'), {}));
    expect(await row()).toMatchObject({ readState: 'failed', binding: { issueId: '101' }, issue: { status: { id: 'testing' } } });
    hidden = false; await connect(); expect(await row()).toMatchObject({ readState: 'unread', issue: null });
    await parse(request('POST', api('/progress/refresh'), {})); await parse(request('DELETE', api('/bindings/' + requirementId)));
    expect(await row()).toMatchObject({ binding: null, issue: null });
  });
  it('does not restore an explicitly removed binding on refresh', async () => {
    linkRequirement(requirementId, ['TEST-1']); await parse(request('POST', api('/progress/refresh'), {}));
    await parse(request('DELETE', api('/bindings/' + requirementId))); await parse(request('POST', api('/progress/refresh'), {}));
    expect(bindingCount()).toBe(0); await bind(); expect(bindingCount()).toBe(1); expect(writes).toEqual([]);
  });
  it('refreshes batches of 50 with at most four concurrent reads', async () => {
    for (let index = 10; index < 63; index++) {
      const key = 'TEST-' + index; remote[key] = { ...remote['TEST-1'], id: String(index + 1000), key };
      const r = await parse(request('POST', '/api/requirements', { projectId, title: 'Batch ' + index })); linkRequirement(r.id, [key]);
    }
    const original = vi.mocked(fetch).getMockImplementation()!; let active = 0, maximum = 0;
    vi.mocked(fetch).mockImplementation(async (...args) => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 2)); try { return await original(...args); } finally { active--; } });
    const first = await parse(request('POST', api('/progress/refresh'), {}));
    expect(first).toMatchObject({ offset: 50, total: 53, complete: false }); expect(reads).toHaveLength(50); expect(maximum).toBe(4);
    expect((await request('POST', api('/progress/refresh'), { id: first.id, offset: 0 })).statusCode).toBe(409);
    expect(await parse(request('POST', api('/progress/refresh'), { id: first.id, offset: 50 }))).toMatchObject({ offset: 53, complete: true }); expect(writes).toEqual([]);
  });
  it('preserves completed results when one issue cannot be read', async () => {
    const r = await parse(request('POST', '/api/requirements', { projectId, title: 'Readable' }));
    linkRequirement(requirementId, ['TEST-1']); linkRequirement(r.id, ['TEST-2']); hidden = true;
    expect(await parse(request('POST', api('/progress/refresh'), {}))).toMatchObject({ failed: 1, offset: 2 });
    const result = await parse(request('GET', api('/progress')));
    expect(result.rows.find((row: { requirementId: string }) => row.requirementId === r.id)).toMatchObject({ readState: 'success' });
    expect(result.rows.find((row: { requirementId: string }) => row.requirementId === requirementId)).toMatchObject({ readState: 'failed', binding: null });
  });
  it('keeps previews valid when only discovery filters change', async () => {
    await bind(); const p = await preview(); const current = await parse(request('GET', api('/settings')));
    await parse(request('PUT', api('/settings'), { expectedVersion: current.version, settings: { ...current.settings, projects: ['OTHER'] } }));
    expect((await parse(execute(p.id))).items[0].outcome).toBe('success'); expect(writes).toHaveLength(1);
  });
  it('distinguishes multiple actions for the same target and rejects invented actions', async () => {
    await bind(); const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) => String(args[0]).includes('/transitions') ? json({ transitions: [{ id: 'first', name: '通过', to: { id: 'acceptance', name: '验收' } }, { id: 'second', name: '免测', to: { id: 'acceptance', name: '验收' } }] }) : original(...args));
    const options = await parse(request('GET', api('/requirements/' + requirementId + '/transitions')));
    expect(options.transitions.map((t: { id: string }) => t.id)).toEqual(['first', 'second']); expect((await preview('second')).items[0]).toMatchObject({ transitionId: 'second', transitionName: '免测' });
    expect((await request('POST', api('/action-preview'), { requirementId, transitionId: 'invented', bindingVersion: options.bindingVersion, credentialVersion: options.credentialVersion, remoteUpdated: options.issue.updated, fromId: options.issue.status.id })).statusCode).toBe(409);
    expect(writes).toEqual([]);
  });
  it('returns no actions for a terminal Jira issue', async () => {
    await bind(); remote['TEST-1'].status = { id: 'done', name: '完成' };
    expect((await parse(request('GET', api('/requirements/' + requirementId + '/transitions')))).transitions).toEqual([]); expect(writes).toEqual([]);
  });
  it('requires explicit acknowledgement before another operation after a timeout', async () => {
    await bind(); const first = await preview(); timeout = true;
    expect((await parse(execute(first.id))).items[0].outcome).toBe('unknown'); const second = await preview('finish'); timeout = false;
    expect((await execute(second.id)).statusCode).toBe(409); await parse(request('POST', api('/operations/' + first.id + '/recheck'), {}));
    expect((await execute(second.id)).statusCode).toBe(409);
    expect((await parse(request('POST', api('/operations/' + first.id + '/recheck'), { acknowledge: true }))).items[0].outcome).toBe('checked');
    expect((await parse(execute(second.id))).items[0].outcome).toBe('success'); expect(writes).toHaveLength(2);
  });
  it('recovers interrupted writes as unknown and forbids replay of old operations', async () => {
    await bind(); const p = await preview();
    context.sqlite.prepare("UPDATE jira_operations SET state='running',payload=json_set(payload,'$.items[0].outcome','running') WHERE id=?").run(p.id);
    expect((await parse(request('GET', api('/operations/' + p.id)))).items[0].outcome).toBe('unknown'); await parse(execute(p.id)); expect(writes).toEqual([]);
    context.sqlite.prepare("UPDATE jira_operations SET kind='sync' WHERE id=?").run(p.id);
    expect((await execute(p.id)).statusCode).toBe(410); expect((await request('POST', api('/sync/' + p.id + '/execute'))).statusCode).toBe(410);
    expect((await parse(request('GET', api('/operations/' + p.id)))).legacy).toBe(true);
  });
  it('associates direct links in progress without mixing them into discovery', async () => {
    linkRequirement(requirementId, ['TEST-1']);
    const before = context.sqlite.prepare('SELECT * FROM requirements WHERE id=?').get(requirementId);
    const result = await readProgress();
    expect(result.rows.find(r => r.requirementId === requirementId)).toMatchObject({ binding: { issueId: '101' }, localStatus: 'completed', readState: 'success' });
    expect((await scan()).rows.map(r => r.key)).toEqual(['TEST-2']);
    expect(bindingCount()).toBe(1); await readProgress(); expect(bindingCount()).toBe(1);
    expect(context.sqlite.prepare('SELECT * FROM requirements WHERE id=?').get(requirementId)).toEqual(before); expect(writes).toEqual([]);
  });  it('deduplicates aliases by stable issue ID during progress refresh', async () => {
    remote['TEST-1'].key = 'MOVED-1'; linkRequirement(requirementId, ['TEST-1', 'MOVED-1']);
    expect((await readProgress()).rows.find(r => r.requirementId === requirementId)).toMatchObject({ binding: { issueId: '101' }, issue: { key: 'MOVED-1' } });
    expect(bindingCount()).toBe(1); expect(writes).toEqual([]);
  });  it('shares bindings but not another account remote results', async () => {
    linkRequirement(requirementId, ['TEST-1']); await readProgress();
    await connect(secondCookie, 'second-test-token'); hidden = true;
    expect(await parse(request('GET', api('/scan'), undefined, secondCookie))).toBeNull();
    expect((await readProgress(secondCookie)).rows.find(r => r.requirementId === requirementId)).toMatchObject({ binding: { issueId: '101' }, issue: null, readState: 'failed' });
    expect(bindingCount()).toBe(1); expect(writes).toEqual([]);
  });  it('does not pick a winner between requirements referencing aliases', async () => {
    remote['TEST-1'].key = 'MOVED-1';
    const other = await parse(request('POST', '/api/requirements', { projectId, title: 'Another local requirement' }));
    linkRequirement(requirementId, ['TEST-1']); linkRequirement(other.id, ['MOVED-1']);
    const rows = (await readProgress()).rows.filter(r => [requirementId, other.id].includes(r.requirementId));
    expect(rows.every(r => r.readState === 'failed' && !r.binding)).toBe(true); expect(bindingCount()).toBe(0);
  });  it('requires manual binding for multiple links or unreadable references', async () => {
    linkRequirement(requirementId, ['TEST-1', 'TEST-2']);
    expect((await readProgress()).rows.find(r => r.requirementId === requirementId)).toMatchObject({ binding: null, readState: 'failed' });
    hidden = true;
    expect((await readProgress()).rows.find(r => r.requirementId === requirementId)).toMatchObject({ binding: null, readState: 'failed' });
    expect(bindingCount()).toBe(0);
  });  it('does not associate an unreadable direct link', async () => {
    linkRequirement(requirementId, ['TEST-1']); hidden = true;
    expect((await readProgress()).rows.find(r => r.requirementId === requirementId)).toMatchObject({ binding: null, readState: 'failed' }); expect(bindingCount()).toBe(0);
  });  it('keeps work links and matching titles as candidates instead of auto-binding', async () => {
    const workRequirement = await parse(request('POST', '/api/requirements', { projectId, title: 'Work reference owner' }));
    await parse(request('POST', `/api/requirements/${workRequirement.id}/work-items`, { expectedVersion: workRequirement.version, title: 'Implementation', referenceLinks: [{ title: 'Task', url: remote['TEST-2'].url }] }));
    const titleRequirement = await parse(request('POST', '/api/requirements', { projectId, title: 'TEST-2 Other title' }));
    const similar = await parse(request('POST', '/api/requirements', { projectId, title: '【模块】Another task' }));
    const result = await scan();
    expect(result.rows.find(r => r.key === 'TEST-2')?.candidates).toEqual(expect.arrayContaining([expect.objectContaining({ id: workRequirement.id, reason: '工作项中的 Jira 链接' })]));
    expect(result.rows.find(r => r.key === 'TEST-2')?.candidates).toEqual(expect.arrayContaining([expect.objectContaining({ id: titleRequirement.id, reason: '需求标题中的 Jira 编号' }), expect.objectContaining({ id: similar.id, reason: '需求标题相近' })]));
    expect(bindingCount()).toBe(0);
  });
  it('returns Jira state without mapping or local phase inference', async () => {
    await bind();
    await parse(request('POST', api('/progress/refresh'), {}));
    const result = await parse(request('GET', api('/progress')));
    expect(result.rows.find((r: { requirementId: string }) => r.requirementId === requirementId)).toMatchObject({ localStatus: 'completed', readState: 'success', issue: { status: { id: 'testing' } } });
    expect(JSON.stringify(result)).not.toMatch(/suggestion|reconciliation|target/);
    expect(writes).toEqual([]);
  });
  it('preserves unbinding across aliases and refreshes until manually rebound', async () => {
    linkRequirement(requirementId, ['TEST-1']); await readProgress(); await parse(request('DELETE', api('/bindings/' + requirementId)));
    remote['TEST-1'].key = 'MOVED-1';
    expect((await readProgress()).rows.find(r => r.requirementId === requirementId)?.binding).toBeNull();
    await readProgress(); expect(bindingCount()).toBe(0); await bind(); expect(bindingCount()).toBe(1);
    expect(context.sqlite.prepare('SELECT COUNT(*) AS n FROM jira_reference_only').get()).toEqual({ n: 0 }); expect(writes).toEqual([]);
  });  it('keeps primary bindings after link changes and rejects cross-project duplicates', async () => {
    await bind(); linkRequirement(requirementId, ['TEST-2']);
    expect((await readProgress()).rows.find(r => r.requirementId === requirementId)).toMatchObject({ binding: { issueId: '101' } });
    expect((await scan()).rows[0].association).toBe('conflict');
    const p = await parse(request('POST', '/api/projects', { name: 'Other Jira project' }));
    const r = await parse(request('POST', '/api/requirements', { projectId: p.id, title: 'Private local title' }));
    expect((await request('POST', '/api/projects/' + p.id + '/jira/bindings', { requirementId: r.id, key: 'TEST-1' })).statusCode).toBe(409);
    expect(bindingCount()).toBe(1);
  });  it('does not auto-bind references claimed in another project or disclose its title', async () => {
    const p = await parse(request('POST', '/api/projects', { name: 'Other reference project' }));
    const r = await parse(request('POST', '/api/requirements', { projectId: p.id, title: 'Do not disclose this title' }));
    linkRequirement(r.id, ['TEST-1']); linkRequirement(requirementId, ['TEST-1']);
    const result = await readProgress();
    expect(result.rows.find(r => r.requirementId === requirementId)).toMatchObject({ binding: null, readState: 'failed' });
    expect(JSON.stringify(result)).not.toContain('Do not disclose this title'); expect(bindingCount()).toBe(0);
  });  it('associates ignored direct links only after restoration and an explicit refresh', async () => {
    linkRequirement(requirementId, ['TEST-1']); await parse(request('PUT', api('/ignored'), { key: 'TEST-1', ignored: true }));
    await readProgress(); expect(bindingCount()).toBe(0);
    await parse(request('PUT', api('/ignored'), { key: 'TEST-1', ignored: false }));
    await readProgress(); expect(bindingCount()).toBe(1); expect(writes).toEqual([]);
  });  it.each(['references', 'credential'] as const)('does not auto-bind stale references after %s change while refreshing', async change => {
    linkRequirement(requirementId, ['TEST-1']);
    let entered!: () => void, finish!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    vi.mocked(fetch).mockImplementationOnce(async () => { entered(); await waiting; return json(rawIssue(remote['TEST-1'])); });
    const pending = request('POST', api('/progress/refresh'), {}).then(r => r);
    await started;
    if (change === 'references') linkRequirement(requirementId, ['TEST-2']);
    else await parse(request('DELETE', '/api/me/jira-connection'));
    finish(); expect((await pending).statusCode).toBe(change === 'references' ? 200 : 409);
    expect(bindingCount()).toBe(0); expect(writes).toEqual([]);
  });
  it('loads visible projects, types, statuses, components, users and labels through read-only REST', async () => {
    const { version } = await parse(request('GET', '/api/me/jira-connection'));
    const metadata = (query: Record<string, string>) => request('GET', api('/metadata?' + new URLSearchParams({ version, ...query })));
    expect(await parse(metadata({ kind: 'projects' }))).toEqual([{ id: 'p1', key: 'TEST', name: 'Visible project' }]);
    expect(await parse(metadata({ kind: 'types', project: 'TEST' }))).toEqual([{ id: 'story', name: 'Story', statuses: [{ id: 'done', name: '完成' }] }]);
    expect(await parse(metadata({ kind: 'components', project: 'TEST' }))).toEqual([{ id: 'c1', name: '平台' }]);
    expect(await parse(metadata({ kind: 'users', query: 'Tester & 中文' }))).toEqual([{ name: 'tester', displayName: 'Tester' }]);
    expect(await parse(metadata({ kind: 'labels', query: 'release' }))).toEqual(['release']);
    const remoteUrl = vi.mocked(fetch).mock.calls.map(call => new URL(String(call[0]))).find(url => url.pathname.endsWith('/user/search'))!;
    expect(remoteUrl.searchParams.get('username')).toBe('Tester & 中文');
    expect(remoteUrl.searchParams.get('includeInactive')).toBe('true');
    const response = await metadata({ kind: 'projects' });
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
    expect(writes).toEqual([]);
  });
  it('isolates metadata by personal credential and rejects a replaced version before contacting Jira', async () => {
    const original = await parse(request('GET', '/api/me/jira-connection'));
    const url = api('/metadata?kind=projects&version=' + original.version);
    expect((await request('GET', url, undefined, secondCookie)).statusCode).toBe(409);
    const second = await connect(secondCookie, 'second-test-token');
    expect(await parse(request('GET', api('/metadata?kind=projects&version=' + second.version), undefined, secondCookie))).toEqual([{ id: 'p1', key: 'SECOND', name: 'Visible project' }]);
    await connect(); vi.mocked(fetch).mockClear();
    expect((await request('GET', url)).statusCode).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects metadata returned after token removal and does not retry failed reads', async () => {
    const { version } = await parse(request('GET', '/api/me/jira-connection'));
    const url = api('/metadata?kind=projects&version=' + version);
    vi.mocked(fetch).mockImplementationOnce(async () => json({}, 403));
    const before = vi.mocked(fetch).mock.calls.length;
    expect((await request('GET', url)).statusCode).toBe(502);
    expect(vi.mocked(fetch).mock.calls.length - before).toBe(1);
    let entered!: () => void, finish!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    vi.mocked(fetch).mockImplementationOnce(async () => { entered(); await waiting; return json([{ id: 'p1', key: 'TEST', name: 'Private' }]); });
    const pending = request('GET', url).then(r => r);
    await started; await parse(request('DELETE', '/api/me/jira-connection')); finish();
    const response = await pending;
    expect(response.statusCode).toBe(409); expect(response.body).not.toContain('Private');
  });
  it('checks local project permissions for metadata and rejects malformed queries', async () => {
    const second = await connect(secondCookie, 'second-test-token');
    context.sqlite.prepare("UPDATE accounts SET global_role='user' WHERE id='second'").run();
    try {
      vi.mocked(fetch).mockClear();
      expect((await request('GET', api('/metadata?kind=projects&version=' + second.version), undefined, secondCookie)).statusCode).toBe(403);
      expect(fetch).not.toHaveBeenCalled();
    } finally { context.sqlite.prepare("UPDATE accounts SET global_role='admin' WHERE id='second'").run(); }
    expect((await request('GET', api('/metadata?kind=types&version=' + second.version))).statusCode).toBe(400);
  });
  it('verifies and saves a new token atomically and keeps verification on reload', async () => {
    const saved = await parse(request('PUT', '/api/me/jira-connection', { token: 'second-test-token' }));
    expect(saved).toMatchObject({ configured: true, available: true, identity: 'Second (second)' });
    expect(saved.verifiedAt).toBeTruthy();
    expect(await parse(request('GET', '/api/me/jira-connection'))).toEqual(saved);
    expect(writes).toEqual([]);
  });
  it('preserves the old credential, verification and previews when a replacement fails', async () => {
    await bind(); const p = await preview();
    const before = await parse(request('GET', '/api/me/jira-connection'));
    expect((await request('PUT', '/api/me/jira-connection', { token: 'invalid-replacement' })).statusCode).toBe(502);
    expect(await parse(request('GET', '/api/me/jira-connection'))).toEqual(before);
    expect((await parse(request('POST', api('/operations/' + p.id + '/execute')))).items[0].outcome).toBe('success');
  });
  it('does not claim verification if the deployment encryption key changes', async () => {
    context.config.jiraEncryptionKey = 'b'.repeat(64);
    const status = await parse(request('GET', '/api/me/jira-connection'));
    expect(status).toMatchObject({ configured: true, available: false, verifiedAt: null });
    expect(status.problem).toBe(jiraConnectionMessages.savedUnavailable);
    vi.mocked(fetch).mockClear();
    expect((await request('POST', api('/scan'), {})).statusCode).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not overwrite a concurrent connection removal after a slow verification', async () => {
    let entered!: () => void, finish!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const wait = new Promise<void>(resolve => { finish = resolve; });
    vi.mocked(fetch).mockImplementationOnce(async () => { entered(); await wait; return json({ displayName: 'Second', name: 'second' }); });
    const saving = request('PUT', '/api/me/jira-connection', { token: 'second-test-token' }).then(r => r);
    await started;
    await parse(request('DELETE', '/api/me/jira-connection'));
    finish();
    expect((await saving).statusCode).toBe(409);
    expect((await parse(request('GET', '/api/me/jira-connection'))).configured).toBe(false);
  });
  it('clears ignored state when a main association is confirmed', async () => {
    await parse(request('PUT', api('/ignored'), { key: 'TEST-2', ignored: true }));
    await parse(request('POST', api('/bindings'), { requirementId, key: 'TEST-2' }));
    expect((await scan()).rows[0]).toMatchObject({ association: 'linked', ignored: false, requirementId });
    expect((await request('PUT', api('/ignored'), { key: 'TEST-2', ignored: true })).statusCode).toBe(400); expect(writes).toEqual([]);
  });  it('encrypts credentials and never returns their contents', async () => {
    const status = await parse(request('GET', '/api/me/jira-connection'));
    expect(JSON.stringify(status)).not.toContain('personal-test-token'); expect(status.identity).toContain('Tester');
    const stored = context.sqlite.prepare('SELECT encrypted_token FROM jira_connections').get() as { encrypted_token: string };
    expect(stored.encrypted_token).not.toContain('personal-test-token');
    expect((await request('GET', '/api/me/jira-connection', undefined, '')).statusCode).toBe(401);
  });
  it('isolates credentials and scan snapshots between accounts', async () => {
    await bind(); const scan = await parse(request('POST', api('/scan'), {}));
    expect(scan.rows.map((r: { key: string }) => r.key)).toEqual(['TEST-2']);
    await connect(secondCookie, 'second-test-token');
    expect(await parse(request('GET', api('/scan'), undefined, secondCookie))).toBeNull();
    const p = await preview();
    expect((await request('GET', api('/operations/' + p.id), undefined, secondCookie)).statusCode).toBe(404);
    expect(writes).toEqual([]);
  });
  it('reads primary bindings outside discovery filters without changing Jira', async () => {
    await bind(); const result = await scan();
    expect(result.rows.map(r => r.key)).toEqual(['TEST-2']); reads = [];
    expect((await readProgress()).rows.find(r => r.requirementId === requirementId)?.readState).toBe('success');
    expect(reads).toEqual(['TEST-1']); expect(writes).toEqual([]);
  });  it('reads primary bindings without a discovery range', async () => {
    await bind(); const settings = await parse(request('GET', api('/settings')));
    await parse(request('PUT', api('/settings'), { expectedVersion: settings.version, settings: { ...settings.settings, projects: [], jql: '' } }));
    const discovery = await scan(); expect(discovery.complete).toBe(false); expect(discovery.warnings).toHaveLength(1);
    expect((await readProgress()).rows.find(r => r.requirementId === requirementId)?.readState).toBe('success'); expect(writes).toEqual([]);
  });  it('keeps an unreadable binding without interpreting it as deletion', async () => {
    await bind(); hidden = true;
    expect((await readProgress()).rows.find(r => r.requirementId === requirementId)).toMatchObject({ readState: 'failed', binding: { issueId: '101' } }); expect(bindingCount()).toBe(1);
  });  it('reads a moved Jira key through its stable issue binding', async () => {
    await bind(); remote['TEST-1'].key = 'MOVED-1';
    expect((await readProgress()).rows.find(r => r.requirementId === requirementId)).toMatchObject({ binding: { issueId: '101' }, issue: { key: 'MOVED-1' } });
  });  it('requires explicit confirmation and executes exactly one transition once', async () => {
    await bind(); const p = await preview(); expect(writes).toEqual([]);
    const executed = await parse(request('POST', api('/operations/' + p.id + '/execute')));
    expect(executed.items[0].outcome).toBe('success'); expect(writes.map(w => w.transition)).toEqual(['pass']);
    await parse(request('POST', api('/operations/' + p.id + '/execute'))); expect(writes).toHaveLength(1);
    expect(context.sqlite.prepare('SELECT status FROM requirements WHERE id=?').get(requirementId)).toEqual({ status: 'completed' });
  });
  it('stops on remote changes after preview', async () => {
    await bind(); const p = await preview(); remote['TEST-1'].updated = 'changed';
    const executed = await parse(request('POST', api('/operations/' + p.id + '/execute')));
    expect(executed.items[0].outcome).toBe('failed'); expect(writes).toEqual([]);
  });
  it('does not invalidate a Jira preview for unrelated local progress changes', async () => {
    await bind(); const p = await preview(); context.sqlite.prepare('UPDATE requirements SET version=version+1 WHERE id=?').run(requirementId);
    const executed = await parse(request('POST', api('/operations/' + p.id + '/execute')));
    expect(executed.items[0].outcome).toBe('success'); expect(writes).toHaveLength(1);
  });
  it('invalidates previews on token replacement, even with identical token text', async () => {
    await bind(); const p = await preview(); await connect();
    expect((await request('POST', api('/operations/' + p.id + '/execute'))).statusCode).toBe(409); expect(writes).toEqual([]);
  });
  it('does not send the old token to a changed site', async () => {
    context.config.jiraBaseUrl = 'https://different.example.test'; vi.mocked(fetch).mockClear();
    expect((await request('POST', api('/scan'), {})).statusCode).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('never continues to completion after a successful testing transition', async () => {
    await bind(); const p = await preview();
    expect((await parse(execute(p.id))).items[0].outcome).toBe('success');
    expect(remote['TEST-1'].status.id).toBe('acceptance'); expect(writes).toHaveLength(1);
    const next = await preview('finish'); failStep = 'finish';
    expect((await parse(execute(next.id))).items[0].outcome).toBe('failed');
    failStep = ''; await parse(execute(next.id)); expect(writes).toHaveLength(2);
    expect(remote['TEST-1'].status.id).toBe('acceptance');
  });
  it('reads back uncertain results without repeating the write', async () => {
    await bind(); const p = await preview(); timeout = true;
    const result = await parse(request('POST', api('/operations/' + p.id + '/execute')));
    expect(result.items[0].outcome).toBe('unknown'); expect(writes).toHaveLength(1);
    await parse(request('POST', api('/operations/' + p.id + '/recheck'))); expect(writes).toHaveLength(1);
  });
  it('rejects required fields instead of inventing values', async () => {
    await bind(); required = true;
    const options = await parse(request('GET', api('/requirements/' + requirementId + '/transitions')));
    const response = await request('POST', api('/action-preview'), { requirementId, transitionId: 'pass', reason: '',
      bindingVersion: options.bindingVersion, credentialVersion: options.credentialVersion, remoteUpdated: options.issue.updated, fromId: options.issue.status.id });
    expect(response.statusCode).toBe(400); expect(response.json().error).toContain('处理结果'); expect(writes).toEqual([]);
  });
  it('previews import links and creates one local requirement without copying Jira state', async () => {
    const p = await parse(request('POST', api('/import-preview'), { key: 'TEST-2' }));
    expect(p.links).toHaveLength(2);
    const input = { projectId, title: 'Imported requirement', referenceLinks: p.links };
    const r = await parse(request('POST', api('/imports/' + p.id), input));
    expect(r.status).toBe('not_started');
    expect((await parse(request('POST', api('/imports/' + p.id), input))).id).toBe(r.id);
    expect(writes).toEqual([]);
  });
  it('does not permit duplicate primary bindings', async () => { await bind(); expect((await request('POST', api('/bindings'), { requirementId, key: 'TEST-2' })).statusCode).toBe(409); });
  it('accumulates all discovery pages without including bindings outside the range', async () => {
    await bind(); paginated = true; remote['TEST-3'] = { ...remote['TEST-2'], id: '103', key: 'TEST-3' };
    const first = await parse(request('POST', api('/scan'), {})); expect(first.nextStartAt).toBe(1); expect(first.complete).toBe(false);
    const second = await parse(request('POST', api('/scan'), { startAt: 1, previousId: first.id }));
    expect(second.rows.map((r: { key: string }) => r.key).sort()).toEqual(['TEST-2', 'TEST-3']); expect(second.nextStartAt).toBeNull(); expect(writes).toEqual([]);
  });
  it('supports ignoring and restoring candidates without any remote write', async () => {
    await parse(request('PUT', api('/ignored'), { key: 'TEST-2', ignored: true }));
    expect((await parse(request('POST', api('/scan'), {}))).rows.find((r: { key: string }) => r.key === 'TEST-2').ignored).toBe(true);
    await parse(request('PUT', api('/ignored'), { key: 'TEST-2', ignored: false }));
    expect((await parse(request('POST', api('/scan'), {}))).rows.find((r: { key: string }) => r.key === 'TEST-2').ignored).toBe(false); expect(writes).toEqual([]);
  });
  it('blocks another preview while the same requirement has an uncertain write', async () => {
    await bind(); const first = await preview(), second = await preview(); timeout = true;
    await parse(request('POST', api('/operations/' + first.id + '/execute')));
    expect((await request('POST', api('/operations/' + second.id + '/execute'))).statusCode).toBe(409); expect(writes).toHaveLength(1);
  });
  it('rejects expired previews and legacy write endpoints', async () => {
    await bind(); const p = await preview(); context.sqlite.prepare("UPDATE jira_operations SET created_at='2020-01-01T00:00:00Z' WHERE id=?").run(p.id);
    expect((await request('POST', api('/operations/' + p.id + '/execute'))).statusCode).toBe(409);
    expect((await request('POST', api('/sync-preview'), { items: [{ requirementId, target: { id: 'cancelled', name: '取消' }, reason: '人工取消' }] })).statusCode).toBe(410); expect(writes).toEqual([]);
  });
  it('invalidates the connection when Jira rejects the token', async () => {
    vi.mocked(fetch).mockResolvedValue(json({}, 401));
    await request('POST', api('/scan'), {});
    expect((await parse(request('GET', '/api/me/jira-connection'))).verifiedAt).toBeNull(); expect(writes).toEqual([]);
  });
  it('configuration changes and disabled integrations cannot write remotely', async () => {
    await bind(); const p = await preview(); context.config.jiraEnabled = false;
    expect((await request('POST', api('/operations/' + p.id + '/execute'))).statusCode).toBe(409); expect(writes).toEqual([]);
  });
  it('restoring a database requires revalidation and invalidates prior previews', async () => {
    context.sqlite.prepare("UPDATE requirements SET status='not_started',progress=0,actual_start=NULL,actual_end=NULL").run();
    const original = await parse(request('GET', '/api/me/jira-connection'));
    const backup = await runWithDatabase(context, () => createBackup({ cleanup: false }));
    const restored = await runWithDatabase(context, () => prepareRestore(backup.name));
    const copy = new Database(restored.source, { readonly: true });
    try { const c = copy.prepare('SELECT verified_at,version FROM jira_connections').get() as { verified_at: string | null; version: string }; expect(c.verified_at).toBeNull(); expect(c.version).not.toBe(original.version); }
    finally { copy.close(); }
    expect((await parse(request('GET', '/api/me/jira-connection'))).verifiedAt).toBeTruthy(); expect(writes).toEqual([]);
  });
  it('saves over production HTTP without a manually configured key and keeps the connection after restart', async () => {
    await parse(request('DELETE', '/api/me/jira-connection'));
    context.config.jiraEncryptionKey = '';
    context.config.nodeEnv = 'production';
    vi.mocked(fetch).mockClear();
    expect(await parse(request('GET', '/api/me/jira-connection'))).toMatchObject({ setupIssue: null, configured: false, available: true });
    expect(fetch).not.toHaveBeenCalled();
    const saved = await parse(request('PUT', '/api/me/jira-connection', { token: 'personal-test-token' }));
    expect(saved).toMatchObject({ setupIssue: null, configured: true, available: true, identity: 'Tester (tester)' });
    expect(saved.verifiedAt).toBeTruthy();
    expect(JSON.stringify(saved)).not.toContain('personal-test-token');
    const encrypted = context.sqlite.prepare('SELECT encrypted_token FROM jira_connections').get() as { encrypted_token: string };
    expect(encrypted.encrypted_token).not.toContain('personal-test-token');
    expect(encrypted.encrypted_token.split('.')).toHaveLength(3);
    const keyFile = `${context.config.dbPath}.jira-key`, originalKey = fs.readFileSync(keyFile, 'utf8');
    const settings = { ...context.config };
    await app.close(); context.close();
    context = await openDatabase(settings); app = await buildApp(undefined, context); await app.ready();
    expect(await parse(request('GET', '/api/me/jira-connection'))).toEqual(saved);
    expect(await parse(request('POST', '/api/me/jira-connection/test', {}))).toMatchObject({ available: true, identity: saved.identity });
    expect(fs.readFileSync(keyFile, 'utf8')).toBe(originalKey);
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
    expect(writes).toEqual([]);
  });
  it('reports invalid explicit key configuration without exposing internals', async () => {
    context.config.jiraEncryptionKey = 'invalid';
    vi.mocked(fetch).mockClear();
    const status = await parse(request('GET', '/api/me/jira-connection'));
    expect(status).toMatchObject({ setupIssue: 'deployment', problem: jiraSetupMessages.deployment });
    expect(JSON.stringify(status)).not.toMatch(/HTTPS|AES|加密密钥|JIRA_ENCRYPTION_KEY/);
    expect(fetch).not.toHaveBeenCalled();
    const failed = await request('PUT', '/api/me/jira-connection', { token: 'test' });
    expect(failed.json()).toMatchObject({ code: 'JIRA_KEY_UNAVAILABLE', error: jiraSetupMessages.deployment });
  });
  it('allows save, replace, test and remove over production HTTP from a LAN address', async () => {
    context.config.nodeEnv = 'production';
    const status = await request('GET', '/api/me/jira-connection');
    expect(status.json()).toMatchObject({ setupIssue: null, configured: true, available: true });
    expect(status.headers['cache-control']).toBe('private, no-store');
    const saved = await app.inject({ method: 'PUT', url: '/api/me/jira-connection', remoteAddress: '192.168.1.20', headers: { cookie }, payload: { token: 'second-test-token' } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ setupIssue: null, available: true, identity: 'Second (second)' });
    expect(saved.json().version).not.toBe(status.json().version);
    expect(await parse(request('POST', '/api/me/jira-connection/test', {}))).toMatchObject({ setupIssue: null, available: true, identity: 'Second (second)' });
    expect(await parse(request('DELETE', '/api/me/jira-connection'))).toMatchObject({ setupIssue: null, configured: false });
    expect(writes).toEqual([]);
  });
  it('still rejects unauthenticated HTTP submissions and respects explicit integration disabling', async () => {
    vi.mocked(fetch).mockClear();
    const unauthorized = await app.inject({ method: 'PUT', url: '/api/me/jira-connection', payload: { token: 'personal-test-token' } });
    expect(unauthorized.statusCode).toBe(401);
    context.config.jiraEnabled = false;
    expect(await parse(request('GET', '/api/me/jira-connection'))).toMatchObject({ setupIssue: 'disabled', available: false });
    expect((await request('PUT', '/api/me/jira-connection', { token: 'personal-test-token' })).statusCode).not.toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('returns actionable validation failures without forwarding remote status codes or response bodies', async () => {
    vi.mocked(fetch).mockResolvedValue(json({ error: 'internal diagnostic details' }, 500));
    let result = await request('PUT', '/api/me/jira-connection', { token: 'new-token' });
    expect(result.json().error).toBe(jiraConnectionMessages.unavailable);
    vi.mocked(fetch).mockResolvedValue(json({}, 401));
    result = await request('PUT', '/api/me/jira-connection', { token: 'bad-token' });
    expect(result.json()).toMatchObject({ code: 'JIRA_AUTH_FAILED', error: jiraConnectionMessages.invalidToken });
    expect(writes).toEqual([]);
  });
  it('rejects operation by a user without project management permission', async () => {
    context.sqlite.prepare("UPDATE accounts SET global_role='user' WHERE id='second'").run();
    try { await connect(secondCookie, 'second-test-token'); expect((await request('POST', api('/scan'), {}, secondCookie)).statusCode).toBe(403); }
    finally { context.sqlite.prepare("UPDATE accounts SET global_role='admin' WHERE id='second'").run(); }
  });
});
