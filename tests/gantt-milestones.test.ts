import { describe, expect, it } from 'vitest';
import { achievedMilestones, groupMilestones, milestoneAncestors, milestoneDate, milestoneDay, milestonePosition, milestoneState, milestoneTiming, requirementMilestones, type GanttMilestone } from '../src/client/gantt-milestones';
import type { WorkItem } from '../src/client/types';
const dates = ['2026-09-04', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'].map(d => new Date(d + 'T00:00:00'));
const m = (fields: Partial<GanttMilestone> = {}): GanttMilestone => ({ id: 'm', title: '接口基线', relatedIds: [], ...fields });
describe('甘特里程碑切面', () => {
  it('进度图只保留有效达成记录，按实际日期画一个点，保留目标供详情比较', () => {
    const reached = m({ targetDate: '2030-09-10', actualDate: '2026-09-07' });
    const items = achievedMilestones([reached, m({ id: 'planned', targetDate: '2026-09-04' }),
      m({ id: 'forecast', forecastDate: '2026-09-08' }), m({ id: 'unknown' }),
      m({ id: 'cancelled', cancelled: true, actualDate: '2026-09-07' }), m({ id: 'invalid', actualDate: 'invalid' })]);
    expect(items).toHaveLength(1);
    expect(items[0].targetDate).toBe('2030-09-10');
    expect(milestoneDate(items[0])).toBe('2026-09-07');
    expect(milestonePosition(items[0], dates, 40)).toBe(80);
    expect(milestoneTiming(items[0])).toBe('实际 2026-09-07');
    expect(milestoneDate(reached)).toBe('2030-09-10'); // The planning object is untouched.
  });
  it('旧标签仅在工作完成且有实际日期时显示，需求整体未完成不影响独立里程碑', () => {
    const legacy = { id: 'w', requirementId: 'r', milestoneLabel: '旧基线', plannedEnd: '2026-09-10', status: 'in_progress' } as WorkItem;
    expect(achievedMilestones(requirementMilestones(undefined, [legacy]))).toEqual([]);
    expect(achievedMilestones(requirementMilestones(undefined, [{ ...legacy, status: 'completed' }]))).toEqual([]);
    const items = requirementMilestones([{ id: 'm', title: '接口基线', requirementId: 'r', projectId: 'p', targetDate: '2026-09-10', achievedAt: '2026-09-07', confirmationMode: 'manual', version: 1 }], [legacy]);
    expect(achievedMilestones(items).map(m => m.id)).toEqual(['m']);
  });
  it('目标固定在当日结束边界，实际达成使用独立位置', () => {
    const item = m({ targetDate: '2026-09-10', actualDate: '2026-09-07', forecastDate: '2026-09-08' });
    expect(milestoneDate(item)).toBe('2026-09-10');
    expect(milestonePosition(item, dates, 40)).toBe(200);
    expect(milestonePosition(item, dates, 40, true)).toBe(80);
    expect(milestoneState(item, '2026-09-15')).toBe('reached');
  });
  it('周末切面压缩到前一工作日末尾，范围外不贴到边界', () => {
    expect(milestonePosition(m({ targetDate: '2026-09-06' }), dates, 40)).toBe(40);
    expect(milestonePosition(m({ targetDate: '2026-09-15' }), dates, 40)).toBeNull();
    expect(milestonePosition(m({ targetDate: '2026-09-03' }), dates, 40)).toBeNull();
  });
  it('预计和实际不会伪装成目标，未知日期不会落到今天', () => {
    expect(milestoneTiming(m({ forecastDate: '2026-09-08' }))).toBe('日期待确认');
    expect(milestoneTiming(m({ forecastDate: '2026-09-08' }), true)).toBe('预计 2026-09-08');
    expect(milestoneTiming(m({ actualDate: '2026-09-07' }))).toBe('实际 2026-09-07');
    expect(milestonePosition(m(), dates, 40)).toBeNull();
    expect(milestoneState(m({ cancelled: true, actualDate: '2026-09-07' }), '2026-09-15')).toBe('cancelled');
    expect(milestoneDay('garbage')).toBeNull();
  });
  it('进度甘特不按预测定位未排期里程碑，排期预览仍可显示预测', () => {
    const forecast = m({ forecastDate: '2026-09-08' });
    expect(milestoneDate(forecast)).toBeNull();
    expect(milestonePosition(forecast, dates, 40)).toBeNull();
    expect(groupMilestones([forecast], dates, 40, 200)).toEqual([]);
    expect(milestoneDate(forecast, true)).toBe('2026-09-08');
    expect(milestonePosition(forecast, dates, 40, false, true)).toBe(120);
    expect(groupMilestones([forecast], dates, 40, 200, true)).toHaveLength(1);
    expect(milestonePosition(m({ actualDate: '2026-09-07', forecastDate: '2026-09-08' }), dates, 40)).toBe(80);
  });
  it('同日和相邻标签合并但保留所有原对象，标签互不重叠', () => {
    for (const cell of [6, 15, 40, 80]) {
      const items = dates.flatMap((_, i) => [m({ id: 'a' + i, offset: i }), m({ id: 'b' + i, offset: i })]);
      const groups = groupMilestones(items, [], cell, 5 * cell);
      expect(groups.flatMap(g => g.items).map(i => i.id).sort()).toEqual(items.map(i => i.id).sort());
      groups.forEach((g, i) => { expect(g.labelLeft).toBeGreaterThanOrEqual(0); expect(g.labelLeft + g.width).toBeLessThanOrEqual(5 * cell); if (i) expect(g.labelLeft).toBeGreaterThan(groups[i - 1].labelLeft + groups[i - 1].width); });
    }
  });
  it('只按明确前置高亮，不按日期推断；跨需求往返不会丢失上游', () => {
    const edges = [{ source: 'A设计', target: 'B开发' }, { source: 'B开发', target: 'A联调' }, { source: 'A联调', target: 'm' }];
    expect(milestoneAncestors('m', edges).sort()).toEqual(['A设计', 'A联调', 'B开发'].sort());
    expect(milestoneAncestors('孤立', edges)).toEqual([]);
  });
  it('模板零工期切面位于前置结束时刻，不额外增加一天', () => {
    expect(milestonePosition(m({ offset: 2 }), [], 40)).toBe(80);
    expect(milestonePosition(m({ offset: 0 }), [], 40)).toBe(0);
  });
  it('独立里程碑优先于迁移前工作项标签，已取消也保留状态', () => {
    const result = requirementMilestones([{ id: 'm', title: '接口基线', requirementId: 'r', projectId: 'p', targetDate: '2026-09-10', achievedAt: null, confirmationMode: 'manual', version: 1 }], []);
    expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ id: 'm', manual: true, targetDate: '2026-09-10', actualDate: null });
  });
  it('服务端明确返回空里程碑列表时，不复活已经删除的历史标签', () => {
    const legacy = { id: 'w', requirementId: 'r', milestoneLabel: '旧基线', plannedEnd: '2026-09-10', status: 'not_started' } as WorkItem;
    expect(requirementMilestones(undefined, [legacy])).toHaveLength(1);
    expect(requirementMilestones([], [legacy])).toEqual([]);
  });
});
