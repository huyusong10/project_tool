import { describe, expect, it } from 'vitest';
import {
  businessDayDelta, businessDaysInclusive, calculateWorkItemGap, deriveRequirementMetrics,
  deriveWorkItemStatus, plannedDatesFromOffset,
} from '../src/shared/domain';

describe('工作日、排期与Gap规则', () => {
  it('排除周末并按偏移和工期生成计划', () => {
    expect(businessDaysInclusive('2026-09-04', '2026-09-07')).toBe(2);
    expect(businessDayDelta('2026-09-04', '2026-09-07')).toBe(1);
    expect(plannedDatesFromOffset('2026-09-04', 1, 3)).toEqual({ plannedStart: '2026-09-07', plannedEnd: '2026-09-09' });
  });

  it('计算并排计划和实际的完成及耗时偏差', () => {
    const gap = calculateWorkItemGap({ status: 'completed', plannedStart: '2026-09-01', plannedEnd: '2026-09-04', actualStart: '2026-09-01', actualEnd: '2026-09-08' });
    expect(gap.planDuration).toBe(4);
    expect(gap.actualDuration).toBe(6);
    expect(gap.finishVariance).toBe(2);
    expect(gap.durationVariance).toBe(2);
  });
});

describe('自动状态、进度和风险', () => {
  it('实际日期优先于遗留状态推导工作项状态', () => {
    expect(deriveWorkItemStatus({ status: 'not_started', actualStart: '2026-09-01', actualEnd: '2026-09-02' })).toBe('completed');
    expect(deriveWorkItemStatus({ status: 'not_started', actualStart: '2026-09-01' })).toBe('in_progress');
    expect(deriveWorkItemStatus({ status: 'not_started', blockedAt: '2026-09-01T00:00:00Z' })).toBe('blocked');
  });

  it('按计划工期加权已完成工作项', () => {
    const metrics = deriveRequirementMetrics({ status: 'in_progress' }, [
      { status: 'completed', plannedStart: '2026-09-01', plannedEnd: '2026-09-02', actualStart: '2026-09-01', actualEnd: '2026-09-02' },
      { status: 'not_started', plannedStart: '2026-09-03', plannedEnd: '2026-09-08' },
    ], '2026-09-02');
    expect(metrics.status).toBe('in_progress');
    expect(metrics.progress).toBe(33);
  });

  it('阻塞或延期三工作日为高风险，进度差20%为中风险', () => {
    const high = deriveRequirementMetrics({ status: 'in_progress' }, [
      { status: 'in_progress', plannedStart: '2026-08-28', plannedEnd: '2026-09-01', actualStart: '2026-08-28' },
    ], '2026-09-04');
    expect(high.riskLevel).toBe('high');
    const medium = deriveRequirementMetrics({ status: 'in_progress' }, [
      { status: 'not_started', plannedStart: '2026-09-01', plannedEnd: '2026-09-01' },
      { status: 'not_started', plannedStart: '2026-09-08', plannedEnd: '2026-09-08' },
    ], '2026-09-01');
    expect(medium.progressGap).toBe(50);
    expect(medium.riskLevel).toBe('medium');
  });
});
