import type { ApplicationMode } from '../shared/api/system';
import { applicationModeInputSchema } from '../shared/contracts';
import type { Actor } from './auth';
import { assertAdmin, requireAuthorizationActor } from './authorization';
import { getDatabaseContext } from './database-context';
import { AppError } from './errors';
import { recordAudit } from './services/audit';
import { nextUpdatedAt } from './services/support';

const metaKey = 'application-mode';

export function getApplicationMode(): ApplicationMode {
  const stored = getDatabaseContext().sqlite.prepare('SELECT value, updated_at AS updatedAt FROM system_meta WHERE key=?')
    .get(metaKey) as { value: string; updatedAt: string } | undefined;
  return { issueTrackingOnly: stored?.value === 'true', updatedAt: stored?.updatedAt ?? null };
}

export function updateApplicationMode(input: unknown, actor: Actor): ApplicationMode {
  const { issueTrackingOnly, expectedUpdatedAt } = applicationModeInputSchema.parse(input);
  return getDatabaseContext().sqlite.transaction(() => {
    assertAdmin(requireAuthorizationActor(actor));
    const current = getApplicationMode();
    if (current.updatedAt !== expectedUpdatedAt) {
      throw new AppError('功能设置已被其他管理员修改，请重新读取后重试', 409, 'STALE_WRITE');
    }
    if (current.issueTrackingOnly === issueTrackingOnly) return current;
    const updatedAt = current.updatedAt ? nextUpdatedAt(current.updatedAt) : new Date().toISOString();
    getDatabaseContext().sqlite.prepare(`INSERT INTO system_meta (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
      .run(metaKey, String(issueTrackingOnly), updatedAt, updatedAt);
    recordAudit(actor, 'update', 'application_mode', 'default', issueTrackingOnly ? '仅启用问题跟踪功能' : '恢复全部功能');
    return { issueTrackingOnly, updatedAt };
  })();
}
