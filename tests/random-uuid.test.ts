import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from '../src/client/random-uuid';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('浏览器 UUID', () => {
  it('安全上下文使用浏览器原生 UUID', () => {
    const native = vi.spyOn(crypto, 'randomUUID');
    expect(randomUUID()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(native).toHaveBeenCalledOnce();
  });

  it('HTTP 上下文缺少 randomUUID 时仍生成有效且独立的 UUID v4', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const ids = Array.from({ length: 100 }, () => randomUUID());
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
