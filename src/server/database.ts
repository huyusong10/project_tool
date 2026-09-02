import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { config } from './config';
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
