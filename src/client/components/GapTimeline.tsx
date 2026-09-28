import { Button } from './Button';
import { useCallback, memo, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { format } from "date-fns";
import { Ban, Check, Circle, CircleAlert, Play } from "lucide-react";
import { requirementStatusLabels, todayIso } from "../../shared/domain";
import type { ProgressUpdate, WorkItem } from "../types";
import { progressUpdateDisplayValue } from "../progress-trend";
import { useGanttTooltip } from "./GanttTooltip";
import { StatusBadge } from "./Badge";
import { EmptyState } from "./Feedback";
import { GanttDateTracks } from "./GanttDateTracks";
import { GanttProgressEnd, GanttProgressText } from './GanttProgressEnd';
import { GanttLegend } from './GanttLegend';
import { workProgressParts } from '../workspace-gantt-presentation';
import { useGanttNavigation } from "../use-gantt-navigation";
import { GanttNavigation, GanttScrollbar } from "./GanttNavigation";
import { workItemDisplayGap, workItemActualRange } from "../gantt-actual";
import { delayedForecastEnd, ganttForecast, type GanttForecast } from '../gantt-forecast';
import { achievedMilestones, milestoneDate, requirementMilestones } from '../gantt-milestones';
import { useGanttMilestoneData } from '../use-gantt-milestones';
import { GanttMilestoneRail, GanttMilestoneCuts, useMilestoneSelection } from './GanttMilestones';
import { GanttScale, ganttTodayPosition, ganttTrackStyle, toGanttDate } from "./GanttTimeline";

type StatusFilter = "all" | "not_started" | "in_progress" | "completed" | "cancelled";
const statusFilters: Array<{ value: Exclude<StatusFilter, "all">; label: string }> = [
  { value: "in_progress", label: "进行中" },
  { value: "completed", label: "已完成" },
  { value: "not_started", label: "未开始" },
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
  if (status === "cancelled") return <Ban size={size} />;
  return <Circle size={size} />;
}

function WorkItemTimelinePopover({ item, updates, asOfDate, executionStatus, forecast }: { item: WorkItem; updates: ProgressUpdate[]; asOfDate: string; executionStatus?: string; forecast?: GanttForecast | null }) {
  const gap = workItemDisplayGap(item, asOfDate);
  const observedEnd = gap.observedEnd;
  const notStarted = ["not_started", "planning"].includes(item.status) && !gap.actual.start && !observedEnd;
  const related = updates.filter((update) => update.workItemId === item.id).slice(0, 2);
  return <>
    <header className="gantt-popover-header">
      <div><strong>{item.title}</strong><span>{item.assigneeNames?.join("、") || item.ownerName || "未分配"}</span></div>
      <StatusBadge kind="requirement" value={executionStatus || item.status} />
    </header>
    <dl className="gantt-popover-metrics">
      <div><dt>实际进度</dt><dd>{item.progress}%</dd></div>
      {forecast && <div><dt>预计完成</dt><dd>{forecast.label}<small className="gantt-range-note">{forecast.details}</small></dd></div>}
      <div><dt>计划周期</dt><dd>{dateLabel(item.plannedStart)} — {dateLabel(item.plannedEnd)}</dd></div>
      <div><dt>实际执行跨度</dt><dd>{notStarted ? "尚未开始" : <>{dateLabel(item.actualStart, "缺少开始日期")} — {dateLabel(observedEnd, "结束日期缺失")}{gap.actual.ongoing && observedEnd ? "（截至统计日）" : ""}</>}</dd></div>
      {item.milestoneLabel && <div><dt>里程碑</dt><dd>{item.milestoneLabel} · {item.status === "completed" ? "已达成" : item.status === "cancelled" ? "已取消" : "待达成"}</dd></div>}
      <div><dt>计划 / 实际工期</dt><dd>{item.plannedStart && item.plannedEnd ? `${gap.planDuration}个工作日` : "—"} / {gap.actual.start && gap.actual.end ? `${gap.actualDuration}个工作日` : "—"}</dd></div>
      {item.status !== "cancelled" && <div><dt>完成 / 耗时偏差</dt>{!item.plannedStart || !item.plannedEnd ? <dd>待排期</dd> : notStarted ? <dd>尚未开始</dd> : !gap.actual.start || !gap.actual.end ? <dd>实际日期待确认</dd> : <dd className={gap.finishVariance > 0 || gap.durationVariance > 0 ? "danger-text" : ""}>{gap.finishVariance > 0 ? "+" : ""}{gap.finishVariance}个工作日 / {gap.durationVariance > 0 ? "+" : ""}{gap.durationVariance}个工作日</dd>}</div>}
    </dl>
    {related.length > 0 && <section className="gantt-popover-updates"><h4>相关进展</h4>{related.map((update) => {
      const displayedPercent = progressUpdateDisplayValue(update);
      return <article key={update.id}><time>{new Date(update.createdAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</time><div><p>{update.content}</p></div>{displayedPercent !== null && <span>{displayedPercent}%</span>}</article>;
    })}</section>}
  </>;
}

export const GapTimeline = memo(function GapTimeline({
  items,
  rangeItems = items,
  scrollElementRef,
  itemLabel = '工作项',
  executionStatus,
  storageKey = "my-work",
  targetItemId,
  milestones,
  projectId,
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
  rangeItems?: WorkItem[];
  scrollElementRef?: (element: HTMLDivElement | null) => void;
  itemLabel?: string;
  executionStatus?: string;
  storageKey?: string;
  milestones?:import('../../shared/paths').PathMilestone[];
  projectId?: string;
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const tooltip = useGanttTooltip();
  const milestoneData = useGanttMilestoneData(projectId);
  const forecasts = useMemo(() => {
    return new Map(rangeItems.map(item => [item.id, ganttForecast(item.deliveryForecast, item.status, asOfDate)]));
  }, [rangeItems, asOfDate]);
  const milestoneItems = useMemo(() => achievedMilestones(requirementMilestones(milestones, rangeItems, milestoneData?.edges)), [milestones, rangeItems, milestoneData?.edges]);
  const milestoneSelection = useMilestoneSelection(milestoneItems, asOfDate);
  const timelineValues = useMemo(() => [...rangeItems.flatMap(item => [item.plannedStart, item.plannedEnd, item.actualStart, workItemActualRange(item, asOfDate).end, delayedForecastEnd(forecasts.get(item.id), item.plannedStart ? item.plannedEnd : null)]), ...milestoneItems.map(m => milestoneDate(m))], [rangeItems, milestoneItems, asOfDate, forecasts]);
  const navigation = useGanttNavigation({ values: timelineValues, asOfDate, storageKey, onPan: tooltip.close });
  const { scrollRef, viewportWidth, dates, zoom, cellWidth, timelineWidth } = navigation;
  const attach = navigation.attach;
  const attachScroll = useCallback((element: HTMLDivElement | null) => { attach(element); scrollElementRef?.(element); }, [attach, scrollElementRef]);
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
  const hasTimeline = milestoneItems.length > 0 || items.some((item) => item.plannedStart || item.plannedEnd || item.actualStart || item.actualEnd);
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
  const trackStyle = useMemo(() => ganttTrackStyle(dates, cellWidth, zoom), [dates, cellWidth, zoom]);
  const { offset: todayOffset, visible: todayVisible } = ganttTodayPosition(dates, asOfDate);

  if (!hasTimeline && !showUnscheduled) return <EmptyState title="尚无可绘制的计划" detail="工作项生成计划后，这里会展示需求进展。" />;
  return (
    <div className="requirement-gantt">
      <div className="requirement-gantt-toolbar">
        <div className="requirement-gantt-toolbar-main">
          {showStatusFilters && <div className="work-status-filters" aria-label="按工作项状态筛选">
            <Button variant="secondary" size="small" type="button" className={statusFilter === "all" ? "is-active" : ""} aria-pressed={statusFilter === "all"} onClick={() => setStatusFilter("all")}>全部 <b>{items.length}</b></Button>
            {statusFilters.filter((filter) => filter.value !== "cancelled" || statusCounts.cancelled).map((filter) => {
              const count = statusCounts[filter.value] || 0;
              return <Button variant="secondary" size="small"
                type="button"
                key={filter.value}
                className={`filter-${statusClass(filter.value)}${statusFilter === filter.value ? " is-active" : ""}`}
                aria-pressed={statusFilter === filter.value}
                disabled={!count}
                onClick={() => setStatusFilter(filter.value)}
              >
                <WorkStatusIcon status={filter.value} />
                {filter.label} <b>{count}</b>
              </Button>;
            })}
          </div>}
          <GanttLegend />
        </div>
        <div className="gantt-toolbar-actions">
          <GanttNavigation navigation={navigation} />
        </div>
      </div>
      <div className="requirement-gantt-scroll gantt-navigation-surface" ref={attachScroll} tabIndex={0} aria-label="工作项甘特时间轴，可左右拖动浏览">
        <div
          className={`requirement-gantt-grid${milestoneItems.length ? ' has-milestone-rail' : ''}${inlineActions ? " has-inline-actions" : ""}${!visibleItems.length ? " is-empty" : ""}`}
          style={{
            '--row-label': `${labelWidth}px`,
            width: fixedColumnsWidth + timelineWidth,
            gridTemplateColumns: `${labelWidth}px ${timelineWidth}px${gapWidth ? ` ${gapWidth}px` : ""}${actionWidth ? ` ${actionWidth}px` : ""}`,
          } as CSSProperties}
          role="table"
          aria-label={ariaLabel}
        >
          <div data-gantt-fixed className="requirement-gantt-corner sticky-left" role="columnheader">
            <strong>{itemLabel}</strong>
            <span>
              {visibleItems.length === items.length ? `${items.length}项` : `${visibleItems.length}/${items.length}项`}
              {visibleUnassignedCount > 0 && <em> · {visibleUnassignedCount}项未分配</em>}
            </span>
          </div>
          <div className="gantt-axis-header"><GanttScale dates={dates} zoom={zoom} cellWidth={cellWidth} todayOffset={todayOffset} todayVisible={todayVisible} className="requirement-gantt-scale" />
            {milestoneItems.length > 0 && <GanttMilestoneRail items={milestoneItems} dates={dates} cellWidth={cellWidth} asOfDate={asOfDate} selection={milestoneSelection} />}
          </div>
          {gapWidth > 0 && <div data-gantt-fixed className="requirement-gantt-gap-head sticky-right" style={{ right: actionWidth }} role="columnheader">偏差</div>}
          {actionWidth > 0 && <div data-gantt-fixed className="requirement-gantt-action-head sticky-right" role="columnheader">操作</div>}
          {visibleItems.map((item) => {
            const gap = workItemDisplayGap(item, asOfDate);
            const observedEnd = gap.observedEnd;
            const actual = workItemActualRange(item, asOfDate);
            const parts = workProgressParts(item);
            const editable = Boolean(onUpdateProgress && canUpdateProgress?.(item));
            const progressLabel = `${statusLabel(item.status)}，实际进度${item.progress}%，${editable ? '点击更新进度' : '只读'}`;
            const tooltipProps = tooltip.bind(<WorkItemTimelinePopover item={item} updates={updates} asOfDate={asOfDate} executionStatus={executionStatus} forecast={forecasts.get(item.id)} />);
            return <div className={`requirement-gantt-row${milestoneSelection.related(item.id) ? ' is-milestone-related' : ''}${item.id === targetItemId ? " is-target" : ""}`} data-work-item-id={item.id} data-status={item.status} role="row" key={item.id}>
              <div className={`requirement-gantt-item item-status-${statusClass(item.status)}${item.ownerId ? "" : " is-unassigned"} sticky-left`} role="rowheader">
                <div>
                  {onItemClick
                    ? <button type="button" className="requirement-gantt-item-link" onClick={() => onItemClick(item)} title={item.title}>{item.title}</button>
                    : <strong>{item.title}</strong>}
                  <span className="requirement-gantt-item-meta">
                    {renderItemMeta ? renderItemMeta(item) : item.ownerId
                      ? <small>{item.assigneeNames?.join("、") || item.ownerName}</small>
                      : <small className="work-item-owner-warning"><CircleAlert size={11} />未设置负责人{item.collaborators?.length ? ` · ${item.collaborators.length}人协作` : ""}</small>}
                  </span>
                  {inlineActions && renderActions?.(item)}
                </div>
              </div>
              <div className={`requirement-gantt-track unified-gantt-track gantt-split-track gantt-status-${statusClass(item.status)}`} style={trackStyle} role="cell">
                <GanttMilestoneCuts items={milestoneItems.filter(m => !m.requirementId || m.requirementId === item.requirementId)} dates={dates} cellWidth={cellWidth} asOfDate={asOfDate} selection={milestoneSelection} />
                <GanttDateTracks
                  plannedStart={item.plannedStart}
                  plannedEnd={item.plannedEnd}
                  actualStart={actual.start}
                  actualEnd={actual.end}
                  status={item.status}
                  progress={item.progress}
                  dates={dates}
                  cellWidth={cellWidth}
                  fillProgress={item.status === 'cancelled' ? undefined : item.progress}
                  showProgress={false}
                  progressAriaLabel={progressLabel}
                  interactionProps={tooltipProps}
                  scheduleComplete={Boolean(item.plannedStart && item.plannedEnd)}
                  showScheduleHint={showUnscheduled}
                  forecast={forecasts.get(item.id)}
                />
                {!!parts.length && <GanttProgressEnd start={actual.start} end={actual.end} asOfDate={asOfDate} dates={dates} cellWidth={cellWidth} {...tooltipProps}>
                  {editable ? <button type="button" className="gantt-progress-button" aria-label={progressLabel} onClick={() => { tooltip.close(); onUpdateProgress?.(item); }}><GanttProgressText parts={parts}/></button> : <GanttProgressText parts={parts}/>}
                </GanttProgressEnd>}
                {todayVisible && <i className="gantt-today-line" style={{ left: (todayOffset + 1) * cellWidth }} title={`截至 ${asOfDate}`} />}
              </div>
              {gapWidth > 0 && <div className="requirement-gap-summary sticky-right" style={{ right: actionWidth }} role="cell">
                {item.status === "cancelled" ? <span>已取消</span> : !item.plannedStart || !item.plannedEnd ? <span>待排期</span> : item.actualStart && !observedEnd ? <span>实际日期不完整</span> : item.actualStart ? <><strong className={gap.finishVariance > 0 ? "gap-late" : gap.finishVariance < 0 ? "gap-early" : ""}>{gap.finishVariance > 0 ? `延期 +${gap.finishVariance}工作日` : gap.finishVariance < 0 ? `${item.status === "completed" ? "提前" : "距截止"} ${Math.abs(gap.finishVariance)}工作日` : "按期"}</strong><small>耗时 {gap.durationVariance > 0 ? "+" : ""}{gap.durationVariance}工作日</small></> : <span>未开始</span>}
              </div>}
              {actionWidth > 0 && <div className="requirement-gantt-actions sticky-right" role="cell">{renderActions?.(item)}</div>}
            </div>;
          })}
          {!visibleItems.length && <div className="requirement-gantt-filter-empty"><span>{emptyState?.message || "当前状态下没有工作项"}</span>{(emptyState?.onAction || statusFilter !== "all") && <Button variant="secondary" type="button" onClick={emptyState?.onAction || (() => setStatusFilter("all"))}>{emptyState?.actionLabel || "查看全部"}</Button>}</div>}
        </div>
      </div>
      <GanttScrollbar navigation={navigation} />
      {tooltip.tooltip}
      {milestoneSelection.details}
    </div>
  );
});
