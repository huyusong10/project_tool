import { readReferenceLinks } from '../../shared/reference-links';
import { getDatabaseContext } from '../database-context';
import { fail, notFound } from '../errors';
import { isTerminalRequirementStatus, isTerminalWorkItemStatus } from '../../shared/domain';
import { canonicalizeContent, canonicalizeLabel, textSafetyIssue } from '../../shared/search';
import { isValidIsoDate } from '../../shared/workday';

export type JsonObject = Record<string, unknown>;

export const nowIso = () => new Date().toISOString();

export function rows<T = JsonObject>(sql: string, ...params: unknown[]): T[] {
  return getDatabaseContext().sqlite.prepare(sql).all(...params) as T[];
}

export function row<T = JsonObject>(sql: string, ...params: unknown[]): T | undefined {
  return getDatabaseContext().sqlite.prepare(sql).get(...params) as T | undefined;
}

/** Historical attribution does not require an active login or grant execution access. */
export function assertHistoricalProjectPeople(projectId: string, ids: Array<string | null>) {
  for (const id of new Set(ids.filter(Boolean))) {
    if (!row(`SELECT 1 FROM project_people pp JOIN people p ON p.id=pp.person_id
      WHERE pp.project_id=? AND p.id=? AND p.deleted_at IS NULL AND pp.project_role IN ('member','manager')`, projectId, id)) {
      fail('历史负责人和协作人必须属于当前项目');
    }
  }
}

export function changeSnapshot(current: object, after: JsonObject, reason: string) {
  const before = current as JsonObject;
  return {reason, before: Object.fromEntries(Object.keys(after).map(key => [key, before[key] ?? null])), after};
}

/** Keep generated IN clauses below SQLite's parameter limit, including older builds that default to 999. */
export function chunkValues<T>(values: readonly T[], size = 900): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) chunks.push(values.slice(offset, offset + size));
  return chunks;
}

export function assertExpectedVersion(input: JsonObject, currentVersion: number) {
  if (input.expectedVersion === undefined || input.expectedVersion === null || input.expectedVersion === '') fail('缺少expectedVersion，请刷新数据后重试');
  const expected = Number(input.expectedVersion);
  if (!Number.isInteger(expected) || expected < 1) fail('数据版本不合法');
  if (expected !== currentVersion) fail('数据已被其他用户修改，请刷新后重试', 'STALE_WRITE', 409, undefined, currentVersion);
  return expected;
}

export function assertVersionedWrite(result: { changes: number }, subject = '数据') {
  if (!result.changes) fail(`${subject}已被其他用户修改，请刷新后重试`, 'STALE_WRITE', 409);
}

export function assertExpectedUpdatedAt(input: JsonObject, currentUpdatedAt: string, subject = '数据') {
  if (input.expectedUpdatedAt === undefined) return;
  if (typeof input.expectedUpdatedAt !== 'string' || input.expectedUpdatedAt !== currentUpdatedAt) {
    fail(`${subject}已被其他用户修改，请重新打开后再保存`, 'STALE_WRITE', 409, { currentUpdatedAt });
  }
}

export function nextUpdatedAt(currentUpdatedAt: string) {
  const current = Date.parse(currentUpdatedAt);
  const now = Date.now();
  return new Date(Number.isFinite(current) ? Math.max(now, current + 1) : now).toISOString();
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

/** Factual fallback for optional explanations; never invent a user's reason. */
export function describeChanges(current: object, input: JsonObject) {
  const labels: Record<string,string> = { title:'名称', ownerId:'负责人ID', assigneeIds:'执行人员ID', plannedStart:'计划开始', plannedEnd:'计划完成', actualStart:'实际开始', actualEnd:'实际完成', resolvedAt:'解决日期', progress:'完成度', background:'说明', impact:'影响', acceptanceCriteria:'完成标准', referenceUrl:'来源链接',referenceLinks:'关联链接', featureId:'特性ID',phaseId:'Phase ID',workStage:'工作阶段',milestoneKind:'节点含义', supersedesId:'关联历史记录' };
  const before=current as JsonObject;
  const display=(v:unknown)=>v===undefined||v===null||v===''?'未设置':Array.isArray(v)?v.join('、'):String(v);
  const changes=Object.entries(input).filter(([key,value])=>key in labels&&JSON.stringify(value)!==JSON.stringify(before[key])).map(([key,value])=>`${labels[key]}：${key==='referenceLinks'?readReferenceLinks(before[key]).map(l=>l.title+' ('+l.url+')').join('、')||'未设置':display(before[key])} → ${key==='referenceLinks'?readReferenceLinks(value).map(l=>l.title+' ('+l.url+')').join('、')||'未设置':display(value)}`);
  return changes.length?changes.join('；'):'修正历史记录';
}

/** Use the persisted text form when calculating previews and commitment snapshots. */
export function normalizeRequirementText<T extends {title?:string;background?:string|null;acceptanceCriteria?:string|null;referenceUrl?:string|null}>(input:T):T {
  const value={...input};
  if(value.title!==undefined)value.title=requireLabel(value.title,'需求标题');
  for(const key of ['background','acceptanceCriteria','referenceUrl'] as const)if(value[key]!==undefined)value[key]=nullableText(value[key]);
  return value;
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
  if (!isValidIsoDate(text)) fail(`${field}格式不合法`);
  return text;
}

export function nullableDate(value: unknown, field: string) {
  const text = nullableText(value);
  if (text && !isValidIsoDate(text)) fail(`${field}格式不合法`);
  return text;
}

export function requireProgress(value: unknown, field = '完成度') {
  const progress = Number(value);
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) fail(`${field}必须是0到100的整数`);
  return progress;
}

export function requireActiveProject(projectId:string,afterWrite=false){
  if(row('SELECT id FROM projects WHERE id=? AND deleted_at IS NULL',projectId))return;
  if(afterWrite)fail('项目已归档，不能继续写入','DEPENDENCY_CONFLICT',409);
  notFound('项目不存在');
}
