import { describe, expect, it } from 'vitest';
import { ganttWeekOffsets } from '../src/client/gantt-calendar';
import {buildBusinessDayTimeline} from '../src/client/gantt-geometry';
import {format} from 'date-fns';

describe('甘特工作日周边界', () => {
  it('按真实周一而不是每五个工作日绘制周线', () => {
    const values = [
      '2026-02-09', '2026-02-10', '2026-02-11', '2026-02-12', '2026-02-13', '2026-02-14',
      '2026-02-24', '2026-02-25', '2026-02-26', '2026-02-27', '2026-02-28', '2026-03-02',
    ];
    const dates = values.map((value) => new Date(`${value}T00:00:00`));
    const offsets = ganttWeekOffsets(dates, 40);
    expect(offsets).toEqual([0, 440]);
    expect(offsets).not.toContain(200);
  });
});

describe('甘特手动扩展范围',()=>{
  const values=['2026-09-07','2026-09-10'];
  it('保留自动范围与日期坐标，只追加后面的工作日',()=>{
    const base=buildBusinessDayTimeline(values,'day','2026-09-08'),expanded=buildBusinessDayTimeline(values,'day','2026-09-08','2026-11-20');
    expect(format(base.end,'yyyy-MM-dd')).toBe('2026-09-30');
    expect(expanded.dates.slice(0,base.days)).toEqual(base.dates);
    expect(format(expanded.dates.at(-1)!,'yyyy-MM-dd')).toBe('2026-11-20');
    expect(buildBusinessDayTimeline(values,'day','2026-09-08','')).toEqual(base);
    expect(values).toEqual(['2026-09-07','2026-09-10']);
  });
  it('扩展值不能裁掉数据日期，也不能缩短月视图的自动范围',()=>{
    for(const zoom of ['day','week','month'] as const){const base=buildBusinessDayTimeline(['2026-09-07','2027-01-15'],zoom,'2026-09-08');expect(buildBusinessDayTimeline(['2026-09-07','2027-01-15'],zoom,'2026-09-08','2026-09-30')).toEqual(base);}
  });
  it('范围跨年且终点为非工作日时不制造日期格',()=>{
    const result=buildBusinessDayTimeline(values,'day','2026-09-08','2027-01-03');
    expect(result.dates.at(-1)!.getTime()).toBeLessThanOrEqual(result.end.getTime());
    expect(result.dates.some(d=>format(d,'yyyy-MM-dd')==='2027-01-03')).toBe(false);
  });
});
