import {WorkProgressBadge} from '../components/ExecutionStageBadge';
import {useAppNavigate,useAppSearchParams} from '../use-app-navigation';
import {PageResourcesContext,usePageResources} from '../page-context';
import { Pagination } from '../components/Pagination';
import { useListPagination } from '../use-list-pagination';
import type {StartAssignment} from '../components/StartAssignmentDialog';
import {assertCleanRequirementDraft} from '../use-graph-draft';
import { RequirementOverview } from '../components/RequirementOverview';
import { directRequirementTimelineItem } from '../requirement-timeline';
import { hasPageHistory, usePageBack } from "../use-page-view";
import { useEffect, useMemo, useRef, useState,type ComponentProps } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useParams, useLocation } from "react-router-dom";
import {remapSavedEditorUrl} from '../path-view';
import {
  Archive,
  CalendarDays,
  Check,
  CircleStop,
  Edit3,
  PencilLine,
} from "lucide-react";
import { api, ApiError, jsonBody } from "../api";
import { clearProjectGraphDrafts } from "../use-graph-draft";
import { useProjects, useSession } from "../app-context";
import { invalidateRequirementViews, keys } from "../query-keys";
import { cacheResourceUpdate,useResourceQuery } from "../use-resource-query";
import { useWorkItemSave } from "../use-work-item-save";
import { formatDateTime } from "../format";
import type { Person, ProgressUpdate, Requirement, WorkItem, WorkItemTemplate } from "../types";
import { requirementStatusLabels, requirementPlannedProgress } from "../../shared/domain";
import { GapTimeline } from "../components/GapTimeline";
import { Chart } from "../components/Chart";
import { EmptyState, LoadingState, RefreshNotice } from "../components/Feedback";
import { PageHeader } from "../components/PageHeader";
import {
  persistRequirementCorrectionRecheck,
  persistRequirementInfoRecheck,
  persistRequirementPlanRecheck,
  persistRequirementScheduleRecheck,
  PlanForm,
  readRequirementCorrectionRecheck,
  readRequirementInfoRecheck,
  readRequirementPlanRecheck,
  readRequirementScheduleRecheck,
  RequirementCorrectionForm,
  RequirementInfoForm,
  RequirementScheduleForm,
  type RequirementCorrectionRecheck,
  type RequirementInfoRecheck,
  type RequirementPlanRecheck,
  type RequirementScheduleRecheck,
} from "../components/RequirementForms";
import { ProgressForm, type ProgressScope } from "../components/ProgressForm";
import { ResizablePanel } from "../components/ResizablePanel";
import { WorkItemActions } from "../components/WorkItemActions";
import { WorkItemSettingsDialog } from "../components/WorkItemSettingsDialog";
import { canManageProject } from "../permissions";
import { dailyProgressTrend, progressHistoryMetadata } from "../progress-trend";
import {
  persistRequirementCommandRecheck,
  readRequirementCommandRecheck,
  RequirementCommandDialog,
  type RequirementCommand,
  type RequirementCommandRecheck,
} from "../components/RequirementCommandDialog";
import {readDraftRecord} from '../graph-draft-storage';
import type {DependencyChanges} from '../../shared/path-contracts';
import { PathAnalysisPanel,type PathRequirementContext } from "../components/PathAnalysisPanel";
import {
  persistWorkItemActionRecheck,
  persistWorkItemSettingsRecheck,
  readWorkItemActionRechecks,
  readWorkItemSettingsRechecks,
} from "../work-item-write-rechecks";

const emptyPeople: Person[] = [];
const emptyTemplates: WorkItemTemplate[] = [];
const progressEventLabels: Record<string, string> = { note: "说明", progress: "进展", start: "开始", block: "阻塞", unblock: "解阻", complete: "完成", reopen: "返工", correction: "纠错", accept: "验收", cancel: "取消" };
const progressReferenceLabel = (update?: ProgressUpdate) => update ? `${formatDateTime(update.createdAt)} · ${progressEventLabels[update.eventType] || update.eventType}` : "原记录不可用";

