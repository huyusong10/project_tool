import { randomUUID } from 'node:crypto';
import type { Actor } from '../auth';
import { getDatabaseContext } from '../database-context';

function row<T>(sql: string, ...params: unknown[]) {
  return getDatabaseContext().sqlite.prepare(sql).get(...params) as T | undefined;
}

function rows<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
  return getDatabaseContext().sqlite.prepare(sql).all(...params) as T[];
}

function auditProjectId(entityType: string, entityId: string | null): string | null {
  if (!entityId) return null;
  if (entityType === 'project') return entityId;
  if (entityType === 'template') return row<{ projectId: string }>('SELECT project_id AS projectId FROM work_item_templates WHERE id=?', entityId)?.projectId || null;
  if (entityType === 'requirement') return row<{ projectId: string }>('SELECT project_id AS projectId FROM requirements WHERE id=?', entityId)?.projectId || null;
  if (entityType === 'issue') return row<{ projectId: string }>('SELECT project_id AS projectId FROM issues WHERE id=?', entityId)?.projectId || null;
  if (entityType === 'work_item') return row<{ projectId: string }>(`SELECT r.project_id AS projectId FROM work_items w JOIN requirements r ON r.id=w.requirement_id WHERE w.id=?`, entityId)?.projectId || null;
  if (entityType === 'progress') return row<{ projectId: string }>(`SELECT r.project_id AS projectId FROM progress_updates u JOIN requirements r ON r.id=u.requirement_id WHERE u.id=?`, entityId)?.projectId || null;
  if (entityType === 'issue_update') return row<{ projectId: string }>(`SELECT i.project_id AS projectId FROM issue_updates u JOIN issues i ON i.id=u.issue_id WHERE u.id=?`, entityId)?.projectId || null;
  return null;
}

export type AuditEntry = {
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  projectId?: string | null;
};

