import { describe, expect, it } from 'vitest';
import { formatDate } from '../src/client/format';

describe('日期格式化', () => {
  it('纯业务日期不经过浏览器时区换算', () => {
    expect(formatDate('2026-09-04')).toBe('2026/9/4');
  });

  it('无效业务日期保持原值', () => {
    expect(formatDate('2026-02-30')).toBe('2026-02-30');
  });
});
