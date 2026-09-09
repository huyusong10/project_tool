import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { api, ApiError, isTemporaryReadError, NetworkError, requiresWriteRecheck, setUnauthorizedHandler } from '../src/client/api';
import { cacheResourceUpdate, readResourceFresh, ResourceReadInvalidatedError } from '../src/client/use-resource-query';

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});

it.each([408, 429, 500, 502, 503, 504])('HTTP %i 允许保留已有读取数据', async (status) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: '读取暂时失败' }), { status })));
  const result = await api('/api/requirements/r1').catch((error: unknown) => error);
  expect(result).toBeInstanceOf(ApiError);
  expect(isTemporaryReadError(result)).toBe(true);
});

it.each([400, 401, 403, 404, 409, 422])('HTTP %i 不能用旧数据掩盖读取失败', async (status) => {
  const unauthorized = vi.fn();
  setUnauthorizedHandler(unauthorized);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: '读取被拒绝' }), { status })));
  const result = await api('/api/requirements/r1').catch((error: unknown) => error);
  expect(result).toMatchObject({ status, message: '读取被拒绝' });
  expect(isTemporaryReadError(result)).toBe(false);
  expect(unauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
});

it('仅请求传输失败标记为网络错误，其他 TypeError 不当作断网', async () => {
  const cause = new TypeError('Failed to fetch');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(cause));
  const result = await api('/api/my-work').catch((error: unknown) => error);
  expect(result).toBeInstanceOf(NetworkError);
  expect(result).toMatchObject({ cause, outcomeUnknown: false, message: '网络连接失败，请检查网络后重试。' });
  expect(isTemporaryReadError(result)).toBe(true);
  expect(requiresWriteRecheck(result)).toBe(false);
  expect(isTemporaryReadError(cause)).toBe(false);
  expect(isTemporaryReadError(new Error('界面代码错误'))).toBe(false);
});

it.each(['POST', 'PATCH', 'PUT', 'DELETE'])('写请求 %s 传输失败标记为结果未知，禁止直接重试', async (method) => {
  const cause = new TypeError('Failed to fetch');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(cause));
  const result = await api('/api/issues/i1', { method }).catch((error: unknown) => error);
  expect(result).toBeInstanceOf(NetworkError);
  expect(result).toMatchObject({ cause, outcomeUnknown: true });
  expect((result as Error).message).toContain('操作结果暂时无法确认');
  expect(isTemporaryReadError(result)).toBe(false);
  expect(requiresWriteRecheck(result)).toBe(true);
});

it('显式只读的 POST 传输失败仍按读取错误处理', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  const result = await api('/api/analytics/query', { method: 'POST', readOnly: true }).catch((error: unknown) => error);
  expect(result).toMatchObject({ outcomeUnknown: false, message: '网络连接失败，请检查网络后重试。' });
  expect(isTemporaryReadError(result)).toBe(true);
  expect(requiresWriteRecheck(result)).toBe(false);
});

it('请求取消保持取消语义，不显示网络故障提示', async () => {
  const controller = new AbortController();
  controller.abort();
  const cause = controller.signal.reason;
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(cause));
  const result = await api('/api/my-work', { signal: controller.signal }).catch((error: unknown) => error);
  expect(result).toBe(cause);
  expect(isTemporaryReadError(result)).toBe(false);
});

it('成功响应结构和同源认证选项保持不变', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'r1', version: 3 })));
  vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  expect(await api('/api/requirements/r1', { signal: controller.signal })).toEqual({ id: 'r1', version: 3 });
  expect(fetcher).toHaveBeenCalledWith('/api/requirements/r1', expect.objectContaining({ signal: controller.signal, credentials: 'same-origin' }));
});

it('成功操作可以更新正常缓存，也可以填充尚未读取的详情', () => {
  const client = new QueryClient();
  try {
    cacheResourceUpdate(client, ['issue', 'i1'], { id: 'i1', version: 1 });
    cacheResourceUpdate(client, ['issue', 'i1'], { id: 'i1', version: 2 });
    expect(client.getQueryData(['issue', 'i1'])).toEqual({ id: 'i1', version: 2 });
  } finally { client.clear(); }
});

it('已拒绝的详情不能被迟到操作恢复，保留拒绝原因，成功重读后才可更新', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const queryKey = ['issue', 'i1'];
  const denied = new ApiError('无权查看', 403);
  try {
    client.setQueryData(queryKey, null);
    await expect(client.fetchQuery({ queryKey, queryFn: () => { throw denied; } })).rejects.toBe(denied);
    cacheResourceUpdate(client, queryKey, { id: 'i1', version: 2 });
    expect(client.getQueryData(queryKey)).toBeNull();
    expect(client.getQueryState(queryKey)?.error).toBe(denied);
    await client.fetchQuery({ queryKey, queryFn: async () => ({ id: 'i1', version: 3 }) });
    cacheResourceUpdate(client, queryKey, { id: 'i1', version: 4 });
    expect(client.getQueryData(queryKey)).toEqual({ id: 'i1', version: 4 });
  } finally { client.clear(); }
});

it.each([false, true])('读取期间出现新的拒绝时，迟到响应不能恢复详情（原缓存已拒绝：%s）', async (initiallyDenied) => {
  const client = new QueryClient();
  const queryKey = ['issue', 'i1'];
  let release!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'i1', version: 3 }))));
  try {
    client.setQueryData(queryKey, initiallyDenied ? null : { id: 'i1', version: 1 });
    const pending = readResourceFresh(client, queryKey, '/api/issues/i1', () => true);
    const rejected = expect(pending).rejects.toBeInstanceOf(ResourceReadInvalidatedError);
    client.setQueryData(queryKey, null);
    release(new Response(JSON.stringify({ id: 'i1', version: 2 })));
    await rejected;
    expect(client.getQueryData(queryKey)).toBeNull();
    await readResourceFresh(client, queryKey, '/api/issues/i1', () => true);
    expect(client.getQueryData(queryKey)).toEqual({ id: 'i1', version: 3 });
  } finally { client.clear(); }
});
