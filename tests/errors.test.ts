import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, errorResponse } from '../src/server/errors';

describe('统一错误响应', () => {
  it.each([
    [400, 'VALIDATION_ERROR'],
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'STALE_WRITE'],
  ] as const)('保留已知业务错误 %s', (statusCode, code) => {
    const response = errorResponse(new AppError('业务提示', statusCode, code));
    expect(response).toEqual({
      statusCode,
      payload: { error: '业务提示', code },
      known: true,
    });
  });

  it('将 Zod 输入错误映射为 400', () => {
    const parsed = z.object({ id: z.string().min(1, 'ID不能为空') }).safeParse({ id: '' });
    if (parsed.success) throw new Error('测试输入应校验失败');
    expect(errorResponse(parsed.error)).toMatchObject({
      statusCode: 400,
      payload: { error: 'ID不能为空', code: 'VALIDATION_ERROR' },
      known: true,
    });
  });

  it('隐藏未知异常的内部信息', () => {
    const response = errorResponse(new Error('database password: secret'));
    expect(response).toEqual({
      statusCode: 500,
      payload: { error: '服务器内部错误' },
      known: false,
    });
    expect(JSON.stringify(response)).not.toContain('secret');
  });
});
