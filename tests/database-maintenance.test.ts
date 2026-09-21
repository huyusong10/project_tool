import http from 'node:http';
import { scryptSync } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { pauseDatabaseRequests, resumeDatabaseRequests } from '../src/server/database-maintenance';
import { createTestApp } from './support/test-app';
import { listenTestApp } from './support/listen';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

it('断开的客户端仍等待服务端写入结束，随后恢复维护并允许新请求', async () => {
  const f = await createTestApp(), started = deferred(), release = deferred(), disconnected = deferred();
  f.app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/api/maintenance-probe') reply.raw.once('close', disconnected.resolve);
  });
  let writes = 0;
  f.app.post('/api/maintenance-probe', async () => {
    started.resolve(); await release.promise;
    const now = new Date().toISOString();
    f.context.sqlite.prepare("INSERT INTO projects(id,name,created_at,updated_at) VALUES('after-disconnect','继续执行的写入',?,?)").run(now, now);
    writes++; return { ok: true };
  });
  const origin = await listenTestApp(f.app);
  const request = http.request(origin + '/api/maintenance-probe', { method: 'POST' });
  request.on('error', () => {}); request.end();
  try {
    await started.promise; request.destroy(); await disconnected.promise;
    let ready = false;
    const paused = pauseDatabaseRequests(f.context).then(() => { ready = true; });
    await delay(60);
    expect(ready).toBe(false); expect(writes).toBe(0);
    expect((await f.app.inject({ method: 'GET', url: '/api/projects' })).statusCode).toBe(503);
    release.resolve(); await paused;
    expect(writes).toBe(1);
    expect(f.context.sqlite.prepare("SELECT name FROM projects WHERE id='after-disconnect'").get()).toEqual({ name: '继续执行的写入' });
    resumeDatabaseRequests(f.context);
    expect((await f.app.inject({ method: 'GET', url: '/api/projects' })).statusCode).toBe(200);
  } finally { release.resolve(); resumeDatabaseRequests(f.context); request.destroy(); await f.close(); }
}, 15000);

it('真实备份下载中断后不阻止下一次恢复维护', async () => {
  const f = await createTestApp(), disconnected = deferred();
  f.app.addHook('onRequest', async (request, reply) => {
    if (request.url.includes('/download?')) reply.raw.once('close', disconnected.resolve);
  });
  const password = 'maintenance-backup-test-password';
  f.context.sqlite.prepare("UPDATE accounts SET password_hash=? WHERE username='admin'").run('scrypt$maintenance$' + scryptSync(password, 'maintenance', 64).toString('hex'));
  try {
    const login = await f.app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password } });
    expect(login.statusCode, login.body).toBe(200);
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const now = new Date().toISOString();
    f.context.sqlite.prepare("INSERT INTO projects(id,name,created_at,updated_at) VALUES('backup-large','下载中断验证',?,?)").run(now, now);
    const insert = f.context.sqlite.prepare("INSERT INTO requirements(id,project_id,title,background,created_at,updated_at) VALUES(?,'backup-large',?,?,?,?)");
    f.context.sqlite.transaction(() => { for (let i = 0; i < 4000; i++) insert.run('download-' + i, '需求 ' + i, 'a'.repeat(2000), now, now); })();
    const backupResponse = await f.app.inject({ method: 'POST', url: '/api/backups', headers: { cookie }, payload: {} });
    expect(backupResponse.statusCode, backupResponse.body).toBe(200);
    const backup = backupResponse.json();
    const origin = await listenTestApp(f.app);
    let received = 0;
    await new Promise<void>((resolve, reject) => {
      const request = http.get(origin + '/api/backups/' + encodeURIComponent(backup.name) + '/download?expectedFingerprint=' + backup.fingerprint, { headers: { cookie } }, response => {
        if (response.statusCode !== 200) { response.resume(); reject(new Error('备份下载状态：' + response.statusCode)); return; }
        response.on('error', error => { if (!received) reject(error); });
        response.once('data', (chunk: Buffer) => { received += chunk.length; request.destroy(); response.destroy(); resolve(); });
      });
      request.on('error', error => { if (!received) reject(error); });
    });
    await disconnected.promise;
    expect(received).toBeGreaterThan(0); expect(received).toBeLessThan(backup.size);
    await pauseDatabaseRequests(f.context);
    resumeDatabaseRequests(f.context);
    expect((await f.app.inject({ method: 'GET', url: '/api/backups', headers: { cookie } })).statusCode).toBe(200);
    expect(f.context.sqlite.prepare("SELECT COUNT(*) AS count FROM requirements WHERE project_id='backup-large'").get()).toEqual({ count: 4000 });
    expect(f.context.sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally { resumeDatabaseRequests(f.context); await f.close(); }
}, 15000);
