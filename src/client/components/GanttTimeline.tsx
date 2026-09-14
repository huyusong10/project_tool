import { memo, type HTMLAttributes } from "react";
import { format } from "date-fns";
import { ganttProgressDisplay } from "../../shared/domain";
import { ganttInterval, ganttTrackStyle, type GanttZoom } from "../gantt-geometry";
import type { GanttForecast } from '../gantt-forecast';
import { GanttForecastTail } from './GanttForecastTail';
export { buildBusinessDayTimeline, businessDateIndex, ganttInterval, ganttTodayPosition, ganttTrackStyle, ganttZoomOptions, toGanttDate, type GanttZoom } from "../gantt-geometry";
const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];

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

export const GanttScale = memo(function GanttScale({
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
});

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
  showUnscheduled = false, stageLabel, stageTone,
  forecast,
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
  showUnscheduled?: boolean; stageLabel?: string; stageTone?: string;
  forecast?: GanttForecast | null;
}) {
  const plan = ganttInterval(plannedStart, plannedEnd, dates, cellWidth);
  const actual = ganttInterval(actualStart, actualEnd, dates, cellWidth);
  const delayLeft = plan && actual ? Math.max(actual.left, plan.right) : 0;
  const delayWidth = plan && actual ? Math.max(0, actual.right - delayLeft) : 0;
  const earlyLeft = plan && actual && status === "completed" ? actual.right : 0;
  const earlyWidth = plan && actual && status === "completed" ? Math.max(0, plan.right - actual.right) : 0;
  const statusClass = status.replaceAll("_", "-");
  const markerLeft = actual?.right;
  const interactionLeft = Math.min(plan?.left ?? Number.POSITIVE_INFINITY, actual?.left ?? Number.POSITIVE_INFINITY);
  const interactionRight = Math.max(plan?.right ?? Number.NEGATIVE_INFINITY, actual?.right ?? Number.NEGATIVE_INFINITY);
  return <>
    {!plan && !actual && showUnscheduled && <span className="gantt-unscheduled">待排期</span>}
    {plan && <span className="unified-gantt-plan" style={{ left: plan.left, width: plan.width }} />}
    {actual && <span className={`unified-gantt-actual ${stageTone ? "gantt-stage stage-" + stageTone : ""} gantt-status-${statusClass}`} style={{ left: actual.left, width: actual.width }} data-start={actualStart} data-end={actualEnd} />}
    {earlyWidth > 0 && <span className="unified-gantt-early" style={{ left: earlyLeft, width: earlyWidth }} />}
    {delayWidth > 0 && <span className={`unified-gantt-delay gantt-status-${statusClass}`} style={{ left: delayLeft, width: delayWidth }} />}
    {plan && <span className="unified-gantt-plan-end" style={{ left: plan.right }} />}
    {interactionProps && Number.isFinite(interactionLeft) && Number.isFinite(interactionRight) && <span
      className="gantt-bar-hitbox"
      style={{ left: interactionLeft, width: Math.max(28, interactionRight - interactionLeft) }}
      tabIndex={0}
      aria-label="查看排期详情"
      {...interactionProps}
    />}
    {markerLeft !== undefined && (stageLabel ? <span className={"gantt-date-progress stage-badge stage-" + stageTone} style={{left:markerLeft}}>{stageLabel}</span> : <GanttProgressMarker
      left={markerLeft}
      status={status}
      progress={progress}
      onClick={onProgressClick}
      ariaLabel={progressAriaLabel}
    />)}
    <GanttForecastTail forecast={forecast} plannedEnd={plan ? plannedEnd : null} dates={dates} cellWidth={cellWidth} interactionProps={interactionProps} />
  </>;
}

function normalizedProgress(status: string, progress: number) {
  const display = ganttProgressDisplay(status, progress);
  return display === "—" ? Math.min(100, Math.max(0, Math.round(progress || 0))) : display;
}

const progressStatusLabels: Record<string, string> = {
  not_started: "未开始",
  in_progress: "进行中",
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
