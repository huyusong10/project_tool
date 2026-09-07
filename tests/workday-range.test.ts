import { expect, it } from 'vitest';
import { addCalendarDays, businessDayDelta, businessDaysInclusive } from '../src/shared/domain';
import { isBusinessDay } from '../src/shared/workday';

function dayByDay(start: string, end: string) {
  let count = 0;
  for (let date = start; date <= end; date = addCalendarDays(date, 1)) count += Number(isBusinessDay(date));
  return count;
}

it('区间计数与逐日法定工作日判断一致，包含覆盖边界、闰日和反向区间', () => {
  for (const [start, end] of [
    ['2003-12-01', '2004-03-01'], ['2004-01-01', '2026-12-31'],
    ['2024-02-27', '2024-03-02'], ['2026-02-13', '2026-02-24'],
    ['2026-12-01', '2027-02-01'], ['2027-01-01', '2027-01-31'],
  ]) {
    const expected = dayByDay(start, end);
    expect(businessDaysInclusive(start, end)).toBe(expected);
    expect(businessDaysInclusive(end, start)).toBe(-expected);
  }
  expect(businessDaysInclusive('2026-02-14', '2026-02-14')).toBe(1);
  expect(businessDaysInclusive('2026-02-16', '2026-02-16')).toBe(0);
  expect(businessDayDelta('2026-02-14', '2026-02-24')).toBe(1);
  expect(businessDaysInclusive(null, '2026-01-01')).toBe(0);
  expect(businessDaysInclusive('2026-02-30', '2026-03-01')).toBe(0);
});

it('超出日历覆盖范围的远期日期不会逐日循环阻塞统计', () => {
  const started = performance.now();
  // 格里高利历400年恰好20871周；超范围部分固定按周一至周五计算。
  for (let count = 0; count < 1000; count += 1) expect(businessDaysInclusive('2027-01-01', '2426-12-31')).toBe(104355);
  expect(performance.now() - started).toBeLessThan(500);
});
