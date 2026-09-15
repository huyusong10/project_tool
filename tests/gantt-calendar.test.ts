import { describe, expect, it } from 'vitest';
import { ganttWeekOffsets } from '../src/client/gantt-calendar';
import {ganttTrackStyle} from '../src/client/gantt-geometry';

describe('甘特工作日周边界', () => {
  it('月视图只画月边界，跨年和缺失的非工作日不改变日期比例',()=>{
    const dates=['2026-12-30','2026-12-31','2027-01-04','2027-01-05','2027-02-01'].map(value=>new Date(value+'T00:00:00'));
    const month=ganttTrackStyle(dates,6,'month');expect(month.backgroundImage).not.toContain('repeating-linear-gradient');expect(month.backgroundPosition).toBe('0px 0,12px 0,24px 0,0 0');
    expect(month.width).toBe(ganttTrackStyle(dates,6,'day').width);
  });
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
