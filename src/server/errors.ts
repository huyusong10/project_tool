import { ZodError } from 'zod';

export type AppErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'TERMINAL_LOCKED'
  | 'HISTORY_IMMUTABLE'
  | 'STALE_WRITE'
  | 'DEPENDENCY_CONFLICT';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: AppErrorCode;
  readonly details?: unknown;
  readonly currentVersion?: number;

  constructor(
    message: string,
    statusCode = 400,
    code: AppErrorCode = 'VALIDATION_ERROR',
    details?: unknown,
    currentVersion?: number,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.currentVersion = currentVersion;
  }
}

export function fail(
  message: string,
  code: AppErrorCode = 'VALIDATION_ERROR',
  statusCode = code === 'VALIDATION_ERROR' ? 400 : 409,
  details?: unknown,
  currentVersion?: number,
): never {
  throw new AppError(message, statusCode, code, details, currentVersion);
}

export function forbidden(message = '没有执行此操作的权限'): never {
  throw new AppError(message, 403, 'FORBIDDEN');
}

export function notFound(message = '资源不存在'): never {
  throw new AppError(message, 404, 'NOT_FOUND');
}

export function errorResponse(error: unknown) {
  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      payload: { error: error.issues[0]?.message || '请求参数不合法', code: 'VALIDATION_ERROR' },
      known: true,
    };
  }
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      payload: {
        error: error.message,
        code: error.code,
        ...(error.details === undefined ? {} : { details: error.details }),
        ...(error.currentVersion === undefined ? {} : { currentVersion: error.currentVersion }),
      },
      known: true,
    };
  }
  const candidate = error as { statusCode?: unknown; message?: unknown; code?: unknown };
  if (candidate?.code === 'SQLITE_CONSTRAINT_UNIQUE' || candidate?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
    return {
      statusCode: 409,
      payload: { error: '相同数据已被其他操作创建，请刷新后重试', code: 'DEPENDENCY_CONFLICT' },
      known: true,
    };
  }
  if (Number.isInteger(candidate?.statusCode) && Number(candidate.statusCode) >= 400 && Number(candidate.statusCode) < 500) {
    return {
      statusCode: Number(candidate.statusCode),
      payload: {
        error: typeof candidate.message === 'string' ? candidate.message : '请求参数不合法',
        ...(typeof candidate.code === 'string' ? { code: candidate.code } : {}),
      },
      known: true,
    };
  }
  return { statusCode: 500, payload: { error: '服务器内部错误' }, known: false };
}
