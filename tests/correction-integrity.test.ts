import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scryptSync } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { RequirementRecord, WorkItemRecord } from '../src/server/services/requirements';
import type { IssueRecord } from '../src/server/services/issues';
import { addCalendarDays, todayIso } from '../src/shared/domain';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-manage-correction-integrity-'));
const password = 'temporary-correction-integrity-password-123';
process.env.DB_PATH = path.join(directory, 'test.db');
process.env.BACKUP_DIR = path.join(directory, 'backups');
process.env.WEB_DIST_DIR = path.join(directory, 'web');
process.env.SEED_DEMO = '0';
process.env.NODE_ENV = 'test';
process.env.APP_PASSWORD_HASH = `scrypt$correction-integrity$${scryptSync(password, 'correction-integrity', 64).toString('hex')}`;
process.env.SESSION_SECRET = 'correction-integrity-temporary-test-secret-123456789';
let app: FastifyInstance;
let cookie = '';
let token = '';
let origin = '';
let sequence = 0;
let scope: { projectId: string; personId: string; templateId: string };
const today = todayIso();
const tomorrow = addCalendarDays(today, 1);
const yesterday = addCalendarDays(today, -1);
type Detail = RequirementRecord & { progressUpdates: Array<{ id: string; workItemId: string | null; content: string; eventType: string; supersedesId: string | null }> };
const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, headers: { cookie }, payload });
const detail = async (id: string) => (await app.inject({ url: `/api/requirements/${id}`, headers: { cookie } })).json<Detail>();
const issueDetail = async (id: string) => (await app.inject({ url: `/api/issues/${id}`, headers: { cookie } })).json<IssueRecord>();

async function command(protocol: 'REST' | 'MCP', source: 'requirement' | 'work_item' | 'issue', id: string, action: string, input: Record<string, unknown>) {
  if (protocol === 'REST') {
    const segment = source === 'work_item' ? 'work-items' : source === 'requirement' ? 'requirements' : 'issues';
    const response = action === 'delete' && source === 'work_item'
      ? await app.inject({ method: 'DELETE', url: `/api/${segment}/${id}`, headers: { cookie }, payload: input })
      : await post(`/api/${segment}/${id}/${action}`, input);
    return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
  }
  const tool = action === 'complete-as-planned' ? `complete_${source}_as_planned` : `${action}_${source}`;
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: { id, ...input } } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number; result?: Record<string, unknown> } & Record<string, unknown> } };
  const content = payload.result.structuredContent;
  return { statusCode: content.statusCode || 200, body: content.result || content };
}

async function addUpdate(protocol: 'REST' | 'MCP', source: 'requirement' | 'issue', id: string, input: Record<string, unknown>) {
  if (protocol === 'REST') {
    const response = await post(source === 'requirement' ? `/api/requirements/${id}/progress` : `/api/issues/${id}/updates`, input);
    return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
  }
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
    name: source === 'requirement' ? 'add_progress' : 'add_issue_update',
    arguments: { [source === 'requirement' ? 'requirementId' : 'id']: id, ...input },
  } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number; result?: Record<string, unknown> } & Record<string, unknown> } };
  const content = payload.result.structuredContent;
  return { statusCode: content.statusCode || 200, body: content.result || content };
}

async function updateRequirementCommand(protocol: 'REST' | 'MCP', id: string, input: Record<string, unknown>) {
  if (protocol === 'REST') {
    const response = await app.inject({ method: 'PATCH', url: `/api/requirements/${id}`, headers: { cookie }, payload: input });
    return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
  }
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'update_requirement', arguments: { id, ...input } } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number; result?: Record<string, unknown> } & Record<string, unknown> } };
  const content = payload.result.structuredContent;
  return { statusCode: content.statusCode || 200, body: content.result || content };
}

async function updateWorkItemCommand(protocol: 'REST' | 'MCP', id: string, input: Record<string, unknown>) {
  if (protocol === 'REST') {
    const response = await app.inject({ method: 'PATCH', url: `/api/work-items/${id}`, headers: { cookie }, payload: input });
    return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
  }
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'update_work_item', arguments: { id, ...input } } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number; result?: Record<string, unknown> } & Record<string, unknown> } };
  const content = payload.result.structuredContent;
  return { statusCode: content.statusCode || 200, body: content.result || content };
}

async function updateIssueCommand(protocol: 'REST' | 'MCP', id: string, input: Record<string, unknown>) {
  if (protocol === 'REST') {
    const response = await app.inject({ method: 'PATCH', url: `/api/issues/${id}`, headers: { cookie }, payload: input });
    return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
  }
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'update_issue', arguments: { id, ...input } } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number; result?: Record<string, unknown> } & Record<string, unknown> } };
  const content = payload.result.structuredContent;
  return { statusCode: content.statusCode || 200, body: content.result || content };
}

async function reorderCommand(protocol: 'REST' | 'MCP', requirementId: string, input: Record<string, unknown>) {
  if (protocol === 'REST') {
    const response = await post(`/api/requirements/${requirementId}/reorder-work-items`, input);
    return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
  }
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'reorder_work_items', arguments: { requirementId, ...input } } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number; result?: Record<string, unknown> } & Record<string, unknown> } };
  const content = payload.result.structuredContent;
  return { statusCode: content.statusCode || 200, body: content.result || content };
}

async function templateCommand(protocol: 'REST' | 'MCP', action: 'reselect' | 'apply', requirementId: string, input: Record<string, unknown>) {
  if (protocol === 'REST') {
    const endpoint = action === 'reselect' ? 'reselect-template' : 'apply-template';
    const response = await post(`/api/requirements/${requirementId}/${endpoint}`, input);
    return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
  }
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
    name: action === 'reselect' ? 'reselect_requirement_template' : 'apply_template',
    arguments: { [action === 'reselect' ? 'id' : 'requirementId']: requirementId, ...input },
  } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number; result?: Record<string, unknown> } & Record<string, unknown> } };
  const content = payload.result.structuredContent;
  return { statusCode: content.statusCode || 200, body: content.result || content };
}

async function createCommand(protocol: 'REST' | 'MCP', source: 'requirement' | 'work_item' | 'issue', input: Record<string, unknown>, requirementId?: string) {
  if (protocol === 'REST') {
    const endpoint = source === 'requirement' ? '/api/requirements'
      : source === 'issue' ? '/api/issues' : `/api/requirements/${requirementId}/work-items`;
    const response = await post(endpoint, input);
    return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
  }
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
    name: `create_${source}`, arguments: source === 'work_item' ? { requirementId, ...input } : input,
  } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number; result?: Record<string, unknown> } & Record<string, unknown> } };
  const content = payload.result.structuredContent;
  return { statusCode: content.statusCode || 200, body: content.result || content };
}

