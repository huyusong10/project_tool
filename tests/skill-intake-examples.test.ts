import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, scryptSync } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Requirement, WorkItem } from '../src/client/types';
import { intakePackageSchema, type ImportPreview, type ImportReceipt, type IntakeCatalog } from '../src/shared/intake';
import { mcpRequest } from './mcp-request';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-skill-examples-'));
const password = randomUUID();
Object.assign(process.env, { DB_PATH: path.join(directory, 'test.db'), BACKUP_DIR: path.join(directory, 'backups'),
  WEB_DIST_DIR: path.join(directory, 'web'), SEED_DEMO: '0', NODE_ENV: 'test',
  APP_PASSWORD_HASH: `scrypt$skill$${scryptSync(password, 'skill', 64).toString('hex')}`, SESSION_SECRET: randomUUID() + randomUUID() });
let app: FastifyInstance, origin: string, token: string;
type Page<T> = { items: T[]; total: number; snapshot?: number };
async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await mcpRequest(origin, token, name, args);
  expect(response.statusCode, response.body).toBe(200);
  const result = JSON.parse(response.body).result;
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  return result.structuredContent.result;
}
beforeAll(async () => {
  app = await (await import('../src/server/app')).buildApp();
  origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password } });
  expect(login.statusCode).toBe(200);
  const cookie = String(login.headers['set-cookie']).split(';')[0];
  const response = await app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie }, payload: { name: 'Skill examples' } });
  expect(response.statusCode).toBe(200); token = response.json().token;
});
afterAll(async () => {
  await app?.close();
  const { sqlite } = await import('../src/server/database');
  if (sqlite.open) sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

it.each(['log', 'org'])('%s 案例可经 MCP 预览和导入，并用新查询核对范围与安排缺口', async name => {
  const pkg = intakePackageSchema.parse(JSON.parse(fs.readFileSync(new URL(`../skills/project-manage-intake/assets/${name}-intake.json`, import.meta.url), 'utf8')));
  const { id: projectId } = await call<{ id: string }>('create_project', { name: `Skill ${name}` });
  const before = await call<IntakeCatalog>('get_requirement_intake', { projectId });
  const preview = await call<ImportPreview>('preview_requirement_import', { projectId, package: pkg });
  expect(preview.errors).toEqual([]);
  expect(await call('get_requirement_intake', { projectId })).toEqual(before);
  expect((await call<Page<Requirement>>('query_requirements', { projectId })).total).toBe(0);
  const input = { projectId, package: preview.package, expectedRevision: preview.expectedRevision, previewToken: preview.previewToken, batchId: randomUUID() };
  const receipt = await call<ImportReceipt>('apply_requirement_import', input);
  expect(receipt.status).toBe('applied');
  expect(await call('apply_requirement_import', input)).toEqual(receipt);
  expect(await call('get_requirement_import_receipt', { projectId, batchId: input.batchId })).toEqual(receipt);

  const requirements = await call<Page<Requirement>>('query_requirements', { projectId, deliveryScope: 'candidate', includeWorkItems: true, pageSize: 100 });
  expect(requirements.total).toBe(pkg.requirements.length);
  const expectedWorks = pkg.requirements.reduce((count, r) => count + r.workItems.length, 0);
  const works = await call<Page<WorkItem>>('list_work_items', { projectId, active: true, unassigned: true, pageSize: 100 });
  expect(works.total).toBe(expectedWorks);
  for (const requirement of requirements.items) {
    expect(requirement.executionMode).toBe(requirement.workItems.length ? 'work_items' : 'direct');
    for (const entity of [requirement, ...requirement.workItems]) {
      expect(entity.ownerId).toBeNull(); expect(entity.plannedStart).toBeNull(); expect(entity.plannedEnd).toBeNull();
    }
  }
  const catalog = await call<IntakeCatalog>('list_requirement_sources', { projectId });
  expect(catalog.documents).toHaveLength(pkg.documents.length);
  expect(catalog.documents.flatMap(d => d.clauses).flatMap(c => c.links)).toHaveLength(pkg.links.length);
  for (const document of catalog.documents) {
    const original = pkg.documents.find(d => d.key === document.key)!;
    expect(document.version).toBe(original.version); expect(document.complete).toBe(false);
    expect(document.clauses).toHaveLength(original.clauses.length);
    for (const clause of document.clauses) {
      const originalClause = original.clauses.find(c => c.key === clause.key)!;
      expect(clause.current.content).toBe(originalClause.content); expect(clause.current.externalId).toBe(originalClause.externalId);
      expect(clause.deferredReason).toBe(originalClause.deferredReason ?? '');
    }
  }
  expect(await call('get_work_item', { id: works.items[0].id })).toMatchObject(works.items[0]);
  const direct = requirements.items.find(r => r.executionMode === 'direct')!;
  expect(await call('get_requirement_start_conditions', { id: direct.id })).toBeDefined();
  const history = await call<Page<unknown>>('list_progress_updates', { projectId, pageSize: 1 });
  expect(typeof history.snapshot).toBe('number');
  expect(await call('get_project_change_version', { projectId })).toHaveProperty('version');
  const graph = await call<{ svg: string; omittedNodes: number }>('get_path_graph', { projectId, format: 'svg' });
  expect(graph.svg).toContain('<svg'); expect(graph.omittedNodes).toBe(0);
});
