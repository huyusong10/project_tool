import {listenTestApp} from './support/listen';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scryptSync } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-manage-archive-generation-'));
const password = 'temporary-archive-generation-password-123';
process.env.DB_PATH = path.join(directory, 'test.db');
process.env.BACKUP_DIR = path.join(directory, 'backups');
process.env.WEB_DIST_DIR = path.join(directory, 'web');
process.env.SEED_DEMO = '0';
process.env.NODE_ENV = 'test';
process.env.APP_PASSWORD_HASH = `scrypt$archivegeneration$${scryptSync(password, 'archivegeneration', 64).toString('hex')}`;
process.env.SESSION_SECRET = 'archive-generation-test-secret-with-more-than-thirty-two-characters';

let app: FastifyInstance;
let cookie = '';
let token = '';
let origin = '';
let sequence = 0;
const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, headers: { cookie }, payload });

it('历史验收人引用阻止永久删除并返回可读冲突，资料不变', async () => {
  const project = (await post('/api/projects', { name: `旧验收资料${++sequence}` })).json();
  const person = (await post('/api/people', { projectId: project.id, name: `旧验收人${++sequence}` })).json();
  const requirement = (await post('/api/requirements', { projectId: project.id, title: '迁移保留的验收资料' })).json();
  const { sqlite } = await import('./support/database');
  // The current API cannot assign this retired field; migration deliberately preserves its existing value.
  sqlite.prepare('UPDATE requirements SET acceptance_owner_id=? WHERE id=?').run(person.id, requirement.id);
  expect((await app.inject({ method: 'DELETE', url: '/api/people/' + person.id, headers: { cookie }, payload: { expectedUpdatedAt: person.updatedAt } })).statusCode).toBe(200);
  const archived = await archivedPerson(person.id);
  const facts = () => ({ person: sqlite.prepare('SELECT id,active,deleted_at,updated_at FROM people WHERE id=?').get(person.id),
    account: sqlite.prepare('SELECT id,status,deleted_at,updated_at FROM accounts WHERE person_id=?').get(person.id),
    reference: sqlite.prepare('SELECT acceptance_owner_id FROM requirements WHERE id=?').get(requirement.id),
    audit: sqlite.prepare('SELECT COUNT(*) AS count FROM audit_logs').get() });
  const before = facts();
  const result = await permanentlyDelete('REST', person.id, archived.deletedAt);
  expect(result.statusCode).toBe(409);
  expect(result.body).toMatchObject({ code: 'DEPENDENCY_CONFLICT', error: '该人员仍被1条历史业务记录引用，只能保留归档' });
  expect(facts()).toEqual(before);
  expect(sqlite.pragma('foreign_key_check')).toEqual([]);
});

async function archivedPerson(id: string) {
  const response = await app.inject({ method: 'GET', url: '/api/archives', headers: { cookie } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().people.find((item: { id: string }) => item.id === id) as { id: string; deletedAt: string };
}

async function permanentlyDelete(protocol: 'REST' | 'MCP', id: string, expectedDeletedAt: string) {
  if (protocol === 'REST') {
    const response = await app.inject({ method: 'DELETE', url: `/api/archives/people/${id}`, headers: { cookie }, payload: { expectedDeletedAt } });
    return { statusCode: response.statusCode, body: response.json() };
  }
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
    name: 'permanently_delete_archive', arguments: { entity: 'people', id, expectedDeletedAt },
  } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number; result: unknown } } };
  return { statusCode: payload.result.structuredContent.statusCode || 200, body: payload.result.structuredContent.result };
}

async function restorePerson(protocol: 'REST' | 'MCP', id: string, expectedDeletedAt: string) {
  if (protocol === 'REST') {
    const response = await post(`/api/people/${id}/restore`, { expectedDeletedAt });
    return { statusCode: response.statusCode, body: response.json() };
  }
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
    name: 'restore_person', arguments: { id, expectedDeletedAt },
  } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number; result?: unknown; error?: unknown } } };
  const content = payload.result.structuredContent;
  return { statusCode: content.statusCode || 200, body: content.result ?? content.error };
}

beforeAll(async () => {
  app = await (await import('../src/server/app')).buildApp();
  origin = await listenTestApp(app);
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password } });
  expect(login.statusCode, login.body).toBe(200);
  cookie = String(login.headers['set-cookie']).split(';')[0];
  token = (await post('/api/tokens', { name: '归档代际验证' })).json().token;
});

