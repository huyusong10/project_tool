import * as requirementsApi from "./api";
import * as templatesApi from "../templates/api";
import * as peopleApi from "../people/api";
import { DetailCard } from "../../components/DetailCard";
import { ObjectDependencies } from "../../components/ObjectDependencies";
import { useDeliveryForm } from "../../use-delivery-form";
import { WorkItemObjectDetails } from "../../components/WorkItemObjectDetails";
import { Button } from "../../components/Button";
import { DetailWorkspace } from "../../components/DetailWorkspace";
import { useProjectWorkspace } from "../../project-workspace-context";

import { TopbarMenu } from "../../components/TopbarMenu";
import "../../components/object-inspector.css";
import "../../workspace-gantt.css";
import { useAppNavigate, useAppSearchParams } from "../../use-app-navigation";
import { PageResourcesContext, usePageResources } from "../../page-context";
import { Pagination } from "../../components/Pagination";
import { useListPagination } from "../../use-list-pagination";
import { RequirementOverview } from "../../components/RequirementOverview";
import { RequirementSources } from "../../components/RequirementSources";
import { hasPageHistory, usePageBack } from "../../use-page-view";
import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useParams, useLocation } from "react-router-dom";

import { Archive, CalendarDays, Check, CircleStop, Edit3, PencilLine } from "lucide-react";
import { ApiError } from "../../api";
import { clearProjectGraphDrafts } from "../../use-graph-draft";
import { useGuestWorkspace, useSession } from "../../app-context";
import { keys } from "../../query-keys";
import { useResourceQuery } from "../../use-resource-query";
import { formatDateTime } from "../../format";
import type { Person, Requirement, WorkItemTemplate } from "../../types";
import { requirementPlannedProgress } from "../../../shared/domain";
import { Chart } from "../../components/Chart";
import { EmptyState, RefreshNotice } from "../../components/Feedback";
import { PageHeader } from "../../components/PageHeader";
import { persistRequirementCorrectionRecheck, readRequirementCorrectionRecheck, RequirementCorrectionForm, type RequirementCorrectionRecheck } from './forms/correction';
import { persistRequirementInfoRecheck, readRequirementInfoRecheck, RequirementInfoForm, type RequirementInfoRecheck } from './forms/info';
import { persistRequirementPlanRecheck, PlanForm, readRequirementPlanRecheck, type RequirementPlanRecheck } from './forms/plan';
import { persistRequirementScheduleRecheck, readRequirementScheduleRecheck, RequirementScheduleForm, type RequirementScheduleRecheck } from './forms/schedule';
import { WorkItemSettingsDialog } from "../../components/WorkItemSettingsDialog";
import { canManageProject } from "../../permissions";
import { dailyProgressTrend, progressHistoryMetadata, progressReferenceLabel } from "../../progress-trend";
import { persistRequirementCommandRecheck, readRequirementCommandRecheck, RequirementCommandDialog, type RequirementCommand, type RequirementCommandRecheck } from "../../components/RequirementCommandDialog";

import { persistWorkItemSettingsRecheck, readWorkItemSettingsRechecks } from "../../work-item-write-rechecks";

export const emptyPeople: Person[] = [];

export const emptyTemplates: WorkItemTemplate[] = [];

export function EmbeddedRequirementHeader({secondaryActions,moreActions,moreDisabled}:ComponentProps<typeof PageHeader>){return <div className="detail-toolbar-actions"><div className="button-row">{secondaryActions}</div>{moreActions&&<TopbarMenu label="需求操作" disabled={moreDisabled}>{moreActions}</TopbarMenu>}</div>;}

export type RequirementActionRequest={requestedAction?:'info'|'schedule';onActionHandled?:()=>void};

