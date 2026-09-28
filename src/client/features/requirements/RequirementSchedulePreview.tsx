import { useMemo } from 'react';
import { deriveRequirementScheduleRange, rebaseBusinessDate, rescheduleDirectDates } from '../../../shared/domain';
import { hasWorkdayCalendarFallback, isBusinessDay, isValidIsoDate } from '../../../shared/workday';
import type { Requirement } from '../../types';
import { workItemStatusOptions } from '../../ui-options';

export function RequirementSchedulePreview({ requirement, date, mode }: {
  requirement: Requirement; date: string; mode: 'start' | 'deadline';
}) {
  const preview = useMemo(() => {
    if (!isValidIsoDate(date)) return null;
    const label = mode === 'start' ? '计划开始' : '计划完成';
    if (!isBusinessDay(date)) return { error: `${label}需为工作日。` };
    const anchor = mode === 'start' ? requirement.plannedStart : requirement.plannedEnd;
    if (!anchor) return { error: `当前需求缺少${label}，请先补齐工作项计划。` };
    try {
      const shift = (value: string | null) => value && date !== anchor ? rebaseBusinessDate(value, anchor, date) : value;
      const items = requirement.workItems.filter(item => item.status !== 'cancelled').map(item => ({
        ...item, beforeStart: item.plannedStart, beforeEnd: item.plannedEnd,
        plannedStart: shift(item.plannedStart), plannedEnd: shift(item.plannedEnd),
      }));
      return { items, ...deriveRequirementScheduleRange({}, items) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : '暂时无法计算排期，请检查日期。' };
    }
  }, [requirement, date, mode]);
  if (!preview) return null;
  return <section className="field-full schedule-change-preview" aria-label="计划调整预览" aria-live="polite">
    {'error' in preview ? <p className="form-error" role="alert">{preview.error}</p> : <>
      <p className="field-help">调整后计划：<strong>{preview.plannedStart || '未填写'} ～ {preview.plannedEnd || '未填写'}</strong> · {preview.items.length} 个工作项</p>
      <div className="schedule-change-items">
        <table aria-label="工作项日期对照">
          <thead><tr><th scope="col">工作项</th><th scope="col">当前计划</th><th scope="col">调整后</th></tr></thead>
          <tbody>{preview.items.map(item => <tr key={item.id}>
            <td><strong>{item.title}</strong><span>{workItemStatusOptions.find(option => option.value === item.status)?.label || item.status}</span></td>
            <td>{item.beforeStart || '未填写'} ～ {item.beforeEnd || '未填写'}</td>
            <td>{item.plannedStart || '未填写'} ～ {item.plannedEnd || '未填写'}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {preview.items.some(item => item.status === 'completed') && <p className="field-help">已完成工作的计划也会调整，实际日期和完成度保持不变。</p>}
      {requirement.workItems.length > preview.items.length && <p className="field-help">{requirement.workItems.length - preview.items.length} 项已取消工作保持原计划。</p>}
      {!preview.scheduleComplete && <p className="field-help">部分工作项缺少日期，整体平移不会补齐这些日期。</p>}
      {hasWorkdayCalendarFallback([date, preview.plannedStart, preview.plannedEnd]) && <p className="field-help">部分排期超出当前法定工作日日历覆盖范围，将按周一至周五计算。</p>}
    </>}
  </section>;
}

export function DirectRequirementSchedulePreview({ requirement, date, mode }: { requirement: Requirement; date: string; mode: 'start' | 'deadline' }) {
  if (!isValidIsoDate(date)) return null;
  let dates: ReturnType<typeof rescheduleDirectDates>;
  try { dates = rescheduleDirectDates(requirement, mode === 'start' ? { plannedStart: date } : { plannedEnd: date }); }
  catch (error) { return <p className="form-error field-full" role="alert">{(error as Error).message}</p>; }
  return <section className="field-full schedule-change-preview" aria-label="计划调整预览" aria-live="polite">
    <p className="field-help">调整后计划：<strong>{dates.plannedStart || '未填写'} ～ {dates.plannedEnd || '未填写'}</strong></p>
    <p className="field-help">实际日期和已记录进度保持不变。</p>
    {hasWorkdayCalendarFallback([dates.plannedStart, dates.plannedEnd]) && <p className="field-help">部分排期超出当前法定工作日日历覆盖范围，将按周一至周五计算。</p>}
  </section>;
}
