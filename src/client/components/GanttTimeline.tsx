import { type CSSProperties, type HTMLAttributes } from "react";
import { eachDayOfInterval, format, isValid, parseISO, startOfDay } from "date-fns";
import { addBusinessDays, ganttProgressDisplay, isOverdueByWorkday, todayIso } from "../../shared/domain";
import { isBusinessDay } from "../../shared/workday";
import { ganttWeekOffsets } from "../gantt-calendar";

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
  const today = toGanttDate(todayIso()) || startOfDay(new Date());
  const earliest = parsed.length ? new Date(Math.min(...parsed.map((date) => date.getTime()))) : today;
  const latest = parsed.length ? new Date(Math.max(...parsed.map((date) => date.getTime()))) : today;
  const start = toGanttDate(addBusinessDays(format(earliest, "yyyy-MM-dd"), -option.padding))!;
  let end = toGanttDate(addBusinessDays(format(latest, "yyyy-MM-dd"), option.padding))!;
  let dates = eachDayOfInterval({ start, end }).filter((date) => isBusinessDay(format(date, "yyyy-MM-dd")));
  if (dates.length < option.minimumDays) {
    end = toGanttDate(addBusinessDays(format(start, "yyyy-MM-dd"), option.minimumDays - 1))!;
    dates = eachDayOfInterval({ start, end }).filter((date) => isBusinessDay(format(date, "yyyy-MM-dd")));
  }
  return {
    start,
    end,
    dates,
    days: dates.length,
  };
}

export function ganttTrackStyle(dates: Date[], cellWidth: number): CSSProperties {
  const mondayOffsets = ganttWeekOffsets(dates, cellWidth);
  const weekBackgrounds = mondayOffsets.map(() => "linear-gradient(var(--gantt-week-line), var(--gantt-week-line))");
  return {
    width: dates.length * cellWidth,
    "--gantt-cell": `${cellWidth}px`,
    "--gantt-week-line": "rgba(148, 163, 184, .7)",
    "--gantt-day-line": "#edf1f5",
    backgroundImage: [...weekBackgrounds, `repeating-linear-gradient(to right,var(--gantt-day-line) 0,var(--gantt-day-line) 1px,transparent 1px,transparent ${cellWidth}px)`].join(","),
    backgroundPosition: [...mondayOffsets.map((offset) => `${offset}px 0`), "0 0"].join(","),
    backgroundSize: [...mondayOffsets.map(() => "1px 100%"), "auto"].join(","),
    backgroundRepeat: [...mondayOffsets.map(() => "no-repeat"), "repeat"].join(","),
  } as CSSProperties;
}

export function ganttTodayPosition(dates: Date[], asOfDate = todayIso()) {
  const today = toGanttDate(asOfDate) || toGanttDate(todayIso())!;
  const offset = businessDateIndex(today, dates, "end");
  const nextOffset = businessDateIndex(today, dates, "start");
  const visible = offset >= 0 && nextOffset < dates.length;
  return { offset, visible, asOfDate: format(today, "yyyy-MM-dd") };
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
      data-date={format(date, "yyyy-MM-dd")}
      style={{ left: index * cellWidth, width: cellWidth }}
      key={`tick-${date.toISOString()}`}
    >{zoom !== "month" && <span>{zoom === "day" ? `周${weekdayLabels[date.getDay()]}` : format(date, "dd")}</span>}</i>)}
    {todayVisible && <i className="gantt-today-line" style={{ left: (todayOffset + 1) * cellWidth }} />}
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
  const earlyLeft = plan && actual && status === "completed" ? actual.right : 0;
  const earlyWidth = plan && actual && status === "completed" ? Math.max(0, plan.right - actual.right) : 0;
  const statusClass = status.replaceAll("_", "-");
  const markerLeft = actual?.right ?? plan?.left;
  const interactionLeft = Math.min(plan?.left ?? Number.POSITIVE_INFINITY, actual?.left ?? Number.POSITIVE_INFINITY);
  const interactionRight = Math.max(plan?.right ?? Number.NEGATIVE_INFINITY, actual?.right ?? Number.NEGATIVE_INFINITY);
  if (!plan && !actual && showUnscheduled) return <span className="gantt-unscheduled">待排期</span>;
  return <>
    {plan && <span className="unified-gantt-plan" style={{ left: plan.left, width: plan.width }} />}
    {actual && <span className={`unified-gantt-actual gantt-status-${statusClass}`} style={{ left: actual.left, width: actual.width }} />}
    {earlyWidth > 0 && <span className="unified-gantt-early" style={{ left: earlyLeft, width: earlyWidth }} />}
    {delayWidth > 0 && <span className={`unified-gantt-delay gantt-status-${statusClass}`} style={{ left: delayLeft, width: delayWidth }} />}
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
  supplementalLabel,
  tooltipSide = "right",
}: {
  left: number;
  status: string;
  progress: number;
  onClick?: () => void;
  ariaLabel?: string;
  supplementalLabel?: string;
  tooltipSide?: "left" | "right";
}) {
  const value = normalizedProgress(status, progress);
  const display = String(ganttProgressDisplay(status, progress));
  const label = ariaLabel || `${progressStatusLabels[status] || status}，实际进度${value}%`;
  const className = `gantt-progress-marker gantt-status-${status.replaceAll("_", "-")}${onClick ? " is-clickable" : ""}${supplementalLabel ? ` has-tooltip tooltip-${tooltipSide}` : ""}`;
  const content = <><span aria-hidden="true">{display}</span>{status === "blocked" && <em aria-hidden="true" />}{supplementalLabel && <small className="gantt-progress-marker-tooltip" aria-hidden="true">{supplementalLabel}</small>}</>;
  return onClick
    ? <button type="button" className={className} style={{ left }} aria-label={label} title={label} onClick={(event) => { event.stopPropagation(); onClick(); }}>{content}</button>
    : <span className={className} style={{ left }} role="img" aria-label={label} title={supplementalLabel ? undefined : label} tabIndex={supplementalLabel ? 0 : undefined}>{content}</span>;
}

