import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { config } from './config';
import { hashPassword, normalizeUsername } from './auth';
import { ensureBuiltInSampleProject, linkSampleProgressAuthors } from './sample-project';
import { canonicalizeLabel, matchesPlainText, searchScore } from '../shared/search';
import { businessDayDelta } from '../shared/domain';
import * as schema from './schema';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const sqlite = new Database(config.dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');
sqlite.function('search_score', { deterministic: true }, (value: unknown, query: unknown) =>
  searchScore([String(value ?? '')], query));
sqlite.function('search_plain_match', { deterministic: true }, (value: unknown, query: unknown) =>
  matchesPlainText([String(value ?? '')], query) ? 1 : 0);
sqlite.function('business_day_delta', { deterministic: true }, (planned: unknown, actual: unknown) =>
  businessDayDelta(planned == null ? null : String(planned), actual == null ? null : String(actual)));

function latestMigrationTimestamp() {
  const journalPath = path.join(config.rootDir, 'drizzle', 'meta', '_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries?: Array<{ when?: number }> };
  return Math.max(0, ...(journal.entries || []).map((entry) => Number(entry.when) || 0));
}

function appliedMigrationTimestamp() {
  const exists = sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='__drizzle_migrations'").get();
  if (!exists) return 0;
  return Number((sqlite.prepare('SELECT MAX(created_at) AS value FROM __drizzle_migrations').get() as { value?: number | null })?.value || 0);
}

async function backupBeforePendingMigration() {
  if (appliedMigrationTimestamp() >= latestMigrationTimestamp()) return;
  const hasBusinessData = sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name IN ('projects','requirements','work_items') LIMIT 1").get();
  if (!hasBusinessData) return;
  fs.mkdirSync(config.backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let destination = path.join(config.backupDir, `project-manage-pre-migration-${stamp}.db`);
  let suffix = 1;
  while (fs.existsSync(destination)) destination = path.join(config.backupDir, `project-manage-pre-migration-${stamp}-${suffix++}.db`);
  await sqlite.backup(destination);
  const check = new Database(destination, { readonly: true });
  try {
    const integrity = check.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (integrity[0]?.integrity_check !== 'ok') throw new Error('迁移前数据库备份校验失败');
  } finally {
    check.close();
  }
}

await backupBeforePendingMigration();

export const db = drizzle(sqlite, { schema });
sqlite.pragma('foreign_keys = OFF');
try {
  migrate(db, { migrationsFolder: path.join(config.rootDir, 'drizzle') });
} finally {
  sqlite.pragma('foreign_keys = ON');
}

function repairLegacyIdentityText() {
  const transaction = sqlite.transaction(() => {
    const people = sqlite.prepare('SELECT id, name, job_title AS jobTitle FROM people').all() as Array<{ id: string; name: string; jobTitle: string | null }>;
    const updatePerson = sqlite.prepare('UPDATE people SET name=?, job_title=? WHERE id=?');
    for (const person of people) {
      const name = canonicalizeLabel(person.name);
      const jobTitle = person.jobTitle === null ? null : canonicalizeLabel(person.jobTitle) || null;
      if (name !== person.name || jobTitle !== person.jobTitle) updatePerson.run(name, jobTitle, person.id);
    }

    const accounts = (sqlite.prepare(`SELECT id, username, normalized_username AS normalizedUsername, is_builtin AS isBuiltin, created_at AS createdAt
      FROM accounts ORDER BY is_builtin DESC, created_at, id`).all() as Array<{ id: string; username: string; normalizedUsername: string; isBuiltin: number; createdAt: string }>)
      .sort((left, right) => {
        const leftClean = canonicalizeLabel(left.username) === left.username ? 0 : 1;
        const rightClean = canonicalizeLabel(right.username) === right.username ? 0 : 1;
        return left.isBuiltin === right.isBuiltin ? leftClean - rightClean : right.isBuiltin - left.isBuiltin;
      });
    const used = new Set<string>();
    const assignments: Array<{ id: string; username: string; normalized: string; changed: boolean }> = [];
    for (const account of accounts) {
      const base = canonicalizeLabel(account.username) || `user-${account.id.slice(0, 6)}`;
      let username = base;
      let normalized = normalizeUsername(username);
      let suffix = 2;
      while (used.has(normalized)) {
        username = `${base}-${suffix++}`;
        normalized = normalizeUsername(username);
      }
      used.add(normalized);
      assignments.push({ id: account.id, username, normalized, changed: username !== account.username || normalized !== account.normalizedUsername });
    }
    const updateAccount = sqlite.prepare('UPDATE accounts SET username=?, normalized_username=? WHERE id=?');
    for (const assignment of assignments) {
      if (assignment.changed) updateAccount.run(assignment.username, assignment.normalized, assignment.id);
    }
  });
  transaction();
}

repairLegacyIdentityText();
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

ensureBuiltInSampleProject(sqlite, config.seedDemo);
bootstrapAccounts();
linkSampleProgressAuthors(sqlite);

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
const stateViolations = sqlite.prepare(`SELECT
  (SELECT COUNT(*) FROM work_items WHERE
    (status='not_started' AND (progress<>0 OR actual_start IS NOT NULL OR actual_end IS NOT NULL OR blocked_at IS NOT NULL)) OR
    (status='in_progress' AND (progress>=100 OR actual_start IS NULL OR actual_end IS NOT NULL OR blocked_at IS NOT NULL)) OR
    (status='blocked' AND (progress>=100 OR actual_start IS NULL OR actual_end IS NOT NULL OR blocked_at IS NULL OR blocked_reason IS NULL)) OR
    (status='completed' AND (progress<>100 OR actual_start IS NULL OR actual_end IS NULL OR blocked_at IS NOT NULL)) OR
    (status='cancelled' AND (progress>=100 OR actual_end IS NOT NULL OR blocked_at IS NOT NULL))) AS workItems,
  (SELECT COUNT(*) FROM requirements WHERE
    (status='completed' AND (progress<>100 OR accepted_at IS NULL)) OR
    (status='pending_acceptance' AND (progress<>100 OR accepted_at IS NOT NULL)) OR
    (status NOT IN ('completed','pending_acceptance','cancelled') AND (progress>=100 OR accepted_at IS NOT NULL))) AS requirements,
  (SELECT COUNT(*) FROM issues WHERE
    (status='resolved' AND (progress<>100 OR resolved_at IS NULL)) OR
    (status<>'resolved' AND (progress>=100 OR resolved_at IS NOT NULL)) OR
    (status='deferred' AND due_date IS NOT NULL)) AS issues`).get() as { workItems: number; requirements: number; issues: number };
if (stateViolations.workItems || stateViolations.requirements || stateViolations.issues) {
  throw new Error(`数据库状态一致性校验失败：工作项${stateViolations.workItems}、需求${stateViolations.requirements}、问题${stateViolations.issues}`);
}
sqlite.pragma('optimize');
