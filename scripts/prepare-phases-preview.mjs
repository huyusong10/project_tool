import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import dotenv from 'dotenv';
import { inspectDatabaseConsistency } from '../src/server/database-validation.ts';

const root = process.cwd(), preview = path.join(root, '.preview');
if (path.basename(root) !== 'project-manage-phases') throw new Error('请在隔离 worktree 中执行');
fs.mkdirSync(preview, { recursive: true });
const configPath = path.join(preview, 'preview-env.json');
if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, JSON.stringify({ HOST: '127.0.0.1', PORT: '3260', DB_PATH: path.join(preview, 'demo.db'), BACKUP_DIR: path.join(preview, 'backups'), SESSION_COOKIE_NAME: 'pm_phases_preview', SESSION_SECRET: randomBytes(32).toString('hex'), ADMIN_PASSWORD: 'PreviewPhases2026!', SEED_DEMO: '0', NODE_ENV: 'production' }, null, 2));

const sourceRoot = path.resolve(root, '../project-manage');
const sourceEnv = dotenv.parse(fs.readFileSync(path.join(sourceRoot, '.env')));
const sourcePath = path.resolve(sourceRoot, sourceEnv.DB_PATH || 'data/project-manage.db');
const destination = path.join(preview, 'migration-' + Date.now() + '.db');
const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
await source.backup(destination); source.close();
const database = new Database(destination); database.pragma('foreign_keys=ON');
const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'__drizzle_migrations' ORDER BY name").all().map(r => r.name);
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const old = new Map(tables.map(table => [table, database.prepare('SELECT * FROM ' + quote(table)).all()]));
migrate(drizzle(database), { migrationsFolder: path.join(root, 'drizzle') });
const checksum = values => createHash('sha256').update(JSON.stringify(values.map(v => JSON.stringify(v)).sort())).digest('hex');
const checks = [];
for (const [table, rows] of old) {
  const currentName = table === 'requirement_groups' ? 'features' : table;
  const columns = database.pragma('table_info(' + quote(currentName) + ')').map(c => c.name);
  const normalized = rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [table === 'requirements' && key === 'group_id' ? 'feature_id' : key, value])));
  const preservedColumns = Object.keys(normalized[0] || {}).filter(key => columns.includes(key) && !(table === 'projects' && key === 'analysis_revision'));
  const select = row => Object.fromEntries(preservedColumns.map(key => [key, row[key]]));
  const now = database.prepare('SELECT * FROM ' + quote(currentName)).all();
  const passed = now.length === rows.length && checksum(normalized.map(select)) === checksum(now.map(select));
  checks.push({ table: currentName, rows: rows.length, preserved: passed });
}
const consistency = inspectDatabaseConsistency(database);
const beforeRestart = checksum(database.prepare('SELECT * FROM requirements ORDER BY id').all());
migrate(drizzle(database), { migrationsFolder: path.join(root, 'drizzle') });
const repeated = beforeRestart === checksum(database.prepare('SELECT * FROM requirements ORDER BY id').all());
const report = { source: sourcePath, snapshot: destination, capturedAt: new Date().toISOString(), checks, consistency, repeated, phaseCount: database.prepare('SELECT COUNT(*) AS count FROM feature_phases').get().count };
database.close();
fs.writeFileSync(path.join(preview, 'migration-report.json'), JSON.stringify(report, null, 2));
if (checks.some(c => !c.preserved) || Object.values(consistency.projectScope).some(Boolean) || Object.values(consistency.state).some(Boolean) || consistency.foreignKeys || consistency.phases || !repeated) throw new Error('迁移核验未通过，请检查 .preview/migration-report.json');
console.log(JSON.stringify({ tables: checks.length, rows: checks.reduce((n, c) => n + c.rows, 0), consistency, repeated, phaseCount: report.phaseCount, report: path.join(preview, 'migration-report.json') }, null, 2));
