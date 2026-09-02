import { type CSSProperties, type ReactNode } from "react";
import { addBusinessDays, eachDayOfInterval, format, isValid, isWeekend, parseISO, startOfDay } from "date-fns";

export type GanttZoom = "day" | "week" | "month";

export const ganttZoomOptions: Record<GanttZoom, { label: string; cellWidth: number; padding: number; minimumDays: number }> = {
  day: { label: "日", cellWidth: 40, padding: 3, minimumDays: 21 },
  week: { label: "周", cellWidth: 15, padding: 7, minimumDays: 56 },
  month: { label: "月", cellWidth: 6, padding: 15, minimumDays: 180 },
};

const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];

export function toGanttDate(value?: string | null) {
  if (!value) return null;
  const parsed = parseISO(value);
  return isValid(parsed) ? startOfDay(parsed) : null;
}

export function businessDateIndex(date: Date, dates: Date[], edge: "start" | "end") {
  const timestamp = startOfDay(date).getTime();
  if (edge === "start") {
    const index = dates.findIndex((candidate) => candidate.getTime() >= timestamp);
    return index < 0 ? dates.length : index;
  }
  for (let index = dates.length - 1; index >= 0; index -= 1) {
    if (dates[index].getTime() <= timestamp) return index;
  }
  return -1;
}

export function buildBusinessDayTimeline(values: Array<string | null | undefined>, zoom: GanttZoom) {
  const option = ganttZoomOptions[zoom];
  const parsed = values.map(toGanttDate).filter(Boolean) as Date[];
  const today = startOfDay(new Date());
  const earliest = parsed.length ? new Date(Math.min(...parsed.map((date) => date.getTime()))) : today;
  const latest = parsed.length ? new Date(Math.max(...parsed.map((date) => date.getTime()))) : today;
  const start = startOfDay(addBusinessDays(earliest, -option.padding));
  let end = startOfDay(addBusinessDays(latest, option.padding));
  let dates = eachDayOfInterval({ start, end }).filter((date) => !isWeekend(date));
  if (dates.length < option.minimumDays) {
    end = startOfDay(addBusinessDays(start, option.minimumDays - 1));
    dates = eachDayOfInterval({ start, end }).filter((date) => !isWeekend(date));
  }
  return { start, end, dates, days: dates.length };
}

export function ganttTrackStyle(dates: Date[], cellWidth: number): CSSProperties {
  const firstMonday = dates.findIndex((date) => date.getDay() === 1);
  return {
    width: dates.length * cellWidth,
    "--gantt-cell": `${cellWidth}px`,
    "--gantt-week": `${cellWidth * 5}px`,
    "--gantt-week-offset": `${Math.max(0, firstMonday) * cellWidth}px`,
  } as CSSProperties;
}

export function ganttTodayPosition(dates: Date[]) {
  const today = startOfDay(new Date());
  const offset = businessDateIndex(today, dates, "start");
  const visible = !isWeekend(today) && offset >= 0 && offset < dates.length && dates[offset]?.getTime() === today.getTime();
  return { offset, visible };
}

function markerVisible(dates: Date[], zoom: GanttZoom, index: number) {
  const date = dates[index];
  if (zoom === "day") return true;
  if (zoom === "week") return index === 0 || date.getDay() === 1;
  return index === 0 || dates[index - 1]?.getMonth() !== date.getMonth();
}

function markerWidth(dates: Date[], zoom: GanttZoom, index: number, cellWidth: number) {
  if (zoom === "day") return cellWidth;
  const next = dates.findIndex((_date, candidate) => candidate > index && markerVisible(dates, zoom, candidate));
  return (next < 0 ? dates.length - index : next - index) * cellWidth;
}

export function GanttScale({
  dates,
  zoom,
  cellWidth,
  todayOffset,
  todayVisible,
  className = "",
}: {
  dates: Date[];
  zoom: GanttZoom;
  cellWidth: number;
  todayOffset: number;
  todayVisible: boolean;
  className?: string;
}) {
  const style = ganttTrackStyle(dates, cellWidth);
  return <div className={`gantt-scale unified-gantt-scale ${className}`.trim()} style={style} role="columnheader">
    {dates.map((date, index) => markerVisible(dates, zoom, index) && <span
      className="gantt-scale-label"
      style={{ left: index * cellWidth, width: markerWidth(dates, zoom, index, cellWidth) }}
      key={date.toISOString()}
    >{zoom === "month" ? format(date, "yyyy/MM") : format(date, "MM/dd")}</span>)}
    {dates.map((date, index) => <i
      className={`gantt-scale-tick${date.getDay() === 1 || index === 0 ? " is-major" : ""}`}
      style={{ left: index * cellWidth, width: cellWidth }}
      key={`tick-${date.toISOString()}`}
    >{zoom !== "month" && <span>{zoom === "day" ? `周${weekdayLabels[date.getDay()]}` : format(date, "dd")}</span>}</i>)}
    {todayVisible && <i className="gantt-today-line" style={{ left: todayOffset * cellWidth + cellWidth / 2 }} />}
  </div>;
}

