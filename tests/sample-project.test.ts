import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { Actor } from '../src/server/auth';

const dbPath = path.join(process.cwd(), 'data', `sample-project-${randomUUID()}.db`);
process.env.DB_PATH = dbPath;
process.env.BACKUP_DIR = path.join(process.cwd(), 'data', `sample-project-backups-${randomUUID()}`);
process.env.SEED_DEMO = '1';
process.env.APP_PASSWORD_HASH = 'scrypt$test$00';
process.env.SESSION_SECRET = 'sample-project-test-secret-more-than-32-chars';

let sqlite: Database.Database;
let services: typeof import('../src/server/services');
let sample: typeof import('../src/server/sample-project');

const actor: Actor = { type: 'user', id: 'sample-test-admin', label: '测试管理员', globalRole: 'admin' };

beforeAll(async () => {
  ({ sqlite } = await import('./support/database'));
  services = await import('../src/server/services');
  sample = await import('../src/server/sample-project');
});

afterAll(() => {
  if (sqlite.open) sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
  fs.rmSync(process.env.BACKUP_DIR!, { recursive: true, force: true });
});

describe('内置样板项目', () => {
  it('只创建一次并生成可演示的完整数据', () => {
    const project = services.listProjects(false, actor).find((item) => item.id === sample.SAMPLE_PROJECT_ID);
    expect(project).toMatchObject({ name: '研发协同功能样板（可删除）', isSample: true });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM people WHERE id LIKE 'sample-v1-person-%'").get()).toEqual({ count: 6 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM requirements WHERE project_id=?').get(sample.SAMPLE_PROJECT_ID)).toEqual({ count: 7 });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM work_items w JOIN requirements r ON r.id=w.requirement_id
      WHERE r.project_id=?`).get(sample.SAMPLE_PROJECT_ID)).toEqual({ count: 36 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM issues WHERE project_id=?').get(sample.SAMPLE_PROJECT_ID)).toEqual({ count: 5 });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM progress_updates u JOIN requirements r ON r.id=u.requirement_id
      WHERE r.project_id=? AND u.created_by_account_id IS NOT NULL`).get(sample.SAMPLE_PROJECT_ID)).toEqual({ count: 8 });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM issue_updates u JOIN issues i ON i.id=u.issue_id
      WHERE i.project_id=? AND u.created_by_account_id IS NOT NULL`).get(sample.SAMPLE_PROJECT_ID)).toEqual({ count: 8 });

    const requirements = services.listRequirements({ projectId: sample.SAMPLE_PROJECT_ID, includeDeleted: true });
    expect(requirements.find((item) => item.id.endsWith('-permission'))).toMatchObject({ status: 'in_progress', riskLevel: 'high' });
    expect(requirements.find((item) => item.id.endsWith('-dashboard'))).toMatchObject({ status: 'in_progress', riskLevel: 'medium' });
    expect(requirements.find((item) => item.id.endsWith('-login'))).toMatchObject({ status: 'completed', progress: 100 });
    expect(requirements.filter((item) => item.deletedAt)).toHaveLength(1);

    expect(sample.ensureBuiltInSampleProject(sqlite, true)).toBe(false);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM projects WHERE id=?').get(sample.SAMPLE_PROJECT_ID)).toEqual({ count: 1 });
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('归档同步人员，永久删除后不重建且保留外部引用人员', () => {
    const now = new Date().toISOString();
    const externalProjectId = 'sample-test-external-project';
    const retainedPersonId = sample.SAMPLE_PERSON_IDS[0];
    const archivedPersonId = sample.SAMPLE_PERSON_IDS[1];
    const futureVersion = '2099-01-01T00:00:00.000Z';
    sqlite.prepare(`INSERT INTO projects (id,name,status,created_at,updated_at) VALUES (?, '外部项目', 'active', ?, ?)`)
      .run(externalProjectId, now, now);
    sqlite.prepare(`INSERT INTO project_people (project_id,person_id,project_role,created_at) VALUES (?, ?, 'member', ?)`)
      .run(externalProjectId, retainedPersonId, now);
    sqlite.prepare("UPDATE accounts SET status='disabled', updated_at=? WHERE person_id=?").run(futureVersion, retainedPersonId);
    sqlite.prepare('UPDATE people SET updated_at=? WHERE id=?').run(futureVersion, archivedPersonId);
    sqlite.prepare('UPDATE accounts SET updated_at=? WHERE person_id=?').run(futureVersion, archivedPersonId);

    expect(() => services.archiveProject(sample.SAMPLE_PROJECT_ID, actor)).toThrow('活跃需求');
    sqlite.prepare(`UPDATE requirements SET status='cancelled', progress=MIN(progress,99), accepted_at=NULL WHERE project_id=? AND deleted_at IS NULL`).run(sample.SAMPLE_PROJECT_ID);
    sqlite.prepare(`UPDATE issues SET status='resolved', progress=100, resolved_at=COALESCE(resolved_at,date('now')) WHERE project_id=?`).run(sample.SAMPLE_PROJECT_ID);
    services.archiveProject(sample.SAMPLE_PROJECT_ID, actor);
    expect(sqlite.prepare('SELECT deleted_at AS deletedAt FROM projects WHERE id=?').get(sample.SAMPLE_PROJECT_ID))
      .toMatchObject({ deletedAt: expect.any(String) });
    expect(sqlite.prepare('SELECT active,deleted_at AS deletedAt FROM people WHERE id=?').get(retainedPersonId))
      .toMatchObject({ active: 1, deletedAt: null });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM people WHERE id LIKE 'sample-v1-person-%' AND deleted_at IS NOT NULL").get())
      .toEqual({ count: 5 });
    const archivedVersions = sqlite.prepare(`SELECT p.updated_at AS personUpdatedAt, a.updated_at AS accountUpdatedAt
      FROM people p JOIN accounts a ON a.person_id=p.id WHERE p.id=?`).get(archivedPersonId) as { personUpdatedAt: string; accountUpdatedAt: string };
    expect(Date.parse(archivedVersions.personUpdatedAt)).toBeGreaterThan(Date.parse(futureVersion));
    expect(Date.parse(archivedVersions.accountUpdatedAt)).toBeGreaterThan(Date.parse(futureVersion));
    expect(sqlite.prepare('SELECT status, updated_at AS updatedAt FROM accounts WHERE person_id=?').get(retainedPersonId))
      .toEqual({ status: 'disabled', updatedAt: futureVersion });

    services.restoreProject(sample.SAMPLE_PROJECT_ID, actor);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM people WHERE id LIKE 'sample-v1-person-%' AND active=1 AND deleted_at IS NULL").get())
      .toEqual({ count: 6 });
    const restoredVersions = sqlite.prepare(`SELECT p.updated_at AS personUpdatedAt, a.updated_at AS accountUpdatedAt
      FROM people p JOIN accounts a ON a.person_id=p.id WHERE p.id=?`).get(archivedPersonId) as { personUpdatedAt: string; accountUpdatedAt: string };
    expect(Date.parse(restoredVersions.personUpdatedAt)).toBeGreaterThan(Date.parse(archivedVersions.personUpdatedAt));
    expect(Date.parse(restoredVersions.accountUpdatedAt)).toBeGreaterThan(Date.parse(archivedVersions.accountUpdatedAt));
    expect(sqlite.prepare('SELECT status, updated_at AS updatedAt FROM accounts WHERE person_id=?').get(retainedPersonId))
      .toEqual({ status: 'disabled', updatedAt: futureVersion });

    services.archiveProject(sample.SAMPLE_PROJECT_ID, actor);
    const currentArchive = sqlite.prepare('SELECT deleted_at AS deletedAt FROM projects WHERE id=?').get(sample.SAMPLE_PROJECT_ID) as { deletedAt: string };
    services.permanentlyDeleteArchive('projects', sample.SAMPLE_PROJECT_ID, actor, {
      confirmName: '研发协同功能样板（可删除）', expectedDeletedAt: currentArchive.deletedAt,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM projects WHERE id=?').get(sample.SAMPLE_PROJECT_ID)).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM people WHERE id=?').get(retainedPersonId)).toEqual({ count: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM people WHERE id LIKE 'sample-v1-person-%'").get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT status FROM accounts WHERE person_id=?').get(retainedPersonId)).toEqual({ status: 'disabled' });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM system_meta WHERE key=?').get(sample.SAMPLE_META_KEY)).toEqual({ count: 1 });
    expect(sample.ensureBuiltInSampleProject(sqlite, true)).toBe(false);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM projects WHERE id=?').get(sample.SAMPLE_PROJECT_ID)).toEqual({ count: 0 });
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });
});
