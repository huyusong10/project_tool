import type { CSSProperties } from "react";
import { eachDayOfInterval, format, isValid, parseISO, startOfDay } from "date-fns";
import { addBusinessDays, todayIso } from "../shared/domain";
import { isBusinessDay, isValidIsoDate } from "../shared/workday";
import { ganttWeekOffsets } from "./gantt-calendar";

export type GanttZoom = "day" | "week" | "month";

export const ganttZoomOptions: Record<GanttZoom, { label: string; cellWidth: number; padding: number; minimumDays: number }> = {
  day: { label: "日", cellWidth: 40, padding: 3, minimumDays: 21 },
  week: { label: "周", cellWidth: 15, padding: 7, minimumDays: 56 },
  month: { label: "月", cellWidth: 6, padding: 15, minimumDays: 180 },
};

export function toGanttDate(value?: string | null) {
  if (!isValidIsoDate(value)) return null;
  const parsed = parseISO(value);
  return isValid(parsed) ? startOfDay(parsed) : null;
}

const dateIndexes = new WeakMap<Date[], number[]>();
export function businessDateIndex(date: Date, dates: Date[], edge: "start" | "end") {
  let timestamps = dateIndexes.get(dates);
  if (!timestamps) { timestamps = dates.map((candidate) => candidate.getTime()); dateIndexes.set(dates, timestamps); }
  const target = startOfDay(date).getTime();
  let left = 0, right = timestamps.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (timestamps[middle] < target || (edge === "end" && timestamps[middle] === target)) left = middle + 1;
    else right = middle;
  }
  return edge === "start" ? left : left - 1;
}

export function buildBusinessDayTimeline(values: Array<string | null | undefined>, zoom: GanttZoom, asOfDate = todayIso(), throughDate?:string|null) {
  const option = ganttZoomOptions[zoom];
  const parsed = values.map(toGanttDate).filter(Boolean) as Date[];
  const today = toGanttDate(asOfDate) || toGanttDate(todayIso()) || startOfDay(new Date());
  const earliest = parsed.length ? new Date(Math.min(...parsed.map((date) => date.getTime()))) : today;
  const latest = parsed.length ? new Date(Math.max(...parsed.map((date) => date.getTime()))) : today;
  const start = toGanttDate(addBusinessDays(format(earliest, "yyyy-MM-dd"), -option.padding))!;
  let end = toGanttDate(addBusinessDays(format(latest, "yyyy-MM-dd"), option.padding))!;
  let dates = eachDayOfInterval({ start, end }).filter((date) => isBusinessDay(format(date, "yyyy-MM-dd")));
  if (dates.length < option.minimumDays) {
    end = toGanttDate(addBusinessDays(format(start, "yyyy-MM-dd"), option.minimumDays - 1))!;
    dates = eachDayOfInterval({ start, end }).filter((date) => isBusinessDay(format(date, "yyyy-MM-dd")));
  }
  const requestedEnd=toGanttDate(throughDate);
  if(requestedEnd&&requestedEnd>end){end=requestedEnd;dates=eachDayOfInterval({start,end}).filter(date=>isBusinessDay(format(date,'yyyy-MM-dd')));}
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

export function ganttInterval(startValue: string | null | undefined, endValue: string | null | undefined, dates: Date[], cellWidth: number) {
  const start = toGanttDate(startValue);
  const end = toGanttDate(endValue);
  if (!start || !end || end < start) return null;
  const startIndex = businessDateIndex(start, dates, "start");
  const endIndex = businessDateIndex(end, dates, "end");
  if (startIndex >= dates.length || endIndex < 0) return null;
  const left = startIndex * cellWidth;
  // 被工作日轴压缩的假期区间保留边界点，不虚构一个工作日。
  if (endIndex < startIndex) return { left, width: 0, right: left };
  return { left, width: Math.max(cellWidth, (endIndex - startIndex + 1) * cellWidth), right: (endIndex + 1) * cellWidth };
}

