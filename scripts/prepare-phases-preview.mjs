import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import dotenv from 'dotenv';
import { inspectDatabaseConsistency } from '../src/server/database-validation.ts';
import { reconcileFeatureBranch } from '../src/server/feature-branch-migration.ts';

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
const upgrade = () => {
  database.pragma('foreign_keys=OFF');
  try {
    reconcileFeatureBranch(database, path.join(root, 'drizzle'));
    migrate(drizzle(database), { migrationsFolder: path.join(root, 'drizzle') });
  } finally { database.pragma('foreign_keys=ON'); }
};
upgrade();
const checksum = values => createHash('sha256').update(JSON.stringify(values.map(v => JSON.stringify(v)).sort())).digest('hex');
const checks = [];
for (const [table, rows] of old) {
  const currentName = table === 'requirement_groups' ? 'features' : table;
  const columns = database.pragma('table_info(' + quote(currentName) + ')').map(c => c.name);
  const normalized = rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [table === 'requirements' && key === 'group_id' ? 'feature_id' : key, value])));
  // Ownership migration changes only the affected requirement's feature,
  // version and update timestamp. Compare every other historical value.
  if (table === 'requirements') for (const row of normalized) if (row.feature_id == null) {
    const current = database.prepare('SELECT feature_id,version,updated_at FROM requirements WHERE id=?').get(row.id);
    const feature = database.prepare('SELECT name,project_id FROM features WHERE id=?').get(current.feature_id);
    if (feature?.name !== '其他特性' || feature.project_id !== row.project_id || current.version !== row.version + 1) throw new Error('默认特性归属或版本不正确');
    Object.assign(row, current);
  }
  const preservedColumns = Object.keys(normalized[0] || {}).filter(key => columns.includes(key) && !(table === 'projects' && key === 'analysis_revision'));
  const select = row => Object.fromEntries(preservedColumns.map(key => [key, row[key]]));
  const all = database.prepare('SELECT * FROM ' + quote(currentName)).all();
  const originalIds = new Set(rows.map(r => r.id));
  const now = ['features','audit_logs'].includes(currentName) ? all.filter(r => originalIds.has(r.id)) : all;
  const passed = now.length === rows.length && checksum(normalized.map(select)) === checksum(now.map(select));
  checks.push({ table: currentName, rows: rows.length, preserved: passed });
}
const consistency = inspectDatabaseConsistency(database);
const allTables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
const stateChecksum = () => checksum(allTables.map(({name}) => [name, checksum(database.prepare('SELECT * FROM '+quote(name)).all())]));
const beforeRestart = stateChecksum();
upgrade();
const repeated = beforeRestart === stateChecksum();
const unassignedCount = database.prepare('SELECT COUNT(*) AS n FROM requirements WHERE feature_id IS NULL').get().n;
const otherFeatures = database.prepare("SELECT COUNT(*) AS n FROM features WHERE name='其他特性'").get().n;
const integrity = database.pragma('integrity_check');
const report = { source: sourcePath, snapshot: destination, capturedAt: new Date().toISOString(), checks, consistency, integrity, repeated, unassignedCount, otherFeatures, phaseCount: database.prepare('SELECT COUNT(*) AS count FROM feature_phases').get().count };
database.close();
fs.writeFileSync(path.join(preview, 'migration-report.json'), JSON.stringify(report, null, 2));
if (checks.some(c => !c.preserved) || Object.values(consistency.projectScope).some(Boolean) || Object.values(consistency.state).some(Boolean) || consistency.foreignKeys || consistency.phases || !repeated || unassignedCount || integrity[0]?.integrity_check !== 'ok') throw new Error('迁移核验未通过，请检查 .preview/migration-report.json');
console.log(JSON.stringify({ tables: checks.length, rows: checks.reduce((n, c) => n + c.rows, 0), consistency, repeated, unassignedCount, otherFeatures, phaseCount: report.phaseCount, report: path.join(preview, 'migration-report.json') }, null, 2));
