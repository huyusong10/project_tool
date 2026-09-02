import { useMemo, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
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
  UserPlus,
} from "lucide-react";
import { api, jsonBody } from "../api";
import { useApp } from "../app-context";
import type {
  ApiToken,
  AuditLog,
  Backup,
  Archives,
  PeopleConcurrency,
  Person,
  Requirement,
  TemplateItem,
  WorkItemTemplate,
} from "../types";
import { priorityLabels, requirementStatusLabels, riskLabels } from "../../shared/domain";
import { EmptyState, Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";

export function RequirementsPage() {
  const { selectedProjectId, projects, session } = useApp();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
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
        title="全部需求"
        actions={session.authenticated ? (
          <button className="primary-button" onClick={() => navigate("/")}>
            <Plus size={16} />
            前往项目进展
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
            detail="调整筛选条件，或从项目进展新建需求。"
          />
        )}
        </div>
      </div>
    </>
  );
}

function PersonForm({
  person,
  onClose,
}: {
  person?: Person;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (value: object) =>
      api(person ? `/api/people/${person.id}` : "/api/people", {
        method: person ? "PATCH" : "POST",
        body: jsonBody(value),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["people"] });
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

export function PeoplePage() {
  const { session, openLogin } = useApp();
  const client = useQueryClient();
  const [editing, setEditing] = useState<Person | null | undefined>(undefined);
  const { data = [] } = useQuery({
    queryKey: ["people"],
    queryFn: () => api<Person[]>("/api/people"),
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
  const archive = useMutation({
    mutationFn: (id: string) => api(`/api/people/${id}`, { method: "DELETE" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["people"] }),
  });
  return (
    <>
      <PageHeader
        title="人员矩阵"
        actions={session.authenticated ? (
          <button className="primary-button" onClick={() => setEditing(null)}>
            <UserPlus size={16} />
            新增人员
          </button>
        ) : null}
      />
      <div className="page-content">
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
                    onClick={() => session.authenticated ? setEditing(person) : openLogin()}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      session.authenticated ? setEditing(person) : openLogin();
                    }}
                  >
                    <span className="person-avatar">{person.name.slice(-1)}</span>
                    <div className="person-copy">
                      <strong>{person.name}</strong>
                    </div>
                    {session.authenticated && (
                      <div className="row-actions" onClick={(event) => event.stopPropagation()}>
                        <button className="person-edit-button" aria-label={`编辑 ${person.name}`} onClick={() => setEditing(person)}>
                          <Edit3 size={15} />编辑
                        </button>
                        <button
                          aria-label={`归档 ${person.name}`}
                          onClick={() =>
                            confirm(`归档“${person.name}”？`) &&
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
              detail="新增人员并设置岗位后，将自动形成岗位分组。"
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
            onClose={() => setEditing(undefined)}
          />
        </Modal>
        )}
      </div>
    </>
  );
}

export function ConcurrencyPage() {
  const { selectedProjectId } = useApp();
  const [personId, setPersonId] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const { data: people = [] } = useQuery({ queryKey: ["people"], queryFn: () => api<Person[]>("/api/people") });
  const jobTitles = useMemo(() => [...new Set(people.map((person) => person.jobTitle).filter(Boolean) as string[])].sort(), [people]);
  const { data, isLoading } = useQuery({
    queryKey: ["people-concurrency", selectedProjectId, personId, jobTitle],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedProjectId) params.set("projectId", selectedProjectId);
      if (personId) params.set("personId", personId);
      if (jobTitle) params.set("jobTitle", jobTitle);
      return api<PeopleConcurrency>(`/api/analytics/people-concurrency?${params}`);
    },
  });
  return <>
    <PageHeader title="人员并发分析" />
    <div className="page-content">
      <div className="filter-bar">
      <select value={jobTitle} onChange={(event) => setJobTitle(event.target.value)}><option value="">全部岗位</option>{jobTitles.map((title) => <option value={title} key={title}>{title}</option>)}</select>
      <select value={personId} onChange={(event) => setPersonId(event.target.value)}><option value="">全部人员</option>{people.filter((person) => !jobTitle || person.jobTitle === jobTitle).map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select>
      <span>今天看实际进行，未来看计划安排</span>
    </div>
    <section className="concurrency-summary">
      {(data?.currentTop || []).slice(0, 5).map((person) => <article key={person.id}><span className="person-avatar">{person.name.slice(-1)}</span><div><strong>{person.name}</strong><small>{person.jobTitle || "岗位未设置"}</small></div><b className={`load-${Math.min(person.currentCount, 3)}`}>{person.currentCount}项</b></article>)}
      {!data?.currentTop.some((person) => person.currentCount) && !isLoading && <EmptyState title="今天没有并发工作" detail="未来计划仍可在下方热力图中查看。" />}
    </section>
    <div className="concurrency-table-wrap">
      <table className="concurrency-table"><thead><tr><th>人员</th>{data?.dates.map((date) => <th key={date}>{date.slice(5).replace("-", "/")}</th>)}<th>峰值</th></tr></thead>
      <tbody>{data?.people.map((person) => <tr key={person.id}><td><strong>{person.name}</strong><small>{person.jobTitle || "—"}</small></td>{person.days.map((day) => <td key={day.date}><span className={`heat heat-${Math.min(day.count, 3)}`} title={day.items.length ? day.items.map((item) => `${item.requirementTitle} · ${item.title}`).join("\n") : "无工作项"}>{day.count || ""}</span></td>)}<td><b className={`load-${Math.min(person.peakCount, 3)}`}>{person.peakCount}</b></td></tr>)}</tbody></table>
      {!data?.people.length && !isLoading && <EmptyState title="没有人员数据" detail="请先维护人员、岗位和工作项负责人。" />}
      </div>
    </div>
  </>;
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
        mutation.mutate({ name: data.get("name"), items: items.map((item, index) => ({ ...item, id: item.id || undefined, sortOrder: index })) });
      }}
    >
      <label className="field field-full">
        <span>模板名称</span>
        <input name="name" defaultValue={template?.name || ""} required />
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
        相同或重叠的时间区间表示并行与交错；修改模板不会覆盖已有需求。
      </p>
      {mutation.error && (
        <p className="form-error field-full">{mutation.error.message}</p>
      )}
      <div className="form-actions field-full">
        <button type="button" className="ghost-button" onClick={onClose}>
          取消
        </button>
        <button className="primary-button">保存模板</button>
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
        title="工作项模板"
        actions={session.authenticated ? (
          <button className="primary-button" onClick={() => setEditing(null)}>
            <Plus size={16} />
            新建模板
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
              {session.authenticated && (
                <div className="row-actions">
                  <button aria-label={`编辑模板 ${template.name}`} onClick={() => setEditing(template)}>
                    <Edit3 size={15} />
                  </button>
                  <button
                    aria-label={`归档模板 ${template.name}`}
                    onClick={() =>
                      confirm(`归档模板“${template.name}”？`) &&
                      archive.mutate(template.id)
                    }
                  >
                    <Archive size={15} />
                  </button>
                </div>
              )}
            </header>
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
          title={editing ? "编辑模板" : "新建模板"}
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

export function SystemPage() {
  const { session, openLogin } = useApp();
  const client = useQueryClient();
  const [newToken, setNewToken] = useState<string>();
  const [tokenModal, setTokenModal] = useState(false);
  const { data: tokens = [] } = useQuery({
    queryKey: ["tokens"],
    queryFn: () => api<ApiToken[]>("/api/tokens"),
    enabled: session.authenticated,
  });
  const { data: audit = [] } = useQuery({
    queryKey: ["audit"],
    queryFn: () => api<AuditLog[]>("/api/audit?limit=80"),
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
        <PageHeader title="Token、备份与审计" />
        <div className="page-content">
          <EmptyState
            title="登录后管理系统设置"
            detail="Token、备份和审计日志仅对已登录用户开放。"
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
        title="Token、备份与审计"
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
              <p>每日02:00自动备份，保留30天</p>
            </div>
            <button className="ghost-button" onClick={() => backup.mutate()}>
              <DatabaseBackup size={15} />
              立即备份
            </button>
          </header>
          <div className="compact-list">
            {backups.slice(0, 8).map((item) => (
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
                  title="恢复此备份"
                  onClick={() =>
                    confirm("恢复会替换当前数据库并重启服务，确认继续？") &&
                    restore.mutate(item.name)
                  }
                >
                  <RefreshCcw size={14} />
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
        <header><div><h2>归档中心</h2><p>可恢复或永久删除已归档内容；永久删除后无法恢复</p></div></header>
        <div className="archive-columns">
          {([['projects', '项目'], ['requirements', '需求'], ['people', '人员'], ['templates', '模板']] as const).map(([entity, label]) => <div key={entity}><h3>{label}<span>{archives?.[entity].length || 0}</span></h3>
            {archives?.[entity].map((item) => <article key={item.id}><div><strong>{item.title}</strong><small>{item.jobTitle ? `${item.jobTitle} · ` : ''}{new Date(item.deletedAt).toLocaleString('zh-CN')}</small></div><button title={`恢复${label}`} onClick={() => restoreArchive.mutate({ entity, id: item.id })}><RotateCcw size={14} /></button><button className="archive-delete-button" title={`永久删除${label}`} onClick={() => confirm(`永久删除“${item.title}”？该操作无法恢复。${entity === 'projects' ? '项目下的需求和工作项也会一并删除。' : ''}`) && deleteArchive.mutate({ entity, id: item.id })}><Trash2 size={14} /></button></article>)}
            {!archives?.[entity].length && <p>暂无归档{label}</p>}
          </div>)}
        </div>
        {(restoreArchive.error || deleteArchive.error) && <p className="form-error archive-error">{(restoreArchive.error || deleteArchive.error)?.message}</p>}
      </section>
      <section className="panel audit-panel">
        <header>
          <div>
            <h2>最近操作</h2>
            <p>网页和MCP写入统一记录</p>
          </div>
        </header>
        <div className="audit-table">
          <div className="audit-head">
            <span>时间</span>
            <span>来源</span>
            <span>动作</span>
            <span>内容</span>
          </div>
          {audit.map((item) => (
            <div key={item.id}>
              <span>{new Date(item.createdAt).toLocaleString()}</span>
              <span>
                {item.actorType === "token"
                  ? `Token · ${item.actorId?.slice(0, 8)}`
                  : "用户"}
              </span>
              <span>{item.action}</span>
              <span>{item.summary}</span>
            </div>
          ))}
        </div>
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
