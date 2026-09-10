import {Fragment} from 'react';
import {GroupManager,OrganizationBatchDialog,OrganizationFilters,matchesOrganization,useIntake} from '../components/RequirementIntake';
import {RequirementImport} from '../components/RequirementImport';
import {compareProcessingPriority} from '../../shared/delivery';
import { usePageSearchParams, usePageScrollPosition } from "../use-page-view";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronsUpDown, Plus } from "lucide-react";
import { api } from "../api";
import { useProjects, useSession } from "../app-context";
import { keys } from "../query-keys";
import type { Requirement } from "../types";
import { isTerminalRequirementStatus } from "../../shared/domain";
import { matchesSearch, searchScore } from "../../shared/search";
import { EmptyState } from "../components/Feedback";
import { StatusBadge } from "../components/Badge";
import { PageHeader } from "../components/PageHeader";
import { RequirementForm } from "../components/ManagementForms";
import { canManageProject } from "../permissions";
import { requirementStatusOptions } from "../ui-options";
import { DataCell } from "../components/LayoutPrimitives";
import { SearchInput } from "../components/SearchInput";
import { requirementRiskDisplay, requirementVarianceDisplay, requirementVarianceValue } from "../requirement-presentation";
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
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [groupManager,setGroupManager]=useState(false),[organizing,setOrganizing]=useState(false);
  const intake=useIntake(selectedProjectId);
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const [params, setParams] = usePageSearchParams(['q', 'status', 'sort', 'direction','deliveryScope','group','grouped','intakeView']);
  const group=params.get('group')||'',grouped=params.get('grouped')==='1',intakeView=params.get('intakeView')||'requirements';
  const setView=(key:string,value:string)=>setParams(current=>{const next=new URLSearchParams(current);if(value)next.set(key,value);else next.delete(key);return next;});
  const search = params.get('q') || '';
  const status = params.has('status') ? params.get('status')! : 'current';
  const sortKey = (['title','priority','status','progress','risk','plannedEnd','variance'].includes(params.get('sort') || '') ? params.get('sort') : 'plannedEnd') as RequirementSortKey;
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
        matchesOrganization(item,group)&&matchesSearch([
          { text: item.title, weight: 100 },
          { text: item.ownerName, weight: 40 },
        ], search) &&
        (status === "current" ? !isTerminalRequirementStatus(item.status) : !status || item.status === status),
      )
      .sort((left, right) => {
        if(grouped&&left.groupId!==right.groupId){const groups=intake.data?.groups||[];return (groups.findIndex(g=>g.id===left.groupId)+1||9999)-(groups.findIndex(g=>g.id===right.groupId)+1||9999);}
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
  }, [data, search, sortDirection, sortKey, status,group,grouped,intake.data?.groups]);
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
      {groupManager&&<GroupManager projectId={selectedProjectId} onClose={()=>setGroupManager(false)}/>}
      {organizing&&<OrganizationBatchDialog projectId={selectedProjectId} requirements={data.filter(r=>selectedIds.includes(r.id))} onClose={()=>setOrganizing(false)}/>}
      <PageHeader
        title="需求管理"
        actions={canManage ? (
          <button className="primary-button" disabled={!selectedProjectId} onClick={() => setCreating(true)} title={selectedProjectId ? "新建需求" : "请先创建项目"}>
            <Plus size={16} />
            新建需求
          </button>
        ) : null}
      />
      <div className="page-content">
      <div className="intake-tabs" role="tablist" aria-label="需求视图">{[["requirements","需求"],...(canManage?[["import","导入预览"]]:[])].map(([id,label])=><button key={id} role="tab" aria-selected={intakeView===id} className="ghost-button" onClick={()=>setView("intakeView",id)}>{label}</button>)}</div>
      {intakeView==="import"&&canManage?<RequirementImport key={session.accountId+":"+selectedProjectId} projectId={selectedProjectId}/>:<>
        <div className="filter-bar">
        <OrganizationFilters items={data} group={group} onGroup={v=>setView("group",v)}/>
        <label className="requirement-group-toggle"><input type="checkbox" checked={grouped} onChange={e=>setView("grouped",e.target.checked?"1":"")}/><span>按分组查看</span></label>
        {canManage&&<button className="ghost-button" onClick={()=>setGroupManager(true)}>管理分组</button>}
        {canManage&&selectedIds.length>0&&<button className="ghost-button" onClick={()=>setOrganizing(true)}>整理所选需求</button>}
        <SearchInput value={search} onChange={setSearch} placeholder="搜索需求或负责人" />
        <select
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
        </select>
        <span>
          {projects.find((p) => p.id === selectedProjectId)?.name || "全部项目"}{" "}
          · {items.length}/{data.length}项
        </span>
      </div>
      {error && loadedRequirements && <div className="warning-banner">需求列表刷新失败，当前展示的是上次成功结果。<button className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</button></div>}
      <div className="table-panel requirements-table-panel">
        <table className="requirements-table">
          <thead>
            <tr>
              <th aria-sort={sortKey === "title" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>{sortableHeader("需求", "title")}</th>
              <th aria-sort={sortKey === "status" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>{sortableHeader("状态", "status")}</th>
              <th aria-sort={sortKey === "progress" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>{sortableHeader("进度", "progress")}</th>
              <th aria-sort={sortKey === "risk" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>{sortableHeader("风险", "risk")}</th>
              <th aria-sort={sortKey === "plannedEnd" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>{sortableHeader("计划完成", "plannedEnd")}</th>
              <th aria-sort={sortKey === "variance" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>{sortableHeader("计划偏差", "variance")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item,index) => {
              const variance = requirementVarianceDisplay(item);
              return <Fragment key={item.id}>{grouped&&(index===0||items[index-1].groupId!==item.groupId)&&<tr className="intake-group-heading"><td colSpan={6}>{item.groupName||"未分组"} · {items.filter(r=>r.groupId===item.groupId).length} 项</td></tr>}<tr
                key={item.id}
                onClick={() => navigate(`/requirements/${item.id}`)}
              >
                <td><DataCell density="compact" primary={<strong>{canManage&&!isTerminalRequirementStatus(item.status)&&<input type="checkbox" style={{marginRight:8,verticalAlign:'middle'}} aria-label={'选择需求 '+item.title} checked={selectedIds.includes(item.id)} onClick={e=>e.stopPropagation()} onChange={e=>setSelectedIds(ids=>e.target.checked?[...ids,item.id]:ids.filter(id=>id!==item.id))}/>}<Link to={`/requirements/${item.id}`} style={{ color: 'inherit', textDecoration: 'none' }} onClick={event => event.stopPropagation()}>{item.title}</Link></strong>} secondary={`${item.groupName?item.groupName+" · ":""}${item.projectName} · 负责人 ${item.ownerName || "待指定"}`} /></td>
                <td>
                  <DataCell density="compact" primary={<StatusBadge kind="requirement" value={item.status} />} />
                </td>
                <td>
                  <DataCell density="compact" primary={<div className="table-progress">
                    <span>
                      <i style={{ width: `${item.progress}%` }} />
                    </span>
                    <b>{item.progress}%</b>
                  </div>} />
                </td>
                <td>
                  <DataCell density="compact" primary={<span className={`risk-badge ${requirementRiskDisplay(item).className}`}>{requirementRiskDisplay(item).label}</span>} />
                </td>
                <td><DataCell density="compact" primary={item.plannedEnd || "待排期"} /></td>
                <td className={variance.className} title={variance.title}>
                  <DataCell density="compact" primary={variance.label} />
                </td>
              </tr></Fragment>
            })}
          </tbody>
        </table>
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
          <RequirementForm projectId={selectedProjectId} onClose={() => setCreating(false)} />
        )}
      </div>
    </>
  );
}
