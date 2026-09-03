import { useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { CircleAlert, LocateFixed, RotateCcw, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { priorityLabels, requirementStatusLabels, riskLabels, signedProgressVariance } from "../../shared/domain";
import type { Requirement } from "../types";
import { EmptyState } from "./Modal";
import { useGanttTooltip } from "./GanttTooltip";
import {
  buildBusinessDayTimeline,
  GanttMilestoneMarker,
  GanttProgressComparison,
  GanttScale,
  ganttTodayPosition,
  ganttTrackStyle,
  ganttZoomOptions,
  toGanttDate,
  type GanttZoom,
} from "./GanttTimeline";

type RequirementSort = "deadline" | "priority" | "risk" | "progress" | "updated";
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
  return toGanttDate(value);
}

function dateLabel(value: string | null | undefined, empty = "待排期") {
  const parsed = toDate(value);
  return parsed ? format(parsed, "yyyy/MM/dd") : empty;
}

function statusLabel(status: string) {
  return requirementStatusLabels[status as keyof typeof requirementStatusLabels] || status;
}

function isClosedRequirement(requirement: Requirement) {
  return requirement.status === "completed" || requirement.status === "cancelled";
}

function progressVariance(requirement: Requirement) {
  return signedProgressVariance(requirement.progress, requirement.plannedProgress);
}

function progressVarianceText(requirement: Requirement) {
  const variance = progressVariance(requirement);
  if (variance < 0) return `落后${Math.abs(variance)}%`;
  if (variance > 0) return `领先${variance}%`;
  return "进度一致";
}

function activeRiskClass(requirement: Requirement) {
  if (isClosedRequirement(requirement) || !requirement.riskEvaluated) return "";
  return ` gantt-risk-${requirement.riskLevel}`;
}

function requirementActualRange(requirement: Requirement) {
  const starts = requirement.workItems.map((item) => item.actualStart).filter(Boolean) as string[];
  if (!starts.length) return { start: null, end: null };
  const start = starts.sort()[0];
  const completedEnds = requirement.workItems.map((item) => item.actualEnd).filter(Boolean) as string[];
  const end = requirement.status === "completed" || requirement.status === "cancelled"
    ? completedEnds.sort().at(-1) || start
    : format(new Date(), "yyyy-MM-dd");
  return { start, end };
}

function RequirementPopover({ requirement }: { requirement: Requirement }) {
  const updates = requirement.recentProgressUpdates || [];
  const risk = riskLabels[requirement.riskLevel as keyof typeof riskLabels] || requirement.riskLevel;
  const closed = isClosedRequirement(requirement);
  const actual = requirementActualRange(requirement);
  const variance = progressVariance(requirement);
  return <>
    <header className="gantt-popover-header">
      <div><strong>{requirement.title}</strong><span>{requirement.projectName}</span></div>
      <span className={`priority-badge priority-${requirement.priority.toLowerCase()}`}>{priorityLabels[requirement.priority as keyof typeof priorityLabels] || requirement.priority}</span>
    </header>
    <div className="gantt-popover-badges">
      <span className={`status-pill status-${requirement.status}`}>{statusLabel(requirement.status)}</span>
      <span>实际进度 {requirement.progress}%</span>
      {!closed && (requirement.riskEvaluated
        ? <span className={`risk-badge risk-${requirement.riskLevel}`}>{risk}</span>
        : <span className="risk-badge risk-pending">待评估</span>)}
      {Boolean(requirement.issueSummary?.active) && <span className={requirement.issueSummary?.overdue ? "gantt-issue-summary overdue" : "gantt-issue-summary"}>问题 {requirement.issueSummary?.active}{requirement.issueSummary?.overdue ? ` · 逾期 ${requirement.issueSummary.overdue}` : ""}</span>}
      {requirement.delayed && <em>延期 +{Math.max(1, requirement.finishVariance)}天</em>}
    </div>
    <dl className="gantt-popover-metrics">
      <div><dt>计划周期</dt><dd>{dateLabel(requirement.plannedStart)} — {dateLabel(requirement.plannedEnd)}</dd></div>
      <div><dt>实际周期</dt><dd>{dateLabel(actual.start, "未开始")} — {dateLabel(actual.end, "未完成")}</dd></div>
      <div><dt>截至今日应达</dt><dd>{requirement.plannedProgress}%</dd></div>
      <div><dt>当前实际进度</dt><dd>{requirement.progress}%</dd></div>
      <div><dt>进度偏差</dt><dd className={variance < 0 ? "danger-text" : variance > 0 ? "safe-text" : ""}>{progressVarianceText(requirement)}</dd></div>
      <div><dt>风险判定</dt><dd className={requirement.riskLevel === "high" && requirement.riskEvaluated ? "danger-text" : ""}>{requirement.riskReason}</dd></div>
    </dl>
    <div className="gantt-popover-progress-compare" aria-label={`实际进度${requirement.progress}%，截至今日应达${requirement.plannedProgress}%`}>
      <div><span>实际</span><i><b style={{ width: `${requirement.progress}%` }} /></i><strong>{requirement.progress}%</strong></div>
      <div><span>应达</span><i><b className="is-expected" style={{ width: `${requirement.plannedProgress}%` }} /></i><strong>{requirement.plannedProgress}%</strong></div>
    </div>
    <section className="gantt-popover-updates">
      <h4>近期进展{updates.length ? `（${updates.length}）` : ""}</h4>
      {updates.map((update) => <article key={update.id}>
        <time>{new Date(update.createdAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</time>
        <div>{update.workItemTitle && <b>{update.workItemTitle}</b>}<p>{update.content}</p></div>
        <span>{update.percent}%</span>
      </article>)}
      {!updates.length && <p className="gantt-popover-empty">暂无进展记录</p>}
    </section>
  </>;
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
  const [zoom, setZoom] = useState<GanttZoom>("day");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [risk, setRisk] = useState("");
  const [personId, setPersonId] = useState("");
  const [schedule, setSchedule] = useState("");
  const [sort, setSort] = useState<RequirementSort>("deadline");
  const option = ganttZoomOptions[zoom];

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
    const values: Array<string | null | undefined> = [projectStart, projectEnd];
    requirements.forEach((requirement) => {
      const actual = requirementActualRange(requirement);
      values.push(requirement.plannedStart, requirement.plannedEnd, requirement.effectiveEnd, actual.start, actual.end);
    });
    return buildBusinessDayTimeline(values, zoom);
  }, [projectEnd, projectStart, requirements, zoom]);

  const timelineWidth = range.days * option.cellWidth;
  const dates = range.dates;
  const trackStyle = ganttTrackStyle(dates, option.cellWidth);
  const { offset: todayOffset, visible: todayVisible } = ganttTodayPosition(dates);

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
          <span><i className="legend-plan-pill" />计划</span>
          <span><i className="legend-actual" />实际</span>
          <span><i className="legend-expected" />应达</span>
          <span><i className="legend-behind" />落后差值</span>
          <span><i className="legend-ahead" />领先差值</span>
          <span><i className="legend-milestone" />里程碑</span>
          <span><i className="legend-risk-medium" />中风险</span>
          <span><i className="legend-risk-high" />高风险</span>
          <span className="gantt-axis-note">横轴按工作日显示</span>
        </div>
        <div className="gantt-toolbar-actions">
          <button className="ghost-button" onClick={scrollToToday} disabled={!todayVisible} title={todayVisible ? "定位到今天" : "今天不在当前项目时间范围内"}>
            <LocateFixed size={15} /> 今天
          </button>
          <div className="view-tabs" aria-label="时间粒度">
            {(Object.keys(ganttZoomOptions) as GanttZoom[]).map((key) => (
              <button key={key} className={zoom === key ? "active" : ""} onClick={() => setZoom(key)}>
                {ganttZoomOptions[key].label}
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
        <select className="gantt-sort-select" value={sort} onChange={(event) => setSort(event.target.value as RequirementSort)} aria-label="需求排序">
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
            <GanttScale dates={dates} zoom={zoom} cellWidth={option.cellWidth} todayOffset={todayOffset} todayVisible={todayVisible} />
            {visibleRequirements.map((requirement) => {
              const tooltipProps = ganttTooltip.bind(<RequirementPopover requirement={requirement} />);
              const variance = progressVariance(requirement);
              const risk = requirement.riskLevel !== "low" ? riskLabels[requirement.riskLevel as keyof typeof riskLabels] : "";
              const varianceLabel = variance < 0 ? `落后${Math.abs(variance)}%` : variance > 0 ? `领先${variance}%` : "";
              const healthLabel = [risk, varianceLabel].filter(Boolean).join(" · ");
              const healthClass = requirement.riskLevel !== "low" ? requirement.riskLevel : variance > 0 ? "ahead" : "";
              return (
                <div className={`gantt-row${requirement.delayed ? " is-delayed" : ""}${activeRiskClass(requirement)}`} role="row" key={requirement.id}>
                  <div className="gantt-sticky-left gantt-requirement-info" role="rowheader">
                    <div className="gantt-requirement-copy">
                      <button className="gantt-requirement-link" onClick={() => navigate(`/requirements/${requirement.id}`)} title={requirement.title}>
                        {requirement.title}
                      </button>
                      <div>
                        <span className={`priority-badge priority-${requirement.priority.toLowerCase()}`}>{priorityLabels[requirement.priority as keyof typeof priorityLabels] || requirement.priority}</span>
                        {!isClosedRequirement(requirement) && (requirement.riskEvaluated
                          ? healthLabel && <span className={`gantt-risk-chip ${healthClass}`}>{healthLabel}</span>
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
                  <div className="gantt-track unified-gantt-track" style={trackStyle} role="cell">
                    <GanttProgressComparison
                      plannedStart={requirement.plannedStart}
                      plannedEnd={requirement.plannedEnd}
                      effectiveEnd={requirement.effectiveEnd}
                      dates={dates}
                      cellWidth={option.cellWidth}
                      status={requirement.status}
                      progress={requirement.progress}
                      plannedProgress={requirement.plannedProgress}
                      interactionProps={tooltipProps}
                      showUnscheduled
                    />
                    {requirement.workItems.filter((item) => item.milestoneLabel).map((item) => <GanttMilestoneMarker key={item.id} label={item.milestoneLabel} plannedEnd={item.plannedEnd} actualEnd={item.actualEnd} status={item.status} dates={dates} cellWidth={option.cellWidth} />)}
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
