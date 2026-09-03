import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  PauseCircle,
  Plus,
  Search,
  UserRound,
} from "lucide-react";
import { api, jsonBody } from "../api";
import { useApp } from "../app-context";
import type { Issue, IssuePage, IssueUpdate, Person, Requirement } from "../types";
import { issueStatusLabels, priorityLabels, todayIso } from "../../shared/domain";
import { AdaptiveDataCell, AdaptiveDataList, AdaptiveDataRow, type AdaptiveDataColumn } from "../components/AdaptiveDataList";
import { EmptyState, Modal } from "../components/Modal";
import { DataCell, FieldShell } from "../components/LayoutPrimitives";
import { PageHeader } from "../components/PageHeader";
import { ProgressInput } from "../components/ProgressInput";
import { AnchoredPopover, InlineDateCell, InlineSelectCell } from "../components/InlineEdit";
import { canManageProject } from "../permissions";
import { issueStatusOptions, priorityOptions } from "../ui-options";

const statusEntries = issueStatusOptions.map(({ value, label }) => [value, label] as const);
const priorityEntries = priorityOptions.map(({ value, label }) => [value, label] as const);
const issueColumns: AdaptiveDataColumn[] = [
  { key: "issue", label: "问题", track: "minmax(280px,2fr)", importance: "primary", compact: "primary" },
  { key: "scope", label: "范围", track: "minmax(140px,.9fr)", importance: "secondary", compact: "full" },
  { key: "status", label: "状态", track: "minmax(128px,.65fr)", compact: "detail" },
  { key: "progress", label: "进度", track: "minmax(126px,.65fr)", compact: "detail" },
  { key: "priority", label: "优先级", track: "minmax(132px,.65fr)", compact: "detail" },
  { key: "owner", label: "负责人", track: "minmax(140px,.75fr)", compact: "detail" },
  { key: "dueDate", label: "目标日期", track: "minmax(150px,.8fr)", compact: "detail" },
  { key: "latest", label: "最近进展", track: "minmax(240px,1.4fr)", importance: "secondary", compact: "full" },
];

function defaultIssueStatus(params: URLSearchParams) {
  if (params.get("active") === "true") return "active";
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

  return <FieldShell label={label} help={helper} className="issue-search-select-field" asLabel={false}>
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
  </FieldShell>;
}

