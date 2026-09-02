import { useMemo, useRef, useState, type CSSProperties, type HTMLAttributes } from "react";
import {
  addDays,
  differenceInCalendarDays,
  format,
  isValid,
  parseISO,
} from "date-fns";
import { ChevronDown, ChevronRight, CircleAlert, LocateFixed, RotateCcw, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { calculateWorkItemGap, priorityLabels, requirementStatusLabels, riskLabels } from "../../shared/domain";
import type { Requirement, WorkItem } from "../types";
import { EmptyState } from "./Modal";
import { useGanttTooltip } from "./GanttTooltip";

type Zoom = "day" | "week" | "month";

const zoomOptions: Record<Zoom, { label: string; cellWidth: number; padding: number; minimumDays: number }> = {
  day: { label: "日", cellWidth: 34, padding: 3, minimumDays: 21 },
  week: { label: "周", cellWidth: 15, padding: 7, minimumDays: 56 },
  month: { label: "月", cellWidth: 6, padding: 15, minimumDays: 180 },
};

function toDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
}

function dateLabel(value: string | null | undefined) {
  const parsed = toDate(value);
  return parsed ? format(parsed, "yyyy/MM/dd") : "待排期";
}

function statusLabel(status: string) {
  return requirementStatusLabels[status as keyof typeof requirementStatusLabels] || status;
}

function statusClass(status: string) {
  return status.replaceAll("_", "-");
}

