import type { HTMLAttributes } from 'react';
import { delayedForecastEnd, type GanttForecast } from '../gantt-forecast';
import { businessDateIndex, toGanttDate } from '../gantt-geometry';
import './gantt-forecast.css';

export function GanttForecastTail({ forecast, plannedEnd, dates, cellWidth, interactionProps, showLabel=false }: {
  forecast?: GanttForecast | null; plannedEnd?: string | null; dates: Date[]; cellWidth: number;
  interactionProps?: HTMLAttributes<HTMLElement>;
  showLabel?: boolean;
}) {
  const forecastEnd = delayedForecastEnd(forecast, plannedEnd);
  if (!forecast || !forecastEnd || !dates.length) return null;
  const start = toGanttDate(forecast.start);
  if (!start) return null;
  const left = (forecast.started ? businessDateIndex(start, dates, 'end') + 1 : businessDateIndex(start, dates, 'start')) * cellWidth;
  const end = toGanttDate(forecastEnd);
  const right = end ? (businessDateIndex(end, dates, 'end') + 1) * cellWidth : left;
  const total = dates.length * cellWidth;
  const reference = end || start;
  const endVisible = reference >= dates[0] && reference <= dates[dates.length - 1];
  const future = right > left;
  const title = `${forecast.label}；${forecast.details}`;
  // A panned viewport must not pin an offscreen forecast to an unrelated date.
  if (!end || !future || reference < dates[0] || start > dates[dates.length - 1]) return null;
  return <span className="gantt-forecast-tail" data-start={forecast.start} data-end={forecastEnd}
    style={{ left: Math.max(0, left), width: Math.min(total, right) - Math.max(0, left), borderRightStyle: endVisible ? undefined : 'none' }} title={title} aria-label={title} tabIndex={0} {...interactionProps} >{showLabel && endVisible && Math.min(total,right)-Math.max(0,left)>=92 && <span className="gantt-forecast-end-label">预计 {forecastEnd.slice(5)}</span>}</span>;
}
