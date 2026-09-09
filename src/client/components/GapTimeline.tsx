import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { Ban, Check, Circle, CircleAlert, Play } from "lucide-react";
import { requirementStatusLabels, todayIso } from "../../shared/domain";
import type { ProgressUpdate, WorkItem } from "../types";
import { progressUpdateDisplayValue } from "../progress-trend";
import { useGanttTooltip } from "./GanttTooltip";
import { StatusBadge } from "./Badge";
import { EmptyState } from "./Feedback";
import { GanttViewSwitch, useGanttView } from "./GanttViewSwitch";
import { GanttDateTracks } from "./GanttDateTracks";
import { useGanttNavigation } from "../use-gantt-navigation";
import { GanttNavigation, GanttScrollbar } from "./GanttNavigation";
import { workItemDisplayGap, workItemActualRange } from "../gantt-actual";
import {
  GanttMilestoneMarker,
  GanttPlanActualBars,
  GanttScale,
  ganttTodayPosition,
  ganttTrackStyle,
  toGanttDate,
} from "./GanttTimeline";

type StatusFilter = "all" | "not_started" | "in_progress" | "blocked" | "completed" | "cancelled";
const statusFilters: Array<{ value: Exclude<StatusFilter, "all">; label: string }> = [
  { value: "in_progress", label: "进行中" },
  { value: "completed", label: "已完成" },
  { value: "not_started", label: "未开始" },
  { value: "blocked", label: "阻塞" },
  { value: "cancelled", label: "已取消" },
];

