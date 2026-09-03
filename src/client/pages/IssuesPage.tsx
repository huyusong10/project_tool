import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  PauseCircle,
  Plus,
  Search,
  Settings,
  UserRound,
} from "lucide-react";
import { api, jsonBody } from "../api";
import { useApp } from "../app-context";
import type { Issue, IssuePage, IssueUpdate, Person, Requirement } from "../types";
import { issueStatusLabels, priorityLabels, todayIso } from "../../shared/domain";
import { EmptyState, Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { ProgressInput } from "../components/ProgressInput";
import { InlineDateCell, InlineSelectCell, InlineTextCell } from "../components/InlineEdit";
import { canManageProject } from "../permissions";
import { issueStatusOptions, priorityOptions } from "../ui-options";

const statusEntries = issueStatusOptions.map(({ value, label }) => [value, label] as const);
const priorityEntries = priorityOptions.map(({ value, label }) => [value, label] as const);

function defaultIssueStatus(params: URLSearchParams) {
  return params.has("status") ? params.get("status") || "" : "in_progress";
}

function issueScope(issue: Issue) {
  return issue.requirementTitle || issue.sourceRef || "公共问题";
}

function shortDateTime(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

type SearchSelectOption = { value: string; label: string; description?: string };

function SearchSelectField({
  label,
  name,
  value,
  options,
  onChange,
  placeholder = "请选择",
  searchPlaceholder,
  pinnedValues = [],
  helper,
}: {
  label: string;
  name: string;
  value: string;
  options: SearchSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  pinnedValues?: string[];
  helper?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value);
  const keyword = query.trim().toLowerCase();
  const pinned = options.filter((option) => pinnedValues.includes(option.value));
  const matched = options.filter((option) => !pinnedValues.includes(option.value)
    && (!keyword || `${option.label} ${option.description || ""}`.toLowerCase().includes(keyword)));
  const visibleOptions = [...pinned];
  if (selected && !visibleOptions.some((option) => option.value === selected.value)) visibleOptions.push(selected);
  for (const option of matched) {
    if (visibleOptions.length >= 20) break;
    if (!visibleOptions.some((current) => current.value === option.value)) visibleOptions.push(option);
  }

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return <div className="field issue-search-select-field">
    <span>{label}</span>
    <div ref={rootRef} className={`issue-search-select${open ? " is-open" : ""}`}>
      <input type="hidden" name={name} value={value} readOnly />
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}：${selected?.label || value || placeholder}`} onClick={() => { setOpen((current) => !current); setQuery(""); }}>
        <span className={!selected && !value ? "is-placeholder" : ""}>{selected?.label || value || placeholder}</span><ChevronDown size={15} />
      </button>
      {open && <div className="issue-search-select-menu">
        <label><Search size={14} /><input autoFocus value={query} placeholder={searchPlaceholder || `搜索${label}`} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); setOpen(false); setQuery(""); }
        }} /></label>
        <div role="listbox" aria-label={label}>
          {visibleOptions.map((option) => <button type="button" role="option" aria-selected={option.value === value} key={option.value || "__empty"} onClick={() => { onChange(option.value); setOpen(false); setQuery(""); }}>
            <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>{option.value === value && <Check size={15} />}
          </button>)}
          {!visibleOptions.length && <p>没有匹配选项</p>}
        </div>
      </div>}
    </div>
    {helper && <small>{helper}</small>}
  </div>;
}

function IssueForm({
  issue,
  projectId,
  people,
  requirements,
  canManage,
  defaultReporter,
  onClose,
}: {
  issue?: Issue;
  projectId: string;
  people: Person[];
  requirements: Requirement[];
  canManage: boolean;
  defaultReporter?: string | null;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [dueDate, setDueDate] = useState(issue?.status === "deferred" ? "" : issue?.dueDate || "");
  const [requirementId, setRequirementId] = useState(issue?.requirementId || "");
  const [ownerId, setOwnerId] = useState(issue?.ownerId || "");
  const [reporter, setReporter] = useState(issue?.reporter || defaultReporter || "");
  const requirementOptions: SearchSelectOption[] = [
    { value: "", label: "公共问题", description: "不绑定具体需求" },
    ...requirements.map((requirement) => ({ value: requirement.id, label: requirement.title })),
  ];
  const reporterOptions: SearchSelectOption[] = [
    { value: "", label: "未指定" },
    ...people.map((person) => ({ value: person.name, label: person.name })),
  ];
  if (reporter && !reporterOptions.some((option) => option.value === reporter)) {
    reporterOptions.push({ value: reporter, label: reporter, description: issue?.reporter === reporter ? "历史记录" : "当前登录账号" });
  }
  const ownerOptions: SearchSelectOption[] = [
    { value: "", label: "未分配" },
    ...people.map((person) => ({ value: person.id, label: person.name })),
  ];
  const mutation = useMutation({
    mutationFn: (value: object) => api<Issue>(issue ? `/api/issues/${issue.id}` : "/api/issues", {
      method: issue ? "PATCH" : "POST",
      body: jsonBody(value),
    }),
    onSuccess: (saved) => {
      void client.invalidateQueries({ queryKey: ["issues"] });
      void client.invalidateQueries({ queryKey: ["issue", saved.id] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
  });
  return <form className="form-grid issue-form" onSubmit={(event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    mutation.mutate({
      ...data,
      projectId,
      ...(issue ? { expectedVersion: issue.version, ownerId: canManage ? ownerId : issue.ownerId } : { ownerId: null }),
    });
  }}>
    <label className="field field-full"><span>问题标题</span><input name="title" required autoFocus defaultValue={issue?.title || ""} placeholder="用一句话说明要跟踪的问题" /></label>
    <label className="field field-full"><span>问题影响</span><textarea name="impact" rows={3} defaultValue={issue?.impact || ""} placeholder="可选：说明影响范围、风险或被阻塞的工作" /></label>
    {!canManage && <p className="issue-contributor-note field-full">提交后问题进入“待处理”，由项目经理分配负责人并确认关闭。</p>}
    <SearchSelectField label="关联需求" name="requirementId" value={requirementId} options={requirementOptions} onChange={setRequirementId} pinnedValues={[""]} searchPlaceholder="搜索需求编号或名称" helper="默认展示最多20项，输入关键字可快速筛选" />
    <label className="field"><span>范围标识</span><input name="sourceRef" defaultValue={issue?.sourceRef || ""} placeholder="可选，如 DCIM-36" /></label>
    {issue && <div className="field issue-readonly-field"><span>当前状态</span><div><span className={`issue-status issue-status-${issue.status}`}>{issueStatusLabels[issue.status as keyof typeof issueStatusLabels]}</span></div><small>状态通过开始、暂缓、解决或重开操作变更</small></div>}
    <label className="field"><span>优先级</span><select name="priority" defaultValue={issue?.priority || "P2"}>{priorityEntries.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
    {canManage && issue && issue.status !== "resolved" && <SearchSelectField label="负责人" name="ownerId" value={ownerId} options={ownerOptions} onChange={setOwnerId} pinnedValues={[""]} searchPlaceholder="搜索负责人姓名" />}
    <SearchSelectField label="提出人" name="reporter" value={reporter} options={reporterOptions} onChange={setReporter} pinnedValues={[""]} searchPlaceholder="搜索项目成员" helper={issue?.reporter && !people.some((person) => person.name === issue.reporter) ? "当前值为历史自由文本，重新选择后将使用项目成员姓名" : undefined} />
    <label className="field"><span>发现日期</span><input name="discoveredAt" type="date" required defaultValue={issue?.discoveredAt || todayIso()} /></label>
    <label className="field"><span>目标日期</span><input name="dueDate" type="date" value={dueDate} disabled={issue?.status === "deferred"} onChange={(event) => setDueDate(event.target.value)} />{issue?.status === "deferred" && <small>暂缓问题不设置目标日期</small>}</label>
    {mutation.error && <p className="form-error field-full">{mutation.error.message}</p>}
    <div className="form-actions field-full"><button type="button" className="ghost-button" onClick={onClose}>取消</button><button className="primary-button" disabled={mutation.isPending}>{issue ? "保存修改" : "创建问题"}</button></div>
  </form>;
}

function IssueUpdateForm({ issue, canSetProgress }: { issue: Issue; canSetProgress: boolean }) {
  const client = useQueryClient();
  const [progress, setProgress] = useState(issue.progress);
  useEffect(() => setProgress(issue.progress), [issue.progress]);
  const mutation = useMutation({
    mutationFn: (value: { content: string; progress?: number; expectedVersion?: number }) => api<Issue>(`/api/issues/${issue.id}/updates`, { method: "POST", body: jsonBody(value) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["issue", issue.id] });
      void client.invalidateQueries({ queryKey: ["issues"] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  return <form className="issue-update-form" onSubmit={(event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const content = String(new FormData(form).get("content") || "");
    mutation.mutate(canSetProgress ? { content, progress, expectedVersion: issue.version } : { content }, { onSuccess: () => form.reset() });
  }}>
    {canSetProgress && <ProgressInput value={progress} onChange={setProgress} max={99} label="本次进度（更新后）" />}
    <textarea name="content" rows={3} required placeholder="记录新进展、决策或待办结果" />
    <div><span>{mutation.error?.message}</span><button className="primary-button" disabled={mutation.isPending}>追加进展</button></div>
  </form>;
}

const issueEventLabels: Record<string, string> = {
  note: "说明", progress: "进度", start: "开始", defer: "暂缓", resume: "恢复",
  resolve: "解决", reopen: "重开", correction: "纠错", migration: "迁移",
};

function IssueStateActions({ issue, canManage, canStart, compact = false }: { issue: Issue; canManage: boolean; canStart: boolean; compact?: boolean }) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ action, content, reason }: { action: string; content?: string; reason?: string }) => api<Issue>(`/api/issues/${issue.id}/${action}`, {
      method: "POST", body: jsonBody({ expectedVersion: issue.version, content, reason }),
    }),
    onSuccess: (saved) => {
      client.setQueryData(["issue", issue.id], saved);
      void client.invalidateQueries({ queryKey: ["issues"] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  const runReason = (action: string, promptText: string) => {
    const reason = prompt(promptText);
    if (reason?.trim()) mutation.mutate({ action, reason: reason.trim() });
  };
  const runContent = (action: string, promptText: string) => {
    const content = prompt(promptText);
    if (content?.trim()) mutation.mutate({ action, content: content.trim() });
  };
  return <div className={`issue-state-actions${compact ? " is-compact" : ""}`}>
    <span className={`issue-status issue-status-${issue.status}`}>{issueStatusLabels[issue.status as keyof typeof issueStatusLabels] || issue.status}</span>
    {issue.status === "open" && canStart && <button type="button" disabled={mutation.isPending || !issue.ownerId} title={!issue.ownerId ? "请先分配负责人" : undefined} onClick={() => mutation.mutate({ action: "start" })}>开始</button>}
    {canManage && ["open", "in_progress"].includes(issue.status) && <button type="button" disabled={mutation.isPending} onClick={() => runReason("defer", "请填写暂缓原因")}>暂缓</button>}
    {canManage && issue.status === "in_progress" && <button type="button" disabled={mutation.isPending} onClick={() => runContent("resolve", "请填写闭环说明")}>解决</button>}
    {canManage && issue.status === "deferred" && <button type="button" disabled={mutation.isPending} onClick={() => runReason("resume", "请填写恢复原因")}>恢复</button>}
    {canManage && issue.status === "resolved" && <button type="button" disabled={mutation.isPending} onClick={() => runReason("reopen", "请填写重开原因")}>重开</button>}
    {mutation.error && <small className="form-error">{mutation.error.message}</small>}
  </div>;
}

function IssueProgressView({
  issueId,
  canEdit,
  canContribute,
  personId,
}: {
  issueId: string;
  canEdit: boolean;
  canContribute: boolean;
  personId: string | null;
}) {
  const { data: issue, isLoading } = useQuery({ queryKey: ["issue", issueId], queryFn: () => api<Issue>(`/api/issues/${issueId}`) });
  if (isLoading || !issue) return <div className="issue-detail-loading">正在加载问题进展…</div>;
  const canOwnIssue = canEdit || Boolean(personId && issue.ownerId === personId);
  const canSetProgress = canOwnIssue && issue.status === "in_progress";
  return <div className="issue-progress-view">
    <header className="issue-progress-view-header">
      <div>
        <div className="issue-detail-badges"><IssueStateActions issue={issue} canManage={canEdit} canStart={canOwnIssue} compact /><span className={`priority-badge priority-${issue.priority.toLowerCase()}`}>{priorityLabels[issue.priority as keyof typeof priorityLabels] || issue.priority}</span>{issue.overdue && <span className="issue-overdue-badge">已逾期</span>}</div>
        <h3>{issue.title}</h3>
        <p>{issueScope(issue)} · {issue.updates?.length || 0} 条进展</p>
      </div>
      <div className="issue-detail-progress"><i><b style={{ width: `${issue.progress}%` }} /></i><strong>{issue.progress}%</strong></div>
    </header>
    <section className="issue-progress-section">
      <div className="issue-timeline">
        {issue.updates?.map((update) => <article key={update.id}><span className="issue-timeline-dot" /><div><time><b className={`history-event history-event-${update.eventType}`}>{issueEventLabels[update.eventType] || update.eventType}</b>{new Date(update.createdAt).toLocaleString("zh-CN")}{update.createdByName ? ` · ${update.createdByName}` : ""}</time><p>{update.content}</p></div>{update.progress !== null && <strong className="issue-update-progress">{update.progress}%</strong>}</article>)}
        {!issue.updates?.length && <EmptyState title="还没有进展" detail="追加第一条进展后，会在这里按时间展示。" />}
      </div>
      {canContribute && issue.status !== "resolved" && <IssueUpdateForm issue={issue} canSetProgress={canSetProgress} />}
    </section>
  </div>;
}

function IssueUpdateSettingRow({ update }: { update: IssueUpdate }) {
  return <article className="issue-update-setting-row">
    <header><time>{new Date(update.createdAt).toLocaleString("zh-CN")}</time><span><b className={`history-event history-event-${update.eventType}`}>{issueEventLabels[update.eventType] || update.eventType}</b>{update.createdByName || "系统记录"}</span></header>
    <p>{update.content}</p>
    <div className="issue-update-setting-footer">
      <span>{update.progress === null ? "仅说明" : `记录进度 ${update.progress}%`}</span>
    </div>
  </article>;
}

function IssueSettings({
  issueId,
  projectId,
  people,
  requirements,
  defaultReporter,
  onClose,
}: {
  issueId: string;
  projectId: string;
  people: Person[];
  requirements: Requirement[];
  defaultReporter?: string | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"basic" | "updates">("basic");
  const { data: issue, isLoading } = useQuery({ queryKey: ["issue", issueId], queryFn: () => api<Issue>(`/api/issues/${issueId}`) });
  if (isLoading || !issue) return <div className="issue-detail-loading">正在加载问题设置…</div>;
  return <div className="issue-settings-shell">
    <header className="issue-settings-summary">
      <div>
        <div className="issue-detail-badges"><IssueStateActions issue={issue} canManage canStart compact /><span className={`priority-badge priority-${issue.priority.toLowerCase()}`}>{priorityLabels[issue.priority as keyof typeof priorityLabels] || issue.priority}</span>{issue.overdue && <span className="issue-overdue-badge">已逾期</span>}</div>
        <h3>{issue.title}</h3>
        <p>{issueScope(issue)} · {issue.ownerName || "未分配负责人"}</p>
      </div>
      <div className="issue-settings-current-progress"><span>当前进度</span><div><i><b style={{ width: `${issue.progress}%` }} /></i><strong>{issue.progress}%</strong></div><small>由状态命令与追加进展共同维护</small></div>
    </header>
    <nav className="issue-settings-tabs" role="tablist" aria-label="问题设置内容">
      <button type="button" role="tab" aria-selected={tab === "basic"} className={tab === "basic" ? "active" : ""} onClick={() => setTab("basic")}>基本设置</button>
      <button type="button" role="tab" aria-selected={tab === "updates"} className={tab === "updates" ? "active" : ""} onClick={() => setTab("updates")}>进展记录 <span>{issue.updates?.length || 0}</span></button>
    </nav>
    {tab === "basic" ? <section className="issue-settings-panel issue-settings-basic" role="tabpanel">
      {issue.status === "resolved"
        ? <div className="terminal-lock-note"><CheckCircle2 size={18} /><div><strong>问题已解决，当前数据已锁定</strong><p>如需继续处理，请先使用上方“重开”；日期或描述纠错会以新事件保留原因。</p></div></div>
        : <IssueForm issue={issue} projectId={projectId} people={people} requirements={requirements} canManage defaultReporter={defaultReporter} onClose={onClose} />}
    </section> : <section className="issue-settings-panel issue-settings-updates" role="tabpanel">
      <div className="issue-settings-progress-entry">
        <header><div><h3>追加进展</h3><p>普通进展最高99%；100%仅由“解决问题”操作产生</p></div></header>
        {issue.status === "resolved" ? <p className="issue-settings-resolved-note"><CheckCircle2 size={17} />问题已闭环并锁定。如需继续处理，请先执行“重开”。</p> : <IssueUpdateForm issue={issue} canSetProgress={issue.status === "in_progress"} />}
      </div>
      <div className="issue-update-settings">
        <header><div><h3>历史进展</h3><p>{issue.updates?.length || 0} 条只读记录；纠错会新增记录，不覆盖历史</p></div></header>
        <div className="issue-update-settings-list">{issue.updates?.map((update) => <IssueUpdateSettingRow update={update} key={update.id} />)}</div>
        {!issue.updates?.length && <EmptyState title="暂无进展记录" detail="在上方填写进度与说明，创建第一条记录。" />}
      </div>
    </section>}
  </div>;
}

export function IssuesPage() {
  const { selectedProjectId, session } = useApp();
  const client = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedQuery = searchParams.toString();
  const initialLinkedParams = new URLSearchParams(linkedQuery);
  const [keyword, setKeyword] = useState(initialLinkedParams.get("q") || "");
  const deferredKeyword = useDeferredValue(keyword);
  const [status, setStatus] = useState(defaultIssueStatus(initialLinkedParams));
  const [priority, setPriority] = useState(initialLinkedParams.get("priority") || "");
  const [ownerId, setOwnerId] = useState(initialLinkedParams.get("ownerId") || "");
  const [scope, setScope] = useState(initialLinkedParams.get("scope") === "public" ? "public" : initialLinkedParams.get("requirementId") || "");
  const [active, setActive] = useState(initialLinkedParams.get("active") === "true");
  const [overdue, setOverdue] = useState(initialLinkedParams.get("overdue") === "true");
  const [unassigned, setUnassigned] = useState(initialLinkedParams.get("unassigned") === "true");
  const [page, setPage] = useState(1);
  const [selectedIssueId, setSelectedIssueId] = useState<string | undefined>(initialLinkedParams.get("issueId") || undefined);
  const [settingsIssueId, setSettingsIssueId] = useState<string | undefined>();
  const [formIssue, setFormIssue] = useState<Issue | null | undefined>(undefined);
  useEffect(() => {
    const linked = new URLSearchParams(linkedQuery);
    setKeyword(linked.get("q") || "");
    setStatus(defaultIssueStatus(linked));
    setPriority(linked.get("priority") || "");
    setOwnerId(linked.get("ownerId") || "");
    setScope(linked.get("scope") === "public" ? "public" : linked.get("requirementId") || "");
    setActive(linked.get("active") === "true");
    setOverdue(linked.get("overdue") === "true");
    setUnassigned(linked.get("unassigned") === "true");
    setSelectedIssueId(linked.get("issueId") || undefined);
    setPage(1);
  }, [linkedQuery]);
  const { data: people = [] } = useQuery({ queryKey: ["people", selectedProjectId], queryFn: () => api<Person[]>(`/api/people?projectId=${encodeURIComponent(selectedProjectId)}`), enabled: Boolean(selectedProjectId) });
  const { data: requirements = [] } = useQuery({ queryKey: ["requirements", selectedProjectId], queryFn: () => api<Requirement[]>(`/api/requirements?projectId=${encodeURIComponent(selectedProjectId)}`), enabled: Boolean(selectedProjectId) });
  const canEdit = canManageProject(session, selectedProjectId);
  const canContribute = session.authenticated && !session.mustChangePassword
    && (canEdit || Boolean(session.personId && people.some((person) => person.id === session.personId && person.projectRole !== "viewer")));
  const defaultReporter = people.find((person) => person.id === session.personId)?.name || session.username;
  const params = new URLSearchParams({ projectId: selectedProjectId, page: String(page), pageSize: "50" });
  if (deferredKeyword.trim()) params.set("q", deferredKeyword.trim());
  if (status) params.set("status", status);
  if (priority) params.set("priority", priority);
  if (ownerId) params.set("ownerId", ownerId);
  if (scope === "public") params.set("scope", "public");
  else if (scope) params.set("requirementId", scope);
  if (active) params.set("active", "true");
  if (overdue) params.set("overdue", "true");
  if (unassigned) params.set("unassigned", "true");
  const { data, isLoading } = useQuery({
    queryKey: ["issues", selectedProjectId, deferredKeyword, status, priority, ownerId, scope, active, overdue, unassigned, page],
    queryFn: () => api<IssuePage>(`/api/issues?${params}`),
    enabled: Boolean(selectedProjectId),
  });
  const saveIssue = async (issue: Issue, input: Record<string, unknown>) => {
    const previousLists = client.getQueriesData<IssuePage>({ queryKey: ["issues", selectedProjectId] });
    const previousDetail = client.getQueryData<Issue>(["issue", issue.id]);
    const optimistic = { ...issue, ...input } as Issue;
    if (Object.prototype.hasOwnProperty.call(input, "ownerId")) {
      optimistic.ownerId = typeof input.ownerId === "string" && input.ownerId ? input.ownerId : null;
      optimistic.ownerName = people.find((person) => person.id === optimistic.ownerId)?.name || null;
    }
    if (Object.prototype.hasOwnProperty.call(input, "requirementId")) {
      optimistic.requirementId = typeof input.requirementId === "string" && input.requirementId ? input.requirementId : null;
      optimistic.requirementTitle = requirements.find((requirement) => requirement.id === optimistic.requirementId)?.title || null;
    }
    const apply = (current: IssuePage | undefined) => current ? {
      ...current,
      items: current.items.map((entry) => entry.id === issue.id ? optimistic : entry),
    } : current;
    client.setQueriesData<IssuePage>({ queryKey: ["issues", selectedProjectId] }, apply);
    client.setQueryData<Issue>(["issue", issue.id], optimistic);
    try {
      const saved = await api<Issue>(`/api/issues/${issue.id}`, { method: "PATCH", body: jsonBody({ ...input, expectedVersion: issue.version }) });
      client.setQueriesData<IssuePage>({ queryKey: ["issues", selectedProjectId] }, (current) => current ? {
        ...current,
        items: current.items.map((entry) => entry.id === saved.id ? saved : entry),
      } : current);
      client.setQueryData<Issue>(["issue", issue.id], saved);
      void client.invalidateQueries({ queryKey: ["issues"] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (error) {
      for (const [key, value] of previousLists) client.setQueryData(key, value);
      client.setQueryData(["issue", issue.id], previousDetail);
      throw error;
    }
  };
  const resetPage = (update: () => void) => { update(); setPage(1); };
  const changeStatus = (value: string) => {
    setStatus(value);
    setPage(1);
    const next = new URLSearchParams(linkedQuery);
    next.set("status", value);
    setSearchParams(next, { replace: true });
  };
  const clearFilters = () => { setKeyword(""); setStatus("in_progress"); setPriority(""); setOwnerId(""); setScope(""); setActive(false); setOverdue(false); setUnassigned(false); setPage(1); setSearchParams({}, { replace: true }); };
  const hasFilters = Boolean(keyword || status !== "in_progress" || priority || ownerId || scope || active || overdue || unassigned);
  const summary = data?.summary || { total: 0, open: 0, inProgress: 0, deferred: 0, resolved: 0, active: 0, highPriority: 0, overdue: 0, unassigned: 0, closureRate: 0 };
  const openIssue = (id: string) => {
    setSelectedIssueId(id);
    const next = new URLSearchParams(linkedQuery); next.set("issueId", id); setSearchParams(next, { replace: true });
  };
  const closeIssue = () => {
    setSelectedIssueId(undefined);
    const next = new URLSearchParams(linkedQuery); next.delete("issueId"); setSearchParams(next, { replace: true });
  };
  return <>
    <PageHeader title="问题跟踪" actions={canContribute ? <button className="primary-button" disabled={!selectedProjectId} onClick={() => setFormIssue(null)}><Plus size={16} />新建问题</button> : null} />
    <div className="page-content issues-page">
      <section className="issue-board" aria-label="问题看板">
        <article className="issue-metric metric-open"><CircleDot size={20} /><div><span>待处理</span><strong>{summary.open}</strong></div></article>
        <article className="issue-metric metric-progress"><Clock3 size={20} /><div><span>处理中</span><strong>{summary.inProgress}</strong></div></article>
        <article className="issue-metric metric-deferred"><PauseCircle size={20} /><div><span>暂缓</span><strong>{summary.deferred}</strong></div></article>
        <article className="issue-metric metric-resolved"><CheckCircle2 size={20} /><div><span>已解决</span><strong>{summary.resolved}</strong></div></article>
        <article className="issue-metric metric-overdue"><AlertTriangle size={20} /><div><span>已逾期</span><strong>{summary.overdue}</strong></div></article>
      </section>
      <div className="issue-filters">
        <label className="search-box"><Search size={16} /><input value={keyword} onChange={(event) => resetPage(() => setKeyword(event.target.value))} placeholder="搜索问题、影响或进展" /></label>
        <select value={status} onChange={(event) => changeStatus(event.target.value)}><option value="">全部状态</option>{statusEntries.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <select value={priority} onChange={(event) => resetPage(() => setPriority(event.target.value))}><option value="">全部优先级</option>{priorityEntries.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <select value={ownerId} onChange={(event) => resetPage(() => setOwnerId(event.target.value))}><option value="">全部负责人</option>{people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select>
        <select value={scope} onChange={(event) => resetPage(() => setScope(event.target.value))}><option value="">全部范围</option><option value="public">公共问题</option>{requirements.map((requirement) => <option value={requirement.id} key={requirement.id}>{requirement.title}</option>)}</select>
        <button className={`issue-filter-toggle${active ? " active" : ""}`} onClick={() => resetPage(() => setActive((value) => !value))}><CircleDot size={14} />未闭环</button>
        <button className={`issue-filter-toggle${overdue ? " active" : ""}`} onClick={() => resetPage(() => setOverdue((value) => !value))}><AlertTriangle size={14} />仅逾期</button>
        <button className={`issue-filter-toggle${unassigned ? " active" : ""}`} onClick={() => resetPage(() => setUnassigned((value) => !value))}><UserRound size={14} />未分配</button>
        <span className="issue-filter-result">{data?.total || 0} / {summary.total} 条</span>
        <button className="gantt-reset-button" disabled={!hasFilters} onClick={clearFilters}>清除筛选</button>
      </div>
      <section className="table-panel issue-table-panel">
        <table className="issue-table"><thead><tr><th>问题</th><th>范围</th><th>状态</th><th>进度</th><th>优先级</th><th>负责人</th><th>目标日期</th><th>最近进展</th><th>操作</th></tr></thead>
          <tbody>{data?.items.map((issue) => <tr className={issue.overdue ? "is-overdue" : undefined} key={issue.id}>
            <td>{canEdit && issue.status !== "resolved" ? <InlineTextCell value={issue.title} label="问题标题" required displayMode="stacked" onSave={(title) => saveIssue(issue, { title })} renderValue={(title) => <><strong>{title}</strong><small>{issue.impact || "暂无影响说明"}</small></>} /> : <><strong>{issue.title}</strong><small>{issue.impact || "暂无影响说明"}</small></>}</td>
            <td>{canEdit && issue.status !== "resolved" ? <InlineSelectCell value={issue.requirementId} label="关联需求" options={[{ value: "", label: issue.sourceRef ? `公共问题 · ${issue.sourceRef}` : "公共问题" }, ...requirements.map((requirement) => ({ value: requirement.id, label: requirement.title }))]} onSave={(requirementId) => saveIssue(issue, { requirementId: requirementId || null })} placeholder="公共问题" renderValue={() => <span className="issue-scope" title={issueScope(issue)}>{issueScope(issue)}</span>} /> : <span className="issue-scope" title={issueScope(issue)}>{issueScope(issue)}</span>}</td>
            <td><IssueStateActions issue={issue} canManage={canEdit} canStart={canEdit} compact /></td>
            <td><span className="issue-table-progress"><i><b style={{ width: `${issue.progress}%` }} /></i>{issue.progress}%</span></td>
            <td>{canEdit && issue.status !== "resolved" ? <InlineSelectCell value={issue.priority} label="问题优先级" options={priorityOptions} displayMode="badge" onSave={(priority) => saveIssue(issue, { priority })} renderValue={(value) => <span className={`priority-badge priority-${value.toLowerCase()}`}>{priorityLabels[value as keyof typeof priorityLabels] || value}</span>} /> : <span className={`priority-badge priority-${issue.priority.toLowerCase()}`}>{priorityLabels[issue.priority as keyof typeof priorityLabels] || issue.priority}</span>}</td>
            <td>{canEdit && issue.status !== "resolved" ? <InlineSelectCell value={issue.ownerId} label="问题负责人" options={[{ value: "", label: "未分配" }, ...people.map((person) => ({ value: person.id, label: person.name }))]} onSave={(ownerId) => saveIssue(issue, { ownerId: ownerId || null })} placeholder="未分配" renderValue={(_value, selected) => selected?.value ? selected.label : <span className="muted-text">未分配</span>} /> : issue.ownerName || <span className="muted-text">未分配</span>}</td>
            <td className={issue.overdue ? "danger-text" : ""}>{canEdit && !["deferred", "resolved"].includes(issue.status) ? <InlineDateCell value={issue.dueDate} label="目标日期" onSave={(dueDate) => saveIssue(issue, { dueDate })} /> : <>{issue.status === "deferred" ? "暂缓 · 无日期" : issue.dueDate || "未设置"}</>}{issue.overdue && <small>已逾期</small>}</td>
            <td><button type="button" className="issue-latest-update-button" onClick={() => openIssue(issue.id)}><span className="issue-latest-update" title={issue.latestUpdate || undefined}>{issue.latestUpdate || "暂无进展"}</span><small>{issue.latestUpdateAt ? shortDateTime(issue.latestUpdateAt) : "查看进展"}</small></button></td>
            <td>{canEdit ? <button type="button" className="issue-settings-button" onClick={() => setSettingsIssueId(issue.id)}><Settings size={14} />设置</button> : <span className="muted-text">—</span>}</td>
          </tr>)}</tbody>
        </table>
        {!data?.items.length && !isLoading && <EmptyState title="没有符合条件的问题" detail="调整筛选条件，或新建一条公共问题。" />}
        <footer className="table-pagination"><span>第 {data?.page || 1} / {data?.pages || 1} 页</span><div><button className="ghost-button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><button className="ghost-button" disabled={page >= (data?.pages || 1)} onClick={() => setPage((value) => value + 1)}>下一页</button></div></footer>
      </section>
    </div>
    {selectedIssueId && <Modal title="问题进展" width={760} onClose={closeIssue}><IssueProgressView issueId={selectedIssueId} canEdit={canEdit} canContribute={canContribute} personId={session.personId} /></Modal>}
    {settingsIssueId && canEdit && <Modal title="问题设置" width={960} onClose={() => setSettingsIssueId(undefined)}><IssueSettings issueId={settingsIssueId} projectId={selectedProjectId} people={people} requirements={requirements} defaultReporter={defaultReporter} onClose={() => setSettingsIssueId(undefined)} /></Modal>}
    {formIssue !== undefined && <Modal title={formIssue ? "编辑问题" : "新建问题"} width={760} onClose={() => setFormIssue(undefined)}><IssueForm issue={formIssue || undefined} projectId={selectedProjectId} people={people} requirements={requirements} canManage={canEdit} defaultReporter={defaultReporter} onClose={() => setFormIssue(undefined)} /></Modal>}
  </>;
}
