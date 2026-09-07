import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronsUpDown, Plus } from "lucide-react";
import { api, jsonBody } from "../api";
import { useProjects, useSession } from "../app-context";
import { invalidateRequirementViews, keys } from "../query-keys";
import type { Requirement } from "../types";
import { isTerminalRequirementStatus } from "../../shared/domain";
import { matchesSearch, searchScore } from "../../shared/search";
import { EmptyState } from "../components/Feedback";
import { StatusBadge } from "../components/Badge";
import { PageHeader } from "../components/PageHeader";
import { RequirementForm } from "../components/ManagementForms";
import { InlineSelectCell } from "../components/InlineEdit";
import { canManageProject } from "../permissions";
import { priorityOptions, requirementStatusOptions } from "../ui-options";
import { DataCell } from "../components/LayoutPrimitives";
import { SearchInput } from "../components/SearchInput";
import { useOptimisticMutation } from "../use-optimistic-mutation";

type RequirementSortKey = "title" | "priority" | "status" | "progress" | "risk" | "plannedEnd" | "variance";
type SortDirection = "asc" | "desc";

const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const requirementStatusOrder: Record<string, number> = {
  blocked: 0,
  in_progress: 1,
  not_started: 2,
  planning: 3,
  pending_acceptance: 4,
  completed: 5,
  cancelled: 6,
};
const riskOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
const emptyRequirements: Requirement[] = [];

function requirementVarianceValue(requirement: Requirement): number | null {
  if (requirement.status === "planning" || requirement.status === "cancelled") return null;
  if (["completed", "pending_acceptance"].includes(requirement.status)) return requirement.finishVariance;
  if (requirement.finishVariance > 0) return requirement.finishVariance;
  if (requirement.status === "not_started" && requirement.progress === 0 && requirement.plannedProgress === 0) return null;
  return requirement.scheduleVarianceDays ?? null;
}

function requirementVarianceDisplay(requirement: Requirement) {
  const progressDetail = `实际进度 ${requirement.progress}%，计划进度 ${requirement.plannedProgress}%`;
  if (requirement.status === "planning") {
    return { label: "待排期", className: "muted", title: "工作项排期尚不完整，暂时无法计算计划偏差" };
  }
  if (requirement.status === "cancelled") {
    return { label: "已取消", className: "muted", title: "已取消需求不再计算计划偏差" };
  }
  if (requirement.status === "not_started" && requirement.progress === 0 && requirement.plannedProgress === 0) {
    return { label: "未到计划", className: "muted", title: "尚未到计划开始时间" };
  }
  if (["completed", "pending_acceptance"].includes(requirement.status)) {
    if (requirement.finishVariance > 0) {
      return { label: `延期 ${requirement.finishVariance}个工作日`, className: "danger-text", title: "实际完成日期晚于计划完成日期" };
    }
    if (requirement.finishVariance < 0) {
      return { label: `提前 ${Math.abs(requirement.finishVariance)}个工作日`, className: "safe-text", title: "实际完成日期早于计划完成日期" };
    }
    return { label: "按期", className: "", title: "实际完成日期与计划完成日期一致" };
  }
  if (requirement.finishVariance > 0) {
    return {
      label: `已延期 ${requirement.finishVariance}个工作日`,
      className: "danger-text",
      title: `${progressDetail}；截至今天已超过计划完成日期`,
    };
  }

  const variance = requirement.scheduleVarianceDays;
  const reference = requirement.scheduleReferenceDate ? `；当前进展相当于 ${requirement.scheduleReferenceDate} 的计划` : "";
  if (variance === null || variance === undefined) {
    return { label: "待评估", className: "muted", title: `${progressDetail}；暂时无法换算计划偏差` };
  }
  if (variance > 0) {
    return { label: `落后 ${variance}个工作日`, className: "danger-text", title: `${progressDetail}${reference}，落后 ${variance} 个工作日` };
  }
  if (variance < 0) {
    return { label: `领先 ${Math.abs(variance)}个工作日`, className: "safe-text", title: `${progressDetail}${reference}，领先 ${Math.abs(variance)} 个工作日` };
  }
  return { label: "按计划", className: "", title: `${progressDetail}；当前进展与计划曲线一致` };
}

