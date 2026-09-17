import { useEffect, useState } from 'react';
import type { QueryKey } from '@tanstack/react-query';
import { isTemporaryReadError } from './api';
import { useResourceQuery, type ResourceLoader } from './use-resource-query';

/** 翻页期间保留同一筛选范围的成功页；拒绝访问后不能再回退到旧记录。 */
export function usePagedResourceQuery<T>(key: QueryKey, source: string | ResourceLoader<T>, scope: string, enabled = true) {
  // Inline loaders change identity every render; the query key identifies the page.
  const path = typeof source === 'string' ? source : JSON.stringify(key);
  const [last, setLast] = useState<{ scope: string; data: T; path: string }>();
  const [failure, setFailure] = useState<{ scope: string; error: Error; fallbackPath?: string }>();
  const query = useResourceQuery<T>(key, source, enabled, () => setFailure(current => current?.fallbackPath === path ? current : undefined));
  useEffect(() => {
    if (query.data) setLast({ scope, data: query.data, path });
    if (query.error) {
      setFailure(current => current?.error === query.error ? current : { scope, error: query.error, fallbackPath: last?.scope === scope ? last.path : undefined });
      if (!isTemporaryReadError(query.error)) setLast(undefined);
    }
  }, [query.data, query.error, scope, path, last?.scope, last?.path]);
  const error = query.error || (failure?.scope === scope ? failure.error : null);
  const denied = Boolean(error && !isTemporaryReadError(error));
  const data = denied ? undefined : query.data || (last?.scope === scope ? last.data : undefined);
  return { ...query, data, error, unavailable: !data, clearError: () => setFailure(undefined), refetch: () => { setFailure(undefined); return query.refetch(); } };
}
