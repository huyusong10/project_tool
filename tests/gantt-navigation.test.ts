import { describe, expect, it } from 'vitest';
import { ganttAnchorAt, ganttAnchorPixel, ganttDates, surroundGanttAnchor } from '../src/client/gantt-navigation';

describe('连续甘特时间轴', () => {
  const bounds = { start: '2026-09-01', end: '2026-09-30' };
  it('向左补日期补偿像素后，鼠标下的日期和小数位置不变', () => {
    const before = ganttDates(bounds), point = ganttAnchorAt(before, 147.5, 40);
    const after = ganttDates(surroundGanttAnchor(bounds, point, 20));
    expect(after.length).toBeGreaterThan(before.length);
    const compensation = ganttAnchorPixel(after, point, 40) - 147.5;
    expect(compensation).toBeGreaterThan(0);
    expect(ganttAnchorAt(after, 147.5 + compensation, 40)).toEqual(point);
  });
  it('跨月、跨年后可以回到原日期，不改变数据或缩放锚点', () => {
    const point = { date: '2026-09-10', fraction: .3 };
    let window = bounds;
    for (const date of ['2026-10-30', '2026-12-31', '2027-02-01', '2026-09-10']) window = surroundGanttAnchor(window, { date, fraction: .5 }, 30);
    const dates = ganttDates(window);
    for (const width of [40, 15, 6, 1.5]) {
      const restored = ganttAnchorAt(dates, ganttAnchorPixel(dates, point, width), width);
      expect(restored.date).toBe(point.date); expect(restored.fraction).toBeCloseTo(point.fraction);
    }
    expect(bounds).toEqual({ start: '2026-09-01', end: '2026-09-30' });
  });
  it('跳过假日且保留补班日，同一日期只生成一个格子', () => {
    const dates = ganttDates({ start: '2026-02-14', end: '2026-02-28' });
    expect(new Set(dates.map(d => d.getTime())).size).toBe(dates.length);
    expect(dates.some(d => d.getMonth() === 1 && d.getDate() === 17)).toBe(false);
    expect(ganttAnchorAt(dates, 0, 40).date).toBe('2026-02-14');
  });
});
