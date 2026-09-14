/** Migrate unsent browser data only. Receipt-bearing payloads must keep their original bytes. */
export function migrateFeatureFields<T>(raw: T): T {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    const source = value as Record<string, unknown>;
    if (typeof source.batchId === 'string' || source.attempt || source.payload) return value;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(source)) {
      const renamed = key === 'groupId' ? 'featureId' : key === 'groupName' ? 'featureName' : key === 'groups' ? 'features' : key.endsWith(':groupId') ? key.slice(0, -7) + 'featureId' : key;
      if (renamed !== key && renamed in source) continue;
      next[renamed] = visit(item);
    }
    if(Array.isArray(next.dirtyFields))next.dirtyFields=next.dirtyFields.map(key=>key==='groupId'?'featureId':key);
    return next;
  };
  return visit(raw) as T;
}
export function migrateImportDraft<T>(raw: T): T {
  if (!raw || typeof raw !== 'object' || (raw as { formatVersion?: number }).formatVersion !== 2) return raw;
  const value = raw as { requirements?: Array<Record<string, unknown>> };
  return { ...raw, formatVersion: 3, requirements: value.requirements?.map(({ group, ...r }) => ({ ...r, ...(group !== undefined && r.feature === undefined ? { feature: group } : {}) })) };
}

/** Saved filters and incoming links are safe to rename; mutation payloads use separate storage. */
export function migrateFeatureSearch(search: string) {
  const params = new URLSearchParams(search);
  for (const [oldKey, newKey] of [['group', 'feature'], ['pathGroups', 'pathFeatures']]) {
    if (params.has(oldKey) && !params.has(newKey)) params.set(newKey, params.get(oldKey)!);
    params.delete(oldKey);
    if (params.has(newKey)) params.set(newKey, params.get(newKey)!.split(',').map(id => id === 'ungrouped' ? 'unassigned' : id).join(','));
  }
  return params.toString();
}
