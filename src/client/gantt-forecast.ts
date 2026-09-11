import { businessDayDelta } from '../shared/domain';
import type { DeliveryForecast } from '../shared/forecast-basis';
import { isValidIsoDate } from '../shared/workday';

export type GanttForecast = {
  asOfDate: string;
  start: string | null;
  started: boolean;
  end: string | null;
  label: string;
  details: string;
};

/** Only a forecast beyond a known deadline extends the visible Gantt range. */
export function delayedForecastEnd(forecast: GanttForecast | null | undefined, plannedEnd?: string | null): string | null {
  return isValidIsoDate(plannedEnd) && forecast?.end && forecast.end > plannedEnd ? forecast.end : null;
}

/** Use the topology's completion event, never turn a completion percentage into a date. */
export function ganttForecast(data: DeliveryForecast | undefined, status: string, asOfDate: string): GanttForecast | null {
  if (['completed', 'cancelled'].includes(status)) return null;
  const reasons = data?.reasons || [];
  const stale = !!data && data.asOfDate !== asOfDate;
  const started = !['not_started', 'planning'].includes(status);
  const start = started ? asOfDate : isValidIsoDate(data?.start) ? data!.start : null;
  const end = !stale && !reasons.length && start && isValidIsoDate(data?.end) && data!.end! >= start && data!.end! >= asOfDate ? data!.end : null;
  const remaining = end ? Math.max(0, businessDayDelta(asOfDate, end)) : null;
  const label = end === asOfDate ? '预计今日完成' : end ? `预计 ${end.slice(5).replace('-', '/')} · 还需 ${remaining} 工作日` : '预测待更新';
  const details = stale ? '预测数据日期与当前统计日不一致，请刷新。' : reasons.length ? reasons.join('；') : !end ? '预测缺失或已过期，请更新剩余工作的预计完成日期。'
    : `${data?.source || '按剩余工作和前置关系计算'}${data?.remainingDays ? `；剩余工期 ${data.remainingDays} 工作日` : ''}；距交付的工作日数含前置等待，不代表剩余人天。`;
  return { asOfDate, start, started, end, label, details };
}
