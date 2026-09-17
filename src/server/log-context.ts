import { readLogContext, updateLogContext } from '../../scripts/runtime-logger.mjs';
import type { Actor } from './auth';

export { readLogContext, updateLogContext };
export function recordLogReason(reasonCode: string, reason: string) {
  updateLogContext({ reasonCode, reason: reason.slice(0, 400) });
}

export function recordLogIdentity(actor: Actor | null, authMethod: 'session' | 'token' = 'session') {
  if (!actor || actor.type === 'guest') {
    updateLogContext({ authMethod: authMethod === 'token' ? 'token' : 'none', accessMode: actor?.type === 'guest' ? 'guest' : 'anonymous' });
    return;
  }
  updateLogContext({ user: actor.type === 'token' ? actor.accountName || actor.accountId || '未知账号' : actor.label,
    accountId: actor.accountId || actor.id, actorType: actor.type, authMethod,
    accessMode: actor.type === 'token' ? 'token' : 'authenticated',
    ...(actor.type === 'token' ? { tokenId: actor.id, tokenName: actor.label } : {}) });
}

export function recordProjectContext(projectId: string, projectName?: string) {
  if (!id(projectId)) return;
  const current = readLogContext();
  if (!current.projectId || current.projectId === projectId) updateLogContext({ projectId, ...(projectName ? { projectName } : {}) });
}

const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const inputRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const routeKinds: Record<string, string> = { projects: 'project', requirements: 'requirement', 'work-items': 'work_item',
  issues: 'issue', people: 'person', templates: 'template', features: 'feature', phases: 'phase', 'feature-phases': 'phase', milestones: 'milestone', accounts: 'account', tokens: 'api_token' };
export function resourceKind(operation: string) {
  if (operation.startsWith('/')) {
    const parts = operation.split('/');
    for (let i = parts.length - 1; i >= 0; i--) if (routeKinds[parts[i]]) return routeKinds[parts[i]];
  } else {
    for (const kind of ['work_item', 'phase', 'feature', 'requirement', 'project', 'issue', 'person', 'template', 'milestone']) {
      if (new RegExp(`(?:^|_)${kind}(?:_|$)`).test(operation)) return kind;
    }
  }
}

/** Only identifiers, version numbers and field names; never arbitrary input values. */
export function recordInputContext(operation: string, input: unknown, mutation = false) {
  const value = inputRecord(input);
  for (const key of ['projectId', 'requirementId', 'workItemId', 'featureId', 'phaseId'] as const) {
    if (id(value[key])) updateLogContext({ [key]: value[key] });
  }
  const kind = resourceKind(operation);
  const key = kind === 'work_item' ? 'workItemId' : kind ? `${kind}Id` : '';
  const resourceId = value[key] || value.id;
  if (kind) updateLogContext({ resourceType: kind, ...(id(resourceId) ? { resourceId } : {}) });
  if (kind === 'project' && id(value.id)) recordProjectContext(value.id);
  if (typeof value.expectedVersion === 'number' && Number.isSafeInteger(value.expectedVersion)) updateLogContext({ expectedVersion: value.expectedVersion });
  if (mutation) {
    const fields = Object.keys(value).filter(key => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) && !/^(?:id|.*Id|expected.*)$/.test(key)).slice(0, 30);
    if (fields.length) updateLogContext({ fields: fields.join(',') });
  }
}

export function recordCreatedResource(operation: string, result: unknown) {
  const value = inputRecord(result), kind = resourceKind(operation);
  if (kind && id(value.id)) {
    updateLogContext({ resourceType: kind, resourceId: value.id });
    if (kind === 'project') recordProjectContext(value.id);
  }
}

export function recordHttpTarget(route: string, params: unknown) {
  const value = inputRecord(params), parts = route.split('/');
  for (let index = 1; index < parts.length; index++) {
    const kind = routeKinds[parts[index - 1]], key = parts[index].slice(1);
    if (!parts[index].startsWith(':') || !kind || !id(value[key])) continue;
    const resourceId = value[key] as string;
    if (kind === 'project') updateLogContext({ projectId: resourceId, projectName: undefined });
    else if (['requirement', 'work_item', 'feature', 'phase'].includes(kind)) {
      updateLogContext({ [kind === 'work_item' ? 'workItemId' : `${kind}Id`]: resourceId });
    }
    if (kind === resourceKind(route)) updateLogContext({ resourceType: kind, resourceId });
  }
}

type ValidationIssue = { path?: ReadonlyArray<unknown>; message?: string; code?: string; origin?: string; minimum?: unknown; maximum?: unknown };
export function recordValidationIssues(issues: ReadonlyArray<ValidationIssue>) {
  const details = issues.slice(0, 10).map(issue => {
    const parts = (issue.path || []).map(part => typeof part === 'object' && part && 'key' in part ? part.key : part);
    const field = parts.join('.');
    const label = field && /^[A-Za-z0-9_.-]{1,120}$/.test(field) ? field : '';
    const kind = issue.origin === 'string' ? '长度' : issue.origin === 'array' ? '数量' : '数值';
    const explanation = issue.code === 'invalid_type' ? '必填项缺失或类型不合法'
      : issue.code === 'too_small' && typeof issue.minimum === 'number' ? `${kind}未达到下限 ${issue.minimum}`
      : issue.code === 'too_big' && typeof issue.maximum === 'number' ? `${kind}超过上限 ${issue.maximum}`
      : issue.code === 'invalid_format' ? '格式不合法' : issue.code === 'invalid_value' ? '不在允许值范围内'
      : issue.code === 'unrecognized_keys' ? '包含未声明字段' : '未通过字段校验';
    return { field: label, reason: `${label || '输入参数'}：${explanation}` };
  });
  const fields = [...new Set(details.map(detail => detail.field).filter(Boolean))];
  updateLogContext({ ...(fields.length ? { validationFields: fields.join(',') } : {}) });
  // Validator messages may embed submitted values or unknown property names.
  recordLogReason('VALIDATION_ERROR', details.map(detail => detail.reason).join('；') || '输入参数格式不合法');
}
