import {assertCleanRequirementDraft} from '../use-graph-draft';
import { RequirementOverview } from '../components/RequirementOverview';
import { directRequirementTimelineItem } from '../requirement-timeline';
import { usePageBack } from "../use-page-view";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams, useLocation } from "react-router-dom";
import {
  Archive,
  CalendarDays,
  Check,
  CircleStop,
  Edit3,
  MoreHorizontal,
  PencilLine,
} from "lucide-react";
import { api, ApiError, jsonBody } from "../api";
import { clearProjectGraphDrafts } from "../use-graph-draft";
import { useProjects, useSession } from "../app-context";
import { invalidateRequirementViews, keys } from "../query-keys";
import { cacheResourceUpdate, useResourceQuery } from "../use-resource-query";
import { useWorkItemSave } from "../use-work-item-save";
import { formatDateTime } from "../format";
import type { Person, ProgressUpdate, Requirement, WorkItem, WorkItemTemplate } from "../types";
import { requirementStatusLabels, requirementPlannedProgress } from "../../shared/domain";
import { GapTimeline } from "../components/GapTimeline";
import { Chart } from "../components/Chart";
import { EmptyState, LoadingState, RefreshNotice } from "../components/Feedback";
import { PageHeader } from "../components/PageHeader";
import { PlanForm, RequirementCorrectionForm, RequirementInfoForm, RequirementScheduleForm } from "../components/RequirementForms";
import { ProgressForm, type ProgressScope } from "../components/ProgressForm";
import { ResizablePanel } from "../components/ResizablePanel";
import { AnchoredPopover } from "../components/InlineEdit";
import { WorkItemActions } from "../components/WorkItemActions";
import { WorkItemSettingsDialog } from "../components/WorkItemSettingsDialog";
import { canManageProject } from "../permissions";
import { dailyProgressTrend, progressHistoryMetadata } from "../progress-trend";
import { RequirementCommandDialog, type RequirementCommand } from "../components/RequirementCommandDialog";
import {readDraftRecord} from '../graph-draft-storage';
import type {DependencyChanges} from '../../shared/path-contracts';
import { PathAnalysisPanel,type PathRequirementContext } from "../components/PathAnalysisPanel";

const emptyPeople: Person[] = [];
const emptyTemplates: WorkItemTemplate[] = [];
const progressEventLabels: Record<string, string> = { note: "说明", progress: "进展", start: "开始", block: "阻塞", unblock: "解阻", complete: "完成", reopen: "返工", correction: "纠错", accept: "验收", cancel: "取消" };
const progressReferenceLabel = (update?: ProgressUpdate) => update ? `${formatDateTime(update.createdAt)} · ${progressEventLabels[update.eventType] || update.eventType}` : "原记录不可用";