export function GanttPlanActualBars({
  plannedStart,
  plannedEnd,
  actualStart,
  actualEnd,
  status,
  dates,
  cellWidth,
  endpoint,
  label,
  showUnscheduled = false,
}: {
  plannedStart?: string | null;
  plannedEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  status: string;
  dates: Date[];
  cellWidth: number;
  endpoint?: ReactNode;
  label?: string;
  showUnscheduled?: boolean;
}) {
  const interval = (startValue?: string | null, endValue?: string | null) => {
    const start = toGanttDate(startValue);
    const end = toGanttDate(endValue);
    if (!start || !end) return null;
    const startIndex = businessDateIndex(start, dates, "start");
    const endIndex = businessDateIndex(end, dates, "end");
    if (startIndex >= dates.length || endIndex < startIndex) return null;
    const left = startIndex * cellWidth;
    return { left, width: Math.max(cellWidth, (endIndex - startIndex + 1) * cellWidth), right: (endIndex + 1) * cellWidth };
  };
  const plan = interval(plannedStart, plannedEnd);
  const actual = interval(actualStart, actualEnd);
  const delayLeft = plan && actual ? Math.max(actual.left, plan.right) : 0;
  const delayWidth = plan && actual ? Math.max(0, actual.right - delayLeft) : 0;
  const statusClass = status.replaceAll("_", "-");
  const labelRange = actual || plan;
  const trackWidth = dates.length * cellWidth;
  const preferredLabelLeft = actual ? actual.right + 8 : (plan?.left || 0) + 6;
  const labelAlignLeft = Boolean(labelRange && preferredLabelLeft + 170 > trackWidth - 6);
  const labelLeft = labelRange ? (labelAlignLeft ? labelRange.right - 8 : preferredLabelLeft) : 0;
  if (!plan && !actual && showUnscheduled) return <span className="gantt-unscheduled">待排期</span>;
  return <>
    {plan && <span className="unified-gantt-plan" style={{ left: plan.left, width: plan.width }} />}
    {actual && <span className={`unified-gantt-actual gantt-status-${statusClass}`} style={{ left: actual.left, width: actual.width }} />}
    {delayWidth > 0 && <span className="unified-gantt-delay" style={{ left: delayLeft, width: delayWidth }} />}
    {plan && <span className="unified-gantt-plan-end" style={{ left: plan.right }} />}
    {actual && <span className={`unified-gantt-end end-${statusClass}`} style={{ left: actual.right }}>{endpoint}</span>}
    {label && labelRange && <span
      className={`unified-gantt-label gantt-status-${statusClass}${labelAlignLeft ? " align-left" : ""}`}
      style={{ left: labelLeft }}
    >{label}</span>}
  </>;
}

export function GanttMilestoneMarker({
  label,
  plannedEnd,
  actualEnd,
  status,
  dates,
  cellWidth,
}: {
  label?: string | null;
  plannedEnd?: string | null;
  actualEnd?: string | null;
  status: string;
  dates: Date[];
  cellWidth: number;
}) {
  const milestone = label?.trim();
  const plannedDate = toGanttDate(plannedEnd);
  if (!milestone || !plannedDate) return null;
  const endIndex = businessDateIndex(plannedDate, dates, "end");
  if (endIndex < 0 || endIndex >= dates.length) return null;
  const reached = status === "completed" || Boolean(actualEnd);
  const state = status === "cancelled" ? "cancelled" : reached ? "reached" : plannedEnd! < format(new Date(), "yyyy-MM-dd") ? "overdue" : "planned";
  const stateLabel = state === "cancelled" ? "已取消" : state === "reached" ? "已达成" : state === "overdue" ? "已逾期" : "计划中";
  const left = (endIndex + 1) * cellWidth;
  const alignLeft = left > dates.length * cellWidth * .72;
  return <span
    className={`gantt-milestone-marker milestone-${state}${alignLeft ? " align-left" : ""}`}
    style={{ left }}
    title={`${milestone} · ${stateLabel} · 计划 ${plannedEnd}${actualEnd ? ` · 实际 ${actualEnd}` : ""}`}
  ><i /><b>{milestone}</b></span>;
}