async function creationCounts() {
  const { sqlite } = await import('../src/server/database');
  const count = (table: string) => (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
  return { requirements: count('requirements'), workItems: count('work_items'), issues: count('issues'), auditLogs: count('audit_logs') };
}

async function createAdminCommand(protocol: 'REST' | 'MCP', source: 'project' | 'person' | 'template', input: Record<string, unknown>) {
  if (protocol === 'REST') {
    const response = await post(`/api/${source === 'person' ? 'people' : `${source}s`}`, input);
    return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
  }
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: `create_${source}`, arguments: input } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number; result?: Record<string, unknown> } & Record<string, unknown> } };
  const content = payload.result.structuredContent;
  return { statusCode: content.statusCode || 200, body: content.result || content };
}

async function copyTemplateCommand(protocol: 'REST' | 'MCP', input: Record<string, unknown>) {
  if (protocol === 'REST') {
    const response = await post(`/api/projects/${scope.projectId}/templates/${scope.templateId}/copy`, input);
    return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
  }
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
    name: 'copy_template', arguments: { projectId: scope.projectId, sourceTemplateId: scope.templateId, ...input },
  } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number; result?: Record<string, unknown> } & Record<string, unknown> } };
  const content = payload.result.structuredContent;
  return { statusCode: content.statusCode || 200, body: content.result || content };
}

async function administrationCounts() {
  const { sqlite } = await import('../src/server/database');
  const count = (table: string) => (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
  return {
    projects: count('projects'), people: count('people'), accounts: count('accounts'), projectPeople: count('project_people'),
    templates: count('work_item_templates'), templateItems: count('template_items'), auditLogs: count('audit_logs'),
  };
}

async function updateAdminCommand(protocol: 'REST' | 'MCP', source: 'project' | 'person' | 'template', id: string, input: Record<string, unknown>) {
  if (protocol === 'REST') {
    const response = await app.inject({ method: 'PATCH', url: `/api/${source === 'person' ? 'people' : `${source}s`}/${id}`, headers: { cookie }, payload: input });
    return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
  }
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: `update_${source}`, arguments: { id, ...input } } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number; result?: Record<string, unknown> } & Record<string, unknown> } };
  const content = payload.result.structuredContent;
  return { statusCode: content.statusCode || 200, body: content.result || content };
}

async function memberCommand(protocol: 'REST' | 'MCP', action: 'set' | 'remove', personId: string, input: Record<string, unknown>) {
  if (protocol === 'REST') {
    const response = await app.inject({
      method: action === 'set' ? 'PUT' : 'DELETE', url: `/api/projects/${scope.projectId}/members/${personId}`,
      headers: { cookie }, payload: input,
    });
    return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
  }
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
    name: action === 'set' ? 'set_project_member_role' : 'remove_project_person',
    arguments: { projectId: scope.projectId, personId, ...input },
  } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number; result?: Record<string, unknown> } & Record<string, unknown> } };
  const content = payload.result.structuredContent;
  return { statusCode: content.statusCode || 200, body: content.result || content };
}

async function archiveAdminCommand(protocol: 'REST' | 'MCP', source: 'project' | 'person' | 'template', id: string, input: Record<string, unknown>) {
  if (protocol === 'REST') {
    const response = await app.inject({
      method: 'DELETE', url: `/api/${source === 'person' ? 'people' : `${source}s`}/${id}`,
      headers: { cookie }, payload: input,
    });
    return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
  }
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
    name: `archive_${source}`, arguments: { id, ...input },
  } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number; result?: Record<string, unknown> } & Record<string, unknown> } };
  const content = payload.result.structuredContent;
  return { statusCode: content.statusCode || 200, body: content.result || content };
}

async function restoreProjectCommand(protocol: 'REST' | 'MCP', id: string, input: Record<string, unknown>) {
  if (protocol === 'REST') {
    const response = await post(`/api/projects/${id}/restore`, input);
    return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
  }
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
    name: 'restore_project', arguments: { id, ...input },
  } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number; result?: Record<string, unknown> } & Record<string, unknown> } };
  const content = payload.result.structuredContent;
  return { statusCode: content.statusCode || 200, body: content.result || content };
}

async function permanentlyDeleteProjectCommand(protocol: 'REST' | 'MCP', id: string, input: Record<string, unknown>) {
  if (protocol === 'REST') {
    const response = await app.inject({ method: 'DELETE', url: `/api/archives/projects/${id}`, headers: { cookie }, payload: input });
    return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
  }
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
    name: 'permanently_delete_archive', arguments: { entity: 'projects', id, ...input },
  } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number; result?: Record<string, unknown> } & Record<string, unknown> } };
  const content = payload.result.structuredContent;
  return { statusCode: content.statusCode || 200, body: content.result || content };
}

async function historyCommand(
  protocol: 'REST' | 'MCP', source: 'progress' | 'issue_update', action: 'update' | 'delete',
  id: string, parentId: string | null, input: Record<string, unknown>,
) {
  if (protocol === 'REST') {
    const url = source === 'progress' ? `/api/progress/${id}` : `/api/issues/${parentId}/updates/${id}`;
    const response = await app.inject({ method: action === 'update' ? 'PATCH' : 'DELETE', url, headers: { cookie }, payload: input });
    return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
  }
  const name = `${action}_${source}`;
  const args = source === 'progress' ? { id, ...input } : { id: parentId, updateId: id, ...input };
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { error?:{code:number};result?:{structuredContent:{statusCode?:number;result?:Record<string,unknown>}} };
  expect(payload.error?.code).toBe(-32602);
  return {statusCode:400,body:payload.error};
}

async function listRequirementsCommand(protocol: 'REST' | 'MCP', input: Record<string, string>) {
  if (protocol === 'REST') {
    const response = await app.inject({ url: `/api/requirements?${new URLSearchParams(input)}`, headers: { cookie } });
    return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
  }
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
    name: 'list_requirements', arguments: input,
  } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number; result?: Record<string, unknown> } & Record<string, unknown> } };
  const content = payload.result.structuredContent;
  return { statusCode: content.statusCode || 200, body: content.result || content };
}

async function listProjectMembersCommand(input: Record<string, unknown>) {
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
    name: 'list_project_members', arguments: input,
  } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number } } };
  return payload.result.structuredContent;
}

async function parameterlessMcpCommand(name: 'get_my_work' | 'get_analytics_catalog', input: Record<string, unknown>) {
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', connection: 'close',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: input } }) });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result: { structuredContent: { statusCode?: number } } };
  return payload.result.structuredContent;
}

