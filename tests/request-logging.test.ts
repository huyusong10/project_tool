import http from 'node:http';
import { performance } from 'node:perf_hooks';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import { captureRequestError, registerRequestLogging, RequestLogController } from '../src/server/request-logging';
import { AppError, errorResponse } from '../src/server/errors';
import { captureLogs } from './logging-test-support';
import { z } from 'zod';
import { recordLogIdentity } from '../src/server/log-context';

const instances: { app: FastifyInstance; log: ReturnType<typeof captureLogs> }[] = [];
function fixture(level: 'info' | 'debug' = 'info') {
  const log = captureLogs({ level });
  const loggerInstance: FastifyBaseLogger = log.logger;
  const controller = new RequestLogController(1000);
  const app = Fastify({ loggerInstance, logController: controller });
  registerRequestLogging(app, controller);
  app.setErrorHandler((error, request, reply) => {
    captureRequestError(request, error);
    const response = errorResponse(error);
    reply.code(response.statusCode).send(response.payload);
  });
  instances.push({ app, log });
  return { app, log };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const { app, log } of instances.splice(0)) { await app.close(); await log.close(); }
});

it('INFO 隐藏成功读取和只读 POST，一次写入只记录一次且不暴露用户输入', async () => {
  const { app, log } = fixture();
  app.get('/api/projects/:id/change-version', () => ({ version: 1 }));
  app.get('/assets/*', () => 'asset');
  app.get('/health', () => 'ok');
  app.post('/api/analytics/query', () => ({ rows: [] }));
  app.patch('/api/work-items/:id', () => ({ ok: true }));
  for (const url of ['/api/projects/private-id/change-version', '/assets/a.js', '/health']) await app.inject(url);
  await app.inject({ method: 'POST', url: '/api/analytics/query', payload: { secret: 'payload-secret' } });
  expect(log.records()).toEqual([]);
  await app.inject({ method: 'PATCH', url: '/api/work-items/private-id?token=query-secret',
    headers: { cookie: 'cookie-secret', authorization: 'Bearer auth-secret' }, payload: { password: 'body-secret' } });
  expect(log.records()).toHaveLength(1);
  expect(log.records()[0]).toMatchObject({ event: 'http.completed', level: 'info', statusCode: 200, route: '/api/work-items/:id', outcome: 'succeeded' });
  expect(log.records()[0].reqId).toBeTruthy();
  expect(log.records()[0]).toMatchObject({ user: '未登录', sourceIp: '127.0.0.1', resourceType: 'work_item', resourceId: 'private-id', fields: 'password' });
  for (const secret of ['query-secret', 'cookie-secret', 'auth-secret', 'body-secret']) expect(log.output.stdout).not.toContain(secret);
});

it('DEBUG 能看到普通请求，慢读取只记录一条 WARN', async () => {
  const { app, log } = fixture('debug');
  const clock = vi.spyOn(performance, 'now');
  let time = 0;
  clock.mockImplementation(() => time);
  app.get('/fast', () => 'ok');
  app.get('/slow', () => { time += 1420; return 'ok'; });
  await app.inject('/fast'); await app.inject('/slow');
  expect(log.records()).toHaveLength(2);
  expect(log.records()[0]).toMatchObject({ level: 'debug', route: '/fast' });
  expect(log.records()[1]).toMatchObject({ level: 'warn', route: '/slow', durationMs: 1420, slow: true });
});

it('校验、认证、限流和异常分类正确，未知路由不输出原始 URL', async () => {
  const { app, log } = fixture();
  app.get('/validation', () => { throw new AppError('数据已被其他用户修改，请刷新后重试', 409, 'STALE_WRITE'); });
  app.get('/unauthenticated', (_request, reply) => reply.code(401).send({ error: 'denied' }));
  app.get('/forbidden', () => { throw new AppError('forbidden', 403, 'FORBIDDEN'); });
  app.get('/rate-limit', (_request, reply) => reply.code(429).send({ code: 'RATE_LIMITED' }));
  app.get('/rate-limit-error', () => { throw Object.assign(new Error('Too many requests'), { statusCode: 429 }); });
  app.get('/assets/broken', () => { throw new Error('disk read failed'); });
  for (const url of ['/validation', '/unauthenticated', '/forbidden', '/rate-limit', '/rate-limit-error', '/assets/broken', '/missing-private-id?secret=private']) await app.inject(url);
  const rows = log.records();
  expect(rows).toHaveLength(7);
  const row = (route: string) => rows.find(item => item.route === route)!;
  expect(row('/validation')).toMatchObject({ level: 'info', errorCode: 'STALE_WRITE' });
  for (const route of ['/unauthenticated', '/forbidden', '/rate-limit']) expect(row(route).level).toBe('warn');
  expect(row('/rate-limit-error')).toMatchObject({ level: 'warn', errorCode: 'HTTP_429' });
  expect(row('/assets/broken')).toMatchObject({ level: 'error', statusCode: 500 });
  expect(rows.filter(item => item.err?.stack)).toHaveLength(1);
  expect(row('<unmatched>').statusCode).toBe(404);
  expect(log.output.stdout + log.output.stderr).not.toContain('missing-private-id');
  expect(row('/validation')).toMatchObject({ reason: '数据已被其他用户修改，请刷新后重试', reasonCode: 'STALE_WRITE' });
});

