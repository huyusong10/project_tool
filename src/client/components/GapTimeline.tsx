import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { addDays, differenceInCalendarDays, format, isValid, parseISO } from "date-fns";
import { Ban, Check, Circle, CircleAlert, LocateFixed, Play } from "lucide-react";
import { calculateWorkItemGap, requirementStatusLabels, todayIso } from "../../shared/domain";
import type { ProgressUpdate, WorkItem } from "../types";
import { useGanttTooltip } from "./GanttTooltip";
import { EmptyState } from "./Modal";

type Zoom = "day" | "week" | "month";
type StatusFilter = "all" | "not_started" | "in_progress" | "blocked" | "completed" | "cancelled";
const zoomOptions: Record<Zoom, { label: string; cellWidth: number; padding: number; minimumDays: number }> = {
  day: { label: "日", cellWidth: 34, padding: 3, minimumDays: 21 },
  week: { label: "周", cellWidth: 15, padding: 7, minimumDays: 49 },
  month: { label: "月", cellWidth: 6, padding: 15, minimumDays: 150 },
};
const statusFilters: Array<{ value: Exclude<StatusFilter, "all">; label: string }> = [
  { value: "in_progress", label: "进行中" },
  { value: "completed", label: "已完成" },
  { value: "not_started", label: "未开始" },
  { value: "blocked", label: "阻塞" },
  { value: "cancelled", label: "已取消" },
];

function toDate(value?: string | null) {
  if (!value) return null;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
}

function dateLabel(value?: string | null, empty = "—") {
  const parsed = toDate(value);
  return parsed ? format(parsed, "yyyy/MM/dd") : empty;
}

function statusLabel(value: string) {
  return requirementStatusLabels[value as keyof typeof requirementStatusLabels] || value;
}

function statusClass(value: string) {
  return value.replaceAll("_", "-");
}

function WorkStatusIcon({ status, size = 12 }: { status: string; size?: number }) {
  if (status === "completed") return <Check size={size} strokeWidth={3} />;
  if (status === "in_progress") return <Play size={size} fill="currentColor" />;
  if (status === "blocked") return <CircleAlert size={size} />;
  if (status === "cancelled") return <Ban size={size} />;
  return <Circle size={size} />;
}

