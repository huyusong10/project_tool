import { type CSSProperties, type HTMLAttributes } from "react";
import { addBusinessDays, eachDayOfInterval, format, isValid, isWeekend, parseISO, startOfDay } from "date-fns";
import { ganttProgressDisplay } from "../../shared/domain";

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
  progress,
  dates,
  cellWidth,
  onProgressClick,
  progressAriaLabel,
  interactionProps,
  showUnscheduled = false,
}: {
  plannedStart?: string | null;
  plannedEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  status: string;
  progress: number;
  dates: Date[];
  cellWidth: number;
  onProgressClick?: () => void;
  progressAriaLabel?: string;
  interactionProps?: HTMLAttributes<HTMLElement>;
  showUnscheduled?: boolean;
}) {
  const plan = ganttInterval(plannedStart, plannedEnd, dates, cellWidth);
  const actual = ganttInterval(actualStart, actualEnd, dates, cellWidth);
  const delayLeft = plan && actual ? Math.max(actual.left, plan.right) : 0;
  const delayWidth = plan && actual ? Math.max(0, actual.right - delayLeft) : 0;
  const statusClass = status.replaceAll("_", "-");
  const markerLeft = actual?.right ?? plan?.left;
  const interactionLeft = Math.min(plan?.left ?? Number.POSITIVE_INFINITY, actual?.left ?? Number.POSITIVE_INFINITY);
  const interactionRight = Math.max(plan?.right ?? Number.NEGATIVE_INFINITY, actual?.right ?? Number.NEGATIVE_INFINITY);
  if (!plan && !actual && showUnscheduled) return <span className="gantt-unscheduled">待排期</span>;
  return <>
    {plan && <span className="unified-gantt-plan" style={{ left: plan.left, width: plan.width }} />}
    {actual && <span className={`unified-gantt-actual gantt-status-${statusClass}`} style={{ left: actual.left, width: actual.width }} />}
    {delayWidth > 0 && <span className="unified-gantt-delay" style={{ left: delayLeft, width: delayWidth }} />}
    {plan && <span className="unified-gantt-plan-end" style={{ left: plan.right }} />}
    {interactionProps && Number.isFinite(interactionLeft) && Number.isFinite(interactionRight) && <span
      className="gantt-bar-hitbox"
      style={{ left: interactionLeft, width: Math.max(28, interactionRight - interactionLeft) }}
      tabIndex={0}
      aria-label="查看工作项排期详情"
      {...interactionProps}
    />}
    {markerLeft !== undefined && <GanttProgressMarker
      left={markerLeft}
      status={status}
      progress={progress}
      onClick={onProgressClick}
      ariaLabel={progressAriaLabel}
    />}
  </>;
}

function ganttInterval(startValue: string | null | undefined, endValue: string | null | undefined, dates: Date[], cellWidth: number) {
  const start = toGanttDate(startValue);
  const end = toGanttDate(endValue);
  if (!start || !end) return null;
  const startIndex = businessDateIndex(start, dates, "start");
  const endIndex = businessDateIndex(end, dates, "end");
  if (startIndex >= dates.length || endIndex < startIndex) return null;
  const left = startIndex * cellWidth;
  return { left, width: Math.max(cellWidth, (endIndex - startIndex + 1) * cellWidth), right: (endIndex + 1) * cellWidth };
}

function normalizedProgress(status: string, progress: number) {
  const display = ganttProgressDisplay(status, progress);
  return display === "—" ? Math.min(100, Math.max(0, Math.round(progress || 0))) : display;
}

const progressStatusLabels: Record<string, string> = {
  planning: "待规划",
  not_started: "未开始",
  in_progress: "进行中",
  blocked: "阻塞",
  completed: "已完成",
  cancelled: "已取消",
};

