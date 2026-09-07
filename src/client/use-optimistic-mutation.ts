import { useCallback } from "react";
import { useQueryClient, type Query, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { invalidateMany } from "./query-keys";

type Snapshot = Map<string, { query: Query; data: unknown }>;

function snapshot(client: QueryClient, queryKeys: QueryKey[]): Snapshot {
  return new Map(queryKeys.flatMap((queryKey) => client.getQueryCache().findAll({ queryKey }))
    .map((query) => [query.queryHash, { query, data: query.state.data }]));
}

/**
 * 先取消旧查询再乐观写入；成功与失败都只改写仍属于本次操作的缓存，最后重新读取服务端。
 * 各页面只需提供 apply/commit 中的业务改写（如 ownerName 推导），骨架不再复制。
 */
export function useOptimisticMutation<TInput, TSaved>({
  snapshotKeys,
  apply,
  request,
  commit,
  invalidate,
}: {
  /** 需要快照与回滚的 key 前缀；可为 input 的函数（如按行 id 取详情 key）。 */
  snapshotKeys: QueryKey[] | ((input: TInput) => QueryKey[]);
  apply: (client: QueryClient, input: TInput) => void;
  request: (input: TInput) => Promise<TSaved>;
  commit?: (client: QueryClient, saved: TSaved, input: TInput) => void;
  invalidate?: QueryKey[];
}) {
  const client = useQueryClient();
  return useCallback(async (input: TInput): Promise<TSaved> => {
    const resolvedKeys = typeof snapshotKeys === "function" ? snapshotKeys(input) : snapshotKeys;
    await Promise.all(resolvedKeys.map((queryKey) => client.cancelQueries({ queryKey })));
    const before = snapshot(client, resolvedKeys);
    apply(client, input);
    const optimistic = snapshot(client, resolvedKeys);
    const stillPresent = (query: Query) => client.getQueryCache().get(query.queryHash) === query;
    try {
      const saved = await request(input);
      // 退出、切换账号或后台重读后，迟到的响应不得覆盖更晚的缓存数据。
      if ([...optimistic.values()].every(({ query, data }) => stillPresent(query) && query.state.data === data)) {
        commit?.(client, saved, input);
        if (invalidate?.length) invalidateMany(client, invalidate);
      }
      return saved;
    } catch (error) {
      for (const [hash, { query, data }] of optimistic) {
        if (!stillPresent(query) || query.state.data !== data) continue;
        const previous = before.get(hash)?.data;
        if (previous === undefined) void client.resetQueries({ queryKey: query.queryKey, exact: true });
        else client.setQueryData(query.queryKey, previous);
      }
      throw error;
    } finally {
      for (const { query } of optimistic.values()) {
        if (stillPresent(query)) void client.invalidateQueries({
          queryKey: query.queryKey, exact: true, refetchType: query.options.queryFn ? "all" : "none",
        });
      }
    }
  }, [client, snapshotKeys, invalidate, apply, request, commit]);
}