function IssueForm({
  issue,
  projectId,
  people,
  requirements,
  canManage,
  defaultReporter,
  autoFocusTitle = true,
  onClose,
}: {
  issue?: Issue;
  projectId: string;
  people: Person[];
  requirements: Requirement[];
  canManage: boolean;
  defaultReporter?: string | null;
  autoFocusTitle?: boolean;
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
    <FieldShell label="问题标题" full><input name="title" required autoFocus={autoFocusTitle} defaultValue={issue?.title || ""} placeholder="用一句话说明要跟踪的问题" /></FieldShell>
    <FieldShell label="问题影响" full><textarea name="impact" rows={3} defaultValue={issue?.impact || ""} placeholder="可选：说明影响范围、风险或被阻塞的工作" /></FieldShell>
    {!canManage && <p className="issue-contributor-note field-full">提交后问题直接进入“处理中”，由项目经理分配负责人并确认关闭。</p>}
    <SearchSelectField label="关联需求" name="requirementId" value={requirementId} options={requirementOptions} onChange={setRequirementId} pinnedValues={[""]} searchPlaceholder="搜索需求编号或名称" helper="默认展示最多20项，输入关键字可快速筛选" />
    <FieldShell label="范围标识"><input name="sourceRef" defaultValue={issue?.sourceRef || ""} placeholder="可选，如 DCIM-36" /></FieldShell>
    {issue && <FieldShell label="当前状态" help="在详情顶部点击状态可挂起、解决或重开" className="issue-readonly-field" asLabel={false}><span className={`issue-status issue-status-${issue.status}`}>{issueStatusLabels[issue.status as keyof typeof issueStatusLabels]}</span></FieldShell>}
    <FieldShell label="优先级"><select name="priority" defaultValue={issue?.priority || "P2"}>{priorityEntries.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></FieldShell>
    {canManage && issue && issue.status !== "resolved" && <SearchSelectField label="负责人" name="ownerId" value={ownerId} options={ownerOptions} onChange={setOwnerId} pinnedValues={[""]} searchPlaceholder="搜索负责人姓名" />}
    <SearchSelectField label="提出人" name="reporter" value={reporter} options={reporterOptions} onChange={setReporter} pinnedValues={[""]} searchPlaceholder="搜索项目成员" helper={issue?.reporter && !people.some((person) => person.name === issue.reporter) ? "当前值为历史自由文本，重新选择后将使用项目成员姓名" : undefined} />
    <FieldShell label="发现日期"><input name="discoveredAt" type="date" required defaultValue={issue?.discoveredAt || todayIso()} /></FieldShell>
    <FieldShell label="目标日期" help={issue?.status === "deferred" ? "挂起问题不设置目标日期" : undefined}><input name="dueDate" type="date" value={dueDate} disabled={issue?.status === "deferred"} onChange={(event) => setDueDate(event.target.value)} /></FieldShell>
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
  note: "说明", progress: "进度", start: "开始", defer: "挂起", resume: "恢复",
  resolve: "解决", reopen: "重开", correction: "纠错", migration: "迁移",
};

const issueStateChoices: Record<string, Array<{ action: string; label: string; target: string; prompt: string }>> = {
  in_progress: [
    { action: "defer", label: "挂起", target: "deferred", prompt: "说明挂起原因" },
    { action: "resolve", label: "确认解决", target: "resolved", prompt: "填写闭环说明" },
  ],
  deferred: [{ action: "resume", label: "恢复处理", target: "in_progress", prompt: "说明恢复原因" }],
  resolved: [{ action: "reopen", label: "重新打开", target: "in_progress", prompt: "说明重开原因" }],
};

function IssueStatusControl({ issue, canManage, compact = false }: { issue: Issue; canManage: boolean; compact?: boolean }) {
  const client = useQueryClient();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<(typeof issueStateChoices)[string][number] | null>(null);
  const [note, setNote] = useState("");
  const mutation = useMutation({
    mutationFn: ({ action, content, reason }: { action: string; content?: string; reason?: string }) => api<Issue>(`/api/issues/${issue.id}/${action}`, {
      method: "POST", body: jsonBody({ expectedVersion: issue.version, content, reason }),
    }),
    onSuccess: (saved) => {
      client.setQueryData(["issue", issue.id], saved);
      void client.invalidateQueries({ queryKey: ["issues"] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      setOpen(false); setSelected(null); setNote("");
    },
  });
  const close = () => { setOpen(false); setSelected(null); setNote(""); };
  const submit = () => {
    if (!selected || !note.trim()) return;
    mutation.mutate(selected.action === "resolve"
      ? { action: selected.action, content: note.trim() }
      : { action: selected.action, reason: note.trim() });
  };
  const badge = <span className={`issue-status issue-status-${issue.status}`}>{issueStatusLabels[issue.status as keyof typeof issueStatusLabels] || issue.status}</span>;
  if (!canManage) return badge;
  return <div className={`issue-status-control${compact ? " is-compact" : ""}`} onClick={(event) => event.stopPropagation()}>
    <button ref={anchorRef} type="button" className="issue-status-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen((value) => !value); setSelected(null); setNote(""); }}>{badge}<ChevronDown size={13} /></button>
    <AnchoredPopover anchorRef={anchorRef} open={open} onOutside={close} width={300} className="issue-status-popover">
      <header><strong>变更问题状态</strong><small>当前：{issueStatusLabels[issue.status as keyof typeof issueStatusLabels]}</small></header>
      <div className="issue-status-choice-list">
        {(issueStateChoices[issue.status] || []).map((choice) => <button type="button" key={choice.action} className={selected?.action === choice.action ? "is-selected" : ""} onClick={() => { setSelected(choice); setNote(""); }}><span className={`issue-status issue-status-${choice.target}`}>{issueStatusLabels[choice.target as keyof typeof issueStatusLabels]}</span><span>{choice.label}</span></button>)}
      </div>
      {selected && <div className="issue-status-note"><label><span>{selected.prompt}</span><textarea autoFocus rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label><div><button type="button" className="ghost-button" onClick={() => setSelected(null)}>返回</button><button type="button" className="primary-button" disabled={!note.trim() || mutation.isPending} onClick={submit}>确认变更</button></div></div>}
      {mutation.error && <p className="form-error">{mutation.error.message}</p>}
    </AnchoredPopover>
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

function IssueDetail({
  issueId,
  projectId,
  people,
  requirements,
  defaultReporter,
  initialTab,
  canEdit,
  canContribute,
  personId,
  onClose,
}: {
  issueId: string;
  projectId: string;
  people: Person[];
  requirements: Requirement[];
  defaultReporter?: string | null;
  initialTab: "basic" | "updates";
  canEdit: boolean;
  canContribute: boolean;
  personId: string | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"basic" | "updates">(initialTab);
  const { data: issue, isLoading } = useQuery({ queryKey: ["issue", issueId], queryFn: () => api<Issue>(`/api/issues/${issueId}`) });
  if (isLoading || !issue) return <div className="issue-detail-loading">正在加载问题详情…</div>;
  const canOwnIssue = canEdit || Boolean(personId && issue.ownerId === personId);
  const canSetProgress = canOwnIssue && issue.status === "in_progress";
  return <div className="issue-settings-shell">
    <header className="issue-settings-summary">
      <div>
        <div className="issue-detail-badges"><IssueStatusControl issue={issue} canManage={canEdit} compact /><span className={`priority-badge priority-${issue.priority.toLowerCase()}`}>{priorityLabels[issue.priority as keyof typeof priorityLabels] || issue.priority}</span>{issue.overdue && <span className="issue-overdue-badge">已逾期</span>}</div>
        <h3>{issue.title}</h3>
        <p>{issueScope(issue)} · {issue.ownerName || "未分配负责人"}</p>
      </div>
      <div className="issue-settings-current-progress"><span>当前进度</span><div><i><b style={{ width: `${issue.progress}%` }} /></i><strong>{issue.progress}%</strong></div><small>由状态命令与追加进展共同维护</small></div>
    </header>
    <nav className="issue-settings-tabs" role="tablist" aria-label="问题设置内容">
      <button id="issue-tab-basic" type="button" role="tab" aria-controls="issue-panel-basic" aria-selected={tab === "basic"} className={tab === "basic" ? "active" : ""} onClick={() => setTab("basic")}>基本信息</button>
      <button id="issue-tab-updates" type="button" role="tab" aria-controls="issue-panel-updates" aria-selected={tab === "updates"} className={tab === "updates" ? "active" : ""} onClick={() => setTab("updates")}>进展记录 <span>{issue.updates?.length || 0}</span></button>
    </nav>
    <section id="issue-panel-basic" className="issue-settings-panel issue-settings-basic" role="tabpanel" aria-labelledby="issue-tab-basic" hidden={tab !== "basic"}>
      {!canEdit ? <div className="issue-readonly-detail">
        <dl><div><dt>问题影响</dt><dd>{issue.impact || "暂无影响说明"}</dd></div><div><dt>关联范围</dt><dd>{issueScope(issue)}</dd></div><div><dt>负责人</dt><dd>{issue.ownerName || "未分配"}</dd></div><div><dt>提出人</dt><dd>{issue.reporter || "未指定"}</dd></div><div><dt>发现日期</dt><dd>{issue.discoveredAt}</dd></div><div><dt>目标日期</dt><dd>{issue.status === "deferred" ? "挂起 · 无日期" : issue.dueDate || "未设置"}</dd></div></dl>
      </div> : issue.status === "resolved"
        ? <div className="terminal-lock-note"><CheckCircle2 size={18} /><div><strong>问题已解决，当前数据已锁定</strong><p>如需继续处理，请先使用上方“重开”；日期或描述纠错会以新事件保留原因。</p></div></div>
        : <IssueForm issue={issue} projectId={projectId} people={people} requirements={requirements} canManage defaultReporter={defaultReporter} autoFocusTitle={tab === "basic"} onClose={onClose} />}
    </section>
    <section id="issue-panel-updates" className="issue-settings-panel issue-settings-updates" role="tabpanel" aria-labelledby="issue-tab-updates" hidden={tab !== "updates"}>
      <div className="issue-settings-progress-entry">
        <header><div><h3>追加进展</h3><p>普通进展最高99%；100%仅由“解决问题”操作产生</p></div></header>
        {issue.status === "resolved" ? <p className="issue-settings-resolved-note"><CheckCircle2 size={17} />问题已闭环并锁定。如需继续处理，请先执行“重开”。</p> : canContribute ? <IssueUpdateForm issue={issue} canSetProgress={canSetProgress} /> : <p className="issue-settings-resolved-note">当前角色可查看进展，但不能追加记录。</p>}
      </div>
      <div className="issue-update-settings">
        <header><div><h3>历史进展</h3><p>{issue.updates?.length || 0} 条只读记录；纠错会新增记录，不覆盖历史</p></div></header>
        <div className="issue-update-settings-list">{issue.updates?.map((update) => <IssueUpdateSettingRow update={update} key={update.id} />)}</div>
        {!issue.updates?.length && <EmptyState title="暂无进展记录" detail="在上方填写进度与说明，创建第一条记录。" />}
      </div>
    </section>
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
  const [overdue, setOverdue] = useState(initialLinkedParams.get("overdue") === "true");
  const [unassigned, setUnassigned] = useState(initialLinkedParams.get("unassigned") === "true");
  const [page, setPage] = useState(1);
  const [selectedIssueId, setSelectedIssueId] = useState<string | undefined>(initialLinkedParams.get("issueId") || undefined);
  const [detailTab, setDetailTab] = useState<"basic" | "updates">("updates");
  const [formIssue, setFormIssue] = useState<Issue | null | undefined>(undefined);
  useEffect(() => {
    const linked = new URLSearchParams(linkedQuery);
    setKeyword(linked.get("q") || "");
    setStatus(defaultIssueStatus(linked));
    setPriority(linked.get("priority") || "");
    setOwnerId(linked.get("ownerId") || "");
    setScope(linked.get("scope") === "public" ? "public" : linked.get("requirementId") || "");
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
  if (status === "active") params.set("active", "true");
  else if (status) params.set("status", status);
  if (priority) params.set("priority", priority);
  if (ownerId) params.set("ownerId", ownerId);
  if (scope === "public") params.set("scope", "public");
  else if (scope) params.set("requirementId", scope);
  if (overdue) params.set("overdue", "true");
  if (unassigned) params.set("unassigned", "true");
  const { data, isLoading } = useQuery({
    queryKey: ["issues", selectedProjectId, deferredKeyword, status, priority, ownerId, scope, overdue, unassigned, page],
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
  const clearFilters = () => { setKeyword(""); setStatus("in_progress"); setPriority(""); setOwnerId(""); setScope(""); setOverdue(false); setUnassigned(false); setPage(1); setSearchParams({}, { replace: true }); };
  const hasFilters = Boolean(keyword || status !== "in_progress" || priority || ownerId || scope || overdue || unassigned);
  const summary = data?.summary || { total: 0, inProgress: 0, deferred: 0, resolved: 0, active: 0, highPriority: 0, overdue: 0, unassigned: 0, closureRate: 0 };
  const openIssue = (id: string, tab: "basic" | "updates") => {
    setSelectedIssueId(id);
    setDetailTab(tab);
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
        <article className="issue-metric metric-progress"><Clock3 size={20} /><div><span>处理中</span><strong>{summary.inProgress}</strong></div></article>
        <article className="issue-metric metric-deferred"><PauseCircle size={20} /><div><span>挂起</span><strong>{summary.deferred}</strong></div></article>
        <article className="issue-metric metric-resolved"><CheckCircle2 size={20} /><div><span>已解决</span><strong>{summary.resolved}</strong></div></article>
        <article className="issue-metric metric-overdue"><AlertTriangle size={20} /><div><span>已逾期</span><strong>{summary.overdue}</strong></div></article>
      </section>
      <div className="issue-filters">
        <label className="search-box"><Search size={16} /><input value={keyword} onChange={(event) => resetPage(() => setKeyword(event.target.value))} placeholder="搜索问题、影响或进展" /></label>
        <select value={status} onChange={(event) => changeStatus(event.target.value)}><option value="in_progress">处理中</option><option value="active">全部未闭环</option><option value="">全部状态</option>{statusEntries.filter(([value]) => value !== "in_progress").map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <select value={priority} onChange={(event) => resetPage(() => setPriority(event.target.value))}><option value="">全部优先级</option>{priorityEntries.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <select value={ownerId} onChange={(event) => resetPage(() => setOwnerId(event.target.value))}><option value="">全部负责人</option>{people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select>
        <select value={scope} onChange={(event) => resetPage(() => setScope(event.target.value))}><option value="">全部范围</option><option value="public">公共问题</option>{requirements.map((requirement) => <option value={requirement.id} key={requirement.id}>{requirement.title}</option>)}</select>
        <button className={`issue-filter-toggle${overdue ? " active" : ""}`} onClick={() => resetPage(() => setOverdue((value) => !value))}><AlertTriangle size={14} />仅逾期</button>
        <button className={`issue-filter-toggle${unassigned ? " active" : ""}`} onClick={() => resetPage(() => setUnassigned((value) => !value))}><UserRound size={14} />未分配</button>
        <span className="issue-filter-result">{data?.total || 0} / {summary.total} 条</span>
        <button className="gantt-reset-button" disabled={!hasFilters} onClick={clearFilters}>清除筛选</button>
      </div>
      <AdaptiveDataList
        label="问题跟踪列表"
        className="issue-data-list"
        columns={issueColumns}
        empty={!data?.items.length && !isLoading ? <EmptyState title="没有符合条件的问题" detail="调整筛选条件，或新建一条公共问题。" /> : null}
        footer={<footer className="table-pagination"><span>第 {data?.page || 1} / {data?.pages || 1} 页</span><div><button className="ghost-button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><button className="ghost-button" disabled={page >= (data?.pages || 1)} onClick={() => setPage((value) => value + 1)}>下一页</button></div></footer>}
      >
        {data?.items.map((issue) => <AdaptiveDataRow className={`issue-data-row${issue.overdue ? " is-overdue" : ""}`} key={issue.id}>
          <AdaptiveDataCell column="issue" className="issue-data-primary"><button type="button" className="issue-title-button" onClick={() => openIssue(issue.id, "basic")}><DataCell primary={<strong>{issue.title}</strong>} secondary={issue.impact || "暂无影响说明"} /></button></AdaptiveDataCell>
          <AdaptiveDataCell column="scope" className="issue-data-scope"><DataCell primary={canEdit && issue.status !== "resolved" ? <InlineSelectCell value={issue.requirementId} label="关联需求" options={[{ value: "", label: issue.sourceRef ? `公共问题 · ${issue.sourceRef}` : "公共问题" }, ...requirements.map((requirement) => ({ value: requirement.id, label: requirement.title }))]} onSave={(requirementId) => saveIssue(issue, { requirementId: requirementId || null })} placeholder="公共问题" renderValue={() => <span className="issue-scope" title={issueScope(issue)}>{issueScope(issue)}</span>} /> : <span className="issue-scope" title={issueScope(issue)}>{issueScope(issue)}</span>} /></AdaptiveDataCell>
          <AdaptiveDataCell column="status" className="issue-data-status"><DataCell primary={<IssueStatusControl issue={issue} canManage={canEdit} compact />} /></AdaptiveDataCell>
          <AdaptiveDataCell column="progress" className="issue-data-progress"><DataCell primary={<span className="issue-table-progress"><i><b style={{ width: `${issue.progress}%` }} /></i>{issue.progress}%</span>} /></AdaptiveDataCell>
          <AdaptiveDataCell column="priority" className="issue-data-priority"><DataCell primary={canEdit && issue.status !== "resolved" ? <InlineSelectCell value={issue.priority} label="问题优先级" options={priorityOptions} displayMode="badge" onSave={(priority) => saveIssue(issue, { priority })} renderValue={(value) => <span className={`priority-badge priority-${value.toLowerCase()}`}>{priorityLabels[value as keyof typeof priorityLabels] || value}</span>} /> : <span className={`priority-badge priority-${issue.priority.toLowerCase()}`}>{priorityLabels[issue.priority as keyof typeof priorityLabels] || issue.priority}</span>} /></AdaptiveDataCell>
          <AdaptiveDataCell column="owner" className="issue-data-owner"><DataCell primary={canEdit && issue.status !== "resolved" ? <InlineSelectCell value={issue.ownerId} label="问题负责人" options={[{ value: "", label: "未分配" }, ...people.map((person) => ({ value: person.id, label: person.name }))]} onSave={(ownerId) => saveIssue(issue, { ownerId: ownerId || null })} placeholder="未分配" renderValue={(_value, selected) => selected?.value ? selected.label : <span className="muted-text">未分配</span>} /> : issue.ownerName || <span className="muted-text">未分配</span>} /></AdaptiveDataCell>
          <AdaptiveDataCell column="dueDate" className={`issue-data-due${issue.overdue ? " danger-text" : ""}`}><DataCell primary={canEdit && !["deferred", "resolved"].includes(issue.status) ? <InlineDateCell value={issue.dueDate} label="目标日期" onSave={(dueDate) => saveIssue(issue, { dueDate })} /> : issue.status === "deferred" ? "挂起 · 无日期" : issue.dueDate || "未设置"} secondary={issue.overdue ? "已逾期" : undefined} /></AdaptiveDataCell>
          <AdaptiveDataCell column="latest" className="issue-data-latest"><button type="button" className="issue-latest-update-button" onClick={() => openIssue(issue.id, "updates")}><DataCell primary={<span className="issue-latest-update" title={issue.latestUpdate || undefined}>{issue.latestUpdate || "暂无进展"}</span>} secondary={issue.latestUpdateAt ? shortDateTime(issue.latestUpdateAt) : "查看进展"} /></button></AdaptiveDataCell>
        </AdaptiveDataRow>)}
      </AdaptiveDataList>
    </div>
    {selectedIssueId && <Modal title="问题详情" width={960} layout="workspace" onClose={closeIssue}><IssueDetail issueId={selectedIssueId} projectId={selectedProjectId} people={people} requirements={requirements} defaultReporter={defaultReporter} initialTab={detailTab} canEdit={canEdit} canContribute={canContribute} personId={session.personId} onClose={closeIssue} /></Modal>}
    {formIssue !== undefined && <Modal title={formIssue ? "编辑问题" : "新建问题"} width={760} onClose={() => setFormIssue(undefined)}><IssueForm issue={formIssue || undefined} projectId={selectedProjectId} people={people} requirements={requirements} canManage={canEdit} defaultReporter={defaultReporter} onClose={() => setFormIssue(undefined)} /></Modal>}
  </>;
}