export function RequirementObjectDetails({id,workItemId,onOpenDependencies,requestedAction,onActionHandled}:{id:string;workItemId?:string;onOpenDependencies:()=>void}&RequirementActionRequest){
  const [fresh,setFresh]=useState(false);
  const resources=usePageResources(),{session}=useSession(),query=useResourceQuery<Requirement>([...keys.requirement(id),session.accountId],signal => requirementsApi.requirementsById<Requirement>(id, { signal }),!!id,()=>setFresh(true),true);
  if(!fresh||!query.data||query.unavailable)return <div role="status"><span>{query.error?.message||'正在读取需求…'}</span>{query.error&&<Button variant="secondary" disabled={query.isFetching} onClick={()=>void query.refetch()}>重新读取</Button>}</div>;
  if(workItemId)return <WorkItemObjectDetails requirementId={id} workItemId={workItemId} onOpenDependencies={onOpenDependencies}/>;
  return <PageResourcesContext.Provider value={{...resources,requirement:query}}><RequirementObjectContent key={id} requirementId={id} embedded requestedAction={requestedAction} onActionHandled={onActionHandled} selectedWorkItemId={workItemId} onOpenDependencies={onOpenDependencies}/></PageResourcesContext.Provider>;
}

export function RequirementObjectContent({requirementId,embedded=false,selectedWorkItemId,onOpenDependencies,requestedAction,onActionHandled}:{requirementId?:string;embedded?:boolean;selectedWorkItemId?:string;onOpenDependencies?:()=>void}&RequirementActionRequest={}) {
  const projectId=usePageResources().requirement.data?.projectId||'';
  const Header=embedded?EmbeddedRequirementHeader:PageHeader;
  const goBack = usePageBack('/requirements');
  const { id:routeId = "" } = useParams(),id=requirementId||routeId;
  const navigate = useAppNavigate();
  const [searchParams] = useAppSearchParams();
  const pathLocation=useLocation();
  const pathView = searchParams.get('view') === 'path';
  const { session } = useSession();
  const guest=useGuestWorkspace(projectId);
  const actionRecheckAccountKey = session.accountId || session.username || "guest";
  const [modal, setModal] = useDeliveryForm<
    "info" | "correction" | "schedule" | "template" | null
  >(projectId,id+':action',()=>null);
  const workspace = useProjectWorkspace();
  const openWork = (workId: string) => workspace?.inspect(workId);
  const [workEditorNeedsRecheck, setWorkEditorNeedsRecheck] = useState(() => readWorkItemSettingsRechecks(actionRecheckAccountKey).has(id));
  const [workEditorRechecking, setWorkEditorRechecking] = useState(false);
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
  const historyPagination = useListPagination({ items: requirement?.progressUpdates || [], id: "history:requirement:" + id, defaultPageSize: 10, ready: Boolean(requirement), loading: isFetching });
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
    setCommand(null);
  }, [error, unavailable,session.accountId,setModal]);
  useEffect(() => {
    setWorkEditorNeedsRecheck(readWorkItemSettingsRechecks(actionRecheckAccountKey).has(id));
    setWorkEditorRechecking(false);
    setInfoRecheckState(readRequirementInfoRecheck(actionRecheckAccountKey, id));
    setScheduleRecheckState(readRequirementScheduleRecheck(actionRecheckAccountKey, id));
    setPlanRecheckState(readRequirementPlanRecheck(actionRecheckAccountKey, id));
    setCorrectionRecheckState(readRequirementCorrectionRecheck(actionRecheckAccountKey, id));
    setCommandRecheckState(readRequirementCommandRecheck(actionRecheckAccountKey, id));
  }, [actionRecheckAccountKey, id]);
  const templatesQuery = useQuery({
    queryKey: [...keys.templates, requirement?.projectId || ""],
    queryFn: ({ signal }) => templatesApi.templatesQuery<WorkItemTemplate[]>(encodeURIComponent(requirement!.projectId), { signal }),
    enabled: Boolean(requirement?.projectId) && !guest,
  });
  const peopleQuery = useQuery({
    queryKey: [...keys.people, requirement?.projectId || ""],
    queryFn: ({ signal }) => peopleApi.peopleQuery<Person[]>(encodeURIComponent(requirement!.projectId), { signal }),
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
        data: dailyTrend.map(({ date }) => date),
        axisLabel: { color: "var(--text-muted)", formatter: (date: string) => date.slice(5).replace('-', '/') },
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
  useEffect(()=>{
    if(!requestedAction||!requirement||unavailable||peopleQuery.data===undefined)return;
    if(canManageProject(session,requirement.projectId)&&(requestedAction==='info'||!['completed','cancelled'].includes(requirement.status))&&(requestedAction!=='schedule'||requirement.status!=='pending_acceptance'))setModal(requestedAction);
    onActionHandled?.();
  },[requestedAction,requirement,unavailable,peopleQuery.data,session,setModal,onActionHandled]);
  if (!requirement || unavailable) return null;

  const canManage = canManageProject(session, requirement.projectId);
  const peopleReady = peopleQuery.data !== undefined;
  const supportingDataReady = peopleReady && templatesQuery.data !== undefined;
  const supportingError = peopleQuery.error || templatesQuery.error;
  const currentPerson = people.find((person) => person.id === session.personId);
  const canContribute = canManage || currentPerson?.projectRole === "member" || currentPerson?.projectRole === "manager";
  const isRequirementOwner = canContribute && Boolean(session.personId && requirement.ownerId === session.personId);
  const requirementLocked = ["pending_acceptance", "completed", "cancelled"].includes(requirement.status);
  const canManageWorkItems = supportingDataReady && (canManage || isRequirementOwner && !requirementLocked);
  const direct = requirement.executionMode === 'direct';
  const progressById = new Map((requirement.progressUpdates || []).map((update) => [update.id, update]));
  if (pathView) {
    const params=new URLSearchParams(searchParams);params.set('view','requirement');params.set('requirementId',requirement.id);
    const from=typeof pathLocation.state?.featureReturn==='string'?new URLSearchParams(pathLocation.state.featureReturn.split('?')[1]):null;
    params.set('root',from?.get('view')==='feature'?'features':'project');
    if(params.get('root')==='features')params.set('featureId',requirement.featureId||'unassigned');
    if(params.get('workItemId'))params.set('pathNode',params.get('workItemId')!);
    return <Navigate to={'/paths?'+params} replace state={pathLocation.state}/>;
  }
  const workList = <WorkItemSettingsDialog embedded requirement={requirement} people={people} canEdit={canManageWorkItems&&!workEditorNeedsRecheck&&!planRecheck} canManageRequirement={canManage} onInspect={openWork} onClose={()=>{}} onOpenDependencies={openPathView} onOpenPlan={()=>setModal('template')} onWriteNeedsRecheck={()=>{persistWorkItemSettingsRecheck(actionRecheckAccountKey,id,true);setWorkEditorNeedsRecheck(true);}} onReload={async()=>{const result=await refetch({throwOnError:true});if(!result.data)throw Error('需求无法打开');return result.data;}}/>;
  const requirementHeader=<Header
        title={requirement.title}

        onBack={goBack} backLabel={hasPageHistory()?"返回":"需求列表"}
        moreLabel="需求操作"
        moreDisabled={Boolean(commandRecheck || correctionRecheck)}
        secondaryActions={canManage ? (
          <>
            {canManage && <Button variant="secondary" aria-label="编辑信息" title="编辑需求信息" className="ghost-button" disabled={!peopleReady || Boolean(infoRecheck)} onClick={() => { if (!infoRecheck) setModal("info"); }}>
              <Edit3 size={15} />
              编辑需求
            </Button>}
            {canManage && !requirementLocked && <Button variant="secondary" aria-label="调整计划" title="调整计划" className="ghost-button" disabled={Boolean(scheduleRecheck)} onClick={() => { if (!scheduleRecheck) setModal("schedule"); }}>
              <CalendarDays size={15} />
              安排计划
            </Button>}
          </>
        ) : null}
        moreActions={canManage ? <>
                {requirement.executionMode!=='direct'&&!['pending_acceptance', 'completed', 'cancelled'].includes(requirement.status) && <Button variant="secondary" disabled={Boolean(commandRecheck || correctionRecheck)} type="button" onClick={() => { setCommand('complete-as-planned'); }}><Check size={15} />按期完成（历史补录）</Button>}
                {!['completed', 'cancelled'].includes(requirement.status) && <Button variant="secondary" tone="danger" disabled={Boolean(commandRecheck || correctionRecheck)} type="button" className="danger" onClick={() => { setCommand('cancel'); }}><CircleStop size={15} />取消需求</Button>}
                {['completed', 'cancelled'].includes(requirement.status) && <Button variant="secondary" disabled={Boolean(commandRecheck || correctionRecheck)} type="button" onClick={() => { setModal('correction'); }}><PencilLine size={15} />纠错</Button>}
                {['completed', 'cancelled'].includes(requirement.status) && <Button variant="secondary" tone="danger" disabled={Boolean(commandRecheck || correctionRecheck)} type="button" className="danger" onClick={() => { setCommand('archive'); }}><Archive size={15} />归档需求</Button>}
        </> : null}
      />;
  const notices = <>
        {infoRecheck && <div className="warning-banner" role="alert">需求信息修改结果待核对，原需求版本与草稿已锁定。<Button variant="secondary" type="button" className="ghost-button" disabled={!peopleReady} onClick={() => setModal("info")}>核对信息修改</Button></div>}
        {scheduleRecheck && <div className="warning-banner" role="alert">需求计划调整结果待核对，原需求版本与草稿已锁定。<Button variant="secondary" type="button" className="ghost-button" onClick={() => setModal("schedule")}>核对计划调整</Button></div>}
        {planRecheck && <div className="warning-banner" role="alert">补全计划结果待核对，原需求版本与草稿已锁定。<Button variant="secondary" type="button" className="ghost-button" disabled={templatesQuery.data === undefined} onClick={() => setModal("template")}>核对补全计划</Button></div>}
        {correctionRecheck && <div className="warning-banner" role="alert">需求纠错结果待核对，原需求版本与草稿已锁定。<Button variant="secondary" type="button" className="ghost-button" disabled={!peopleReady} onClick={() => setModal("correction")}>核对纠错</Button></div>}
        {commandRecheck && <div className="warning-banner" role="alert">{commandRecheck.action === 'cancel' ? '取消需求' : commandRecheck.action === 'archive' ? '归档需求' : '按期完成'}结果待核对，原需求版本已锁定。<Button variant="secondary" type="button" className="ghost-button" onClick={() => setCommand(commandRecheck.action)}>核对需求操作</Button></div>}
        {workEditorNeedsRecheck && <div className="warning-banner" role="alert">工作项设置结果待核对，设置操作暂不可用。<Button busy={(workEditorRechecking)} aria-label={workEditorRechecking ? "读取中…" : "重新读取需求"} variant="secondary" type="button" className="ghost-button" disabled={workEditorRechecking} onClick={() => void recheckWorkEditor()}>{"重新读取需求"}</Button></div>}
        {supportingError && <div className="warning-banner">{supportingDataReady ? "人员与流程数据刷新失败，当前使用上次成功结果。" : "人员或流程数据加载失败，相关编辑操作暂不可用。"}<Button variant="secondary" className="ghost-button" disabled={peopleQuery.isFetching || templatesQuery.isFetching} onClick={() => void Promise.all([peopleQuery.refetch(), templatesQuery.refetch()])}>重新加载</Button></div>}
</>;
  const history = <><section className="detail-grid progress-detail-grid">
        <DetailCard title="进展记录" className="progress-detail-card paged-panel">
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
            {!historyPagination.items.length && <EmptyState title="暂无进展" detail={direct ? "开始需求或更新完成度后，这里会显示执行记录。" : "开始工作项、更新完成度或完成工作项后，这里会显示执行记录。"} />}
          </div>
          <Pagination {...historyPagination.props} label="需求进展分页" />
        </DetailCard>
        <DetailCard title={selectedWorkItemId?"需求进度趋势":"进度趋势"} className="progress-detail-card">
          {requirement.progressUpdates?.length ? <Chart option={progressOption} height={270} ariaLabel="需求计划与实际进度趋势" /> : <EmptyState title="暂无趋势" detail="产生执行记录后自动生成趋势图。" />}
        </DetailCard>
      </section></>;
  return <div className={embedded ? "requirement-page embedded-requirement" : "page-content requirement-page"}>
    {error && <RefreshNotice pending={isFetching} onRetry={() => void refetch()} />}
    <DetailWorkspace label="需求详情" initialTab="overview" actions={requirementHeader} tabs={[
      {id: 'overview', label: '概况', description:'需求说明与执行进展', content: <>{notices}<RequirementOverview requirement={requirement} compact={embedded}/></>},
      {id: 'work', label: `工作项 ${requirement.workItems.length}`, content: workList},
      {id: 'basic', label: '资料', description:'背景与验收信息', content: <><DetailCard title="需求资料"><dl className="object-facts"><div><dt>所属特性 / Phase</dt><dd>{requirement.featureName||'未关联特性'} / {requirement.phaseName||'未分派阶段'}</dd></div><div className="object-fact-wide"><dt>说明</dt><dd>{requirement.background||'尚未填写'}</dd></div><div className="object-fact-wide"><dt>完成标准</dt><dd>{requirement.acceptanceCriteria||'尚未填写'}</dd></div></dl>{!!requirement.readinessIssues?.length && <p className="object-info-note">{requirement.readinessIssues.join('；')}</p>}</DetailCard><RequirementSources links={requirement.referenceLinks} notes={requirement.sourceNotes} referenceUrl={requirement.referenceUrl}/></>},
      {id: 'dependencies', label: '依赖', actions: <Button variant="secondary" aria-label={guest?"在关系图中查看依赖":"在关系图中维护依赖"} title={guest?"在关系图中查看依赖":"在关系图中维护依赖"} onClick={openPathView}>{guest?"查看依赖":"编辑依赖"}</Button>, content: <ObjectDependencies requirementId={id} onOpenGraph={openPathView}/>},
      {id: 'history', label: '记录', content: history},
    ]}>
      {modal === "info" && (
        <RequirementInfoForm requirement={requirement} people={people} recheck={infoRecheck} onRecheckChange={setInfoRecheck} onClose={() => setModal(null)} />
      )}
      {modal === "correction" && (
        <RequirementCorrectionForm requirement={requirement} people={people} recheck={correctionRecheck} onRecheckChange={setCorrectionRecheck} onClose={() => setModal(null)} />
      )}
      {modal === "schedule" && (
        <RequirementScheduleForm key={requirement.id} requirement={requirement} recheck={scheduleRecheck} onRecheckChange={setScheduleRecheck} onClose={() => setModal(null)} />
      )}
      {modal === "template" && (
        <PlanForm key={requirement.id} requirement={requirement} templates={templates} recheck={planRecheck} onRecheckChange={setPlanRecheck} onClose={() => setModal(null)} />
      )}
      {command && <RequirementCommandDialog key={`${id}:${command}`} action={command} requirement={requirement} recheck={commandRecheck} onRecheckChange={setCommandRecheck} onClose={() => setCommand(null)} onArchived={() => navigate('/')} onReload={async () => {
        const latest = await refetch({ throwOnError: true });
        if (!latest.data) throw new Error('需求已无法读取，请关闭操作窗口。');
        return latest.data;
      }} />}

    </DetailWorkspace>
  </div>;
}