export function recordAudits(actor: Actor, entries: AuditEntry[]) {
  const insert = getDatabaseContext().sqlite.prepare(`INSERT INTO audit_logs (id, actor_type, actor_id, action, entity_type, entity_id, project_id, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const entry of entries) {
    const scopeProjectId = entry.projectId === undefined ? auditProjectId(entry.entityType, entry.entityId) : entry.projectId;
    insert.run(randomUUID(), actor.type, actor.id, entry.action, entry.entityType, entry.entityId, scopeProjectId, entry.summary, new Date().toISOString());
  }
}

export function recordAudit(actor: Actor, action: string, entityType: string, entityId: string | null, summary: string, projectId?: string | null) {
  recordAudits(actor, [{ action, entityType, entityId, summary, projectId }]);
}

const auditSelect = `SELECT l.id, l.actor_type AS actorType, l.actor_id AS actorId,
  CASE WHEN l.actor_type='user' THEN user_account.username WHEN l.actor_type='token' THEN token_account.username END AS actorName,
  actor_token.name AS tokenName, l.action, l.entity_type AS entityType, l.entity_id AS entityId,
  l.project_id AS projectId, audit_project.name AS projectName,
  l.summary, l.created_at AS createdAt`;
const auditJoins = `LEFT JOIN accounts user_account ON l.actor_type='user' AND user_account.id=l.actor_id
  LEFT JOIN api_tokens actor_token ON l.actor_type='token' AND actor_token.id=l.actor_id
  LEFT JOIN accounts token_account ON token_account.id=actor_token.account_id
  LEFT JOIN projects audit_project ON audit_project.id=l.project_id`;
const auditFrom = `FROM audit_logs l ${auditJoins}`;

/** Resolve only the displayed page; historical work must stay in the audit's project. */
function resolveAuditObjects(items: Record<string, unknown>[]) {
  const tables = { project: 'projects', feature: 'features', feature_phase: 'feature_phases', requirement: 'requirements', work_item: 'work_items', issue: 'issues' };
  const params: string[] = [];
  const queries = Object.entries(tables).flatMap(([type, table]) => {
    const ids = [...new Set(items.filter(item => item.entityType === type && typeof item.entityId === 'string').map(item => item.entityId as string))];
    if (!ids.length) return [];
    params.push(...ids);
    return [`SELECT '${type}' AS entityType, id FROM ${table} WHERE id IN (${ids.map(() => '?').join(',')})`];
  });
  if (!queries.length) return items;
  const existing = new Set(rows<{entityType: string; id: string}>(queries.join(' UNION ALL '), ...params).map(item => `${item.entityType}:${item.id}`));
  const removed = [...new Set(items.filter(item => item.entityType === 'work_item' && typeof item.entityId === 'string' && !existing.has(`work_item:${item.entityId}`)).map(item => item.entityId as string))];
  const history = removed.length ? rows<{workItemId: string; requirementId: string; projectId: string}>(`SELECT DISTINCT u.deleted_work_item_id AS workItemId,
    r.id AS requirementId, r.project_id AS projectId FROM progress_updates u JOIN requirements r ON r.id=u.requirement_id
    WHERE u.deleted_work_item_id IN (${removed.map(() => '?').join(',')})`, ...removed) : [];
  return items.map(item => typeof item.entityType === 'string' && Object.hasOwn(tables, item.entityType) && item.entityId ? { ...item,
    objectDeleted: !existing.has(`${item.entityType}:${item.entityId}`),
    ...(item.entityType === 'work_item' ? {
      workItemDeleted: !existing.has(`work_item:${item.entityId}`),
      workItemRequirementId: history.find(entry => entry.workItemId === item.entityId && entry.projectId === item.projectId)?.requirementId || null,
    } : {}),
  } : item);
}

export function listAudit(limit = 100, projectId?: string) {
  const normalizedLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 500) : 100;
  return resolveAuditObjects(rows(`${auditSelect} ${auditFrom} ${projectId ? 'WHERE l.project_id=?' : ''} ORDER BY l.created_at DESC, l.rowid DESC LIMIT ?`,
    ...(projectId ? [projectId] : []), normalizedLimit));
}

function localDateBoundary(value: string, endOfDay: boolean) {
  const time = endOfDay ? '23:59:59.999' : '00:00:00.000';
  return new Date(`${value}T${time}+08:00`).toISOString();
}

export function searchAudit(filters: { q?: string; actorType?: string; action?: string; entityType?: string; projectId?: string; from?: string; to?: string; page?: number; pageSize?: number; snapshot?: number } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  const latestRowId = row<{ rowId: number | null }>('SELECT MAX(rowid) AS rowId FROM audit_logs')?.rowId || 0;
  const snapshot = filters.snapshot === undefined ? latestRowId : Math.min(filters.snapshot, latestRowId);
  where.push('l.rowid<=?');
  params.push(snapshot);
  const q = String(filters.q || '').trim();
  if (q) {
    where.push(`(search_plain_match(l.summary, ?)=1 OR search_plain_match(COALESCE(l.entity_id, ''), ?)=1
      OR search_plain_match(COALESCE(l.actor_id, ''), ?)=1 OR search_plain_match(l.action, ?)=1
      OR (l.actor_type='user' AND l.actor_id IN (SELECT id FROM accounts WHERE search_score(username, ?)>0))
      OR (l.actor_type='token' AND l.actor_id IN (SELECT t.id FROM api_tokens t
        LEFT JOIN accounts a ON a.id=t.account_id
        WHERE search_score(COALESCE(a.username, ''), ?)>0 OR search_score(t.name, ?)>0)))`);
    params.push(q, q, q, q, q, q, q);
  }
  if (filters.actorType) { where.push('l.actor_type=?'); params.push(filters.actorType); }
  if (filters.action) { where.push('l.action=?'); params.push(filters.action); }
  if (filters.entityType) { where.push('l.entity_type=?'); params.push(filters.entityType); }
  if (filters.projectId) { where.push('l.project_id=?'); params.push(filters.projectId); }
  if (filters.from) { where.push('l.created_at>=?'); params.push(localDateBoundary(filters.from, false)); }
  if (filters.to) { where.push('l.created_at<=?'); params.push(localDateBoundary(filters.to, true)); }
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(100, Math.max(20, Number(filters.pageSize) || 50));
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = row<{ count: number }>(`SELECT COUNT(*) AS count FROM audit_logs l ${clause}`, ...params)?.count || 0;
  // 名称匹配按账号和Token查询；日志先分页，再读取当前页的人员与项目名称。
  const items = rows(`${auditSelect} FROM (SELECT l.rowid, l.* FROM audit_logs l ${clause}
      ORDER BY l.created_at DESC, l.rowid DESC LIMIT ? OFFSET ?) l ${auditJoins}
      ORDER BY l.created_at DESC, l.rowid DESC`, ...params, pageSize, (page - 1) * pageSize);
  return { items: resolveAuditObjects(items), total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), snapshot };
}