async function adminSnapshots() {
  const projects = (await app.inject({ url: '/api/projects', headers: { cookie } })).json<Array<Record<string, unknown>>>();
  const people = (await app.inject({ url: `/api/people?projectId=${scope.projectId}`, headers: { cookie } })).json<Array<Record<string, unknown>>>();
  const templates = (await app.inject({ url: `/api/templates?projectId=${scope.projectId}`, headers: { cookie } })).json<Array<Record<string, unknown>>>();
  return {
    project: projects.find((item) => item.id === scope.projectId),
    person: people.find((item) => item.id === scope.personId),
    template: templates.find((item) => item.id === scope.templateId),
  };
}

async function createScope() {
  const projectId = (await post('/api/projects', { name: `纠错完整性${++sequence}` })).json().id as string;
  const personId = (await post('/api/people', { name: `纠错成员${sequence}`, projectId })).json().id as string;
  const templateId = (await post('/api/templates', { projectId, name: '并行步骤', items: [
    { title: '实现', startOffsetDays: 0, durationDays: 1, sortOrder: 0 },
    { title: '验证', startOffsetDays: 0, durationDays: 1, sortOrder: 1 },
  ] })).json().id as string;
  return { projectId, personId, templateId };
}

async function createWork(targetScope = scope) {
  const created = await post('/api/requirements', { projectId: targetScope.projectId, title: `纠错需求${++sequence}`, ownerId: targetScope.personId, templateId: targetScope.templateId, plannedStart: '2020-01-02' });
  expect(created.statusCode, created.body).toBe(200);
  const requirement = created.json<Detail>();
  const item = requirement.workItems![0];
  const assigned = await app.inject({ method: 'PATCH', url: `/api/work-items/${item.id}`, headers: { cookie }, payload: { expectedVersion: item.version, ownerId: targetScope.personId } });
  expect(assigned.statusCode, assigned.body).toBe(200);
  const started = await post(`/api/work-items/${item.id}/start`, { expectedVersion: assigned.json().version });
  expect(started.statusCode, started.body).toBe(200);
  return started.json<WorkItemRecord>();
}

async function createCompletedRequirement(targetScope = scope) {
  const created = await post('/api/requirements', {
    projectId: targetScope.projectId, title: `终态纠错需求${++sequence}`, ownerId: targetScope.personId,
    templateId: targetScope.templateId, plannedStart: '2020-01-02',
  });
  expect(created.statusCode, created.body).toBe(200);
  const requirement = created.json<Detail>();
  await post(`/api/requirements/${requirement.id}/progress`,{content:'历史原始说明'});
  const completed = await command('REST', 'requirement', requirement.id, 'complete-as-planned', { expectedVersion: requirement.version });
  expect(completed.statusCode, JSON.stringify(completed.body)).toBe(200);
  return detail(requirement.id);
}

async function createIssue(projectId = scope.projectId) {
  const response = await post('/api/issues', { projectId, title: `纠错问题${++sequence}` });
  expect(response.statusCode, response.body).toBe(200);
  const issue = response.json<IssueRecord>();
  const noted = await post(`/api/issues/${issue.id}/updates`, { content: '保留原始说明' });
  expect(noted.statusCode, noted.body).toBe(200);
  return issueDetail(issue.id);
}

beforeAll(async () => {
  app = await (await import('../src/server/app')).buildApp();
  origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password } });
  expect(login.statusCode, login.body).toBe(200);
  cookie = String(login.headers['set-cookie']).split(';')[0];
  token = (await post('/api/tokens', { name: '纠错完整性测试' })).json().token;
  scope = await createScope();
});

