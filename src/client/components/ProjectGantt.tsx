import { ExecutionStageBadge, executionStageOf } from "./ExecutionStageBadge";
import {useAppNavigate} from '../use-app-navigation';
import {OrganizationFilters,matchesOrganization} from './RequirementIntake';
import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { ArrowRight, CircleAlert, RotateCcw, X } from "lucide-react";
import { Link } from "react-router-dom";
import { requirementStatusLabels, riskLabels, signedProgressVariance, todayIso } from "../../shared/domain";
import { compareProcessingPriority } from '../../shared/delivery';

import {compareRiskRequirements,matchesRequirementFilters,emptyRequirementFilters,unfinishedStatuses} from "../../shared/requirement-view";
import { dashboardScopeLabels, dashboardWindow, matchesDashboardScope } from '../../shared/dashboard';
import type { ProjectGanttFilters, RequirementSort } from '../use-project-gantt-filters';
import { matchesSearch } from "../../shared/search";
import type { Requirement } from "../types";
import { progressUpdateDisplayValue } from "../progress-trend";
import { EmptyState } from "./Feedback";
import { useGanttTooltip } from "./GanttTooltip";
import { ResizablePanel } from "./ResizablePanel";
import { SearchInput } from "./SearchInput";
import { GanttDateTracks } from "./GanttDateTracks";
import { useGanttNavigation } from "../use-gantt-navigation";
import { GanttNavigation, GanttScrollbar } from "./GanttNavigation";
import { GanttViewSwitch, useGanttView } from "./GanttViewSwitch";
import { requirementActualRange } from "../gantt-actual";
import { delayedForecastEnd, ganttForecast, type GanttForecast } from '../gantt-forecast';
import { requirementScheduleLabel } from '../requirement-presentation';
import { achievedMilestones, milestoneDate, requirementMilestones } from '../gantt-milestones';
import { useGanttMilestoneData } from '../use-gantt-milestones';
import { GanttMilestoneRail, GanttMilestoneCuts, useMilestoneSelection } from './GanttMilestones';
import {
  GanttPlanActualBars,
  GanttScale,
  ganttTodayPosition,
  ganttTrackStyle,
  toGanttDate,
} from "./GanttTimeline";


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
  if (sort === "risk") return compareRiskRequirements(left,right);
  else if (sort === "progress") result = left.progress - right.progress;
  else if (sort === "updated") result = right.updatedAt.localeCompare(left.updatedAt);
  else result = compareDeadline(left, right);
  if (result !== 0) return result;
  const deadlineResult = compareDeadline(left, right);
  if (deadlineResult !== 0) return deadlineResult;
  const priorityResult = compareProcessingPriority(left,right);
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

function hasCompleteSchedule(requirement: Requirement) {
  if (requirement.scheduleComplete !== undefined) return requirement.scheduleComplete;
  const activeItems = requirement.workItems.filter((item) => item.status !== "cancelled");
  return activeItems.length > 0 && activeItems.every((item) => Boolean(item.plannedStart && item.plannedEnd));
}

function progressVariance(requirement: Requirement) {
  return hasCompleteSchedule(requirement) ? signedProgressVariance(requirement.progress, requirement.plannedProgress) : null;
}

function progressVarianceText(requirement: Requirement) {
  const variance = progressVariance(requirement);
  if (variance === null) return requirementScheduleLabel(requirement);
  if (variance < 0) return `落后${Math.abs(variance)}%`;
  if (variance > 0) return `领先${variance}%`;
  return "进度一致";
}

function activeRiskClass(requirement: Requirement) {
  if (isClosedRequirement(requirement) || !requirement.riskEvaluated) return "";
  return ` gantt-risk-${requirement.riskLevel}`;
}