function SavedRequirementPage() {
  const goBack = usePageBack('/requirements');
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const pathLocation=useLocation();
  const pathView = searchParams.get('view') === 'path';
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
  const lastPathProject=useRef<string|undefined>(undefined);
  useEffect(()=>{if(requirement?.projectId)lastPathProject.current=requirement.projectId;},[requirement?.projectId]);
  const scrollKey='pm-detail-scroll:'+(session.accountId||'guest')+':'+(requirement?.projectId||'')+':'+id,workTarget=searchParams.get('workItemId');
  const openPathView = () => {
    try{sessionStorage.setItem(scrollKey,JSON.stringify({window:window.scrollY,main:document.querySelector('main')?.scrollTop||0}));}catch{/* Navigation remains available. */}
    const params=new URLSearchParams(searchParams);params.set('view','path');setSearchParams(params,{state:pathLocation.state});
  };
  useEffect(()=>{
    if(pathView||workTarget||isLoading)return;
    const frame=requestAnimationFrame(()=>{try{const saved=JSON.parse(sessionStorage.getItem(scrollKey)||'null');if(saved){window.scrollTo(0,saved.window);document.querySelector('main')?.scrollTo(0,saved.main);}}catch{/* Ignore invalid saved positions. */}});
    return()=>cancelAnimationFrame(frame);
  },[pathView,workTarget,isLoading,scrollKey]);
  useEffect(() => {
    if (!unavailable || !error) return;
    if(error instanceof ApiError&&[401,403].includes(error.status)&&lastPathProject.current)clearProjectGraphDrafts(session.accountId||'guest',lastPathProject.current);
    setModal(null);
    setProgressItemId(null);
    setWorkEditorOpen(false);
    setCommand(null);
    setActionMenuOpen(false);
  }, [error, unavailable,session.accountId]);
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
    mutationFn: async ({ item, action, content, expectedDependencyRevision, expectedVersion = item.version }: { item: WorkItem; expectedDependencyRevision?:number; action: string; content?: string; expectedVersion?: number }) => {
      await assertCleanRequirementDraft(session.accountId||'guest',item.requirementId,{workItemId:item.id,action});return api(`/api/work-items/${item.id}/${action}`, {
        method: "POST",
        body: jsonBody({ expectedVersion, expectedDependencyRevision, ...(action === "complete" ? { content } : content ? { reason: content } : {}) }),
      });},
    onSuccess: () => {
      invalidateRequirementViews(client, id);
    },
  });
  const saveWorkItem = useWorkItemSave(id, people);
  const progressOption = useMemo(
    () => {
      const dailyTrend = dailyProgressTrend(requirement?.progressUpdates || []);
      const plannedValues = dailyTrend.map(({ date }) => requirement
        ? requirementPlannedProgress(requirement, requirement.workItems || [], date) : null);
      return ({
      tooltip: { trigger: "axis", valueFormatter: (value: unknown) => typeof value === 'number' ? `${value}%` : '待确认' },
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
          lineStyle: { color: "var(--chart-line)", width: 3 },
          itemStyle: { color: "var(--chart-line)" },
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
  const progressHistory = useMemo(
    () => progressHistoryMetadata(requirement?.progressUpdates || []),
    [requirement?.progressUpdates],
  );
  if(isLoading&&pathView)return <><PageHeader title="需求路径"/><div className="path-analysis immersive-path graph-loading-shell"><section className="graph-workspace"><LoadingState label="正在读取需求路径…"/></section></div></>;
  if (isLoading)
    return (
      <>
        <PageHeader title="需求详情" onBack={goBack} />
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
  const canUpdateItemProgress = (item: WorkItem) => item.status === "in_progress"
    && canContribute
    && (canManage || isRequirementOwner || Boolean(session.personId && item.assigneeIds.includes(session.personId)));
  const canOperateItem = (item: WorkItem) => canManage
    || requirement.status !== "cancelled"
      && (isRequirementOwner || (canContribute && Boolean(session.personId && item.assigneeIds.includes(session.personId))));
  const executionHistoryIds = new Set((requirement.progressUpdates || [])
    .filter((entry) => entry.workItemId && !["note", "correction"].includes(entry.eventType))
    .map((entry) => entry.workItemId));
  const openProgress = (itemId: string) => {
    setProgressItemId(itemId);
    setModal("progress");
  };
  const progressScope = (current: Requirement): ProgressScope => {
    const managesRequirement = canManage || canContribute && Boolean(session.personId && current.ownerId === session.personId);
    return {
      items: managesRequirement ? current.workItems : canContribute ? current.workItems.filter((item) => Boolean(session.personId && item.assigneeIds.includes(session.personId))) : [],
      updates: current.progressUpdates || [],
      requirementStatus: current.status,
    };
  };
  const closeProgress = () => {
    setProgressItemId(null);
    setModal(null);
  };
  const direct = requirement.executionMode === 'direct';
  const timelineItems = direct ? [directRequirementTimelineItem(requirement)] : requirement.workItems;
  const timelineUpdates = direct ? (requirement.progressUpdates || []).map(update => ({...update, workItemId: requirement.id})) : requirement.progressUpdates || [];
  const progressById = new Map((requirement.progressUpdates || []).map((update) => [update.id, update]));
  if (pathView) return <><PathAnalysisPanel key={requirement.id} projectId={requirement.projectId} requirement={requirement} onExit={()=>{const params=new URLSearchParams(searchParams);params.delete('view');params.delete('workItemId');setSearchParams(params,{state:pathLocation.state});}}/></>;
  return (
    <>
      <PageHeader
        title={requirement.title}
        onBack={goBack}
        actions={canManage ? (
          <>
            {canManage && !requirementInfoLocked && <button className="ghost-button" disabled={!peopleReady} onClick={() => setModal("info")}>
              <Edit3 size={15} />
              编辑信息
            </button>}
            {canManage && !requirementLocked && <button className="ghost-button" onClick={() => setModal("schedule")}>
              <CalendarDays size={15} />
              调整计划
            </button>}
            {canManage && <div ref={actionAnchor}>
              <button type="button" className="ghost-button" aria-label="需求操作" aria-expanded={actionMenuOpen} onClick={() => setActionMenuOpen((open) => !open)}><MoreHorizontal size={16} />操作</button>
              <AnchoredPopover anchorRef={actionAnchor} open={actionMenuOpen} onOutside={() => setActionMenuOpen(false)} width={230} className="action-menu">
                {requirement.executionMode!=='direct'&&!['pending_acceptance', 'completed', 'cancelled'].includes(requirement.status) && <button type="button" onClick={() => { setActionMenuOpen(false); setCommand('complete-as-planned'); }}><Check size={15} />按期完成（历史补录）</button>}
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
        <RequirementOverview key={requirement.id} requirement={requirement}/>
      <ResizablePanel
        className={`panel detail-panel requirement-progress-panel stable-workspace-panel${pathView ? " requirement-path-panel" : ""}`}
        storageKey={`${session.accountId || session.username || "guest"}:requirement-gantt`}
        defaultHeight={600}
        minHeight={420}
      >
        <header>
          <div>
            <h2>需求进展</h2>
            <div className="path-view-switch"><button className="ghost-button" aria-pressed={!pathView} onClick={()=>{const params=new URLSearchParams(searchParams);params.delete('view');setSearchParams(params,{state:pathLocation.state});}}>进度甘特</button><button className="ghost-button" aria-pressed={pathView} onClick={openPathView}>路径分析</button></div>
          </div>
          {canManageWorkItems && requirement.executionMode!=='direct' && (
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
        {pathView ? <PathAnalysisPanel key={requirement.id} projectId={requirement.projectId} requirement={requirement}/> : <GapTimeline key={requirement.id} storageKey={`${requirement.projectId}:${requirement.id}:gantt`} milestones={requirement.milestones}
          items={timelineItems}
          itemLabel={direct ? "需求执行" : "工作项"}
          executionStatus={direct ? requirement.status : undefined}
          showStatusFilters={!direct}
          showUnscheduled
          ariaLabel={direct ? "需求直接执行甘特图" : "需求工作项进展甘特图"}
          targetItemId={searchParams.get("workItemId") || undefined}
          asOfDate={requirement.asOfDate}
          updates={timelineUpdates}
          canUpdateProgress={direct ? undefined : canUpdateItemProgress}
          onUpdateProgress={(item) => openProgress(item.id)}
          renderActions={direct ? undefined : (item) => canOperateItem(item)
            ? <WorkItemActions
                item={item}
                onAction={(action, content, expectedVersion, expectedDependencyRevision) => itemAction.mutateAsync({ item, action, content, expectedVersion, expectedDependencyRevision })}
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
        />}
      </ResizablePanel>
      {workEditorOpen && canManageWorkItems && (
        <WorkItemSettingsDialog
          requirement={requirement}
          people={people}
          canManageRequirement={canManage}
          onClose={() => setWorkEditorOpen(false)}
          onOpenDependencies={()=>{setWorkEditorOpen(false);openPathView();}}
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
              const metadata = progressHistory.get(item.id)!;
              return <article key={item.id}>
                <div className={`progress-marker${metadata.transitionLabel === "—" ? " is-note" : item.eventType === "start" ? " is-start" : item.eventType === "complete" ? " is-complete" : ""}`} title={metadata.transitionTitle}>{metadata.transitionLabel}</div>
                <div className="progress-record-main">
                  <header className="progress-record-summary"><strong>{item.workItemTitle || "需求"}</strong><span>{item.content}</span></header>
                  <footer className="progress-record-meta">
                    <span><small>记录时间</small>{formatDateTime(item.createdAt)}</span>
                    <span><small>距上次记录</small>{metadata.elapsedLabel}</span>
                    <span><small>操作人</small>{item.createdByName || "系统记录"}</span>
                    <span><small>需求总进度</small>{item.percent}%</span>
                  </footer>
                  {item.supersedesId && <small className="progress-correction-reference">更正：{progressReferenceLabel(progressById.get(item.supersedesId))}</small>}
                </div>
              </article>;
            })}
            {!requirement.progressUpdates?.length && <EmptyState title="暂无进展" detail={direct ? "开始需求或更新完成度后，这里会显示执行记录。" : "开始工作项、更新完成度或完成工作项后，这里会显示执行记录。"} />}
          </div>
        </article>
        <article className="panel progress-detail-card">
          <header><div><h2>进度趋势</h2></div></header>
          {requirement.progressUpdates?.length ? <Chart option={progressOption} height={270} ariaLabel="需求计划与实际进度趋势" /> : <EmptyState title="暂无趋势" detail="产生执行记录后自动生成趋势图。" />}
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
      {modal === "progress" && progressItemId && (
        <ProgressForm
          key={`${requirement.id}:${progressItemId}`}
          title="更新工作项进度"
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

export function RequirementPage(){
 const [params]=useSearchParams();return params.get('draftProject')?<DraftRequirementPage projectId={params.get('draftProject')!}/>:<SavedRequirementPage/>;
}
function DraftRequirementPage({projectId}:{projectId:string}){
 const {id=''}=useParams(),{session}=useSession(),navigate=useNavigate();
 const [item,setItem]=useState<PathRequirementContext|null|undefined>(undefined);
 useEffect(()=>{let cancelled=false;void readDraftRecord<{values:DependencyChanges[];index:number}>('pm-graph-draft:'+(session.accountId||'guest')+':'+projectId).then(h=>{const c=h?.values[h.index].entities?.find(c=>c.id===id&&c.entity==='requirement'&&c.op==='create');if(!cancelled)setItem(c?{id,projectId,title:c.data.title||'新需求',ownerId:c.data.ownerId||null,workItems:[],status:'planning'}:null);}).catch(()=>{if(!cancelled)setItem(null);});return()=>{cancelled=true;};},[id,projectId,session.accountId]);
 if(item===undefined)return <LoadingState label="正在恢复需求草稿…"/>;
 if(!item)return <EmptyState title="本机需求草稿不存在" detail="请返回全局画布检查草稿。" action={<button onClick={()=>navigate('/paths')}>返回项目全局</button>}/>;
 return <PathAnalysisPanel key={id} projectId={projectId} requirement={item} onExit={()=>navigate('/paths')}/>;
}
