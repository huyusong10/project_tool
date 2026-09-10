import { describe, expect, it } from 'vitest';
import { analyticsValue } from '../src/client/analytics-presentation';
import { requirementRiskDisplay, requirementVarianceDisplay, requirementVarianceValue } from '../src/client/requirement-presentation';
import { compareRiskRequirements } from '../src/shared/requirement-view';
import type { Requirement } from '../src/client/types';

const base = { status: 'in_progress', title: '需求', riskEvaluated: true, riskLevel: 'low', scheduleComplete: true, plannedStart: '2026-09-01', plannedEnd: '2026-09-10', progress: 20, plannedProgress: 40, finishVariance: 0, scheduleVarianceDays: 2 } as Requirement;

describe('跨页面数据表达', () => {
  it('未排期和无法计算不显示为零偏差', () => {
    const pending = { ...base, status: 'not_started', plannedStart: null, plannedEnd: null, scheduleComplete: false };
    expect(requirementVarianceValue(pending)).toBeNull();
    expect(requirementVarianceDisplay(pending).label).toBe('待排期');
    expect(requirementVarianceDisplay({ ...base, scheduleVarianceDays: null }).label).toBe('待评估');
    expect(requirementVarianceDisplay({ ...base, scheduleVarianceDays: 0 }).label).toBe('按计划');
  });
  it('待验收保留服务端交付风险；只对完成和取消关闭当前风险', () => {
    expect(requirementRiskDisplay({ ...base, status: 'pending_acceptance', riskLevel: 'high' })).toMatchObject({ closed: false, evaluated: true, label: '高风险' });
    expect(requirementRiskDisplay({ ...base, status: 'pending_acceptance', riskEvaluated: false }).label).toBe('待评估');
    expect(requirementRiskDisplay({ ...base, status: 'completed', riskLevel: 'high' }).label).toBe('风险已关闭');
    expect(requirementRiskDisplay({ ...base, status: 'cancelled' }).closed).toBe(true);
  });
  it('风险排序不把待评估当成低风险', () => {
    const values = [{ ...base, title: '低' }, { ...base, title: '待评估', riskEvaluated: false }, { ...base, title: '高', riskLevel: 'high' }];
    expect(values.sort(compareRiskRequirements).map(value => value.title)).toEqual(['高', '待评估', '低']);
  });
  it('零个对象与没有比率样本分别展示，兼容旧响应', () => {
    const row = { key: 'total', label: '总计', value: 0, sampleCount: 0 };
    expect(analyticsValue(row, 'count')).toBe(0);
    expect(analyticsValue(row, 'percent')).toBeNull();
    expect(analyticsValue(row, 'days')).toBeNull();
    expect(analyticsValue({ ...row, sampleCount: 2 }, 'percent')).toBe(0);
    expect(analyticsValue({ ...row, sampleCount: undefined }, 'percent')).toBe(0);
    expect(analyticsValue({ ...row, sampleCount: 2, secondaryValue: 0, secondarySampleCount: 0 }, 'percent', true)).toBeNull();
  });
});
