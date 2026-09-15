import {Select} from '../components/Select';
import {executionStageOf} from '../components/ExecutionStageBadge';
import {useAppNavigate} from '../use-app-navigation';
import { Pagination } from '../components/Pagination';
import { useListPagination } from '../use-list-pagination';
import {Fragment, useEffect, useRef} from 'react';
import {OrganizationBatchDialog,OrganizationFilters,matchesOrganization,persistOrganizationBatchRecheck,readOrganizationBatchRecheck,useIntake,type OrganizationBatchRecheck} from '../components/RequirementIntake';
import {RequirementImport} from '../components/RequirementImport';
import {compareProcessingPriority} from '../../shared/delivery';
import { usePageSearchParams, usePageScrollPosition } from "../use-page-view";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronsUpDown, Plus } from "lucide-react";
import { api } from "../api";
import { useProjects, useSession } from "../app-context";
import { keys } from "../query-keys";
import type { Requirement } from "../types";
import { isTerminalRequirementStatus } from "../../shared/domain";
import { matchesSearch, searchScore } from "../../shared/search";
import { EmptyState } from "../components/Feedback";
import { PageHeader } from "../components/PageHeader";
import { RequirementForm,persistRequirementCreateRecheck,readRequirementCreateRecheck,type RequirementCreateRecheck } from "../components/ManagementForms";
import { canManageProject } from "../permissions";
import { requirementStatusOptions } from "../ui-options";
import { DataCell } from "../components/LayoutPrimitives";
import { SearchInput } from "../components/SearchInput";
import { requirementVarianceValue } from "../requirement-presentation";
import { compareRiskRequirements } from "../../shared/requirement-view";

type RequirementSortKey = "title" | "priority" | "status" | "progress" | "risk" | "plannedEnd" | "variance";
type SortDirection = "asc" | "desc";

const requirementStatusOrder: Record<string, number> = {
  blocked: 0,
  in_progress: 1,
  not_started: 2,
  planning: 3,
  pending_acceptance: 4,
  completed: 5,
  cancelled: 6,
};
const emptyRequirements: Requirement[] = [];

