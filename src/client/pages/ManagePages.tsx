import { useDeferredValue, useMemo, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { addDays, format, parseISO, startOfWeek } from "date-fns";
import {
  Archive,
  Clock3,
  Copy,
  DatabaseBackup,
  Edit3,
  GripVertical,
  KeyRound,
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
  Archives,
  PeopleConcurrency,
  Person,
  Project,
  Requirement,
  TemplateItem,
  WorkItemTemplate,
} from "../types";
import { priorityLabels, requirementStatusLabels, riskLabels } from "../../shared/domain";
import { EmptyState, Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { ProjectForm, RequirementForm } from "../components/ManagementForms";
import { canManageProject, isAdmin } from "../permissions";

export function RequirementsPage() {
  const { selectedProjectId, projects, session } = useApp();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const canManage = canManageProject(session, selectedProjectId);
  const { data = [] } = useQuery({
    queryKey: ["requirements", selectedProjectId],
    queryFn: () =>
      api<Requirement[]>(
        `/api/requirements${selectedProjectId ? `?projectId=${selectedProjectId}` : ""}`,
      ),
  });
  const items = data.filter(
    (item) =>
      (!search ||
        item.title.toLowerCase().includes(search.toLowerCase())) &&
      (!status || item.status === status),
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
          <option value="">全部状态</option>
          {Object.entries(requirementStatusLabels).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
        <span>
          {projects.find((p) => p.id === selectedProjectId)?.name || "全部项目"}{" "}
          · {items.length}项
        </span>
      </div>
      <div className="table-panel">
        <table>
          <thead>
            <tr>
              <th>需求</th>
              <th>优先级</th>
              <th>状态</th>
              <th>进度</th>
              <th>风险</th>
              <th>计划完成</th>
              <th>偏差</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                onClick={() => navigate(`/requirements/${item.id}`)}
              >
                <td>
                  <strong>{item.title}</strong>
                  <small>{item.projectName}</small>
                </td>
                <td><span className={`priority-badge priority-${item.priority.toLowerCase()}`}>{priorityLabels[item.priority as keyof typeof priorityLabels] || item.priority}</span></td>
                <td>
                  <span className={`status-pill status-${item.status}`}>
                    {
                      requirementStatusLabels[
                        item.status as keyof typeof requirementStatusLabels
                      ]
                    }
                  </span>
                </td>
                <td>
                  <div className="table-progress">
                    <span>
                      <i style={{ width: `${item.progress}%` }} />
                    </span>
                    <b>{item.progress}%</b>
                  </div>
                </td>
                <td>
                  {item.highRisk ? (
                    <span className="risk-badge risk-high">高风险</span>
                  ) : (
                    riskLabels[item.riskLevel as keyof typeof riskLabels]
                  )}
                </td>
                <td>{item.plannedEnd || "待排期"}</td>
                <td
                  className={
                    item.finishVariance > 0 ? "danger-text" : "safe-text"
                  }
                >
                  {item.finishVariance > 0 ? "+" : ""}
                  {item.finishVariance}天
                </td>
              </tr>
            ))}
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
  const [editing, setEditing] = useState<Project | null | undefined>(undefined);
  const admin = isAdmin(session);
  const { data: templates = [] } = useQuery({
    queryKey: ["templates"],
    queryFn: () => api<WorkItemTemplate[]>("/api/templates"),
  });
  const archive = useMutation({
    mutationFn: (id: string) => api(`/api/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["projects"] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  const templateName = (id: string | null) => templates.find((template) => template.id === id)?.name || "未指定";
  return (
    <>
      <PageHeader
        title="项目管理"
        actions={admin ? (
          <button className="primary-button" onClick={() => setEditing(null)}>
            <Plus size={16} />
            新建项目
          </button>
        ) : null}
      />
      <div className="page-content">
        <div className="table-panel project-table">
          <table>
            <thead><tr><th>项目</th><th>计划周期</th><th>默认模板</th>{session.authenticated && <th>操作</th>}</tr></thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id} className={project.id === selectedProjectId ? "is-current" : ""}>
                  <td><strong>{project.name}</strong>{project.id === selectedProjectId && <small>当前项目</small>}</td>
                  <td>{project.plannedStart || "未设置"} → {project.plannedEnd || "未设置"}</td>
                  <td>{templateName(project.defaultTemplateId)}</td>
                  {session.authenticated && (
                    <td>
                      <div className="project-row-actions">
                        {canManageProject(session, project.id) && <button className="inline-action-button" onClick={() => setEditing(project)}><Edit3 size={14} />编辑</button>}
                        {admin && <button className="inline-action-button danger" onClick={() => confirm(`归档项目“${project.name}”？项目数据可在归档中心恢复。`) && archive.mutate(project.id)}><Archive size={14} />归档</button>}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!projects.length && <EmptyState title="还没有项目" detail="创建第一个项目后即可维护需求和排期。" />}
        </div>
        {editing !== undefined && (
          <Modal title={editing ? "编辑项目" : "新建项目"} onClose={() => setEditing(undefined)}>
            <ProjectForm project={editing || undefined} onClose={() => setEditing(undefined)} />
          </Modal>
        )}
      </div>
    </>
  );
}

function PersonForm({
  person,
  projectId,
  onClose,
}: {
  person?: Person;
  projectId: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (value: object) =>
      api(person ? `/api/people/${person.id}` : "/api/people", {
        method: person ? "PATCH" : "POST",
        body: jsonBody(person ? value : { ...value, projectId }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["people"] });
      void client.invalidateQueries({ queryKey: ["people", projectId] });
      onClose();
    },
  });
  return (
    <form
      className="form-grid"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate(Object.fromEntries(new FormData(event.currentTarget)));
      }}
    >
      <label className="field field-full">
        <span>姓名</span>
        <input
          name="name"
          defaultValue={person?.name || ""}
          required
          autoFocus
        />
      </label>
      <label className="field field-full">
        <span>岗位</span>
        <input name="jobTitle" defaultValue={person?.jobTitle || ""} placeholder="例如：前端开发、测试工程师" />
      </label>
      {mutation.error && (
        <p className="form-error field-full">{mutation.error.message}</p>
      )}
      <div className="form-actions field-full">
        <button type="button" className="ghost-button" onClick={onClose}>
          取消
        </button>
        <button className="primary-button">保存</button>
      </div>
    </form>
  );
}

function AddProjectPersonForm({ projectId, people, onClose }: { projectId: string; people: Person[]; onClose: () => void }) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (personId: string) => api(`/api/projects/${projectId}/people/${personId}`, { method: "POST" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["people", projectId] });
      onClose();
    },
  });
  return <form className="form-grid" onSubmit={(event) => {
    event.preventDefault();
    mutation.mutate(String(new FormData(event.currentTarget).get("personId") || ""));
  }}>
    <label className="field field-full"><span>已有人员</span><select name="personId" required defaultValue=""><option value="" disabled>请选择人员</option>{people.map((person) => <option value={person.id} key={person.id}>{person.name} · {person.jobTitle || "岗位未设置"}</option>)}</select></label>
    {mutation.error && <p className="form-error field-full">{mutation.error.message}</p>}
    <div className="form-actions field-full"><button type="button" className="ghost-button" onClick={onClose}>取消</button><button className="primary-button">添加到项目</button></div>
  </form>;
}

export function PeoplePage() {
  const { session, openLogin, selectedProjectId, projects } = useApp();
  const [viewParams, setViewParams] = useSearchParams();
  const view = viewParams.get("view") === "analysis" ? "analysis" : "matrix";
  const client = useQueryClient();
  const [editing, setEditing] = useState<Person | null | undefined>(undefined);
  const [addingExisting, setAddingExisting] = useState(false);
  const admin = isAdmin(session);
  const canManage = canManageProject(session, selectedProjectId);
  const { data = [] } = useQuery({
    queryKey: ["people", selectedProjectId],
    queryFn: () => api<Person[]>(`/api/people?projectId=${encodeURIComponent(selectedProjectId)}`),
    enabled: Boolean(selectedProjectId),
  });
  const { data: allPeople = [] } = useQuery({ queryKey: ["people", "all"], queryFn: () => api<Person[]>("/api/people"), enabled: canManage });
  const availablePeople = allPeople.filter((person) => !data.some((member) => member.id === person.id));
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
  const archive = useMutation({
    mutationFn: (id: string) => api(`/api/people/${id}`, { method: "DELETE" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["people"] }),
  });
  const removeMember = useMutation({
    mutationFn: (id: string) => api(`/api/projects/${selectedProjectId}/people/${id}`, { method: "DELETE" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["people", selectedProjectId] }),
  });
  return (
    <>
      <PageHeader
        title="人员矩阵"
        actions={view === "matrix" && canManage ? <div className="panel-actions">
          <button className="ghost-button" disabled={!availablePeople.length || !selectedProjectId} onClick={() => setAddingExisting(true)}><UserPlus size={16} />添加已有人员</button>
          {admin && <button className="primary-button" disabled={!selectedProjectId} onClick={() => setEditing(null)}><UserPlus size={16} />新增人员</button>}
        </div> : null}
      />
      <div className="page-content">
        <div className="view-tabs people-subnav" aria-label="人员页面视图">
          <button className={view === "matrix" ? "active" : ""} onClick={() => setViewParams({})}>人员矩阵</button>
          <button className={view === "analysis" ? "active" : ""} onClick={() => setViewParams({ view: "analysis" })}>并发分析</button>
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
                  <article
                    className="person-card person-card-editable"
                    key={person.id}
                    tabIndex={0}
                    aria-label={`编辑人员 ${person.name}`}
                    title="点击修改姓名和岗位"
                    onClick={() => admin ? setEditing(person) : undefined}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      if (admin) setEditing(person);
                    }}
                  >
                    <span className="person-avatar">{person.name.slice(-1)}</span>
                    <div className="person-copy">
                      <strong>{person.name}</strong>
                    </div>
                    {admin && <Edit3 className="person-edit-indicator" size={15} aria-hidden="true" />}
                    {canManage && (
                      <div className="row-actions" onClick={(event) => event.stopPropagation()}>
                        {admin && <button
                          aria-label={`从项目移除 ${person.name}`}
                          title={`从当前项目移除 ${person.name}`}
                          onClick={() => confirm(`将“${person.name}”移出当前项目？历史工作项不会改变。`) && removeMember.mutate(person.id)}
                        >
                          <UserMinus size={15} />
                        </button>}
                        <button
                          aria-label={`归档人员 ${person.name}`}
                          title={`全局归档 ${person.name}`}
                          onClick={() =>
                            confirm(`全局归档“${person.name}”？该人员会从所有项目中隐藏。`) &&
                            archive.mutate(person.id)
                          }
                        >
                          <Archive size={15} />
                        </button>
                      </div>
                    )}
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
        {editing !== undefined && (
        <Modal
          title={editing ? "编辑人员" : "新增人员"}
          onClose={() => setEditing(undefined)}
        >
          <PersonForm
            person={editing || undefined}
            projectId={selectedProjectId}
            onClose={() => setEditing(undefined)}
          />
        </Modal>
        )}
        {addingExisting && <Modal title="添加已有人员" onClose={() => setAddingExisting(false)}><AddProjectPersonForm projectId={selectedProjectId} people={availablePeople} onClose={() => setAddingExisting(false)} /></Modal>}
        </> : <ConcurrencyPanel />}
      </div>
    </>
  );
}

function ConcurrencyPanel() {
  const { selectedProjectId } = useApp();
  const [personId, setPersonId] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const firstWeek = useMemo(() => format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"), []);
  const { data: people = [] } = useQuery({
    queryKey: ["people", selectedProjectId],
    queryFn: () => api<Person[]>(`/api/people?projectId=${encodeURIComponent(selectedProjectId)}`),
    enabled: Boolean(selectedProjectId),
  });
  const jobTitles = useMemo(() => [...new Set(people.map((person) => person.jobTitle).filter(Boolean) as string[])].sort(), [people]);
  const analysis = useInfiniteQuery({
    queryKey: ["people-concurrency", selectedProjectId, personId, jobTitle, firstWeek],
    initialPageParam: firstWeek,
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
  return <div className="people-analysis">
      <div className="filter-bar human-filter-bar">
      <select value={jobTitle} onChange={(event) => { setJobTitle(event.target.value); setPersonId(""); }}><option value="">全部岗位</option>{jobTitles.map((title) => <option value={title} key={title}>{title}</option>)}</select>
      <select value={personId} onChange={(event) => setPersonId(event.target.value)}><option value="">全部人员</option>{people.filter((person) => !jobTitle || person.jobTitle === jobTitle).map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select>
      <span>今天及历史看实际，未来看计划</span>
    </div>
    {currentTop.length > 0 && <section className="human-leaders" aria-label="今日工作最多人员">
      <strong>今日工作较多</strong>
      <div>{currentTop.map((person) => <article key={person.id}><span className="person-avatar">{person.name.slice(-1)}</span><div><b>{person.name}</b><small>{person.jobTitle || "岗位未设置"}</small></div><em className={`load-${Math.min(person.currentCount, 3)}`}>{person.currentCount}项</em></article>)}</div>
    </section>}
    <div className="human-matrix-frame">
      <div className="human-matrix-scroll" onScroll={(event) => {
        const element = event.currentTarget;
        if (element.scrollLeft + element.clientWidth >= element.scrollWidth - 140 && !analysis.isFetchingNextPage) void analysis.fetchNextPage();
      }}>
        <div className="human-week-pages">
          {pages.map((page) => {
            const scheduledPeople = page.people.filter((person) => person.peakCount > 0);
            return <section className="human-week-page" key={page.from}>
              <header><strong>{format(parseISO(page.from), "MM月dd日")}—{format(parseISO(page.to), "MM月dd日")}</strong><span>工作日并发度</span></header>
              <table className="human-week-table"><thead><tr><th>人员</th>{page.dates.map((date) => <th key={date}><span>{["日", "一", "二", "三", "四", "五", "六"][parseISO(date).getDay()]}</span>{date.slice(5).replace("-", "/")}</th>)}</tr></thead>
              <tbody>{scheduledPeople.map((person) => <tr key={person.id}><td><strong>{person.name}</strong><small>{person.jobTitle || "—"}</small></td>{person.days.map((day) => <td key={day.date}><span className={`heat heat-${Math.min(day.count, 3)}`} title={day.items.map((item) => `${item.requirementTitle} · ${item.title}`).join("\n")}>{day.count || ""}</span></td>)}</tr>)}</tbody></table>
              {!scheduledPeople.length && !analysis.isLoading && <EmptyState title="本周暂无安排" detail="有实际工作或未来计划时会自动显示。" />}
            </section>;
          })}
          <button className="human-next-week" disabled={analysis.isFetchingNextPage} onClick={() => void analysis.fetchNextPage()}>{analysis.isFetchingNextPage ? "加载中" : "向右加载下一周"}</button>
        </div>
      </div>
      <footer><span><i className="heat heat-1" />1项 正常</span><span><i className="heat heat-2" />2项 预警</span><span><i className="heat heat-3" />3项及以上 高并发</span><small>横向拖动查看后续周</small></footer>
    </div>
    </div>;
}

function TemplateForm({
  template,
  onClose,
}: {
  template?: WorkItemTemplate;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [items, setItems] = useState<Array<Pick<TemplateItem, "id" | "title" | "startOffsetDays" | "durationDays" | "sortOrder">>>(
    template?.items.map((item) => ({ id: item.id, title: item.title, startOffsetDays: item.startOffsetDays, durationDays: item.durationDays, sortOrder: item.sortOrder })) || [
      { id: "", title: "设计", startOffsetDays: 0, durationDays: 2, sortOrder: 0 },
      { id: "", title: "开发", startOffsetDays: 2, durationDays: 5, sortOrder: 1 },
      { id: "", title: "测试", startOffsetDays: 7, durationDays: 3, sortOrder: 2 },
      { id: "", title: "发布", startOffsetDays: 10, durationDays: 1, sortOrder: 3 },
    ],
  );
  const [dragState, setDragState] = useState<{
    fromIndex: number;
    overIndex: number;
    position: "before" | "after";
  } | null>(null);
  const updateItem = (index: number, patch: Partial<(typeof items)[number]>) => setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const dropItem = (event: ReactDragEvent<HTMLDivElement>, overIndex: number) => {
    event.preventDefault();
    const fromIndex = dragState?.fromIndex ?? Number(event.dataTransfer.getData("text/plain"));
    const position = dragState?.position || "before";
    if (!Number.isInteger(fromIndex)) return setDragState(null);
    setItems((current) => {
      if (fromIndex < 0 || fromIndex >= current.length) return current;
      const reordered = [...current];
      const [moved] = reordered.splice(fromIndex, 1);
      let insertionIndex = overIndex + (position === "after" ? 1 : 0);
      if (fromIndex < insertionIndex) insertionIndex -= 1;
      reordered.splice(Math.max(0, Math.min(insertionIndex, reordered.length)), 0, moved);
      return reordered.map((item, itemIndex) => ({ ...item, sortOrder: itemIndex }));
    });
    setDragState(null);
  };
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
        mutation.mutate({ name: data.get("name"), description: data.get("description"), items: items.map((item, index) => ({ ...item, id: item.id || undefined, sortOrder: index })) });
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
          <div className="template-editor-head"><span /><span>工作项</span><span>开始偏移</span><span>工期</span><span /></div>
          {items.map((item, index) => <div
            className={`template-editor-row${dragState?.fromIndex === index ? " is-dragging" : ""}${dragState?.overIndex === index ? ` drop-${dragState.position}` : ""}`}
            key={item.id || index}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              const bounds = event.currentTarget.getBoundingClientRect();
              const position = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
              setDragState((current) => current ? { ...current, overIndex: index, position } : current);
            }}
            onDrop={(event) => dropItem(event, index)}
          >
            <button
              type="button"
              className="template-drag-handle"
              draggable
              aria-label={`拖动${item.title || "工作项"}调整顺序`}
              aria-grabbed={dragState?.fromIndex === index}
              title="按住拖动调整顺序"
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", String(index));
                setDragState({ fromIndex: index, overIndex: index, position: "before" });
              }}
              onDragEnd={() => setDragState(null)}
            >
              <GripVertical size={17} />
            </button>
            <input value={item.title} required onChange={(event) => updateItem(index, { title: event.target.value })} />
            <input type="number" min="0" value={item.startOffsetDays} onChange={(event) => updateItem(index, { startOffsetDays: Math.max(0, Number(event.target.value)) })} />
            <input type="number" min="1" value={item.durationDays} onChange={(event) => updateItem(index, { durationDays: Math.max(1, Number(event.target.value)) })} />
            <button type="button" className="template-delete-item" aria-label={`删除${item.title || "工作项"}`} title="删除" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></button>
          </div>)}
          <button type="button" className="ghost-button add-template-item" onClick={() => setItems((current) => [...current, { id: "", title: `工作项${current.length + 1}`, startOffsetDays: totalDays, durationDays: 1, sortOrder: current.length }])}><Plus size={14} />添加工作项</button>
        </div>
        <div className="template-gantt">
          <div className="template-gantt-scale"><span>第1天</span><span>共{totalDays}个工作日</span></div>
          {items.map((item, index) => <div className="template-gantt-row" key={item.id || index}>
            <span className="template-gantt-title">{item.title || "未命名"}</span>
            <div className="template-gantt-track"><button type="button" className="template-gantt-bar" style={{ left: `${(item.startOffsetDays / totalDays) * 100}%`, width: `${(item.durationDays / totalDays) * 100}%` }} onPointerDown={(event) => beginTimelineDrag(event, index, "move")} title={`第${item.startOffsetDays + 1}个工作日开始，持续${item.durationDays}天`}><span>{item.durationDays}天</span><i onPointerDown={(event) => beginTimelineDrag(event, index, "resize")} /></button></div>
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
  const { session, openLogin } = useApp();
  const client = useQueryClient();
  const [editing, setEditing] = useState<WorkItemTemplate | null | undefined>(
    undefined,
  );
  const { data = [] } = useQuery({
    queryKey: ["templates"],
    queryFn: () => api<WorkItemTemplate[]>("/api/templates"),
  });
  const archive = useMutation({
    mutationFn: (id: string) =>
      api(`/api/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["templates"] }),
  });
  return (
    <>
      <PageHeader
        title="流程设计"
        actions={isAdmin(session) ? (
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
                <small>{template.items.length}个工作项</small>
              </div>
              {isAdmin(session) && (
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
                  <div><b>{item.title}</b><small>第{item.startOffsetDays + 1}个工作日 · {item.durationDays}天</small></div>
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

export function SystemPage() {
  const { session, openLogin } = useApp();
  const client = useQueryClient();
  const [newToken, setNewToken] = useState<string>();
  const [tokenModal, setTokenModal] = useState(false);
  const [archiveKeyword, setArchiveKeyword] = useState("");
  const [archiveType, setArchiveType] = useState<"all" | ArchiveEntity>("all");
  const { data: tokens = [] } = useQuery({
    queryKey: ["tokens"],
    queryFn: () => api<ApiToken[]>("/api/tokens"),
    enabled: session.authenticated,
  });
  const { data: backups = [] } = useQuery({
    queryKey: ["backups"],
    queryFn: () => api<Backup[]>("/api/backups"),
    enabled: session.authenticated,
  });
  const { data: archives } = useQuery({
    queryKey: ["archives"],
    queryFn: () => api<Archives>("/api/archives"),
    enabled: session.authenticated,
  });
  const archiveRows = useMemo(() => archiveEntityOptions.flatMap(({ value, label }) =>
    (archives?.[value] || []).map((item) => ({ ...item, entity: value, typeLabel: label }))), [archives]);
  const filteredArchiveRows = useMemo(() => {
    const keyword = archiveKeyword.trim().toLowerCase();
    return archiveRows
      .filter((item) => archiveType === "all" || item.entity === archiveType)
      .filter((item) => !keyword || `${item.title} ${item.jobTitle || ""} ${item.typeLabel}`.toLowerCase().includes(keyword))
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }, [archiveKeyword, archiveRows, archiveType]);
  const createToken = useMutation({
    mutationFn: (value: object) =>
      api<ApiToken & { token: string }>("/api/tokens", {
        method: "POST",
        body: jsonBody(value),
      }),
    onSuccess: (result) => {
      setNewToken(result.token);
      void client.invalidateQueries({ queryKey: ["tokens"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["tokens"] }),
  });
  const backup = useMutation({
    mutationFn: () => api("/api/backups", { method: "POST" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["backups"] }),
  });
  const restore = useMutation({
    mutationFn: (name: string) =>
      api("/api/backups/restore", { method: "POST", body: jsonBody({ name }) }),
  });
  const deleteBackup = useMutation({
    mutationFn: (name: string) => api(`/api/backups/${encodeURIComponent(name)}`, { method: "DELETE" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["backups"] }),
  });
  const restoreArchive = useMutation({
    mutationFn: ({ entity, id }: { entity: "projects" | "requirements" | "people" | "templates"; id: string }) => api(`/api/${entity}/${id}/restore`, { method: "POST" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["archives"] });
      void client.invalidateQueries({ queryKey: ["projects"] });
      void client.invalidateQueries({ queryKey: ["people"] });
      void client.invalidateQueries({ queryKey: ["templates"] });
      void client.invalidateQueries({ queryKey: ["requirements"] });
    },
  });
  const deleteArchive = useMutation({
    mutationFn: ({ entity, id }: { entity: "projects" | "requirements" | "people" | "templates"; id: string }) =>
      api(`/api/archives/${entity}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["archives"] });
      void client.invalidateQueries({ queryKey: ["audit"] });
      void client.invalidateQueries({ queryKey: ["projects"] });
      void client.invalidateQueries({ queryKey: ["people"] });
      void client.invalidateQueries({ queryKey: ["templates"] });
      void client.invalidateQueries({ queryKey: ["requirements"] });
    },
  });
  if (!session.authenticated)
    return (
      <>
        <PageHeader title="系统管理" />
        <div className="page-content">
          <EmptyState
            title="登录后管理系统设置"
            detail="Token、数据库备份和归档内容仅对已登录用户开放。"
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
      <PageHeader
        title="系统管理"
        actions={<div className="http-alert">
          <ShieldCheck size={16} />
          <span>当前使用HTTP，仅限可信局域网</span>
        </div>}
      />
      <div className="page-content">
        <section className="system-grid">
        <article className="panel system-panel">
          <header>
            <div>
              <h2>MCP Token</h2>
              <p>完整业务读写权限</p>
            </div>
            <button
              className="primary-button"
              onClick={() => {
                setNewToken(undefined);
                setTokenModal(true);
              }}
            >
              <KeyRound size={15} />
              创建Token
            </button>
          </header>
          <div className="compact-list">
            {tokens.map((token) => (
              <div key={token.id}>
                <KeyRound size={16} />
                <div>
                  <strong>{token.name}</strong>
                  <span>
                    pm_{token.prefix}_… ·{" "}
                    {token.expiresAt
                      ? `${new Date(token.expiresAt).toLocaleDateString()}到期`
                      : "永久有效"}{" "}
                    · 最近使用{" "}
                    {token.lastUsedAt
                      ? new Date(token.lastUsedAt).toLocaleString()
                      : "从未"}
                  </span>
                </div>
                <b className={token.revokedAt ? "muted" : "safe-text"}>
                  {token.revokedAt ? "已撤销" : "有效"}
                </b>
                {!token.revokedAt && (
                  <button
                    onClick={() =>
                      confirm("确认撤销此Token？") && revoke.mutate(token.id)
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </article>
        <article className="panel system-panel">
          <header>
            <div>
              <h2>数据库备份</h2>
              <p>本地时间每日02:00自动备份，保留30天且最多100份</p>
            </div>
            <button className="ghost-button" onClick={() => backup.mutate()}>
              <DatabaseBackup size={15} />
              立即备份
            </button>
          </header>
          <div className="compact-list">
            {backups.map((item) => (
              <div key={item.name}>
                <DatabaseBackup size={16} />
                <div>
                  <strong>{item.name}</strong>
                  <span>
                    {(item.size / 1024).toFixed(1)} KB ·{" "}
                    {new Date(item.createdAt).toLocaleString()}
                  </span>
                </div>
                <button
                  className="compact-text-button"
                  title="恢复此备份"
                  onClick={() =>
                    confirm("恢复会替换当前数据库并重启服务，确认继续？") &&
                    restore.mutate(item.name)
                  }
                >
                  <RefreshCcw size={14} />
                  恢复
                </button>
                <button
                  className="compact-text-button danger"
                  title="删除此备份"
                  onClick={() => confirm(`删除备份“${item.name}”？该操作无法恢复。`) && deleteBackup.mutate(item.name)}
                >
                  <Trash2 size={14} />
                  删除
                </button>
              </div>
            ))}
            {!backups.length && (
              <EmptyState title="暂无备份" detail="可立即创建第一份备份。" />
            )}
          </div>
        </article>
        </section>
      <section className="panel archive-panel">
        <header><div><h2>归档中心</h2><p>统一查看、恢复或永久删除已归档内容</p></div></header>
        <div className="archive-toolbar">
          <label className="search-box"><Search size={16} /><input value={archiveKeyword} onChange={(event) => setArchiveKeyword(event.target.value)} placeholder="搜索归档名称或岗位" /></label>
          <select value={archiveType} onChange={(event) => setArchiveType(event.target.value as "all" | ArchiveEntity)}><option value="all">全部类型</option>{archiveEntityOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
          <span>{filteredArchiveRows.length} / {archiveRows.length} 条</span>
        </div>
        <div className="archive-table-wrap">
          <table className="archive-table">
            <thead><tr><th>名称</th><th>类型</th><th>补充信息</th><th>归档时间</th><th>操作</th></tr></thead>
            <tbody>{filteredArchiveRows.map((item) => <tr key={`${item.entity}-${item.id}`}>
              <td><strong title={item.title}>{item.title}</strong></td>
              <td><span className={`archive-type archive-type-${item.entity}`}>{item.typeLabel}</span></td>
              <td>{item.jobTitle || "—"}</td>
              <td>{new Date(item.deletedAt).toLocaleString("zh-CN")}</td>
              <td><div className="archive-row-actions"><button className="inline-action-button" title={`恢复${item.typeLabel}`} onClick={() => restoreArchive.mutate({ entity: item.entity, id: item.id })}><RotateCcw size={14} />恢复</button><button className="inline-action-button danger" title={`永久删除${item.typeLabel}`} onClick={() => confirm(`永久删除“${item.title}”？该操作无法恢复。${item.entity === "projects" ? "项目下的需求和工作项也会一并删除。" : ""}`) && deleteArchive.mutate({ entity: item.entity, id: item.id })}><Trash2 size={14} />删除</button></div></td>
            </tr>)}</tbody>
          </table>
          {!filteredArchiveRows.length && <EmptyState title="没有符合条件的归档内容" detail={archiveRows.length ? "调整搜索词或类型筛选后重试。" : "归档项目、需求、人员或模板后会显示在这里。"} />}
        </div>
        {(restoreArchive.error || deleteArchive.error) && <p className="form-error archive-error">{(restoreArchive.error || deleteArchive.error)?.message}</p>}
      </section>
      {tokenModal && (
        <Modal title="创建MCP Token" onClose={() => setTokenModal(false)}>
          {newToken ? (
            <div className="token-reveal">
              <ShieldCheck size={38} />
              <strong>Token只显示这一次</strong>
              <p>请立即复制并安全保存。数据库中只保留哈希。</p>
              <div>
                <code>{newToken}</code>
                <button
                  onClick={() => void navigator.clipboard.writeText(newToken)}
                >
                  <Copy size={16} />
                </button>
              </div>
              <button
                className="primary-button"
                onClick={() => setTokenModal(false)}
              >
                我已保存
              </button>
            </div>
          ) : (
            <form
              className="form-grid"
              onSubmit={(event) => {
                event.preventDefault();
                const data = Object.fromEntries(
                  new FormData(event.currentTarget),
                );
                createToken.mutate({
                  name: data.name,
                  expiresInDays:
                    data.expiresInDays === "never"
                      ? null
                      : Number(data.expiresInDays),
                });
              }}
            >
              <label className="field field-full">
                <span>Token名称</span>
                <input name="name" required placeholder="例如：Codex项目查询" />
              </label>
              <label className="field field-full">
                <span>有效期</span>
                <select name="expiresInDays" defaultValue="90">
                  <option value="30">30天</option>
                  <option value="90">90天（默认）</option>
                  <option value="never">永久有效</option>
                </select>
              </label>
              <div className="form-actions field-full">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setTokenModal(false)}
                >
                  取消
                </button>
                <button className="primary-button">创建Token</button>
              </div>
            </form>
          )}
        </Modal>
      )}
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
  issue: "问题", issue_update: "问题进展", person: "人员", account: "账号", template: "流程设计", api_token: "MCP Token", backup: "数据库备份",
};

export function LogsPage() {
  const { session, openLogin } = useApp();
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
  const { data, isLoading } = useQuery({
    queryKey: ["audit-search", deferredKeyword, actorType, action, entityType, from, to, page],
    queryFn: () => api<AuditPage>(`/api/audit/search?${params}`),
    enabled: session.authenticated,
  });
  const resetPage = (update: () => void) => { update(); setPage(1); };
  if (!session.authenticated) return <><PageHeader title="操作日志" /><div className="page-content"><EmptyState title="登录后查看操作日志" detail="网页和MCP写入会统一记录。" action={<button className="primary-button" onClick={openLogin}>用户登录</button>} /></div></>;
  return <>
    <PageHeader title="操作日志" />
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
