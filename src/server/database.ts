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
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');

export const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: path.join(config.rootDir, 'drizzle') });
sqlite.pragma('optimize');

function seedBaseData() {
  const row = sqlite.prepare('SELECT COUNT(*) AS count FROM work_item_templates WHERE deleted_at IS NULL').get() as { count: number };
  if (row.count > 0) return;
  const now = new Date().toISOString();
  const templateId = randomUUID();
  sqlite.prepare('INSERT INTO work_item_templates (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(templateId, '通用研发模板', now, now);
  const insert = sqlite.prepare(`
    INSERT INTO template_items
      (id, template_id, title, sort_order, start_offset_days, duration_days)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  [
    { title: '设计', offset: 0, duration: 2 },
    { title: '开发', offset: 2, duration: 5 },
    { title: '测试', offset: 7, duration: 3 },
    { title: '发布', offset: 10, duration: 1 },
  ].forEach((item, index) => insert.run(randomUUID(), templateId, item.title, index, item.offset, item.duration));
}

seedBaseData();

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
