import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHmac, scryptSync } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { captureLogs } from './logging-test-support';
import { mcpRequest, mcpRpcRequest } from './mcp-request';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-mcp-logging-'));
const password = 'logging-test-password';
Object.assign(process.env, { DB_PATH: path.join(directory, 'test.db'), BACKUP_DIR: path.join(directory, 'backups'),
  WEB_DIST_DIR: path.join(directory, 'web'), SEED_DEMO: '0', NODE_ENV: 'test',
  APP_PASSWORD_HASH: `scrypt$logging$${scryptSync(password, 'logging', 64).toString('hex')}`,
  SESSION_SECRET: 'logging-test-session-secret-more-than-32-characters' });
const log = captureLogs({ level: 'debug' });
let app: FastifyInstance, origin: string, token: string, cookie: string, accountId: string, tokenId: string;
beforeAll(async () => {
  app = await (await import('../src/server/app')).buildApp(log);
  origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password } });
  cookie = String(login.headers['set-cookie']).split(';')[0];
  const result = await app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie }, payload: { name: '日志验证' } });
  token = result.json().token;
  tokenId = result.json().id;
  accountId = log.records().find(row => row.route === '/api/login')!.accountId as string;
  expect(token).toBeTruthy(); log.clear();
});
afterAll(async () => {
  await app?.close(); await log.close();
  const { sqlite } = await import('./support/database');
  if (sqlite.open) sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

it('MCP 查询和写入按工具属性分级，共享 reqId 且不重复 HTTP 日志', async () => {
  for (const [name, args, level] of [
    ['list_projects', {}, 'debug'], ['create_project', { name: 'private-description' }, 'info'],
  ] as const) {
    log.clear();
    const response = await mcpRequest(origin, token, name, args);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).result.isError, response.body).not.toBe(true);
    expect(log.records()).toHaveLength(1);
    expect(log.records()[0]).toMatchObject({ module: 'mcp', event: 'mcp.completed', mcpMethod: 'tools/call', tool: name, level, statusCode: 200, outcome: 'succeeded' });
    expect(log.records()[0].reqId).toBeTruthy();
    expect(log.records()[0]).toMatchObject({ user: 'admin', accountId, actorType: 'token', authMethod: 'token', tokenName: '日志验证', tokenId, sourceIp: '127.0.0.1' });
    expect(log.output.stdout + log.output.stderr).not.toContain(token);
    expect(log.output.stdout + log.output.stderr).not.toContain('private-description');
  }
});

it('HTTP 200 的参数校验和业务拒绝记 INFO，无堆栈；认证失败记 WARN', async () => {
  for (const [name, args, code] of [
    ['create_project', { name: '' }, 'VALIDATION_ERROR'],
    ['get_work_item', { id: '00000000-0000-4000-8000-000000000000' }, 'NOT_FOUND'],
    ['unknown_tool', {}, 'MCP_RPC_-32602'],
  ] as const) {
    log.clear(); const response = await mcpRequest(origin, token, name, args);
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.result?.isError === true || !!body.error, response.body).toBe(true);
    expect(log.records()).toHaveLength(1);
    expect(log.records()[0]).toMatchObject({ level: 'info', errorCode: code, outcome: 'rejected' });
    expect(log.records()[0].err).toBeUndefined();
    expect(log.records()[0].reason).toBeTruthy();
    if (name === 'create_project') {
      expect(log.records()[0].validationFields).toBe('name');
      expect(log.records()[0].reason).toContain('长度未达到下限 1');
    }
  }
  log.clear();
  expect((await mcpRequest(origin, 'private-invalid-token', 'list_projects', {})).statusCode).toBe(401);
  expect(log.records()).toHaveLength(1);
  expect(log.records()[0]).toMatchObject({ module: 'mcp', level: 'warn', statusCode: 401, tool: 'list_projects', reasonCode: 'TOKEN_INVALID' });
});

it('登录结果记录账号与来源 IP，失败登录只标记尝试账号，不相信转发头', async () => {
  for (const [submittedPassword, statusCode] of [[password, 200], ['private-wrong-password', 401]] as const) {
    log.clear();
    const response = await app.inject({ method: 'POST', url: '/api/login', remoteAddress: '192.0.2.8',
      headers: { 'x-forwarded-for': '203.0.113.8' }, payload: { username: 'admin', password: submittedPassword } });
    expect(response.statusCode).toBe(statusCode);
    expect(log.records()).toHaveLength(1);
    expect(log.records()[0]).toMatchObject({ sourceIp: '192.0.2.8', authMethod: 'password', statusCode });
    if (statusCode === 200) expect(log.records()[0]).toMatchObject({ user: 'admin', accountId, actorType: 'user' });
    else {
      expect(log.records()[0]).toMatchObject({ user: '未登录', attemptedUser: 'admin', actorType: 'anonymous', reasonCode: 'LOGIN_CREDENTIALS_INVALID', reason: '用户名或密码错误' });
      expect(log.records()[0].accountId).toBeUndefined();
    }
    expect(log.output.stdout + log.output.stderr).not.toContain(submittedPassword);
  }
});