function EmbeddedRequirementHeader({secondaryActions,moreActions}:ComponentProps<typeof PageHeader>){return <header className="delivery-requirement-header"><div className="button-row">{secondaryActions}</div>{moreActions&&<details><summary>需求操作</summary><div className="button-row">{moreActions}</div></details>}</header>;}
export function EmbeddedRequirementDetails({id,workItemId,onOpenDependencies}:{id:string;workItemId?:string;onOpenDependencies:()=>void}){
  const resources=usePageResources(),{session}=useSession(),query=useResourceQuery<Requirement>([...keys.requirement(id),session.accountId],'/api/requirements/'+id,!!id);
  return <PageResourcesContext.Provider value={{...resources,requirement:query}}><SavedRequirementPage key={id} requirementId={id} embedded selectedWorkItemId={workItemId} onOpenDependencies={onOpenDependencies}/></PageResourcesContext.Provider>;
}
function SavedRequirementPage({requirementId,embedded=false,selectedWorkItemId,onOpenDependencies}:{requirementId?:string;embedded?:boolean;selectedWorkItemId?:string;onOpenDependencies?:()=>void}={}) {
  const Header=embedded?EmbeddedRequirementHeader:PageHeader;
  const goBack = usePageBack('/requirements');
  const { id:routeId = "" } = useParams(),id=requirementId||routeId;
  const navigate = useAppNavigate();
  const [searchParams, setSearchParams] = useAppSearchParams();
  const pathLocation=useLocation();
  const pathView = searchParams.get('view') === 'path';
  const client = useQueryClient();
  const { session } = useSession();
  const actionRecheckAccountKey = session.accountId || session.username || "guest";
  const [modal, setModal] = useState<
    "info" | "correction" | "schedule" | "progress" | "template" | null
  >(null);
  const [progressItemId, setProgressItemId] = useState<string | null>(null);
  const [workEditorOpen, setWorkEditorOpen] = useState(false);
  const [workEditorNeedsRecheck, setWorkEditorNeedsRecheck] = useState(() => readWorkItemSettingsRechecks(actionRecheckAccountKey).has(id));
  const [workEditorRechecking, setWorkEditorRechecking] = useState(false);
  const [workItemActionRechecks, setWorkItemActionRechecks] = useState<Set<string>>(() => readWorkItemActionRechecks(actionRecheckAccountKey));
  const [infoRecheck, setInfoRecheckState] = useState<RequirementInfoRecheck | null>(() => readRequirementInfoRecheck(actionRecheckAccountKey, id));
  const setInfoRecheck = (value: RequirementInfoRecheck | null) => {
    persistRequirementInfoRecheck(actionRecheckAccountKey, id, value);
    setInfoRecheckState(value);
  };
  const [scheduleRecheck, setScheduleRecheckState] = useState<RequirementScheduleRecheck | null>(() => readRequirementScheduleRecheck(actionRecheckAccountKey, id));
  const setScheduleRecheck = (value: RequirementScheduleRecheck | null) => {
    persistRequirementScheduleRecheck(actionRecheckAccountKey, id, value);
    setScheduleRecheckState(value);
  };
  const [planRecheck, setPlanRecheckState] = useState<RequirementPlanRecheck | null>(() => readRequirementPlanRecheck(actionRecheckAccountKey, id));
  const setPlanRecheck = (value: RequirementPlanRecheck | null) => {
    persistRequirementPlanRecheck(actionRecheckAccountKey, id, value);
    setPlanRecheckState(value);
  };
  const [correctionRecheck, setCorrectionRecheckState] = useState<RequirementCorrectionRecheck | null>(() => readRequirementCorrectionRecheck(actionRecheckAccountKey, id));
  const setCorrectionRecheck = (value: RequirementCorrectionRecheck | null) => {
    persistRequirementCorrectionRecheck(actionRecheckAccountKey, id, value);
    setCorrectionRecheckState(value);
  };
  const [command, setCommand] = useState<RequirementCommand | null>(null);
  const [commandRecheck, setCommandRecheckState] = useState<RequirementCommandRecheck | null>(() => readRequirementCommandRecheck(actionRecheckAccountKey, id));
  const setCommandRecheck = (value: RequirementCommandRecheck | null) => {
    persistRequirementCommandRecheck(actionRecheckAccountKey, id, value);
    setCommandRecheckState(value);
  };
  const {
    data: requirement,
    isLoading,
    error,
    refetch,
    isFetching,
    unavailable,
  } = usePageResources().requirement;
  const historyPagination = useListPagination({ items: requirement?.progressUpdates || [], id: "history", defaultPageSize: 10, ready: Boolean(requirement), loading: isFetching });
  const lastPathProject=useRef<string|undefined>(undefined);
  useEffect(()=>{if(requirement?.projectId)lastPathProject.current=requirement.projectId;},[requirement?.projectId]);
  const scrollKey='pm-detail-scroll:'+(session.accountId||'guest')+':'+(requirement?.projectId||'')+':'+id,workTarget=searchParams.get('workItemId');
  const openPathView = () => {
    if(embedded){onOpenDependencies?.();return;}
    try{sessionStorage.setItem(scrollKey,JSON.stringify({window:window.scrollY,main:document.querySelector('main')?.scrollTop||0}));}catch{/* Navigation remains available. */}
    const params=new URLSearchParams({view:'requirement',requirementId:id,root:'features',featureId:requirement?.featureId||'unassigned'});if(workTarget){params.set('pathNode',workTarget);params.set('pathInspector','open');}navigate('/paths?'+params);
  };
  useEffect(()=>{
    if(embedded||pathView||workTarget||isLoading)return;
    const frame=requestAnimationFrame(()=>{try{const saved=JSON.parse(sessionStorage.getItem(scrollKey)||'null');if(saved){window.scrollTo(0,saved.window);document.querySelector('main')?.scrollTo(0,saved.main);}}catch{/* Ignore invalid saved positions. */}});
    return()=>cancelAnimationFrame(frame);
  },[embedded,pathView,workTarget,isLoading,scrollKey]);
  useEffect(() => {
    if (!unavailable || !error) return;
    if(error instanceof ApiError&&[401,403].includes(error.status)&&lastPathProject.current)clearProjectGraphDrafts(session.accountId||'guest',lastPathProject.current);
    setModal(null);
    setProgressItemId(null);
    setWorkEditorOpen(false);
    setCommand(null);
  }, [error, unavailable,session.accountId]);
  useEffect(() => {
    setWorkEditorNeedsRecheck(readWorkItemSettingsRechecks(actionRecheckAccountKey).has(id));
    setWorkEditorRechecking(false);
    setWorkItemActionRechecks(readWorkItemActionRechecks(actionRecheckAccountKey));
    setInfoRecheckState(readRequirementInfoRecheck(actionRecheckAccountKey, id));
    setScheduleRecheckState(readRequirementScheduleRecheck(actionRecheckAccountKey, id));
    setPlanRecheckState(readRequirementPlanRecheck(actionRecheckAccountKey, id));
    setCorrectionRecheckState(readRequirementCorrectionRecheck(actionRecheckAccountKey, id));
    setCommandRecheckState(readRequirementCommandRecheck(actionRecheckAccountKey, id));
  }, [actionRecheckAccountKey, id]);
  const setWorkItemActionRecheck = (workItemId: string, required: boolean) => {
    setWorkItemActionRechecks(persistWorkItemActionRecheck(actionRecheckAccountKey, workItemId, required));
  };
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
  const recheckWorkEditor = async () => {
    if (workEditorRechecking) return;
    setWorkEditorRechecking(true);
    try {
      const result = await refetch({ throwOnError: true });
      if (result.data) {
        persistWorkItemSettingsRecheck(actionRecheckAccountKey, id, false);
        setWorkEditorNeedsRecheck(false);
      }
    } catch {
      // 保留查询错误与写入锁，直到需求能够再次读取。
    } finally {
      setWorkEditorRechecking(false);
    }
  };
  const itemAction = useMutation({
    mutationFn: async ({ item, action, content, expectedDependencyRevision, assignment, expectedVersion = item.version }: { item: WorkItem; expectedDependencyRevision?:number; assignment?:StartAssignment; action: string; content?: string; expectedVersion?: number }) => {
      await assertCleanRequirementDraft(session.accountId||'guest',item.requirementId,{workItemId:item.id,action});return api(`/api/work-items/${item.id}/${action}`, {
        method: "POST",
        body: jsonBody({ ...assignment, expectedVersion, expectedDependencyRevision, ...(action === "complete" ? { content } : content ? { reason: content } : {}) }),
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
  if (!requirement || unavailable) return null;

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
  const renderWorkActions=(item:WorkItem)=>canOperateItem(item)
            ? <WorkItemActions
                item={item}
                onAction={(action, content, expectedVersion, expectedDependencyRevision, assignment) => itemAction.mutateAsync({ item, action, content, expectedVersion, expectedDependencyRevision, assignment })}
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
                writeNeedsRecheck={workItemActionRechecks.has(item.id)}
                onWriteNeedsRecheckChange={(required) => setWorkItemActionRecheck(item.id, required)}
              />
            : <span className={`work-action-state is-readonly status-${item.status}`}>
                {requirementStatusLabels[item.status as keyof typeof requirementStatusLabels] || item.status}
              </span>;
  const direct = requirement.executionMode === 'direct';
  const timelineItems = direct ? [directRequirementTimelineItem(requirement)] : requirement.workItems;
  const timelineUpdates = direct ? (requirement.progressUpdates || []).map(update => ({...update, workItemId: requirement.id})) : requirement.progressUpdates || [];
  const progressById = new Map((requirement.progressUpdates || []).map((update) => [update.id, update]));
  if (pathView) {
    const params=new URLSearchParams(searchParams);params.set('view','requirement');params.set('requirementId',requirement.id);
    const from=typeof pathLocation.state?.featureReturn==='string'?new URLSearchParams(pathLocation.state.featureReturn.split('?')[1]):null;
    params.set('root',from?.get('view')==='feature'?'features':'project');
    if(params.get('root')==='features')params.set('featureId',requirement.featureId||'unassigned');
    if(params.get('workItemId'))params.set('pathNode',params.get('workItemId')!);
    return <Navigate to={'/paths?'+params} replace state={pathLocation.state}/>;
  }
  const embeddedWorkDetails=<section className="delivery-work-details">{requirement.workItems.filter(item=>!selectedWorkItemId||item.id===selectedWorkItemId).map(item=><article key={item.id}><h4>{item.title}</h4><WorkProgressBadge work={item}/><p>{item.ownerName||'未分派'} · {item.plannedStart||'待定'} ～ {item.plannedEnd||'待定'}</p><div className="button-row">{renderWorkActions(item)}{canUpdateItemProgress(item)&&<button className="primary-button" onClick={()=>openProgress(item.id)}>更新进度</button>}</div></article>)}<div className="button-row">{canManageWorkItems&&<button className="ghost-button" disabled={workEditorNeedsRecheck||!!planRecheck} onClick={()=>setWorkEditorOpen(true)}>工作项设置</button>}<button className="ghost-button" onClick={openPathView}>维护依赖与分解</button></div></section>;
  const requirementHeader=<Header
        title={requirement.title}
        views={<div className="view-tabs"><button className="ghost-button" aria-pressed={!pathView} onClick={()=>{const params=new URLSearchParams(searchParams);params.delete('view');setSearchParams(params,{replace:true,state:pathLocation.state});}}>进度甘特</button><button className="ghost-button" aria-pressed={pathView} onClick={openPathView}>路径分析</button></div>}
        onBack={goBack} backLabel={hasPageHistory()?"返回":"需求列表"}
        moreLabel="需求操作"
        moreDisabled={Boolean(commandRecheck || correctionRecheck)}
        secondaryActions={canManage ? (
          <>
            {canManage && !requirementInfoLocked && <button className="ghost-button" disabled={!peopleReady || Boolean(infoRecheck)} onClick={() => { if (!infoRecheck) setModal("info"); }}>
              <Edit3 size={15} />
              编辑信息
            </button>}
            {canManage && !requirementLocked && <button className="ghost-button" disabled={Boolean(scheduleRecheck)} onClick={() => { if (!scheduleRecheck) setModal("schedule"); }}>
              <CalendarDays size={15} />
              调整计划
            </button>}
          </>
        ) : null}
        moreActions={canManage ? <>
                {requirement.executionMode!=='direct'&&!['pending_acceptance', 'completed', 'cancelled'].includes(requirement.status) && <button disabled={Boolean(commandRecheck || correctionRecheck)} type="button" onClick={() => { setCommand('complete-as-planned'); }}><Check size={15} />按期完成（历史补录）</button>}
                {!['completed', 'cancelled'].includes(requirement.status) && <button disabled={Boolean(commandRecheck || correctionRecheck)} type="button" className="danger" onClick={() => { setCommand('cancel'); }}><CircleStop size={15} />取消需求</button>}
                {['completed', 'cancelled'].includes(requirement.status) && <button disabled={Boolean(commandRecheck || correctionRecheck)} type="button" onClick={() => { setModal('correction'); }}><PencilLine size={15} />受控纠错</button>}
                {['completed', 'cancelled'].includes(requirement.status) && <button disabled={Boolean(commandRecheck || correctionRecheck)} type="button" className="danger" onClick={() => { setCommand('archive'); }}><Archive size={15} />归档需求</button>}
        </> : null}
      />;
  return (
    <>

      {!embedded&&requirementHeader}
      <div className={embedded?"requirement-page embedded-requirement":"page-content requirement-page"}>
        {error && <RefreshNotice pending={isFetching} onRetry={() => void refetch()} />}
        {infoRecheck && <div className="warning-banner" role="alert">需求信息修改结果待核对，原需求版本与草稿已锁定。<button type="button" className="ghost-button" disabled={!peopleReady} onClick={() => setModal("info")}>核对信息修改</button></div>}
        {scheduleRecheck && <div className="warning-banner" role="alert">需求计划调整结果待核对，原需求版本与草稿已锁定。<button type="button" className="ghost-button" onClick={() => setModal("schedule")}>核对计划调整</button></div>}
        {planRecheck && <div className="warning-banner" role="alert">补全计划结果待核对，原需求版本与草稿已锁定。<button type="button" className="ghost-button" disabled={templatesQuery.data === undefined} onClick={() => setModal("template")}>核对补全计划</button></div>}
        {correctionRecheck && <div className="warning-banner" role="alert">需求受控纠错结果待核对，原需求版本与草稿已锁定。<button type="button" className="ghost-button" disabled={!peopleReady} onClick={() => setModal("correction")}>核对受控纠错</button></div>}
        {commandRecheck && <div className="warning-banner" role="alert">{commandRecheck.action === 'cancel' ? '取消需求' : commandRecheck.action === 'archive' ? '归档需求' : '按期完成'}结果待核对，原需求版本已锁定。<button type="button" className="ghost-button" onClick={() => setCommand(commandRecheck.action)}>核对需求操作</button></div>}
        {workEditorNeedsRecheck && <div className="warning-banner" role="alert">工作项设置结果待核对，设置操作暂不可用。<button type="button" className="ghost-button" disabled={workEditorRechecking} onClick={() => void recheckWorkEditor()}>{workEditorRechecking ? "读取中…" : "重新读取需求"}</button></div>}
        {supportingError && <div className="warning-banner">{supportingDataReady ? "人员与流程数据刷新失败，当前使用上次成功结果。" : "人员或流程数据加载失败，相关编辑操作暂不可用。"}<button className="ghost-button" disabled={peopleQuery.isFetching || templatesQuery.isFetching} onClick={() => void Promise.all([peopleQuery.refetch(), templatesQuery.refetch()])}>重新加载</button></div>}
        <>{embedded&&selectedWorkItemId?<>{embeddedWorkDetails}<details className="delivery-parent-requirement"><summary>所属需求 · {requirement.title}</summary><RequirementOverview key={requirement.id} requirement={requirement}/>{requirementHeader}</details></>:<><RequirementOverview key={requirement.id} requirement={requirement}/>{embedded&&requirementHeader}</>}</>
      {embedded?(selectedWorkItemId?null:embeddedWorkDetails):<>      <ResizablePanel
        className={`panel detail-panel requirement-progress-panel stable-workspace-panel${pathView ? " requirement-path-panel" : ""}`}
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
                disabled={workEditorNeedsRecheck || Boolean(planRecheck)}
                onClick={() => { if (!workEditorNeedsRecheck && !planRecheck) setWorkEditorOpen(true); }}
              >
                <Edit3 size={15} />
                工作项设置
              </button>
            </div>
          )}
        </header>
        {pathView ? <PathAnalysisPanel key={requirement.id} projectId={requirement.projectId} requirement={requirement}/> : <GapTimeline key={requirement.id} storageKey={`${requirement.projectId}:${requirement.id}:gantt`} milestones={requirement.milestones} projectId={requirement.projectId}
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
          canEditForecast={direct ? undefined : canOperateItem}
          onUpdateProgress={(item) => openProgress(item.id)}
          renderActions={direct ? undefined : renderWorkActions}
        />}
      </ResizablePanel></>}
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
          onWriteNeedsRecheck={() => {
            persistWorkItemSettingsRecheck(actionRecheckAccountKey, id, true);
            setWorkEditorNeedsRecheck(true);
          }}
          onReload={async () => {
            const result = await refetch({ throwOnError: true });
            if (!result.data) throw new Error("需求无法打开");
            return result.data;
          }}
        />
      )}
      <details className="delivery-history" open={embedded?undefined:true}><summary>进展与执行历史</summary><section className="detail-grid progress-detail-grid">
        <article className="panel progress-detail-card paged-panel">
          <header><div><h2>进展记录</h2></div></header>
          <div className="progress-feed paged-body" ref={historyPagination.scrollRef}>
            {historyPagination.items.map((item) => {
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
          <Pagination {...historyPagination.props} label="需求进展分页" />
        </article>
        <article className="panel progress-detail-card">
          <header><div><h2>进度趋势</h2></div></header>
          {requirement.progressUpdates?.length ? <Chart option={progressOption} height={270} ariaLabel="需求计划与实际进度趋势" /> : <EmptyState title="暂无趋势" detail="产生执行记录后自动生成趋势图。" />}
        </article>
      </section>
      </details>
      {modal === "info" && (
        <RequirementInfoForm requirement={requirement} people={people} recheck={infoRecheck} onRecheckChange={setInfoRecheck} onClose={() => setModal(null)} />
      )}
      {modal === "correction" && (
        <RequirementCorrectionForm requirement={requirement} people={people} recheck={correctionRecheck} onRecheckChange={setCorrectionRecheck} onClose={() => setModal(null)} />
      )}
      {modal === "schedule" && (
        <RequirementScheduleForm key={requirement.id} requirement={requirement} recheck={scheduleRecheck} onRecheckChange={setScheduleRecheck} onClose={() => setModal(null)} />
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
        <PlanForm key={requirement.id} requirement={requirement} templates={templates} recheck={planRecheck} onRecheckChange={setPlanRecheck} onClose={() => setModal(null)} />
      )}
      {command && <RequirementCommandDialog key={`${id}:${command}`} action={command} requirement={requirement} recheck={commandRecheck} onRecheckChange={setCommandRecheck} onClose={() => setCommand(null)} onArchived={() => navigate('/')} onReload={async () => {
        const latest = await refetch({ throwOnError: true });
        if (!latest.data) throw new Error('需求已无法读取，请关闭操作窗口。');
        return latest.data;
      }} />}
      </div>
    </>
  );
}

export function RequirementPage(){
 const [params]=useAppSearchParams(),location=useLocation(),{session}=useSession(),{selectedProjectId}=useProjects();
 const url=location.pathname+location.search,projectId=params.get('draftProject')||selectedProjectId;
 const savedUrl=remapSavedEditorUrl(url,(session.accountId||'guest')+':'+projectId);
 if(params.has('draftProject')&&savedUrl!==url)return <Navigate to={savedUrl} replace state={location.state}/>;
 return params.get('draftProject')?<DraftRequirementPage projectId={params.get('draftProject')!}/>:<SavedRequirementPage/>;
}
function DraftRequirementPage({projectId}:{projectId:string}){
 const {id=''}=useParams(),{session}=useSession(),navigate=useAppNavigate();
 const [item,setItem]=useState<PathRequirementContext|null|undefined>(undefined);
 useEffect(()=>{let cancelled=false;void readDraftRecord<{values:DependencyChanges[];index:number}>('pm-graph-draft:'+(session.accountId||'guest')+':'+projectId).then(h=>{const c=h?.values[h.index].entities?.find(c=>c.id===id&&c.entity==='requirement'&&c.op==='create');if(!cancelled)setItem(c?{id,projectId,title:c.data.title||'新需求',ownerId:c.data.ownerId||null,workItems:[],status:'not_started'}:null);}).catch(()=>{if(!cancelled)setItem(null);});return()=>{cancelled=true;};},[id,projectId,session.accountId]);
 if(item===undefined)return <LoadingState label="正在恢复需求草稿…"/>;
 if(!item)return <><PageHeader title="本机需求草稿不存在" onBack={()=>navigate('/?view=features')} backLabel="返回项目交付"/><EmptyState title="本机需求草稿不存在" detail="请返回项目交付检查草稿。"/></>;
 return <Navigate to={'/paths?'+new URLSearchParams({view:'requirement',requirementId:id,draftProject:projectId,root:'project'})} replace/>;
}
