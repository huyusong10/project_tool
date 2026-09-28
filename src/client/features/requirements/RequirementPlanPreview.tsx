import { useMemo } from 'react';
import { plannedDatesFromOffset, plannedStartFromDeadline } from '../../../shared/domain';
import { hasWorkdayCalendarFallback, isBusinessDay, isValidIsoDate } from '../../../shared/workday';
import type { FeaturePhase } from '../../../shared/feature-phases';
import type { WorkItemTemplate } from '../../types';
import { useResourceQuery } from '../../use-resource-query';
import * as planningApi from '../planning/api';

export function RequirementPlanPreview({ projectId, featureId, phaseId, template, date, mode, replacingWorkItems }: {
  projectId: string; featureId: string; phaseId: string;
  template?: WorkItemTemplate; date: string; mode: 'start' | 'deadline';
  replacingWorkItems?: number;
}) {
  const phases = useResourceQuery<FeaturePhase[]>(['feature-phases', projectId, featureId],
    signal => planningApi.projectsFeaturePhasesQuery<FeaturePhase[]>(projectId, featureId, { signal }),
    Boolean(featureId && phaseId));
  const preview = useMemo(() => {
    if (!template || !isValidIsoDate(date)) return null;
    if (!isBusinessDay(date)) return { error: `${mode === 'start' ? '计划开始' : '截止日期'}需为工作日。` };
    const items = template.items.filter(item => !item.deletedAt && item.kind !== 'milestone');
    if (!items.length) return null;
    try {
      const baseStart = mode === 'start' ? date : plannedStartFromDeadline(date, items);
      const dates = items.map(item => ({ id: item.id, title: item.title, ...plannedDatesFromOffset(baseStart, item.startOffsetDays, item.durationDays) }));
      const start = dates.map(item => item.plannedStart).sort()[0];
      const end = dates.map(item => item.plannedEnd).sort().at(-1)!;
      return { start, end, count: items.length, items: dates };
    } catch (error) {
      return { error: error instanceof Error ? error.message : '暂时无法计算排期，请检查日期。' };
    }
  }, [template, date, mode]);
  if (!preview) return null;
  if ('error' in preview) return <p className="field-full form-error" role="alert">{preview.error}</p>;
  const targetDate = phases.data?.find(phase => phase.id === phaseId)?.targetDate;
  return <section className="field-full schedule-change-preview" aria-label="排期预览" aria-live="polite">
    <p className="field-help">计划：<strong>{preview.start} ～ {preview.end}</strong> · {preview.count} 个工作项</p>
    {replacingWorkItems !== undefined && <>
      <p className="field-help">替换 {replacingWorkItems} 个原工作项，生成以下工作；人员需重新分派。</p>
      <div className="schedule-change-items">
        <table aria-label="新流程工作项计划">
          <thead><tr><th scope="col">工作项</th><th scope="col">计划日期</th></tr></thead>
          <tbody>{preview.items.map(item => <tr key={item.id}><td>{item.title}</td><td>{item.plannedStart} ～ {item.plannedEnd}</td></tr>)}</tbody>
        </table>
      </div>
    </>}
    {targetDate && <p className={preview.end > targetDate ? 'warning-banner' : 'field-help'}>
      {preview.end > targetDate ? `计划完成晚于 Phase 目标 ${targetDate}，可调整开始日期或改为按截止日期倒排。` : `Phase 目标：${targetDate}`}
    </p>}
    {!hasWorkdayCalendarFallback([date]) && hasWorkdayCalendarFallback([preview.start, preview.end]) &&
      <p className="field-help">部分排期超出当前法定工作日日历覆盖范围，将按周一至周五计算。</p>}
    {replacingWorkItems === undefined && <p className="field-help">按当前流程预览，工作负责人可在创建后分派。</p>}
  </section>;
}
