import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-manage-login-limit-'));
process.env.DB_PATH = path.join(directory, 'test.db');
process.env.BACKUP_DIR = path.join(directory, 'backups');
process.env.WEB_DIST_DIR = path.join(directory, 'web');
process.env.SEED_DEMO = '0';
process.env.APP_PASSWORD_HASH = 'scrypt$test$00';
process.env.SESSION_SECRET = 'login-rate-limit-temporary-test-secret-123456789';
// 与生产使用同一个8次阈值，关闭生产请求日志；不能使用测试环境的100次阈值。
process.env.NODE_ENV = 'development';
let app: FastifyInstance;

beforeAll(async () => {
  app = await (await import('../src/server/app')).buildApp();
  await app.ready();
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterAll(async () => {
  vi.useRealTimers();
  await app?.close();
  const { sqlite } = await import('../src/server/database');
  if (sqlite.open) sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

it('登录按真实IP限流，换用户名、查询参数和伪造转发头不能绕过', async () => {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const response = await app.inject({ method: 'POST', url: `/api/login?attempt=${attempt}`, remoteAddress: '192.0.2.10',
      headers: { 'x-forwarded-for': `192.0.2.${attempt}` }, payload: { username: `不存在的用户${attempt}`, password: 'invalid-password' },
    });
    expect(response.statusCode).toBe(401);
    expect(Number(response.headers['x-ratelimit-remaining'])).toBe(8 - attempt);
  }
  const limited = await app.inject({ method: 'POST', url: '/api/login', remoteAddress: '192.0.2.10', payload: { username: 'admin', password: 'invalid' } });
  expect(limited.statusCode).toBe(429);
  expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  expect(limited.json()).toHaveProperty('error');
  const otherIp = await app.inject({ method: 'POST', url: '/api/login', remoteAddress: '192.0.2.11', payload: {} });
  expect(otherIp.statusCode).toBe(401);
  expect((await app.inject({ url: '/health', remoteAddress: '192.0.2.10' })).statusCode).toBe(200);
  vi.setSystemTime(Date.now() + 60_001);
  const afterWindow = await app.inject({ method: 'POST', url: '/api/login', remoteAddress: '192.0.2.10', payload: {} });
  expect(afterWindow.statusCode).toBe(401);
  expect(Number(afterWindow.headers['x-ratelimit-remaining'])).toBe(7);
});
