import { randomUUID, timingSafeEqual } from 'node:crypto';
import { sqlite } from '../database';
import { createApiTokenValue, hashApiToken, type Actor } from '../auth';
import { fail, forbidden, notFound } from '../errors';
import { recordAudit as audit } from './audit';
import { nowIso, requireLabel, row, rows, type JsonObject } from './support';

export function listTokens(accountId?: string, allAccounts = false) {
  return rows(`SELECT t.id, t.name, t.prefix, t.expires_at AS expiresAt, t.last_used_at AS lastUsedAt,
    t.revoked_at AS revokedAt, t.account_id AS accountId, a.username AS accountName, t.created_at AS createdAt
    FROM api_tokens t JOIN accounts a ON a.id=t.account_id
    ${allAccounts ? '' : 'WHERE t.account_id=?'} ORDER BY t.created_at DESC`, ...(allAccounts ? [] : [accountId || '']));
}

export function issueToken(input: JsonObject, actor: Actor) {
  if (!actor.accountId) fail('Token必须绑定登录账号');
  const id = randomUUID(); const name = requireLabel(input.name, 'Token名称'); const now = nowIso();
  const days = input.expiresInDays === null || input.expiresInDays === 'never' ? null : Number(input.expiresInDays ?? 90);
  if (days !== null && (!Number.isFinite(days) || days < 1 || days > 3650)) fail('有效期不合法');
  const expiresAt = days === null ? null : new Date(Date.now() + days * 86400000).toISOString();
  const { prefix, token } = createApiTokenValue();
  sqlite.prepare(`INSERT INTO api_tokens (id, name, prefix, token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, name, prefix, hashApiToken(token), actor.accountId, expiresAt, now);
  audit(actor, 'create', 'api_token', id, `创建MCP Token：${name}`);
  return { id, name, prefix, token, expiresAt, createdAt: now };
}

export function revokeToken(id: string, actor: Actor, allowAnyAccount = false) {
  const token = row<{ name: string; accountId: string }>('SELECT name, account_id AS accountId FROM api_tokens WHERE id=?', id);
  if (!token) notFound('Token不存在');
  if (!allowAnyAccount && token.accountId !== actor.accountId) forbidden('只能撤销自己的Token');
  sqlite.prepare('UPDATE api_tokens SET revoked_at=? WHERE id=?').run(nowIso(), id);
  audit(actor, 'revoke', 'api_token', id, `撤销MCP Token：${token.name}`);
  return { ok: true };
}

export function authenticateApiToken(token: string): (Actor & { accountId: string; personId: string | null; globalRole: 'user' | 'admin' }) | null {
  const match = /^pm_([a-f0-9]{10})_/.exec(token);
  if (!match) return null;
  const record = row<Record<string, string | null>>(`SELECT t.*, a.username, a.person_id, a.global_role, a.status AS account_status
    FROM api_tokens t JOIN accounts a ON a.id=t.account_id WHERE t.prefix=? AND a.deleted_at IS NULL`, match[1]);
  if (!record || record.revoked_at || record.account_status !== 'active'
    || (record.expires_at && record.expires_at <= nowIso())) return null;
  const actualHash = Buffer.from(hashApiToken(token)); const expectedHash = Buffer.from(String(record.token_hash));
  if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) return null;
  sqlite.prepare('UPDATE api_tokens SET last_used_at=? WHERE id=?').run(nowIso(), record.id);
  return {
    type: 'token', id: String(record.id), label: String(record.name), accountId: String(record.account_id),
    personId: record.person_id, globalRole: record.global_role as 'user' | 'admin',
  };
}
