import { randomUUID } from 'node:crypto';
import { sqlite } from '../database';
import type { Actor } from '../auth';

function row<T>(sql: string, ...params: unknown[]) {
  return sqlite.prepare(sql).get(...params) as T | undefined;
}

function rows<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
  return sqlite.prepare(sql).all(...params) as T[];
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

export function recordAudit(actor: Actor, action: string, entityType: string, entityId: string | null, summary: string, projectId?: string | null) {
  const scopeProjectId = projectId === undefined ? auditProjectId(entityType, entityId) : projectId;
  sqlite.prepare(`INSERT INTO audit_logs (id, actor_type, actor_id, action, entity_type, entity_id, project_id, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), actor.type, actor.id, action, entityType, entityId, scopeProjectId, summary, new Date().toISOString());
}

const auditSelect = `SELECT l.id, l.actor_type AS actorType, l.actor_id AS actorId,
  CASE WHEN l.actor_type='user' THEN user_account.username WHEN l.actor_type='token' THEN token_account.username END AS actorName,
  actor_token.name AS tokenName, l.action, l.entity_type AS entityType, l.entity_id AS entityId,
  l.project_id AS projectId, audit_project.name AS projectName,
  l.summary, l.created_at AS createdAt`;
const auditFrom = `FROM audit_logs l
  LEFT JOIN accounts user_account ON l.actor_type='user' AND user_account.id=l.actor_id
  LEFT JOIN api_tokens actor_token ON l.actor_type='token' AND actor_token.id=l.actor_id
  LEFT JOIN accounts token_account ON token_account.id=actor_token.account_id
  LEFT JOIN projects audit_project ON audit_project.id=l.project_id`;

export function listAudit(limit = 100, projectId?: string) {
  const normalizedLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 500) : 100;
  return rows(`${auditSelect} ${auditFrom} ${projectId ? 'WHERE l.project_id=?' : ''} ORDER BY l.created_at DESC LIMIT ?`,
    ...(projectId ? [projectId] : []), normalizedLimit);
}

export function searchAudit(filters: { q?: string; actorType?: string; action?: string; entityType?: string; projectId?: string; from?: string; to?: string; page?: number; pageSize?: number } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  const q = String(filters.q || '').trim();
  if (q) {
    where.push(`(search_plain_match(l.summary, ?)=1 OR search_plain_match(COALESCE(l.entity_id, ''), ?)=1
      OR search_plain_match(COALESCE(l.actor_id, ''), ?)=1 OR search_plain_match(l.action, ?)=1
      OR search_score(COALESCE(user_account.username, ''), ?)>0
      OR search_score(COALESCE(token_account.username, ''), ?)>0
      OR search_score(COALESCE(actor_token.name, ''), ?)>0)`);
    params.push(q, q, q, q, q, q, q);
  }
  if (filters.actorType) { where.push('l.actor_type=?'); params.push(filters.actorType); }
  if (filters.action) { where.push('l.action=?'); params.push(filters.action); }
  if (filters.entityType) { where.push('l.entity_type=?'); params.push(filters.entityType); }
  if (filters.projectId) { where.push('l.project_id=?'); params.push(filters.projectId); }
  if (filters.from) { where.push('l.created_at>=?'); params.push(`${filters.from}T00:00:00.000Z`); }
  if (filters.to) { where.push('l.created_at<=?'); params.push(`${filters.to}T23:59:59.999Z`); }
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(100, Math.max(20, Number(filters.pageSize) || 50));
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = row<{ count: number }>(`SELECT COUNT(*) AS count ${auditFrom} ${clause}`, ...params)?.count || 0;
  const items = rows(`${auditSelect} ${auditFrom} ${clause}
    ORDER BY l.created_at DESC LIMIT ? OFFSET ?`, ...params, pageSize, (page - 1) * pageSize);
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}
