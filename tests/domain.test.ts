import { describe, expect, it } from 'vitest';
import {
  addBusinessDays, businessDayDelta, businessDaysInclusive, calculateWorkItemGap, deriveRequirementMetrics,
  deriveWorkItemStatus, ganttProgressDisplay, issueActionsByStatus, plannedDatesFromOffset, plannedStartFromDeadline, requirementActionsByStatus, riskLevelFromProgressGap, signedProgressVariance, workItemActionsByStatus, workItemPlannedProgress,
  isOverdueByWorkday,
} from '../src/shared/domain';
import { isBusinessDay, isValidIsoDate, workdayCalendarWarning } from '../src/shared/workday';
import { isoDateSchema, peopleConcurrencyInputSchema, reorderWorkItemsInputSchema } from '../src/shared/contracts';

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

  it('使用2026年法定节假日和调休，超出覆盖范围时回退并提示', () => {
    expect(isBusinessDay('2026-02-14')).toBe(true);
    expect(isBusinessDay('2026-02-16')).toBe(false);
    expect(addBusinessDays('2026-02-13', 1)).toBe('2026-02-14');
    expect(plannedDatesFromOffset('2026-02-13', 1, 2)).toEqual({ plannedStart: '2026-02-14', plannedEnd: '2026-02-24' });
    expect(plannedStartFromDeadline('2026-02-24', [{ startOffsetDays: 0, durationDays: 2 }])).toBe('2026-02-14');
    expect(isBusinessDay('2027-02-15')).toBe(true);
    expect(workdayCalendarWarning('2027-02-15', '2027-02-15')).toContain('周一至周五');
  });

  it('拒绝不存在的自然日，并按工作日判断是否逾期', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isoDateSchema.safeParse('2026-02-31').success).toBe(false);
    expect(isBusinessDay('2026-02-31')).toBe(false);
    expect(isOverdueByWorkday('2026-02-14', '2026-02-16')).toBe(false);
    expect(isOverdueByWorkday('2026-02-14', '2026-02-24')).toBe(true);
  });

  it('限制人员并发查询跨度并拒绝重复排序ID', () => {
    expect(peopleConcurrencyInputSchema.safeParse({ from: '2026-01-01', to: '2031-01-05' }).success).toBe(true);
    expect(peopleConcurrencyInputSchema.safeParse({ from: '2026-01-01', to: '2031-01-06' }).success).toBe(false);
    expect(reorderWorkItemsInputSchema.safeParse({ ids: ['a', 'a'], expectedVersion: 1 }).success).toBe(false);
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
  it('集中声明工作项、需求和问题的状态操作入口', () => {
    expect(workItemActionsByStatus.in_progress).toEqual(['progress', 'block', 'complete', 'cancel']);
    expect(workItemActionsByStatus.completed).toEqual(['reopen', 'correct']);
    expect(requirementActionsByStatus.pending_acceptance).toEqual(['accept', 'rework', 'cancel']);
    expect(issueActionsByStatus.resolved).toEqual(['reopen', 'correct']);
  });
  it('工作项以持久化状态为权威，不再由日期静默改写', () => {
    expect(deriveWorkItemStatus({ status: 'not_started', actualStart: '2026-09-01', actualEnd: '2026-09-02' })).toBe('not_started');
    expect(deriveWorkItemStatus({ status: 'in_progress', actualStart: '2026-09-01' })).toBe('in_progress');
    expect(deriveWorkItemStatus({ status: 'blocked', blockedAt: '2026-09-01T00:00:00Z' })).toBe('blocked');
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

  it('展示偏差保留领先和落后的方向，风险Gap仍保持非负', () => {
    expect(signedProgressVariance(61, 91)).toBe(-30);
    expect(signedProgressVariance(70, 50)).toBe(20);
    const ahead = deriveRequirementMetrics({ status: 'in_progress', priority: 'P1' }, [
      { status: 'in_progress', progress: 100, plannedStart: '2026-09-01', plannedEnd: '2026-09-10', actualStart: '2026-09-01' },
    ], '2026-09-02');
    expect(ahead.progressGap).toBe(0);
  });

  it('将未到期需求的进度位置换算为相对计划曲线的工作日偏差', () => {
    const behind = deriveRequirementMetrics({ status: 'in_progress', priority: 'P1' }, [
      { status: 'in_progress', progress: 25, plannedStart: '2026-09-01', plannedEnd: '2026-09-10', actualStart: '2026-09-01' },
    ], '2026-09-04');
    expect(behind).toMatchObject({
      plannedProgress: 50,
      scheduleReferenceDate: '2026-09-02',
      scheduleVarianceDays: 2,
      finishVariance: 0,
    });

    const ahead = deriveRequirementMetrics({ status: 'in_progress', priority: 'P1' }, [
      { status: 'in_progress', progress: 75, plannedStart: '2026-09-01', plannedEnd: '2026-09-10', actualStart: '2026-09-01' },
    ], '2026-09-04');
    expect(ahead).toMatchObject({
      plannedProgress: 50,
      scheduleReferenceDate: '2026-09-08',
      scheduleVarianceDays: -2,
      finishVariance: 0,
    });
  });

  it('状态进度圆点规范化完成、取消和异常进度', () => {
    expect(ganttProgressDisplay('not_started', 0)).toBe(0);
    expect(ganttProgressDisplay('in_progress', 61)).toBe(61);
    expect(ganttProgressDisplay('blocked', 45)).toBe(45);
    expect(ganttProgressDisplay('completed', 75)).toBe(100);
    expect(ganttProgressDisplay('cancelled', 30)).toBe('—');
    expect(ganttProgressDisplay('in_progress', -8)).toBe(0);
    expect(ganttProgressDisplay('in_progress', 108)).toBe(100);
  });

  it('阻塞或延期三工作日覆盖Gap规则，已关闭需求不再计算当前风险', () => {
    const high = deriveRequirementMetrics({ status: 'in_progress' }, [
      { status: 'in_progress', plannedStart: '2026-08-28', plannedEnd: '2026-09-01', actualStart: '2026-08-28' },
    ], '2026-09-04');
    expect(high.riskLevel).toBe('high');
    expect(high.riskReason).toContain('延期3个工作日');
    const customThreshold = deriveRequirementMetrics({ status: 'in_progress' }, [
      { status: 'in_progress', progress: 80, plannedStart: '2026-08-28', plannedEnd: '2026-09-01', actualStart: '2026-08-28' },
    ], '2026-09-04', 5);
    expect(customThreshold.riskLevel).toBe('medium');
    const medium = deriveRequirementMetrics({ status: 'in_progress', priority: 'P3' }, [
      { status: 'not_started', plannedStart: '2026-09-01', plannedEnd: '2026-09-01' },
      { status: 'not_started', plannedStart: '2026-09-08', plannedEnd: '2026-09-08' },
    ], '2026-09-01');
    expect(medium.progressGap).toBe(50);
    expect(medium.riskLevel).toBe('medium');
    expect(medium.riskReason).toContain('P3进度Gap 50%');
    const closed = deriveRequirementMetrics({ status: 'in_progress', priority: 'P0', acceptedAt: '2026-09-04' }, [
      { status: 'completed', plannedStart: '2026-09-01', plannedEnd: '2026-09-01', actualStart: '2026-09-01', actualEnd: '2026-09-04' },
    ], '2026-09-04');
    expect(closed).toMatchObject({ status: 'completed', riskEvaluated: false, riskLevel: 'low', highRisk: false, delayed: true });
  });
});