function compareRequirements(left: Requirement, right: Requirement, key: RequirementSortKey) {
  switch (key) {
    case "title":
      return left.title.localeCompare(right.title, "zh-CN");
    case "priority":
      return (priorityOrder[left.priority] ?? 99) - (priorityOrder[right.priority] ?? 99);
    case "status":
      return (requirementStatusOrder[left.status] ?? 99) - (requirementStatusOrder[right.status] ?? 99);
    case "progress":
      return left.progress - right.progress;
    case "risk":
      return (riskOrder[left.highRisk ? "high" : left.riskLevel] ?? 99) - (riskOrder[right.highRisk ? "high" : right.riskLevel] ?? 99);
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
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("current");
  const [sortKey, setSortKey] = useState<RequirementSortKey>("plannedEnd");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
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
  const data = loadedRequirements || emptyRequirements;
  const listUnavailable = Boolean(error && !loadedRequirements);
  const items = useMemo(() => {
    return data
      .filter((item) =>
        matchesSearch([
          { text: item.title, weight: 100 },
          { text: item.ownerName, weight: 40 },
        ], search) &&
        (status === "current" ? !isTerminalRequirementStatus(item.status) : !status || item.status === status),
      )
      .sort((left, right) => {
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
  }, [data, search, sortDirection, sortKey, status]);
  const runRequirementSave = useOptimisticMutation<{ item: Requirement; input: { priority?: string } }, Requirement>({
    snapshotKeys: ({ item }) => [[...keys.requirements, selectedProjectId], keys.requirement(item.id)],
    apply: (queryClient, { item, input }) => {
      queryClient.setQueryData<Requirement[]>([...keys.requirements, selectedProjectId], (current = []) => current.map((entry) => entry.id === item.id && entry.version <= item.version ? { ...entry, ...input } : entry));
      queryClient.setQueryData<Requirement>(keys.requirement(item.id), (current) => current && current.version <= item.version ? { ...current, ...input } : current);
    },
    request: ({ item, input }) => api<Requirement>(`/api/requirements/${item.id}`, { method: "PATCH", body: jsonBody({ ...input, expectedVersion: item.version }) }),
    commit: (queryClient, saved) => {
      queryClient.setQueryData<Requirement[]>([...keys.requirements, selectedProjectId], (current = []) => current.map((entry) => entry.id === saved.id && entry.version <= saved.version ? saved : entry));
      queryClient.setQueryData<Requirement>(keys.requirement(saved.id), (current) => current && current.version <= saved.version ? saved : current);
      invalidateRequirementViews(queryClient, saved.id);
    },
  });
  const saveRequirement = (item: Requirement, input: { priority?: string }) => runRequirementSave({ item, input });
  const changeSort = (nextKey: RequirementSortKey) => {
    if (nextKey === sortKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "variance" ? "desc" : "asc");
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
        <div className="filter-bar">
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
              <th aria-sort={sortKey === "priority" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>{sortableHeader("优先级", "priority")}</th>
              <th aria-sort={sortKey === "status" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>{sortableHeader("状态", "status")}</th>
              <th aria-sort={sortKey === "progress" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>{sortableHeader("进度", "progress")}</th>
              <th aria-sort={sortKey === "risk" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>{sortableHeader("风险", "risk")}</th>
              <th aria-sort={sortKey === "plannedEnd" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>{sortableHeader("计划完成", "plannedEnd")}</th>
              <th aria-sort={sortKey === "variance" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>{sortableHeader("计划偏差", "variance")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const variance = requirementVarianceDisplay(item);
              return <tr
                key={item.id}
                onClick={() => navigate(`/requirements/${item.id}`)}
              >
                <td><DataCell density="compact" primary={<strong>{item.title}</strong>} secondary={`${item.projectName} · 负责人 ${item.ownerName || "待指定"}`} /></td>
                <td><DataCell density="compact" primary={canManage ? <InlineSelectCell
                  value={item.priority}
                  label="需求优先级"
                  options={priorityOptions}
                  displayMode="badge"
                  onSave={(priority) => saveRequirement(item, { priority })}
                  renderValue={(value) => <StatusBadge kind="priority" value={value} />}
                /> : <StatusBadge kind="priority" value={item.priority} />} /></td>
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
                  <DataCell density="compact" primary={!item.riskEvaluated ? (
                    <span className="risk-badge risk-pending">待评估</span>
                  ) : (
                    <StatusBadge kind="risk" value={item.highRisk ? "high" : item.riskLevel} />
                  )} />
                </td>
                <td><DataCell density="compact" primary={item.plannedEnd || "待排期"} /></td>
                <td className={variance.className} title={variance.title}>
                  <DataCell density="compact" primary={variance.label} />
                </td>
              </tr>
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
        {creating && selectedProjectId && (
          <RequirementForm projectId={selectedProjectId} onClose={() => setCreating(false)} />
        )}
      </div>
    </>
  );
}
