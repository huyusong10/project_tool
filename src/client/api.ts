export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown,
    public currentVersion?: number,
  ) { super(message); }
}

export class NetworkError extends Error {
  constructor(public outcomeUnknown: boolean, cause: unknown) {
    super(outcomeUnknown
      ? '网络连接中断，操作结果暂时无法确认。请先重新读取并核对，避免重复提交。'
      : '网络连接失败，请检查网络后重试。', { cause });
    this.name = 'NetworkError';
  }
}

export class InvalidResponseError extends Error {
  constructor(public status: number, public outcomeUnknown: boolean, cause: unknown) {
    super(outcomeUnknown
      ? '服务器响应异常，操作结果暂时无法确认。请先刷新核对，避免重复提交。'
      : '服务器响应不完整或格式异常，请重新加载。', { cause });
    this.name = 'InvalidResponseError';
  }
}

export class AccessChangedError extends Error {
  constructor() { super('登录状态或项目权限已变化，请重新加载后核对操作结果。'); }
}

let accessRevision = 0;
export function invalidateAccessRequests() { accessRevision++; }

export function isTemporaryReadError(error: unknown) {
  return error instanceof NetworkError && !error.outcomeUnknown || error instanceof InvalidResponseError && !error.outcomeUnknown || error instanceof ApiError &&
    (error.status === 408 || error.status === 429 || error.status >= 500 && error.status < 600);
}

/** 写入可能已经生效或操作前提已变化时，禁止直接重发，必须先读取服务端现状。 */
export function isWriteOutcomeUnknown(error: unknown) {
  return error instanceof NetworkError && error.outcomeUnknown
    || error instanceof InvalidResponseError && error.outcomeUnknown;
}

export function requiresWriteRecheck(error: unknown) {
  return error instanceof AccessChangedError
    || isWriteOutcomeUnknown(error)
    || error instanceof ApiError && [401, 403, 404, 409].includes(error.status);
}

function requestWasAborted(error: unknown, signal: AbortSignal | null | undefined) {
  return signal?.aborted || error instanceof Error && error.name === 'AbortError';
}

// 401 统一处理：由 App 注册（使会话失效并提示重新登录），api 层本身不依赖 React。
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

export type ApiRequestInit = RequestInit & { readOnly?: boolean };

export async function api<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { readOnly = false, ...requestInit } = init;
  const method = (requestInit.method || 'GET').toUpperCase();
  const outcomeUnknownOnTransportFailure = !readOnly && !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const revision = accessRevision;
  // 权限来源自身仍需刷新；旧业务请求不能给新身份回填数据或触发退出。
  const scopeSensitive = !(method === 'GET' && ['/api/session', '/api/projects', '/api/branding'].includes(path));
  const assertCurrentRequest = () => {
    if (requestInit.signal?.aborted) throw requestInit.signal.reason;
    if (scopeSensitive && revision !== accessRevision) throw new AccessChangedError();
  };
  const headers = new Headers(requestInit.headers);
  if (requestInit.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(path, { ...requestInit, headers, credentials: 'same-origin' });
  } catch (error) {
    if (requestWasAborted(error, requestInit.signal)) throw error;
    assertCurrentRequest();
    throw new NetworkError(outcomeUnknownOnTransportFailure, error);
  }
  assertCurrentRequest();
  if (response.ok && (response.status === 204 || response.status === 205 || method === 'HEAD')) return {} as T;
  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    if (requestWasAborted(error, requestInit.signal)) throw error;
    assertCurrentRequest();
    // 错误响应以 HTTP 状态为准；成功响应的正文异常必须拒绝，不能伪造成功数据。
    if (response.ok) throw new InvalidResponseError(response.status, outcomeUnknownOnTransportFailure, error);
  }
  assertCurrentRequest();
  if (!response.ok) {
    const fields = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
    if (response.status === 401 && !path.startsWith('/api/login') && !path.startsWith('/api/session')) unauthorizedHandler?.();
    throw new ApiError(
      typeof fields.error === 'string' && fields.error.trim() ? fields.error : `请求失败（${response.status}）`,
      response.status,
      typeof fields.code === 'string' ? fields.code : undefined,
      fields.details,
      typeof fields.currentVersion === 'number' && Number.isSafeInteger(fields.currentVersion) && fields.currentVersion > 0 ? fields.currentVersion : undefined,
    );
  }
  return data as T;
}

export function jsonBody(value: unknown) { return JSON.stringify(value); }