it('失效会话和伪造会话分别说明原因，不把未验证的账号当作调用人', async () => {
  const { config } = await import('../src/server/config');
  const value = Buffer.from(JSON.stringify({ accountId, sessionVersion: 0, expiresAt: Date.now() - 1000 })).toString('base64url');
  const signed = value + '.' + createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
  for (const [credential, reasonCode] of [[signed, 'SESSION_EXPIRED'], [value + '.invalid', 'SESSION_INVALID']]) {
    log.clear();
    expect((await app.inject({ url: '/api/my-work', headers: { cookie: `${config.sessionCookieName}=${credential}` } })).statusCode).toBe(401);
    expect(log.records()).toHaveLength(1);
    expect(log.records()[0]).toMatchObject({ user: '未登录', actorType: 'anonymous', authMethod: 'session', reasonCode });
    expect(log.records()[0].accountId).toBeUndefined();
    expect(log.output.stderr).not.toContain(credential);
  }
});

it('Token 撤销与过期有明确原因，错误密钥不会被归属到 Token 所有人', async () => {
  const { sqlite } = await import('./support/database');
  for (const [column, reasonCode] of [['revoked_at', 'TOKEN_REVOKED'], ['expires_at', 'TOKEN_EXPIRED']] as const) {
    const before = sqlite.prepare(`SELECT ${column} AS value FROM api_tokens WHERE id=?`).get(tokenId) as { value: string | null };
    sqlite.prepare(`UPDATE api_tokens SET ${column}=? WHERE id=?`).run('2020-01-01T00:00:00.000Z', tokenId);
    try {
      log.clear();
      expect((await mcpRequest(origin, token, 'list_projects', {})).statusCode).toBe(401);
      expect(log.records()[0]).toMatchObject({ user: '未登录', attemptedUser: 'admin', authMethod: 'token', tokenName: '日志验证', tokenId, reasonCode });
      expect(log.records()[0].accountId).toBeUndefined();
      log.clear();
      expect((await mcpRequest(origin, token.slice(0, 14) + 'wrong-secret', 'list_projects', {})).statusCode).toBe(401);
      expect(log.records()[0]).toMatchObject({ user: '未登录', reasonCode: 'TOKEN_INVALID' });
      for (const field of ['attemptedUser', 'tokenName', 'tokenId', 'accountId']) expect(log.records()[0][field]).toBeUndefined();
    } finally { sqlite.prepare(`UPDATE api_tokens SET ${column}=? WHERE id=?`).run(before.value, tokenId); }
  }
});

it('资源不可访问说明内部原因，登录用户按游客权限浏览时保留真实账号', async () => {
  const post = async (url: string, payload: object) => {
    const response = await app.inject({ method: 'POST', url, headers: { cookie }, payload });
    expect(response.statusCode, response.body).toBe(200); return response.json();
  };
  const project = await post('/api/projects', { name: '访问日志项目' });
  await post('/api/people', { name: '日志其他成员', projectId: (await post('/api/projects', { name: '其他日志项目' })).id });
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: '日志其他成员', password: '888888' } });
  const changed = await app.inject({ method: 'POST', url: '/api/account/change-password', headers: { cookie: String(login.headers['set-cookie']).split(';')[0] }, payload: { currentPassword: '888888', newPassword: password } });
  expect(changed.statusCode).toBe(200);
  const outsider = String(changed.headers['set-cookie']).split(';')[0];
  const read = (id: string, auth = '') => app.inject({ url: `/api/projects/${id}/change-version`, headers: { cookie: auth } });
  for (const [id, auth, reasonCode, user] of [
    [project.id, '', 'PROJECT_NOT_PUBLIC', '未登录'],
    ['00000000-0000-4000-8000-000000000000', '', 'PROJECT_NOT_FOUND', '未登录'],
    [project.id, outsider, 'PROJECT_ACCESS_DENIED', '日志其他成员'],
  ]) {
    log.clear();
    const response = await read(id, auth);
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('项目不存在或未开放游客浏览');
    expect(log.records()).toHaveLength(1);
    expect(log.records()[0]).toMatchObject({ projectId: id, user, reasonCode });
    if (id === project.id) expect(log.records()[0].projectName).toBe('访问日志项目');
  }
  const opened = await app.inject({ method: 'PATCH', url: '/api/projects/' + project.id, headers: { cookie }, payload: { guestVisible: true, expectedUpdatedAt: project.updatedAt } });
  expect(opened.statusCode, opened.body).toBe(200);
  log.clear();
  expect((await read(project.id, outsider)).statusCode).toBe(200);
  expect(log.records()[0]).toMatchObject({ user: '日志其他成员', actorType: 'user', authMethod: 'session', accessMode: 'guest', projectName: '访问日志项目' });
  expect(log.records()[0].accountId).toBeTruthy();
  expect(log.records()[0].reasonCode).toBeUndefined();
});

