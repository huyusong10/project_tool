import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { config } from './config';
import { hashPassword, normalizeUsername } from './auth';
import * as schema from './schema';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const sqlite = new Database(config.dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');

export const db = drizzle(sqlite, { schema });
sqlite.pragma('foreign_keys = OFF');
try {
  migrate(db, { migrationsFolder: path.join(config.rootDir, 'drizzle') });
} finally {
  sqlite.pragma('foreign_keys = ON');
}
const foreignKeyViolations = sqlite.pragma('foreign_key_check') as Array<Record<string, unknown>>;
if (foreignKeyViolations.length) throw new Error(`数据库迁移后存在${foreignKeyViolations.length}条外键异常`);
const projectScopeViolations = sqlite.prepare(`SELECT
  (SELECT COUNT(*) FROM projects p JOIN work_item_templates t ON t.id=p.default_template_id WHERE t.project_id<>p.id) AS projectDefaults,
  (SELECT COUNT(*) FROM requirements r JOIN work_item_templates t ON t.id=r.template_id WHERE t.project_id<>r.project_id) AS requirementTemplates,
  (SELECT COUNT(*) FROM work_items w JOIN requirements r ON r.id=w.requirement_id
    JOIN template_items i ON i.id=w.template_item_id JOIN work_item_templates t ON t.id=i.template_id
    WHERE t.project_id<>r.project_id) AS workItemTemplates`).get() as {
      projectDefaults: number; requirementTemplates: number; workItemTemplates: number;
    };
if (projectScopeViolations.projectDefaults || projectScopeViolations.requirementTemplates || projectScopeViolations.workItemTemplates) {
  throw new Error('数据库迁移后存在跨项目流程引用，服务已拒绝启动');
}
sqlite.pragma('optimize');

function bootstrapAccounts() {
  const now = new Date().toISOString();
  const transaction = sqlite.transaction(() => {
    let builtin = sqlite.prepare('SELECT id FROM accounts WHERE is_builtin=1 LIMIT 1').get() as { id: string } | undefined;
    if (!builtin) {
      const id = randomUUID();
      sqlite.prepare(`INSERT INTO accounts
        (id, username, normalized_username, password_hash, global_role, status, must_change_password, session_version, is_builtin, created_at, updated_at)
        VALUES (?, 'admin', 'admin', ?, 'admin', 'active', 0, 0, 1, ?, ?)`)
        .run(id, config.appPasswordHash, now, now);
      builtin = { id };
    }

    const defaultPasswordHash = hashPassword('888888');
    const people = sqlite.prepare(`SELECT p.id, p.name, p.active, p.deleted_at AS deletedAt
      FROM people p WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.person_id=p.id)
      ORDER BY p.created_at, p.id`).all() as Array<{ id: string; name: string; active: number; deletedAt: string | null }>;
    const exists = sqlite.prepare('SELECT 1 FROM accounts WHERE normalized_username=? LIMIT 1');
    const insert = sqlite.prepare(`INSERT INTO accounts
      (id, username, normalized_username, password_hash, person_id, global_role, status, must_change_password, session_version, is_builtin, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'user', ?, 1, 0, 0, ?, ?)`);
    for (const person of people) {
      const base = person.name.trim() || `user-${person.id.slice(0, 6)}`;
      let username = base;
      let normalized = normalizeUsername(username);
      if (exists.get(normalized)) {
        username = `${base}-${person.id.slice(0, 6)}`;
        normalized = normalizeUsername(username);
      }
      insert.run(randomUUID(), username, normalized, defaultPasswordHash, person.id,
        person.active && !person.deletedAt ? 'active' : 'disabled', now, now);
    }
    sqlite.prepare('UPDATE api_tokens SET account_id=? WHERE account_id IS NULL').run(builtin.id);
  });
  transaction();
}

bootstrapAccounts();