function dateLabel(value?: string | null, empty = "—") {
  const parsed = toGanttDate(value);
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

function WorkItemTimelinePopover({ item, updates, asOfDate }: { item: WorkItem; updates: ProgressUpdate[]; asOfDate: string }) {
  const gap = workItemDisplayGap(item, asOfDate);
  const observedEnd = gap.observedEnd;
  const related = updates.filter((update) => update.workItemId === item.id).slice(0, 2);
  return <>
    <header className="gantt-popover-header">
      <div><strong>{item.title}</strong><span>{item.assigneeNames?.join("、") || item.ownerName || "未分配"}</span></div>
      <StatusBadge kind="requirement" value={item.status} />
    </header>
    <dl className="gantt-popover-metrics">
      <div><dt>实际进度</dt><dd>{item.progress}%</dd></div>
      <div><dt>计划周期</dt><dd>{dateLabel(item.plannedStart)} — {dateLabel(item.plannedEnd)}</dd></div>
      <div><dt>实际执行跨度</dt><dd>{dateLabel(item.actualStart, "未开始")} — {dateLabel(observedEnd, "结束日期缺失")}{gap.actual.ongoing && observedEnd ? "（截至统计日）" : ""}</dd></div>
      {item.milestoneLabel && <div><dt>里程碑</dt><dd>{item.milestoneLabel} · {item.status === "completed" ? "已达成" : item.status === "cancelled" ? "已取消" : "待达成"}</dd></div>}
      <div><dt>计划 / 实际工期</dt><dd>{item.plannedStart && item.plannedEnd ? `${gap.planDuration}个工作日` : "—"} / {gap.actual.start && gap.actual.end ? `${gap.actualDuration}个工作日` : "—"}</dd></div>
      {item.status !== "cancelled" && <div><dt>完成 / 耗时偏差</dt><dd className={gap.finishVariance > 0 || gap.durationVariance > 0 ? "danger-text" : ""}>{gap.finishVariance > 0 ? "+" : ""}{gap.finishVariance}个工作日 / {gap.durationVariance > 0 ? "+" : ""}{gap.durationVariance}个工作日</dd></div>}
    </dl>
    {item.blockedReason && <p className="gantt-popover-blocked">阻塞：{item.blockedReason}</p>}
    {related.length > 0 && <section className="gantt-popover-updates"><h4>相关进展</h4>{related.map((update) => {
      const displayedPercent = progressUpdateDisplayValue(update);
      return <article key={update.id}><time>{new Date(update.createdAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</time><div><p>{update.content}</p></div>{displayedPercent !== null && <span>{displayedPercent}%</span>}</article>;
    })}</section>}
  </>;
}

export const GapTimeline = memo(function GapTimeline({
  items,
  storageKey = "my-work",
  targetItemId,
  milestones=[],
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
  emptyState,
}: {
  items: WorkItem[];
  storageKey?: string;
  milestones?:import('../../shared/paths').PathMilestone[];
  targetItemId?: string;
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
  emptyState?: { message: string; actionLabel?: string; onAction?: () => void };
}) {
  const [viewMode, setViewMode] = useGanttView();
  const Bars = viewMode === "split" ? GanttDateTracks : GanttPlanActualBars;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const tooltip = useGanttTooltip();
  const timelineValues = useMemo(() => [...items.flatMap(item => [item.plannedStart, item.plannedEnd, item.actualStart, workItemActualRange(item, asOfDate).end]), ...milestones.flatMap(m => [m.targetDate, m.achievedAt, m.forecastEnd])], [items, milestones, asOfDate]);
  const navigation = useGanttNavigation({ values: timelineValues, asOfDate, storageKey, onPan: tooltip.close });
  const { scrollRef, viewportWidth, dates, zoom, cellWidth, timelineWidth } = navigation;
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
    if (!targetItemId) return;
    const target = items.find((item) => item.id === targetItemId);
    if (!target) return;
    if (statusFilter !== "all" && target.status !== statusFilter) {
      setStatusFilter("all");
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const row = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>("[data-work-item-id]") || [])
        .find((element) => element.dataset.workItemId === targetItemId);
      row?.querySelector<HTMLElement>(".requirement-gantt-item")?.scrollIntoView({ block: "center", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [items, statusFilter, targetItemId, scrollRef]);
  const hasTimeline = milestones.some(m=>m.targetDate||m.achievedAt||m.forecastEnd)||items.some((item) => item.plannedStart || item.plannedEnd || item.actualStart || item.actualEnd);
  const narrow = viewportWidth > 0 && viewportWidth < 560;
  const inlineActions = viewportWidth > 0 && viewportWidth < 360;
  const labelWidth = inlineActions ? Math.max(90, Math.round(viewportWidth * .4)) : narrow ? Math.max(110, Math.round(viewportWidth * .34)) : viewportWidth
    ? Math.max(190, Math.min(230, Math.round(viewportWidth * 0.22)))
    : 230;
  const hasActions = Boolean(renderActions);
  const compactLayout = hasActions && viewportWidth > 0 && viewportWidth < 900;
  const gapWidth = showGapSummary && !compactLayout ? viewportWidth > 0 && viewportWidth < 850 ? 110 : 124 : 0;
  const actionWidth = hasActions && !inlineActions ? narrow ? 112 : compactLayout ? Math.min(actionColumnWidth, 144) : actionColumnWidth : 0;
  const fixedColumnsWidth = labelWidth + gapWidth + actionWidth;
  const trackStyle = useMemo(() => ganttTrackStyle(dates, cellWidth), [dates, cellWidth]);
  const { offset: todayOffset, visible: todayVisible } = ganttTodayPosition(dates, asOfDate);

  if (!hasTimeline && !showUnscheduled) return <EmptyState title="尚无可绘制的计划" detail="工作项生成计划后，这里会展示需求进展。" />;
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
            <span title="蓝色执行中，绿色已完成，琥珀条纹阻塞，灰色断纹已取消，红色描边延期"><i className="legend-actual" />实际</span>
            {viewMode === "overlay" && <><span><i className="legend-delayed" />延期</span><span><i className="legend-early" />提前</span></>}
            <span><i className="legend-milestone" />里程碑</span>
          </div>
        </div>
        <div className="gantt-toolbar-actions">
          <GanttViewSwitch value={viewMode} onChange={setViewMode} />
          <GanttNavigation navigation={navigation} />
        </div>
      </div>
      <div className="requirement-gantt-scroll gantt-navigation-surface" ref={navigation.attach} tabIndex={0} aria-label="工作项甘特时间轴，可左右拖动浏览">
        <div
          className={`requirement-gantt-grid${inlineActions ? " has-inline-actions" : ""}${!visibleItems.length ? " is-empty" : ""}`}
          style={{
            width: fixedColumnsWidth + timelineWidth,
            gridTemplateColumns: `${labelWidth}px ${timelineWidth}px${gapWidth ? ` ${gapWidth}px` : ""}${actionWidth ? ` ${actionWidth}px` : ""}`,
          }}
          role="table"
          aria-label={ariaLabel}
        >
          <div data-gantt-fixed className="requirement-gantt-corner sticky-left" role="columnheader">
            <strong>工作项</strong>
            <span>
              {visibleItems.length === items.length ? `${items.length}项` : `${visibleItems.length}/${items.length}项`}
              {visibleUnassignedCount > 0 && <em> · {visibleUnassignedCount}项未分配</em>}
            </span>
          </div>
          <GanttScale dates={dates} zoom={zoom} cellWidth={cellWidth} todayOffset={todayOffset} todayVisible={todayVisible} className="requirement-gantt-scale" />
          {gapWidth > 0 && <div data-gantt-fixed className="requirement-gantt-gap-head sticky-right" style={{ right: actionWidth }} role="columnheader">偏差</div>}
          {actionWidth > 0 && <div data-gantt-fixed className="requirement-gantt-action-head sticky-right" role="columnheader">操作</div>}
          {visibleItems.map((item) => {
            const gap = workItemDisplayGap(item, asOfDate);
            const observedEnd = gap.observedEnd;
            const tooltipProps = tooltip.bind(<WorkItemTimelinePopover item={item} updates={updates} asOfDate={asOfDate} />);
            return <div className={`requirement-gantt-row${item.id === targetItemId ? " is-target" : ""}`} data-work-item-id={item.id} role="row" key={item.id}>
              <div className={`requirement-gantt-item item-status-${statusClass(item.status)}${item.ownerId ? "" : " is-unassigned"} sticky-left`} role="rowheader">
                <div>
                  {onItemClick
                    ? <button type="button" className="requirement-gantt-item-link" onClick={() => onItemClick(item)} title={item.title}>{item.title}</button>
                    : <strong>{item.title}</strong>}
                  <span className="requirement-gantt-item-meta">
                    {renderItemMeta ? renderItemMeta(item) : item.ownerId
                      ? <small>{item.assigneeNames?.join("、") || item.ownerName}</small>
                      : <small className="work-item-owner-warning"><CircleAlert size={11} />未设置负责人{item.collaborators?.length ? ` · ${item.collaborators.length}人协作` : ""}</small>}
                    {item.milestoneLabel && !milestones.length && <span className="work-item-milestone-chip" title={`里程碑：${item.milestoneLabel}`}>◆ {item.milestoneLabel}</span>}
                  </span>
                  {inlineActions && renderActions?.(item)}
                </div>
              </div>
              <div className={`requirement-gantt-track unified-gantt-track${viewMode === "split" ? " gantt-split-track" : ""}`} style={trackStyle} role="cell">
                <Bars
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
                <GanttMilestoneMarker label={milestones.length?null:item.milestoneLabel} plannedEnd={item.plannedEnd} actualEnd={item.actualEnd} status={item.status} dates={dates} cellWidth={cellWidth} zoom={zoom} asOfDate={asOfDate} interactionProps={tooltipProps} />
                {todayVisible && <i className="gantt-today-line" style={{ left: (todayOffset + 1) * cellWidth }} title={`截至 ${asOfDate}`} />}
              </div>
              {gapWidth > 0 && <div className="requirement-gap-summary sticky-right" style={{ right: actionWidth }} role="cell">
                {item.status === "cancelled" ? <span>已取消</span> : item.actualStart && !observedEnd ? <span>实际日期不完整</span> : item.actualStart ? <><strong className={gap.finishVariance > 0 ? "gap-late" : gap.finishVariance < 0 ? "gap-early" : ""}>{gap.finishVariance > 0 ? `延期 +${gap.finishVariance}工作日` : gap.finishVariance < 0 ? `${item.status === "completed" ? "提前" : "距截止"} ${Math.abs(gap.finishVariance)}工作日` : "按期"}</strong><small>耗时 {gap.durationVariance > 0 ? "+" : ""}{gap.durationVariance}工作日</small></> : <span>未开始</span>}
              </div>}
              {actionWidth > 0 && <div className="requirement-gantt-actions sticky-right" role="cell">{renderActions?.(item)}</div>}
            </div>;
          })}
          {milestones.map(m=><div className="requirement-gantt-row" role="row" key={m.id}><div className="requirement-gantt-item sticky-left" role="rowheader"><strong>◇ {m.title}</strong><small>{m.achievedAt?'已达成':m.confirmationMode==='manual'?'等待人工确认':'等待前置完成'}</small></div><div className="requirement-gantt-track unified-gantt-track" style={trackStyle} role="cell"><GanttMilestoneMarker label={m.title} plannedEnd={m.targetDate||m.achievedAt||m.forecastEnd} actualEnd={m.achievedAt} status={m.cancelled?'cancelled':m.achievedAt?'completed':'not_started'} dates={dates} cellWidth={cellWidth} zoom={zoom} asOfDate={asOfDate}/>{!m.targetDate&&!m.achievedAt&&!m.forecastEnd&&<small>交付日期待确认</small>}</div>{gapWidth>0&&<div className="requirement-gap-summary sticky-right" style={{right:actionWidth}}>里程碑</div>}{actionWidth>0&&<div className="requirement-gantt-actions sticky-right"/>}</div>)}
          {!visibleItems.length && <div className="requirement-gantt-filter-empty"><span>{emptyState?.message || "当前状态下没有工作项"}</span>{(emptyState?.onAction || statusFilter !== "all") && <button type="button" onClick={emptyState?.onAction || (() => setStatusFilter("all"))}>{emptyState?.actionLabel || "查看全部"}</button>}</div>}
        </div>
      </div>
      <GanttScrollbar navigation={navigation} />
      {tooltip.tooltip}
    </div>
  );
});
