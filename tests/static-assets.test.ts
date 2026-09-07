import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const dbPath = path.join(process.cwd(), 'data', `static-assets-${randomUUID()}.db`);
const assetName = `runtime-${randomUUID()}.js`;
const webDistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-manage-static-assets-'));
const assetPath = path.join(webDistDir, 'assets', assetName);
process.env.WEB_DIST_DIR = webDistDir;
process.env.DB_PATH = dbPath;
process.env.BACKUP_DIR = path.join(process.cwd(), 'data', `static-assets-backups-${randomUUID()}`);
process.env.SEED_DEMO = '0';
process.env.APP_PASSWORD_HASH = 'scrypt$test$00';
process.env.SESSION_SECRET = 'static-assets-test-secret-more-than-32-characters';

let app: FastifyInstance;

beforeAll(async () => {
  fs.mkdirSync(path.dirname(assetPath), { recursive: true });
  fs.writeFileSync(path.join(webDistDir, 'index.html'), '<!doctype html><title>isolated-static-test</title>', 'utf8');
  const module = await import('../src/server/app');
  app = await module.buildApp();
  await app.ready();
  fs.writeFileSync(assetPath, 'window.__runtimeAssetLoaded = true;', 'utf8');
});

afterAll(async () => {
  await app.close();
  const { sqlite } = await import('../src/server/database');
  if (sqlite.open) sqlite.close();
  fs.rmSync(webDistDir, { recursive: true, force: true });
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
  fs.rmSync(process.env.BACKUP_DIR!, { recursive: true, force: true });
});

describe('静态资源服务', () => {
  it('独立静态目录不读取常驻服务的dist', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('<!doctype html><title>isolated-static-test</title>');
  });
  it('进程启动后生成的新散列资源仍按正确MIME返回', async () => {
    const response = await app.inject({ method: 'GET', url: `/assets/${assetName}` });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('javascript');
    expect(response.body).toContain('__runtimeAssetLoaded');
    expect(response.body).not.toContain('<!doctype html>');
  });
});
