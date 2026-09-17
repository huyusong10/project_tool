import { describe, expect, it } from 'vitest';
import {
  addBusinessDays, addCalendarDays, businessDateFromDateTime, businessDayDelta, businessDaysInclusive, calculateWorkItemGap, deriveRequirementMetrics,
  deriveRequirementScheduleRange, deriveWorkItemStatus, ganttProgressDisplay, issueActionsByStatus, plannedDatesFromOffset, plannedStartFromDeadline, requirementActionsByStatus, riskLevelFromProgressGap, signedProgressVariance, workItemActionsByStatus, workItemPlannedProgress,
  isOverdueByWorkday, startOfWeekIso,
} from '../src/shared/domain';
import { DateRangeError, hasWorkdayCalendarFallback, isBusinessDay, isValidIsoDate } from '../src/shared/workday';
import { isoDateSchema, issueInputSchema, peopleConcurrencyInputSchema, reorderWorkItemsInputSchema, templateInputSchema } from '../src/shared/contracts';
import { analyticsCatalog } from '../src/shared/analytics';

describe('工作日、排期与Gap规则', () => {
  it('日期加减越界立即报错，边界内的最后工作日仍可排期', () => {
    expect(isoDateSchema.safeParse('9999-12-31').success).toBe(true);
    expect(isoDateSchema.safeParse('0100-01-01').success).toBe(true);
    expect(addBusinessDays('9999-12-30', 1)).toBe('9999-12-31');
    expect(addBusinessDays('0100-01-01', 0)).toBe('0100-01-01');
    expect(() => addBusinessDays('9999-12-31', 1)).toThrow(DateRangeError);
    expect(() => addBusinessDays('0100-01-01', -1)).toThrow(DateRangeError);
    expect(() => addCalendarDays('9999-12-31', 1)).toThrow(DateRangeError);
    expect(() => plannedDatesFromOffset('9999-12-31', 0, 2)).toThrow(DateRangeError);
  });

  it('排除周末并按偏移和工期生成计划', () => {
    expect(businessDaysInclusive('2026-09-04', '2026-09-07')).toBe(2);
    expect(businessDayDelta('2026-09-04', '2026-09-07')).toBe(1);
    expect(plannedDatesFromOffset('2026-09-04', 1, 3)).toEqual({ plannedStart: '2026-09-07', plannedEnd: '2026-09-09' });
  });

  it('按纯业务日期计算周一，不受运行时区影响', () => {
    expect(startOfWeekIso('2026-09-04')).toBe('2026-08-31');
    expect(startOfWeekIso('2026-09-06')).toBe('2026-08-31');
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

  it('使用2026年法定节假日和调休，超出覆盖范围时回退', () => {
    expect(isBusinessDay('2026-02-14')).toBe(true);
    expect(isBusinessDay('2026-02-16')).toBe(false);
    expect(addBusinessDays('2026-02-13', 1)).toBe('2026-02-14');
    expect(plannedDatesFromOffset('2026-02-13', 1, 2)).toEqual({ plannedStart: '2026-02-14', plannedEnd: '2026-02-24' });
    expect(plannedStartFromDeadline('2026-02-24', [{ startOffsetDays: 0, durationDays: 2 }])).toBe('2026-02-14');
    expect(isBusinessDay('2027-02-15')).toBe(true);
    expect(hasWorkdayCalendarFallback(['2026-12-31'])).toBe(false);
    expect(hasWorkdayCalendarFallback(['2026-12-31', '2027-01-01'])).toBe(true);
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

  it('时间戳统一换算为上海业务日期，并限制异常大的流程', () => {
    expect(businessDateFromDateTime('2026-09-02T15:59:59.000Z')).toBe('2026-09-02');
    expect(businessDateFromDateTime('2026-09-02T16:00:00.000Z')).toBe('2026-09-03');
    expect(templateInputSchema.safeParse({ items: Array.from({ length: 201 }, (_, index) => ({ title: `${index}`, startOffsetDays: 0, durationDays: 1, sortOrder: index })) }).success).toBe(false);
    expect(templateInputSchema.safeParse({ items: [{ title: '异常工期', startOffsetDays: 0, durationDays: 1831, sortOrder: 0 }] }).success).toBe(false);
  });

  it('限制人员并发查询跨度并拒绝重复排序ID', () => {
    expect(peopleConcurrencyInputSchema.safeParse({ from: '2026-01-01', to: '2031-01-05' }).success).toBe(true);
    expect(peopleConcurrencyInputSchema.safeParse({ from: '2026-01-01', to: '2031-01-06' }).success).toBe(false);
    expect(reorderWorkItemsInputSchema.safeParse({ ids: ['a', 'a'], expectedVersion: 1 }).success).toBe(false);
  });

  it('问题输入契约声明范围标识和发现日期', () => {
    expect(issueInputSchema.keyof().options).toEqual(expect.arrayContaining(['sourceRef', 'discoveredAt']));
    expect(issueInputSchema.safeParse({ sourceRef: 'DCIM-36', discoveredAt: '2026-09-05' }).success).toBe(true);
    expect(issueInputSchema.safeParse({ discoveredAt: '2026-02-31' }).success).toBe(false);
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
  it('分析筛选分别使用完整的需求和工作项状态', () => {
    const statuses = (dataset: string) => analyticsCatalog.datasets.find((item) => item.id === dataset)!
      .filters.find((filter) => filter.id === 'status')!.options.map((option) => option.value);
    expect(statuses('requirements')).toEqual(['not_started', 'in_progress', 'completed', 'cancelled']);
    expect(statuses('work_items')).toEqual(['not_started', 'in_progress', 'completed', 'cancelled']);
  });

  it('集中声明工作项、需求和问题的状态操作入口', () => {
    expect(workItemActionsByStatus.in_progress).toEqual(['progress', 'complete', 'cancel']);
    expect(workItemActionsByStatus.completed).toEqual(['reopen', 'correct']);
    expect(requirementActionsByStatus.completed).toEqual(['rework', 'correct', 'archive']);
    expect(issueActionsByStatus.resolved).toEqual(['reopen', 'correct']);
  });
  it('工作项以持久化状态为权威，不再由日期静默改写', () => {
    expect(deriveWorkItemStatus({ status: 'not_started', actualStart: '2026-09-01', actualEnd: '2026-09-02' })).toBe('not_started');
    expect(deriveWorkItemStatus({ status: 'in_progress', actualStart: '2026-09-01' })).toBe('in_progress');
    expect(deriveWorkItemStatus({ status: 'cancelled', actualStart: '2026-09-01' })).toBe('cancelled');
  });

  it('需求排期边界统一由有效工作项聚合', () => {
    expect(deriveRequirementScheduleRange({ plannedStart: '2026-09-04', plannedEnd: '2026-09-11' }, [
      { status: 'in_progress', plannedStart: '2026-08-17', plannedEnd: '2026-09-09' },
      { status: 'not_started', plannedStart: '2026-09-09', plannedEnd: '2026-09-11' },
      { status: 'cancelled', plannedStart: '2026-08-01', plannedEnd: '2026-09-30' },
    ])).toEqual({ plannedStart: '2026-08-17', plannedEnd: '2026-09-11', scheduleComplete: true });
  });

  it('排期不完整时保留可用边界但不进行风险评估', () => {
    const metrics = deriveRequirementMetrics({ status: 'in_progress', plannedStart: '2026-09-04', plannedEnd: '2026-09-11' }, [
      { status: 'in_progress', progress: 50, plannedStart: '2026-08-17', plannedEnd: '2026-09-09', actualStart: '2026-08-17' },
      { status: 'not_started', plannedStart: null, plannedEnd: '2026-09-11' },
    ], '2026-09-04');
    expect(metrics).toMatchObject({ plannedStart: '2026-08-17', plannedEnd: '2026-09-11', scheduleComplete: false, riskEvaluated: false });
    expect(metrics.riskReason).toBe('缺少完整排期，暂无法评估风险');
  });

  it('按计划工期加权已完成工作项', () => {
    const metrics = deriveRequirementMetrics({ status: 'in_progress' }, [
      { status: 'completed', plannedStart: '2026-09-01', plannedEnd: '2026-09-02', actualStart: '2026-09-01', actualEnd: '2026-09-02' },
      { status: 'not_started', plannedStart: '2026-09-03', plannedEnd: '2026-09-08' },
    ], '2026-09-02');
    expect(metrics.status).toBe('in_progress');
    expect(metrics.progress).toBe(33);
  });

  it.each(['in_progress', 'completed'])('部分排期超过结束日不视为需求延期：%s', status => {
    const metrics = deriveRequirementMetrics({ status }, [
      { status: 'completed', progress: 100, plannedStart: '2026-09-07', plannedEnd: '2026-09-10', actualStart: '2026-09-07', actualEnd: '2026-09-10' },
      { status, progress: 20, durationDays: 5, actualStart: '2026-09-11', actualEnd: status === 'completed' ? '2026-09-14' : null },
    ], '2026-09-18');
    expect(metrics.progress).toBeGreaterThan(0);
    expect(metrics).toMatchObject({ scheduleComplete: false, plannedProgress: null, scheduleVarianceDays: null,
      scheduleReferenceDate: null, finishVariance: 0, delayed: false, riskEvaluated: false });
    expect(signedProgressVariance(metrics.progress, metrics.plannedProgress)).toBeNull();
    if (status === 'completed') expect(metrics.effectiveEnd).toBe('2026-09-14');
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

  it.each([null, '2026-09-04T10:46:36.014Z'])('工作按期完成后不随等待验收或验收确认时间增加延期：%s', acceptedAt => {
    const items = [
      { status: 'completed', plannedStart: '2026-08-19', plannedEnd: '2026-08-28', actualStart: '2026-08-19', actualEnd: '2026-08-28' },
      { status: 'completed', plannedStart: '2026-08-19', plannedEnd: '2026-08-24', actualStart: '2026-08-19', actualEnd: '2026-08-24' },
      { status: 'cancelled', plannedStart: '2026-08-19', plannedEnd: '2026-09-30', actualStart: '2026-08-19', actualEnd: '2026-09-10' },
    ];
    for (const today of ['2026-09-04', '2026-09-10']) {
      expect(deriveRequirementMetrics({ acceptedAt }, items, today)).toMatchObject({
        status: 'completed', progress: 100,
        effectiveEnd: '2026-08-28', finishVariance: 0, delayed: false,
      });
    }
  });

  it.each([
    ['2026-08-27', -1], ['2026-09-01', 2],
  ])('工作完成日期 %s 决定实际提前或延期，不受确认时间影响', (actualEnd, finishVariance) => {
    for (const acceptedAt of [null, '2026-09-10']) {
      const metrics = deriveRequirementMetrics({ acceptedAt }, [
        { status: 'completed', plannedStart: '2026-08-19', plannedEnd: '2026-08-28', actualStart: '2026-08-19', actualEnd },
      ], '2026-09-10');
      expect(metrics).toMatchObject({ effectiveEnd: actualEnd, finishVariance, delayed: finishVariance > 0 });
    }
  });

  it.each(['completed'])('直接执行需求 %s 按实际结束日期计算偏差', status => {
    expect(deriveRequirementMetrics({ executionMode: 'direct', status, progress: 100,
      plannedStart: '2026-08-19', plannedEnd: '2026-08-28', actualStart: '2026-08-19', actualEnd: '2026-08-28', acceptedAt: '2026-09-04',
    }, [], '2026-09-10')).toMatchObject({ effectiveEnd: '2026-08-28', finishVariance: 0, delayed: false });
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
    expect(medium.riskLevel).toBe('high');
    expect(medium.riskReason).toContain('进度Gap 50%');
    const closed = deriveRequirementMetrics({ status: 'in_progress', priority: 'P0', acceptedAt: '2026-09-04' }, [
      { status: 'completed', plannedStart: '2026-09-01', plannedEnd: '2026-09-01', actualStart: '2026-09-01', actualEnd: '2026-09-04' },
    ], '2026-09-04');
    expect(closed).toMatchObject({ status: 'completed', riskEvaluated: false, riskLevel: 'low', highRisk: false, delayed: true });
  });
});