afterAll(async () => {
  await app?.close();
  const { sqlite } = await import('./support/database');
  if (sqlite.open) sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

for (const protocol of ['REST', 'MCP'] as const) {
  it(`${protocol}旧归档确认不能删除恢复后重新归档的同一对象`, async () => {
    const person = await post('/api/people', { name: `归档代际成员${++sequence}` });
    expect(person.statusCode, person.body).toBe(200);
    const id = person.json().id as string;
    expect((await app.inject({ method: 'DELETE', url: `/api/people/${id}`, headers: { cookie } })).statusCode).toBe(200);
    const first = await archivedPerson(id);
    expect((await restorePerson(protocol, id, first.deletedAt)).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/people/${id}`, headers: { cookie } })).statusCode).toBe(200);
    const second = await archivedPerson(id);
    expect(second.deletedAt).not.toBe(first.deletedAt);

    expect((await restorePerson(protocol, id, first.deletedAt)).statusCode).toBe(409);
    expect(await archivedPerson(id)).toMatchObject({ id, deletedAt: second.deletedAt });
    expect((await restorePerson(protocol, id, second.deletedAt)).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/people/${id}`, headers: { cookie } })).statusCode).toBe(200);
    const third = await archivedPerson(id);
    expect(third.deletedAt).not.toBe(second.deletedAt);

    const stale = await permanentlyDelete(protocol, id, first.deletedAt);
    expect(stale.statusCode).toBe(409);
    expect(await archivedPerson(id)).toMatchObject({ id, deletedAt: third.deletedAt });
    expect(await permanentlyDelete(protocol, id, third.deletedAt)).toEqual({ statusCode: 200, body: { ok: true } });
  });
}

it('永久删除在取得写锁后复核归档代次和历史引用', async () => {
  const { sqlite } = await import('./support/database');
  const project = (await post('/api/projects', { name: `永久删除竞争项目${++sequence}` })).json();
  expect((await app.inject({ method: 'DELETE', url: `/api/projects/${project.id}`, headers: { cookie }, payload: {
    expectedUpdatedAt: project.updatedAt,
  } })).statusCode).toBe(200);
  const projectArchive = (await app.inject({ method: 'GET', url: '/api/archives', headers: { cookie } })).json().projects
    .find((item: { id: string }) => item.id === project.id) as { id: string; title: string; deletedAt: string };
  sqlite.exec(`CREATE TEMP TRIGGER restore_project_during_permanent_delete BEFORE UPDATE OF updated_at ON projects
    WHEN OLD.id='${project.id}' BEGIN
      UPDATE projects SET deleted_at=NULL WHERE id=OLD.id;
    END`);
  const projectDelete = await app.inject({ method: 'DELETE', url: `/api/archives/projects/${project.id}`, headers: { cookie }, payload: {
    confirmName: projectArchive.title, expectedDeletedAt: projectArchive.deletedAt,
  } });
  expect(projectDelete.statusCode).toBe(409);
  expect(projectDelete.json()).toMatchObject({ code: 'STALE_WRITE' });
  expect(sqlite.prepare('SELECT deleted_at AS deletedAt FROM projects WHERE id=?').get(project.id)).toEqual({ deletedAt: projectArchive.deletedAt });
  sqlite.exec('DROP TRIGGER restore_project_during_permanent_delete');

  const ownerProject = (await post('/api/projects', { name: `永久删除引用项目${++sequence}` })).json();
  const person = (await post('/api/people', { projectId: ownerProject.id, name: `永久删除竞争人员${++sequence}` })).json();
  expect((await app.inject({ method: 'DELETE', url: `/api/people/${person.id}`, headers: { cookie }, payload: {
    expectedUpdatedAt: person.updatedAt,
  } })).statusCode).toBe(200);
  const personArchive = await archivedPerson(person.id);
  sqlite.exec(`CREATE TEMP TRIGGER add_reference_during_person_delete BEFORE UPDATE OF updated_at ON people
    WHEN OLD.id='${person.id}' BEGIN
      INSERT INTO issues (id, project_id, title, owner_id, status, priority, progress, discovered_at, created_at, updated_at)
      VALUES ('person-delete-race-issue', '${ownerProject.id}', '并发历史引用', OLD.id, 'in_progress', 'P2', 0, '2020-01-02', OLD.updated_at, OLD.updated_at);
    END`);
  const personDelete = await permanentlyDelete('REST', person.id, personArchive.deletedAt);
  expect(personDelete.statusCode).toBe(409);
  expect(personDelete.body).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare('SELECT deleted_at AS deletedAt FROM people WHERE id=?').get(person.id)).toEqual({ deletedAt: personArchive.deletedAt });
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM issues WHERE id='person-delete-race-issue'").get()).toEqual({ count: 0 });
  sqlite.exec('DROP TRIGGER add_reference_during_person_delete');
});
