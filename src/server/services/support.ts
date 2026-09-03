import { sqlite } from '../database';
import { fail } from '../errors';
import { isTerminalRequirementStatus, isTerminalWorkItemStatus } from '../../shared/domain';

export type JsonObject = Record<string, unknown>;

export const nowIso = () => new Date().toISOString();

export function rows<T = JsonObject>(sql: string, ...params: unknown[]): T[] {
  return sqlite.prepare(sql).all(...params) as T[];
}

export function row<T = JsonObject>(sql: string, ...params: unknown[]): T | undefined {
  return sqlite.prepare(sql).get(...params) as T | undefined;
}

export function assertExpectedVersion(input: JsonObject, currentVersion: number) {
  if (input.expectedVersion === undefined || input.expectedVersion === null || input.expectedVersion === '') fail('缺少expectedVersion，请刷新数据后重试');
  const expected = Number(input.expectedVersion);
  if (!Number.isInteger(expected) || expected < 1) fail('数据版本不合法');
  if (expected !== currentVersion) fail('数据已被其他用户修改，请刷新后重试', 'STALE_WRITE', 409, undefined, currentVersion);
  return expected;
}

export function assertTransition(current: string, allowed: readonly string[], action: string) {
  if (!allowed.includes(current)) {
    fail(`当前状态“${current}”不能${action}`, isTerminalWorkItemStatus(current) || isTerminalRequirementStatus(current) || current === 'resolved'
      ? 'TERMINAL_LOCKED'
      : 'INVALID_TRANSITION');
  }
}

export function ensureEnum<T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] {
  if (!allowed.includes(value as T[number])) fail(`${field}不合法`);
  return value as T[number];
}

export function requireText(value: unknown, field: string) {
  const text = String(value ?? '').trim();
  if (!text) fail(`${field}不能为空`);
  return text;
}

export function nullableText(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

export function templateDescription(value: unknown) {
  const description = String(value ?? '').trim();
  if (description.length > 2000) fail('流程描述不能超过2000个字符');
  return description;
}

export function milestoneLabel(value: unknown) {
  const label = String(value ?? '').trim();
  if (label.length > 80) fail('里程碑名称不能超过80个字符');
  return label || null;
}

export function requireDate(value: unknown, field: string) {
  const text = requireText(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail(`${field}格式不合法`);
  return text;
}

export function nullableDate(value: unknown, field: string) {
  const text = nullableText(value);
  if (text && !/^\d{4}-\d{2}-\d{2}$/.test(text)) fail(`${field}格式不合法`);
  return text;
}

export function requireProgress(value: unknown, field = '完成度') {
  const progress = Number(value);
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) fail(`${field}必须是0到100的整数`);
  return progress;
}
