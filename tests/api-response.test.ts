import { afterEach, expect, it, vi } from 'vitest';
import { api, ApiError, isTemporaryReadError, setUnauthorizedHandler } from '../src/client/api';

afterEach(() => { vi.unstubAllGlobals(); setUnauthorizedHandler(null); });
const respond = (response: Response) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

it.each(['{"id":', '', '<html>upstream internal error</html>'])('200 的异常正文不能被当成成功空对象：%s', async (body) => {
  respond(new Response(body, { status: 200 }));
  const error = await api('/api/requirements/r1').catch((caught: unknown) => caught);
  expect(error).toMatchObject({ name: 'InvalidResponseError', status: 200, outcomeUnknown: false });
  expect(isTemporaryReadError(error)).toBe(true);
  expect((error as Error).message).not.toContain('upstream internal error');
});

it('收到响应头后正文传输失败仍保留失败语义，不能返回空对象', async () => {
  const cause = new TypeError('Response body stream terminated');
  respond(new Response(new ReadableStream({ start(controller) { controller.error(cause); } }), { status: 200 }));
  const error = await api('/api/my-work').catch((caught: unknown) => caught);
  expect(error).toMatchObject({ name: 'InvalidResponseError', status: 200, outcomeUnknown: false, cause });
  expect(isTemporaryReadError(error)).toBe(true);
});

for (const status of [401, 403, 409, 503]) {
  it.each(['null', '[]', '<html>secret stack trace</html>', '{"error":{"internal":"secret"},"code":2,"currentVersion":"5"}'])(`${status} 的异常错误正文保持真实状态码：%s`, async (body) => {
    const unauthorized = vi.fn();
    setUnauthorizedHandler(unauthorized);
    respond(new Response(body, { status }));
    const error = await api('/api/requirements/r1').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, message: `请求失败（${status}）` });
    expect((error as ApiError).code).toBeUndefined();
    expect((error as ApiError).currentVersion).toBeUndefined();
    expect(isTemporaryReadError(error)).toBe(status === 503);
    expect(unauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
  });
}

it.each([403, 503])('HTTP %i 的正文传输失败不替换已知状态码', async (status) => {
  respond(new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('terminated')); } }), { status }));
  const error = await api('/api/issues/i1').catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status, message: `请求失败（${status}）` });
});

it.each([200, 401])('响应正文读取取消保持取消语义：HTTP %i', async (status) => {
  const abort = new AbortController();
  const unauthorized = vi.fn();
  setUnauthorizedHandler(unauthorized);
  let bodyController!: ReadableStreamDefaultController;
  respond(new Response(new ReadableStream({ start(controller) { bodyController = controller; } }), { status }));
  const request = api('/api/issues/i1', { signal: abort.signal });
  await Promise.resolve();
  abort.abort(new Error('用户取消读取'));
  bodyController.error(abort.signal.reason);
  await expect(request).rejects.toBe(abort.signal.reason);
  expect(unauthorized).not.toHaveBeenCalled();
});

it.each(['POST', 'PATCH', 'DELETE'])('写操作 %s 的异常成功响应必须提示结果未知且不自动重试', async (method) => {
  const fetcher = vi.fn().mockResolvedValue(new Response('<html>invalid result</html>', { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  const error = await api('/api/requirements/r1/progress', { method }).catch((caught: unknown) => caught);
  expect(error).toMatchObject({ name: 'InvalidResponseError', status: 200, outcomeUnknown: true });
  expect((error as Error).message).toContain('操作结果暂时无法确认');
  expect((error as Error).message).toContain('避免重复提交');
  expect(isTemporaryReadError(error)).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('显式只读的 POST 异常响应不误报为写入结果未知', async () => {
  respond(new Response('<html>invalid analytics result</html>', { status: 200 }));
  const error = await api('/api/analytics/query', { method: 'POST', readOnly: true }).catch((caught: unknown) => caught);
  expect(error).toMatchObject({ name: 'InvalidResponseError', outcomeUnknown: false });
  expect(isTemporaryReadError(error)).toBe(true);
});

it.each([204, 205])('HTTP %i 的无正文成功响应保持兼容', async (status) => {
  respond(new Response(null, { status }));
  expect(await api('/api/example', { method: 'DELETE' })).toEqual({});
});

it('HEAD 不要求 JSON 正文', async () => {
  respond(new Response(null, { status: 200 }));
  expect(await api('/api/example', { method: 'HEAD' })).toEqual({});
});

it.each([{ id: 'r1', version: 2 }, ['r1', 'r2'], null, true, 0, 'ok'])('有效 JSON 成功响应保持原结构：%j', async (value) => {
  respond(new Response(JSON.stringify(value), { status: 200 }));
  expect(await api('/api/example')).toEqual(value);
});

it('有效业务错误保留消息、代码、详情与并发版本', async () => {
  const errorBody = { error: '记录已更新', code: 'STALE_WRITE', details: { field: 'version' }, currentVersion: 5 };
  respond(new Response(JSON.stringify(errorBody), { status: 409 }));
  const error = await api('/api/requirements/r1').catch((caught: unknown) => caught);
  expect(error).toMatchObject({ message: errorBody.error, status: 409, code: errorBody.code, details: errorBody.details, currentVersion: 5 });
});