export function GanttProgressComparison({
  plannedStart,
  plannedEnd,
  effectiveEnd,
  status,
  progress,
  plannedProgress,
  asOfDate,
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
  asOfDate?: string;
  dates: Date[];
  cellWidth: number;
  interactionProps?: HTMLAttributes<HTMLElement>;
  showUnscheduled?: boolean;
}) {
  const plan = ganttInterval(plannedStart, plannedEnd, dates, cellWidth);
  if (!plan) return showUnscheduled ? <span className="gantt-unscheduled">待排期</span> : null;
  const actualValue = normalizedProgress(status, progress);
  const expectedValue = Math.min(100, Math.max(0, Math.round(plannedProgress || 0)));
  const asOf = ganttTodayPosition(dates, asOfDate);
  const expectedPoint = Math.min(plan.right, Math.max(plan.left, (asOf.offset + 1) * cellWidth));
  const isTerminal = status === "completed" || status === "pending_acceptance" || status === "cancelled";
  const actualPoint = isTerminal
    ? plan.left + plan.width * actualValue / 100
    : actualValue <= expectedValue
      ? expectedValue > 0
        ? plan.left + (expectedPoint - plan.left) * actualValue / expectedValue
        : plan.left
      : expectedPoint + (plan.right - expectedPoint) * (actualValue - expectedValue) / Math.max(1, 100 - expectedValue);
  const behind = !isTerminal && actualValue < expectedValue;
  const ahead = !isTerminal && actualValue > expectedValue;
  const extended = ganttInterval(plannedStart, effectiveEnd, dates, cellWidth);
  const delayWidth = extended ? Math.max(0, extended.right - plan.right) : 0;
  const behindWidth = Math.max(0, expectedPoint - actualPoint);
  const aheadWidth = Math.max(0, actualPoint - expectedPoint);
  const variance = actualValue - expectedValue;
  const comparisonLabel = isTerminal || variance === 0
    ? undefined
    : `${variance < 0 ? "落后" : "领先"} ${Math.abs(variance)}% · 应达 ${expectedValue}%`;
  const tooltipSide = actualPoint > dates.length * cellWidth - 150 ? "left" : "right";
  const statusClass = status.replaceAll("_", "-");
  return <>
    <span className="unified-gantt-plan" style={{ left: plan.left, width: plan.width }} />
    {actualValue > 0 && <span className={`unified-gantt-progress-actual gantt-status-${statusClass}`} style={{ left: plan.left, width: actualPoint - plan.left }} />}
    {behind && <span className="unified-gantt-progress-gap is-behind" style={{ left: actualPoint, width: behindWidth }} />}
    {ahead && <span className="unified-gantt-progress-gap is-ahead" style={{ left: expectedPoint, width: aheadWidth }} />}
    {delayWidth > 0 && <span className={`unified-gantt-delay gantt-status-${statusClass}`} style={{ left: plan.right, width: delayWidth }} />}
    <span className="unified-gantt-plan-end" style={{ left: plan.right }} />
    {interactionProps && <span
      className="gantt-bar-hitbox"
      style={{ left: plan.left, width: Math.max(28, plan.width + delayWidth) }}
      tabIndex={0}
      aria-label="查看需求进度详情"
      {...interactionProps}
    />}
    <GanttProgressMarker
      left={actualPoint}
      status={status}
      progress={actualValue}
      ariaLabel={`${progressStatusLabels[status] || status}，实际进度${actualValue}%，截至${asOf.asOfDate}应达${expectedValue}%`}
      supplementalLabel={comparisonLabel}
      tooltipSide={tooltipSide}
    />
  </>;
}

