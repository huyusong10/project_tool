import { describe, expect, it } from 'vitest';
import { dashboardOverview, dashboardWindow, matchesDashboardScope } from '../src/shared/dashboard';
import { businessDaysInclusive } from '../src/shared/domain';

type Item = Parameters<typeof matchesDashboardScope>[0] & { id: string };
const item = (id: string, extra: Partial<Item> = {}): Item => ({
  id, status: 'in_progress', delayed: false, highRisk: false, riskEvaluated: true,
  scheduleComplete: true, plannedEnd: '2026-09-17', createdAt: '2026-08-01T00:00:00.000Z', ...extra,
});
const window = dashboardWindow('2026-09-11');

describe('项目看板的统计与筛选', () => {
  it('只合并未结束需求，延期和高风险重叠只计一次；未知信息不按安全处理', () => {
    const rows = [
      item('both', { delayed: true, highRisk: true, plannedEnd: '2026-09-10' }),
      item('delay', { delayed: true, plannedEnd: '2026-09-09' }),
      item('risk', { status: 'not_started', highRisk: true }),
      item('near', { plannedEnd: '2026-09-11' }),
      item('finished', { status: 'completed', delayed: true, highRisk: true, actualEnd: '2026-09-08' }),
      item('cancelled', { status: 'cancelled', delayed: true, highRisk: true, actualEnd: '2026-09-08' }),
      item('partial', { riskEvaluated: false, scheduleComplete: false, plannedEnd: '2026-09-15' }),
      item('pending-risk', { riskEvaluated: false }),
    ];
    expect(dashboardOverview(rows, window.asOfDate)).toEqual({ ...window, counts: {
      in_progress: 5, not_started: 1, attention: 3, delayed: 2, high_risk: 1,
      due_soon: 3, due_attention: 1, recent_completed: 1, recent_created: 0, uncertain: 2,
    } });
    expect(rows.filter(r => matchesDashboardScope(r, 'attention', window)).map(r => r.id)).toEqual(['both', 'delay', 'risk']);
    expect(rows.filter(r => matchesDashboardScope(r, 'due_soon', window)).map(r => r.id)).toEqual(['risk', 'near', 'pending-risk']);
  });

  it('近期到期含今天和第五个工作日，排除过去、远期和部分排期', () => {
    expect(window).toEqual({ asOfDate: '2026-09-11', dueThrough: '2026-09-17', recentFrom: '2026-09-05' });
    for (const [day, expected] of [['2026-09-10', false], ['2026-09-11', true], ['2026-09-17', true], ['2026-09-18', false]] as const) {
      expect(matchesDashboardScope(item(day, { plannedEnd: day }), 'due_soon', window)).toBe(expected);
    }
    expect(matchesDashboardScope(item('partial', { scheduleComplete: false }), 'due_soon', window)).toBe(false);
    for (const day of ['2026-09-12', '2026-09-30', '2026-02-14', '2026-02-16']) {
      const w = dashboardWindow(day);
      expect(businessDaysInclusive(w.asOfDate, w.dueThrough)).toBe(5);
    }
    expect(dashboardWindow('2026-02-14').dueThrough).toBe('2026-02-27');
  });

  it('近七天使用北京时间自然日；完成日期与更新、观察日期分开', () => {
    const rows = [
      item('first-instant', { status: 'completed', actualEnd: '2026-09-04T16:00:00.000Z', createdAt: '2026-09-04T16:00:00.000Z' }),
      item('before', { status: 'completed', actualEnd: '2026-09-04T15:59:59.999Z', createdAt: '2026-09-04T15:59:59.999Z' }),
      item('last-instant', { status: 'completed', executionCompletedAt: '2026-09-11T15:59:59.999Z', createdAt: '2026-09-11T15:59:59.999Z' }),
      item('future', { status: 'completed', actualEnd: '2026-09-11T16:00:00.000Z', createdAt: '2026-09-11T16:00:00.000Z' }),
      { ...item('unknown', { status: 'completed' }), effectiveEnd: '2026-09-11', updatedAt: '2026-09-11' },
      item('reopened', { status: 'in_progress', actualEnd: '2026-09-11' }),
      item('fact-first', { status: 'completed', executionCompletedAt: '2026-09-01', actualEnd: '2026-09-11' }),
      item('invalid', { status: 'completed', actualEnd: '2026-02-30', createdAt: 'invalid' }),
    ];
    expect(rows.filter(r => matchesDashboardScope(r, 'recent_completed', window)).map(r => r.id)).toEqual(['first-instant', 'last-instant']);
    expect(dashboardOverview(rows, window.asOfDate).counts.recent_created).toBe(2);
    // Viewing a new business day advances the same scope without persisting a stale ID list.
    expect(matchesDashboardScope(rows[3], 'recent_completed', dashboardWindow('2026-09-12'))).toBe(true);
  });

  it('空项目为零，不用未来计划日期或更新日期补造完成记录', () => {
    expect(Object.values(dashboardOverview([], window.asOfDate).counts).every(n => n === 0)).toBe(true);
    expect(matchesDashboardScope(item('missing', { status: 'completed' }), 'recent_completed', window)).toBe(false);
  });
});
