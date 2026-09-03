import { useDeferredValue, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { addDays, format, parseISO } from "date-fns";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Clock3,
  Copy,
  DatabaseBackup,
  Edit3,
  GripVertical,
  ImagePlus,
  KeyRound,
  LocateFixed,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { api, jsonBody } from "../api";
import { useApp } from "../app-context";
import type {
  ApiToken,
  AuditPage,
  Backup,
  DatabaseIntegrityCheck,
  Archives,
  PeopleConcurrency,
  Person,
  Project,
  Requirement,
  SystemOverview,
  SystemBranding,
  TemplateItem,
  WorkItemTemplate,
} from "../types";
import { priorityLabels, requirementStatusLabels, riskLabels } from "../../shared/domain";
import { EmptyState, Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { ProjectForm, RequirementForm } from "../components/ManagementForms";
import { InlineDateCell, InlineSelectCell, InlineTextCell } from "../components/InlineEdit";
import { canManageProject, isAdmin } from "../permissions";
import { priorityOptions, requirementStatusOptions } from "../ui-options";
import { BrandLogo, defaultBranding } from "../components/BrandLogo";
import { DataCell } from "../components/LayoutPrimitives";
import { SortableList } from "../components/SortableList";

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
    const normalizedSearch = search.trim().toLowerCase();
    return data
      .filter((item) =>
        (!normalizedSearch || item.title.toLowerCase().includes(normalizedSearch)) &&
        (status === "current" ? item.status !== "completed" : !status || item.status === status),
      )
      .sort((left, right) => {
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
      void client.invalidateQueries({ queryKey: ["requirement", item.id] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
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
        <label className="search-box">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索需求标题"
          />
        </label>
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
                <td><DataCell density="compact" primary={<strong>{item.title}</strong>} secondary={item.projectName} /></td>
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
                  <DataCell density="compact" primary={item.highRisk ? (
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
  const admin = isAdmin(session);
  const archive = useMutation({
    mutationFn: (id: string) => api(`/api/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["projects"] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
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
                        {admin && <button className="inline-action-button danger" onClick={() => confirm(`归档项目“${project.name}”？项目数据可在归档中心恢复。`) && archive.mutate(project.id)}><Archive size={14} />归档</button>}
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
    },
  });
  const remove = useMutation({
    mutationFn: (personId: string) => api("/api/projects/" + selectedProjectId + "/members/" + personId, { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["project-members", selectedProjectId] });
      void client.invalidateQueries({ queryKey: ["people-candidates", selectedProjectId] });
      void client.invalidateQueries({ queryKey: ["people", selectedProjectId] });
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
            <div><h2>项目成员</h2><p>项目经理在“人员与权限”中统一任免；这里维护观察者和普通成员</p></div>
            <div className="project-member-header-actions">
              <span className="project-member-count">{members.length} 人</span>
              {canManage && <button className="ghost-button" onClick={() => setAdding(true)}><UserPlus size={15} />添加成员</button>}
            </div>
          </header>
          <div className="project-member-list">
            {members.map((person) => {
              const roleLabel = person.projectRole === "manager" ? "项目经理" : person.projectRole === "viewer" ? "观察者" : "项目成员";
              const editable = canManage && person.projectRole !== "manager";
              return <article className={`project-member-row${canManage ? " can-manage" : ""}`} key={person.id}>
                <div className="project-member-identity">
                  <span className="project-member-avatar">{person.name.slice(-1)}</span>
                  <div><strong>{person.name}</strong><small>{person.username ? `账号 ${person.username}` : "未关联账号"}</small></div>
                </div>
                <div className="project-member-meta"><small>岗位</small><strong>{person.jobTitle || "岗位未设置"}</strong></div>
                <div className="project-member-role">
                  <small>项目角色</small>
                  {editable ? <select aria-label={`${person.name}的项目角色`} value={person.projectRole || "member"} disabled={setRole.isPending} onChange={(event) => setRole.mutate({ personId: person.id, role: event.target.value })}>
                    <option value="viewer">观察者</option><option value="member">项目成员</option>
                  </select> : <span className={`project-role-badge role-${person.projectRole || "member"}`}>{roleLabel}</span>}
                </div>
                {canManage && <div className="project-member-action">{editable && <button className="inline-action-button danger" disabled={remove.isPending} onClick={() => confirm("将“" + person.name + "”移出项目？") && remove.mutate(person.id)}><UserMinus size={14} />移除</button>}</div>}
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
    </div>
  </>;
}

function AddProjectPersonForm({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const client = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [personId, setPersonId] = useState("");
  const [role, setRole] = useState("member");
  const deferredKeyword = useDeferredValue(keyword.trim());
  const candidatesQuery = useQuery({
    queryKey: ["people-candidates", projectId, deferredKeyword],
    queryFn: () => api<Person[]>(`/api/people/candidates?projectId=${encodeURIComponent(projectId)}${deferredKeyword ? `&q=${encodeURIComponent(deferredKeyword)}` : ""}`),
    enabled: Boolean(projectId),
  });
  const people = candidatesQuery.data || [];
  const mutation = useMutation({
    mutationFn: ({ personId, role }: { personId: string; role: string }) => api(`/api/projects/${projectId}/members/${personId}`, { method: "PUT", body: jsonBody({ role }) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["people", projectId] });
      void client.invalidateQueries({ queryKey: ["project-members", projectId] });
      void client.invalidateQueries({ queryKey: ["people-candidates", projectId] });
      onClose();
    },
  });
  return <form className="member-picker-form" onSubmit={(event) => {
    event.preventDefault();
    if (personId) mutation.mutate({ personId, role });
  }}>
    <label className="member-picker-search"><Search size={16} /><input value={keyword} onChange={(event) => { setKeyword(event.target.value); setPersonId(""); }} placeholder="搜索姓名或岗位" autoFocus /></label>
    <div className="member-candidate-list" aria-label="可添加人员">
      {candidatesQuery.isLoading && <div className="member-picker-state">正在加载可添加人员…</div>}
      {candidatesQuery.isError && <div className="member-picker-state is-error"><strong>候选人员加载失败</strong><span>{candidatesQuery.error.message}</span><button type="button" className="compact-text-button" onClick={() => void candidatesQuery.refetch()}>重试</button></div>}
      {!candidatesQuery.isLoading && !candidatesQuery.isError && people.map((person) => <button
        type="button"
        className={`member-candidate-option${personId === person.id ? " is-selected" : ""}`}
        aria-pressed={personId === person.id}
        key={person.id}
        onClick={() => setPersonId(person.id)}
      >
        <span className="project-member-avatar">{person.name.slice(-1)}</span>
        <span><strong>{person.name}</strong><small>{person.jobTitle || "岗位未设置"}{person.username ? ` · ${person.username}` : ""}</small></span>
        <span className="member-candidate-check">{personId === person.id ? "已选择" : "选择"}</span>
      </button>)}
      {!candidatesQuery.isLoading && !candidatesQuery.isError && !people.length && <div className="member-picker-state"><strong>{keyword ? "没有匹配的人员" : "暂无可添加人员"}</strong><span>{keyword ? "请调整搜索关键词。" : "当前启用人员均已加入项目，或请先到人员与权限新增人员。"}</span></div>}
    </div>
    <label className="field member-picker-role"><span>加入后的项目角色</span><select value={role} onChange={(event) => setRole(event.target.value)}><option value="member">项目成员</option><option value="viewer">项目观察者</option></select></label>
    {mutation.error && <p className="form-error">{mutation.error.message}</p>}
    <div className="form-actions"><button type="button" className="ghost-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!personId || mutation.isPending}>{mutation.isPending ? "正在添加…" : "添加到项目"}</button></div>
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
  const pages = analysis.data?.pages || [];
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
  const { session, selectedProjectId } = useApp();
  const client = useQueryClient();
  const [editing, setEditing] = useState<WorkItemTemplate | null | undefined>(
    undefined,
  );
  const { data = [] } = useQuery({
    queryKey: ["templates", selectedProjectId],
    queryFn: () => api<WorkItemTemplate[]>(`/api/templates?projectId=${encodeURIComponent(selectedProjectId)}`),
    enabled: Boolean(selectedProjectId),
  });
  const canManage = canManageProject(session, selectedProjectId);
  const archive = useMutation({
    mutationFn: (id: string) =>
      api(`/api/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["templates"] }),
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
                <strong>{template.name}</strong>
                <small>{template.items.length}个工作项 · {template.items.filter((item) => item.milestoneLabel).length}个里程碑</small>
              </div>
              {canManage && (
                <div className="row-actions">
                  <button aria-label={`编辑流程 ${template.name}`} onClick={() => setEditing(template)}>
                    <Edit3 size={15} />
                  </button>
                  <button
                    aria-label={`归档流程 ${template.name}`}
                    onClick={() =>
                      confirm(`归档流程“${template.name}”？`) &&
                      archive.mutate(template.id)
                    }
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
  const { data: archives } = useQuery({ queryKey: ["archives"], queryFn: () => api<Archives>("/api/archives") });
  const rows = useMemo(() => archiveEntityOptions.flatMap(({ value, label }) =>
    (archives?.[value] || []).map((item) => ({ ...item, entity: value, typeLabel: label }))), [archives]);
  const filteredRows = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    return rows
      .filter((item) => type === "all" || item.entity === type)
      .filter((item) => !normalized || `${item.title} ${item.jobTitle || ""} ${item.typeLabel}`.toLowerCase().includes(normalized))
      .sort((left, right) => right.deletedAt.localeCompare(left.deletedAt));
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
          <label className="search-box"><Search size={16} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索归档名称或岗位" /></label>
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
                  const confirmName = prompt(`${impact}\n永久删除无法恢复。请输入完整名称“${item.title}”确认：`);
                  if (confirmName !== item.title) return;
                  permanentlyDelete.mutate({ entity: item.entity, id: item.id, confirmName });
                  return;
                }
                if (confirm(`永久删除“${item.title}”？该操作无法恢复。`)) permanentlyDelete.mutate({ entity: item.entity, id: item.id });
              }}><Trash2 size={14} />删除</button></div></td>
            </tr>)}</tbody>
          </table>
          {!filteredRows.length && <EmptyState title="没有符合条件的归档内容" detail={rows.length ? "调整搜索词或类型筛选后重试。" : "归档项目、需求、人员或流程后会显示在这里。"} />}
        </div>
        {(restore.error || permanentlyDelete.error) && <p className="form-error archive-error">{(restore.error || permanentlyDelete.error)?.message}</p>}
      </section>
    </div>
  </>;
}

export function PersonalSettingsPage() {
  const { openPassword } = useApp();
  const client = useQueryClient();
  const [tokenModal, setTokenModal] = useState(false);
  const [newToken, setNewToken] = useState<string>();
  const { data: tokens = [] } = useQuery({ queryKey: ["my-tokens"], queryFn: () => api<ApiToken[]>("/api/tokens") });
  const createToken = useMutation({
    mutationFn: (input: object) => api<ApiToken & { token: string }>("/api/tokens", { method: "POST", body: jsonBody(input) }),
    onSuccess: (result) => { setNewToken(result.token); void client.invalidateQueries({ queryKey: ["my-tokens"] }); },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api("/api/tokens/" + id, { method: "DELETE" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["my-tokens"] }),
  });
  return <>
    <PageHeader title="个人设置" actions={<button className="ghost-button" onClick={openPassword}><KeyRound size={15} />修改密码</button>} />
    <div className="page-content">
      <section className="panel system-panel personal-token-panel">
        <header><div><h2>我的 MCP Token</h2><p>Token 自动继承当前账号的项目权限</p></div><button className="primary-button" onClick={() => { setNewToken(undefined); setTokenModal(true); }}><KeyRound size={15} />创建 Token</button></header>
        <div className="compact-list">{tokens.map((token) => <div key={token.id}><KeyRound size={16} /><div><strong>{token.name}</strong><span>pm_{token.prefix}_… · {token.expiresAt ? new Date(token.expiresAt).toLocaleDateString() + "到期" : "永久有效"}</span></div><b className={token.revokedAt ? "muted" : "safe-text"}>{token.revokedAt ? "已撤销" : "有效"}</b>{!token.revokedAt && <button onClick={() => confirm("确认撤销此 Token？") && revoke.mutate(token.id)}><Trash2 size={14} /></button>}</div>)}</div>
        {!tokens.length && <EmptyState title="暂无个人 Token" detail="创建后可按当前账号权限访问 MCP。" />}
      </section>
      {tokenModal && <Modal title="创建个人 MCP Token" onClose={() => setTokenModal(false)}>
        {newToken ? <div className="token-reveal"><ShieldCheck size={38} /><strong>Token 只显示这一次</strong><div><code>{newToken}</code><button onClick={() => void navigator.clipboard.writeText(newToken)}><Copy size={16} /></button></div><button className="primary-button" onClick={() => setTokenModal(false)}>我已保存</button></div>
          : <form className="form-grid" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); createToken.mutate({ name: data.get("name"), expiresInDays: data.get("expiresInDays") === "never" ? null : Number(data.get("expiresInDays")) }); }}>
            <label className="field field-full"><span>Token 名称</span><input name="name" required /></label>
            <label className="field field-full"><span>有效期</span><select name="expiresInDays" defaultValue="90"><option value="30">30天</option><option value="90">90天</option><option value="never">永久</option></select></label>
            {createToken.error && <p className="form-error field-full">{createToken.error.message}</p>}
            <div className="form-actions field-full"><button type="button" className="ghost-button" onClick={() => setTokenModal(false)}>取消</button><button className="primary-button">创建</button></div>
          </form>}
      </Modal>}
    </div>
  </>;
}

function formatStorageSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatUptime(seconds = 0) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}天${hours}小时`;
  if (hours) return `${hours}小时${minutes}分钟`;
  return `${Math.max(1, minutes)}分钟`;
}

function relativeTime(value: string | null) {
  if (!value) return "尚未备份";
  const difference = Date.now() - new Date(value).getTime();
  if (difference < 60_000) return "刚刚";
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)}分钟前`;
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)}小时前`;
  return `${Math.floor(difference / 86_400_000)}天前`;
}

function BrandingSettingsCard() {
  const client = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [systemName, setSystemName] = useState(defaultBranding.systemName);
  const [shortName, setShortName] = useState(defaultBranding.shortName);
  const [logoDraft, setLogoDraft] = useState<string | null | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [localError, setLocalError] = useState("");
  const brandingQuery = useQuery({
    queryKey: ["branding"],
    queryFn: () => api<SystemBranding>("/api/branding"),
  });
  const branding = brandingQuery.data ?? defaultBranding;
  useEffect(() => {
    if (!brandingQuery.data) return;
    setSystemName(brandingQuery.data.systemName);
    setShortName(brandingQuery.data.shortName);
    setLogoDraft(undefined);
  }, [brandingQuery.data]);
  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = { systemName, shortName };
      if (logoDraft !== undefined) payload.logoDataUrl = logoDraft;
      return api<SystemBranding>("/api/system/branding", { method: "PUT", body: jsonBody(payload) });
    },
    onSuccess: (result) => {
      client.setQueryData(["branding"], result);
      setLogoDraft(undefined);
      setMessage("品牌设置已保存");
      setLocalError("");
    },
  });
  const previewBranding: SystemBranding = {
    systemName: systemName.trim() || defaultBranding.systemName,
    shortName: shortName.trim() || defaultBranding.shortName,
    logoUrl: logoDraft === undefined ? branding.logoUrl : logoDraft,
    updatedAt: branding.updatedAt,
  };
  const selectLogo = (file?: File) => {
    setMessage("");
    setLocalError("");
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setLocalError("Logo仅支持PNG、JPEG或WebP图片");
      return;
    }
    if (file.size > 512 * 1024) {
      setLocalError("Logo文件不能超过512KB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoDraft(String(reader.result || ""));
    reader.onerror = () => setLocalError("Logo读取失败，请重新选择");
    reader.readAsDataURL(file);
  };
  return <article className="panel system-detail-panel system-branding-panel">
    <header><div><h2>品牌设置</h2><p>统一侧边栏、登录界面和浏览器标签的系统标识</p></div></header>
    <div className="system-branding-content">
      <div className="system-branding-preview">
        <BrandLogo branding={previewBranding} />
        <div><strong>{previewBranding.systemName}</strong><span>展开与折叠状态使用同一Logo</span></div>
      </div>
      <form className="system-branding-form" onSubmit={(event) => { event.preventDefault(); setMessage(""); setLocalError(""); save.mutate(); }}>
        <label className="field"><span>系统名称</span><input value={systemName} maxLength={20} required onChange={(event) => setSystemName(event.target.value)} /></label>
        <label className="field"><span>系统简称</span><input value={shortName} maxLength={4} required onChange={(event) => setShortName(event.target.value)} /></label>
        <div className="system-branding-logo-field">
          <span>系统Logo</span>
          <div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => selectLogo(event.target.files?.[0])} />
            <button type="button" className="ghost-button" onClick={() => fileRef.current?.click()}><ImagePlus size={15} />选择图片</button>
            {previewBranding.logoUrl && <button type="button" className="ghost-button" onClick={() => { setLogoDraft(null); if (fileRef.current) fileRef.current.value = ""; }}>移除Logo</button>}
          </div>
          <small>支持PNG、JPEG、WebP，最大512KB，建议使用正方形图片。</small>
        </div>
        {(localError || save.error) && <p className="form-error system-branding-feedback">{localError || save.error?.message}</p>}
        {message && <p className="system-operation-success system-branding-feedback"><ShieldCheck size={14} />{message}</p>}
        <div className="system-branding-actions">
          <button type="button" className="ghost-button" onClick={() => { setSystemName(defaultBranding.systemName); setShortName(defaultBranding.shortName); setLogoDraft(null); setMessage(""); setLocalError(""); }}>恢复默认值</button>
          <button className="primary-button" disabled={save.isPending || brandingQuery.isLoading}>{save.isPending ? "保存中…" : "保存品牌设置"}</button>
        </div>
      </form>
    </div>
  </article>;
}

export function SystemPage() {
  const { session, openLogin } = useApp();
  const client = useQueryClient();
  const [restoreTarget, setRestoreTarget] = useState<Backup>();
  const [feedback, setFeedback] = useState("");
  const overviewQuery = useQuery({
    queryKey: ["system-overview"],
    queryFn: () => api<SystemOverview>("/api/system/overview"),
    enabled: session.authenticated,
  });
  const backupsQuery = useQuery({
    queryKey: ["backups"],
    queryFn: () => api<Backup[]>("/api/backups"),
    enabled: session.authenticated,
  });
  const refreshSystemData = () => {
    void client.invalidateQueries({ queryKey: ["backups"] });
    void client.invalidateQueries({ queryKey: ["system-overview"] });
  };
  const backup = useMutation({
    mutationFn: () => api<Backup>("/api/backups", { method: "POST" }),
    onSuccess: (result) => {
      setFeedback(`备份已创建：${result.name}`);
      refreshSystemData();
    },
  });
  const restore = useMutation({
    mutationFn: (name: string) =>
      api<{ ok: boolean; message: string; safetyBackupName: string }>("/api/backups/restore", { method: "POST", body: jsonBody({ name }) }),
    onSuccess: (result) => setFeedback(result.message),
  });
  const deleteBackup = useMutation({
    mutationFn: (name: string) => api(`/api/backups/${encodeURIComponent(name)}`, { method: "DELETE" }),
    onSuccess: (_result, name) => {
      setFeedback(`备份已删除：${name}`);
      refreshSystemData();
    },
  });
  const integrityCheck = useMutation({
    mutationFn: () => api<DatabaseIntegrityCheck>("/api/system/database-check", { method: "POST" }),
  });
  const overview = overviewQuery.data;
  const backups = backupsQuery.data ?? [];
  const operationError = backup.error || deleteBackup.error || restore.error;
  if (!session.authenticated)
    return (
      <>
        <PageHeader title="系统管理" />
        <div className="page-content">
          <EmptyState
            title="登录后管理系统设置"
            detail="系统状态和数据库维护功能仅对管理员开放。"
            action={
              <button className="primary-button" onClick={openLogin}>
                用户登录
              </button>
            }
          />
        </div>
      </>
    );
  return (
    <>
      <PageHeader title="系统管理" />
      <div className="page-content">
        <div className="system-page">
          <section className="system-overview-grid" aria-label="系统概览">
            <article className="system-overview-card system-overview-running">
              <ShieldCheck size={22} />
              <div><span>运行状态</span><strong>{overview ? "运行正常" : overviewQuery.isLoading ? "读取中" : "状态未知"}</strong><small>{overview ? `已运行 ${formatUptime(overview.service.uptimeSeconds)}` : "等待系统响应"}</small></div>
            </article>
            <article className="system-overview-card">
              <DatabaseBackup size={22} />
              <div><span>数据库大小</span><strong>{overview ? formatStorageSize(overview.database.totalSizeBytes) : "—"}</strong><small>{overview ? `${overview.database.journalMode} 模式` : "包含数据库运行文件"}</small></div>
            </article>
            <article className={`system-overview-card ${overview?.backups.overdue ? "system-overview-warning" : ""}`}>
              <Clock3 size={22} />
              <div><span>最近备份</span><strong>{relativeTime(overview?.backups.lastCreatedAt ?? null)}</strong><small>{overview?.backups.overdue ? "已超过安全备份周期" : overview?.backups.lastCreatedAt ? new Date(overview.backups.lastCreatedAt).toLocaleString("zh-CN", { hour12: false }) : "请立即创建首份备份"}</small></div>
            </article>
            <article className="system-overview-card">
              <Archive size={22} />
              <div><span>备份空间</span><strong>{overview ? `${overview.backups.count} 份 · ${formatStorageSize(overview.backups.totalSizeBytes)}` : "—"}</strong><small>{overview ? `保留 ${overview.backups.retentionDays} 天，最多 ${overview.backups.maxCount} 份` : "读取备份策略"}</small></div>
            </article>
          </section>

          <article className="panel system-backup-panel">
          <header>
            <div>
              <h2>数据库备份与恢复</h2>
              <p>自动备份每天02:00执行；恢复前会先保存当前数据库</p>
            </div>
            <button
              className="primary-button"
              disabled={backup.isPending}
              onClick={() => { setFeedback(""); backup.mutate(); }}
            >
              <DatabaseBackup size={15} />
              {backup.isPending ? "正在备份…" : "立即备份"}
            </button>
          </header>
          <div className="system-backup-policy">
            <span>保留策略 <strong>{overview ? `${overview.backups.retentionDays}天 / ${overview.backups.maxCount}份` : "—"}</strong></span>
            <span>下次自动备份 <strong>{overview ? new Date(overview.backups.nextScheduledAt).toLocaleString("zh-CN", { hour12: false }) : "—"}</strong></span>
            {feedback && <span className="system-operation-success"><ShieldCheck size={14} />{feedback}</span>}
            {operationError && <span className="system-operation-error">{operationError.message}</span>}
          </div>
          <div className="system-backup-table-wrap">
            <table className="system-backup-table">
              <thead><tr><th>备份时间</th><th>文件名</th><th>大小</th><th>距今</th><th>操作</th></tr></thead>
              <tbody>
                {backups.map((item) => <tr key={item.name}>
                  <td>{new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })}</td>
                  <td><strong title={item.name}>{item.name}</strong></td>
                  <td>{formatStorageSize(item.size)}</td>
                  <td>{relativeTime(item.createdAt)}</td>
                  <td><div className="system-backup-actions">
                    <button className="inline-action-button" disabled={restore.isPending} onClick={() => { setFeedback(""); setRestoreTarget(item); }}><RefreshCcw size={14} />恢复</button>
                    <button className="inline-action-button danger" disabled={deleteBackup.isPending && deleteBackup.variables === item.name} onClick={() => confirm(`删除备份“${item.name}”？该操作无法恢复。`) && deleteBackup.mutate(item.name)}><Trash2 size={14} />{deleteBackup.isPending && deleteBackup.variables === item.name ? "删除中" : "删除"}</button>
                  </div></td>
                </tr>)}
              </tbody>
            </table>
            {backupsQuery.isLoading && <div className="system-table-state">正在读取备份…</div>}
            {!backupsQuery.isLoading && !backups.length && <EmptyState title="暂无备份" detail="可立即创建第一份备份。" />}
          </div>
          </article>

          <section className="system-secondary-grid">
            <article className="panel system-detail-panel">
              <header><div><h2>系统运行信息</h2><p>只读展示当前部署参数</p></div></header>
              <div className="system-detail-list">
                <div><span>应用版本</span><strong>v{overview?.service.version ?? "—"}</strong></div>
                <div><span>启动时间</span><strong>{overview ? new Date(overview.service.startedAt).toLocaleString("zh-CN", { hour12: false }) : "—"}</strong></div>
                <div><span>运行环境</span><strong>{overview?.service.environment ?? "—"}</strong></div>
                <div><span>时区</span><strong>{overview?.service.timezone ?? "—"}</strong></div>
                <div><span>监听地址</span><strong>{overview ? `${overview.service.host}:${overview.service.port}` : "—"}</strong></div>
                <div><span>数据库文件</span><strong title={overview?.database.path}>{overview?.database.path ?? "—"}</strong></div>
                <div><span>备份目录</span><strong title={overview?.database.backupDirectory}>{overview?.database.backupDirectory ?? "—"}</strong></div>
                <div className="http-alert"><ShieldCheck size={16} /><span>当前使用HTTP，仅限可信局域网访问</span></div>
              </div>
            </article>
            <article className="panel system-detail-panel system-check-panel">
              <header><div><h2>数据库健康检查</h2><p>检查SQLite结构和数据页，不修改业务数据</p></div><button className="ghost-button" disabled={integrityCheck.isPending} onClick={() => integrityCheck.mutate()}><ShieldCheck size={15} />{integrityCheck.isPending ? "检查中…" : "立即检查"}</button></header>
              <div className="system-check-content">
                <div className={`system-check-state ${integrityCheck.data ? integrityCheck.data.ok ? "is-success" : "is-error" : ""}`}>
                  <ShieldCheck size={30} />
                  <div><strong>{integrityCheck.data ? integrityCheck.data.ok ? "数据库状态正常" : "发现数据库异常" : "等待执行完整性检查"}</strong><span>{integrityCheck.data?.message ?? `当前使用 ${overview?.database.journalMode || "—"} 日志模式`}</span></div>
                </div>
                {integrityCheck.data && <dl className="system-check-meta"><div><dt>检查时间</dt><dd>{new Date(integrityCheck.data.checkedAt).toLocaleString("zh-CN", { hour12: false })}</dd></div><div><dt>检查耗时</dt><dd>{integrityCheck.data.durationMs} ms</dd></div></dl>}
                {integrityCheck.error && <p className="form-error">{integrityCheck.error.message}</p>}
              </div>
            </article>
            <BrandingSettingsCard />
          </section>
        </div>

        {restoreTarget && <Modal title="恢复数据库备份" width={600} closable={!restore.isPending} onClose={() => { if (!restore.isPending) setRestoreTarget(undefined); }}>
          <div className="system-restore-dialog">
            <div className="system-restore-warning"><RefreshCcw size={22} /><div><strong>恢复后当前数据库将被替换</strong><p>系统会先校验目标备份并自动备份当前数据，然后重启服务。</p></div></div>
            <dl><div><dt>备份文件</dt><dd title={restoreTarget.name}>{restoreTarget.name}</dd></div><div><dt>备份时间</dt><dd>{new Date(restoreTarget.createdAt).toLocaleString("zh-CN", { hour12: false })}</dd></div><div><dt>文件大小</dt><dd>{formatStorageSize(restoreTarget.size)}</dd></div></dl>
            {restore.error && <p className="form-error">{restore.error.message}</p>}
            {restore.data && <p className="system-operation-success"><ShieldCheck size={14} />{restore.data.message}</p>}
            <div className="form-actions"><button className="ghost-button" disabled={restore.isPending} onClick={() => setRestoreTarget(undefined)}>取消</button><button className="primary-button" disabled={restore.isPending || Boolean(restore.data)} onClick={() => restore.mutate(restoreTarget.name)}><RefreshCcw size={15} />{restore.isPending ? "正在校验并备份…" : restore.data ? "等待服务重启" : "确认恢复"}</button></div>
          </div>
        </Modal>}
      </div>
    </>
  );
}

const auditActionLabels: Record<string, string> = {
  create: "创建", update: "修改", archive: "归档", restore: "恢复", delete: "删除",
  permanent_delete: "永久删除", start: "开始", complete: "完成", block: "阻塞",
  unblock: "解除阻塞", cancel: "取消", reorder: "排序", apply_template: "应用模板",
  apply_plan: "补全计划", revoke: "撤销", add_member: "添加成员", remove_member: "移出成员",
  reset_password: "重置密码", change_password: "修改密码", import: "导入",
};
const auditEntityLabels: Record<string, string> = {
  project: "项目", requirement: "需求", work_item: "工作项", progress: "进展",
  issue: "问题", issue_update: "问题进展", person: "人员", account: "账号", template: "流程设计", api_token: "MCP Token", backup: "数据库备份", system_branding: "系统品牌",
};

export function LogsPage() {
  const { session, openLogin, selectedProjectId } = useApp();
  const admin = isAdmin(session);
  const [keyword, setKeyword] = useState("");
  const deferredKeyword = useDeferredValue(keyword);
  const [actorType, setActorType] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), pageSize: "50" });
  if (deferredKeyword.trim()) params.set("q", deferredKeyword.trim());
  if (actorType) params.set("actorType", actorType);
  if (action) params.set("action", action);
  if (entityType) params.set("entityType", entityType);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (!admin && selectedProjectId) params.set("projectId", selectedProjectId);
  const { data, isLoading } = useQuery({
    queryKey: ["audit-search", selectedProjectId, admin, deferredKeyword, actorType, action, entityType, from, to, page],
    queryFn: () => api<AuditPage>(`/api/audit/search?${params}`),
    enabled: session.authenticated && (admin || Boolean(selectedProjectId)),
  });
  const resetPage = (update: () => void) => { update(); setPage(1); };
  if (!session.authenticated) return <><PageHeader title="操作日志" /><div className="page-content"><EmptyState title="登录后查看操作日志" detail="网页和MCP写入会统一记录。" action={<button className="primary-button" onClick={openLogin}>用户登录</button>} /></div></>;
  return <>
    <PageHeader title={admin ? "操作审计" : "项目日志"} />
    <div className="page-content logs-page">
      <div className="audit-filters">
        <label className="search-box"><Search size={16} /><input value={keyword} onChange={(event) => resetPage(() => setKeyword(event.target.value))} placeholder="搜索用户、Token、操作内容或实体ID" /></label>
        <select value={actorType} onChange={(event) => resetPage(() => setActorType(event.target.value))}><option value="">全部来源</option><option value="user">用户</option><option value="token">MCP Token</option></select>
        <select value={action} onChange={(event) => resetPage(() => setAction(event.target.value))}><option value="">全部动作</option>{Object.entries(auditActionLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <select value={entityType} onChange={(event) => resetPage(() => setEntityType(event.target.value))}><option value="">全部对象</option>{Object.entries(auditEntityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <label className="audit-date"><span>从</span><input type="date" value={from} onChange={(event) => resetPage(() => setFrom(event.target.value))} /></label>
        <label className="audit-date"><span>至</span><input type="date" value={to} onChange={(event) => resetPage(() => setTo(event.target.value))} /></label>
      </div>
      <section className="panel audit-panel audit-page-panel">
        <header><div><h2>写入记录</h2><p>共 {data?.total || 0} 条，按时间倒序</p></div></header>
        <div className="audit-table">
          <div className="audit-head"><span>时间</span><span>来源</span><span>对象</span><span>动作</span><span>内容</span></div>
          {data?.items.map((item) => <div key={item.id}>
            <span>{new Date(item.createdAt).toLocaleString("zh-CN")}</span>
            <span title={item.actorType === "token" && item.tokenName ? `MCP Token：${item.tokenName}` : undefined}>{item.actorName || "已删除用户"}{item.actorType === "token" && ` · MCP${item.tokenName ? `（${item.tokenName}）` : ""}`}</span>
            <span>{auditEntityLabels[item.entityType] || item.entityType}</span>
            <span>{auditActionLabels[item.action] || item.action}</span>
            <span title={item.entityId || undefined}>{item.summary}</span>
          </div>)}
        </div>
        {!data?.items.length && !isLoading && <EmptyState title="没有符合条件的日志" detail="调整搜索词或筛选条件后重试。" />}
        <footer className="table-pagination"><span>第 {data?.page || 1} / {data?.pages || 1} 页</span><div><button className="ghost-button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><button className="ghost-button" disabled={page >= (data?.pages || 1)} onClick={() => setPage((value) => value + 1)}>下一页</button></div></footer>
      </section>
    </div>
  </>;
}
