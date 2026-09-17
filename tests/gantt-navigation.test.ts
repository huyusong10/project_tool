import { describe, expect, it } from 'vitest';
import { ganttAnchorAt, ganttAnchorPixel, ganttDates, surroundGanttAnchor } from '../src/client/gantt-navigation';
import {buildBusinessDayTimeline} from '../src/client/gantt-geometry';

describe('连续甘特时间轴', () => {
  it.each(['0100-01-01','9999-12-31'])('合法日期边界 %s 的显示留白不会越界',date=>{
    const base=buildBusinessDayTimeline([date],'day',date);
    expect(base.dates.length).toBeGreaterThan(0);
    const bounds=surroundGanttAnchor({start:date,end:date},{date,fraction:.5},40);
    expect(bounds.start>='0100-01-01'&&bounds.end<='9999-12-31').toBe(true);
    expect(ganttDates(bounds).length).toBeGreaterThan(0);
  });
  it('极端跨度保留原计划，日期窗口随定位移动且不会生成整个跨度',()=>{
    const values=['0100-01-01','9999-12-31'];
    const base=buildBusinessDayTimeline(values,'day','2026-09-18');
    expect(base.rangeLimited).toBe(true);expect(base.days).toBeLessThan(50);
    let window={start:'0100-01-01',end:'9999-12-31'};
    for(const date of ['0100-01-01','9999-12-31','2026-09-18']){
      window=surroundGanttAnchor(window,{date,fraction:.5},40);
      const dates=ganttDates(window);expect(dates.length).toBeLessThan(150);
      expect(ganttAnchorAt(dates,ganttAnchorPixel(dates,{date,fraction:.5},40),40).date).toBe(date);
    }
    expect(values).toEqual(['0100-01-01','9999-12-31']);
    expect(()=>ganttDates({start:values[0],end:values[1]})).toThrow('时间范围过大');
    expect(buildBusinessDayTimeline(['2026-01-01','2055-12-31'],'day','2026-09-18').rangeLimited).toBe(false);
  });
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
