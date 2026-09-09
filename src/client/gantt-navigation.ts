import { eachDayOfInterval, format } from 'date-fns';
import { addBusinessDays } from '../shared/domain';
import { isBusinessDay } from '../shared/workday';
import { businessDateIndex, toGanttDate } from './gantt-geometry';

export type GanttAnchor = { date: string; fraction: number };
export type GanttBounds = { start: string; end: string };
export function ganttDates(bounds: GanttBounds) {
  return eachDayOfInterval({ start: toGanttDate(bounds.start)!, end: toGanttDate(bounds.end)! })
    .filter(date => isBusinessDay(format(date, 'yyyy-MM-dd')));
}
export function ganttAnchorAt(dates: Date[], pixel: number, cellWidth: number): GanttAnchor {
  const position = Math.max(0, Math.min(dates.length - .001, pixel / cellWidth));
  const index = Math.floor(position);
  return { date: format(dates[index], 'yyyy-MM-dd'), fraction: position - index };
}
export function ganttAnchorPixel(dates: Date[], anchor: GanttAnchor, cellWidth: number) {
  return (businessDateIndex(toGanttDate(anchor.date)!, dates, 'start') + anchor.fraction) * cellWidth;
}
/** Extra dates are view space. Prepending them must be accompanied by anchor compensation. */
export function surroundGanttAnchor(bounds: GanttBounds, anchor: GanttAnchor, screenDays: number): GanttBounds {
  const padding = Math.max(22, Math.ceil(screenDays * 1.5));
  const start = addBusinessDays(anchor.date, -padding), end = addBusinessDays(anchor.date, padding);
  return { start: start < bounds.start ? start : bounds.start, end: end > bounds.end ? end : bounds.end };
}
