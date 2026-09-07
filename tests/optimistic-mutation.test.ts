import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { useOptimisticMutation } from '../src/client/use-optimistic-mutation';

const context = vi.hoisted(() => ({ client: null as QueryClient | null }));
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), useCallback: (callback: unknown) => callback }));
vi.mock('@tanstack/react-query', async (original) => ({ ...await original<typeof import('@tanstack/react-query')>(), useQueryClient: () => context.client }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type Row = { id: string; title: string };
const key = ['editable-rows'];
const originalRows: Row[] = [{ id: 'a', title: 'A原值' }, { id: 'b', title: 'B原值' }];
beforeEach(() => { context.client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); });
afterEach(() => context.client?.clear());

it('较早编辑失败不会把另一行已保存的结果回滚', async () => {
  const client = context.client!;
  let serverRows = structuredClone(originalRows);
  client.setQueryDefaults(key, { queryFn: async () => serverRows });
  client.setQueryData(key, serverRows);
  const first = deferred<Row>(); const second = deferred<Row>();
  const save = useOptimisticMutation<Row, Row>({
    snapshotKeys: [key],
    apply: (cache, input) => cache.setQueryData<Row[]>(key, (rows) => rows?.map((row) => row.id === input.id ? input : row)),
    request: (input) => input.id === 'a' ? first.promise : second.promise,
    commit: (cache, saved) => cache.setQueryData<Row[]>(key, (rows) => rows?.map((row) => row.id === saved.id ? saved : row)),
  });
  const firstSave = save({ id: 'a', title: 'A草稿' });
  await vi.waitFor(() => expect(client.getQueryData<Row[]>(key)?.[0].title).toBe('A草稿'));
  const secondSave = save({ id: 'b', title: 'B新值' });
  await vi.waitFor(() => expect(client.getQueryData<Row[]>(key)?.[1].title).toBe('B新值'));
  serverRows = [originalRows[0], { id: 'b', title: 'B已保存' }];
  second.resolve(serverRows[1]); await secondSave;
  const rejected = expect(firstSave).rejects.toThrow('A保存失败');
  first.reject(new Error('A保存失败')); await rejected;
  await vi.waitFor(() => expect(client.getQueryData<Row[]>(key)).toEqual(serverRows));
});

it('保存前取消旧查询，迟到的GET不会覆盖正在保存的值', async () => {
  const client = context.client!;
  client.setQueryData(key, originalRows);
  const oldResponse = deferred<Row[]>(); const savedResponse = deferred<Row>();
  const oldFetch = client.fetchQuery({ queryKey: key, queryFn: async ({ signal }) => { void signal; return oldResponse.promise; } }).catch(() => undefined);
  const save = useOptimisticMutation<Row, Row>({ snapshotKeys: [key],
    apply: (cache, input) => cache.setQueryData(key, [input, originalRows[1]]), request: () => savedResponse.promise,
  });
  const input = { id: 'a', title: '正在保存的新值' };
  const saving = save(input);
  await vi.waitFor(() => expect(client.getQueryData<Row[]>(key)?.[0].title).toBe(input.title));
  oldResponse.resolve(originalRows); await oldFetch;
  expect(client.getQueryData<Row[]>(key)?.[0].title).toBe(input.title);
  savedResponse.resolve(input); await saving;
});

it('首次创建的详情缓存保存失败时不能遗留未保存的数据', async () => {
  const client = context.client!;
  const detailKey = ['editable-row', 'new'];
  const save = useOptimisticMutation<Row, Row>({ snapshotKeys: [detailKey],
    apply: (cache, input) => cache.setQueryData(detailKey, input),
    request: async () => { throw new Error('保存失败'); },
  });
  await expect(save({ id: 'new', title: '不应残留的草稿' })).rejects.toThrow('保存失败');
  expect(client.getQueryData(detailKey)).toBeUndefined();
});

it('退出清空缓存后，迟到的保存响应不能重新填入上一账号数据', async () => {
  const client = context.client!;
  client.setQueryData(key, originalRows);
  const response = deferred<Row>();
  const commit = vi.fn((cache: QueryClient, saved: Row) => cache.setQueryData(key, [saved]));
  const save = useOptimisticMutation<Row, Row>({ snapshotKeys: [key],
    apply: (cache, input) => cache.setQueryData(key, [input]), request: () => response.promise, commit,
  });
  const saving = save({ id: 'a', title: '前一账号草稿' });
  await vi.waitFor(() => expect(client.getQueryData<Row[]>(key)?.[0].title).toBe('前一账号草稿'));
  client.clear();
  response.resolve({ id: 'a', title: '前一账号保存结果' }); await saving;
  expect(commit).not.toHaveBeenCalled();
  expect(client.getQueryData(key)).toBeUndefined();
});

it('后台重读写入更新数据后，迟到的成功响应不能覆盖它', async () => {
  const client = context.client!;
  client.setQueryData(key, originalRows);
  const response = deferred<Row>();
  const commit = vi.fn((cache: QueryClient, saved: Row) => cache.setQueryData(key, [saved]));
  const save = useOptimisticMutation<Row, Row>({
    snapshotKeys: [key],
    apply: (cache, input) => cache.setQueryData(key, [input]),
    request: () => response.promise,
    commit,
  });
  const saving = save({ id: 'a', title: '正在保存' });
  await vi.waitFor(() => expect(client.getQueryData<Row[]>(key)?.[0].title).toBe('正在保存'));
  const newer = [{ id: 'a', title: '后台更新的新版本' }];
  client.setQueryData(key, newer);
  response.resolve({ id: 'a', title: '迟到的保存结果' });
  await saving;
  expect(commit).not.toHaveBeenCalled();
  expect(client.getQueryData(key)).toEqual(newer);
});
