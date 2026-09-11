import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';

it('两个独立部署之间导出、导入、自动重启并登录；恢复库启动失败时自动回滚', { timeout: 60_000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-transfer-journey-'));
  const port = await new Promise<number>((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const value = (probe.address() as net.AddressInfo).port;
      probe.close(() => resolve(value));
    });
  });
  const base = `http://127.0.0.1:${port}`;
  let server: ChildProcess | undefined;
  let output = '';
  const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
  async function stop() {
    if (!server || server.exitCode !== null || !server.pid) return;
    const stopped = new Promise((resolve) => server!.once('exit', resolve));
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else process.kill(-server.pid, 'SIGTERM');
    await stopped;
    server = undefined;
  }
  async function start(name: string, password: string) {
    server = spawn(process.execPath, ['scripts/run-server.mjs', 'src/server/index.ts'], {
      cwd: process.cwd(), windowsHide: true, detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: '--import tsx', NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port),
        DB_PATH: path.join(directory, `${name}.db`), BACKUP_DIR: path.join(directory, `${name}-backups`),
        WEB_DIST_DIR: path.join(directory, 'no-web'), SEED_DEMO: '0', ADMIN_PASSWORD: password,
        SESSION_SECRET: `session-secret-for-${name}-with-more-than-32-characters`,
        SESSION_COOKIE_NAME: 'pm_transfer_journey',
      },
    });
    server.stdout?.on('data', (chunk) => { output = (output + chunk).slice(-20_000); });
    server.stderr?.on('data', (chunk) => { output = (output + chunk).slice(-20_000); });
    for (let attempt = 0; attempt < 150; attempt++) {
      if (server.exitCode !== null) throw new Error(`测试服务退出：${output}`);
      try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* 等待监听。 */ }
      await pause();
    }
    throw new Error(`测试服务没有启动：${output}`);
  }
  async function login(password: string) {
    const response = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password }) });
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
  }
  async function command(url: string, cookie: string, body?: unknown) {
    const response = await fetch(`${base}${url}`, { method: body === undefined ? 'GET' : 'POST', headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    return result;
  }
  async function waitForRestore(password: string, operationId: string, outcome: string) {
    for (let attempt = 0; attempt < 150; attempt++) {
      try {
        const account = await login(password);
        if (account.status === 200) {
          const response = await fetch(`${base}/api/system/overview`, { headers: { cookie: account.cookie } });
          const overview = await response.json();
          if (overview.lastRestore?.operationId === operationId && overview.lastRestore?.outcome === outcome) return account.cookie;
        }
      } catch { /* 切换和重启期间连接暂时不可用。 */ }
      await pause();
    }
    throw new Error(`未获得预期恢复结果 ${outcome}：${output}`);
  }
  async function upload(buffer: Buffer, cookie: string) {
    const response = await fetch(`${base}/api/backups/import?filename=migration.db`, { method: 'POST', headers: { cookie, 'content-type': 'application/octet-stream' }, body: new Uint8Array(buffer) });
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    return result;
  }
  try {
    await start('source', 'Source-admin-2026!');
    let account = await login('Source-admin-2026!');
    expect(account.status).toBe(200);
    const project = await command('/api/projects', account.cookie, { name: '跨机器项目' });
    const person = await command('/api/people', account.cookie, { name: '跨机器成员' });
    const token = await command('/api/tokens', account.cookie, { name: '迁移Token' });
    const backup = await command('/api/backups', account.cookie, {});
    const exportedResponse = await fetch(`${base}/api/backups/${backup.name}/download?expectedFingerprint=${backup.fingerprint}`, { headers: { cookie: account.cookie } });
    expect(exportedResponse.status).toBe(200);
    const exported = Buffer.from(await exportedResponse.arrayBuffer());
    await stop();

    await start('target', 'Target-admin-2026!');
    account = await login('Target-admin-2026!');
    expect(account.status).toBe(200);
    const oldTargetCookie = account.cookie;
    await command('/api/projects', account.cookie, { name: '目标机器旧项目' });
    const uploaded = await upload(exported, account.cookie);
    expect(uploaded.summary).toMatchObject({ projects: 1, people: 1 });
    expect((await command('/api/projects', account.cookie)).some((item: { name: string }) => item.name === '目标机器旧项目')).toBe(true);
    const restored = await command('/api/backups/import/restore', account.cookie, { name: uploaded.name, expectedFingerprint: uploaded.fingerprint });
    account.cookie = await waitForRestore('Target-admin-2026!', restored.operationId, 'succeeded');
    expect((await login('Source-admin-2026!')).status).toBe(401);
    const oldSession = await fetch(`${base}/api/session`, { headers: { cookie: oldTargetCookie } });
    expect((await oldSession.json()).authenticated).toBe(false);
    const projects = await command('/api/projects', account.cookie);
    expect(projects).toEqual([expect.objectContaining({ id: project.id, name: '跨机器项目' })]);
    expect(await command('/api/people', account.cookie)).toEqual([expect.objectContaining({ id: person.id })]);
    const ordinary = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: '跨机器成员', password: '888888' }) });
    expect(ordinary.status).toBe(200);
    const tokens = await command('/api/tokens', account.cookie);
    expect(tokens).toEqual([expect.objectContaining({ id: token.id })]);
    const safety = new Database(path.join(directory, 'target-backups', restored.safetyBackupName), { readonly: true });
    try { expect(safety.prepare('SELECT name FROM projects').all()).toEqual([{ name: '目标机器旧项目' }]); }
    finally { safety.close(); }

    // 此文件能通过结构检查，但启动时清理历史姓名空格的操作会失败。
    const badPath = path.join(directory, 'startup-failure.db');
    fs.writeFileSync(badPath, exported);
    const bad = new Database(badPath);
    try {
      bad.exec(`UPDATE people SET name=' 跨机器成员 ';
        CREATE TRIGGER fail_people_bootstrap BEFORE UPDATE OF name ON people
        BEGIN SELECT RAISE(ABORT, 'simulated startup failure'); END;`);
    } finally { bad.close(); }
    const badUploaded = await upload(fs.readFileSync(badPath), account.cookie);
    const failed = await command('/api/backups/import/restore', account.cookie, { name: badUploaded.name, expectedFingerprint: badUploaded.fingerprint });
    account.cookie = await waitForRestore('Target-admin-2026!', failed.operationId, 'rolled_back');
    expect(await command('/api/projects', account.cookie)).toEqual(projects);
    const overview = await command('/api/system/overview', account.cookie);
    expect(overview.lastRestore.failedDatabase).toContain('failed-restore');
    expect(fs.existsSync(`${path.join(directory, 'target.db')}.pre-restore`)).toBe(false);
  } finally {
    await stop();
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries:10, retryDelay:100 });
  }
});