function RequirementPopover({ requirement }: { requirement: Requirement }) {
  const updates = requirement.recentProgressUpdates || [];
  const risk = riskLabels[requirement.riskLevel as keyof typeof riskLabels] || requirement.riskLevel;
  return <>
    <header className="gantt-popover-header">
      <div><strong>{requirement.title}</strong><span>{requirement.projectName}</span></div>
      <span className={`priority-badge priority-${requirement.priority.toLowerCase()}`}>{priorityLabels[requirement.priority as keyof typeof priorityLabels] || requirement.priority}</span>
    </header>
    <div className="gantt-popover-badges">
      <span className={`status-pill status-${requirement.status}`}>{statusLabel(requirement.status)}</span>
      <span>{requirement.progress}%</span>
      <span className={`risk-badge risk-${requirement.riskLevel}`}>{risk}</span>
      {Boolean(requirement.issueSummary?.active) && <span className={requirement.issueSummary?.overdue ? "gantt-issue-summary overdue" : "gantt-issue-summary"}>问题 {requirement.issueSummary?.active}{requirement.issueSummary?.overdue ? ` · 逾期 ${requirement.issueSummary.overdue}` : ""}</span>}
      {requirement.delayed && <em>延期 +{Math.max(1, requirement.finishVariance)}天</em>}
    </div>
    <dl className="gantt-popover-metrics">
      <div><dt>计划周期</dt><dd>{dateLabel(requirement.plannedStart)} — {dateLabel(requirement.plannedEnd)}</dd></div>
      <div><dt>计划 / 实际进度</dt><dd>{requirement.plannedProgress}% / {requirement.progress}%</dd></div>
    </dl>
    <div className="gantt-popover-progress"><i style={{ width: `${requirement.plannedProgress}%` }} /><span style={{ width: `${requirement.progress}%` }} /></div>
    <section className="gantt-popover-updates">
      <h4>近期进展</h4>
      {updates.map((update) => <article key={update.id}>
        <time>{new Date(update.createdAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</time>
        <div>{update.workItemTitle && <b>{update.workItemTitle}</b>}<p>{update.content}</p></div>
        <span>{update.percent}%</span>
      </article>)}
      {!updates.length && <p className="gantt-popover-empty">暂无进展记录</p>}
    </section>
  </>;
}

function WorkItemPopover({ item, updates }: { item: WorkItem; updates: Requirement["recentProgressUpdates"] }) {
  const gap = calculateWorkItemGap(item);
  const recent = (updates || []).filter((update) => update.workItemId === item.id).slice(0, 2);
  return <>
    <header className="gantt-popover-header"><div><strong>{item.title}</strong><span>{item.assigneeNames?.join("、") || item.ownerName || "未分配"}</span></div><span className={`status-pill status-${item.status}`}>{statusLabel(item.status)}</span></header>
    <dl className="gantt-popover-metrics">
      <div><dt>计划</dt><dd>{dateLabel(item.plannedStart)} — {dateLabel(item.plannedEnd)}</dd></div>
      <div><dt>实际</dt><dd>{dateLabel(item.actualStart)} — {dateLabel(item.actualEnd || (item.actualStart ? gap.observedEnd : null))}</dd></div>
      <div><dt>完成 / 耗时偏差</dt><dd className={gap.finishVariance > 0 || gap.durationVariance > 0 ? "danger-text" : ""}>{gap.finishVariance > 0 ? "+" : ""}{gap.finishVariance}天 / {gap.durationVariance > 0 ? "+" : ""}{gap.durationVariance}天</dd></div>
    </dl>
    {item.blockedReason && <p className="gantt-popover-blocked">阻塞：{item.blockedReason}</p>}
    {recent.length > 0 && <section className="gantt-popover-updates"><h4>相关进展</h4>{recent.map((update) => <article key={update.id}><time>{new Date(update.createdAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</time><div><p>{update.content}</p></div><span>{update.percent}%</span></article>)}</section>}
  </>;
}

function TimelineBar({
  start,
  end,
  rangeStart,
  cellWidth,
  status,
  progress,
  delayedUntil,
  tooltipProps,
  compact = false,
}: {
  start: string | null;
  end: string | null;
  rangeStart: Date;
  cellWidth: number;
  status: string;
  progress: number;
  delayedUntil?: string | null;
  tooltipProps?: HTMLAttributes<HTMLDivElement>;
  compact?: boolean;
}) {
  const startDate = toDate(start);
  const endDate = toDate(end);
  if (!startDate || !endDate) return <span className="gantt-unscheduled">待排期</span>;

  const left = differenceInCalendarDays(startDate, rangeStart) * cellWidth;
  const days = Math.max(1, differenceInCalendarDays(endDate, startDate) + 1);
  const width = days * cellWidth;
  const delayedDate = toDate(delayedUntil);
  const extensionDays = delayedDate && delayedDate > endDate
    ? differenceInCalendarDays(delayedDate, endDate)
    : 0;

  return (
    <>
      <div
        className={`gantt-schedule-bar gantt-status-${statusClass(status)}${compact ? " compact" : ""}`}
        style={{ left, width }}
        tabIndex={0}
        {...tooltipProps}
      >
        <span className="gantt-progress-fill" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        {!compact && width >= 96 && <b>{progress}% · {statusLabel(status)}</b>}
      </div>
      {extensionDays > 0 && (
        <div
          className="gantt-delay-extension"
          style={{ left: left + width, width: extensionDays * cellWidth }}
          {...tooltipProps}
        />
      )}
    </>
  );
}

function WorkItemInfo({ item }: { item: WorkItem }) {
  return (
    <div className="gantt-item-info gantt-work-info">
      <span className={`status-dot dot-${item.status}`} />
      <div>
        <strong title={item.title}>{item.title}</strong>
        <small>{item.assigneeNames?.join("、") || item.ownerName || "未分配"} · {statusLabel(item.status)}</small>
      </div>
    </div>
  );
}

export function ProjectGantt({
  requirements,
  projectStart,
  projectEnd,
}: {
  requirements: Requirement[];
  projectStart?: string | null;
  projectEnd?: string | null;
}) {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const ganttTooltip = useGanttTooltip();
  const [zoom, setZoom] = useState<Zoom>("week");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [risk, setRisk] = useState("");
  const [personId, setPersonId] = useState("");
  const [schedule, setSchedule] = useState("");
  const option = zoomOptions[zoom];

  const people = useMemo(() => {
    const owners = new Map<string, string>();
    requirements.forEach((requirement) => requirement.workItems.forEach((item) => {
      if (item.assigneeIds?.length && item.assigneeNames?.length) {
        item.assigneeIds.forEach((id, index) => owners.set(id, item.assigneeNames[index]));
      } else if (item.ownerId && item.ownerName) owners.set(item.ownerId, item.ownerName);
    }));
    return [...owners.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [requirements]);
  const visibleRequirements = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return requirements.filter((requirement) => {
      const matchesSearch = !keyword
        || requirement.title.toLowerCase().includes(keyword)
        || requirement.workItems.some((item) => item.title.toLowerCase().includes(keyword));
      const matchesSchedule = !schedule
        || (schedule === "delayed" && requirement.delayed)
        || (schedule === "on_track" && Boolean(requirement.plannedStart && requirement.plannedEnd) && !requirement.delayed)
        || (schedule === "unplanned" && (!requirement.plannedStart || !requirement.plannedEnd));
      return matchesSearch
        && (!status || requirement.status === status)
        && (!priority || requirement.priority === priority)
        && (!risk || requirement.riskLevel === risk)
        && (!personId || requirement.workItems.some((item) => item.assigneeIds?.includes(personId) || item.ownerId === personId))
        && matchesSchedule;
    });
  }, [personId, priority, requirements, risk, schedule, search, status]);
  const hasFilters = Boolean(search || status || priority || risk || personId || schedule);
  const resetFilters = () => {
    setSearch("");
    setStatus("");
    setPriority("");
    setRisk("");
    setPersonId("");
    setSchedule("");
  };

  const range = useMemo(() => {
    const values: Date[] = [];
    const append = (value: string | null | undefined) => {
      const parsed = toDate(value);
      if (parsed) values.push(parsed);
    };
    append(projectStart);
    append(projectEnd);
    requirements.forEach((requirement) => {
      append(requirement.plannedStart);
      append(requirement.plannedEnd);
      append(requirement.effectiveEnd);
      requirement.workItems.forEach((item) => {
        append(item.plannedStart);
        append(item.plannedEnd);
        append(item.actualStart);
        append(item.actualEnd);
      });
    });
    const today = new Date();
    const earliest = values.length
      ? new Date(Math.min(...values.map((date) => date.getTime())))
      : today;
    const latest = values.length
      ? new Date(Math.max(...values.map((date) => date.getTime())))
      : today;
    const start = addDays(earliest, -option.padding);
    let end = addDays(latest, option.padding);
    const currentDays = differenceInCalendarDays(end, start) + 1;
    if (currentDays < option.minimumDays) end = addDays(start, option.minimumDays - 1);
    return { start, end, days: differenceInCalendarDays(end, start) + 1 };
  }, [option.minimumDays, option.padding, projectEnd, projectStart, requirements]);

  const timelineWidth = range.days * option.cellWidth;
  const dates = useMemo(
    () => Array.from({ length: range.days }, (_, index) => addDays(range.start, index)),
    [range.days, range.start],
  );
  const firstSaturday = dates.findIndex((date) => date.getDay() === 6);
  const trackStyle = {
    width: timelineWidth,
    "--gantt-cell": `${option.cellWidth}px`,
    "--gantt-week": `${option.cellWidth * 7}px`,
    "--gantt-weekend-offset": `${Math.max(0, firstSaturday) * option.cellWidth}px`,
  } as CSSProperties;
  const todayOffset = differenceInCalendarDays(new Date(), range.start);
  const todayVisible = todayOffset >= 0 && todayOffset < range.days;

  const markerVisible = (date: Date, index: number) => {
    if (zoom === "day") return true;
    if (zoom === "week") return index === 0 || date.getDay() === 1;
    return index === 0 || date.getDate() === 1;
  };
  const markerText = (date: Date) => {
    if (zoom === "day") return format(date, "dd");
    if (zoom === "week") return format(date, "MM/dd");
    return format(date, "yyyy/MM");
  };

  const toggleExpanded = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const scrollToToday = () => {
    if (!todayVisible || !scrollRef.current) return;
    const leftColumn = scrollRef.current
      .querySelector<HTMLElement>(".gantt-corner")
      ?.getBoundingClientRect().width ?? 360;
    const visibleTimeline = Math.max(300, scrollRef.current.clientWidth - leftColumn);
    scrollRef.current.scrollTo({
      left: Math.max(0, leftColumn + todayOffset * option.cellWidth - visibleTimeline / 2),
      behavior: "smooth",
    });
  };

  return (
    <section className="project-gantt-panel">
      <header className="project-gantt-toolbar">
        <div className="gantt-legend" aria-label="甘特图图例">
          <span><i className="legend-not-started" />未开始</span>
          <span><i className="legend-in-progress" />进行中</span>
          <span><i className="legend-blocked" />阻塞</span>
          <span><i className="legend-completed" />已完成</span>
          <span><i className="legend-delayed" />延期</span>
        </div>
        <div className="gantt-toolbar-actions">
          <button className="ghost-button" onClick={scrollToToday} disabled={!todayVisible} title={todayVisible ? "定位到今天" : "今天不在当前项目时间范围内"}>
            <LocateFixed size={15} /> 今天
          </button>
          <div className="view-tabs" aria-label="时间粒度">
            {(Object.keys(zoomOptions) as Zoom[]).map((key) => (
              <button key={key} className={zoom === key ? "active" : ""} onClick={() => setZoom(key)}>
                {zoomOptions[key].label}
              </button>
            ))}
          </div>
        </div>
      </header>
      <div className="gantt-filter-bar" aria-label="项目进展筛选">
        <label className="gantt-filter-search">
          <Search size={16} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索需求或工作项" aria-label="搜索需求或工作项" />
        </label>
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="按状态筛选">
          <option value="">全部状态</option>
          {Object.entries(requirementStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
        <select value={priority} onChange={(event) => setPriority(event.target.value)} aria-label="按优先级筛选">
          <option value="">全部优先级</option>
          {Object.entries(priorityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
        <select value={risk} onChange={(event) => setRisk(event.target.value)} aria-label="按风险筛选">
          <option value="">全部风险</option>
          {Object.entries(riskLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
        <select value={personId} onChange={(event) => setPersonId(event.target.value)} aria-label="按人员筛选">
          <option value="">全部人员</option>
          {people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}
        </select>
        <select value={schedule} onChange={(event) => setSchedule(event.target.value)} aria-label="按排期筛选">
          <option value="">全部排期</option>
          <option value="delayed">仅看延期</option>
          <option value="on_track">计划正常</option>
          <option value="unplanned">待排期</option>
        </select>
        <span className="gantt-filter-result">{visibleRequirements.length} / {requirements.length} 项</span>
        <button className="gantt-reset-button" onClick={resetFilters} disabled={!hasFilters} title="清除全部筛选">
          <RotateCcw size={15} /> 清除
        </button>
      </div>
      {!visibleRequirements.length ? (
        <EmptyState title="暂无可展示需求" detail="调整筛选条件，或新建需求后查看项目排期。" />
      ) : (
        <div className="project-gantt-scroll" ref={scrollRef}>
          <div className="project-gantt-grid" style={{ width: `calc(var(--project-gantt-label-width) + ${timelineWidth}px)` }} role="table" aria-label="项目进展甘特图">
            <div className="gantt-corner gantt-sticky-left" role="columnheader">
              <strong>需求 / 工作项</strong>
              <span>{visibleRequirements.length} 项需求</span>
            </div>
            <div className="gantt-scale" style={trackStyle} role="columnheader">
              {dates.map((date, index) => markerVisible(date, index) && (
                <span
                  className={`gantt-scale-label${date.getDay() === 0 || date.getDay() === 6 ? " weekend" : ""}`}
                  style={{
                    left: index * option.cellWidth,
                    width: zoom === "month"
                      ? option.cellWidth * 30
                      : zoom === "week"
                        ? option.cellWidth * 7
                        : option.cellWidth,
                  }}
                  key={date.toISOString()}
                >
                  {markerText(date)}
                </span>
              ))}
              {todayVisible && <i className="gantt-today-line" style={{ left: todayOffset * option.cellWidth + option.cellWidth / 2 }}><span>今天</span></i>}
            </div>
            {visibleRequirements.map((requirement) => {
              const isExpanded = expanded.has(requirement.id);
              const tooltipProps = ganttTooltip.bind(<RequirementPopover requirement={requirement} />);
              return (
                <div className="gantt-row-group" key={requirement.id} role="rowgroup">
                  <div className={`gantt-row${requirement.delayed ? " is-delayed" : ""}`} role="row">
                    <div className="gantt-sticky-left gantt-requirement-info" role="rowheader">
                      <button
                        className="gantt-expand-button"
                        onClick={() => toggleExpanded(requirement.id)}
                        aria-label={`${isExpanded ? "收起" : "展开"} ${requirement.title} 工作项`}
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
                      </button>
                      <div className="gantt-requirement-copy">
                        <button className="gantt-requirement-link" onClick={() => navigate(`/requirements/${requirement.id}`)} title={requirement.title}>
                          {requirement.title}
                        </button>
                        <div>
                          <span className={`priority-badge priority-${requirement.priority.toLowerCase()}`}>{priorityLabels[requirement.priority as keyof typeof priorityLabels] || requirement.priority}</span>
                          <span>{statusLabel(requirement.status)}</span>
                          <span>{requirement.progress}%</span>
                          {requirement.delayed && <em>延期 {Math.max(1, requirement.finishVariance)} 天</em>}
                          {Boolean(requirement.issueSummary?.active) && (
                            <button
                              className={requirement.issueSummary?.overdue ? "gantt-issue-link overdue" : "gantt-issue-link"}
                              onClick={() => navigate(`/issues?requirementId=${encodeURIComponent(requirement.id)}&active=true`)}
                              title={`查看 ${requirement.issueSummary?.active} 条未闭环问题`}
                            >
                              <CircleAlert size={12} />问题 {requirement.issueSummary?.active}
                              {Boolean(requirement.issueSummary?.overdue) && <span>逾期 {requirement.issueSummary?.overdue}</span>}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="gantt-track" style={trackStyle} role="cell">
                      <TimelineBar
                        start={requirement.plannedStart}
                        end={requirement.plannedEnd}
                        rangeStart={range.start}
                        cellWidth={option.cellWidth}
                        status={requirement.status}
                        progress={requirement.progress}
                        delayedUntil={requirement.delayed ? requirement.effectiveEnd : null}
                        tooltipProps={tooltipProps}
                      />
                      {todayVisible && <i className="gantt-today-line" style={{ left: todayOffset * option.cellWidth + option.cellWidth / 2 }} />}
                    </div>
                  </div>
                  {isExpanded && requirement.workItems.map((item) => {
                    const itemProgress = item.status === "completed" ? 100 : 0;
                    const itemTooltipProps = ganttTooltip.bind(<WorkItemPopover item={item} updates={requirement.recentProgressUpdates} />);
                    return (
                      <div className="gantt-row gantt-work-row" key={item.id} role="row">
                        <div className="gantt-sticky-left" role="rowheader"><WorkItemInfo item={item} /></div>
                        <div className="gantt-track" style={trackStyle} role="cell">
                          <TimelineBar
                            start={item.plannedStart}
                            end={item.plannedEnd}
                            rangeStart={range.start}
                            cellWidth={option.cellWidth}
                            status={item.status}
                            progress={itemProgress}
                            tooltipProps={itemTooltipProps}
                            compact
                          />
                          {todayVisible && <i className="gantt-today-line" style={{ left: todayOffset * option.cellWidth + option.cellWidth / 2 }} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {ganttTooltip.tooltip}
    </section>
  );
}
