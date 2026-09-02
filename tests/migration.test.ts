import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';

const dbPath = path.join(process.cwd(), 'data', `migration-${randomUUID()}.db`);
const backupDir = path.join(process.cwd(), 'data', `migration-backups-${randomUUID()}`);

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
});

describe('正式库增量迁移', () => {
  it('保留遗留记录和字段并且重复启动不重复迁移', () => {
    const legacySql = fs.readFileSync(path.join(process.cwd(), 'drizzle', '0000_short_punisher.sql'), 'utf8');
    const db = new Database(dbPath);
    for (const statement of legacySql.split('--> statement-breakpoint').map((value) => value.trim()).filter(Boolean)) db.exec(statement);
    const now = '2026-09-01T00:00:00.000Z';
    db.prepare('INSERT INTO projects (id,name,status,created_at,updated_at) VALUES (?,?,?,?,?)').run('p1', '原项目', 'active', now, now);
    db.prepare('INSERT INTO people (id,name,active,created_at,updated_at) VALUES (?,?,?,?,?)').run('u1', '原人员', 1, now, now);
    db.prepare('INSERT INTO work_item_templates (id,name,created_at,updated_at) VALUES (?,?,?,?)').run('t1', 'DCIM AI工作流', now, now);
    db.prepare('INSERT INTO template_items (id,template_id,title,sort_order) VALUES (?,?,?,?)').run('ti1', 't1', '原模板项', 4);
    db.prepare(`INSERT INTO requirements (id,project_id,title,status,planned_start,planned_end,progress,risk_level,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run('r1', 'p1', '原需求', 'in_progress', '2026-09-01', '2026-09-10', 50, 'low', now, now);
    db.prepare(`INSERT INTO work_items (id,requirement_id,template_item_id,title,status,planned_start,planned_end,actual_start,actual_end,sort_order,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('w1', 'r1', 'ti1', '原工作项', 'not_started', '2026-09-01', '2026-09-03', '2026-09-01', '2026-09-02', 0, now, now);
    db.exec('CREATE TABLE "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)');
    db.prepare('INSERT INTO "__drizzle_migrations" (hash,created_at) VALUES (?,?)')
      .run(createHash('sha256').update(legacySql).digest('hex'), 1788265084830);
    db.close();

    const script = "const m=await import('./src/server/database.ts'); console.log(m.sqlite.prepare('SELECT COUNT(*) AS count FROM work_items').get().count); m.sqlite.close();";
    const env = { ...process.env, DB_PATH: dbPath, BACKUP_DIR: backupDir };
    const first = spawnSync(process.execPath, ['--import', 'tsx', '--eval', script], { cwd: process.cwd(), env, encoding: 'utf8' });
    const second = spawnSync(process.execPath, ['--import', 'tsx', '--eval', script], { cwd: process.cwd(), env, encoding: 'utf8' });
    expect(first.status, first.stderr).toBe(0); expect(second.status, second.stderr).toBe(0);

    const migrated = new Database(dbPath, { readonly: true });
    expect(migrated.prepare('SELECT COUNT(*) AS count FROM work_items').get()).toEqual({ count: 1 });
    expect(migrated.prepare('SELECT title,status,planned_start AS plannedStart,actual_end AS actualEnd FROM work_items WHERE id=?').get('w1'))
      .toEqual({ title: '原工作项', status: 'not_started', plannedStart: '2026-09-01', actualEnd: '2026-09-02' });
    expect(migrated.prepare('SELECT priority FROM requirements WHERE id=?').get('r1')).toEqual({ priority: 'P2' });
    expect(migrated.prepare('SELECT start_offset_days AS offset,duration_days AS duration FROM template_items WHERE id=?').get('ti1'))
      .toEqual({ offset: 4, duration: 1 });
    expect(migrated.prepare('SELECT COUNT(*) AS count FROM work_item_collaborators').get()).toEqual({ count: 0 });
    expect(migrated.prepare('SELECT COUNT(*) AS count FROM issues').get()).toEqual({ count: 0 });
    expect(migrated.prepare('SELECT COUNT(*) AS count FROM issue_updates').get()).toEqual({ count: 0 });
    expect(migrated.prepare('SELECT project_id AS projectId,person_id AS personId FROM project_people').get())
      .toEqual({ projectId: 'p1', personId: 'u1' });
    expect(migrated.prepare('SELECT project_role AS projectRole FROM project_people WHERE project_id=? AND person_id=?').get('p1', 'u1'))
      .toEqual({ projectRole: 'member' });
    expect(migrated.prepare('SELECT COUNT(*) AS count FROM accounts').get()).toEqual({ count: 2 });
    expect(migrated.prepare('SELECT username,global_role AS globalRole,is_builtin AS isBuiltin FROM accounts WHERE is_builtin=1').get())
      .toEqual({ username: 'admin', globalRole: 'admin', isBuiltin: 1 });
    expect(migrated.prepare('SELECT username,must_change_password AS mustChange FROM accounts WHERE person_id=?').get('u1'))
      .toEqual({ username: '原人员', mustChange: 1 });
    expect((migrated.pragma('integrity_check') as Array<{ integrity_check: string }>)[0].integrity_check).toBe('ok');
    migrated.close();
  });
});