function WorkItemTimelinePopover({ item, updates }: { item: WorkItem; updates: ProgressUpdate[] }) {
  const gap = calculateWorkItemGap(item);
  const observedEnd = item.actualEnd || (item.actualStart ? gap.observedEnd : null);
  const related = updates.filter((update) => update.workItemId === item.id).slice(0, 2);
  return <>
    <header className="gantt-popover-header">
      <div><strong>{item.title}</strong><span>{item.assigneeNames?.join("、") || item.ownerName || "未分配"}</span></div>
      <span className={`status-pill status-${item.status}`}>{statusLabel(item.status)}</span>
    </header>
    <dl className="gantt-popover-metrics">
      <div><dt>计划周期</dt><dd>{dateLabel(item.plannedStart)} — {dateLabel(item.plannedEnd)}</dd></div>
      <div><dt>实际周期</dt><dd>{dateLabel(item.actualStart, "未开始")} — {dateLabel(observedEnd, "未完成")}</dd></div>
      <div><dt>计划 / 实际工期</dt><dd>{gap.planDuration || 0}天 / {gap.actualDuration || 0}天</dd></div>
      <div><dt>完成 / 耗时偏差</dt><dd className={gap.finishVariance > 0 || gap.durationVariance > 0 ? "danger-text" : ""}>{gap.finishVariance > 0 ? "+" : ""}{gap.finishVariance}天 / {gap.durationVariance > 0 ? "+" : ""}{gap.durationVariance}天</dd></div>
    </dl>
    {item.blockedReason && <p className="gantt-popover-blocked">阻塞：{item.blockedReason}</p>}
    {related.length > 0 && <section className="gantt-popover-updates"><h4>相关进展</h4>{related.map((update) => <article key={update.id}><time>{new Date(update.createdAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</time><div><p>{update.content}</p></div><span>{update.percent}%</span></article>)}</section>}
  </>;
}

export const GapTimeline = memo(function GapTimeline({ items, updates = [] }: { items: WorkItem[]; updates?: ProgressUpdate[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<Zoom>("week");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [viewportWidth, setViewportWidth] = useState(0);
  const tooltip = useGanttTooltip();
  const option = zoomOptions[zoom];
  const statusCounts = useMemo(() => items.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] || 0) + 1;
    return counts;
  }, {}), [items]);
  const visibleItems = useMemo(
    () => statusFilter === "all" ? items : items.filter((item) => item.status === statusFilter),
    [items, statusFilter],
  );
  const visibleUnassignedCount = visibleItems.filter((item) => !item.ownerId).length;
  useEffect(() => {
    if (statusFilter !== "all" && !items.some((item) => item.status === statusFilter)) setStatusFilter("all");
  }, [items, statusFilter]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const updateWidth = (width: number) => {
      const next = Math.round(width);
      setViewportWidth((current) => current === next ? current : next);
    };
    updateWidth(element.clientWidth);
    const observer = new ResizeObserver((entries) => updateWidth(entries[0]?.contentRect.width || element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const range = useMemo(() => {
    const today = todayIso();
    const values = items.flatMap((item) => [item.plannedStart, item.plannedEnd, item.actualStart, item.actualEnd || (item.actualStart ? today : null)]).map(toDate).filter(Boolean) as Date[];
    if (!values.length) return null;
    const earliest = new Date(Math.min(...values.map((value) => value.getTime())));
    const latest = new Date(Math.max(...values.map((value) => value.getTime())));
    const start = addDays(earliest, -option.padding);
    let end = addDays(latest, option.padding);
    if (differenceInCalendarDays(end, start) + 1 < option.minimumDays) end = addDays(start, option.minimumDays - 1);
    return { start, end, days: differenceInCalendarDays(end, start) + 1 };
  }, [items, option.minimumDays, option.padding]);

  if (!range) return <EmptyState title="尚无可绘制的计划" detail="工作项生成计划后，这里会展示需求进展。" />;
  const labelWidth = viewportWidth
    ? Math.max(190, Math.min(230, Math.round(viewportWidth * 0.22)))
    : 230;
  const gapWidth = viewportWidth > 0 && viewportWidth < 850 ? 110 : 124;
  const fixedColumnsWidth = labelWidth + gapWidth;
  const timelineWidth = Math.max(range.days * option.cellWidth, viewportWidth - fixedColumnsWidth);
  const cellWidth = timelineWidth / range.days;
  const dates = Array.from({ length: range.days }, (_, index) => addDays(range.start, index));
  const firstSaturday = dates.findIndex((date) => date.getDay() === 6);
  const trackStyle = { width: timelineWidth, "--gantt-cell": `${cellWidth}px`, "--gantt-week": `${cellWidth * 7}px`, "--gantt-weekend-offset": `${Math.max(0, firstSaturday) * cellWidth}px` } as CSSProperties;
  const todayOffset = differenceInCalendarDays(new Date(), range.start);
  const todayVisible = todayOffset >= 0 && todayOffset < range.days;
  const markerVisible = (date: Date, index: number) => zoom === "day" ? true : zoom === "week" ? index === 0 || date.getDay() === 1 : index === 0 || date.getDate() === 1;
  const markerText = (date: Date) => zoom === "day" ? format(date, "dd") : zoom === "week" ? format(date, "MM/dd") : format(date, "yyyy/MM");
  const scrollToToday = () => {
    if (!todayVisible || !scrollRef.current) return;
    const visibleWidth = Math.max(280, scrollRef.current.clientWidth - fixedColumnsWidth);
    scrollRef.current.scrollTo({ left: Math.max(0, labelWidth + todayOffset * cellWidth - visibleWidth / 2), behavior: "smooth" });
  };

  return (
    <div className="requirement-gantt">
      <div className="requirement-gantt-toolbar">
        <div className="requirement-gantt-toolbar-main">
          <div className="work-status-filters" aria-label="按工作项状态筛选">
            <button type="button" className={statusFilter === "all" ? "is-active" : ""} aria-pressed={statusFilter === "all"} onClick={() => setStatusFilter("all")}>全部 <b>{items.length}</b></button>
            {statusFilters.filter((filter) => filter.value !== "cancelled" || statusCounts.cancelled).map((filter) => {
              const count = statusCounts[filter.value] || 0;
              return <button
                type="button"
                key={filter.value}
                className={`filter-${statusClass(filter.value)}${statusFilter === filter.value ? " is-active" : ""}`}
                aria-pressed={statusFilter === filter.value}
                disabled={!count}
                onClick={() => setStatusFilter(filter.value)}
              >
                <WorkStatusIcon status={filter.value} />
                {filter.label} <b>{count}</b>
              </button>;
            })}
          </div>
          <div className="gantt-legend" aria-label="计划实际图例">
            <span><i className="legend-plan-line" />计划</span>
            <span><i className="legend-actual" />实际按状态着色</span>
            <span><i className="legend-delayed" />超出计划</span>
          </div>
        </div>
        <div className="gantt-toolbar-actions">
          <button className="ghost-button" onClick={scrollToToday} disabled={!todayVisible}><LocateFixed size={15} />今天</button>
          <div className="view-tabs" aria-label="时间粒度">{(Object.keys(zoomOptions) as Zoom[]).map((key) => <button key={key} className={zoom === key ? "active" : ""} onClick={() => setZoom(key)}>{zoomOptions[key].label}</button>)}</div>
        </div>
      </div>
      <div className="requirement-gantt-scroll" ref={scrollRef}>
        <div className="requirement-gantt-grid" style={{ width: fixedColumnsWidth + timelineWidth, gridTemplateColumns: `${labelWidth}px ${timelineWidth}px ${gapWidth}px` }} role="table" aria-label="需求工作项进展甘特图">
          <div className="requirement-gantt-corner sticky-left" role="columnheader">
            <strong>工作项</strong>
            <span>
              {visibleItems.length === items.length ? `${items.length}项` : `${visibleItems.length}/${items.length}项`}
              {visibleUnassignedCount > 0 && <em> · {visibleUnassignedCount}项未分配</em>}
            </span>
          </div>
          <div className="requirement-gantt-scale" style={trackStyle} role="columnheader">
            {dates.map((date, index) => markerVisible(date, index) && <span style={{ left: index * cellWidth, width: zoom === "month" ? cellWidth * 30 : zoom === "week" ? cellWidth * 7 : cellWidth }} key={date.toISOString()}>{markerText(date)}</span>)}
            {todayVisible && <i className="gantt-today-line" style={{ left: todayOffset * cellWidth + cellWidth / 2 }} />}
          </div>
          <div className="requirement-gantt-gap-head sticky-right" role="columnheader">偏差</div>
          {visibleItems.map((item) => {
            const gap = calculateWorkItemGap(item);
            const observedEnd = item.actualEnd || (item.actualStart ? gap.observedEnd : null);
            const planStart = toDate(item.plannedStart); const planEnd = toDate(item.plannedEnd);
            const actualStart = toDate(item.actualStart); const actualEnd = toDate(observedEnd);
            const planLeft = planStart ? differenceInCalendarDays(planStart, range.start) * cellWidth : 0;
            const planWidth = planStart && planEnd ? Math.max(cellWidth, (differenceInCalendarDays(planEnd, planStart) + 1) * cellWidth) : 0;
            const actualLeft = actualStart ? differenceInCalendarDays(actualStart, range.start) * cellWidth : 0;
            const actualWidth = actualStart && actualEnd ? Math.max(cellWidth, (differenceInCalendarDays(actualEnd, actualStart) + 1) * cellWidth) : 0;
            const planRight = planLeft + planWidth; const actualRight = actualLeft + actualWidth;
            const delayLeft = Math.max(actualLeft, planRight); const delayWidth = Math.max(0, actualRight - delayLeft);
            const tooltipProps = tooltip.bind(<WorkItemTimelinePopover item={item} updates={updates} />);
            return <div className="requirement-gantt-row" role="row" key={item.id}>
              <div className={`requirement-gantt-item item-status-${statusClass(item.status)}${item.ownerId ? "" : " is-unassigned"} sticky-left`} role="rowheader">
                <div>
                  <strong>{item.title}</strong>
                  <span className="requirement-gantt-item-meta">
                    {item.ownerId
                      ? <small>{item.assigneeNames?.join("、") || item.ownerName}</small>
                      : <small className="work-item-owner-warning"><CircleAlert size={11} />未设置负责人{item.collaborators?.length ? ` · ${item.collaborators.length}人协作` : ""}</small>}
                    <span className={`work-item-status-badge badge-${statusClass(item.status)}`}><WorkStatusIcon status={item.status} size={10} />{statusLabel(item.status)}</span>
                  </span>
                </div>
              </div>
              <div className="requirement-gantt-track" style={trackStyle} role="cell" tabIndex={0} {...tooltipProps}>
                {planWidth > 0 && <span className="requirement-plan-range" style={{ left: planLeft, width: planWidth }} />}
                {actualWidth > 0 && <span className={`requirement-actual-range gantt-status-${statusClass(item.status)}`} style={{ left: actualLeft, width: actualWidth }} />}
                {delayWidth > 0 && <span className="requirement-delay-range" style={{ left: delayLeft, width: delayWidth }} />}
                {actualWidth > 0 && <span className={`requirement-actual-end end-${statusClass(item.status)}`} style={{ left: actualRight }}><WorkStatusIcon status={item.status} size={9} /></span>}
                {todayVisible && <i className="gantt-today-line" style={{ left: todayOffset * cellWidth + cellWidth / 2 }} />}
              </div>
              <div className="requirement-gap-summary sticky-right" role="cell">
                {item.actualStart ? <><strong className={gap.finishVariance > 0 ? "gap-late" : gap.finishVariance < 0 ? "gap-early" : ""}>{gap.finishVariance > 0 ? `延期 +${gap.finishVariance}天` : gap.finishVariance < 0 ? `提前 ${Math.abs(gap.finishVariance)}天` : "按期"}</strong><small>耗时 {gap.durationVariance > 0 ? "+" : ""}{gap.durationVariance}天</small></> : <span>未开始</span>}
              </div>
            </div>;
          })}
          {!visibleItems.length && <div className="requirement-gantt-filter-empty"><span>当前状态下没有工作项</span><button type="button" onClick={() => setStatusFilter("all")}>查看全部</button></div>}
        </div>
      </div>
      {tooltip.tooltip}
    </div>
  );
});
