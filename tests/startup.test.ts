import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { isServerAlreadyRunning } from '../src/server/startup';

const servers: http.Server[] = [];
const directories: string[] = [];
async function serve(body: unknown, status = 200) {
  const server = http.createServer((_request, response) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, port: (server.address() as { port: number }).port };
}
afterEach(async () => {
  for (const server of servers.splice(0)) {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('启动前检查', () => {
  it('端口空闲时允许启动，检查完成后不占用端口', async () => {
    const { server, port } = await serve({});
    await new Promise<void>(resolve => server.close(() => resolve()));
    expect(await isServerAlreadyRunning({ host: '127.0.0.1', port })).toBe(false);
    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  });

  it('重复启动识别正常服务，同时支持监听所有网卡', async () => {
    const { port } = await serve({ service: 'project-manage', status: 'ok' });
    expect(await isServerAlreadyRunning({ host: '0.0.0.0', port })).toBe(true);
  });

  it.each([
    [{ service: 'another-app', status: 'ok' }, 200],
    [{ service: 'project-manage', status: 'failed' }, 200],
    [{ service: 'project-manage', status: 'ok' }, 503],
  ])('占用端口的其他或异常服务不能被误报为启动成功：%j', async (body, status) => {
    const { port } = await serve(body, status);
    await expect(isServerAlreadyRunning({ host: '127.0.0.1', port })).rejects.toThrow(`端口 ${port} 已被占用`);
  });

  it('实际启动入口重复执行时不打开数据库、不执行迁移或恢复', async () => {
    const { port } = await serve({ service: 'project-manage', status: 'ok' });
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-startup-'));
    directories.push(directory);
    // A directory cannot be opened as a SQLite database. Startup must exit before touching it.
    const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
      cwd: process.cwd(), timeout: 15000, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port),
        DB_PATH: directory, BACKUP_DIR: path.join(directory, 'backups'), SEED_DEMO: '0', NODE_ENV: 'test',
        APP_PASSWORD_HASH: 'startup-test-only', SESSION_SECRET: 'startup-test-secret-more-than-thirty-two-characters' },
    });
    expect(result.stdout).toContain(`已在运行：http://localhost:${port}`);
    expect(result.stderr).not.toContain('SqliteError');
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it('其他服务占用端口时，以独立退出码拒绝启动，启动脚本不尝试数据库恢复', async () => {
    const { port } = await serve({ service: 'another-app', status: 'ok' });
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-startup-conflict-'));
    directories.push(directory);
    const outcome = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
      cwd: process.cwd(), timeout: 15000, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port),
        DB_PATH: directory, BACKUP_DIR: path.join(directory, 'backups'), SEED_DEMO: '0', NODE_ENV: 'test',
        APP_PASSWORD_HASH: 'startup-test-only', SESSION_SECRET: 'startup-test-secret-more-than-thirty-two-characters' },
    }).then(() => null, error => error as { code: number; stderr: string });
    expect(outcome?.code).toBe(64);
    expect(outcome?.stderr).toContain(`端口 ${port} 已被占用`);
    expect(fs.readdirSync(directory)).toEqual([]);
  });
});
