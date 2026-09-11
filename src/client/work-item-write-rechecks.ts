const actionKeyPrefix = 'project-manage:work-item-action-rechecks:';
const settingsKeyPrefix = 'project-manage:work-item-settings-rechecks:';

function readIds(keyPrefix: string, accountKey: string) {
  if (typeof window === 'undefined') return new Set<string>();
  try {
    const value = JSON.parse(window.sessionStorage.getItem(`${keyPrefix}${accountKey}`) || '[]');
    return new Set<string>(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item)) : []);
  } catch {
    return new Set<string>();
  }
}

function persistId(keyPrefix: string, accountKey: string, id: string, required: boolean) {
  const key = `${keyPrefix}${accountKey}`;
  const next = readIds(keyPrefix, accountKey);
  if (required) next.add(id);
  else next.delete(id);
  if (typeof window === 'undefined') return next;
  try {
    if (next.size) window.sessionStorage.setItem(key, JSON.stringify([...next]));
    else window.sessionStorage.removeItem(key);
  } catch {
    // 页面内状态仍会保留锁；存储不可用时只失去跨导航恢复能力。
  }
  return next;
}

export function readWorkItemActionRechecks(accountKey: string) {
  return readIds(actionKeyPrefix, accountKey);
}

export function persistWorkItemActionRecheck(accountKey: string, workItemId: string, required: boolean) {
  return persistId(actionKeyPrefix, accountKey, workItemId, required);
}

export function readWorkItemSettingsRechecks(accountKey: string) {
  return readIds(settingsKeyPrefix, accountKey);
}

export function persistWorkItemSettingsRecheck(accountKey: string, requirementId: string, required: boolean) {
  return persistId(settingsKeyPrefix, accountKey, requirementId, required);
}
