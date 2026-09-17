import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { config } from '../src/server/config';
import { openDatabase } from '../src/server/database';
import { getDatabaseContext, runWithDatabase } from '../src/server/database-context';
import { buildApp } from '../src/server/app';
import { listProjects } from '../src/server/services/projects';

it('导入服务和数据库工厂不打开数据库，失败初始化关闭连接', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-import-context-'));
  try {
    const dbPath = path.join(dir, 'unused.db');
    await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval',
      "await import('./src/server/services/projects.ts'); await import('./src/server/database.ts');"],
    { cwd: process.cwd(), env: { ...process.env, DB_PATH: dbPath, NODE_ENV: 'test' } });
    expect(fs.existsSync(dbPath)).toBe(false);
    await expect(openDatabase({ ...config, dbPath, rootDir: dir, seedDemo: false })).rejects.toThrow();
    fs.renameSync(dbPath, path.join(dir, 'closed.db'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('两个应用显式注入不同数据库，异步请求与业务查询不串库', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-context-'));
  const contexts = await Promise.all(['left', 'right'].map(name => openDatabase({
    ...config, dbPath: path.join(dir, `${name}.db`), backupDir: path.join(dir, name),
    seedDemo: false, appPasswordHash: 'scrypt$context$00',
  })));
  const apps = await Promise.all(contexts.map(context => buildApp(undefined, context)));
  try {
    contexts.forEach((context, index) => context.sqlite.prepare(
      'INSERT INTO projects(id,name,guest_visible,created_at,updated_at) VALUES(?,?,1,?,?)',
    ).run('isolated', `project-${index}`, '2026-09-17', '2026-09-17'));
    const values = await Promise.all(contexts.map((context, index) => runWithDatabase(context, async () => {
      await new Promise(resolve => setTimeout(resolve, index ? 0 : 10));
      expect(getDatabaseContext()).toBe(context);
      return listProjects().find(project => project.id === 'isolated')?.name;
    })));
    expect(values).toEqual(['project-0', 'project-1']);
    const responses = await Promise.all(apps.map(app => app.inject({method: 'GET', url: '/api/projects'})));
    responses.forEach((response, index) => {
      expect(response.statusCode).toBe(200);
      expect(response.json<Array<{id: string; name: string}>>().find(project => project.id === 'isolated')?.name).toBe(`project-${index}`);
    });
  } finally {
    await Promise.all(apps.map(app => app.close()));
    contexts.forEach(context => context.close());
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
