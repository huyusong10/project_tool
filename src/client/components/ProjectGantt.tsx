import { useMemo, useRef, useState, type CSSProperties, type HTMLAttributes } from "react";
import {
  addBusinessDays,
  eachDayOfInterval,
  format,
  isWeekend,
  isValid,
  parseISO,
  startOfDay,
} from "date-fns";
import { CircleAlert, LocateFixed, RotateCcw, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { priorityLabels, requirementStatusLabels, riskLabels } from "../../shared/domain";
import type { Requirement } from "../types";
import { EmptyState } from "./Modal";
import { useGanttTooltip } from "./GanttTooltip";

type Zoom = "day" | "week" | "month";
type RequirementSort = "deadline" | "priority" | "risk" | "progress" | "updated";

const zoomOptions: Record<Zoom, { label: string; cellWidth: number; padding: number; minimumDays: number }> = {
  day: { label: "日", cellWidth: 40, padding: 3, minimumDays: 21 },
  week: { label: "周", cellWidth: 15, padding: 7, minimumDays: 56 },
  month: { label: "月", cellWidth: 6, padding: 15, minimumDays: 180 },
};
const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];
const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const riskOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };

function compareDeadline(left: Requirement, right: Requirement) {
  if (!left.plannedEnd && !right.plannedEnd) return 0;
  if (!left.plannedEnd) return 1;
  if (!right.plannedEnd) return -1;
  return left.plannedEnd.localeCompare(right.plannedEnd);
}

function compareRequirementIdentity(left: Requirement, right: Requirement) {
  const leftNumber = /-(\d+)(?=\D|$)/.exec(left.title)?.[1];
  const rightNumber = /-(\d+)(?=\D|$)/.exec(right.title)?.[1];
  if (leftNumber && rightNumber) {
    const numberResult = Number(leftNumber) - Number(rightNumber);
    if (numberResult !== 0) return numberResult;
  }
  return left.title.localeCompare(right.title, "zh-CN");
}

function compareRequirements(left: Requirement, right: Requirement, sort: RequirementSort) {
  const leftClosed = left.status === "completed" || left.status === "cancelled";
  const rightClosed = right.status === "completed" || right.status === "cancelled";
  if (leftClosed !== rightClosed) return leftClosed ? 1 : -1;
  let result = 0;
  if (sort === "priority") result = (priorityOrder[left.priority] ?? 99) - (priorityOrder[right.priority] ?? 99);
  else if (sort === "risk") result = (riskOrder[left.highRisk ? "high" : left.riskLevel] ?? 99) - (riskOrder[right.highRisk ? "high" : right.riskLevel] ?? 99);
  else if (sort === "progress") result = left.progress - right.progress;
  else if (sort === "updated") result = right.updatedAt.localeCompare(left.updatedAt);
  else result = compareDeadline(left, right);
  if (result !== 0) return result;
  const deadlineResult = compareDeadline(left, right);
  if (deadlineResult !== 0) return deadlineResult;
  const priorityResult = (priorityOrder[left.priority] ?? 99) - (priorityOrder[right.priority] ?? 99);
  return priorityResult || compareRequirementIdentity(left, right);
}

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

function isClosedRequirement(requirement: Requirement) {
  return requirement.status === "completed" || requirement.status === "cancelled";
}

function activeRiskClass(requirement: Requirement) {
  if (isClosedRequirement(requirement) || !requirement.riskEvaluated) return "";
  return ` gantt-risk-${requirement.riskLevel}`;
}