afterAll(async () => {
  await app?.close();
  const { sqlite } = await import('../src/server/database');
  if (sqlite.open) sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

it('旧取消工作项受控修正后保持原取消日期上限', async () => {
  const created = await post('/api/requirements', {
    projectId: scope.projectId, title: `旧取消记录${++sequence}`, ownerId: scope.personId,
    templateId: scope.templateId, plannedStart: '2020-01-02',
  });
  expect(created.statusCode, created.body).toBe(200);
  const requirement = created.json<Detail>();
  const item = requirement.workItems![0];
  const cancelled = await command('REST', 'work_item', item.id, 'cancel', {
    expectedVersion: item.version, reason: '模拟旧版取消',
  });
  expect(cancelled.statusCode, JSON.stringify(cancelled.body)).toBe(200);

  const { sqlite } = await import('../src/server/database');
  sqlite.prepare("DELETE FROM progress_updates WHERE work_item_id=? AND event_type='cancel'").run(item.id);
  sqlite.prepare("UPDATE audit_logs SET created_at=? WHERE entity_type='work_item' AND entity_id=? AND action='cancel'")
    .run('2020-01-05T08:00:00.000Z', item.id);
  sqlite.prepare('UPDATE work_items SET updated_at=? WHERE id=?').run('2020-01-05T08:00:00.000Z', item.id);
  const legacy = (await detail(requirement.id)).workItems!.find((entry) => entry.id === item.id)!;
  expect(legacy.cancelledAt).toBe('2020-01-05');

  const corrected = await command('REST', 'work_item', item.id, 'correct', {
    expectedVersion: legacy.version, actualStart: '2020-01-03', reason: '补录取消前的实际开始',
  });
  expect(corrected.statusCode, JSON.stringify(corrected.body)).toBe(200);
  expect(corrected.body).toMatchObject({ actualStart: '2020-01-03', cancelledAt: '2020-01-05' });
  expect(corrected.body.updatedAt).not.toBe(legacy.updatedAt);

  const rejected = await command('REST', 'work_item', item.id, 'correct', {
    expectedVersion: corrected.body.version, actualStart: '2020-01-06', reason: '不能越过原取消日期',
  });
  expect(rejected.statusCode, JSON.stringify(rejected.body)).toBe(400);
  expect(String(rejected.body.error)).toContain('不能晚于取消日期（2020-01-05）');
});

it('MCP 重开未开始的取消工作项时不静默丢弃非零进度', async () => {
  const created = await createCommand('MCP', 'requirement', {
    projectId: scope.projectId, title: `取消后重开${++sequence}`, ownerId: scope.personId,
    templateId: scope.templateId, plannedStart: '2020-01-02',
  });
  expect(created.statusCode, JSON.stringify(created.body)).toBe(200);
  const requirement = created.body as unknown as Detail;
  const item = requirement.workItems![0];
  const cancelled = await command('MCP', 'work_item', item.id, 'cancel', {
    expectedVersion: item.version, reason: '不再执行',
  });
  expect(cancelled.statusCode, JSON.stringify(cancelled.body)).toBe(200);
  const before = await detail(requirement.id);

  const rejected = await command('MCP', 'work_item', item.id, 'reopen', {
    expectedVersion: cancelled.body.version, reason: '恢复执行', progress: 40,
  });
  expect(rejected.statusCode, JSON.stringify(rejected.body)).toBe(400);
  expect(JSON.stringify(rejected.body)).toContain('只能按0%重开');
  expect(await detail(requirement.id)).toEqual(before);
});

for (const protocol of ['REST', 'MCP'] as const) {
  it(`${protocol}：终态需求纠错保留交付事实并追加关联记录`, async () => {
    const before = await createCompletedRequirement();
    const source = before.progressUpdates.find((entry) => !entry.workItemId && entry.eventType === 'note')!;
    const childEvent = before.progressUpdates.find((entry) => entry.workItemId)!;
    const rejected = await command(protocol, 'requirement', before.id, 'correct', {
      expectedVersion: before.version, title: `${before.title}（修正）`, reason: '引用范围校验', supersedesId: childEvent.id,
    });
    expect(rejected.statusCode, JSON.stringify(rejected.body)).toBe(400);
    expect(await detail(before.id)).toEqual(before);

    const corrected = await command(protocol, 'requirement', before.id, 'correct', {
      expectedVersion: before.version, title: `${before.title}（修正）`, background: '补录核对后的需求背景',
      reason: '历史标题与背景录入有误', supersedesId: source.id,
    });
    expect(corrected.statusCode, JSON.stringify(corrected.body)).toBe(200);
    const after = await detail(before.id);
    expect(after).toMatchObject({
      title: `${before.title}（修正）`, background: '补录核对后的需求背景', status: 'completed', progress: 100,
      acceptedAt: before.acceptedAt, plannedStart: before.plannedStart, plannedEnd: before.plannedEnd,
    });
    expect(after.workItems).toEqual(before.workItems);
    expect(after.progressUpdates).toEqual(expect.arrayContaining(before.progressUpdates));
    expect(after.progressUpdates).toContainEqual(expect.objectContaining({
      eventType: 'correction', content: '历史标题与背景录入有误', supersedesId: source.id, workItemId: null,
    }));
  });

  it.each(['in_progress', 'completed', 'cancelled'])(`${protocol}：%s工作项不能纠错为未来实际日期`, async (status) => {
    let item = await createWork();
    if (status !== 'in_progress') {
      const action = { blocked: 'block', completed: 'complete', cancelled: 'cancel' }[status]!;
      const response = await command(protocol, 'work_item', item.id, action, {
        expectedVersion: item.version, ...(action === 'complete' ? { content: '完成说明' } : { reason: '状态校验' }),
      });
      expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
      item = (await detail(item.requirementId)).workItems!.find((entry) => entry.id === item.id)!;
    }
    const before = await detail(item.requirementId);
    const dates = status === 'completed' ? [{ actualStart: tomorrow, actualEnd: tomorrow }, { actualStart: today, actualEnd: tomorrow }] : [{ actualStart: tomorrow }];
    for (const invalidDates of dates) {
      const rejected = await command(protocol, 'work_item', item.id, 'correct', { expectedVersion: item.version, reason: '实际日期校验', ...invalidDates });
      expect(rejected.statusCode, JSON.stringify(rejected.body)).toBe(400);
      expect(await detail(item.requirementId)).toEqual(before);
    }
    expect((await command(protocol, 'work_item', item.id, 'correct', { expectedVersion: item.version, reason: '按实际执行修正', actualStart: yesterday })).statusCode).toBe(200);
    expect((await detail(item.requirementId)).workItems!.find((entry) => entry.id === item.id)).toMatchObject({ actualStart: yesterday, status });
  });

  it.each(['complete', 'reopen'])(`${protocol}：%s拒绝历史未来实际开始，修正后可继续操作`, async (action) => {
    const item = await createWork();
    const { sqlite } = await import('../src/server/database');
    if (action === 'complete') sqlite.prepare('UPDATE work_items SET actual_start=? WHERE id=?').run(tomorrow, item.id);
    else sqlite.prepare("UPDATE work_items SET status='completed', progress=100, actual_start=?, actual_end=? WHERE id=?").run(tomorrow, tomorrow, item.id);
    const before = await detail(item.requirementId);
    const rejected = await command(protocol, 'work_item', item.id, action, { expectedVersion: item.version, reason: '重新推进', content: '完成' });
    expect(rejected.statusCode, JSON.stringify(rejected.body)).toBe(400);
    expect(await detail(item.requirementId)).toEqual(before);
    const corrected = await command(protocol, 'work_item', item.id, 'correct', { expectedVersion: item.version, reason: '修复历史实际日期', actualStart: yesterday, ...(action === 'reopen' ? { actualEnd: today } : {}) });
    expect(corrected.statusCode, JSON.stringify(corrected.body)).toBe(200);
    expect((await command(protocol, 'work_item', item.id, action, {
      expectedVersion: corrected.body.version, ...(action === 'complete' ? { content: '完成' } : { reason: '修复后继续' }),
    })).statusCode).toBe(200);
  });

  it(`${protocol}：工作项纠错只能引用自身历史，失败不更改状态、版本或历史`, async () => {
    const item = await createWork();
    let current = await detail(item.requirementId);
    const siblingId = current.workItems![1].id;
    expect((await post(`/api/requirements/${item.requirementId}/progress`, { workItemId: siblingId, content: '其他工作项说明' })).statusCode).toBe(200);
    current = await detail(item.requirementId);
    const foreignScope = await createScope();
    const other = await createWork(foreignScope);
    const otherDetail = await detail(other.requirementId);
    const foreignIssue = await createIssue(foreignScope.projectId);
    const ownHistory = current.progressUpdates.find((entry) => entry.workItemId === item.id)!;
    const badIds = ['missing-history', current.progressUpdates.find((entry) => entry.workItemId === siblingId)!.id, otherDetail.progressUpdates[0].id, foreignIssue.updates![0].id];
    for (const supersedesId of badIds) {
      const rejected = await command(protocol, 'work_item', item.id, 'correct', { expectedVersion: item.version, reason: '纠错引用', supersedesId });
      expect(rejected.statusCode, JSON.stringify(rejected.body)).toBe(400);
      expect(await detail(item.requirementId)).toEqual(current);
    }
    expect((await command(protocol, 'work_item', item.id, 'correct', { expectedVersion: item.version, reason: '更正原记录', supersedesId: ownHistory.id })).statusCode).toBe(200);
    const corrected = await detail(item.requirementId);
    expect(corrected.progressUpdates).toEqual(expect.arrayContaining(current.progressUpdates));
    expect(corrected.progressUpdates).toContainEqual(expect.objectContaining({ workItemId: item.id, supersedesId: ownHistory.id }));
    expect(await detail(other.requirementId)).toEqual(otherDetail);
  });

  it(`${protocol}：问题纠错只能引用自身历史，允许追加纠错而不覆盖原记录`, async () => {
    const issue = await createIssue();
    const other = await createIssue();
    const foreignScope = await createScope();
    const foreign = await createIssue(foreignScope.projectId);
    const work = await createWork();
    const workDetail = await detail(work.requirementId);
    for (const supersedesId of ['missing-history', other.updates![0].id, foreign.updates![0].id, workDetail.progressUpdates[0].id]) {
      const rejected = await command(protocol, 'issue', issue.id, 'correct', { expectedVersion: issue.version, reason: '纠错引用', supersedesId });
      expect(rejected.statusCode, JSON.stringify(rejected.body)).toBe(400);
      expect(await issueDetail(issue.id)).toEqual(issue);
    }
    expect((await command(protocol, 'issue', issue.id, 'correct', { expectedVersion: issue.version, reason: '补充更正说明', supersedesId: issue.updates![0].id })).statusCode).toBe(200);
    const corrected = await issueDetail(issue.id);
    expect(corrected.updates).toEqual(expect.arrayContaining(issue.updates!));
    expect(corrected.updates).toContainEqual(expect.objectContaining({ supersedesId: issue.updates![0].id, eventType: 'correction' }));
    expect(await issueDetail(other.id)).toEqual(other);
    expect(await issueDetail(foreign.id)).toEqual(foreign);
  });

  it(`${protocol}：受控纠错拒绝会被静默忽略的内容字段`, async () => {
    const item = await createWork();
    const beforeWork = await detail(item.requirementId);
    const workResult = await command(protocol, 'work_item', item.id, 'correct', {
      expectedVersion: item.version, reason: '核对无效字段', content: '这段内容不应被忽略',
    });
    expect(workResult.statusCode).toBe(400);
    expect(await detail(item.requirementId)).toEqual(beforeWork);

    const issue = await createIssue();
    const issueResult = await command(protocol, 'issue', issue.id, 'correct', {
      expectedVersion: issue.version, reason: '核对无效字段', content: '这段内容不应被忽略',
    });
    expect(issueResult.statusCode).toBe(400);
    expect(await issueDetail(issue.id)).toEqual(issue);
  });

  it(`${protocol}：受控纠错拒绝未知拼写字段`, async () => {
    const requirement = await createCompletedRequirement();
    expect((await command(protocol, 'requirement', requirement.id, 'correct', {
      expectedVersion: requirement.version, reason: '核对字段拼写', title: `${requirement.title}（修正）`, owner_id: scope.personId,
    })).statusCode).toBe(400);
    expect(await detail(requirement.id)).toEqual(requirement);

    const item = await createWork();
    const beforeWork = await detail(item.requirementId);
    expect((await command(protocol, 'work_item', item.id, 'correct', {
      expectedVersion: item.version, reason: '核对字段拼写', title: `${item.title}（修正）`, actual_start: yesterday,
    })).statusCode).toBe(400);
    expect(await detail(item.requirementId)).toEqual(beforeWork);

    const issue = await createIssue();
    expect((await command(protocol, 'issue', issue.id, 'correct', {
      expectedVersion: issue.version, reason: '核对字段拼写', title: `${issue.title}（修正）`, resolved_at: today,
    })).statusCode).toBe(400);
    expect(await issueDetail(issue.id)).toEqual(issue);
  });

  it(`${protocol}：受控纠错拒绝没有事实变化且未关联历史的空记录`, async () => {
    const requirement = await createCompletedRequirement();
    expect((await command(protocol, 'requirement', requirement.id, 'correct', {
      expectedVersion: requirement.version, reason: '没有实际变化',
    })).statusCode).toBe(400);
    expect(await detail(requirement.id)).toEqual(requirement);

    const item = await createWork();
    const beforeWork = await detail(item.requirementId);
    expect((await command(protocol, 'work_item', item.id, 'correct', {
      expectedVersion: item.version, reason: '没有实际变化',
    })).statusCode).toBe(400);
    expect(await detail(item.requirementId)).toEqual(beforeWork);

    const issue = await createIssue();
    expect((await command(protocol, 'issue', issue.id, 'correct', {
      expectedVersion: issue.version, reason: '没有实际变化',
    })).statusCode).toBe(400);
    expect(await issueDetail(issue.id)).toEqual(issue);
  });

  it(`${protocol}：工作项状态命令拒绝会被静默忽略的字段`, async () => {
    const item = await createWork();
    const before = await detail(item.requirementId);

    const completed = await command(protocol, 'work_item', item.id, 'complete', {
      expectedVersion: item.version, content: '完成说明', progress: 20,
    });
    expect(completed.statusCode).toBe(400);
    expect(await detail(item.requirementId)).toEqual(before);


  });

  it(`${protocol}：需求状态命令拒绝会被静默忽略的字段`, async () => {
    const created = await post('/api/requirements', { projectId: scope.projectId, title: `待取消需求${++sequence}` });
    expect(created.statusCode, created.body).toBe(200);
    const planning = await detail(created.json().id);
    const cancelled = await command(protocol, 'requirement', planning.id, 'cancel', {
      expectedVersion: planning.version, reason: '取消录入', content: '这段说明不应被忽略',
    });
    expect(cancelled.statusCode).toBe(400);
    expect(await detail(planning.id)).toEqual(planning);
  });

  it(`${protocol}：重开命令拒绝会被静默忽略的字段`, async () => {
    const item = await createWork();
    const completed = await command(protocol, 'work_item', item.id, 'complete', {
      expectedVersion: item.version, content: '正常完成',
    });
    expect(completed.statusCode, JSON.stringify(completed.body)).toBe(200);
    const beforeWork = await detail(item.requirementId);
    const reopenedWork = await command(protocol, 'work_item', item.id, 'reopen', {
      expectedVersion: completed.body.version, reason: '重新处理', content: '这段完成说明不应被忽略',
    });
    expect(reopenedWork.statusCode).toBe(400);
    expect(await detail(item.requirementId)).toEqual(beforeWork);

    const issue = await createIssue();
    const resolved = await command(protocol, 'issue', issue.id, 'resolve', {
      expectedVersion: issue.version, content: '确认解决',
    });
    expect(resolved.statusCode, JSON.stringify(resolved.body)).toBe(200);
    const beforeIssue = await issueDetail(issue.id);
    const reopenedIssue = await command(protocol, 'issue', issue.id, 'reopen', {
      expectedVersion: resolved.body.version, reason: '问题复现', title: '这段标题不应被忽略',
    });
    expect(reopenedIssue.statusCode).toBe(400);
    expect(await issueDetail(issue.id)).toEqual(beforeIssue);
  });

  it(`${protocol}：按期完成拒绝会被静默忽略的执行字段`, async () => {
    const created = await post('/api/requirements', {
      projectId: scope.projectId, title: `整单补录输入校验${++sequence}`, ownerId: scope.personId,
      templateId: scope.templateId, plannedStart: '2020-01-02',
    });
    expect(created.statusCode, created.body).toBe(200);
    const requirement = created.json<Detail>();
    const beforeRequirement = await detail(requirement.id);
    const whole = await command(protocol, 'requirement', requirement.id, 'complete-as-planned', {
      expectedVersion: requirement.version, actualEnd: '2020-01-03',
    });
    expect(whole.statusCode).toBe(400);
    expect(await detail(requirement.id)).toEqual(beforeRequirement);

    const itemCreated = await post('/api/requirements', {
      projectId: scope.projectId, title: `工作项补录输入校验${++sequence}`, ownerId: scope.personId,
      templateId: scope.templateId, plannedStart: '2020-01-02',
    });
    expect(itemCreated.statusCode, itemCreated.body).toBe(200);
    const itemRequirement = itemCreated.json<Detail>();
    const item = itemRequirement.workItems![0];
    const beforeItem = await detail(itemRequirement.id);
    const single = await command(protocol, 'work_item', item.id, 'complete-as-planned', {
      expectedVersion: item.version, progress: 50,
    });
    expect(single.statusCode).toBe(400);
    expect(await detail(itemRequirement.id)).toEqual(beforeItem);
  });

  it(`${protocol}：删除工作项拒绝会被静默忽略的字段`, async () => {
    const created = await post('/api/requirements', {
      projectId: scope.projectId, title: `安全删除输入校验${++sequence}`, ownerId: scope.personId,
      templateId: scope.templateId, plannedStart: '2020-01-02',
    });
    expect(created.statusCode, created.body).toBe(200);
    const requirement = created.json<Detail>();
    const item = requirement.workItems![0];
    const before = await detail(requirement.id);
    const removed = await command(protocol, 'work_item', item.id, 'delete', {
      expectedVersion: item.version, title: '这段标题不应被忽略',
    });
    expect(removed.statusCode).toBe(400);
    expect(await detail(requirement.id)).toEqual(before);
  });

  it(`${protocol}：进展命令拒绝拼错后会被静默忽略的完成度字段`, async () => {
    const item = await createWork();
    const beforeRequirement = await detail(item.requirementId);
    const progress = await addUpdate(protocol, 'requirement', item.requirementId, {
      content: '完成度字段拼错', workItemId: item.id, expectedVersion: item.version, progress: 30,
    });
    expect(progress.statusCode).toBe(400);
    expect(await detail(item.requirementId)).toEqual(beforeRequirement);

    const issue = await createIssue();
    const issueProgress = await addUpdate(protocol, 'issue', issue.id, {
      content: '完成度字段拼错', expectedVersion: issue.version, percent: 30,
    });
    expect(issueProgress.statusCode).toBe(400);
    expect(await issueDetail(issue.id)).toEqual(issue);
  });

  it(`${protocol}：普通需求编辑拒绝未知拼写字段`, async () => {
    const created = await post('/api/requirements', { projectId: scope.projectId, title: `编辑输入校验${++sequence}` });
    expect(created.statusCode, created.body).toBe(200);
    const requirement = await detail(created.json().id);
    const updated = await updateRequirementCommand(protocol, requirement.id, {
      expectedVersion: requirement.version, title: `${requirement.title}（修改）`, backgroud: '拼错的需求背景',
    });
    expect(updated.statusCode).toBe(400);
    expect(await detail(requirement.id)).toEqual(requirement);
  });

  it(`${protocol}：普通工作项编辑拒绝未知拼写字段`, async () => {
    const created = await post('/api/requirements', {
      projectId: scope.projectId, title: `工作项编辑输入校验${++sequence}`, ownerId: scope.personId,
      templateId: scope.templateId, plannedStart: '2020-01-02',
    });
    expect(created.statusCode, created.body).toBe(200);
    const requirement = created.json<Detail>();
    const item = requirement.workItems![0];
    const before = await detail(requirement.id);
    const updated = await updateWorkItemCommand(protocol, item.id, {
      expectedVersion: item.version, title: `${item.title}（修改）`, planned_start: '2020-01-03',
    });
    expect(updated.statusCode).toBe(400);
    expect(await detail(requirement.id)).toEqual(before);
  });

  it(`${protocol}：普通问题编辑拒绝未知拼写字段`, async () => {
    const issue = await createIssue();
    const updated = await updateIssueCommand(protocol, issue.id, {
      expectedVersion: issue.version, title: `${issue.title}（修改）`, due_date: tomorrow,
    });
    expect(updated.statusCode).toBe(400);
    expect(await issueDetail(issue.id)).toEqual(issue);
  });

  it(`${protocol}：整体排期拒绝未知拼写字段`, async () => {
    const created = await post('/api/requirements', {
      projectId: scope.projectId, title: `排期输入校验${++sequence}`, ownerId: scope.personId,
      templateId: scope.templateId, plannedStart: '2020-01-02',
    });
    expect(created.statusCode, created.body).toBe(200);
    const requirement = created.json<Detail>();
    const before = await detail(requirement.id);
    const rescheduled = await command(protocol, 'requirement', requirement.id, 'reschedule', {
      expectedVersion: requirement.version, scheduleMode: 'start', plannedStart: '2020-01-06', planned_start: '2020-01-07',
    });
    expect(rescheduled.statusCode).toBe(400);
    expect(await detail(requirement.id)).toEqual(before);
  });

  it(`${protocol}：工作项排序拒绝未知排序字段`, async () => {
    const created = await post('/api/requirements', {
      projectId: scope.projectId, title: `排序输入校验${++sequence}`, ownerId: scope.personId,
      templateId: scope.templateId, plannedStart: '2020-01-02',
    });
    expect(created.statusCode, created.body).toBe(200);
    const requirement = created.json<Detail>();
    const before = await detail(requirement.id);
    const ids = [...requirement.workItems!].reverse().map((item) => item.id);
    const reordered = await reorderCommand(protocol, requirement.id, {
      expectedVersion: requirement.version, ids, sortOrders: ids,
    });
    expect(reordered.statusCode).toBe(400);
    expect(await detail(requirement.id)).toEqual(before);
  });

  it(`${protocol}：重选流程拒绝未知模板字段`, async () => {
    const created = await post('/api/requirements', {
      projectId: scope.projectId, title: `重选输入校验${++sequence}`, ownerId: scope.personId,
      templateId: scope.templateId, plannedStart: '2020-01-02',
    });
    expect(created.statusCode, created.body).toBe(200);
    const requirement = created.json<Detail>();
    const replacement = await post('/api/templates', { projectId: scope.projectId, name: `替换流程${sequence}`, items: [
      { title: '替换步骤', startOffsetDays: 0, durationDays: 1, sortOrder: 0 },
    ] });
    expect(replacement.statusCode, replacement.body).toBe(200);
    const before = await detail(requirement.id);
    const result = await templateCommand(protocol, 'reselect', requirement.id, {
      templateId: replacement.json().id, expectedVersion: requirement.version, template_id: scope.templateId,
    });
    expect(result.statusCode).toBe(400);
    expect(await detail(requirement.id)).toEqual(before);
  });

  it(`${protocol}：补充流程拒绝未知模板字段`, async () => {
    const created = await post('/api/requirements', {
      projectId: scope.projectId, title: `补充输入校验${++sequence}`, ownerId: scope.personId,
      templateId: scope.templateId, plannedStart: '2020-01-02',
    });
    expect(created.statusCode, created.body).toBe(200);
    const requirement = created.json<Detail>();
    const supplement = await post('/api/templates', { projectId: scope.projectId, name: `补充流程${sequence}`, items: [
      { title: '补充步骤', startOffsetDays: 0, durationDays: 1, sortOrder: 0 },
    ] });
    expect(supplement.statusCode, supplement.body).toBe(200);
    const before = await detail(requirement.id);
    const result = await templateCommand(protocol, 'apply', requirement.id, {
      templateId: supplement.json().id, expectedVersion: requirement.version, template_id: scope.templateId,
    });
    expect(result.statusCode).toBe(400);
    expect(await detail(requirement.id)).toEqual(before);
  });

  it(`${protocol}：三类创建命令拒绝未知字段且不留半成品`, async () => {
    const valid = await post('/api/requirements', { projectId: scope.projectId, title: `创建校验容器${++sequence}` });
    expect(valid.statusCode, valid.body).toBe(200);
    const requirement = valid.json<Detail>();
    const beforeDetail = await detail(requirement.id);
    const beforeCounts = await creationCounts();
    const requirementResult = await createCommand(protocol, 'requirement', {
      projectId: scope.projectId, title: `错误字段需求${sequence}`, titel: '错误标题',
    });
    const workItemResult = await createCommand(protocol, 'work_item', {
      title: '错误字段工作项', expectedVersion: requirement.version, planned_start: '2020-01-02',
    }, requirement.id);
    const issueResult = await createCommand(protocol, 'issue', {
      projectId: scope.projectId, title: `错误字段问题${sequence}`, due_date: '2020-01-02',
    });
    expect([requirementResult.statusCode, workItemResult.statusCode, issueResult.statusCode]).toEqual([400, 400, 400]);
    expect(await detail(requirement.id)).toEqual(beforeDetail);
    expect(await creationCounts()).toEqual(beforeCounts);
  });

  it(`${protocol}：项目人员流程创建拒绝未知字段`, async () => {
    const before = await administrationCounts();
    const projectResult = await createAdminCommand(protocol, 'project', {
      name: `错误字段项目${++sequence}`, project_name: '重复项目名',
    });
    const personResult = await createAdminCommand(protocol, 'person', {
      projectId: scope.projectId, name: `错误字段人员${sequence}`, job_title: '开发',
    });
    const templateResult = await createAdminCommand(protocol, 'template', {
      projectId: scope.projectId, name: `错误字段流程${sequence}`, description_text: '错误说明',
      items: [{ title: '实现', startOffsetDays: 0, durationDays: 1, sortOrder: 0 }],
    });
    expect([projectResult.statusCode, personResult.statusCode, templateResult.statusCode]).toEqual([400, 400, 400]);
    expect(await administrationCounts()).toEqual(before);
  });

  it(`${protocol}：复制流程拒绝无关字段且不生成副本`, async () => {
    const before = await administrationCounts();
    const copied = await copyTemplateCommand(protocol, { copy_name: `错误副本名${++sequence}` });
    expect(copied.statusCode, JSON.stringify(copied.body)).toBe(400);
    expect(await administrationCounts()).toEqual(before);
  });

  it(`${protocol}：项目人员流程编辑拒绝未知字段且不部分保存`, async () => {
    const before = await adminSnapshots();
    const projectResult = await updateAdminCommand(protocol, 'project', scope.projectId, {
      name: `${before.project!.name}新`, expectedUpdatedAt: before.project!.updatedAt, planned_end: '2020-01-02',
    });
    const personResult = await updateAdminCommand(protocol, 'person', scope.personId, {
      jobTitle: '产品经理', expectedUpdatedAt: before.person!.updatedAt, job_title: '开发',
    });
    const templateResult = await updateAdminCommand(protocol, 'template', scope.templateId, {
      description: '新流程说明', expectedUpdatedAt: before.template!.updatedAt, description_text: '错误说明',
    });
    expect([projectResult.statusCode, personResult.statusCode, templateResult.statusCode]).toEqual([400, 400, 400]);
    expect(await adminSnapshots()).toEqual(before);
  });

  it(`${protocol}：流程创建和编辑拒绝步骤内部未知字段`, async () => {
    const before = await adminSnapshots();
    const countsBefore = await administrationCounts();
    const created = await createAdminCommand(protocol, 'template', {
      projectId: scope.projectId, name: `错误步骤流程${++sequence}`,
      items: [{ title: '实现', startOffsetDays: 0, durationDays: 1, sortOrder: 0, duration_days: 2 }],
    });
    const items = (before.template!.items as Array<Record<string, unknown>>).map((item) => ({ ...item, duration_days: item.durationDays }));
    const updated = await updateAdminCommand(protocol, 'template', scope.templateId, {
      name: before.template!.name, description: before.template!.description,
      items, expectedUpdatedAt: before.template!.updatedAt,
    });
    expect([created.statusCode, updated.statusCode]).toEqual([400, 400]);
    expect(await administrationCounts()).toEqual(countsBefore);
    expect((await adminSnapshots()).template).toEqual(before.template);
  });

  it(`${protocol}：成员角色设置和移除拒绝未知并发字段`, async () => {
    const created = await post('/api/people', { projectId: scope.projectId, name: `成员并发校验${++sequence}` });
    expect(created.statusCode, created.body).toBe(200);
    const personId = created.json().id as string;
    const before = (await app.inject({ url: `/api/projects/${scope.projectId}/members`, headers: { cookie } })).json<Array<Record<string, unknown>>>()
      .find((item) => item.id === personId)!;
    const setResult = await memberCommand(protocol, 'set', personId, {
      role: 'viewer', expectedMembershipUpdatedAt: before.membershipUpdatedAt, project_role: 'manager',
    });
    const removeResult = await memberCommand(protocol, 'remove', personId, {
      expected_membership_updated_at: before.membershipUpdatedAt,
    });
    expect([setResult.statusCode, removeResult.statusCode]).toEqual([400, 400]);
    const after = (await app.inject({ url: `/api/projects/${scope.projectId}/members`, headers: { cookie } })).json<Array<Record<string, unknown>>>()
      .find((item) => item.id === personId);
    expect(after).toEqual(before);
  });

  it(`${protocol}：项目人员流程归档拒绝未知确认字段`, async () => {
    const project = await createAdminCommand('REST', 'project', { name: `归档校验项目${++sequence}` });
    const person = await createAdminCommand('REST', 'person', { name: `归档校验人员${sequence}` });
    const template = await createAdminCommand('REST', 'template', {
      projectId: scope.projectId, name: `归档校验流程${sequence}`,
      items: [{ title: '实现', startOffsetDays: 0, durationDays: 1, sortOrder: 0 }],
    });
    expect([project.statusCode, person.statusCode, template.statusCode]).toEqual([200, 200, 200]);
    const projectResult = await archiveAdminCommand(protocol, 'project', project.body.id as string, { force_archive: true });
    const personResult = await archiveAdminCommand(protocol, 'person', person.body.id as string, { expected_updated_at: person.body.updatedAt });
    const templateResult = await archiveAdminCommand(protocol, 'template', template.body.id as string, { expected_updated_at: template.body.updatedAt });
    expect([projectResult.statusCode, personResult.statusCode, templateResult.statusCode]).toEqual([400, 400, 400]);
    expect((await app.inject({ url: '/api/projects', headers: { cookie } })).json<Array<Record<string, unknown>>>()
      .some((item) => item.id === project.body.id)).toBe(true);
    expect((await app.inject({ url: '/api/people', headers: { cookie } })).json<Array<Record<string, unknown>>>()
      .some((item) => item.id === person.body.id)).toBe(true);
    expect((await app.inject({ url: `/api/templates?projectId=${scope.projectId}`, headers: { cookie } })).json<Array<Record<string, unknown>>>()
      .some((item) => item.id === template.body.id)).toBe(true);
  });

  it(`${protocol}：归档恢复拒绝错拼代次字段`, async () => {
    const project = await createAdminCommand('REST', 'project', { name: `恢复代次校验${++sequence}` });
    expect(project.statusCode).toBe(200);
    const archived = await archiveAdminCommand('REST', 'project', project.body.id as string, {});
    expect(archived.statusCode).toBe(200);
    const archive = (await app.inject({ url: '/api/archives', headers: { cookie } })).json<{ projects: Array<Record<string, unknown>> }>()
      .projects.find((item) => item.id === project.body.id)!;
    const restored = await restoreProjectCommand(protocol, project.body.id as string, {
      expected_deleted_at: archive.deletedAt,
    });
    expect(restored.statusCode).toBe(400);
    expect((await app.inject({ url: '/api/archives', headers: { cookie } })).json<{ projects: Array<Record<string, unknown>> }>()
      .projects.some((item) => item.id === project.body.id)).toBe(true);
  });

  it(`${protocol}：永久删除拒绝错拼确认字段`, async () => {
    const project = await createAdminCommand('REST', 'project', { name: `永久删除校验${++sequence}` });
    expect(project.statusCode).toBe(200);
    expect((await archiveAdminCommand('REST', 'project', project.body.id as string, {})).statusCode).toBe(200);
    const archive = (await app.inject({ url: '/api/archives', headers: { cookie } })).json<{ projects: Array<Record<string, unknown>> }>()
      .projects.find((item) => item.id === project.body.id)!;
    const deleted = await permanentlyDeleteProjectCommand(protocol, project.body.id as string, {
      confirmName: project.body.name, expectedDeletedAt: archive.deletedAt, confirm_name: project.body.name,
    });
    expect(deleted.statusCode).toBe(400);
    expect((await app.inject({ url: '/api/archives', headers: { cookie } })).json<{ projects: Array<Record<string, unknown>> }>()
      .projects.some((item) => item.id === project.body.id)).toBe(true);
  });

  it(`${protocol}：只追加历史命令拒绝未知字段且不改记录`, async () => {
    const workItem = await createWork();
    const requirementBefore = await detail(workItem.requirementId);
    const progressId = requirementBefore.progressUpdates.find((entry) => entry.workItemId === workItem.id)!.id;
    const issueBefore = await createIssue();
    const updateId = issueBefore.updates![0].id;
    const results = [
      await historyCommand(protocol, 'progress', 'update', progressId, null, { content: '错误修改', content_text: '错拼内容' }),
      await historyCommand(protocol, 'progress', 'delete', progressId, null, { force: true }),
      await historyCommand(protocol, 'issue_update', 'update', updateId, issueBefore.id, { content: '错误修改', content_text: '错拼内容' }),
      await historyCommand(protocol, 'issue_update', 'delete', updateId, issueBefore.id, { force: true }),
    ];
    expect(results.map((result) => result.statusCode)).toEqual([400, 400, 400, 400]);
    expect(await detail(workItem.requirementId)).toEqual(requirementBefore);
    expect(await issueDetail(issueBefore.id)).toEqual(issueBefore);
  });

  it(`${protocol}：需求查询拒绝错拼筛选字段`, async () => {
    const result = await listRequirementsCommand(protocol, { projectId: scope.projectId, project_id: scope.projectId });
    expect(result.statusCode, JSON.stringify(result.body)).toBe(400);
  });
}

it('MCP：项目成员查询拒绝错拼参数', async () => {
  const result = await listProjectMembersCommand({ projectId: scope.projectId, project_id: scope.projectId });
  expect(result.statusCode).toBe(400);
});

it('MCP：无参数查询拒绝附带字段', async () => {
  for (const tool of ['get_my_work', 'get_analytics_catalog'] as const) {
    const result = await parameterlessMcpCommand(tool, { projectId: scope.projectId });
    expect(result.statusCode, tool).toBe(400);
  }
});

it('REST：无参数命令拒绝附带字段', async () => {
  const databaseCheck = await post('/api/system/database-check', { repair: true });
  expect(databaseCheck.statusCode).toBe(400);
  const logout = await app.inject({ method: 'POST', url: '/api/logout', headers: { cookie }, payload: { everywhere: true } });
  expect(logout.statusCode).toBe(400);
});
