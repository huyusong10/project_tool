

import { getDatabaseContext } from '../database-context';

import { fail } from '../errors';

import { requireText, row, type JsonObject } from './support';

export function assertArchiveGeneration(input: JsonObject, currentDeletedAt: string) {
  const expectedDeletedAt = requireText(input.expectedDeletedAt, '归档版本');
  if (expectedDeletedAt !== currentDeletedAt) {
    fail('归档内容已被恢复或重新归档，请刷新后重试', 'STALE_WRITE', 409, { deletedAt: currentDeletedAt });
  }
}

export function assertOptionalArchiveGeneration(input: JsonObject, currentDeletedAt: string) {
  if (Object.keys(input).some((key) => key !== 'expectedDeletedAt')) fail('归档恢复不能提交未声明字段');
  if (input.expectedDeletedAt === undefined) return;
  assertArchiveGeneration(input, currentDeletedAt);
}

export function lockArchiveGeneration(table: 'projects' | 'requirements' | 'people' | 'work_item_templates', id: string, deletedAt: string) {
  const locked = getDatabaseContext().sqlite.prepare(`UPDATE ${table} SET updated_at=updated_at WHERE id=? AND deleted_at=?`).run(id, deletedAt);
  if (!locked.changes) fail('归档内容已被恢复或重新归档，请刷新后重试', 'STALE_WRITE', 409);
  const latest = row<{ deletedAt: string | null }>(`SELECT deleted_at AS deletedAt FROM ${table} WHERE id=?`, id);
  if (latest?.deletedAt !== deletedAt) fail('归档内容已被恢复或重新归档，请刷新后重试', 'STALE_WRITE', 409, { deletedAt: latest?.deletedAt || null });
}
