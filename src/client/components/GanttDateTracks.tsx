import { memo, type HTMLAttributes } from "react";
import { ganttProgressDisplay } from "../../shared/domain";
import { businessDateIndex, ganttInterval, toGanttDate } from "./GanttTimeline";
import type { GanttForecast } from '../gantt-forecast';
import { GanttForecastTail } from './GanttForecastTail';

function point(value: string | null | undefined, dates: Date[], cellWidth: number) {
  const date = toGanttDate(value);
  if (!date) return null;
  const index = businessDateIndex(date, dates, "start");
  if (index < 0 || index >= dates.length) return null;
  return { left: index * cellWidth, right: index * cellWidth, width: 0 };
}

export const GanttDateTracks = memo(function GanttDateTracks({
  plannedStart, plannedEnd, actualStart, actualEnd, status, progress, dates, cellWidth,
  onProgressClick, progressAriaLabel, interactionProps, scheduleComplete = true,
  forecast, stageLabel, showProgress=true,
}: {
  plannedStart?: string | null; plannedEnd?: string | null;
  actualStart?: string | null; actualEnd?: string | null;
  status: string; progress: number; dates: Date[]; cellWidth: number;
  onProgressClick?: () => void; progressAriaLabel?: string;
  interactionProps?: HTMLAttributes<HTMLElement>;
  scheduleComplete?: boolean;
  forecast?: GanttForecast | null; stageLabel?: string; showProgress?:boolean;
}) {
  const plan = ganttInterval(plannedStart, plannedEnd, dates, cellWidth) || point(plannedStart || plannedEnd, dates, cellWidth);
  const actual = ganttInterval(actualStart, actualEnd, dates, cellWidth) || point(actualStart || actualEnd, dates, cellWidth);
  const value = ganttProgressDisplay(status, progress);
  const terminal = ["completed", "pending_acceptance", "cancelled"].includes(status);
  const label = stageLabel || (status === "cancelled" ? "已取消" : !actualStart && ["not_started", "planning"].includes(status) ? "未开始" : `完成 ${value}%`);
  const lateLeft = scheduleComplete && actual && plan && plannedEnd && actualEnd && actualEnd > plannedEnd ? Math.max(actual.left, plan.right) : null;
  const total = dates.length * cellWidth;
  const endpoint = actual?.right ?? plan?.left ?? 0;
  const labelWidth = Math.min(160,Math.max(72,Array.from(label).reduce((size,char)=>size+(/[\u4e00-\u9fff]/.test(char)?12:7),12)));
  const labelLeft = Math.max(4, Math.min(total - labelWidth - 4, endpoint + 8));
  const title = `${label}；计划 ${plannedStart || "缺少开始日期"} 至 ${plannedEnd || "缺少结束日期"}；实际 ${actualStart || (["not_started", "planning"].includes(status) ? "未开始" : "缺少开始日期")} 至 ${actualEnd || "结束日期缺失"}${!terminal && actualEnd ? "（截至统计日）" : ""}`;
  const left = Math.min(plan?.left ?? total, actual?.left ?? total);
  const right = Math.max(plan?.right ?? 0, actual?.right ?? 0);
  return <>
    {plan && <span className={`gantt-date-plan${plan.width === 0 ? " is-date-point" : ""}${!scheduleComplete ? " is-partial-plan" : ""}`} style={{ left: plan.left, width: plan.width }} data-start={plannedStart} data-end={plannedEnd} />}
    {actual && <span className={`gantt-date-actual gantt-status-${status.replaceAll("_", "-")}${actual.width === 0 ? " is-date-point" : ""}${!terminal ? " is-ongoing" : ""}`} style={{ left: actual.left, width: actual.width }} data-start={actualStart} data-end={actualEnd} />}
    {actual && lateLeft !== null && <span className="gantt-date-delay" style={{ left: lateLeft, width: Math.max(3, actual.right - lateLeft) }} />}
    {plan && scheduleComplete && <span className="gantt-date-deadline" style={{ left: plan.right }} />}
    {(!plan || !scheduleComplete || !plannedStart || !plannedEnd) && <span className="gantt-date-unplanned">{plan ? "排期不完整" : "待排期"}</span>}
    {interactionProps && (plan || actual) && <span className="gantt-date-hitbox" style={{ left: Math.max(0, left - 4), width: Math.max(28, right - left + 8) }} tabIndex={0} aria-label={title} {...interactionProps} />}
    {showProgress&&(!actualStart||actual)&&(onProgressClick
      ? <button type="button" className={`gantt-date-progress gantt-status-${status.replaceAll("_", "-")}`} style={{ left: labelLeft,maxWidth:labelWidth }} title={title} aria-label={progressAriaLabel || title} onClick={(event) => { event.stopPropagation(); onProgressClick(); }}>{label}</button>
      : <span className={`gantt-date-progress gantt-status-${status.replaceAll("_", "-")}`} style={{ left: labelLeft,maxWidth:labelWidth }} tabIndex={0} title={title} aria-label={title}>{label}</span>)}
    <GanttForecastTail forecast={forecast} plannedEnd={scheduleComplete && plan ? plannedEnd : null} dates={dates} cellWidth={cellWidth} interactionProps={interactionProps} />
  </>;
});
