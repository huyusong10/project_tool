import { sqlite } from '../database';
import { fail } from '../errors';
import { isTerminalRequirementStatus, isTerminalWorkItemStatus } from '../../shared/domain';
import { canonicalizeContent, canonicalizeLabel, textSafetyIssue } from '../../shared/search';

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

function assertSafeText(value: unknown, field: string, multiline: boolean) {
  const issue = textSafetyIssue(value, multiline);
  if (issue === 'line_break') fail(`${field}不能包含换行`);
  if (issue === 'bidi') fail(`${field}包含不安全的文字方向控制字符`);
  if (issue === 'control') fail(`${field}包含不支持的控制字符`);
}

export function requireText(value: unknown, field: string) {
  assertSafeText(value, field, true);
  const text = canonicalizeContent(value);
  if (!text) fail(`${field}不能为空`);
  return text;
}

export function nullableText(value: unknown) {
  assertSafeText(value, '文本', true);
  const text = canonicalizeContent(value);
  return text || null;
}

export function requireLabel(value: unknown, field: string, maxLength = 200) {
  assertSafeText(value, field, false);
  const text = canonicalizeLabel(value);
  if (!text) fail(`${field}不能为空`);
  if ([...text].length > maxLength) fail(`${field}不能超过${maxLength}个字符`);
  return text;
}

export function nullableLabel(value: unknown, field = '文本', maxLength = 200) {
  assertSafeText(value, field, false);
  const text = canonicalizeLabel(value);
  if ([...text].length > maxLength) fail(`${field}不能超过${maxLength}个字符`);
  return text || null;
}

export function templateDescription(value: unknown) {
  assertSafeText(value, '流程描述', true);
  const description = canonicalizeContent(value);
  if (description.length > 2000) fail('流程描述不能超过2000个字符');
  return description;
}

export function milestoneLabel(value: unknown) {
  assertSafeText(value, '里程碑名称', false);
  const label = canonicalizeLabel(value);
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
