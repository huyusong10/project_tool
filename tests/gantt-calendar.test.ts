import { describe, expect, it } from 'vitest';
import { ganttWeekOffsets } from '../src/client/gantt-calendar';

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