it('SDK 协议错误和坏 JSON 会记录失败，不误记为成功', async () => {
  log.clear();
  const response = await mcpRpcRequest(origin, token, 'unknown/method', {});
  expect(log.records()).toHaveLength(1);
  expect(log.records()[0], response.body).toMatchObject({ level: 'info', outcome: 'rejected', errorCode: 'MCP_RPC_-32601', mcpMethod: 'unknown/method', msg: 'MCP 方法不受支持' });
  expect(JSON.parse(response.body).error.code).toBe(-32601);
  log.clear();
  await app.inject({ method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, payload: '{broken-private-json' });
  expect(log.records()).toHaveLength(1);
  expect(log.records()[0]).toMatchObject({ module: 'mcp', level: 'info', outcome: 'rejected', statusCode: 400 });
  expect(log.output.stdout).not.toContain('broken-private-json');
});

it('可选资源、模板和提示词查询返回空清单，能力声明与实际处理一致', async () => {
  const initialized = await mcpRpcRequest(origin, token, 'initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'discovery-test', version: '1' },
  });
  const methods = [['resources/list', 'resources'], ['resources/templates/list', 'resourceTemplates'], ['prompts/list', 'prompts']];
  const responses = [];
  for (const [method, key] of methods) {
    log.clear();
    const response = await mcpRpcRequest(origin, token, method, {});
    responses.push({ method, key, response: JSON.parse(response.body), logs: log.records() });
  }
  expect(responses.map(r => ({ method: r.method, error: r.response.error }))).toEqual(methods.map(([method]) => ({ method, error: undefined })));
  expect(JSON.parse(initialized.body).result.capabilities).toMatchObject({ resources: { listChanged: false }, prompts: { listChanged: false } });
  for (const { method, key, response, logs } of responses) {
    expect(response.result).toEqual({ [key]: [] });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ level: 'debug', mcpMethod: method, statusCode: 200, outcome: 'succeeded' });
    expect(logs[0].errorCode).toBeUndefined();
  }
});

it('空清单支持不放宽认证，未知资源仍失败，日志不输出原始参数或非法方法名', async () => {
  log.clear();
  const denied = await mcpRpcRequest(origin, 'private-invalid-token', 'resources/list', {});
  expect(denied.statusCode).toBe(401);
  expect(log.records()[0]).toMatchObject({ level: 'warn', mcpMethod: 'resources/list', outcome: 'rejected' });
  log.clear();
  const missing = await mcpRpcRequest(origin, token, 'resources/read', { uri: 'file:///private-resource' });
  expect(JSON.parse(missing.body).error).toBeTruthy();
  expect(log.records()[0]).toMatchObject({ mcpMethod: 'resources/read', outcome: 'rejected' });
  expect(log.output.stdout + log.output.stderr).not.toContain('private-resource');
  log.clear();
  await mcpRpcRequest(origin, token, 'unknown/\nprivate-method', { privateArgument: 'private-content' });
  expect(log.records()[0]).toMatchObject({ mcpMethod: '<invalid>', outcome: 'rejected' });
  expect(log.output.stdout + log.output.stderr).not.toMatch(/private-method|private-content/);
});

it('慢 MCP 查询提升为 WARN，内部异常保留 HTTP 200 但记录 ERROR', async () => {
  log.clear();
  let time = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => time += 1500);
  try { await mcpRequest(origin, token, 'list_projects', {}); } finally { clock.mockRestore(); }
  expect(log.records()).toHaveLength(1);
  expect(log.records()[0]).toMatchObject({ level: 'warn', slow: true, outcome: 'succeeded' });
  log.clear();
  const { sqlite } = await import('./support/database');
  const original = sqlite.prepare.bind(sqlite);
  const prepare = vi.spyOn(sqlite, 'prepare').mockImplementation((sql: string) => {
    if (sql.includes('FROM projects')) throw new Error('simulated query failure');
    return original(sql);
  });
  try {
    const response = await mcpRequest(origin, token, 'list_projects', {});
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).result.isError).toBe(true);
  } finally { prepare.mockRestore(); }
  expect(log.records()).toHaveLength(1);
  expect(log.records()[0]).toMatchObject({ level: 'error', statusCode: 200, outcome: 'failed', tool: 'list_projects' });
  expect(log.records()[0].err?.stack).toContain('simulated query failure');
});

it('传输异常记录一次 ERROR，保留请求编号并结束响应', async () => {
  log.clear();
  const transport = vi.spyOn(NodeStreamableHTTPServerTransport.prototype, 'handleRequest').mockRejectedValueOnce(new Error('simulated transport failure'));
  try {
    const response = await mcpRequest(origin, token, 'list_projects', {});
    expect(response.statusCode).toBe(500);
  } finally { transport.mockRestore(); }
  expect(log.records()).toHaveLength(1);
  expect(log.records()[0]).toMatchObject({ module: 'mcp', level: 'error', statusCode: 500, outcome: 'failed' });
  expect(log.records()[0].reqId).toBeTruthy();
  expect(log.records()[0].err?.stack).toContain('simulated transport failure');
});
