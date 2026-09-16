import { useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { api, isTemporaryReadError } from './api';

export class ResourceReadInvalidatedError extends Error {
  constructor() { super('资源访问状态已变更，请重新读取。'); this.name = 'ResourceReadInvalidatedError'; }
}

/** null 表示该查询已被拒绝；迟到的操作响应不能代替一次新的成功读取。 */
export function cacheResourceUpdate<T>(client: QueryClient, queryKey: QueryKey, data: T) {
  if (client.getQueryData(queryKey) !== null) client.setQueryData(queryKey, data);
}

/** 后台刷新和显式重读都不能覆盖请求期间出现的新拒绝结果。 */
async function readResourceSnapshot<T>(client: QueryClient, queryKey: QueryKey, path: string, isActive: () => boolean, signal?: AbortSignal) {
  const beforeRead = client.getQueryState<T | null>(queryKey);
  const data = await api<T>(path, { signal });
  if (!isActive()) return data;
  const current = client.getQueryState<T | null>(queryKey);
  if (current?.data === null && (beforeRead?.data !== null || current.dataUpdateCount !== beforeRead.dataUpdateCount)) {
    throw new ResourceReadInvalidatedError();
  }
  return data;
}

/** 显式重读可以恢复已拒绝的缓存。 */
export async function readResourceFresh<T>(client: QueryClient, queryKey: QueryKey, path: string, isActive: () => boolean) {
  const data = await readResourceSnapshot<T>(client, queryKey, path, isActive);
  if (isActive()) client.setQueryData(queryKey, data);
  return data;
}

/** 临时读取失败保留草稿依赖的数据；拒绝访问后清空缓存，不能在下一次 503 时重新显示。 */
export function useResourceQuery<T>(queryKey: QueryKey, path: string, enabled = true, onRead?: (data: T) => void, freshOnMount = false) {
  const client = useQueryClient();
  const query = useQuery<T | null>({
    queryKey,
    enabled,
    ...(freshOnMount ? {refetchOnMount: 'always' as const} : {}),
    queryFn: async ({ signal }) => {
      try {
        const data = await readResourceSnapshot<T>(client, queryKey, path, () => !signal.aborted, signal);
        if (!signal.aborted) onRead?.(data);
        return data;
      } catch (error) {
        if (!signal.aborted && !isTemporaryReadError(error)) client.setQueryData<T | null>(queryKey, null);
        throw error;
      }
    },
    retry: (failureCount, error) => failureCount < 1 && isTemporaryReadError(error),
  });
  return { ...query, unavailable: !query.data || Boolean(query.error && !isTemporaryReadError(query.error)) };
}