it('真实连接中断只记录一条 WARN，不误记成功', async () => {
  const { app, log } = fixture();
  let entered!: () => void;
  const pending = new Promise<void>(resolve => { entered = resolve; });
  app.get('/stream', (_request, reply) => {
    reply.hijack(); reply.raw.writeHead(200); reply.raw.write('waiting'); entered();
  });
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const req = http.get(origin + '/stream'); req.on('error', () => {});
  await pending; req.destroy();
  await vi.waitFor(() => expect(log.records()).toHaveLength(1));
  expect(log.records()[0]).toMatchObject({ event: 'http.completed', level: 'warn', outcome: 'aborted' });
});

it('保留响应结束后的框架异常，堆栈只记录一次', async () => {
  const { app, log } = fixture();
  app.addHook('onResponse', async () => { throw new Error('after response failure'); });
  app.get('/hook-failed', () => 'ok');
  expect((await app.inject('/hook-failed')).statusCode).toBe(200);
  expect(log.records()).toHaveLength(1);
  expect(log.records()[0]).toMatchObject({ event: 'http.after_response_failed', level: 'error' });
  expect(log.records()[0].err?.stack).toContain('after response failure');
});

it('记录冲突版本与校验字段，嵌套路由不混淆父对象和创建结果', async () => {
  const { app, log } = fixture();
  app.patch('/api/work-items/:id', () => { throw new AppError('工作项已被修改，请刷新后重试', 409, 'STALE_WRITE', undefined, 8); });
  app.post('/api/requirements/:id/work-items', request => {
    z.object({ title: z.string().min(1), durationDays: z.number() }).parse(request.body);
    return { id: 'created-work-item' };
  });
  await app.inject({ method: 'PATCH', url: '/api/work-items/work-1', payload: { expectedVersion: 3, title: 'private-title' } });
  expect(log.records()[0]).toMatchObject({ resourceId: 'work-1', resourceType: 'work_item', expectedVersion: 3, currentVersion: 8, fields: 'title', reasonCode: 'STALE_WRITE' });
  log.clear();
  await app.inject({ method: 'POST', url: '/api/requirements/requirement-1/work-items', payload: { title: '', durationDays: 'private-value' } });
  expect(log.records()[0]).toMatchObject({ requirementId: 'requirement-1', resourceType: 'work_item', validationFields: 'title,durationDays', reasonCode: 'VALIDATION_ERROR' });
  expect(log.records()[0].resourceId).toBeUndefined();
  expect(log.output.stdout).not.toContain('private-value');
  log.clear();
  await app.inject({ method: 'POST', url: '/api/requirements/requirement-1/work-items', payload: { title: 'private-title', durationDays: 1 } });
  expect(log.records()[0]).toMatchObject({ requirementId: 'requirement-1', resourceType: 'work_item', resourceId: 'created-work-item' });
  expect(log.output.stdout).not.toContain('private-title');
});

it('并发请求分别保留真实身份，未登录请求不继承上一位用户', async () => {
  const { app, log } = fixture('debug');
  let entered!: () => void, resume!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const released = new Promise<void>(resolve => { resume = resolve; });
  app.get('/first', async () => {
    recordLogIdentity({ type: 'user', id: 'user-1', accountId: 'user-1', label: '甲' });
    entered(); await released; return { ok: true };
  });
  app.get('/second', async () => {
    recordLogIdentity({ type: 'user', id: 'user-2', accountId: 'user-2', label: '乙' });
    return { ok: true };
  });
  app.get('/anonymous', () => ({ ok: true }));
  const first = app.inject('/first').then(response => response);
  await waiting;
  await app.inject('/second'); await app.inject('/anonymous');
  resume(); await first;
  expect(log.records().map(row => [row.route, row.user, row.accountId])).toEqual([
    ['/second', '乙', 'user-2'], ['/anonymous', '未登录', undefined], ['/first', '甲', 'user-1'],
  ]);
});
