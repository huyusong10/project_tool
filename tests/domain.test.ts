import { describe, expect, it } from 'vitest';
import {
  businessDayDelta, businessDaysInclusive, calculateWorkItemGap, deriveRequirementMetrics,
  deriveWorkItemStatus, plannedDatesFromOffset, plannedStartFromDeadline, riskLevelFromProgressGap, workItemPlannedProgress,
} from '../src/shared/domain';

describe('工作日、排期与Gap规则', () => {
  it('排除周末并按偏移和工期生成计划', () => {
    expect(businessDaysInclusive('2026-09-04', '2026-09-07')).toBe(2);
    expect(businessDayDelta('2026-09-04', '2026-09-07')).toBe(1);
    expect(plannedDatesFromOffset('2026-09-04', 1, 3)).toEqual({ plannedStart: '2026-09-07', plannedEnd: '2026-09-09' });
  });

  it('按流程最晚结束偏移从截止日期倒排开始日期', () => {
    const items = [
      { startOffsetDays: 0, durationDays: 3 },
      { startOffsetDays: 1, durationDays: 4 },
      { startOffsetDays: 3, durationDays: 2 },
    ];
    expect(plannedStartFromDeadline('2026-09-11', items)).toBe('2026-09-07');
    expect(plannedDatesFromOffset('2026-09-07', 1, 4).plannedEnd).toBe('2026-09-11');
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

  it('按工作项估算完成度加权实际进度，并连续计算计划进度', () => {
    const metrics = deriveRequirementMetrics({ status: 'in_progress' }, [
      { status: 'in_progress', progress: 50, plannedStart: '2026-09-01', plannedEnd: '2026-09-02', actualStart: '2026-09-01' },
      { status: 'in_progress', progress: 25, plannedStart: '2026-09-03', plannedEnd: '2026-09-08', actualStart: '2026-09-03' },
    ], '2026-09-04');
    expect(metrics.progress).toBe(33);
    expect(workItemPlannedProgress({ status: 'in_progress', plannedStart: '2026-09-01', plannedEnd: '2026-09-04' }, '2026-09-02')).toBe(50);
    expect(metrics.plannedProgress).toBe(67);
  });

  it('按优先级使用不同的进度Gap风险阈值', () => {
    expect(riskLevelFromProgressGap('P0', 4)).toBe('low');
    expect(riskLevelFromProgressGap('P0', 5)).toBe('medium');
    expect(riskLevelFromProgressGap('P0', 20)).toBe('high');
    expect(riskLevelFromProgressGap('P1', 39)).toBe('medium');
    expect(riskLevelFromProgressGap('P1', 40)).toBe('high');
    expect(riskLevelFromProgressGap('P2', 49)).toBe('medium');
    expect(riskLevelFromProgressGap('P3', 59)).toBe('medium');
    expect(riskLevelFromProgressGap('P3', 60)).toBe('high');
  });

  it('阻塞或延期三工作日覆盖Gap规则，已关闭需求不再计算当前风险', () => {
    const high = deriveRequirementMetrics({ status: 'in_progress' }, [
      { status: 'in_progress', plannedStart: '2026-08-28', plannedEnd: '2026-09-01', actualStart: '2026-08-28' },
    ], '2026-09-04');
    expect(high.riskLevel).toBe('high');
    expect(high.riskReason).toContain('延期3个工作日');
    const medium = deriveRequirementMetrics({ status: 'in_progress', priority: 'P3' }, [
      { status: 'not_started', plannedStart: '2026-09-01', plannedEnd: '2026-09-01' },
      { status: 'not_started', plannedStart: '2026-09-08', plannedEnd: '2026-09-08' },
    ], '2026-09-01');
    expect(medium.progressGap).toBe(50);
    expect(medium.riskLevel).toBe('medium');
    expect(medium.riskReason).toContain('P3进度Gap 50%');
    const closed = deriveRequirementMetrics({ status: 'in_progress', priority: 'P0' }, [
      { status: 'completed', plannedStart: '2026-09-01', plannedEnd: '2026-09-01', actualStart: '2026-09-01', actualEnd: '2026-09-04' },
    ], '2026-09-04');
    expect(closed).toMatchObject({ status: 'completed', riskEvaluated: false, riskLevel: 'low', highRisk: false, delayed: true });
  });
});
