import { useDeferredValue, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock3,
  Edit3,
  PauseCircle,
  Plus,
  Search,
  UserRound,
} from "lucide-react";
import { api, jsonBody } from "../api";
import { useApp } from "../app-context";
import type { Issue, IssuePage, Person, Requirement } from "../types";
import { issueStatusLabels, priorityLabels, todayIso } from "../../shared/domain";
import { EmptyState, Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";

const statusEntries = Object.entries(issueStatusLabels);
const priorityEntries = Object.entries(priorityLabels);

function issueScope(issue: Issue) {
  return issue.requirementTitle || issue.sourceRef || "公共问题";
}

function shortDateTime(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function IssueForm({
  issue,
  projectId,
  people,
  requirements,
  onClose,
}: {
  issue?: Issue;
  projectId: string;
  people: Person[];
  requirements: Requirement[];
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [status, setStatus] = useState(issue?.status || "open");
  const needsResolutionNote = Boolean(issue && issue.status !== "resolved" && status === "resolved");
  const mutation = useMutation({
    mutationFn: (value: object) => api<Issue>(issue ? `/api/issues/${issue.id}` : "/api/issues", {
      method: issue ? "PATCH" : "POST",
      body: jsonBody(value),
    }),
    onSuccess: (saved) => {
      void client.invalidateQueries({ queryKey: ["issues"] });
      void client.invalidateQueries({ queryKey: ["issue", saved.id] });
      onClose();
    },
  });
  return <form className="form-grid issue-form" onSubmit={(event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    mutation.mutate({ ...data, projectId, status });
  }}>
    <label className="field field-full"><span>问题标题</span><input name="title" required autoFocus defaultValue={issue?.title || ""} placeholder="用一句话说明要跟踪的问题" /></label>
    <label className="field field-full"><span>问题影响</span><textarea name="impact" rows={3} defaultValue={issue?.impact || ""} placeholder="可选：说明影响范围、风险或被阻塞的工作" /></label>
    <label className="field"><span>关联需求</span><select name="requirementId" defaultValue={issue?.requirementId || ""}><option value="">公共问题</option>{requirements.map((requirement) => <option key={requirement.id} value={requirement.id}>{requirement.title}</option>)}</select></label>
    <label className="field"><span>范围标识</span><input name="sourceRef" defaultValue={issue?.sourceRef || ""} placeholder="可选，如 DCIM-36" /></label>
    <label className="field"><span>状态</span><select name="status" value={status} onChange={(event) => setStatus(event.target.value)}>{statusEntries.filter(([value]) => issue || value !== "resolved").map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
    <label className="field"><span>优先级</span><select name="priority" defaultValue={issue?.priority || "P2"}>{priorityEntries.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
    <label className="field"><span>负责人</span><select name="ownerId" required={status === "in_progress"} defaultValue={issue?.ownerId || ""}><option value="">未分配</option>{people.map((person) => <option value={person.id} key={person.id}>{person.name} · {person.jobTitle || "岗位未设置"}</option>)}</select></label>
    <label className="field"><span>提出人</span><input name="reporter" defaultValue={issue?.reporter || ""} placeholder="可填写多人或外部人员" /></label>
    <label className="field"><span>发现日期</span><input name="discoveredAt" type="date" required defaultValue={issue?.discoveredAt || todayIso()} /></label>
    <label className="field"><span>目标日期</span><input name="dueDate" type="date" defaultValue={issue?.dueDate || ""} /></label>
    {needsResolutionNote && <label className="field field-full issue-resolution-note"><span>闭环说明</span><textarea name="updateContent" rows={3} required placeholder="说明问题如何解决或最终结论" /></label>}
    {mutation.error && <p className="form-error field-full">{mutation.error.message}</p>}
    <div className="form-actions field-full"><button type="button" className="ghost-button" onClick={onClose}>取消</button><button className="primary-button" disabled={mutation.isPending}>{issue ? "保存修改" : "创建问题"}</button></div>
  </form>;
}

function IssueUpdateForm({ issueId }: { issueId: string }) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (content: string) => api<Issue>(`/api/issues/${issueId}/updates`, { method: "POST", body: jsonBody({ content }) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["issue", issueId] });
      void client.invalidateQueries({ queryKey: ["issues"] });
    },
  });
  return <form className="issue-update-form" onSubmit={(event) => {
    event.preventDefault();
    const form = event.currentTarget;
    mutation.mutate(String(new FormData(form).get("content") || ""), { onSuccess: () => form.reset() });
  }}>
    <textarea name="content" rows={3} required placeholder="记录新进展、决策或待办结果" />
    <div><span>{mutation.error?.message}</span><button className="primary-button" disabled={mutation.isPending}>追加进展</button></div>
  </form>;
}

function IssueDetail({
  issueId,
  sessionAuthenticated,
  onEdit,
}: {
  issueId: string;
  sessionAuthenticated: boolean;
  onEdit: (issue: Issue) => void;
}) {
  const { data: issue, isLoading } = useQuery({ queryKey: ["issue", issueId], queryFn: () => api<Issue>(`/api/issues/${issueId}`) });
  if (isLoading || !issue) return <div className="issue-detail-loading">正在加载问题详情…</div>;
  return <div className="issue-detail">
    <header className="issue-detail-hero">
      <div>
        <div className="issue-detail-badges"><span className={`issue-status issue-status-${issue.status}`}>{issueStatusLabels[issue.status as keyof typeof issueStatusLabels] || issue.status}</span><span className={`priority-badge priority-${issue.priority.toLowerCase()}`}>{priorityLabels[issue.priority as keyof typeof priorityLabels] || issue.priority}</span>{issue.overdue && <span className="issue-overdue-badge">已逾期</span>}</div>
        <h3>{issue.title}</h3>
        <p>{issueScope(issue)}</p>
      </div>
      {sessionAuthenticated && <button className="ghost-button" onClick={() => onEdit(issue)}><Edit3 size={15} />编辑</button>}
    </header>
    <dl className="issue-meta-grid">
      <div><dt>负责人</dt><dd>{issue.ownerName || "未分配"}</dd></div>
      <div><dt>提出人</dt><dd>{issue.reporter || "未填写"}</dd></div>
      <div><dt>发现日期</dt><dd>{issue.discoveredAt}</dd></div>
      <div><dt>目标日期</dt><dd className={issue.overdue ? "danger-text" : ""}>{issue.dueDate || "未设置"}</dd></div>
      <div><dt>闭环日期</dt><dd>{issue.resolvedAt || "—"}</dd></div>
      <div><dt>最近活动</dt><dd>{shortDateTime(issue.latestUpdateAt || issue.updatedAt)}</dd></div>
    </dl>
    <section className="issue-impact"><h4>问题影响</h4><p>{issue.impact || "暂未填写影响说明。"}</p></section>
    <section className="issue-progress-section">
      <header><div><h4>进展时间线</h4><p>{issue.updates?.length || 0} 条记录</p></div></header>
      <div className="issue-timeline">
        {issue.updates?.map((update) => <article key={update.id}><span className="issue-timeline-dot" /><div><time>{new Date(update.createdAt).toLocaleString("zh-CN")}</time><p>{update.content}</p></div></article>)}
        {!issue.updates?.length && <EmptyState title="还没有进展" detail="追加第一条进展后，会在这里按时间展示。" />}
      </div>
      {sessionAuthenticated && <IssueUpdateForm issueId={issue.id} />}
    </section>
  </div>;
}

export function IssuesPage() {
  const { selectedProjectId, session } = useApp();
  const [keyword, setKeyword] = useState("");
  const deferredKeyword = useDeferredValue(keyword);
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [scope, setScope] = useState("");
  const [overdue, setOverdue] = useState(false);
  const [unassigned, setUnassigned] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedIssueId, setSelectedIssueId] = useState<string>();
  const [formIssue, setFormIssue] = useState<Issue | null | undefined>(undefined);
  const { data: people = [] } = useQuery({ queryKey: ["people", selectedProjectId], queryFn: () => api<Person[]>(`/api/people?projectId=${encodeURIComponent(selectedProjectId)}`), enabled: Boolean(selectedProjectId) });
  const { data: requirements = [] } = useQuery({ queryKey: ["requirements", selectedProjectId], queryFn: () => api<Requirement[]>(`/api/requirements?projectId=${encodeURIComponent(selectedProjectId)}`), enabled: Boolean(selectedProjectId) });
  const params = new URLSearchParams({ projectId: selectedProjectId, page: String(page), pageSize: "50" });
  if (deferredKeyword.trim()) params.set("q", deferredKeyword.trim());
  if (status) params.set("status", status);
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
  const resetPage = (update: () => void) => { update(); setPage(1); };
  const clearFilters = () => { setKeyword(""); setStatus(""); setPriority(""); setOwnerId(""); setScope(""); setOverdue(false); setUnassigned(false); setPage(1); };
  const hasFilters = Boolean(keyword || status || priority || ownerId || scope || overdue || unassigned);
  const summary = data?.summary || { total: 0, open: 0, inProgress: 0, deferred: 0, resolved: 0, overdue: 0, unassigned: 0 };
  return <>
    <PageHeader title="问题跟踪" actions={session.authenticated ? <button className="primary-button" disabled={!selectedProjectId} onClick={() => setFormIssue(null)}><Plus size={16} />新建问题</button> : null} />
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
        <select value={status} onChange={(event) => resetPage(() => setStatus(event.target.value))}><option value="">全部状态</option>{statusEntries.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <select value={priority} onChange={(event) => resetPage(() => setPriority(event.target.value))}><option value="">全部优先级</option>{priorityEntries.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <select value={ownerId} onChange={(event) => resetPage(() => setOwnerId(event.target.value))}><option value="">全部负责人</option>{people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select>
        <select value={scope} onChange={(event) => resetPage(() => setScope(event.target.value))}><option value="">全部范围</option><option value="public">公共问题</option>{requirements.map((requirement) => <option value={requirement.id} key={requirement.id}>{requirement.title}</option>)}</select>
        <button className={`issue-filter-toggle${overdue ? " active" : ""}`} onClick={() => resetPage(() => setOverdue((value) => !value))}><AlertTriangle size={14} />仅逾期</button>
        <button className={`issue-filter-toggle${unassigned ? " active" : ""}`} onClick={() => resetPage(() => setUnassigned((value) => !value))}><UserRound size={14} />未分配</button>
        <span className="issue-filter-result">{data?.total || 0} / {summary.total} 条</span>
        <button className="gantt-reset-button" disabled={!hasFilters} onClick={clearFilters}>清除筛选</button>
      </div>
      <section className="table-panel issue-table-panel">
        <table className="issue-table"><thead><tr><th>问题</th><th>范围</th><th>状态</th><th>优先级</th><th>负责人</th><th>目标日期</th><th>最近进展</th></tr></thead>
          <tbody>{data?.items.map((issue) => <tr key={issue.id} onClick={() => setSelectedIssueId(issue.id)}>
            <td><strong>{issue.title}</strong><small>{issue.impact || "暂无影响说明"}</small></td>
            <td><span className="issue-scope" title={issueScope(issue)}>{issueScope(issue)}</span></td>
            <td><span className={`issue-status issue-status-${issue.status}`}>{issueStatusLabels[issue.status as keyof typeof issueStatusLabels] || issue.status}</span></td>
            <td><span className={`priority-badge priority-${issue.priority.toLowerCase()}`}>{issue.priority}</span></td>
            <td>{issue.ownerName || <span className="muted-text">未分配</span>}</td>
            <td className={issue.overdue ? "danger-text" : ""}>{issue.dueDate || "未设置"}{issue.overdue && <small>已逾期</small>}</td>
            <td><span className="issue-latest-update" title={issue.latestUpdate || undefined}>{issue.latestUpdate || "暂无进展"}</span><small>{issue.latestUpdateAt ? shortDateTime(issue.latestUpdateAt) : "—"}</small></td>
          </tr>)}</tbody>
        </table>
        {!data?.items.length && !isLoading && <EmptyState title="没有符合条件的问题" detail="调整筛选条件，或新建一条公共问题。" />}
        <footer className="table-pagination"><span>第 {data?.page || 1} / {data?.pages || 1} 页</span><div><button className="ghost-button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><button className="ghost-button" disabled={page >= (data?.pages || 1)} onClick={() => setPage((value) => value + 1)}>下一页</button></div></footer>
      </section>
    </div>
    {selectedIssueId && <Modal title="问题详情" width={900} onClose={() => setSelectedIssueId(undefined)}><IssueDetail issueId={selectedIssueId} sessionAuthenticated={session.authenticated} onEdit={(issue) => { setSelectedIssueId(undefined); setFormIssue(issue); }} /></Modal>}
    {formIssue !== undefined && <Modal title={formIssue ? "编辑问题" : "新建问题"} width={760} onClose={() => setFormIssue(undefined)}><IssueForm issue={formIssue || undefined} projectId={selectedProjectId} people={people} requirements={requirements} onClose={() => setFormIssue(undefined)} /></Modal>}
  </>;
}