export type GanttMilestonePlacement = {
  id: string;
  left: number;
  labelLeft: number;
  labelWidth: number;
  lane: 0 | 1;
  showLabel: boolean;
};

type GanttMilestoneInput = { id: string; label?: string | null; plannedEnd?: string | null };

function milestoneLabelWidth(label: string, zoom: GanttZoom) {
  const estimated = Array.from(label).reduce((width, character) => width + (/[^\u0000-\u00ff]/.test(character) ? 11 : 7), 12);
  const maximum = zoom === "day" ? 128 : zoom === "week" ? 106 : 88;
  return Math.min(maximum, Math.max(42, estimated));
}

export function layoutGanttMilestones(
  items: GanttMilestoneInput[],
  dates: Date[],
  cellWidth: number,
  zoom: GanttZoom = "day",
) {
  const totalWidth = dates.length * cellWidth;
  const padding = 4;
  const gap = 5;
  const occupied: Array<Array<{ start: number; end: number }>> = [[], []];
  return items
    .map((item) => {
      const plannedDate = toGanttDate(item.plannedEnd);
      const label = item.label?.trim();
      if (!plannedDate || !label) return null;
      const endIndex = businessDateIndex(plannedDate, dates, "end");
      if (endIndex < 0 || endIndex >= dates.length) return null;
      return { item, label, left: (endIndex + 1) * cellWidth, labelWidth: milestoneLabelWidth(label, zoom) };
    })
    .filter(Boolean)
    .sort((left, right) => left!.left - right!.left)
    .map((entry) => {
      const { item, left, labelWidth } = entry!;
      const rightCandidate = Math.min(totalWidth - padding - labelWidth, Math.max(padding, left + 7));
      const leftCandidate = Math.min(totalWidth - padding - labelWidth, Math.max(padding, left - 7 - labelWidth));
      const candidates = left > totalWidth / 2 ? [leftCandidate, rightCandidate] : [rightCandidate, leftCandidate];
      for (const lane of [0, 1] as const) {
        const labelLeft = candidates.find((candidate) => !occupied[lane].some((range) => candidate < range.end + gap && candidate + labelWidth > range.start - gap));
        if (labelLeft !== undefined) {
          occupied[lane].push({ start: labelLeft, end: labelLeft + labelWidth });
          return { id: item.id, left, labelLeft, labelWidth, lane, showLabel: true } satisfies GanttMilestonePlacement;
        }
      }
      return { id: item.id, left, labelLeft: rightCandidate, labelWidth, lane: 0, showLabel: false } satisfies GanttMilestonePlacement;
    });
}

export function GanttMilestoneMarker({
  label,
  plannedEnd,
  actualEnd,
  status,
  dates,
  cellWidth,
  zoom = "day",
  placement,
  asOfDate = todayIso(),
}: {
  label?: string | null;
  plannedEnd?: string | null;
  actualEnd?: string | null;
  status: string;
  dates: Date[];
  cellWidth: number;
  zoom?: GanttZoom;
  placement?: GanttMilestonePlacement;
  asOfDate?: string;
}) {
  const milestone = label?.trim();
  const plannedDate = toGanttDate(plannedEnd);
  if (!milestone || !plannedDate) return null;
  const endIndex = businessDateIndex(plannedDate, dates, "end");
  if (endIndex < 0 || endIndex >= dates.length) return null;
  const reached = status === "completed" || Boolean(actualEnd);
  const state = status === "cancelled" ? "cancelled" : reached ? "reached" : isOverdueByWorkday(plannedEnd, asOfDate) ? "overdue" : "planned";
  const stateLabel = state === "cancelled" ? "已取消" : state === "reached" ? "已达成" : state === "overdue" ? "已逾期" : "计划中";
  const fallbackPlacement = layoutGanttMilestones([{ id: "milestone", label: milestone, plannedEnd }], dates, cellWidth, zoom)[0];
  const resolvedPlacement = placement || fallbackPlacement;
  if (!resolvedPlacement) return null;
  const { left, labelLeft, labelWidth, lane, showLabel } = resolvedPlacement;
  return <span
    className={`gantt-milestone-marker milestone-${state} milestone-lane-${lane}`}
    style={{ left }}
    title={`${milestone} · ${stateLabel} · 计划 ${plannedEnd}${actualEnd ? ` · 实际 ${actualEnd}` : ""}`}
    tabIndex={0}
    aria-label={`${milestone}，${stateLabel}，计划${plannedEnd}`}
  ><i />{showLabel && <b style={{ left: labelLeft - left, width: labelWidth }}>{milestone}</b>}</span>;
}
