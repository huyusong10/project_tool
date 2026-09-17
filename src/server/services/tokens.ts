import { recordLogReason, updateLogContext } from '../log-context';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { getDatabaseContext } from '../database-context';
import { createApiTokenValue, hashApiToken, type Actor } from '../auth';
import { fail, forbidden, notFound } from '../errors';
import { recordAudit as audit } from './audit';
import { nowIso, requireLabel, row, rows, type JsonObject } from './support';
import { accountPersonAvailableSql } from '../account-access';
import { assertAdmin, requireAuthorizationActor } from '../authorization';

export function listTokens(accountId?: string, allAccounts = false) {
  return rows(`SELECT t.id, t.name, t.prefix, t.expires_at AS expiresAt, t.last_used_at AS lastUsedAt,
    t.revoked_at AS revokedAt, t.account_id AS accountId, a.username AS accountName, t.created_at AS createdAt
    FROM api_tokens t JOIN accounts a ON a.id=t.account_id
    ${allAccounts ? '' : 'WHERE t.account_id=?'} ORDER BY t.created_at DESC`, ...(allAccounts ? [] : [accountId || '']));
}

export function issueToken(input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => key !== 'name' && key !== 'expiresInDays')) fail('创建Token不能提交未声明字段');
  if (!actor.accountId) fail('Token必须绑定登录账号');
  const id = randomUUID(); const name = requireLabel(input.name, 'Token名称'); const now = nowIso();
  const days = input.expiresInDays === null || input.expiresInDays === 'never' ? null : Number(input.expiresInDays ?? 90);
  if (days !== null && (!Number.isFinite(days) || days < 1 || days > 3650)) fail('有效期不合法');
  const expiresAt = days === null ? null : new Date(Date.now() + days * 86400000).toISOString();
  const { prefix, token } = createApiTokenValue();
  getDatabaseContext().sqlite.transaction(() => {
    getDatabaseContext().sqlite.prepare(`INSERT INTO api_tokens (id, name, prefix, token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, name, prefix, hashApiToken(token), actor.accountId, expiresAt, now);
    const account = row(`SELECT 1 FROM accounts a WHERE a.id=? AND a.status='active' AND a.must_change_password=0
      AND a.deleted_at IS NULL AND ${accountPersonAvailableSql}`, actor.accountId!);
    if (!account) fail('账号状态已变化，不能创建Token', 'DEPENDENCY_CONFLICT', 409);
    audit(actor, 'create', 'api_token', id, `创建MCP Token：${name}`);
  })();
  return { id, name, prefix, token, expiresAt, createdAt: now };
}

export function revokeToken(id: string, actor: Actor, allowAnyAccount = false) {
  return getDatabaseContext().sqlite.transaction(() => {
    const token = row<{ name: string; accountId: string; revokedAt: string | null }>('SELECT name, account_id AS accountId, revoked_at AS revokedAt FROM api_tokens WHERE id=?', id);
    if (!token) notFound('Token不存在');
    const currentActor = requireAuthorizationActor(actor);
    if (allowAnyAccount) assertAdmin(currentActor);
    else if (token.accountId !== currentActor.accountId) forbidden('只能撤销自己的Token');
    if (token.revokedAt) return { ok: true };
    const changed = getDatabaseContext().sqlite.prepare('UPDATE api_tokens SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(nowIso(), id);
    if (!changed.changes) return { ok: true };
    const finalActor = requireAuthorizationActor(actor);
    if (allowAnyAccount) assertAdmin(finalActor);
    else if (token.accountId !== finalActor.accountId) forbidden('只能撤销自己的Token');
    audit(actor, 'revoke', 'api_token', id, `撤销MCP Token：${token.name}`);
    return { ok: true };
  })();
}

export function authenticateApiToken(token: string): (Actor & { accountId: string; personId: string | null; globalRole: 'user' | 'admin' }) | null {
  updateLogContext({ authMethod: 'token' });
  const reject = (code: string, reason: string) => { recordLogReason(code, reason); return null; };
  const match = /^pm_([a-f0-9]{10})_/.exec(token);
  if (!match) return reject('TOKEN_INVALID', 'MCP Token 格式不合法');
  const record = row<Record<string, string | number | null>>(`SELECT t.*, a.username, a.person_id, a.global_role, a.status AS account_status,
      a.must_change_password, a.updated_at AS account_updated_at
    FROM api_tokens t JOIN accounts a ON a.id=t.account_id
    WHERE t.prefix=? AND a.deleted_at IS NULL AND ${accountPersonAvailableSql}`, match[1]);
  if (!record) return reject('TOKEN_UNAVAILABLE', 'MCP Token 不存在或关联账号、人员不可用');
  const actualHash = Buffer.from(hashApiToken(token)); const expectedHash = Buffer.from(String(record.token_hash));
  if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) return reject('TOKEN_INVALID', 'MCP Token 校验失败');
  updateLogContext({ attemptedUser: String(record.username), tokenId: String(record.id), tokenName: String(record.name) });
  if (record.revoked_at) return reject('TOKEN_REVOKED', 'MCP Token 已被撤销');
  if (record.account_status !== 'active') return reject('ACCOUNT_DISABLED', 'MCP Token 关联账号已停用');
  if (Number(record.must_change_password) === 1) return reject('PASSWORD_CHANGE_REQUIRED', 'MCP Token 关联账号需要先修改初始密码');
  if (record.expires_at && record.expires_at <= nowIso()) return reject('TOKEN_EXPIRED', 'MCP Token 已过期');
  const usedAt = nowIso();
  const authenticated = getDatabaseContext().sqlite.transaction(() => {
    const used = getDatabaseContext().sqlite.prepare(`UPDATE api_tokens SET last_used_at=?
      WHERE id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)
        AND EXISTS (SELECT 1 FROM accounts a WHERE a.id=api_tokens.account_id AND a.updated_at=?
          AND a.status='active' AND a.must_change_password=0 AND a.deleted_at IS NULL AND ${accountPersonAvailableSql})`)
      .run(usedAt, record.id, usedAt, record.account_updated_at);
    if (!used.changes) return false;
    return Boolean(row(`SELECT 1 FROM api_tokens t JOIN accounts a ON a.id=t.account_id
      WHERE t.id=? AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at>?)
        AND a.updated_at=? AND a.status='active' AND a.must_change_password=0
        AND a.deleted_at IS NULL AND ${accountPersonAvailableSql}`, record.id, usedAt, record.account_updated_at));
  })();
  if (!authenticated) return reject('TOKEN_STATE_CHANGED', 'MCP Token 或关联账号状态已变化');
  updateLogContext({ attemptedUser: undefined });
  return {
    type: 'token', id: String(record.id), label: String(record.name), accountId: String(record.account_id),
    accountName: String(record.username),
    personId: record.person_id ? String(record.person_id) : null, globalRole: record.global_role as 'user' | 'admin',
  };
}
