import { performance } from 'node:perf_hooks';
import { LogController, type FastifyBaseLogger, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { errorWasLogged, readLogConfig, runWithLogContext, type LogContext } from '../../scripts/runtime-logger.mjs';
import { AppError, errorResponse } from './errors';
import { ZodError } from 'zod';
import { recordCreatedResource, recordHttpTarget, recordInputContext, recordValidationIssues } from './log-context';

type Outcome = { tool?: string; mcpMethod?: string; readOnly?: boolean; resultStatus?: number; errorCode?: string; err?: unknown };
type RequestState = Outcome & { started: number; completed: boolean; context: LogContext };
const states = new WeakMap<FastifyRequest, RequestState>();
function state(request: FastifyRequest) {
  let value = states.get(request);
  if (!value) {
    value = { started: performance.now(), completed: false, context: {
      reqId: request.id, user: '未登录', actorType: 'anonymous', authMethod: 'none', sourceIp: request.ip,
    } };
    states.set(request, value);
  }
  return value;
}

export function setMcpOutcome(request: FastifyRequest, outcome: Outcome) { Object.assign(state(request), outcome); }
export function captureRequestError(request: FastifyRequest, error: unknown) {
  const response = errorResponse(error);
  const value = state(request);
  if (error instanceof ZodError) recordValidationIssues(error.issues);
  if (error instanceof AppError) {
    value.context.reason ||= error.message.slice(0, 400);
    value.context.reasonCode ||= error.code;
    if (error.currentVersion !== undefined) value.context.currentVersion = error.currentVersion;
  } else if (!(error instanceof ZodError)) {
    value.context.reason ||= response.known ? statusReason(response.statusCode) : '服务内部处理异常';
  }
  if (value.completed && !response.known && !errorWasLogged(error)) {
    const module = request.routeOptions.url === '/mcp' ? 'mcp' : 'http';
    request.log.error({ ...value.context, module, event: `${module}.after_response_failed`, err: error,
      route: request.routeOptions.url || '<unmatched>' }, '响应结束后的处理失败');
  }
  Object.assign(value, { resultStatus: response.statusCode,
    errorCode: 'code' in response.payload ? response.payload.code : response.known ? `HTTP_${response.statusCode}` : 'INTERNAL_ERROR',
    ...(!response.known ? { err: error } : {}) });
}

const readOnlyPosts = new Set(['/api/analytics/query', '/api/requirements/:id/plan-preview',
  '/api/projects/:id/dependency-changes/preview', '/api/requirements/:id/dependency-plan/preview', '/api/system/database-check']);
function statusReason(status: number) {
  return ({ 400: '请求参数或正文格式不合法', 401: '未提供有效的登录凭据', 403: '当前身份没有执行权限',
    404: '请求的资源不存在', 405: '请求方法不受支持', 409: '数据状态或版本冲突', 410: '此接口已移除',
    413: '请求正文超过大小限制', 415: '请求内容类型不受支持', 429: '请求过于频繁，请稍后重试' } as Record<number, string>)[status]
    || (status >= 500 ? '服务内部处理异常' : '请求未通过业务检查');
}

export class RequestLogController extends LogController {
  constructor(private slowMs = readLogConfig().slowMs) { super(); }
  override incomingRequest(request: FastifyRequest) { state(request); }
  override routeNotFound() { /* The completion record includes 404, without the raw URL. */ }
  override defaultErrorLog(error: Error, request: FastifyRequest) { captureRequestError(request, error); }
  override serializerError(error: Error, request: FastifyRequest) { captureRequestError(request, error); }
  override writeHeadError(error: Error, request: FastifyRequest, reply: FastifyReply) {
    captureRequestError(request, error); this.complete(request, reply);
  }
  override streamError(error: Error, request: FastifyRequest, reply: FastifyReply) {
    const premature = (error as NodeJS.ErrnoException).code === 'ERR_STREAM_PREMATURE_CLOSE';
    if (!premature) captureRequestError(request, error);
    this.complete(request, reply, true);
  }
  override serviceUnavailable(logger: FastifyBaseLogger) {
    logger.error({ module: 'http', event: 'http.unavailable', statusCode: 503 }, '服务正在关闭，请求被拒绝');
  }
  override requestCompleted(error: Error | null | undefined, request: FastifyRequest, reply: FastifyReply) {
    if (error) captureRequestError(request, error);
    this.complete(request, reply);
  }
  complete(request: FastifyRequest, reply: FastifyReply, aborted = false) {
    const value = state(request);
    if (value.completed) return;
    value.completed = true;
    const route = request.routeOptions.url || '<unmatched>';
    const mcp = route === '/mcp';
    const durationMs = Math.max(0, Math.round(performance.now() - value.started));
    const statusCode = reply.raw.statusCode;
    const resultStatus = statusCode >= 400 ? statusCode : value.resultStatus || statusCode;
    const slow = durationMs >= this.slowMs;
    const readOnly = mcp ? value.readOnly !== false : ['GET', 'HEAD', 'OPTIONS'].includes(request.method) || readOnlyPosts.has(route);
    const level = value.err || resultStatus >= 500 ? 'error'
      : aborted || [401, 403, 429].includes(resultStatus) || slow ? 'warn'
      : resultStatus >= 400 || !readOnly ? 'info' : 'debug';
    const outcome = aborted ? 'aborted' : resultStatus >= 500 ? 'failed' : resultStatus >= 400 ? 'rejected' : 'succeeded';
    if (outcome !== 'succeeded') {
      value.context.reason ||= aborted ? '客户端或传输连接提前关闭' : statusReason(resultStatus);
      value.context.reasonCode ||= value.errorCode || (aborted ? 'CONNECTION_ABORTED' : `HTTP_${resultStatus}`);
    }
    const msg = aborted ? '连接中断' : outcome === 'failed' ? '处理失败'
      : resultStatus === 401 ? '身份验证未通过' : resultStatus === 403 ? '权限检查未通过'
      : mcp && value.errorCode === 'MCP_RPC_-32601' ? 'MCP 方法不受支持'
      : resultStatus === 404 ? '资源不可访问' : resultStatus === 400 ? '参数校验未通过'
      : resultStatus === 409 ? '操作发生冲突' : outcome === 'rejected' ? '调用未执行' : slow ? '请求耗时较长' : '请求完成';
    request.log[level]({ ...value.context, module: mcp ? 'mcp' : 'http', event: mcp ? 'mcp.completed' : 'http.completed',
      method: request.method, route, statusCode, durationMs, outcome, ...(slow ? { slow } : {}),
      ...(value.mcpMethod ? { mcpMethod: value.mcpMethod } : {}),
      ...(value.tool ? { tool: value.tool } : {}), ...(value.errorCode ? { errorCode: value.errorCode } : {}),
      ...(value.err ? { err: value.err } : {}) }, msg);
  }
}

export function registerRequestLogging(app: FastifyInstance, controller: RequestLogController) {
  app.addHook('onRequest', (request, reply, done) => {
    state(request);
    reply.raw.once('finish', () => controller.complete(request, reply));
    reply.raw.once('close', () => { if (!reply.raw.writableFinished) controller.complete(request, reply, true); });
    runWithLogContext(state(request).context, done);
  });
  app.addHook('preValidation', (request, _reply, done) => {
    const route = request.routeOptions.url || '';
    if (route !== '/mcp') {
      recordInputContext(route, request.query);
      recordInputContext(route, request.body, ['PATCH', 'PUT'].includes(request.method));
      recordHttpTarget(route, request.params);
    }
    done();
  });
  app.addHook('onSend', (request, reply, payload, done) => {
    if (reply.statusCode >= 400 && typeof payload === 'string' && payload.length < 4096) {
      try {
        const body = JSON.parse(payload), code = body.code;
        if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(code)) state(request).errorCode = code;
        if (typeof body.error === 'string') state(request).context.reason ||= body.error.slice(0, 400);
      } catch { /* Non-JSON framework responses still have a status code. */ }
    } else if (reply.statusCode < 300 && request.method === 'POST' && typeof payload === 'string' && payload.length < 8192) {
      try { recordCreatedResource(request.routeOptions.url || '', JSON.parse(payload)); } catch { /* No object identifier. */ }
    }
    done(null, payload);
  });
}
