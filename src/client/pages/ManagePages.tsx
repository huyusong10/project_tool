import { useDeferredValue, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { addDays, format, parseISO } from "date-fns";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  CircleUserRound,
  Copy,
  Edit3,
  GripVertical,
  KeyRound,
  LocateFixed,
  PlugZap,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { ApiError, api, jsonBody } from "../api";
import { useApp } from "../app-context";
import { invalidateRequirementViews } from "../query-invalidation";
import type {
  ApiToken,
  Archives,
  PeopleConcurrency,
  Person,
  Requirement,
  TemplateItem,
  WorkItemTemplate,
} from "../types";
import { priorityLabels, requirementStatusLabels, riskLabels } from "../../shared/domain";
import { matchesSearch, searchScore } from "../../shared/search";
import { ConfirmDialog, EmptyState, Modal, TextPromptModal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { ProjectForm, RequirementForm } from "../components/ManagementForms";
import { InlineSelectCell } from "../components/InlineEdit";
import { canManageProject, isAdmin } from "../permissions";
import { priorityOptions, requirementStatusOptions } from "../ui-options";
import { DataCell } from "../components/LayoutPrimitives";
import { SortableList } from "../components/SortableList";
import { SearchInput } from "../components/SearchInput";

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
      return { label: `延期 ${requirement.finishVariance}天`, className: "danger-text", title: "实际完成日期晚于计划完成日期" };
    }
    if (requirement.finishVariance < 0) {
      return { label: `提前 ${Math.abs(requirement.finishVariance)}天`, className: "safe-text", title: "实际完成日期早于计划完成日期" };
    }
    return { label: "按期", className: "", title: "实际完成日期与计划完成日期一致" };
  }
  if (requirement.finishVariance > 0) {
    return {
      label: `已延期 ${requirement.finishVariance}天`,
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
    return { label: `落后 ${variance}天`, className: "danger-text", title: `${progressDetail}${reference}，落后 ${variance} 个工作日` };
  }
  if (variance < 0) {
    return { label: `领先 ${Math.abs(variance)}天`, className: "safe-text", title: `${progressDetail}${reference}，领先 ${Math.abs(variance)} 个工作日` };
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
  const { selectedProjectId, projects, session } = useApp();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("current");
  const [sortKey, setSortKey] = useState<RequirementSortKey>("plannedEnd");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const canManage = canManageProject(session, selectedProjectId);
  const { data = [] } = useQuery({
    queryKey: ["requirements", selectedProjectId],
    queryFn: () =>
      api<Requirement[]>(
        `/api/requirements${selectedProjectId ? `?projectId=${selectedProjectId}` : ""}`,
      ),
    enabled: Boolean(selectedProjectId),
  });
  const items = useMemo(() => {
    return data
      .filter((item) =>
        matchesSearch([
          { text: item.title, weight: 100 },
          { text: item.ownerName, weight: 40 },
        ], search) &&
        (status === "current" ? item.status !== "completed" : !status || item.status === status),
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
  const saveRequirement = async (item: Requirement, input: { priority?: string }) => {
    const key = ["requirements", selectedProjectId] as const;
    const previous = client.getQueryData<Requirement[]>(key);
    client.setQueryData<Requirement[]>(key, (current = []) => current.map((entry) => entry.id === item.id ? { ...entry, ...input } : entry));
    try {
      const saved = await api<Requirement>(`/api/requirements/${item.id}`, { method: "PATCH", body: jsonBody({ ...input, expectedVersion: item.version }) });
      client.setQueryData<Requirement[]>(key, (current = []) => current.map((entry) => entry.id === saved.id ? saved : entry));
      invalidateRequirementViews(client, item.id);
    } catch (error) {
      client.setQueryData(key, previous);
      throw error;
    }
  };
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
                  renderValue={(value) => <span className={`priority-badge priority-${value.toLowerCase()}`}>{priorityLabels[value as keyof typeof priorityLabels] || value}</span>}
                /> : <span className={`priority-badge priority-${item.priority.toLowerCase()}`}>{priorityLabels[item.priority as keyof typeof priorityLabels] || item.priority}</span>} /></td>
                <td>
                  <DataCell density="compact" primary={<span className={`status-pill status-${item.status}`}>
                    {
                      requirementStatusLabels[
                        item.status as keyof typeof requirementStatusLabels
                      ]
                    }
                  </span>} />
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
                  ) : item.highRisk ? (
                    <span className="risk-badge risk-high">高风险</span>
                  ) : (
                    riskLabels[item.riskLevel as keyof typeof riskLabels]
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
        {!items.length && (
          <EmptyState
            title="没有符合条件的需求"
            detail="调整筛选条件，或新建一条需求。"
          />
        )}
        </div>
        {creating && selectedProjectId && (
          <Modal title="新建需求" onClose={() => setCreating(false)}>
            <RequirementForm projectId={selectedProjectId} onClose={() => setCreating(false)} />
          </Modal>
        )}
      </div>
    </>
  );
}

export function ProjectsPage() {
  const { projects, selectedProjectId, session } = useApp();
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string } | null>(null);
  const [archiveConflict, setArchiveConflict] = useState<{ id: string; name: string; requirements: number; issues: number } | null>(null);
  const [archiveError, setArchiveError] = useState("");
  const admin = isAdmin(session);
  const archive = useMutation({
    mutationFn: ({ id, force = false }: { id: string; name: string; force?: boolean }) => api(`/api/projects/${id}`, {
      method: "DELETE",
      ...(force ? { body: jsonBody({ force: true }) } : {}),
    }),
    onSuccess: () => {
      setArchiveTarget(null);
      setArchiveConflict(null);
      setArchiveError("");
      void client.invalidateQueries({ queryKey: ["projects"] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      void client.invalidateQueries({ queryKey: ["archives"] });
    },
    onError: (error, input) => {
      if (!input.force && error instanceof ApiError && error.code === "DEPENDENCY_CONFLICT") {
        const details = error.details as { requirements?: number; issues?: number } | undefined;
        setArchiveConflict({ id: input.id, name: input.name, requirements: Number(details?.requirements || 0), issues: Number(details?.issues || 0) });
        setArchiveTarget(null);
        setArchiveError("");
        return;
      }
      setArchiveError(error instanceof Error ? error.message : "项目归档失败");
    },
  });
  return (
    <>
      <PageHeader
        title="项目管理"
        actions={admin ? (
          <button className="primary-button" onClick={() => setCreating(true)}>
            <Plus size={16} />
            新建项目
          </button>
        ) : null}
      />
      <div className="page-content">
        <div className="table-panel project-table">
          <table>
            <thead><tr><th>项目</th><th>计划周期</th><th>状态</th>{session.authenticated && <th>操作</th>}</tr></thead>
            <tbody>
              {projects.map((project) => {
                return (
                <tr key={project.id} className={project.id === selectedProjectId ? "is-current" : ""}>
                  <td><span className="project-name-line"><strong>{project.name}</strong>{project.isSample && <span className="sample-project-badge">样板</span>}</span>{project.id === selectedProjectId && <small>当前项目</small>}</td>
                  <td><div className="inline-date-range">
                    <span>{project.plannedStart || "未设置"}</span>
                    <span>→</span>
                    <span>{project.plannedEnd || "未设置"}</span>
                  </div></td>
                  <td><span className={`status-pill status-${project.status}`}>{project.status === "active" ? "进行中" : project.status === "completed" ? "已完成" : "规划中"}</span></td>
                  {session.authenticated && (
                    <td>
                      <div className="project-row-actions">
                        {admin && <button className="inline-action-button danger" disabled={archive.isPending} onClick={() => {
                          archive.reset();
                          setArchiveError("");
                          setArchiveTarget({ id: project.id, name: project.name });
                        }}><Archive size={14} />归档</button>}
                      </div>
                    </td>
                  )}
                </tr>
              );})}
            </tbody>
          </table>
          {!projects.length && <EmptyState title="还没有项目" detail="创建第一个项目后即可维护需求和排期。" />}
        </div>
        {creating && (
          <Modal title="新建项目" onClose={() => setCreating(false)}>
            <ProjectForm onClose={() => setCreating(false)} />
          </Modal>
        )}
        {archiveTarget && <ConfirmDialog title="归档项目" description={<>项目“<strong>{archiveTarget.name}</strong>”将从日常页面隐藏，之后可以在归档中心恢复。</>} confirmLabel="确认归档" pendingLabel="归档中…" danger pending={archive.isPending} error={archiveError} onClose={() => { setArchiveTarget(null); setArchiveError(""); }} onConfirm={() => archive.mutate({ ...archiveTarget })} />}
        {archiveConflict && <ConfirmDialog title="确认强制归档" description={<div className="archive-project-confirmation"><p>项目“{archiveConflict.name}”仍有活跃内容：</p><div><strong>{archiveConflict.requirements}</strong><span>条活跃需求</span><strong>{archiveConflict.issues}</strong><span>条未解决问题</span></div><p>继续归档后，这些内容将随项目隐藏，恢复项目后仍可继续处理。</p></div>} confirmLabel="仍然归档" pendingLabel="归档中…" danger pending={archive.isPending} error={archiveError} onClose={() => { setArchiveConflict(null); setArchiveError(""); }} onConfirm={() => archive.mutate({ id: archiveConflict.id, name: archiveConflict.name, force: true })} />}
      </div>
    </>
  );
}

export function ProjectSettingsPage() {
  const { projects, selectedProjectId, session } = useApp();
  const client = useQueryClient();
  const project = projects.find((item) => item.id === selectedProjectId);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Person | null>(null);
  const canManage = canManageProject(session, selectedProjectId);
  const { data: members = [] } = useQuery({
    queryKey: ["project-members", selectedProjectId],
    queryFn: () => api<Person[]>("/api/projects/" + selectedProjectId + "/members"),
    enabled: Boolean(selectedProjectId),
  });
  const setRole = useMutation({
    mutationFn: ({ personId, role }: { personId: string; role: string }) =>
      api("/api/projects/" + selectedProjectId + "/members/" + personId, { method: "PUT", body: jsonBody({ role }) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["project-members", selectedProjectId] });
      void client.invalidateQueries({ queryKey: ["people", selectedProjectId] });
      void client.invalidateQueries({ queryKey: ["session"] });
      void client.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  const remove = useMutation({
    mutationFn: (personId: string) => api("/api/projects/" + selectedProjectId + "/members/" + personId, { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["project-members", selectedProjectId] });
      void client.invalidateQueries({ queryKey: ["people-candidates", selectedProjectId] });
      void client.invalidateQueries({ queryKey: ["people", selectedProjectId] });
      void client.invalidateQueries({ queryKey: ["session"] });
      void client.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  const { data: projectArchives } = useQuery({
    queryKey: ["project-archives", selectedProjectId],
    queryFn: () => api<Archives>("/api/archives?projectId=" + encodeURIComponent(selectedProjectId)),
    enabled: canManage && Boolean(selectedProjectId),
  });
  const restore = useMutation({
    mutationFn: ({ entity, id }: { entity: "requirements" | "templates"; id: string }) => api("/api/" + entity + "/" + id + "/restore", { method: "POST" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["project-archives", selectedProjectId] });
      void client.invalidateQueries({ queryKey: ["requirements"] });
      void client.invalidateQueries({ queryKey: ["templates"] });
    },
  });
  return <>
    <PageHeader title="项目设置" actions={canManage && project ? <button className="primary-button" onClick={() => setEditing(true)}><Edit3 size={15} />编辑项目</button> : null} />
    <div className="page-content">
      {!project ? <EmptyState title="暂无可访问项目" detail="请联系管理员分配项目权限。" /> : <>
        <section className="panel project-settings-summary">
          <header><div><h2>{project.name}</h2><p>{project.plannedStart || "未设置开始"} — {project.plannedEnd || "未设置完成"}</p></div><span className="status-pill status-in_progress">{project.status}</span></header>
        </section>
        <section className="panel project-members-panel">
          <header>
            <div><h2>项目成员</h2><p>在当前项目内配置项目经理、项目成员和观察者</p></div>
            <div className="project-member-header-actions">
              <span className="project-member-count">{members.length} 人</span>
              {canManage && <button className="ghost-button" onClick={() => setAdding(true)}><UserPlus size={15} />添加成员</button>}
            </div>
          </header>
          <div className="project-member-list">
            {members.map((person) => {
              const roleLabel = person.projectRole === "manager" ? "项目经理" : person.projectRole === "viewer" ? "观察者" : "项目成员";
              const editable = canManage;
              return <article className={`project-member-row${canManage ? " can-manage" : ""}`} key={person.id}>
                <div className="project-member-identity">
                  <span className="project-member-avatar">{person.name.slice(-1)}</span>
                  <div><strong>{person.name}</strong><small>{person.username ? `账号 ${person.username}` : "未关联账号"}</small></div>
                </div>
                <div className="project-member-meta"><small>岗位</small><strong>{person.jobTitle || "岗位未设置"}</strong></div>
                <div className="project-member-role">
                  <small>项目角色</small>
                  {editable ? <select aria-label={`${person.name}的项目角色`} value={person.projectRole || "member"} disabled={setRole.isPending} onChange={(event) => setRole.mutate({ personId: person.id, role: event.target.value })}>
                    <option value="manager">项目经理</option><option value="member">项目成员</option><option value="viewer">观察者</option>
                  </select> : <span className={`project-role-badge role-${person.projectRole || "member"}`}>{roleLabel}</span>}
                </div>
                {canManage && <div className="project-member-action"><button className="inline-action-button danger" disabled={remove.isPending} onClick={() => { remove.reset(); setRemoveTarget(person); }}><UserMinus size={14} />移除</button></div>}
              </article>;
            })}
            {!members.length && <EmptyState title="暂无项目成员" detail="点击“添加成员”，从平台人员中选择成员加入项目。" />}
          </div>
          {(setRole.error || remove.error) && <p className="form-error">{(setRole.error || remove.error)?.message}</p>}
        </section>
        {canManage && <section className="panel project-members-panel">
          <header><div><h2>项目归档</h2><p>恢复当前项目已归档的需求或流程</p></div></header>
          <div className="compact-list">
            {[...(projectArchives?.requirements || []).map((item) => ({ ...item, entity: "requirements" as const, type: "需求" })), ...(projectArchives?.templates || []).map((item) => ({ ...item, entity: "templates" as const, type: "流程" }))].map((item) => <div key={item.entity + item.id}><Archive size={15} /><div><strong>{item.title}</strong><span>{item.type} · {new Date(item.deletedAt).toLocaleString()}</span></div><button className="compact-text-button" onClick={() => restore.mutate({ entity: item.entity, id: item.id })}><RotateCcw size={14} />恢复</button></div>)}
            {!projectArchives?.requirements.length && !projectArchives?.templates.length && <EmptyState title="暂无项目归档" detail="归档需求或流程后会显示在这里。" />}
          </div>
        </section>}
      </>}
      {editing && project && <Modal title="编辑项目" onClose={() => setEditing(false)}><ProjectForm project={project} onClose={() => setEditing(false)} /></Modal>}
      {adding && <Modal title="添加项目成员" width={620} onClose={() => setAdding(false)}><AddProjectPersonForm projectId={selectedProjectId} onClose={() => setAdding(false)} /></Modal>}
      {removeTarget && <ConfirmDialog title="移出项目成员" description={<>将“<strong>{removeTarget.name}</strong>”移出当前项目？人员资料和其他项目权限不会受到影响。</>} confirmLabel="确认移出" pendingLabel="移除中…" danger pending={remove.isPending} error={remove.error?.message} onClose={() => setRemoveTarget(null)} onConfirm={() => remove.mutate(removeTarget.id)} />}
    </div>
  </>;
}

type ProjectPersonCandidate = Person & {
  canAdd: boolean;
  unavailableReason: "already_member" | "inactive" | "archived" | null;
  existingProjectRole: "manager" | "member" | "viewer" | null;
};

const candidateReasonLabels = {
  already_member: "已是项目成员",
  inactive: "人员已停用",
  archived: "人员已归档",
} as const;

function AddProjectPersonForm({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const client = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [selectedPeople, setSelectedPeople] = useState<Record<string, string>>({});
  const [role, setRole] = useState("member");
  const [batchError, setBatchError] = useState("");
  const deferredKeyword = useDeferredValue(keyword.trim());
  const candidatesQuery = useQuery({
    queryKey: ["people-candidates", projectId, deferredKeyword],
    queryFn: () => api<ProjectPersonCandidate[]>(`/api/people/candidates?projectId=${encodeURIComponent(projectId)}${deferredKeyword ? `&q=${encodeURIComponent(deferredKeyword)}` : ""}`),
    enabled: Boolean(projectId),
  });
  const people = candidatesQuery.data || [];
  const selectedIds = Object.keys(selectedPeople);
  const mutation = useMutation({
    mutationFn: async ({ personIds, role }: { personIds: string[]; role: string }) => {
      const failed: Array<{ id: string; name: string; message: string }> = [];
      for (const personId of personIds) {
        try {
          await api(`/api/projects/${projectId}/members/${personId}`, { method: "PUT", body: jsonBody({ role }) });
        } catch (error) {
          failed.push({ id: personId, name: selectedPeople[personId] || personId, message: error instanceof Error ? error.message : "添加失败" });
        }
      }
      return { failed };
    },
    onSuccess: ({ failed }) => {
      void client.invalidateQueries({ queryKey: ["people", projectId] });
      void client.invalidateQueries({ queryKey: ["project-members", projectId] });
      void client.invalidateQueries({ queryKey: ["people-candidates", projectId] });
      if (!failed.length) { onClose(); return; }
      setSelectedPeople(Object.fromEntries(failed.map((item) => [item.id, item.name])));
      setBatchError(failed.map((item) => `${item.name}：${item.message}`).join("；"));
    },
  });
  return <form className="member-picker-form" onSubmit={(event) => {
    event.preventDefault();
    if (selectedIds.length) { setBatchError(""); mutation.mutate({ personIds: selectedIds, role }); }
  }}>
    <SearchInput className="member-picker-search" value={keyword} onChange={setKeyword} placeholder="搜索姓名、岗位、登录名或拼音" autoFocus />
    <div className="member-picker-selection"><span>已选择 <strong>{selectedIds.length}</strong> 人</span>{selectedIds.length > 0 && <button type="button" onClick={() => { setSelectedPeople({}); setBatchError(""); }}>清空选择</button>}</div>
    <div className="member-candidate-list" aria-label="可添加人员">
      {candidatesQuery.isLoading && <div className="member-picker-state">正在加载可添加人员…</div>}
      {candidatesQuery.isError && <div className="member-picker-state is-error"><strong>候选人员加载失败</strong><span>{candidatesQuery.error.message}</span><button type="button" className="compact-text-button" onClick={() => void candidatesQuery.refetch()}>重试</button></div>}
      {!candidatesQuery.isLoading && !candidatesQuery.isError && people.map((person) => <button
        type="button"
        className={`member-candidate-option${selectedPeople[person.id] ? " is-selected" : ""}`}
        aria-pressed={Boolean(selectedPeople[person.id])}
        key={person.id}
        disabled={!person.canAdd || mutation.isPending}
        onClick={() => {
          setBatchError("");
          setSelectedPeople((current) => {
            if (current[person.id]) { const next = { ...current }; delete next[person.id]; return next; }
            return { ...current, [person.id]: person.name };
          });
        }}
      >
        <span className="project-member-avatar">{person.name.slice(-1)}</span>
        <span><strong>{person.name}</strong><small>{person.jobTitle || "岗位未设置"}{person.username ? ` · ${person.username}` : ""}</small></span>
        <span className="member-candidate-check">{person.unavailableReason ? candidateReasonLabels[person.unavailableReason] : selectedPeople[person.id] ? "✓ 已选" : "选择"}</span>
      </button>)}
      {!candidatesQuery.isLoading && !candidatesQuery.isError && !people.length && <div className="member-picker-state"><strong>{keyword ? "没有匹配的人员" : "暂无可添加人员"}</strong><span>{keyword ? "请调整搜索关键词。" : "当前启用人员均已加入项目，或请先到人员与权限新增人员。"}</span></div>}
    </div>
    <label className="field member-picker-role"><span>加入后的项目角色</span><select value={role} onChange={(event) => setRole(event.target.value)}><option value="member">项目成员</option><option value="viewer">项目观察者</option><option value="manager">项目经理</option></select></label>
    {batchError && <p className="form-error">部分成员添加失败：{batchError}</p>}
    <div className="form-actions"><button type="button" className="ghost-button" disabled={mutation.isPending} onClick={onClose}>取消</button><button className="primary-button" disabled={!selectedIds.length || mutation.isPending}>{mutation.isPending ? `正在添加 ${selectedIds.length} 人…` : `添加 ${selectedIds.length} 人到项目`}</button></div>
  </form>;
}

export function PeoplePage() {
  const { selectedProjectId, projects } = useApp();
  const [viewParams, setViewParams] = useSearchParams();
  const view = viewParams.get("view") === "analysis" ? "analysis" : "matrix";
  const { data = [] } = useQuery({
    queryKey: ["people", selectedProjectId],
    queryFn: () => api<Person[]>(`/api/people?projectId=${encodeURIComponent(selectedProjectId)}`),
    enabled: Boolean(selectedProjectId),
  });
  const groups = useMemo(() => {
    const grouped = new Map<string, Person[]>();
    for (const person of data) {
      const jobTitle = person.jobTitle?.trim() || "岗位未设置";
      grouped.set(jobTitle, [...(grouped.get(jobTitle) || []), person]);
    }
    return [...grouped.entries()]
      .sort(([left], [right]) => {
        if (left === "岗位未设置") return 1;
        if (right === "岗位未设置") return -1;
        return left.localeCompare(right, "zh-CN");
      })
      .map(([jobTitle, people]) => ({
        jobTitle,
        people: people.sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
      }));
  }, [data]);
  return (
    <>
      <PageHeader title="人员矩阵" />
      <div className="page-content">
        <div className="view-tabs people-subnav" aria-label="人员页面视图">
          <button className={view === "matrix" ? "active" : ""} onClick={() => setViewParams({})}>人员矩阵</button>
          <button className={view === "analysis" ? "active" : ""} onClick={() => setViewParams({ view: "analysis" })}>人力分析</button>
        </div>
        {view === "matrix" ? <>
        <div className="people-matrix">
          {groups.map((group, groupIndex) => (
            <section className="people-role-group" key={group.jobTitle} aria-labelledby={`role-group-${groupIndex}`}>
              <header>
                <div>
                  <span className="role-marker" />
                  <h2 id={`role-group-${groupIndex}`}>{group.jobTitle}</h2>
                </div>
                <span>{group.people.length}人</span>
              </header>
              <div className="people-role-members">
                {group.people.map((person) => (
                  <article className="person-card" key={person.id}>
                    <span className="person-avatar">{person.name.slice(-1)}</span>
                    <div className="person-copy">
                      <strong>{person.name}</strong><small>{person.jobTitle || "岗位未设置"}</small>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
          {!data.length && (
            <EmptyState
              title="还没有人员"
              detail={`${projects.find((project) => project.id === selectedProjectId)?.name || "当前项目"}还没有项目成员。`}
            />
          )}
        </div>
        </> : <ConcurrencyPanel />}
      </div>
    </>
  );
}

function ConcurrencyPanel() {
  const { selectedProjectId } = useApp();
  const [personId, setPersonId] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const matrixScrollRef = useRef<HTMLDivElement>(null);
  const [matrixViewportWidth, setMatrixViewportWidth] = useState(0);
  const firstDate = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  const firstWindowEnd = useMemo(() => format(addDays(parseISO(firstDate), 6), "yyyy-MM-dd"), [firstDate]);
  const { data: people = [] } = useQuery({
    queryKey: ["people", selectedProjectId],
    queryFn: () => api<Person[]>(`/api/people?projectId=${encodeURIComponent(selectedProjectId)}`),
    enabled: Boolean(selectedProjectId),
  });
  const jobTitles = useMemo(() => [...new Set(people.map((person) => person.jobTitle).filter(Boolean) as string[])].sort(), [people]);
  const analysis = useInfiniteQuery({
    queryKey: ["people-concurrency", selectedProjectId, personId, jobTitle, firstDate],
    initialPageParam: firstDate,
    enabled: Boolean(selectedProjectId),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("projectId", selectedProjectId);
      if (personId) params.set("personId", personId);
      if (jobTitle) params.set("jobTitle", jobTitle);
      params.set("from", pageParam);
      params.set("to", format(addDays(parseISO(pageParam), 6), "yyyy-MM-dd"));
      return api<PeopleConcurrency>(`/api/analytics/people-concurrency?${params}`);
    },
    getNextPageParam: (lastPage) => format(addDays(parseISO(lastPage.from), 7), "yyyy-MM-dd"),
  });
  const pages = useMemo(() => analysis.data?.pages || [], [analysis.data?.pages]);
  const currentTop = pages[0]?.currentTop || [];
  const matrixData = useMemo(() => {
    type MatrixDay = PeopleConcurrency["people"][number]["days"][number];
    const dates = [...new Set(pages.flatMap((page) => page.dates))].sort();
    const mergedPeople = new Map<string, {
      id: string;
      name: string;
      jobTitle: string | null;
      externalCurrentCount?: number;
      daysByDate: Map<string, MatrixDay>;
    }>();
    for (const page of pages) {
      for (const person of page.people) {
        const merged = mergedPeople.get(person.id) || {
          id: person.id,
          name: person.name,
          jobTitle: person.jobTitle,
          externalCurrentCount: person.externalCurrentCount,
          daysByDate: new Map<string, MatrixDay>(),
        };
        for (const day of person.days) merged.daysByDate.set(day.date, day);
        mergedPeople.set(person.id, merged);
      }
    }
    const matrixPeople = [...mergedPeople.values()].map((person) => ({
      id: person.id,
      name: person.name,
      jobTitle: person.jobTitle,
      externalCurrentCount: person.externalCurrentCount,
      days: dates.map((date) => person.daysByDate.get(date) || {
        date,
        count: 0,
        plannedCount: 0,
        actualCount: 0,
        items: [],
      }),
    })).filter((person) => person.days.some((day) => day.count > 0));
    return { dates, people: matrixPeople };
  }, [pages]);
  const personColumnWidth = matrixViewportWidth > 0 && matrixViewportWidth < 900 ? 156 : 180;
  const initialDayCount = pages[0]?.dates.length || 5;
  const dayColumnWidth = Math.max(112, ((matrixViewportWidth || 960) - personColumnWidth) / initialDayCount);
  const tableWidth = Math.ceil(personColumnWidth + matrixData.dates.length * dayColumnWidth);
  const loadedTo = pages.at(-1)?.to || firstWindowEnd;

  useEffect(() => {
    const element = matrixScrollRef.current;
    if (!element) return undefined;
    const updateWidth = () => setMatrixViewportWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    matrixScrollRef.current?.scrollTo({ left: 0 });
  }, [firstDate, jobTitle, personId]);

  return <div className="people-analysis">
      <div className="filter-bar human-filter-bar">
      <select value={jobTitle} onChange={(event) => { setJobTitle(event.target.value); setPersonId(""); }}><option value="">全部岗位</option>{jobTitles.map((title) => <option value={title} key={title}>{title}</option>)}</select>
      <select value={personId} onChange={(event) => setPersonId(event.target.value)}><option value="">全部人员</option>{people.filter((person) => !jobTitle || person.jobTitle === jobTitle).map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select>
      <span>今天及历史看实际，未来看计划</span>
    </div>
    {currentTop.length > 0 && <section className="human-leaders" aria-label="今日工作最多人员">
      <strong>今日工作较多</strong>
      <div>{currentTop.map((person) => <article key={person.id}><span className="person-avatar">{person.name.slice(-1)}</span><div><b>{person.name}</b><small>{person.jobTitle || "岗位未设置"}{person.externalCurrentCount ? ` · 外部${person.externalCurrentCount}项` : ""}</small></div><em className={`load-${Math.min(person.currentCount, 3)}`}>{person.currentCount}项</em></article>)}</div>
    </section>}
    <div className="human-matrix-frame">
      <header className="human-matrix-heading">
        <div><span>工作日并发度</span><strong>{format(parseISO(firstDate), "MM月dd日")}—{format(parseISO(firstWindowEnd), "MM月dd日")}</strong></div>
        <div><span>从今天开始 · 已加载至 {format(parseISO(loadedTo), "MM月dd日")}</span><button type="button" onClick={() => matrixScrollRef.current?.scrollTo({ left: 0, behavior: "smooth" })}><LocateFixed size={14} />回到今天</button></div>
      </header>
      <div className="human-matrix-scroll" ref={matrixScrollRef} onScroll={(event) => {
        const element = event.currentTarget;
        if (element.scrollLeft + element.clientWidth >= element.scrollWidth - 140 && !analysis.isFetchingNextPage) void analysis.fetchNextPage();
      }}>
        <div className="human-matrix-content">
          <table className="human-continuous-table" style={{ width: tableWidth }} aria-label="人员工作日并发度矩阵">
            <colgroup><col style={{ width: personColumnWidth }} />{matrixData.dates.map((date) => <col style={{ width: dayColumnWidth }} key={date} />)}</colgroup>
            <thead><tr><th>人员</th>{matrixData.dates.map((date) => {
              const parsed = parseISO(date);
              return <th className={`${date === firstDate ? "is-today" : ""}${parsed.getDay() === 1 && date !== firstDate ? " is-week-start" : ""}`} key={date}><span>{["日", "一", "二", "三", "四", "五", "六"][parsed.getDay()]}</span>{date.slice(5).replace("-", "/")}</th>;
            })}</tr></thead>
            <tbody>
              {matrixData.people.map((person) => <tr key={person.id}><td><strong>{person.name}</strong><small>{person.jobTitle || "—"}{person.externalCurrentCount ? ` · 外部${person.externalCurrentCount}项` : ""}</small></td>{person.days.map((day) => <td className={parseISO(day.date).getDay() === 1 && day.date !== firstDate ? "is-week-start" : ""} key={day.date}><span className={`heat heat-${Math.min(day.count, 3)}`} title={day.items.map((item) => `${item.requirementTitle} · ${item.title}`).join("\n")}>{day.count || ""}</span></td>)}</tr>)}
              {!matrixData.people.length && !analysis.isLoading && <tr className="human-empty-row"><td colSpan={matrixData.dates.length + 1}><strong>当前区间暂无安排</strong><span>向右加载后续日期，或调整人员和岗位筛选。</span></td></tr>}
            </tbody>
          </table>
          <button className="human-next-window" disabled={analysis.isFetchingNextPage} onClick={() => void analysis.fetchNextPage()}>{analysis.isFetchingNextPage ? "加载中" : "加载后续7天"}</button>
        </div>
      </div>
      <footer><span><i className="heat heat-1" />1项 正常</span><span><i className="heat heat-2" />2项 预警</span><span><i className="heat heat-3" />3项及以上 高并发</span><small>横向拖动查看后续日期</small></footer>
    </div>
    </div>;
}

function TemplateForm({
  template,
  projectId,
  onClose,
}: {
  template?: WorkItemTemplate;
  projectId: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  type TemplateDraftItem = Pick<TemplateItem, "id" | "title" | "startOffsetDays" | "durationDays" | "milestoneLabel" | "sortOrder"> & { uiKey: string };
  const createDraft = (item: Omit<TemplateDraftItem, "uiKey">): TemplateDraftItem => ({ ...item, uiKey: item.id || crypto.randomUUID() });
  const [items, setItems] = useState<TemplateDraftItem[]>(() =>
    template?.items.map((item) => createDraft({ id: item.id, title: item.title, startOffsetDays: item.startOffsetDays, durationDays: item.durationDays, milestoneLabel: item.milestoneLabel, sortOrder: item.sortOrder })) || [
      createDraft({ id: "", title: "设计", startOffsetDays: 0, durationDays: 2, milestoneLabel: null, sortOrder: 0 }),
      createDraft({ id: "", title: "开发", startOffsetDays: 2, durationDays: 5, milestoneLabel: null, sortOrder: 1 }),
      createDraft({ id: "", title: "测试", startOffsetDays: 7, durationDays: 3, milestoneLabel: null, sortOrder: 2 }),
      createDraft({ id: "", title: "发布", startOffsetDays: 10, durationDays: 1, milestoneLabel: "发布基线", sortOrder: 3 }),
    ],
  );
  const updateItem = (index: number, patch: Partial<(typeof items)[number]>) => setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const totalDays = Math.max(1, ...items.map((item) => item.startOffsetDays + item.durationDays));
  const beginTimelineDrag = (event: ReactPointerEvent, index: number, mode: "move" | "resize") => {
    event.preventDefault(); event.stopPropagation();
    const startX = event.clientX; const initial = items[index]; const pixelsPerDay = Math.max(18, 520 / totalDays);
    const move = (pointer: PointerEvent) => {
      const delta = Math.round((pointer.clientX - startX) / pixelsPerDay);
      if (mode === "move") updateItem(index, { startOffsetDays: Math.max(0, initial.startOffsetDays + delta) });
      else updateItem(index, { durationDays: Math.max(1, initial.durationDays + delta) });
    };
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop);
  };
  const mutation = useMutation({
    mutationFn: (value: object) =>
      api(template ? `/api/templates/${template.id}` : "/api/templates", {
        method: template ? "PATCH" : "POST",
        body: jsonBody(value),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["templates"] });
      onClose();
    },
  });
  return (
    <form
      className="form-grid"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        mutation.mutate({ projectId, name: data.get("name"), description: data.get("description"), items: items.map(({ uiKey: _uiKey, ...item }, index) => ({ ...item, id: item.id || undefined, sortOrder: index })) });
      }}
    >
      <label className="field field-full">
        <span>流程名称</span>
        <input name="name" defaultValue={template?.name || ""} required />
      </label>
      <label className="field field-full">
        <span>设计说明</span>
        <textarea name="description" rows={4} maxLength={2000} defaultValue={template?.description || ""} placeholder="记录流程的设计目标、关键取舍和适用场景，方便后续回溯。" />
      </label>
      <div className="template-editor field-full">
        <div className="template-item-editor">
          <div className="template-editor-head"><span /><span>工作项</span><span>开始偏移</span><span>工期</span><span>里程碑（可选）</span><span /></div>
          <SortableList
            items={items}
            getId={(item) => item.uiKey}
            onReorder={(next) => setItems(next.map((item, itemIndex) => ({ ...item, sortOrder: itemIndex })))}
            renderItem={(item, index, sortable) => <div
            ref={sortable.setNodeRef}
            className={`template-editor-row sortable-item${sortable.isDragging ? " is-dragging" : ""}${sortable.isOver ? " is-over" : ""}`}
          >
            <button
              type="button"
              className="template-drag-handle sortable-drag-handle"
              aria-label={`拖动${item.title || "工作项"}调整顺序`}
              title="按住拖动调整顺序"
              {...sortable.handleAttributes}
              {...sortable.handleListeners}
            >
              <GripVertical size={17} />
            </button>
            <input value={item.title} required onChange={(event) => updateItem(index, { title: event.target.value })} />
            <input type="number" min="0" value={item.startOffsetDays} onChange={(event) => updateItem(index, { startOffsetDays: Math.max(0, Number(event.target.value)) })} />
            <input type="number" min="1" value={item.durationDays} onChange={(event) => updateItem(index, { durationDays: Math.max(1, Number(event.target.value)) })} />
            <input className="template-milestone-input" maxLength={80} value={item.milestoneLabel || ""} placeholder="如：需求基线" onChange={(event) => updateItem(index, { milestoneLabel: event.target.value || null })} />
            <button type="button" className="template-delete-item" aria-label={`删除${item.title || "工作项"}`} title="删除" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></button>
          </div>}
          />
          <button type="button" className="ghost-button add-template-item" onClick={() => setItems((current) => [...current, createDraft({ id: "", title: `工作项${current.length + 1}`, startOffsetDays: totalDays, durationDays: 1, milestoneLabel: null, sortOrder: current.length })])}><Plus size={14} />添加工作项</button>
        </div>
        <div className="template-gantt">
          <div className="template-gantt-scale"><span>第1天</span><span>共{totalDays}个工作日</span></div>
          {items.map((item, index) => <div className="template-gantt-row" key={item.uiKey}>
            <span className="template-gantt-title">{item.title || "未命名"}</span>
            <div className="template-gantt-track"><button type="button" className="template-gantt-bar" style={{ left: `${(item.startOffsetDays / totalDays) * 100}%`, width: `${(item.durationDays / totalDays) * 100}%` }} onPointerDown={(event) => beginTimelineDrag(event, index, "move")} title={`第${item.startOffsetDays + 1}个工作日开始，持续${item.durationDays}天`}><span>{item.durationDays}天</span><i onPointerDown={(event) => beginTimelineDrag(event, index, "resize")} /></button>{item.milestoneLabel?.trim() && <span className={`template-milestone-marker${(item.startOffsetDays + item.durationDays) / totalDays > .72 ? " align-left" : ""}`} style={{ left: `${((item.startOffsetDays + item.durationDays) / totalDays) * 100}%` }} title={`${item.milestoneLabel} · 第${item.startOffsetDays + item.durationDays}个工作日`}><i /><b>{item.milestoneLabel}</b></span>}</div>
          </div>)}
          <p>拖动时间条调整开始偏移，拖动右侧手柄调整工期。</p>
        </div>
      </div>
      <p className="field-help field-full">
        相同或重叠的时间区间表示并行与交错；修改流程不会覆盖已有需求。
      </p>
      {mutation.error && (
        <p className="form-error field-full">{mutation.error.message}</p>
      )}
      <div className="form-actions field-full">
        <button type="button" className="ghost-button" onClick={onClose}>
          取消
        </button>
        <button className="primary-button">保存流程</button>
      </div>
    </form>
  );
}

export function TemplatesPage() {
  const { projects, session, selectedProjectId } = useApp();
  const client = useQueryClient();
  const [editing, setEditing] = useState<WorkItemTemplate | null | undefined>(
    undefined,
  );
  const [archiveTarget, setArchiveTarget] = useState<WorkItemTemplate | null>(null);
  const { data = [] } = useQuery({
    queryKey: ["templates", selectedProjectId],
    queryFn: () => api<WorkItemTemplate[]>(`/api/templates?projectId=${encodeURIComponent(selectedProjectId)}`),
    enabled: Boolean(selectedProjectId),
  });
  const canManage = canManageProject(session, selectedProjectId);
  const project = projects.find((item) => item.id === selectedProjectId);
  const archive = useMutation({
    mutationFn: (id: string) =>
      api(`/api/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setArchiveTarget(null);
      void client.invalidateQueries({ queryKey: ["templates"] });
      void client.invalidateQueries({ queryKey: ["archives"] });
    },
  });
  return (
    <>
      <PageHeader
        title="流程设计"
        actions={canManage ? (
          <button className="primary-button" onClick={() => setEditing(null)}>
            <Plus size={16} />
            新建流程
          </button>
        ) : null}
      />
      <div className="page-content">
        <section className="template-grid">
        {data.map((template) => (
          <article className="template-card" key={template.id}>
            <header>
              <div>
                <strong className="template-name-line">{template.name}{project?.defaultTemplateId === template.id && <span className="template-default-badge">项目默认</span>}</strong>
                <small>{template.items.length}个工作项 · {template.items.filter((item) => item.milestoneLabel).length}个里程碑</small>
              </div>
              {canManage && (
                <div className="row-actions">
                  <button aria-label={`编辑流程 ${template.name}`} onClick={() => setEditing(template)}>
                    <Edit3 size={15} />
                  </button>
                  <button
                    aria-label={`归档流程 ${template.name}`}
                    onClick={() => { archive.reset(); setArchiveTarget(template); }}
                  >
                    <Archive size={15} />
                  </button>
                </div>
              )}
            </header>
            {template.description && <p className="template-description" title={template.description}>{template.description}</p>}
            <ol>
              {template.items.map((item) => (
                <li key={item.id}>
                  <span>{item.sortOrder + 1}</span>
                  <div><b>{item.title}</b><small>第{item.startOffsetDays + 1}个工作日 · {item.durationDays}天{item.milestoneLabel && <em>◆ {item.milestoneLabel}</em>}</small></div>
                </li>
              ))}
            </ol>
          </article>
        ))}
        </section>
        {editing !== undefined && (
        <Modal
          title={editing ? "编辑流程" : "新建流程"}
          width={1040}
          onClose={() => setEditing(undefined)}
        >
          <TemplateForm
            template={editing || undefined}
            projectId={selectedProjectId}
            onClose={() => setEditing(undefined)}
          />
        </Modal>
        )}
        {archiveTarget && (() => {
          const blockedReason = project?.defaultTemplateId === archiveTarget.id
            ? "这是项目默认流程。请先在项目设置中更换默认流程，再执行归档。"
            : data.length <= 1 ? "项目至少需要保留一个有效流程，当前流程不能归档。" : undefined;
          return <ConfirmDialog title="归档流程" description={<>流程“<strong>{archiveTarget.name}</strong>”归档后不再用于新需求，已有需求和历史数据不会改变。</>} confirmLabel={blockedReason ? "无法归档" : "确认归档"} pendingLabel="归档中…" danger pending={archive.isPending} disabled={Boolean(blockedReason)} error={blockedReason || archive.error?.message} onClose={() => setArchiveTarget(null)} onConfirm={() => archive.mutate(archiveTarget.id)} />;
        })()}
      </div>
    </>
  );
}

const archiveEntityOptions = [
  { value: "projects", label: "项目" },
  { value: "requirements", label: "需求" },
  { value: "people", label: "人员" },
  { value: "templates", label: "模板" },
] as const;
type ArchiveEntity = (typeof archiveEntityOptions)[number]["value"];

export function ArchiveCenterPage() {
  const client = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [type, setType] = useState<"all" | ArchiveEntity>("all");
  const [deletePrompt, setDeletePrompt] = useState<{ entity: ArchiveEntity; id: string; title: string; impact: string } | null>(null);
  const [simpleDeleteTarget, setSimpleDeleteTarget] = useState<{ entity: ArchiveEntity; id: string; title: string } | null>(null);
  const { data: archives } = useQuery({ queryKey: ["archives"], queryFn: () => api<Archives>("/api/archives") });
  const rows = useMemo(() => archiveEntityOptions.flatMap(({ value, label }) =>
    (archives?.[value] || []).map((item) => ({ ...item, entity: value, typeLabel: label }))), [archives]);
  const filteredRows = useMemo(() => {
    return rows
      .filter((item) => type === "all" || item.entity === type)
      .filter((item) => matchesSearch([
        { text: item.title, weight: 100 },
        { text: item.jobTitle, weight: 20 },
        { text: item.typeLabel, pinyin: false },
      ], keyword))
      .sort((left, right) => {
        if (keyword.trim()) {
          const score = searchScore([{ text: right.title, weight: 100 }, right.jobTitle, { text: right.typeLabel, pinyin: false }], keyword)
            - searchScore([{ text: left.title, weight: 100 }, left.jobTitle, { text: left.typeLabel, pinyin: false }], keyword);
          if (score !== 0) return score;
        }
        return right.deletedAt.localeCompare(left.deletedAt);
      });
  }, [keyword, rows, type]);
  const restore = useMutation({
    mutationFn: ({ entity, id }: { entity: ArchiveEntity; id: string }) => api(`/api/${entity}/${id}/restore`, { method: "POST" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["archives"] });
      void client.invalidateQueries({ queryKey: ["projects"] });
      void client.invalidateQueries({ queryKey: ["people"] });
      void client.invalidateQueries({ queryKey: ["templates"] });
      void client.invalidateQueries({ queryKey: ["requirements"] });
    },
  });
  const permanentlyDelete = useMutation({
    mutationFn: ({ entity, id, confirmName }: { entity: ArchiveEntity; id: string; confirmName?: string }) => api(`/api/archives/${entity}/${id}`, { method: "DELETE", body: jsonBody({ confirmName }) }),
    onSuccess: () => {
      setDeletePrompt(null);
      setSimpleDeleteTarget(null);
      void client.invalidateQueries({ queryKey: ["archives"] });
      void client.invalidateQueries({ queryKey: ["audit"] });
      void client.invalidateQueries({ queryKey: ["projects"] });
      void client.invalidateQueries({ queryKey: ["people"] });
      void client.invalidateQueries({ queryKey: ["templates"] });
      void client.invalidateQueries({ queryKey: ["requirements"] });
    },
  });
  return <>
    <PageHeader title="归档中心" />
    <div className="page-content">
      <section className="panel archive-panel">
        <header><div><h2>已归档内容</h2><p>统一筛选、恢复或永久删除平台归档资源</p></div></header>
        <div className="archive-toolbar">
          <SearchInput value={keyword} onChange={setKeyword} placeholder="搜索归档名称、岗位或拼音" />
          <select value={type} onChange={(event) => setType(event.target.value as "all" | ArchiveEntity)}><option value="all">全部类型</option>{archiveEntityOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
          <span>{filteredRows.length} / {rows.length} 条</span>
        </div>
        <div className="archive-table-wrap">
          <table className="archive-table">
            <thead><tr><th>名称</th><th>类型</th><th>补充信息</th><th>归档时间</th><th>操作</th></tr></thead>
            <tbody>{filteredRows.map((item) => <tr key={`${item.entity}-${item.id}`}>
              <td><strong title={item.title}>{item.title}</strong></td>
              <td><span className={`archive-type archive-type-${item.entity}`}>{item.typeLabel}</span></td>
              <td>{item.jobTitle || "—"}</td>
              <td>{new Date(item.deletedAt).toLocaleString("zh-CN")}</td>
              <td><div className="archive-row-actions"><button className="inline-action-button" title={`恢复${item.typeLabel}`} onClick={() => restore.mutate({ entity: item.entity, id: item.id })}><RotateCcw size={14} />恢复</button><button className="inline-action-button danger" title={`永久删除${item.typeLabel}`} onClick={() => {
                if (item.entity === "projects" || item.entity === "requirements") {
                  const impact = item.entity === "projects"
                    ? `将级联删除需求 ${item.requirementCount || 0} 条、工作项 ${item.workItemCount || 0} 条、问题 ${item.issueCount || 0} 条、流程 ${item.templateCount || 0} 个。`
                    : `将级联删除工作项 ${item.workItemCount || 0} 条、进展 ${item.progressCount || 0} 条；${item.linkedIssueCount || 0} 个关联问题会保留并转为项目公共问题。`;
                  permanentlyDelete.reset();
                  setDeletePrompt({ entity: item.entity, id: item.id, title: item.title, impact });
                  return;
                }
                permanentlyDelete.reset();
                setSimpleDeleteTarget({ entity: item.entity, id: item.id, title: item.title });
              }}><Trash2 size={14} />删除</button></div></td>
            </tr>)}</tbody>
          </table>
          {!filteredRows.length && <EmptyState title="没有符合条件的归档内容" detail={rows.length ? "调整搜索词或类型筛选后重试。" : "归档项目、需求、人员或流程后会显示在这里。"} />}
        </div>
        {(restore.error || permanentlyDelete.error) && <p className="form-error archive-error">{(restore.error || permanentlyDelete.error)?.message}</p>}
      </section>
    </div>
    {deletePrompt && <TextPromptModal title={`永久删除${deletePrompt.entity === "projects" ? "项目" : "需求"}`} description={`${deletePrompt.impact}\n永久删除后无法恢复。`} label="输入完整名称确认" expectedValue={deletePrompt.title} confirmLabel="永久删除" danger pending={permanentlyDelete.isPending} error={permanentlyDelete.error?.message} onClose={() => setDeletePrompt(null)} onConfirm={(confirmName) => permanentlyDelete.mutate({ entity: deletePrompt.entity, id: deletePrompt.id, confirmName })} />}
    {simpleDeleteTarget && <ConfirmDialog title="永久删除归档内容" description={<>“<strong>{simpleDeleteTarget.title}</strong>”将被永久删除，此操作无法恢复。</>} confirmLabel="永久删除" pendingLabel="删除中…" danger pending={permanentlyDelete.isPending} error={permanentlyDelete.error?.message} onClose={() => setSimpleDeleteTarget(null)} onConfirm={() => permanentlyDelete.mutate({ entity: simpleDeleteTarget.entity, id: simpleDeleteTarget.id })} />}
  </>;
}

export function PersonalSettingsPage() {
  const { openPassword, projects, session } = useApp();
  const client = useQueryClient();
  const [tokenModal, setTokenModal] = useState(false);
  const [newToken, setNewToken] = useState<string>();
  const [copied, setCopied] = useState<"endpoint" | "token" | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiToken | null>(null);
  const { data: tokens = [], isLoading, error, refetch } = useQuery({ queryKey: ["my-tokens"], queryFn: () => api<ApiToken[]>("/api/tokens") });
  const createToken = useMutation({
    mutationFn: (input: object) => api<ApiToken & { token: string }>("/api/tokens", { method: "POST", body: jsonBody(input) }),
    onSuccess: (result) => { setNewToken(result.token); setCopied(null); void client.invalidateQueries({ queryKey: ["my-tokens"] }); },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api("/api/tokens/" + id, { method: "DELETE" }),
    onSuccess: () => {
      setRevokeTarget(null);
      void client.invalidateQueries({ queryKey: ["my-tokens"] });
    },
  });
  const mcpEndpoint = `${window.location.origin}/mcp`;
  const roleLabel = session.globalRole === "admin" ? "系统管理员" : session.managedProjectIds.length ? "项目经理" : "项目成员";
  const activeTokens = tokens.filter((token) => !token.revokedAt && (!token.expiresAt || new Date(token.expiresAt).getTime() > Date.now()));
  const orderedTokens = [...tokens].sort((left, right) => {
    const leftInactive = Boolean(left.revokedAt || (left.expiresAt && new Date(left.expiresAt).getTime() <= Date.now()));
    const rightInactive = Boolean(right.revokedAt || (right.expiresAt && new Date(right.expiresAt).getTime() <= Date.now()));
    return Number(leftInactive) - Number(rightInactive) || right.createdAt.localeCompare(left.createdAt);
  });
  const copyText = async (value: string, target: "endpoint" | "token") => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        try { textarea.select(); document.execCommand("copy"); } finally { textarea.remove(); }
      }
      setCopied(target);
    } catch { setCopied(null); }
  };
  const openTokenModal = () => {
    createToken.reset();
    setNewToken(undefined);
    setCopied(null);
    setTokenModal(true);
  };
  return <>
    <PageHeader title="个人设置" />
    <div className="page-content personal-settings-page">
      <section className="panel personal-account-panel">
        <div className="personal-account-identity"><span>{session.username?.slice(0, 1).toUpperCase() || "用"}</span><div><h2>{session.username}</h2><p><CircleUserRound size={14} />{session.personId ? "已关联业务人员" : "当前账号未关联业务人员"}</p></div></div>
        <dl className="personal-account-facts">
          <div><dt>账号角色</dt><dd>{roleLabel}</dd></div>
          <div><dt>可访问项目</dt><dd>{projects.length} 个</dd></div>
          <div><dt>MCP 权限</dt><dd>随账号权限同步</dd></div>
        </dl>
        <button className="ghost-button personal-password-button" onClick={openPassword}><KeyRound size={15} />修改密码</button>
      </section>
      <section className="panel personal-mcp-panel">
        <header><div><h2>MCP 接入</h2><p>为本机客户端创建独立凭据，Token 自动继承当前账号的项目权限</p></div>{tokens.length > 0 && <button className="primary-button" onClick={openTokenModal}><Plus size={15} />创建 Token</button>}</header>
        <div className="personal-mcp-connection">
          <span className="personal-mcp-icon"><PlugZap size={20} /></span>
          <div><span>MCP 服务地址</span><code>{mcpEndpoint}</code><small>客户端通过 Authorization: Bearer Token 连接</small></div>
          <button className="ghost-button" onClick={() => void copyText(mcpEndpoint, "endpoint")}><Copy size={15} />{copied === "endpoint" ? "已复制" : "复制地址"}</button>
        </div>
        {isLoading && <div className="personal-token-loading">正在加载 Token…</div>}
        {error && <div className="personal-token-error"><span>{error.message}</span><button className="ghost-button" onClick={() => void refetch()}>重新加载</button></div>}
        {!isLoading && !error && tokens.length > 0 && <div className="personal-token-list" role="table" aria-label="我的 MCP Token">
          <div className="personal-token-head" role="row"><span>Token</span><span>创建时间</span><span>最近使用</span><span>有效期</span><span>状态与操作</span></div>
          {orderedTokens.map((token) => {
            const expired = Boolean(token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now());
            const status = token.revokedAt ? "已撤销" : expired ? "已过期" : "有效";
            return <div className="personal-token-row" role="row" key={token.id}>
              <div><KeyRound size={16} /><span><strong>{token.name}</strong><small>pm_{token.prefix}_…</small></span></div>
              <time>{new Date(token.createdAt).toLocaleDateString("zh-CN")}</time>
              <time>{token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString("zh-CN", { hour12: false }) : "尚未使用"}</time>
              <time>{token.expiresAt ? new Date(token.expiresAt).toLocaleDateString("zh-CN") : "永久有效"}</time>
              <div><b className={status === "有效" ? "safe-text" : "muted"}>{status}</b>{status === "有效" && <button className="token-revoke-button" onClick={() => { revoke.reset(); setRevokeTarget(token); }}>撤销</button>}</div>
            </div>;
          })}
        </div>}
        {!isLoading && !error && !tokens.length && <div className="personal-token-empty"><span><KeyRound size={22} /></span><div><strong>还没有个人 Token</strong><p>为 Claude Desktop、Codex 等客户端分别创建 Token，后续可独立撤销。</p></div><button className="primary-button" onClick={openTokenModal}><Plus size={15} />创建第一个 Token</button></div>}
        {!isLoading && !error && tokens.length > 0 && <footer className="personal-token-footer"><span>{activeTokens.length} 个有效 Token</span><small>建议不同客户端使用不同 Token，并定期撤销不再使用的凭据。</small></footer>}
      </section>
      {tokenModal && <Modal title="创建 MCP Token" width={560} onClose={() => setTokenModal(false)} closable={!createToken.isPending}>
        {newToken ? <div className="token-reveal"><ShieldCheck size={38} /><strong>Token 已创建，只显示这一次</strong><p>立即复制并保存到客户端配置中，关闭后无法再次查看。</p><div><code>{newToken}</code><button className="ghost-button" onClick={() => void copyText(newToken, "token")}><Copy size={16} />{copied === "token" ? "已复制" : "复制 Token"}</button></div><button className="primary-button" onClick={() => setTokenModal(false)}>我已安全保存</button></div>
          : <form className="form-grid" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); createToken.mutate({ name: data.get("name"), expiresInDays: data.get("expiresInDays") === "never" ? null : Number(data.get("expiresInDays")) }); }}>
            <div className="token-create-note field-full"><ShieldCheck size={18} /><span>Token 权限与当前账号一致。建议每个客户端单独创建，便于后续识别和撤销。</span></div>
            <label className="field field-full"><span>Token 名称</span><input name="name" required autoFocus placeholder="例如：Claude Desktop、办公电脑 Codex" /></label>
            <label className="field field-full"><span>有效期</span><select name="expiresInDays" defaultValue="90"><option value="30">30 天</option><option value="90">90 天（推荐）</option><option value="365">1 年</option><option value="never">永久有效</option></select><small className="field-help">到期后客户端将自动失效，可以随时创建新 Token。</small></label>
            {createToken.error && <p className="form-error field-full">{createToken.error.message}</p>}
            <div className="form-actions field-full"><button type="button" className="ghost-button" disabled={createToken.isPending} onClick={() => setTokenModal(false)}>取消</button><button className="primary-button" disabled={createToken.isPending}>{createToken.isPending ? "创建中…" : "创建 Token"}</button></div>
          </form>}
      </Modal>}
      {revokeTarget && <ConfirmDialog title="撤销 MCP Token" description={<>撤销“<strong>{revokeTarget.name}</strong>”后，使用该 Token 的客户端将立即无法访问系统。</>} confirmLabel="确认撤销" pendingLabel="撤销中…" danger pending={revoke.isPending} error={revoke.error?.message} onClose={() => setRevokeTarget(null)} onConfirm={() => revoke.mutate(revokeTarget.id)} />}
    </div>
  </>;
}
