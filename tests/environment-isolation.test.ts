import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-manage-isolation-test-'));
process.env.DB_PATH = path.join(directory, 'test.db');
process.env.BACKUP_DIR = path.join(directory, 'backups');
process.env.SEED_DEMO = '0';
process.env.APP_PASSWORD_HASH = 'scrypt$4c63a6f93ff4f94b031b7e7583592177$b598dbddaf9dd06678ff8756923d9e0a7f2d68eaa45bc644fbf4a73c9298970c7489671dfcfc8be282022c26a3370fb040f3f086a45faa1e1abde04bbe4a51ef';
process.env.SESSION_SECRET = 'isolated-cookie-tests-with-more-than-thirty-two-characters';
process.env.SESSION_COOKIE_NAME = 'pm_isolation_test';
process.env.PORT = '3227';
let app: FastifyInstance;

beforeAll(async () => { app = await (await import('../src/server/app')).buildApp(); });
afterAll(async () => {
  await app?.close();
  const { sqlite } = await import('../src/server/database');
  if (sqlite.open) sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

it('独立环境登录、读取会话和退出仅操作独立Cookie', async () => {
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: '41_xc7q0qOjo4Inw!' } });
  expect(login.statusCode).toBe(200);
  const cookie = String(login.headers['set-cookie']).split(';')[0];
  expect(cookie).toMatch(/^pm_isolation_test=/);
  const signedValue = cookie.slice(cookie.indexOf('=') + 1);
  const sourceOnly = await app.inject({ url: '/api/session', headers: { cookie: `pm_session=${signedValue}` } });
  expect(sourceOnly.json().authenticated).toBe(false);
  const independent = await app.inject({ url: '/api/session', headers: { cookie: `pm_session=existing-production-cookie; ${cookie}` } });
  expect(independent.json().authenticated).toBe(true);
  const logout = await app.inject({ method: 'POST', url: '/api/logout', headers: { cookie } });
  expect(String(logout.headers['set-cookie'])).toMatch(/^pm_isolation_test=;/);
  expect(String(logout.headers['set-cookie'])).not.toMatch(/\bpm_session=/);
});

it('开发代理使用本环境端口，不能写死主服务端口', async () => {
  const factory = (await import('../vite.config')).default;
  if (typeof factory !== 'function') throw new Error('Vite必须按环境生成配置');
  const config = await factory({ command: 'serve', mode: 'development' });
  expect(config.server?.proxy).toEqual({ '/api': 'http://127.0.0.1:3227', '/health': 'http://127.0.0.1:3227', '/mcp': 'http://127.0.0.1:3227' });
});