function compareRequirements(left: Requirement, right: Requirement, key: RequirementSortKey) {
  switch (key) {
    case "title":
      return left.title.localeCompare(right.title, "zh-CN");
    case "priority":
      return compareProcessingPriority(left,right);
    case "status":
      return (requirementStatusOrder[left.status] ?? 99) - (requirementStatusOrder[right.status] ?? 99);
    case "progress":
      return left.progress - right.progress;
    case "risk":
      return compareRiskRequirements(left, right);
    case "variance":
      return (requirementVarianceValue(left) ?? 0) - (requirementVarianceValue(right) ?? 0);
    case "plannedEnd":
    default:
      if (!left.plannedEnd && !right.plannedEnd) return 0;
      if (!left.plannedEnd) return 1;
      if (!right.plannedEnd) return -1;
      return left.plannedEnd.localeCompare(right.plannedEnd);
  }
}
export function RequirementsPage() {
  const { session } = useSession();
  const { selectedProjectId, projects } = useProjects();
  const navigate = useAppNavigate();
  const recheckAccountKey=session.accountId||session.username||'guest';
  const [creating, setCreating] = useState(false);
  const [organizing,setOrganizing]=useState(false);
  const intake=useIntake(selectedProjectId);
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const [organizationRecheck,setOrganizationRecheckState]=useState<OrganizationBatchRecheck|null>(()=>readOrganizationBatchRecheck(recheckAccountKey,selectedProjectId));
  const [createRecheck,setCreateRecheckState]=useState<RequirementCreateRecheck|null>(()=>readRequirementCreateRecheck(recheckAccountKey,selectedProjectId));
  const setOrganizationRecheck=(value:OrganizationBatchRecheck|null)=>{persistOrganizationBatchRecheck(recheckAccountKey,selectedProjectId,value);setOrganizationRecheckState(value);};
  const setCreateRecheck=(value:RequirementCreateRecheck|null)=>{persistRequirementCreateRecheck(recheckAccountKey,selectedProjectId,value);setCreateRecheckState(value);};
  useEffect(()=>{const organizationPending=readOrganizationBatchRecheck(recheckAccountKey,selectedProjectId);setOrganizationRecheckState(organizationPending);setCreateRecheckState(readRequirementCreateRecheck(recheckAccountKey,selectedProjectId));setSelectedIds(organizationPending?.requirementIds||[]);setCreating(false);setOrganizing(false);},[recheckAccountKey,selectedProjectId]);
  const [params, setParams] = usePageSearchParams(['q', 'status', 'sort', 'direction','deliveryScope','feature','grouped','intakeView','phase','stage']);
  const feature=params.get('feature')||'',grouped=params.get('grouped')==='1',intakeView=params.get('intakeView')||'requirements';
  const setView=(key:string,value:string)=>setParams(current=>{const next=new URLSearchParams(current);if(value)next.set(key,value);else next.delete(key);return next;});
  const search = params.get('q') || '';
  const status = params.has('status') ? params.get('status')! : 'current';
  const sortKey = (['title','priority','status','progress','risk','plannedEnd','variance'].includes(params.get('sort') || '') ? params.get('sort') : 'title') as RequirementSortKey;
  const sortDirection: SortDirection = params.get('direction') === 'desc' ? 'desc' : 'asc';
  const setSearch = (value: string) => setParams(current => { const next = new URLSearchParams(current); next.set('q', value); return next; });
  const setStatus = (value: string) => setParams(current => { const next = new URLSearchParams(current); next.set('status', value); return next; });
  const canManage = canManageProject(session, selectedProjectId);
  const { data: loadedRequirements, error, refetch, isFetching, isLoading } = useQuery({
    queryKey: [...keys.requirements, selectedProjectId],
    queryFn: ({ signal }) =>
      api<Requirement[]>(
        `/api/requirements${selectedProjectId ? `?projectId=${selectedProjectId}` : ""}`,
        { signal },
      ),
    enabled: Boolean(selectedProjectId),
  });
  usePageScrollPosition(!isLoading);
  const data = loadedRequirements || emptyRequirements;
  const listUnavailable = Boolean(error && !loadedRequirements);
  const items = useMemo(() => {
    return data
      .filter((item) =>
        matchesOrganization(item,feature)&&(!params.get('phase')||(params.get('phase')==='unassigned'?!item.phaseId:item.phaseId===params.get('phase')))&&(!params.get('stage')||executionStageOf(item).key===params.get('stage'))&&matchesSearch([
          { text: item.title, weight: 100 },
          { text: item.ownerName, weight: 40 },
        ], search) &&
        (status === "current" ? !isTerminalRequirementStatus(item.status) : !status || item.status === status),
      )
      .sort((left, right) => {
        if(grouped&&left.featureId!==right.featureId){const features=intake.data?.features||[];return (features.findIndex(g=>g.id===left.featureId)+1||9999)-(features.findIndex(g=>g.id===right.featureId)+1||9999);}
        if (search.trim()) {
          const relevance = searchScore([
            { text: right.title, weight: 100 },
            { text: right.ownerName, weight: 40 },
          ], search) - searchScore([
            { text: left.title, weight: 100 },
            { text: left.ownerName, weight: 40 },
          ], search);
          if (relevance !== 0) return relevance;
        }
        if (sortKey === "variance") {
          const leftVariance = requirementVarianceValue(left);
          const rightVariance = requirementVarianceValue(right);
          if (leftVariance === null && rightVariance !== null) return 1;
          if (leftVariance !== null && rightVariance === null) return -1;
        }
        const result = compareRequirements(left, right, sortKey);
        if (result !== 0) return sortDirection === "asc" ? result : -result;
        const priorityResult = compareRequirements(left, right, "priority");
        if (priorityResult !== 0) return priorityResult;
        return left.title.localeCompare(right.title, "zh-CN");
      });
  }, [data, search, sortDirection, sortKey, status,feature,grouped,intake.data?.features,params]);
  const filterKey = JSON.stringify([search, status, feature, grouped, sortKey, sortDirection,params.get('phase'),params.get('stage')]);
  const pagination = useListPagination({ items, filterKey, ready: Boolean(loadedRequirements), loading: isFetching });
  const selectionFilter = JSON.stringify([search, status, feature]);
  const previousSelectionFilter = useRef(selectionFilter);
  useEffect(() => { if (previousSelectionFilter.current !== selectionFilter && !organizationRecheck) setSelectedIds([]); previousSelectionFilter.current = selectionFilter; }, [selectionFilter, organizationRecheck]);
  const changeSort = (nextKey: RequirementSortKey) => {
    setParams(current => { const next = new URLSearchParams(current); next.set('sort', nextKey); next.set('direction', nextKey === sortKey ? (sortDirection === 'asc' ? 'desc' : 'asc') : nextKey === 'variance' ? 'desc' : 'asc'); return next; });
  };
  const sortableHeader = (label: string, key: RequirementSortKey) => (
    <button
      type="button"
      className={`sortable-table-heading${sortKey === key ? " is-active" : ""}`}
      onClick={() => changeSort(key)}
      title={`按${label}${sortKey === key && sortDirection === "asc" ? "倒序" : "正序"}排列`}
    >
      {label}
      {sortKey !== key ? <ChevronsUpDown size={14} /> : sortDirection === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
    </button>
  );
  return (
    <>
      {organizing&&<OrganizationBatchDialog projectId={selectedProjectId} requirements={data.filter(r=>(organizationRecheck?.requirementIds||selectedIds).includes(r.id))} recheck={organizationRecheck} onRecheckChange={setOrganizationRecheck} onClose={()=>setOrganizing(false)}/>}
      <PageHeader
        title="项目工作区"
        breadcrumbs={[{label:"项目特性",onClick:()=>navigate("/?view=features&mode=table")},{label:"需求维护"}]}
        onBack={()=>navigate("/?view=features&mode=table")}

        secondaryActions={canManage&&<button className="ghost-button" onClick={()=>navigate("/features")}>特性规划</button>}
        actions={canManage ? (
          <div className="page-editor-actions"><div className="page-editor-history"/><div className="page-editor-primary"><button className="primary-button" aria-label="新建需求" disabled={!selectedProjectId||Boolean(createRecheck)} onClick={() => {if(selectedProjectId&&!createRecheck)setCreating(true);}} title={selectedProjectId ? createRecheck?'请先核对上次创建结果':"新建需求" : "请先创建项目"}>
            <Plus size={16} />
            新建
          </button></div></div>
        ) : null}
      />
      <div className="page-content">
      <div className="workspace-intake-tools" data-workspace-zone="tools"><div className="view-tabs" role="tablist" aria-label="需求视图">{[["requirements","需求"],...(canManage?[["import","导入预览"]]:[])].map(([id,label])=><button key={id} role="tab" aria-selected={intakeView===id} className="ghost-button" onClick={()=>setView("intakeView",id)}>{label}</button>)}</div></div>
      {intakeView==="import"&&canManage?<RequirementImport key={session.accountId+":"+selectedProjectId} projectId={selectedProjectId}/>:<>
        <div className="filter-bar">
        <OrganizationFilters items={data} feature={feature} onFeature={v=>setView("feature",v)}/>
        <label className="requirement-feature-toggle"><input type="checkbox" checked={grouped} onChange={e=>setView("grouped",e.target.checked?"1":"")}/><span>按特性查看</span></label>
        {canManage&&selectedIds.length>0&&<><span>已选择 {selectedIds.length} 项</span><button className="ghost-button" disabled={Boolean(organizationRecheck)} onClick={()=>{if(!organizationRecheck)setOrganizing(true);}}>整理所选需求</button></>}
        <SearchInput value={search} onChange={setSearch} placeholder="搜索需求或负责人" />
        <Select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="current">当前需求</option>
          <option value="">全部状态</option>
          {requirementStatusOptions.map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <span>
          {projects.find((p) => p.id === selectedProjectId)?.name || "全部项目"}{" "}
          · {items.length}/{data.length}项
        </span>
      </div>
      {(params.get('phase')||params.get('stage'))&&<div className="warning-banner">正在查看指定 Phase 或执行阶段的需求。<button className="ghost-button" onClick={()=>setParams(old=>{const next=new URLSearchParams(old);next.delete('phase');next.delete('stage');return next;})}>清除 Phase 与阶段筛选</button></div>}
      {organizationRecheck&&<div role="alert" className="warning-banner">整理结果待核对，批量整理暂不可用。<button type="button" className="ghost-button" onClick={()=>setOrganizing(true)}>核对整理结果</button></div>}
      {createRecheck&&<div role="alert" className="warning-banner">需求创建结果待核对，新建入口暂不可用。<button type="button" className="ghost-button" onClick={()=>setCreating(true)}>核对需求创建</button></div>}
      {error && loadedRequirements && <div className="warning-banner">需求列表刷新失败，当前展示的是上次成功结果。<button className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</button></div>}
      <div className="table-panel requirements-table-panel paged-panel">
        <div className="paged-body" ref={pagination.scrollRef}>
        <table className="requirements-table">
          <thead>
            <tr>
              <th aria-sort={sortKey === "title" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>{sortableHeader("需求", "title")}</th>
              <th>完成标准</th><th>Phase</th><th>工作分解</th><th>说明</th><th>来源</th>
            </tr>
          </thead>
          <tbody>
            {pagination.items.map((item,index) => {

              return <Fragment key={item.id}>{grouped&&(index===0||pagination.items[index-1].featureId!==item.featureId)&&<tr className="intake-feature-heading"><td colSpan={6}>{item.featureName||"未关联特性"} · {items.filter(r=>r.featureId===item.featureId).length} 项</td></tr>}<tr
                key={item.id}
                onClick={() => navigate(`/requirements/${item.id}`)}
              >
                <td><DataCell density="compact" primary={<strong>{canManage&&<input type="checkbox" style={{marginRight:8,verticalAlign:'middle'}} aria-label={'选择需求 '+item.title} checked={selectedIds.includes(item.id)} disabled={Boolean(organizationRecheck)} onClick={e=>e.stopPropagation()} onChange={e=>{if(!organizationRecheck)setSelectedIds(ids=>e.target.checked?[...ids,item.id]:ids.filter(id=>id!==item.id));}}/>}<Link to={`/requirements/${item.id}`} style={{ color: 'inherit', textDecoration: 'none' }} onClick={event => event.stopPropagation()}>{item.title}</Link></strong>} secondary={`${item.featureName?item.featureName+" · ":""}${item.projectName} · 负责人 ${item.ownerName || "待指定"}`} /></td>
                <td><DataCell density="compact" primary={item.acceptanceCriteria||'完成标准待补充'}/></td>
                <td><DataCell density="compact" primary={item.phaseName||'未安排 Phase'}/></td>
                <td><DataCell density="compact" primary={item.workItems.length+' 个工作项'} secondary={item.executionMode==='direct'?'直接执行':!item.workItems.length?'尚未分解':''}/></td>
                <td><DataCell density="compact" primary={item.background||'说明待补充'}/></td>
                <td><DataCell density="compact" primary={item.sourceNotes||'—'}/></td>
              </tr></Fragment>
            })}
          </tbody>
        </table>
        </div>
        {!listUnavailable && <Pagination {...pagination.props} label="需求列表分页" />}
        {listUnavailable ? (
          <EmptyState
            title="需求列表加载失败"
            detail={error?.message || "暂时无法读取需求数据。"}
            action={<button className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</button>}
          />
        ) : !items.length && !isLoading && (
          <EmptyState
            title="没有符合条件的需求"
            detail="调整筛选条件，或新建一条需求。"
          />
        )}
        </div>
        </>}
        {creating && selectedProjectId && (
          <RequirementForm projectId={selectedProjectId} initialRequirementIds={data.map(item=>item.id)} recheck={createRecheck} onRecheckChange={setCreateRecheck} onClose={() => setCreating(false)} />
        )}
      </div>
    </>
  );
}