export function GanttProgressMarker({
  left,
  status,
  progress,
  onClick,
  ariaLabel,
}: {
  left: number;
  status: string;
  progress: number;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const value = normalizedProgress(status, progress);
  const display = String(ganttProgressDisplay(status, progress));
  const label = ariaLabel || `${progressStatusLabels[status] || status}，实际进度${value}%`;
  const className = `gantt-progress-marker gantt-status-${status.replaceAll("_", "-")}${onClick ? " is-clickable" : ""}`;
  const content = <><span aria-hidden="true">{display}</span>{status === "blocked" && <em aria-hidden="true" />}</>;
  return onClick
    ? <button type="button" className={className} style={{ left }} aria-label={label} title={label} onClick={(event) => { event.stopPropagation(); onClick(); }}>{content}</button>
    : <span className={className} style={{ left }} role="img" aria-label={label} title={label}>{content}</span>;
}

export function GanttProgressComparison({
  plannedStart,
  plannedEnd,
  effectiveEnd,
  status,
  progress,
  plannedProgress,
  dates,
  cellWidth,
  interactionProps,
  showUnscheduled = false,
}: {
  plannedStart?: string | null;
  plannedEnd?: string | null;
  effectiveEnd?: string | null;
  status: string;
  progress: number;
  plannedProgress: number;
  dates: Date[];
  cellWidth: number;
  interactionProps?: HTMLAttributes<HTMLElement>;
  showUnscheduled?: boolean;
}) {
  const plan = ganttInterval(plannedStart, plannedEnd, dates, cellWidth);
  if (!plan) return showUnscheduled ? <span className="gantt-unscheduled">待排期</span> : null;
  const actualValue = normalizedProgress(status, progress);
  const expectedValue = Math.min(100, Math.max(0, Math.round(plannedProgress || 0)));
  const actualPoint = plan.left + plan.width * actualValue / 100;
  const expectedPoint = plan.left + plan.width * expectedValue / 100;
  const behind = actualPoint < expectedPoint;
  const ahead = actualPoint > expectedPoint;
  const extended = ganttInterval(plannedStart, effectiveEnd, dates, cellWidth);
  const delayWidth = extended ? Math.max(0, extended.right - plan.right) : 0;
  const behindWidth = Math.max(0, expectedPoint - actualPoint);
  const aheadWidth = Math.max(0, actualPoint - expectedPoint);
  const variance = Math.abs(expectedValue - actualValue);
  const statusClass = status.replaceAll("_", "-");
  return <>
    <span className="unified-gantt-plan" style={{ left: plan.left, width: plan.width }} />
    {actualValue > 0 && <span className={`unified-gantt-progress-actual gantt-status-${statusClass}`} style={{ left: plan.left, width: actualPoint - plan.left }} />}
    {behind && <span className="unified-gantt-progress-gap is-behind" style={{ left: actualPoint, width: behindWidth }}>{behindWidth >= 58 && <b>落后 {variance}%</b>}</span>}
    {ahead && <span className="unified-gantt-progress-gap is-ahead" style={{ left: expectedPoint, width: aheadWidth }}>{aheadWidth >= 58 && <b>领先 {variance}%</b>}</span>}
    {delayWidth > 0 && <span className="unified-gantt-delay" style={{ left: plan.right, width: delayWidth }} />}
    <span className="unified-gantt-progress-target" style={{ left: expectedPoint }} title={`截至今日应达 ${expectedValue}%`} />
    <span className="unified-gantt-plan-end" style={{ left: plan.right }} />
    {interactionProps && <span
      className="gantt-bar-hitbox"
      style={{ left: plan.left, width: Math.max(28, plan.width + delayWidth) }}
      tabIndex={0}
      aria-label="查看需求进度详情"
      {...interactionProps}
    />}
    <GanttProgressMarker left={actualPoint} status={status} progress={actualValue} ariaLabel={`${progressStatusLabels[status] || status}，实际进度${actualValue}%，截至今日应达${expectedValue}%`} />
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
