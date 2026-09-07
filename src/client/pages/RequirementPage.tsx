import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Archive,
  CalendarDays,
  Check,
  CircleStop,
  Clock3,
  Edit3,
  ExternalLink,
  MoreHorizontal,
  PencilLine,
  Plus,
} from "lucide-react";
import { api, jsonBody } from "../api";
import { useProjects, useSession } from "../app-context";
import { invalidateRequirementViews, keys } from "../query-keys";
import { cacheResourceUpdate, useResourceQuery } from "../use-resource-query";
import { useWorkItemSave } from "../use-work-item-save";
import { formatDateTime } from "../format";
import type { Person, ProgressUpdate, Requirement, WorkItem, WorkItemTemplate } from "../types";
import { requirementStatusLabels, riskLabels, workItemPlannedProgress, workItemPlannedDuration } from "../../shared/domain";
import { GapTimeline } from "../components/GapTimeline";
import { Chart } from "../components/Chart";
import { EmptyState, LoadingState, RefreshNotice } from "../components/Feedback";
import { StatusBadge } from "../components/Badge";
import { PageHeader } from "../components/PageHeader";
import { PlanForm, RequirementCorrectionForm, RequirementInfoForm, RequirementScheduleForm } from "../components/RequirementForms";
import { ProgressForm, type ProgressScope } from "../components/ProgressForm";
import { ResizablePanel } from "../components/ResizablePanel";
import { AnchoredPopover } from "../components/InlineEdit";
import { WorkItemActions } from "../components/WorkItemActions";
import { WorkItemSettingsDialog } from "../components/WorkItemSettingsDialog";
import { canManageProject } from "../permissions";
import { dailyProgressTrend, progressUpdateDisplayValue } from "../progress-trend";
import { RequirementCommandDialog, type RequirementCommand } from "../components/RequirementCommandDialog";

const emptyPeople: Person[] = [];
const emptyTemplates: WorkItemTemplate[] = [];
const progressEventLabels: Record<string, string> = { note: "说明", progress: "进展", start: "开始", block: "阻塞", unblock: "解阻", complete: "完成", reopen: "返工", correction: "纠错", accept: "验收", cancel: "取消" };
const progressReferenceLabel = (update?: ProgressUpdate) => update ? `${formatDateTime(update.createdAt)} · ${progressEventLabels[update.eventType] || update.eventType}` : "原记录不可用";

