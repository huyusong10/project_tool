import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';

const dbPath = path.join(process.cwd(), 'data', `migration-${randomUUID()}.db`);
const backupDir = path.join(process.cwd(), 'data', `migration-backups-${randomUUID()}`);
let migratedDb: InstanceType<typeof Database> | null = null;

afterAll(() => {
  migratedDb?.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
  for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(`${dbPath}.restore${suffix}`, { force: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
});

describe('正式库增量迁移', () => {
  it('保留遗留记录和字段并且重复启动不重复迁移', () => {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const legacySql = fs.readFileSync(path.join(process.cwd(), 'drizzle', '0000_short_punisher.sql'), 'utf8');
    const db = new Database(dbPath);
    for (const statement of legacySql.split('--> statement-breakpoint').map((value) => value.trim()).filter(Boolean)) db.exec(statement);
    const now = '2026-09-01T00:00:00.000Z';
    db.prepare('INSERT INTO projects (id,name,status,created_at,updated_at) VALUES (?,?,?,?,?)').run('p1', '原项目', 'active', now, now);
    db.prepare('INSERT INTO projects (id,name,status,created_at,updated_at) VALUES (?,?,?,?,?)').run('p2', '第二项目', 'active', now, now);
    db.prepare('INSERT INTO people (id,name,active,created_at,updated_at) VALUES (?,?,?,?,?)').run('u1', '原人员', 1, now, now);
    db.prepare('INSERT INTO work_item_templates (id,name,created_at,updated_at) VALUES (?,?,?,?)').run('t1', 'DCIM AI工作流', now, now);
    db.prepare('INSERT INTO template_items (id,template_id,title,sort_order) VALUES (?,?,?,?)').run('ti1', 't1', '原模板项', 4);
    db.prepare(`INSERT INTO requirements (id,project_id,title,owner_id,status,planned_start,planned_end,progress,risk_level,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run('r1', 'p1', '原需求', 'u1', 'in_progress', '2026-09-01', '2026-09-10', 50, 'low', now, now);
    db.prepare(`INSERT INTO work_items (id,requirement_id,template_item_id,title,status,planned_start,planned_end,actual_start,actual_end,sort_order,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('w1', 'r1', 'ti1', '原工作项', 'not_started', '2026-09-01', '2026-09-03', '2026-09-01', '2026-09-02', 0, now, now);
    db.prepare(`INSERT INTO progress_updates (id,requirement_id,work_item_id,percent,content,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)`).run('pu1', 'r1', 'w1', 50, '原进展', now, now);
    db.prepare(`INSERT INTO requirements (id,project_id,title,status,planned_start,planned_end,progress,risk_level,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run('r2', 'p2', '第二项目需求', 'planning', '2026-09-01', '2026-09-10', 0, 'low', now, now);
    db.prepare(`INSERT INTO work_items (id,requirement_id,template_item_id,title,status,planned_start,planned_end,sort_order,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run('w2', 'r2', 'ti1', '第二工作项', 'not_started', '2026-09-01', '2026-09-03', 0, now, now);
    db.exec('CREATE TABLE "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)');
    db.prepare('INSERT INTO "__drizzle_migrations" (hash,created_at) VALUES (?,?)')
      .run(createHash('sha256').update(legacySql).digest('hex'), 1788265084830);
    db.close();

    const script = "const m=await import('./src/server/database.ts'); console.log(m.sqlite.prepare('SELECT COUNT(*) AS count FROM work_items').get().count); m.sqlite.close();";
    const env = { ...process.env, DB_PATH: dbPath, BACKUP_DIR: backupDir, SEED_DEMO: '0' };
    const first = spawnSync(process.execPath, ['--import', 'tsx', '--eval', script], { cwd: process.cwd(), env, encoding: 'utf8' });
    const second = spawnSync(process.execPath, ['--import', 'tsx', '--eval', script], { cwd: process.cwd(), env, encoding: 'utf8' });
    expect(first.status, first.stderr).toBe(0); expect(second.status, second.stderr).toBe(0);
    const migrationBackups = fs.readdirSync(backupDir).filter((name) => name.endsWith('.db'));
    expect(migrationBackups).toHaveLength(1);
    expect(fs.readdirSync(backupDir)).toEqual(migrationBackups);
    const migrationBackup = new Database(path.join(backupDir, migrationBackups[0]), { readonly: true });
    expect(migrationBackup.prepare('SELECT COUNT(*) AS count FROM work_items').get()).toEqual({ count: 2 });
    expect((migrationBackup.pragma('integrity_check') as Array<{ integrity_check: string }>)[0].integrity_check).toBe('ok');
    migrationBackup.close();

    const restoreScript = `const backups=await import('./src/server/backups.ts'); const database=await import('./src/server/database.ts'); const prepared=await backups.prepareRestore(${JSON.stringify(migrationBackups[0])}); console.log('prepared=' + prepared.source); database.sqlite.close();`;
    const restored = spawnSync(process.execPath, ['--import', 'tsx', '--eval', restoreScript], { cwd: process.cwd(), env, encoding: 'utf8' });
    expect(restored.status, restored.stderr).toBe(0);
    expect(restored.stdout).toContain(`prepared=${dbPath}.restore`);
    const restoredCopy = new Database(`${dbPath}.restore`, { readonly: true });
    expect(restoredCopy.prepare('SELECT title FROM requirements WHERE id=?').get('r1')).toEqual({ title: '原需求' });
    expect(restoredCopy.prepare("SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name='accounts'").get()).toEqual({ present: 1 });
    expect((restoredCopy.pragma('integrity_check') as Array<{ integrity_check: string }>)[0].integrity_check).toBe('ok');
    restoredCopy.close();

    const migrated = migratedDb = new Database(dbPath, { readonly: true });
    expect(migrated.prepare('SELECT COUNT(*) AS count FROM work_items').get()).toEqual({ count: 2 });
    expect(migrated.prepare('SELECT title,status,progress,planned_start AS plannedStart,actual_end AS actualEnd FROM work_items WHERE id=?').get('w1'))
      .toEqual({ title: '原工作项', status: 'completed', progress: 100, plannedStart: '2026-09-01', actualEnd: '2026-09-02' });
    expect(migrated.prepare('SELECT priority,progress FROM requirements WHERE id=?').get('r1')).toEqual({ priority: 'P2', progress: 100 });
    expect(migrated.prepare('SELECT planned_start AS plannedStart,planned_end AS plannedEnd FROM requirements WHERE id=?').get('r1'))
      .toEqual({ plannedStart: '2026-09-01', plannedEnd: '2026-09-03' });
    expect(migrated.prepare(`SELECT background,acceptance_criteria AS acceptanceCriteria,reference_url AS referenceUrl
      FROM requirements WHERE id=?`).get('r1')).toEqual({ background: null, acceptanceCriteria: null, referenceUrl: null });
    const stateReport = JSON.parse((migrated.prepare("SELECT value FROM system_meta WHERE key='state-migration-0013-report'").get() as { value: string }).value);
    expect(stateReport.workItems).toBeGreaterThan(0);
    expect(migrated.prepare('SELECT status,accepted_at AS acceptedAt,version FROM requirements WHERE id=?').get('r1'))
      .toMatchObject({ status: 'completed', acceptedAt: expect.any(String), version: 1 });
    expect(migrated.prepare('SELECT event_type AS eventType FROM progress_updates WHERE id=?').get('pu1')).toEqual({ eventType: 'note' });
    const migratedTemplates = migrated.prepare('SELECT id,project_id AS projectId FROM work_item_templates WHERE name=? ORDER BY project_id').all('DCIM AI工作流') as Array<{ id: string; projectId: string }>;
    expect(migratedTemplates.map((item) => item.projectId)).toEqual(['p1', 'p2']);
    expect(new Set(migratedTemplates.map((item) => item.id)).size).toBe(2);
    const migratedTemplate = migratedTemplates[0];
    const secondTemplate = migratedTemplates[1];
    expect(migrated.prepare('SELECT template_id AS templateId FROM requirements WHERE id=?').get('r1')).toEqual({ templateId: migratedTemplate.id });
    expect(migrated.prepare('SELECT template_id AS templateId FROM requirements WHERE id=?').get('r2')).toEqual({ templateId: secondTemplate.id });
    expect(migrated.prepare(`SELECT start_offset_days AS offset,duration_days AS duration FROM template_items WHERE template_id=? AND title='原模板项'`).get(migratedTemplate.id))
      .toEqual({ offset: 4, duration: 1 });
    const firstMappedItem = migrated.prepare('SELECT template_item_id AS templateItemId FROM work_items WHERE id=?').get('w1') as { templateItemId: string };
    const secondMappedItem = migrated.prepare('SELECT template_item_id AS templateItemId FROM work_items WHERE id=?').get('w2') as { templateItemId: string };
    expect(firstMappedItem.templateItemId).not.toBe(secondMappedItem.templateItemId);
    expect(migrated.prepare('SELECT template_id AS templateId FROM template_items WHERE id=?').get(firstMappedItem.templateItemId)).toEqual({ templateId: migratedTemplate.id });
    expect(migrated.prepare('SELECT template_id AS templateId FROM template_items WHERE id=?').get(secondMappedItem.templateItemId)).toEqual({ templateId: secondTemplate.id });
    expect(migrated.prepare('SELECT COUNT(*) AS count FROM work_item_collaborators').get()).toEqual({ count: 0 });
    expect(migrated.prepare('SELECT COUNT(*) AS count FROM issues').get()).toEqual({ count: 0 });
    expect(migrated.prepare('SELECT COUNT(*) AS count FROM issue_updates').get()).toEqual({ count: 0 });
    expect(migrated.prepare(`SELECT COUNT(*) AS count FROM pragma_table_info('progress_updates') WHERE name='work_item_percent'`).get()).toEqual({ count: 1 });
    expect(migrated.prepare(`SELECT COUNT(*) AS count FROM pragma_table_info('template_items') WHERE name='milestone_label'`).get()).toEqual({ count: 1 });
    expect(migrated.prepare(`SELECT COUNT(*) AS count FROM pragma_table_info('work_items') WHERE name='milestone_label'`).get()).toEqual({ count: 1 });
    expect(migrated.prepare('SELECT milestone_label AS milestoneLabel FROM work_items WHERE id=?').get('w1')).toEqual({ milestoneLabel: null });
    expect(migrated.prepare('SELECT description FROM work_item_templates WHERE id=?').get(migratedTemplate.id)).toEqual({ description: '' });
    expect(migrated.prepare('SELECT project_id AS projectId,person_id AS personId FROM project_people').get())
      .toEqual({ projectId: 'p1', personId: 'u1' });
    expect(migrated.prepare('SELECT project_role AS projectRole FROM project_people WHERE project_id=? AND person_id=?').get('p1', 'u1'))
      .toEqual({ projectRole: 'member' });
    expect(migrated.prepare('SELECT COUNT(*) AS count FROM accounts').get()).toEqual({ count: 2 });
    expect(migrated.prepare('SELECT COUNT(*) AS count FROM analytics_layouts').get()).toEqual({ count: 0 });
    expect((migrated.pragma('foreign_key_list(analytics_layouts)') as Array<{ table: string; on_delete: string }>)[0])
      .toMatchObject({ table: 'accounts', on_delete: 'CASCADE' });
    expect(migrated.prepare('SELECT username,global_role AS globalRole,is_builtin AS isBuiltin FROM accounts WHERE is_builtin=1').get())
      .toEqual({ username: 'admin', globalRole: 'admin', isBuiltin: 1 });
    expect(migrated.prepare('SELECT username,must_change_password AS mustChange FROM accounts WHERE person_id=?').get('u1'))
      .toEqual({ username: '原人员', mustChange: 1 });
    expect(migrated.prepare(`SELECT COUNT(*) AS count FROM pragma_table_info('accounts') WHERE name='deleted_at'`).get()).toEqual({ count: 1 });
    expect((migrated.pragma('integrity_check') as Array<{ integrity_check: string }>)[0].integrity_check).toBe('ok');
    expect(migrated.pragma('foreign_key_check')).toEqual([]);
    migrated.close(); migratedDb = null;
  });
});