function businessDateIndex(date: Date, dates: Date[], edge: "start" | "end") {
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

function RequirementPopover({ requirement }: { requirement: Requirement }) {
  const updates = requirement.recentProgressUpdates || [];
  const risk = riskLabels[requirement.riskLevel as keyof typeof riskLabels] || requirement.riskLevel;
  const closed = isClosedRequirement(requirement);
  return <>
    <header className="gantt-popover-header">
      <div><strong>{requirement.title}</strong><span>{requirement.projectName}</span></div>
      <span className={`priority-badge priority-${requirement.priority.toLowerCase()}`}>{priorityLabels[requirement.priority as keyof typeof priorityLabels] || requirement.priority}</span>
    </header>
    <div className="gantt-popover-badges">
      <span className={`status-pill status-${requirement.status}`}>{statusLabel(requirement.status)}</span>
      <span>{requirement.progress}%</span>
      {!closed && (requirement.riskEvaluated
        ? <span className={`risk-badge risk-${requirement.riskLevel}`}>{risk}</span>
        : <span className="risk-badge risk-pending">待评估</span>)}
      {Boolean(requirement.issueSummary?.active) && <span className={requirement.issueSummary?.overdue ? "gantt-issue-summary overdue" : "gantt-issue-summary"}>问题 {requirement.issueSummary?.active}{requirement.issueSummary?.overdue ? ` · 逾期 ${requirement.issueSummary.overdue}` : ""}</span>}
      {requirement.delayed && <em>延期 +{Math.max(1, requirement.finishVariance)}天</em>}
    </div>
    <dl className="gantt-popover-metrics">
      <div><dt>计划周期</dt><dd>{dateLabel(requirement.plannedStart)} — {dateLabel(requirement.plannedEnd)}</dd></div>
      <div><dt>计划 / 实际 / Gap</dt><dd>{requirement.plannedProgress}% / {requirement.progress}% / {requirement.progressGap}%</dd></div>
      <div><dt>风险判定</dt><dd className={requirement.riskLevel === "high" && requirement.riskEvaluated ? "danger-text" : ""}>{requirement.riskReason}</dd></div>
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

function TimelineBar({
  start,
  end,
  dates,
  cellWidth,
  status,
  progress,
  delayedUntil,
  tooltipProps,
}: {
  start: string | null;
  end: string | null;
  dates: Date[];
  cellWidth: number;
  status: string;
  progress: number;
  delayedUntil?: string | null;
  tooltipProps?: HTMLAttributes<HTMLDivElement>;
}) {
  const startDate = toDate(start);
  const endDate = toDate(end);
  if (!startDate || !endDate) return <span className="gantt-unscheduled">待排期</span>;

  const startIndex = businessDateIndex(startDate, dates, "start");
  const endIndex = businessDateIndex(endDate, dates, "end");
  if (startIndex >= dates.length || endIndex < startIndex) return <span className="gantt-unscheduled">待排期</span>;
  const left = startIndex * cellWidth;
  const width = Math.max(1, endIndex - startIndex + 1) * cellWidth;
  const delayedDate = toDate(delayedUntil);
  const delayedEndIndex = delayedDate ? businessDateIndex(delayedDate, dates, "end") : endIndex;
  const extensionDays = Math.max(0, delayedEndIndex - endIndex);

  return (
    <>
      <div
        className={`gantt-schedule-bar gantt-status-${statusClass(status)}`}
        style={{ left, width }}
        tabIndex={0}
        {...tooltipProps}
      >
        <span className="gantt-progress-fill" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        {width >= 96 && <b>{progress}% · {statusLabel(status)}</b>}
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
  const [zoom, setZoom] = useState<Zoom>("day");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [risk, setRisk] = useState("");
  const [personId, setPersonId] = useState("");
  const [schedule, setSchedule] = useState("");
  const [sort, setSort] = useState<RequirementSort>("deadline");
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
        && (!risk || (requirement.riskEvaluated && requirement.riskLevel === risk))
        && (!personId || requirement.workItems.some((item) => item.assigneeIds?.includes(personId) || item.ownerId === personId))
        && matchesSchedule;
    }).sort((left, right) => compareRequirements(left, right, sort));
  }, [personId, priority, requirements, risk, schedule, search, sort, status]);
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
    });
    const today = new Date();
    const earliest = values.length
      ? new Date(Math.min(...values.map((date) => date.getTime())))
      : today;
    const latest = values.length
      ? new Date(Math.max(...values.map((date) => date.getTime())))
      : today;
    const start = startOfDay(addBusinessDays(earliest, -option.padding));
    let end = startOfDay(addBusinessDays(latest, option.padding));
    let dates = eachDayOfInterval({ start, end }).filter((date) => !isWeekend(date));
    if (dates.length < option.minimumDays) {
      end = startOfDay(addBusinessDays(start, option.minimumDays - 1));
      dates = eachDayOfInterval({ start, end }).filter((date) => !isWeekend(date));
    }
    return { start, end, dates, days: dates.length };
  }, [option.minimumDays, option.padding, projectEnd, projectStart, requirements]);

  const timelineWidth = range.days * option.cellWidth;
  const dates = range.dates;
  const firstMonday = dates.findIndex((date) => date.getDay() === 1);
  const trackStyle = {
    width: timelineWidth,
    "--gantt-cell": `${option.cellWidth}px`,
    "--gantt-week": `${option.cellWidth * 5}px`,
    "--gantt-week-offset": `${Math.max(0, firstMonday) * option.cellWidth}px`,
  } as CSSProperties;
  const today = startOfDay(new Date());
  const todayOffset = businessDateIndex(today, dates, "start");
  const todayVisible = !isWeekend(today) && todayOffset >= 0 && todayOffset < range.days
    && dates[todayOffset]?.getTime() === today.getTime();

  const markerVisible = (date: Date, index: number) => {
    if (zoom === "day") return true;
    if (zoom === "week") return index === 0 || date.getDay() === 1;
    return index === 0 || dates[index - 1]?.getMonth() !== date.getMonth();
  };
  const markerText = (date: Date) => {
    if (zoom === "day") return format(date, "MM/dd");
    if (zoom === "week") return format(date, "MM/dd");
    return format(date, "yyyy/MM");
  };
  const markerWidth = (index: number) => {
    if (zoom === "day") return option.cellWidth;
    const nextIndex = dates.findIndex((date, candidateIndex) => candidateIndex > index && markerVisible(date, candidateIndex));
    return (nextIndex < 0 ? dates.length - index : nextIndex - index) * option.cellWidth;
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
          <span><i className="legend-risk-medium" />中风险</span>
          <span><i className="legend-risk-high" />高风险</span>
          <span className="gantt-axis-note">横轴按工作日显示</span>
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
        <select value={sort} onChange={(event) => setSort(event.target.value as RequirementSort)} aria-label="需求排序">
          <option value="deadline">截止时间 · 临近优先</option>
          <option value="priority">优先级 · 高优先</option>
          <option value="risk">风险 · 高优先</option>
          <option value="progress">进度 · 低优先</option>
          <option value="updated">最近更新 · 新优先</option>
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
              <strong>需求</strong>
              <span>{visibleRequirements.length} 项需求</span>
            </div>
            <div className="gantt-scale" style={trackStyle} role="columnheader">
              {dates.map((date, index) => markerVisible(date, index) && (
                <span
                  className={`gantt-scale-label${date.getDay() === 0 || date.getDay() === 6 ? " weekend" : ""}`}
                  style={{
                    left: index * option.cellWidth,
                    width: markerWidth(index),
                  }}
                  key={date.toISOString()}
                >
                  {markerText(date)}
                </span>
              ))}
              {dates.map((date, index) => (
                <i
                  className={`gantt-scale-tick${date.getDay() === 1 || index === 0 ? " is-major" : ""}`}
                  style={{ left: index * option.cellWidth, width: option.cellWidth }}
                  key={`tick-${date.toISOString()}`}
                >
                  {zoom !== "month" && <span>{zoom === "day" ? `周${weekdayLabels[date.getDay()]}` : format(date, "dd")}</span>}
                </i>
              ))}
              {todayVisible && <i className="gantt-today-line" style={{ left: todayOffset * option.cellWidth + option.cellWidth / 2 }} />}
            </div>
            {visibleRequirements.map((requirement) => {
              const tooltipProps = ganttTooltip.bind(<RequirementPopover requirement={requirement} />);
              return (
                <div className={`gantt-row${requirement.delayed ? " is-delayed" : ""}${activeRiskClass(requirement)}`} role="row" key={requirement.id}>
                  <div className="gantt-sticky-left gantt-requirement-info" role="rowheader">
                    <div className="gantt-requirement-copy">
                      <button className="gantt-requirement-link" onClick={() => navigate(`/requirements/${requirement.id}`)} title={requirement.title}>
                        {requirement.title}
                      </button>
                      <div>
                        <span className={`priority-badge priority-${requirement.priority.toLowerCase()}`}>{priorityLabels[requirement.priority as keyof typeof priorityLabels] || requirement.priority}</span>
                        <span>{statusLabel(requirement.status)}</span>
                        <span>{requirement.progress}%</span>
                        {!isClosedRequirement(requirement) && (requirement.riskEvaluated
                          ? requirement.riskLevel !== "low" && <span className={`gantt-risk-chip ${requirement.riskLevel}`}>{riskLabels[requirement.riskLevel as keyof typeof riskLabels]} · Gap {requirement.progressGap}%</span>
                          : <span className="gantt-risk-chip pending">待评估</span>)}
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
                      dates={dates}
                      cellWidth={option.cellWidth}
                      status={requirement.status}
                      progress={requirement.progress}
                      delayedUntil={requirement.delayed ? requirement.effectiveEnd : null}
                      tooltipProps={tooltipProps}
                    />
                    {todayVisible && <i className="gantt-today-line" style={{ left: todayOffset * option.cellWidth + option.cellWidth / 2 }} />}
                  </div>
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