function RequirementPopover({ requirement, asOfDate, forecast }: { requirement: Requirement; asOfDate: string; forecast?: GanttForecast | null }) {
  const updates = requirement.recentProgressUpdates || [];
  const risk = riskLabels[requirement.riskLevel as keyof typeof riskLabels] || requirement.riskLevel;
  const closed = isClosedRequirement(requirement);
  const actual = requirementActualRange(requirement, asOfDate);
  const variance = progressVariance(requirement);
  const comparable = variance !== null;
  return <>
    <header className="gantt-popover-header">
      <div><strong>{requirement.title}</strong><span>{requirement.projectName}</span></div>
    </header>
    <div className="gantt-popover-badges">
      <span className={`status-pill status-${requirement.status}`}>{statusLabel(requirement.status)}</span>
      <span>实际进度 {requirement.progress}%</span>
      {!closed && (requirement.riskEvaluated
        ? <span className={`risk-badge risk-${requirement.riskLevel}`}>{risk}</span>
        : <span className="risk-badge risk-pending">待评估</span>)}
      {Boolean(requirement.issueSummary?.active) && <span className={requirement.issueSummary?.overdue ? "gantt-issue-summary overdue" : "gantt-issue-summary"}>问题 {requirement.issueSummary?.active}{requirement.issueSummary?.overdue ? ` · 逾期 ${requirement.issueSummary.overdue}` : ""}</span>}
      {requirement.delayed && <em>延期 +{Math.max(1, requirement.finishVariance)}个工作日</em>}
    </div>
    <dl className="gantt-popover-metrics">
      <div><dt>{comparable ? '计划周期' : '已排期部分'}</dt><dd>{dateLabel(requirement.plannedStart)} — {dateLabel(requirement.plannedEnd)}{!comparable && `（${requirementScheduleLabel(requirement)}）`}</dd></div>
      <div><dt>实际执行跨度</dt><dd>{dateLabel(actual.start, "未开始")} — {dateLabel(actual.end, "结束日期缺失")}{!["completed", "cancelled"].includes(requirement.status) && actual.end ? "（截至统计日）" : ""}<small className="gantt-range-note">含等待和间断，不代表净工作量</small></dd></div>
      <div><dt>截至 {format(toGanttDate(asOfDate)!, "MM/dd")} 应达</dt><dd>{comparable ? `${requirement.plannedProgress}%` : '待确定'}</dd></div>
      <div><dt>当前实际进度</dt><dd>{requirement.progress}%</dd></div>
      {forecast && <div><dt>预计交付</dt><dd>{forecast.label}<small className="gantt-range-note">{forecast.details}</small></dd></div>}
      <div><dt>进度偏差</dt><dd className={variance !== null && variance < 0 ? "danger-text" : variance !== null && variance > 0 ? "safe-text" : ""}>{progressVarianceText(requirement)}</dd></div>
      <div><dt>风险判定</dt><dd className={requirement.riskLevel === "high" && requirement.riskEvaluated ? "danger-text" : ""}>{requirement.riskReason}</dd></div>
    </dl>
    <div className={`gantt-popover-progress-compare gantt-status-${requirement.status.replaceAll("_", "-")}`} aria-label={`实际进度${requirement.progress}%${comparable ? `，截至${asOfDate}应达${requirement.plannedProgress}%` : '，计划进度待确定'}`}>
      <div><span>实际</span><i><b style={{ width: `${requirement.progress}%` }} /></i><strong>{requirement.progress}%</strong></div>
      {comparable && <div><span>应达</span><i><b className="is-expected" style={{ width: `${requirement.plannedProgress}%` }} /></i><strong>{requirement.plannedProgress}%</strong></div>}
    </div>
    <section className="gantt-popover-updates">
      <h4>近期进展{updates.length ? `（${updates.length}）` : ""}</h4>
      {updates.map((update) => {
        const displayedPercent = progressUpdateDisplayValue(update);
        return <article key={update.id}>
          <time>{new Date(update.createdAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</time>
          <div>{update.workItemTitle && <b>{update.workItemTitle}</b>}<p>{update.content}</p></div>
          {displayedPercent !== null && displayedPercent !== undefined && <span>{displayedPercent}%</span>}
        </article>;
      })}
      {!updates.length && <p className="gantt-popover-empty">暂无进展记录</p>}
    </section>
    <footer className="gantt-popover-footer">
      <Link to={`/requirements/${requirement.id}`}>查看需求详情<ArrowRight size={13} /></Link>
    </footer>
  </>;
}

export function ProjectGantt({
  requirements,
  projectId,
  projectStart,
  projectEnd,
  asOfDate: asOfDateProp,
  resizeStorageKey,
  filters,
}: {
  requirements: Requirement[];
  projectId?: string;
  projectStart?: string | null;
  projectEnd?: string | null;
  asOfDate?: string;
  resizeStorageKey: string;
  filters: ProjectGanttFilters;
}) {
  const navigate = useAppNavigate();
  const ganttTooltip = useGanttTooltip();
  const [viewMode, setViewMode] = useGanttView();
  const { search, setSearch, status, setStatus, risk, setRisk, personId, setPersonId, feature, setFeature,
    schedule, setSchedule, sort, setSort, scope, setScope, hasFilters, resetFilters } = filters;
  const asOfDate = asOfDateProp || requirements[0]?.asOfDate || todayIso();
  const milestoneData = useGanttMilestoneData(projectId || requirements[0]?.projectId);
  const forecasts = useMemo(() => {
    return new Map(requirements.map(r => {
      const forecast = ganttForecast(r.deliveryForecast, r.status, asOfDate);
      const pending = r.workItems.filter(n => !['completed', 'cancelled'].includes(n.status));
      if (forecast && pending.length) forecast.details += ` 剩余工作：${pending.slice(0, 3).map(n => `${n.title}（${n.deliveryForecast?.end || '日期待更新'}）`).join('、')}${pending.length > 3 ? `等 ${pending.length} 项` : ''}。`;
      return [r.id, forecast];
    }));
  }, [requirements, asOfDate]);
  const rowMilestones = useMemo(() => new Map(requirements.map(r => [r.id, achievedMilestones(requirementMilestones(
    r.milestones || milestoneData?.milestones?.filter(m => m.requirementId === r.id), r.workItems, milestoneData?.edges,
  )).map(m => ({ ...m, relatedIds: [r.id] }))])), [requirements, milestoneData]);
  const projectMilestones = useMemo(() => achievedMilestones(requirementMilestones(milestoneData?.milestones?.filter(m => !m.requirementId), [], milestoneData?.edges))
    .map(m => ({ ...m, relatedIds: [...new Set(m.relatedIds.map(id => milestoneData?.nodes.find(n => n.id === id)?.requirementId).filter((id): id is string => !!id))] })), [milestoneData]);
  const allMilestones = useMemo(() => [...projectMilestones, ...[...rowMilestones.values()].flat()], [projectMilestones, rowMilestones]);
  const milestoneSelection = useMilestoneSelection(allMilestones, asOfDate, id => {
    const m = allMilestones.find(m => m.id === id);
    if (m?.requirementId) navigate(`/requirements/${m.requirementId}?view=path&pathNode=${encodeURIComponent(m.id.replace(/^legacy:/, ''))}`);
    else navigate(`/paths?pathNode=${encodeURIComponent(id)}`);
  });

  const people = useMemo(() => {
    const owners = new Map<string, string>();
    requirements.forEach((requirement) => {if(requirement.ownerId&&requirement.ownerName)owners.set(requirement.ownerId,requirement.ownerName);requirement.workItems.forEach((item) => {
      if (item.assigneeIds?.length && item.assigneeNames?.length) {
        item.assigneeIds.forEach((id, index) => owners.set(id, item.assigneeNames[index]));
      } else if (item.ownerId && item.ownerName) owners.set(item.ownerId, item.ownerName);
    });});
    return [...owners.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [requirements]);
  const visibleRequirements = useMemo(() => {
    const window = dashboardWindow(asOfDate);
    return requirements.filter((requirement) => {
      const matchesKeyword = matchesSearch([
        { text: requirement.title, weight: 100 },
        ...requirement.workItems.map((item) => ({ text: item.title, weight: 20 })),
      ], search);
      const scheduleComplete = hasCompleteSchedule(requirement);
      const matchesSchedule = !schedule
        || (schedule === "delayed" && requirement.delayed)
        || (schedule === "on_track" && scheduleComplete && !requirement.delayed)
        || (schedule === "unplanned" && !scheduleComplete);
      return (!scope || matchesDashboardScope(requirement, scope, window)) && matchesOrganization(requirement,feature)&&matchesKeyword
        && matchesRequirementFilters(requirement,{...emptyRequirementFilters(),statuses:status==='unfinished'?unfinishedStatuses:status?[status]:[]})
        && (!risk || (requirement.riskEvaluated?requirement.riskLevel:"pending")===risk)
        && (!personId || requirement.ownerId===personId || requirement.workItems.some((item) => item.assigneeIds?.includes(personId) || item.ownerId === personId))
        && matchesSchedule;
    }).sort((left, right) => {
      return compareRequirements(left, right, sort);
    });
  }, [personId, requirements, risk, schedule, search, sort, status,feature,scope,asOfDate]);

  const timelineValues = useMemo(() => {
    const values: Array<string | null | undefined> = [projectStart, projectEnd];
    values.push(...allMilestones.map(m => milestoneDate(m)));
    values.push(asOfDate);
    requirements.forEach((requirement) => {
      const actual = requirementActualRange(requirement, asOfDate);
      values.push(actual.start, actual.end, requirement.plannedStart, requirement.plannedEnd);
      if (hasCompleteSchedule(requirement) || isClosedRequirement(requirement)) {
        values.push(requirement.plannedStart, requirement.plannedEnd, requirement.effectiveEnd);
        values.push(delayedForecastEnd(forecasts.get(requirement.id), requirement.plannedEnd));
      }
    });
    return values;
  }, [asOfDate, projectEnd, projectStart, requirements, allMilestones, forecasts]);

  const navigation = useGanttNavigation({ values: timelineValues, asOfDate, storageKey: resizeStorageKey, legacyKey: resizeStorageKey, onPan: ganttTooltip.close });
  const { dates, zoom, cellWidth, timelineWidth } = navigation;
  const trackStyle = useMemo(() => ganttTrackStyle(dates, cellWidth), [dates, cellWidth]);
  const { offset: todayOffset, visible: todayVisible } = ganttTodayPosition(dates, asOfDate);
  const toolbarRef = useRef<HTMLElement>(null), filtersRef = useRef<HTMLDivElement>(null);
  const [minimumHeight, setMinimumHeight] = useState(420);
  useEffect(() => {
    const toolbar = toolbarRef.current, filters = filtersRef.current;
    if (!toolbar || !filters) return;
    // Wrapped controls must leave room for the date axis and at least two rows.
    const observer = new ResizeObserver(() => setMinimumHeight(Math.max(420,
      Math.ceil(toolbar.getBoundingClientRect().height + filters.getBoundingClientRect().height) + 260)));
    observer.observe(toolbar); observer.observe(filters);
    return () => observer.disconnect();
  }, []);

  return (
    <ResizablePanel className="project-gantt-panel stable-workspace-panel" storageKey={resizeStorageKey} defaultHeight={560} minHeight={minimumHeight}>
      <header className="project-gantt-toolbar" ref={toolbarRef}>
        <div className="gantt-legend" aria-label="甘特图图例">
          <span><i className="legend-plan-pill" />计划</span>
          <span title="条长表示实际执行日期跨度，完成度另行标注；蓝色执行中，绿色已完成，灰色断纹已取消，红色描边延期"><i className="legend-actual" />实际执行</span>
          <span><i className="legend-today" />截至 {format(toGanttDate(asOfDate)!, "MM/dd")}</span>
          {viewMode === "overlay" && <><span><i className="legend-delayed" />延期</span><span><i className="legend-early" />提前完成</span></>}
          <span><i className="legend-milestone" />里程碑</span>
          <span title="红色虚线延伸至预计完成日"><i className="legend-forecast" />延期预测</span>
          <span><i className="legend-risk-medium" />中风险</span>
          <span><i className="legend-risk-high" />高风险</span>
          <span className="gantt-axis-note">横轴按工作日显示</span>
        </div>
        <div className="gantt-toolbar-actions">
          <GanttViewSwitch value={viewMode} onChange={setViewMode} />
          <GanttNavigation navigation={navigation} />
        </div>
      </header>
      <div className="gantt-filter-bar" aria-label="项目进展筛选" ref={filtersRef}>
        {scope && <button className="gantt-dashboard-scope" onClick={() => setScope('')} title="清除看板范围，保留其他筛选">{dashboardScopeLabels[scope]}<X size={13} /></button>}
        <OrganizationFilters items={requirements} feature={feature} onFeature={setFeature}/><SearchInput className="gantt-filter-search" value={search} onChange={setSearch} placeholder="搜索需求、工作项或拼音" />
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="按状态筛选">
          <option value="unfinished">未结束 · {requirements.filter(r=>!isClosedRequirement(r)).length}</option><option value="">全部状态 · {requirements.length}</option>
          {Object.entries(requirementStatusLabels).map(([value, label]) => <option value={value} key={value}>{label} · {requirements.filter(r=>r.status===value).length}</option>)}
        </select>
        <select value={risk} onChange={(event) => setRisk(event.target.value)} aria-label="按风险筛选">
          <option value="">全部风险</option>
          <option value="pending">待评估</option>{Object.entries(riskLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
        <select value={personId} onChange={(event) => setPersonId(event.target.value)} aria-label="按人员筛选">
          <option value="">全部人员</option>
          {personId&&!people.some(p=>p.id===personId)&&<option value={personId}>当前人员（无匹配需求）</option>}
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
          <option value="risk">风险 · 高优先</option>
          <option value="progress">进度 · 低优先</option>
          <option value="updated">最近更新 · 新优先</option>
        </select>
        <span className="gantt-filter-result">{visibleRequirements.length} / {requirements.length} 项</span>
        <button className="gantt-reset-button" onClick={()=>resetFilters()} disabled={!hasFilters} title="重置为进行中和风险排序">
          <RotateCcw size={15} /> 重置
        </button>
      </div>
      {!visibleRequirements.length && !projectMilestones.length ? (
        <EmptyState title={!requirements.length?'项目暂无需求':status==='in_progress'&&!scope&&!search&&!risk&&!personId&&!schedule?'当前没有进行中的需求':'没有匹配的需求'} detail={requirements.length?'筛选只影响此图，项目统计仍包含完整范围。可切换状态查看未开始或已完成的需求。':'新建需求后即可查看项目排期。'} action={requirements.length?<button className="ghost-button" onClick={()=>resetFilters(status==='in_progress'&&!scope?'unfinished':'in_progress')}>{status==='in_progress'&&!scope?'查看未结束需求':'恢复进行中'}</button>:undefined}/>
      ) : (
        <div className="project-gantt-scroll gantt-navigation-surface" ref={navigation.attach} tabIndex={0} aria-label="项目甘特时间轴，可左右拖动浏览">
          <div className={`project-gantt-grid${projectMilestones.length ? ' has-milestone-rail' : ''}`} style={{ width: `calc(var(--project-gantt-label-width) + ${timelineWidth}px)` }} role="table" aria-label="项目进展甘特图">
            <div data-gantt-fixed className="gantt-corner gantt-sticky-left" role="columnheader">
              <strong>需求</strong>
              <span>{visibleRequirements.length} 项需求</span>
            </div>
            <div className="gantt-axis-header"><GanttScale dates={dates} zoom={zoom} cellWidth={cellWidth} todayOffset={todayOffset} todayVisible={todayVisible} />
              {projectMilestones.length > 0 && <GanttMilestoneRail items={projectMilestones} dates={dates} cellWidth={cellWidth} asOfDate={asOfDate} selection={milestoneSelection} />}
            </div>
            {visibleRequirements.map((requirement) => {
              const actual = requirementActualRange(requirement, asOfDate);
              const scheduleComplete = hasCompleteSchedule(requirement);
              const tooltipProps = ganttTooltip.bind(<RequirementPopover requirement={requirement} asOfDate={asOfDate} forecast={forecasts.get(requirement.id)} />);
              const variance = progressVariance(requirement);
              const risk = requirement.riskLevel !== "low" ? riskLabels[requirement.riskLevel as keyof typeof riskLabels] : "";
              const varianceLabel = variance === null ? '' : variance < 0 ? `落后${Math.abs(variance)}%` : variance > 0 ? `领先${variance}%` : "";
              const healthLabel = [risk, varianceLabel].filter(Boolean).join(" · ");
              const healthClass = requirement.riskLevel !== "low" ? requirement.riskLevel : variance !== null && variance > 0 ? "ahead" : "";
              const milestoneItems = rowMilestones.get(requirement.id) || [];
              return (
                <div className={`gantt-row${milestoneSelection.related(requirement.id) ? ' is-milestone-related' : ''}${requirement.delayed ? " is-delayed" : ""}${activeRiskClass(requirement)}`} role="row" key={requirement.id}>
                  <div className="gantt-sticky-left gantt-requirement-info" role="rowheader">
                    <div className="gantt-requirement-copy">
                      <button className="gantt-requirement-link" onClick={() => navigate(`/requirements/${requirement.id}`)} title={requirement.title}>
                        {requirement.title}
                      </button>
                      {!scheduleComplete && <small className="muted">{requirementScheduleLabel(requirement)}</small>}
                      <ExecutionStageBadge requirement={requirement}/>
                      <div>
                        {!isClosedRequirement(requirement) && (requirement.riskEvaluated
                          ? healthLabel && <span className={`gantt-risk-chip ${healthClass}`}>{healthLabel}</span>
                          : scheduleComplete && <span className="gantt-risk-chip pending">待评估</span>)}
                        {requirement.delayed && <em>延期 {Math.max(1, requirement.finishVariance)} 个工作日</em>}
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
                  <div className={`gantt-track unified-gantt-track${viewMode === "split" ? " gantt-split-track" : ""}`} style={trackStyle} role="cell">
                    <GanttMilestoneCuts items={projectMilestones} dates={dates} cellWidth={cellWidth} asOfDate={asOfDate} selection={milestoneSelection} />
                    {viewMode === "split" ? <GanttDateTracks
                      plannedStart={requirement.plannedStart} plannedEnd={requirement.plannedEnd}
                      actualStart={actual.start} actualEnd={actual.end} status={requirement.status} scheduleComplete={scheduleComplete}
                      stageLabel={executionStageOf(requirement).label + (executionStageOf(requirement).stages.length===1 ? " · " + executionStageOf(requirement).stages[0].progress+"%" : "")} stageTone={executionStageOf(requirement).tone} progress={requirement.progress} dates={dates} cellWidth={cellWidth}
                      forecast={forecasts.get(requirement.id)}
                      interactionProps={tooltipProps}
                    /> : <GanttPlanActualBars
                      plannedStart={scheduleComplete ? requirement.plannedStart : null}
                      plannedEnd={scheduleComplete ? requirement.plannedEnd : null}
                      actualStart={actual.start} actualEnd={actual.end} status={requirement.status}
                      stageLabel={executionStageOf(requirement).label + (executionStageOf(requirement).stages.length===1 ? " · " + executionStageOf(requirement).stages[0].progress+"%" : "")} stageTone={executionStageOf(requirement).tone} progress={requirement.progress} dates={dates} cellWidth={cellWidth}
                      forecast={forecasts.get(requirement.id)}
                      progressAriaLabel={`实际进度 ${requirement.progress}%，实际执行跨度 ${actual.start || '日期未记录'} 至 ${actual.end || '日期未记录'}${!isClosedRequirement(requirement) ? '（截至统计日）' : ''}`}
                      interactionProps={tooltipProps}
                    />}
                    {milestoneItems.length > 0 && <GanttMilestoneRail items={milestoneItems} dates={dates} cellWidth={cellWidth} asOfDate={asOfDate} selection={milestoneSelection} inline />}
                    {todayVisible && <i className="gantt-today-line" style={{ left: (todayOffset + 1) * cellWidth }} title={`截至 ${asOfDate}`} />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <GanttScrollbar navigation={navigation} />
      {ganttTooltip.tooltip}
      {milestoneSelection.details}
    </ResizablePanel>
  );
}
