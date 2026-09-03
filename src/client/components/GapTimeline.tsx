import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { Ban, Check, Circle, CircleAlert, LocateFixed, Play } from "lucide-react";
import { calculateWorkItemGap, requirementStatusLabels, todayIso } from "../../shared/domain";
import type { ProgressUpdate, WorkItem } from "../types";
import { useGanttTooltip } from "./GanttTooltip";
import { EmptyState } from "./Modal";
import {
  buildBusinessDayTimeline,
  GanttMilestoneMarker,
  GanttPlanActualBars,
  GanttScale,
  ganttTodayPosition,
  ganttTrackStyle,
  ganttZoomOptions,
  toGanttDate,
  type GanttZoom,
} from "./GanttTimeline";

type StatusFilter = "all" | "not_started" | "in_progress" | "blocked" | "completed" | "cancelled";
const statusFilters: Array<{ value: Exclude<StatusFilter, "all">; label: string }> = [
  { value: "in_progress", label: "进行中" },
  { value: "completed", label: "已完成" },
  { value: "not_started", label: "未开始" },
  { value: "blocked", label: "阻塞" },
  { value: "cancelled", label: "已取消" },
];

function toDate(value?: string | null) {
  return toGanttDate(value);
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
      <div><dt>实际进度</dt><dd>{item.progress}%</dd></div>
      <div><dt>计划周期</dt><dd>{dateLabel(item.plannedStart)} — {dateLabel(item.plannedEnd)}</dd></div>
      <div><dt>实际周期</dt><dd>{dateLabel(item.actualStart, "未开始")} — {dateLabel(observedEnd, "未完成")}</dd></div>
      {item.milestoneLabel && <div><dt>里程碑</dt><dd>{item.milestoneLabel} · {item.status === "completed" ? "已达成" : item.status === "cancelled" ? "已取消" : "待达成"}</dd></div>}
      <div><dt>计划 / 实际工期</dt><dd>{gap.planDuration || 0}天 / {gap.actualDuration || 0}天</dd></div>
      <div><dt>完成 / 耗时偏差</dt><dd className={gap.finishVariance > 0 || gap.durationVariance > 0 ? "danger-text" : ""}>{gap.finishVariance > 0 ? "+" : ""}{gap.finishVariance}天 / {gap.durationVariance > 0 ? "+" : ""}{gap.durationVariance}天</dd></div>
    </dl>
    {item.blockedReason && <p className="gantt-popover-blocked">阻塞：{item.blockedReason}</p>}
    {related.length > 0 && <section className="gantt-popover-updates"><h4>相关进展</h4>{related.map((update) => <article key={update.id}><time>{new Date(update.createdAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</time><div><p>{update.content}</p></div><span>{update.workItemPercent ?? item.progress}%</span></article>)}</section>}
  </>;
}

export const GapTimeline = memo(function GapTimeline({
  items,
  updates = [],
  canUpdateProgress,
  onUpdateProgress,
  renderActions,
  renderItemMeta,
  onItemClick,
  showStatusFilters = true,
  showGapSummary = true,
  showUnscheduled = false,
  actionColumnWidth = 132,
  ariaLabel = "需求工作项进展甘特图",
  asOfDate = todayIso(),
}: {
  items: WorkItem[];
  updates?: ProgressUpdate[];
  canUpdateProgress?: (item: WorkItem) => boolean;
  onUpdateProgress?: (item: WorkItem) => void;
  renderActions?: (item: WorkItem) => ReactNode;
  renderItemMeta?: (item: WorkItem) => ReactNode;
  onItemClick?: (item: WorkItem) => void;
  showStatusFilters?: boolean;
  showGapSummary?: boolean;
  showUnscheduled?: boolean;
  actionColumnWidth?: number;
  ariaLabel?: string;
  asOfDate?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<GanttZoom>("day");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [viewportWidth, setViewportWidth] = useState(0);
  const tooltip = useGanttTooltip();
  const option = ganttZoomOptions[zoom];
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
  const hasTimeline = items.some((item) => item.plannedStart || item.plannedEnd || item.actualStart || item.actualEnd);
  const range = useMemo(() => buildBusinessDayTimeline(
    items.flatMap((item) => [item.plannedStart, item.plannedEnd, item.actualStart, item.actualEnd || (item.actualStart ? calculateWorkItemGap(item).observedEnd : null)]),
    zoom,
  ), [items, zoom]);

  if (!hasTimeline && !showUnscheduled) return <EmptyState title="尚无可绘制的计划" detail="工作项生成计划后，这里会展示需求进展。" />;
  const labelWidth = viewportWidth
    ? Math.max(190, Math.min(230, Math.round(viewportWidth * 0.22)))
    : 230;
  const hasActions = Boolean(renderActions);
  const compactLayout = hasActions && viewportWidth > 0 && viewportWidth < 900;
  const gapWidth = showGapSummary && !compactLayout ? viewportWidth > 0 && viewportWidth < 850 ? 110 : 124 : 0;
  const actionWidth = hasActions ? compactLayout ? Math.min(actionColumnWidth, 144) : actionColumnWidth : 0;
  const fixedColumnsWidth = labelWidth + gapWidth + actionWidth;
  const timelineWidth = Math.max(range.days * option.cellWidth, viewportWidth - fixedColumnsWidth);
  const cellWidth = timelineWidth / range.days;
  const dates = range.dates;
  const trackStyle = ganttTrackStyle(dates, cellWidth);
  const { offset: todayOffset, visible: todayVisible } = ganttTodayPosition(dates, asOfDate);
  const scrollToToday = () => {
    if (!todayVisible || !scrollRef.current) return;
    const visibleWidth = Math.max(280, scrollRef.current.clientWidth - fixedColumnsWidth);
    scrollRef.current.scrollTo({ left: Math.max(0, labelWidth + (todayOffset + 1) * cellWidth - visibleWidth / 2), behavior: "smooth" });
  };

  return (
    <div className="requirement-gantt">
      <div className="requirement-gantt-toolbar">
        <div className="requirement-gantt-toolbar-main">
          {showStatusFilters && <div className="work-status-filters" aria-label="按工作项状态筛选">
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
          </div>}
          <div className="gantt-legend" aria-label="计划实际图例">
            <span><i className="legend-plan-pill" />计划</span>
            <span><i className="legend-actual" />实际</span>
            <span><i className="legend-delayed" />延期</span>
            <span><i className="legend-milestone" />里程碑</span>
          </div>
        </div>
        <div className="gantt-toolbar-actions">
          <button className="ghost-button" onClick={scrollToToday} disabled={!todayVisible}><LocateFixed size={15} />今天</button>
          <div className="view-tabs" aria-label="时间粒度">{(Object.keys(ganttZoomOptions) as GanttZoom[]).map((key) => <button key={key} className={zoom === key ? "active" : ""} onClick={() => setZoom(key)}>{ganttZoomOptions[key].label}</button>)}</div>
        </div>
      </div>
      <div className="requirement-gantt-scroll" ref={scrollRef}>
        <div
          className="requirement-gantt-grid"
          style={{
            width: fixedColumnsWidth + timelineWidth,
            gridTemplateColumns: `${labelWidth}px ${timelineWidth}px${gapWidth ? ` ${gapWidth}px` : ""}${actionWidth ? ` ${actionWidth}px` : ""}`,
          }}
          role="table"
          aria-label={ariaLabel}
        >
          <div className="requirement-gantt-corner sticky-left" role="columnheader">
            <strong>工作项</strong>
            <span>
              {visibleItems.length === items.length ? `${items.length}项` : `${visibleItems.length}/${items.length}项`}
              {visibleUnassignedCount > 0 && <em> · {visibleUnassignedCount}项未分配</em>}
            </span>
          </div>
          <GanttScale dates={dates} zoom={zoom} cellWidth={cellWidth} todayOffset={todayOffset} todayVisible={todayVisible} className="requirement-gantt-scale" />
          {gapWidth > 0 && <div className="requirement-gantt-gap-head sticky-right" style={{ right: actionWidth }} role="columnheader">偏差</div>}
          {hasActions && <div className="requirement-gantt-action-head sticky-right" role="columnheader">操作</div>}
          {visibleItems.map((item) => {
            const gap = calculateWorkItemGap(item);
            const observedEnd = item.actualEnd || (item.actualStart ? gap.observedEnd : null);
            const tooltipProps = tooltip.bind(<WorkItemTimelinePopover item={item} updates={updates} />);
            return <div className="requirement-gantt-row" role="row" key={item.id}>
              <div className={`requirement-gantt-item item-status-${statusClass(item.status)}${item.ownerId ? "" : " is-unassigned"} sticky-left`} role="rowheader">
                <div>
                  {onItemClick
                    ? <button type="button" className="requirement-gantt-item-link" onClick={() => onItemClick(item)} title={item.title}>{item.title}</button>
                    : <strong>{item.title}</strong>}
                  <span className="requirement-gantt-item-meta">
                    {renderItemMeta ? renderItemMeta(item) : item.ownerId
                      ? <small>{item.assigneeNames?.join("、") || item.ownerName}</small>
                      : <small className="work-item-owner-warning"><CircleAlert size={11} />未设置负责人{item.collaborators?.length ? ` · ${item.collaborators.length}人协作` : ""}</small>}
                    {item.milestoneLabel && <span className="work-item-milestone-chip" title={`里程碑：${item.milestoneLabel}`}>◆ {item.milestoneLabel}</span>}
                  </span>
                </div>
              </div>
              <div className="requirement-gantt-track unified-gantt-track" style={trackStyle} role="cell">
                <GanttPlanActualBars
                  plannedStart={item.plannedStart}
                  plannedEnd={item.plannedEnd}
                  actualStart={item.actualStart}
                  actualEnd={observedEnd}
                  status={item.status}
                  progress={item.progress}
                  dates={dates}
                  cellWidth={cellWidth}
                  onProgressClick={onUpdateProgress && canUpdateProgress?.(item) ? () => onUpdateProgress(item) : undefined}
                  progressAriaLabel={`${statusLabel(item.status)}，实际进度${item.progress}%，${onUpdateProgress && canUpdateProgress?.(item) ? "点击更新进度" : "只读"}`}
                  interactionProps={tooltipProps}
                  showUnscheduled={showUnscheduled}
                />
                <GanttMilestoneMarker label={item.milestoneLabel} plannedEnd={item.plannedEnd} actualEnd={item.actualEnd} status={item.status} dates={dates} cellWidth={cellWidth} zoom={zoom} asOfDate={asOfDate} />
                {todayVisible && <i className="gantt-today-line" style={{ left: (todayOffset + 1) * cellWidth }} title={`截至 ${asOfDate}`} />}
              </div>
              {gapWidth > 0 && <div className="requirement-gap-summary sticky-right" style={{ right: actionWidth }} role="cell">
                {item.actualStart ? <><strong className={gap.finishVariance > 0 ? "gap-late" : gap.finishVariance < 0 ? "gap-early" : ""}>{gap.finishVariance > 0 ? `延期 +${gap.finishVariance}天` : gap.finishVariance < 0 ? `提前 ${Math.abs(gap.finishVariance)}天` : "按期"}</strong><small>耗时 {gap.durationVariance > 0 ? "+" : ""}{gap.durationVariance}天</small></> : <span>未开始</span>}
              </div>}
              {hasActions && <div className="requirement-gantt-actions sticky-right" role="cell">{renderActions?.(item)}</div>}
            </div>;
          })}
          {!visibleItems.length && <div className="requirement-gantt-filter-empty"><span>当前状态下没有工作项</span><button type="button" onClick={() => setStatusFilter("all")}>查看全部</button></div>}
        </div>
      </div>
      {tooltip.tooltip}
    </div>
  );
});