export function RequirementPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const client = useQueryClient();
  const { session } = useSession();
  const { projects, syncProjectContext } = useProjects();
  const [modal, setModal] = useState<
    "info" | "correction" | "schedule" | "progress" | "template" | null
  >(null);
  const [progressItemId, setProgressItemId] = useState<string | null>(null);
  const [workEditorOpen, setWorkEditorOpen] = useState(false);
  const [command, setCommand] = useState<RequirementCommand | null>(null);
  const actionAnchor = useRef<HTMLDivElement>(null);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const {
    data: requirement,
    isLoading,
    error,
    refetch,
    isFetching,
    unavailable,
  } = useResourceQuery<Requirement>(keys.requirement(id), `/api/requirements/${id}`, Boolean(id));
  useEffect(() => {
    if (!unavailable || !error) return;
    setModal(null);
    setProgressItemId(null);
    setWorkEditorOpen(false);
    setCommand(null);
    setActionMenuOpen(false);
  }, [error, unavailable]);
  useEffect(() => {
    if (!requirement?.projectId) return;
    if (projects.some((project) => project.id === requirement.projectId))
      syncProjectContext(requirement.projectId);
  }, [projects, requirement?.projectId, syncProjectContext]);
  const templatesQuery = useQuery({
    queryKey: [...keys.templates, requirement?.projectId || ""],
    queryFn: ({ signal }) => api<WorkItemTemplate[]>(`/api/templates?projectId=${encodeURIComponent(requirement!.projectId)}`, { signal }),
    enabled: Boolean(requirement?.projectId),
  });
  const peopleQuery = useQuery({
    queryKey: [...keys.people, requirement?.projectId || ""],
    queryFn: ({ signal }) => api<Person[]>(`/api/people?projectId=${encodeURIComponent(requirement!.projectId)}`, { signal }),
    enabled: Boolean(requirement?.projectId),
  });
  const templates = templatesQuery.data || emptyTemplates;
  const people = peopleQuery.data || emptyPeople;
  const itemAction = useMutation({
    mutationFn: ({ item, action, content, expectedVersion = item.version }: { item: WorkItem; action: string; content?: string; expectedVersion?: number }) =>
      api(`/api/work-items/${item.id}/${action}`, {
        method: "POST",
        body: jsonBody({ expectedVersion, ...(action === "complete" ? { content } : content ? { reason: content } : {}) }),
      }),
    onSuccess: () => {
      invalidateRequirementViews(client, id);
    },
  });
  const saveWorkItem = useWorkItemSave(id, people);
  const progressOption = useMemo(
    () => {
      const dailyTrend = dailyProgressTrend(requirement?.progressUpdates || []);
      const items = (requirement?.workItems || []).filter((item) => item.status !== "cancelled");
      const totalWeight = items.reduce((sum, item) => sum + workItemPlannedDuration(item), 0);
      const plannedValues = dailyTrend.map(({ date }) => {
        const plannedWeight = items.reduce((sum, item) => sum + workItemPlannedDuration(item) * workItemPlannedProgress(item, date) / 100, 0);
        return totalWeight ? Math.round((plannedWeight / totalWeight) * 100) : 0;
      });
      return ({
      tooltip: { trigger: "axis" },
      legend: { top: 4, right: 16, data: ["实际进度", "计划进度"], textStyle: { color: "var(--text-muted)", fontSize: 12 } },
      grid: { left: 42, right: 18, top: 42, bottom: 34 },
      xAxis: {
        type: "category",
        data: dailyTrend.map(({ date }) => `${date.slice(5, 7)}/${date.slice(8, 10)}`),
        axisLabel: { color: "var(--text-muted)" },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 100,
        axisLabel: { formatter: "{value}%", color: "var(--text-muted)" },
        splitLine: { lineStyle: { color: "var(--divider)" } },
      },
      series: [
        {
          name: "实际进度",
          type: "line",
          smooth: true,
          symbolSize: 8,
          data: dailyTrend.map((item) => item.actualProgress),
          lineStyle: { color: "var(--accent)", width: 3 },
          itemStyle: { color: "var(--accent)" },
          areaStyle: { color: "var(--chart-area)" },
        },
        {
          name: "计划进度",
          type: "line",
          smooth: false,
          symbolSize: 6,
          data: plannedValues,
          lineStyle: { color: "var(--text-faint)", width: 2, type: "dashed" },
          itemStyle: { color: "var(--text-faint)" },
        },
      ],
    });
    },
    [requirement],
  );
  if (isLoading)
    return (
      <>
        <PageHeader title="需求详情" onBack={() => navigate(-1)} />
        <div className="page-content">
          <LoadingState label="加载需求详情…" className="tall" />
        </div>
      </>
    );
  if (unavailable || !requirement)
    return (
      <>
        <PageHeader title="需求详情" onBack={() => navigate("/requirements")} backLabel="返回需求管理" />
        <div className="page-content">
          <EmptyState
            title="需求无法打开"
            detail={error?.message || "需求不存在或已归档。"}
            action={
              <div className="button-row"><button className="ghost-button" onClick={() => navigate("/requirements")}>
                返回需求管理
              </button><button type="button" className="primary-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</button></div>
            }
          />
        </div>
      </>
    );
  const canManage = canManageProject(session, requirement.projectId);
  const peopleReady = peopleQuery.data !== undefined;
  const supportingDataReady = peopleReady && templatesQuery.data !== undefined;
  const supportingError = peopleQuery.error || templatesQuery.error;
  const currentPerson = people.find((person) => person.id === session.personId);
  const canContribute = canManage || currentPerson?.projectRole === "member" || currentPerson?.projectRole === "manager";
  const isRequirementOwner = canContribute && Boolean(session.personId && requirement.ownerId === session.personId);
  const requirementInfoLocked = ["completed", "cancelled"].includes(requirement.status);
  const requirementLocked = ["pending_acceptance", "completed", "cancelled"].includes(requirement.status);
  const canManageWorkItems = supportingDataReady && (canManage || isRequirementOwner) && !requirementLocked;
  const participatesInActiveItem = Boolean(session.personId && requirement.workItems.some((item) =>
    !["completed", "cancelled"].includes(item.status) && item.assigneeIds.includes(session.personId!),
  ));
  const canAddProgress = canContribute && !requirementLocked && (canManage || isRequirementOwner || participatesInActiveItem);
  const canUpdateItemProgress = (item: WorkItem) => item.status === "in_progress"
    && canContribute
    && (canManage || isRequirementOwner || Boolean(session.personId && item.assigneeIds.includes(session.personId)));
  const canOperateItem = (item: WorkItem) => canManage
    || requirement.status !== "cancelled"
      && (isRequirementOwner || (canContribute && Boolean(session.personId && item.assigneeIds.includes(session.personId))));
  const executionHistoryIds = new Set((requirement.progressUpdates || [])
    .filter((entry) => entry.workItemId && !["note", "correction"].includes(entry.eventType))
    .map((entry) => entry.workItemId));
  const openProgress = (itemId: string | null = null) => {
    setProgressItemId(itemId);
    setModal("progress");
  };
  const progressScope = (current: Requirement): ProgressScope => {
    const managesRequirement = canManage || canContribute && Boolean(session.personId && current.ownerId === session.personId);
    return {
      items: managesRequirement ? current.workItems : canContribute ? current.workItems.filter((item) => Boolean(session.personId && item.assigneeIds.includes(session.personId))) : [],
      updates: current.progressUpdates || [],
      allowRequirementNote: managesRequirement,
      requirementStatus: current.status,
    };
  };
  const closeProgress = () => {
    setProgressItemId(null);
    setModal(null);
  };
  const riskClosed = ["pending_acceptance", "completed", "cancelled"].includes(requirement.status);
  const riskLabel = riskClosed
    ? "风险已关闭"
    : requirement.riskEvaluated
      ? riskLabels[requirement.riskLevel as keyof typeof riskLabels]
      : "待评估";
  const riskClass = riskClosed || !requirement.riskEvaluated ? "risk-pending" : `risk-${requirement.riskLevel}`;
  const progressById = new Map((requirement.progressUpdates || []).map((update) => [update.id, update]));
  return (
    <>
      <PageHeader
        title={requirement.title}
        onBack={() => navigate(-1)}
        actions={canAddProgress || canManage ? (
          <>
            {canManage && !requirementInfoLocked && <button className="ghost-button" disabled={!peopleReady} onClick={() => setModal("info")}>
              <Edit3 size={15} />
              编辑信息
            </button>}
            {canManage && !requirementLocked && <button className="ghost-button" onClick={() => setModal("schedule")}>
              <CalendarDays size={15} />
              调整计划
            </button>}
            {canAddProgress && <button
              className="primary-button"
              onClick={() => openProgress()}
            >
              <Plus size={15} />
              增加进展
            </button>}
            {canManage && <div ref={actionAnchor}>
              <button type="button" className="ghost-button" aria-label="需求操作" aria-expanded={actionMenuOpen} onClick={() => setActionMenuOpen((open) => !open)}><MoreHorizontal size={16} />操作</button>
              <AnchoredPopover anchorRef={actionAnchor} open={actionMenuOpen} onOutside={() => setActionMenuOpen(false)} width={230} className="action-menu">
                {!['pending_acceptance', 'completed', 'cancelled'].includes(requirement.status) && <button type="button" onClick={() => { setActionMenuOpen(false); setCommand('complete-as-planned'); }}><Check size={15} />按期完成（历史补录）</button>}
                {requirement.status === 'pending_acceptance' && <button type="button" onClick={() => { setActionMenuOpen(false); setCommand('accept'); }}><Check size={15} />确认验收</button>}
                {!['completed', 'cancelled'].includes(requirement.status) && <button type="button" className="danger" onClick={() => { setActionMenuOpen(false); setCommand('cancel'); }}><CircleStop size={15} />取消需求</button>}
                {['completed', 'cancelled'].includes(requirement.status) && <button type="button" onClick={() => { setActionMenuOpen(false); setModal('correction'); }}><PencilLine size={15} />受控纠错</button>}
                {['completed', 'cancelled'].includes(requirement.status) && <button type="button" className="danger" onClick={() => { setActionMenuOpen(false); setCommand('archive'); }}><Archive size={15} />归档需求</button>}
              </AnchoredPopover>
            </div>}
          </>
        ) : null}
      />
      <div className="page-content requirement-page">
        {error && <RefreshNotice pending={isFetching} onRetry={() => void refetch()} />}
        {supportingError && <div className="warning-banner">{supportingDataReady ? "人员与流程数据刷新失败，当前使用上次成功结果。" : "人员或流程数据加载失败，相关编辑操作暂不可用。"}<button className="ghost-button" disabled={peopleQuery.isFetching || templatesQuery.isFetching} onClick={() => void Promise.all([peopleQuery.refetch(), templatesQuery.refetch()])}>重新加载</button></div>}
        {requirement.status === "pending_acceptance" && <section className="requirement-acceptance-banner">
          <div><Check size={18} /><span><strong>所有工作项已完成，等待项目经理验收</strong><small>验收后才会计入已完成需求和完成率</small></span></div>
          {canManage && <button className="primary-button" onClick={() => setCommand('accept')}><Check size={15} />确认验收</button>}
        </section>}
        <div className="requirement-context-strip">
          <div className="hero-badges">
            <span>{requirement.projectName}</span>
            <StatusBadge kind="requirement" value={requirement.status} />
            <StatusBadge kind="priority" value={requirement.priority} />
            {riskClosed || !requirement.riskEvaluated ? (
              <span className={`risk-badge ${riskClass}`}>{riskLabel}</span>
            ) : (
              <StatusBadge kind="risk" value={requirement.riskLevel} />
            )}
          </div>
          <span>共{requirement.workItems.length}个工作项 · 最近更新 {formatDateTime(requirement.updatedAt)}</span>
        </div>
      <section className="panel requirement-brief">
        <div><span>需求负责人</span><strong>{requirement.ownerName || "待指定"}</strong></div>
        {requirement.background && <div><span>需求背景</span><p>{requirement.background}</p></div>}
        {requirement.acceptanceCriteria && <div><span>验收标准</span><p>{requirement.acceptanceCriteria}</p></div>}
        {requirement.referenceUrl && <div><span>参考链接</span><a href={requirement.referenceUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />打开辅助资料</a></div>}
      </section>
      <section className="detail-kpis">
        <article>
          <span>当前进度</span>
          <strong>{requirement.progress}%</strong>
          <div className="progress-row">
            <i style={{ width: `${requirement.progress}%` }} />
          </div>
          <small>计划进度 {requirement.plannedProgress}% · 自动按工期加权</small>
        </article>
        <article>
          <span>计划周期</span>
          <strong>
            {requirement.plannedStart || "待排期"} →{" "}
            {requirement.plannedEnd || "待排期"}
          </strong>
          <small>
            <CalendarDays size={14} />
            按工作日计算
          </small>
        </article>
        <article>
          <span>完成偏差</span>
          <strong
            className={
              requirement.finishVariance > 0 ? "danger-text" : "safe-text"
            }
          >
            {requirement.finishVariance > 0
              ? `+${requirement.finishVariance}`
              : requirement.finishVariance}{" "}
            工作日
          </strong>
          <small>
            <Clock3 size={14} />
            计划对比实际
          </small>
        </article>
        <article>
          <span>风险等级</span>
          <strong>{riskLabel}</strong>
          <small>
            {requirement.riskEvaluated && requirement.riskLevel !== "low" ? (
              <>
                <AlertTriangle size={14} />
                {requirement.riskReason}
              </>
            ) : (
              <>
                <Check size={14} />
                {requirement.riskReason}
              </>
            )}
          </small>
        </article>
      </section>
      <ResizablePanel
        className="panel detail-panel requirement-progress-panel stable-workspace-panel"
        storageKey={`${session.accountId || session.username || "guest"}:requirement-gantt`}
        defaultHeight={600}
        minHeight={420}
      >
        <header>
          <div>
            <h2>需求进展</h2>
          </div>
          {canManageWorkItems && (
            <div className="panel-actions">
              <button
                className="ghost-button"
                aria-haspopup="dialog"
                onClick={() => setWorkEditorOpen(true)}
              >
                <Edit3 size={15} />
                工作项设置
              </button>
            </div>
          )}
        </header>
        <GapTimeline
          items={requirement.workItems}
          targetItemId={searchParams.get("workItemId") || undefined}
          asOfDate={requirement.asOfDate}
          updates={requirement.progressUpdates || []}
          canUpdateProgress={canUpdateItemProgress}
          onUpdateProgress={(item) => openProgress(item.id)}
          renderActions={(item) => canOperateItem(item)
            ? <WorkItemActions
                item={item}
                onAction={(action, content, expectedVersion) => itemAction.mutateAsync({ item, action, content, expectedVersion })}
                onSaveDates={canManage ? (dates, expectedVersion) => saveWorkItem(item, dates, expectedVersion) : undefined}
                onCompleteAsPlanned={canManage && !requirementLocked ? (expectedVersion) => itemAction.mutateAsync({ item, action: "complete-as-planned", expectedVersion }) : undefined}
                onCancel={(reason, expectedVersion) => itemAction.mutateAsync({ item, action: "cancel", content: reason, expectedVersion })}
                onReload={async () => {
                  const latest = await refetch({ throwOnError: true });
                  const current = latest.data?.workItems.find((entry) => entry.id === item.id);
                  if (!current) throw new Error("工作项已不存在，请关闭操作面板。");
                  return {
                    item: current,
                    updates: (latest.data?.progressUpdates || []).filter((update) => update.workItemId === item.id),
                  };
                }}
                hasExecutionHistory={executionHistoryIds.has(item.id)}
                correctionCandidates={(requirement.progressUpdates || []).filter((update) => update.workItemId === item.id)}
                canManage={canManage || isRequirementOwner}
                stateChangesDisabled={requirement.status === "cancelled"}
                startDisabledReason={requirement.status === "planning" ? "需求尚未完成规划，请先指定需求负责人并补齐全部工作项排期。" : undefined}
              />
            : <span className={`work-action-state is-readonly status-${item.status}`}>
                {requirementStatusLabels[item.status as keyof typeof requirementStatusLabels] || item.status}
              </span>}
        />
      </ResizablePanel>
      {workEditorOpen && canManageWorkItems && (
        <WorkItemSettingsDialog
          requirement={requirement}
          people={people}
          canManageRequirement={canManage}
          onClose={() => setWorkEditorOpen(false)}
          onOpenPlan={() => {
            setWorkEditorOpen(false);
            setModal("template");
          }}
          onReload={async () => {
            const result = await refetch({ throwOnError: true });
            if (!result.data) throw new Error("需求无法打开");
            return result.data;
          }}
        />
      )}
      <section className="detail-grid progress-detail-grid">
        <article className="panel progress-detail-card">
          <header><div><h2>进展记录</h2></div></header>
          <div className="progress-feed">
            {requirement.progressUpdates?.map((item) => {
              const displayedPercent = progressUpdateDisplayValue(item);
              return <article key={item.id}>
                <div className={`progress-marker${displayedPercent === null ? " is-note" : ""}`}>{displayedPercent === null ? "—" : `${displayedPercent}%`}</div>
                <div><header><strong>{formatDateTime(item.createdAt)}</strong>{item.workItemTitle && <span>{item.workItemTitle}</span>}</header><p>{item.content}</p>{item.supersedesId && <small className="progress-correction-reference">更正：{progressReferenceLabel(progressById.get(item.supersedesId))}</small>}</div>
                <span className="progress-event-type">{progressEventLabels[item.eventType] || "记录"}</span>
              </article>;
            })}
            {!requirement.progressUpdates?.length && <EmptyState title="暂无进展" detail="增加进展后，这里会显示具体完成内容。" />}
          </div>
        </article>
        <article className="panel progress-detail-card">
          <header><div><h2>进度趋势</h2></div></header>
          {requirement.progressUpdates?.length ? <Chart option={progressOption} height={270} ariaLabel="需求计划与实际进度趋势" /> : <EmptyState title="暂无趋势" detail="增加第一条进展后自动生成趋势图。" />}
        </article>
      </section>
      {modal === "info" && (
        <RequirementInfoForm requirement={requirement} people={people} onClose={() => setModal(null)} />
      )}
      {modal === "correction" && (
        <RequirementCorrectionForm requirement={requirement} people={people} onClose={() => setModal(null)} />
      )}
      {modal === "schedule" && (
        <RequirementScheduleForm key={requirement.id} requirement={requirement} onClose={() => setModal(null)} />
      )}
      {modal === "progress" && (
        <ProgressForm
          key={`${requirement.id}:${progressItemId || "note"}`}
          title={progressItemId ? "更新工作项进度" : "增加进展"}
          requirementId={requirement.id}
          scope={progressScope(requirement)}
          loadScope={async () => {
            const latest = await api<Requirement>(`/api/requirements/${requirement.id}`);
            cacheResourceUpdate(client, keys.requirement(requirement.id), latest);
            return progressScope(latest);
          }}
          contextLabel={`${requirement.projectName} · ${requirement.title}`}
          fixedItemId={progressItemId}
          onClose={closeProgress}
        />
      )}
      {modal === "template" && (
        <PlanForm key={requirement.id} requirement={requirement} templates={templates} onClose={() => setModal(null)} />
      )}
      {command && <RequirementCommandDialog key={`${id}:${command}`} action={command} requirement={requirement} onClose={() => setCommand(null)} onArchived={() => navigate('/')} onReload={async () => {
        const latest = await refetch({ throwOnError: true });
        if (!latest.data) throw new Error('需求已无法读取，请关闭操作窗口。');
        return latest.data;
      }} />}
      </div>
    </>
  );
}
