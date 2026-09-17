import { searchIssues } from '../features/issues/api';
import * as peopleApi from '../features/people/api';
import * as requirementsApi from '../features/requirements/api';
import * as issuesApi from '../features/issues/api';
import { DetailCard } from '../components/DetailCard';
import { ObjectDetailContext, useObjectDetail, readDetailMemory } from '../components/ObjectDetailContext';
import { Button } from '../components/Button';
import { usePageResources } from '../page-context';
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePageSearchParams, usePageScrollPosition } from "../use-page-view";
import { AlertTriangle, CheckCircle2, Clock3, PauseCircle, Plus, UserRound } from "lucide-react";
import { jsonBody } from "../api";
import { useProjects, useSession } from "../app-context";
import { invalidateIssueViews, keys } from "../query-keys";
import { useOptimisticMutation } from "../use-optimistic-mutation";
import type { Issue, IssuePage, IssueUpdate, Person, Requirement } from "../types";
import { AdaptiveDataCell, AdaptiveDataList, AdaptiveDataRow, type AdaptiveDataColumn } from "../components/AdaptiveDataList";
import { DetailWorkspace } from "../components/DetailWorkspace";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/Badge";
import { EmptyState, RefreshNotice } from "../components/Feedback";
import { FilterBar } from "../components/FilterBar";
import { Pagination } from "../components/Pagination";
import { useListPagination } from '../use-list-pagination';
import { readPagination } from '../pagination';
import { usePagedResourceQuery } from '../use-paged-resource-query';
import { DataCell } from "../components/LayoutPrimitives";
import { PageHeader } from "../components/PageHeader";
import { IssueForm, IssueUpdateForm } from "../components/IssueForms";
import { IssueStatusControl } from "../components/IssueStatusControl";
import { InlineDateCell } from '../components/inline-edit/date';
import { InlineSelectCell } from '../components/inline-edit/select';
import { canManageProject } from "../permissions";
import { issueStatusOptions, priorityOptions } from "../ui-options";
import { SearchInput } from "../components/SearchInput";
import { isAssignablePerson } from '../assignable-people';

const statusEntries = issueStatusOptions.map(({ value, label }) => [value, label] as const);
const priorityEntries = priorityOptions.map(({ value, label }) => [value, label] as const);
const emptyPeople: Person[] = [];
const emptyRequirements: Requirement[] = [];
const issueColumns: AdaptiveDataColumn[] = [
  { key: "issue", label: "问题", track: "minmax(230px,2fr)", importance: "primary", compact: "primary" },
  { key: "scope", label: "范围", track: "minmax(120px,.9fr)", importance: "secondary", compact: "full" },
  { key: "status", label: "状态", track: "minmax(140px,.65fr)", compact: "detail" },
  { key: "progress", label: "进度", track: "minmax(92px,.65fr)", compact: "detail" },
  { key: "priority", label: "优先级", track: "minmax(140px,.65fr)", compact: "detail" },
  { key: "owner", label: "负责人", track: "minmax(106px,.75fr)", compact: "detail" },
  { key: "dueDate", label: "目标日期", track: "minmax(160px,.8fr)", compact: "detail" },
  { key: "latest", label: "最近进展", track: "minmax(200px,1.4fr)", importance: "essential", compact: "full" },
];

function defaultIssueStatus(params: URLSearchParams) {
  if (params.get("active") === "true") return "active";
  return params.has("status") ? params.get("status") || "" : "in_progress";
}

function issueSourceLabel(issue: Issue) {
  const value = issue.sourceRef?.trim();
  return value && value !== "公共问题" ? value : null;
}

function issueScope(issue: Issue) {
  return issue.requirementTitle || issueSourceLabel(issue) || "公共问题";
}

const publicIssueScopeValue = "__public_issue__";
const sourceIssueScopeValue = "__source_ref__";

function IssueScopeControl({
  issue,
  requirements,
  canEdit,
  onSave,
}: {
  issue: Issue;
  requirements: Requirement[];
  canEdit: boolean;
  onSave: (input: Record<string, unknown>) => Promise<unknown>;
}) {
  const label = issueScope(issue);
  if (!canEdit) {
    return <span className="issue-scope" title={label}>{label}</span>;
  }
  const sourceLabel = issueSourceLabel(issue);
  const value = issue.requirementId || (sourceLabel ? sourceIssueScopeValue : publicIssueScopeValue);
  const options = [
    { value: publicIssueScopeValue, label: "公共问题" },
    ...(sourceLabel ? [{ value: sourceIssueScopeValue, label: sourceLabel }] : []),
    ...requirements.map((requirement) => ({ value: requirement.id, label: requirement.title })),
  ];
  return <InlineSelectCell
    value={value}
    label="关联需求"
    options={options}
    onSave={(next) => {
      if (next === publicIssueScopeValue) return onSave({ requirementId: null, sourceRef: null });
      if (next === sourceIssueScopeValue) return onSave({ requirementId: null });
      return onSave({ requirementId: next, sourceRef: null });
    }}
    renderValue={(_value, selected) => <span className="issue-scope" title={selected?.label || label}>{selected?.label || label}</span>}
  />;
}

function shortDateTime(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}


const issueEventLabels: Record<string, string> = {
  note: "说明", progress: "进度", start: "开始", defer: "挂起", resume: "恢复",
  resolve: "解决", reopen: "重开", correction: "纠错", migration: "迁移",
};

function IssueUpdateSettingRow({ update, superseded }: { update: IssueUpdate; superseded?: IssueUpdate }) {
  return <article className="issue-update-setting-row">
    <header><time>{new Date(update.createdAt).toLocaleString("zh-CN")}</time><span><b className={`history-event history-event-${update.eventType}`}>{issueEventLabels[update.eventType] || update.eventType}</b>{update.createdByName || "系统记录"}</span></header>
    <p>{update.content}</p>
    <div className="issue-update-setting-footer">
      <span>{update.progress === null ? "仅说明" : `记录进度 ${update.progress}%`}</span>
      {update.supersedesId && <span className="issue-correction-reference">更正：{superseded ? `${shortDateTime(superseded.createdAt)} · ${issueEventLabels[superseded.eventType] || superseded.eventType}` : "原记录不可用"}</span>}
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
  pending,
  onPendingChange,
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
  pending: boolean;
  onPendingChange: (pending: boolean) => void;
}) {
  const detail=useObjectDetail();
  const [localTab, setLocalTab] = useState<string>(()=>detail?readDetailMemory(detail.key+':tab',initialTab):initialTab);
  const tab=detail?.tab||localTab, setTab=(value:string)=>{setLocalTab(value);detail?.onTabChange?.(value);};
  const { data: issue, error, refetch, isFetching, unavailable } = usePageResources().issue;
  const historyPagination = useListPagination({ items: issue?.updates || [], id: "issueHistory", filterKey: issueId, defaultPageSize: 10, ready: Boolean(issue), loading: isFetching, disabled: pending });
  if (!issue || unavailable) return null;
  const parentMutable = !issue.requirementId || requirements.some((requirement) => requirement.id === issue.requirementId);
  const canEditIssue = canEdit && parentMutable;
  const canSetProgress = (value: Issue) => value.status === "in_progress"
    && (!value.requirementId || requirements.some((requirement) => requirement.id === value.requirementId))
    && (canEdit || Boolean(personId && value.ownerId === personId));
  const updateById = new Map((issue.updates || []).map((update) => [update.id, update]));
  const summary = <>
    <div>
    {error && <RefreshNotice pending={isFetching} onRetry={() => void refetch()} />}
    <header className="issue-settings-summary">
      <div>
        <div className="issue-detail-badges"><IssueStatusControl issue={issue} canManage={canEditIssue} disabled={pending} onPendingChange={onPendingChange} compact /><StatusBadge kind="priority" value={issue.priority} />{issue.overdue && <span className="issue-overdue-badge">已逾期</span>}</div>
        <h3>{issue.title}</h3>
        <p>{issueScope(issue)} · {issue.ownerName || "未分配负责人"}</p>
      </div>
      <div className="issue-settings-current-progress"><span>当前进度</span><div><i><b style={{ width: `${issue.progress}%` }} /></i><strong>{issue.progress}%</strong></div><small>由状态命令与追加进展共同维护</small></div>
    </header>
    </div>
  </>;
  const basic = <DetailCard title="问题资料">
      {!canEditIssue ? <div className="issue-readonly-detail">
        <dl><div><dt>问题影响</dt><dd>{issue.impact || "暂无影响说明"}</dd></div><div><dt>关联范围</dt><dd>{issueScope(issue)}</dd></div><div><dt>负责人</dt><dd>{issue.ownerName || "未分配"}</dd></div><div><dt>提出人</dt><dd>{issue.reporter || "未指定"}</dd></div><div><dt>发现日期</dt><dd>{issue.discoveredAt}</dd></div><div><dt>下次核对</dt><dd>{issue.nextReviewAt||"未设置"}</dd></div><div><dt>目标日期</dt><dd>{issue.status === "deferred" ? "挂起 · 无日期" : issue.dueDate || "未设置"}</dd></div>{issue.status === "resolved" && <div><dt>解决日期</dt><dd>{issue.resolvedAt || "未记录"}</dd></div>}</dl>
      </div> : <IssueForm issue={issue} projectId={projectId} people={people} requirements={requirements} canManage defaultReporter={defaultReporter} autoFocusTitle={tab === "basic"} onClose={onClose} busy={pending} onPendingChange={onPendingChange} />}
  </DetailCard>;
  const updates = <>
      <DetailCard title="追加进展" className="issue-settings-progress-entry" description={canEditIssue ? "填写本次进度和说明；选择100%可直接保存并解决" : "记录本次进展和处理说明"}>
        {canContribute ? <IssueUpdateForm issue={issue} canResolve={canEditIssue} canSetProgress={canSetProgress} busy={pending} onPendingChange={onPendingChange} /> : <p className="issue-settings-resolved-note">当前角色可查看进展，但不能追加记录。</p>}
      </DetailCard>
  </>;
  const history = <>
      <DetailCard title="历史进展" className="issue-update-settings" description={`${issue.updates?.length || 0} 条只读记录；纠错会新增记录，不覆盖历史`}>
        <div className="issue-update-settings-list" ref={historyPagination.scrollRef}>{historyPagination.items.map((update) => <IssueUpdateSettingRow update={update} superseded={update.supersedesId ? updateById.get(update.supersedesId) : undefined} key={update.id} />)}</div>
        <Pagination {...historyPagination.props} label="问题进展分页" />
        {!issue.updates?.length && <EmptyState title="暂无进展记录" detail="在“进展”页填写进度与说明，创建第一条记录。" />}
      </DetailCard>
  </>;
  return <DetailWorkspace label="问题详情" summary={summary} activeTab={tab} onTabChange={setTab} disabled={pending} tabs={[
    {id: 'updates', label: '进展', content: updates},
    {id: 'basic', label: '基本信息', content: basic},
    {id: 'history', label: `记录 ${issue.updates?.length || 0}`, content: history},
  ]}/>;
}

export function IssuesPage() {
  const { session } = useSession();
  const { selectedProjectId } = useProjects();
  const [searchParams, setSearchParams] = usePageSearchParams(['q','status','active','priority','ownerId','scope','requirementId','overdue','unassigned','page']);
  const linkedQuery = searchParams.toString();
  const keyword = searchParams.get("q") || "";
  const deferredKeyword = useDeferredValue(keyword);
  const status = defaultIssueStatus(searchParams);
  const priority = searchParams.get("priority") || "", ownerId = searchParams.get("ownerId") || "";
  const scope = searchParams.get("scope") === "public" ? "public" : searchParams.get("requirementId") || "";
  const overdue = searchParams.get("overdue") === "true", unassigned = searchParams.get("unassigned") === "true";
  const { page, pageSize } = readPagination(searchParams);
  const selectedIssueId = searchParams.get("detailId")?.replace(/^issue:/, "") || searchParams.get("issueId") || undefined;
  const [detailTab, setDetailTab] = useState<"basic" | "updates">("updates");
  const [formIssue, setFormIssue] = useState<Issue | null | undefined>(undefined);
  const [detailPending, setDetailPending] = useState(false);
  const [formPending, setFormPending] = useState(false);
  const detailPendingRef = useRef(false);
  const formPendingRef = useRef(false);
  const changeDetailPending = (pending: boolean) => {
    detailPendingRef.current = pending;
    setDetailPending(pending);
  };
  const changeFormPending = (pending: boolean) => {
    formPendingRef.current = pending;
    setFormPending(pending);
  };
  const peopleQuery = useQuery({ queryKey: [...keys.people, selectedProjectId], queryFn: ({ signal }) => peopleApi.peopleQuery<Person[]>(encodeURIComponent(selectedProjectId), { signal }), enabled: Boolean(selectedProjectId) });
  const people = peopleQuery.data || emptyPeople;
  const eligiblePeople = people.filter(isAssignablePerson);
  const requirementsQuery = useQuery({ queryKey: [...keys.requirements, selectedProjectId], queryFn: ({ signal }) => requirementsApi.requirementsQuery<Requirement[]>(encodeURIComponent(selectedProjectId), { signal }), enabled: Boolean(selectedProjectId) });
  const requirements = requirementsQuery.data || emptyRequirements;
  const referenceDataReady = peopleQuery.data !== undefined && requirementsQuery.data !== undefined;
  const referenceError = peopleQuery.error || requirementsQuery.error;
  const retryReferenceData = () => void Promise.all([peopleQuery.refetch(), requirementsQuery.refetch()]);
  useEffect(() => {
    if (!referenceDataReady) return;
    const staleOwner = Boolean(ownerId && !people.some((person) => person.id === ownerId));
    const staleRequirement = Boolean(scope && scope !== "public" && !requirements.some((requirement) => requirement.id === scope));
    if (!staleOwner && !staleRequirement) return;
    const next = new URLSearchParams(linkedQuery);
    next.delete("page");
    if (staleOwner) {
      next.delete("ownerId");
    }
    if (staleRequirement) {
      next.delete("requirementId");
    }
    setSearchParams(next, { replace: true });
  }, [linkedQuery, ownerId, people, referenceDataReady, requirements, scope, setSearchParams]);
  const canEdit = canManageProject(session, selectedProjectId);
  const canEditIssue = (issue: Issue) => referenceDataReady && canEdit && (!issue.requirementId || requirements.some((requirement) => requirement.id === issue.requirementId));
  const canContribute = referenceDataReady && session.authenticated && !session.mustChangePassword
    && (canEdit || Boolean(session.personId && people.some((person) => person.id === session.personId && person.projectRole !== "viewer")));
  const defaultReporter = people.find((person) => person.id === session.personId)?.name || session.username;
  const params = new URLSearchParams({ projectId: selectedProjectId, page: String(page), pageSize: String(pageSize) });
  if (deferredKeyword.trim()) params.set("q", deferredKeyword.trim());
  if (status === "active") params.set("active", "true");
  else if (status) params.set("status", status);
  if (priority) params.set("priority", priority);
  if (ownerId) params.set("ownerId", ownerId);
  if (scope === "public") params.set("scope", "public");
  else if (scope) params.set("requirementId", scope);
  if (overdue) params.set("overdue", "true");
  if (unassigned) params.set("unassigned", "true");
  const filterKey = JSON.stringify([selectedProjectId, deferredKeyword, status, priority, ownerId, scope, overdue, unassigned]);
  const { data, isLoading, error, refetch, isFetching } = usePagedResourceQuery<IssuePage>(
    [...keys.issues, selectedProjectId, deferredKeyword, status, priority, ownerId, scope, overdue, unassigned, page, pageSize], signal => searchIssues(params, { signal }), filterKey, Boolean(selectedProjectId));
  const pagination = useListPagination({ total: data?.total || 0, filterKey, ready: Boolean(data) && !error, loading: isFetching,
    serverPage: data?.page, serverPageSize: data?.pageSize, failed: Boolean(error), disabled: detailPending || formPending });
  const runIssueSave = useOptimisticMutation<{ issue: Issue; input: Record<string, unknown> }, Issue>({
    snapshotKeys: ({ issue }) => [[...keys.issues, selectedProjectId], keys.issue(issue.id)],
    apply: (queryClient, { issue, input }) => {
      const applyInput = (current: Issue) => {
        if (current.version > issue.version) return current;
        const optimistic = { ...current, ...input } as Issue;
        if (Object.prototype.hasOwnProperty.call(input, "ownerId")) {
          optimistic.ownerId = typeof input.ownerId === "string" && input.ownerId ? input.ownerId : null;
          optimistic.ownerName = people.find((person) => person.id === optimistic.ownerId)?.name || null;
        }
        if (Object.prototype.hasOwnProperty.call(input, "requirementId")) {
          optimistic.requirementId = typeof input.requirementId === "string" && input.requirementId ? input.requirementId : null;
          optimistic.requirementTitle = requirements.find((requirement) => requirement.id === optimistic.requirementId)?.title || null;
        }
        return optimistic;
      };
      queryClient.setQueriesData<IssuePage>({ queryKey: [...keys.issues, selectedProjectId] }, (current) => current ? {
        ...current,
        items: current.items.map((entry) => entry.id === issue.id ? applyInput(entry) : entry),
      } : current);
      queryClient.setQueryData<Issue | null>(keys.issue(issue.id), (current) => current ? applyInput(current) : current);
    },
    request: ({ issue, input }) => issuesApi.issuesById<Issue>(issue.id, { method: "PATCH", body: jsonBody({ ...input, expectedVersion: issue.version }) }),
    commit: (queryClient, saved) => {
      queryClient.setQueriesData<IssuePage>({ queryKey: [...keys.issues, selectedProjectId] }, (current) => current ? {
        ...current,
        items: current.items.map((entry) => entry.id === saved.id && entry.version <= saved.version ? saved : entry),
      } : current);
      queryClient.setQueryData<Issue | null>(keys.issue(saved.id), (current) => current === null || (current && current.version > saved.version) ? current : saved);
      invalidateIssueViews(queryClient, saved.id);
    },
  });
  const saveIssue = (issue: Issue, input: Record<string, unknown>) => runIssueSave({ issue, input });
  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(linkedQuery);
    next.delete("page");
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next, { replace: true });
  };
  const changeStatus = (value: string) => {
    const next = new URLSearchParams(linkedQuery);
    next.delete("page");
    next.delete("active");
    next.set("status", value);
    if (value === "resolved") {
      next.delete("overdue");
    }
    setSearchParams(next, { replace: true });
  };
  const changeOwner = (value: string) => {
    const next = new URLSearchParams(linkedQuery);
    next.delete("page");
    if (value) {
      next.set("ownerId", value);
      next.delete("unassigned");
    } else next.delete("ownerId");
    setSearchParams(next, { replace: true });
  };
  const changeScope = (value: string) => {
    const next = new URLSearchParams(linkedQuery);
    next.delete("page");
    next.delete("scope"); next.delete("requirementId");
    if (value === "public") next.set("scope", "public");
    else if (value) next.set("requirementId", value);
    setSearchParams(next, { replace: true });
  };
  const toggleOverdue = () => {
    const enabled = !overdue;
    const next = new URLSearchParams(linkedQuery);
    next.delete("page");
    if (enabled) {
      next.set("overdue", "true");
      if (status === "resolved") {
        next.delete("active");
        next.set("status", "active");
      }
    } else next.delete("overdue");
    setSearchParams(next, { replace: true });
  };
  const toggleUnassigned = () => {
    const enabled = !unassigned;
    const next = new URLSearchParams(linkedQuery);
    next.delete("page");
    if (enabled) {
      next.set("unassigned", "true");
      next.delete("ownerId");
    } else next.delete("unassigned");
    setSearchParams(next, { replace: true });
  };
  const clearFilters = () => setSearchParams(current => { const next = new URLSearchParams(current); for (const key of ['q','status','active','priority','ownerId','scope','requirementId','overdue','unassigned']) next.delete(key); next.set('page','1'); return next; });
  const hasFilters = Boolean(keyword || status !== "in_progress" || priority || ownerId || scope || overdue || unassigned);
  usePageScrollPosition(!isLoading);
  const listUnavailable = Boolean(error && !data);
  const summary = data?.summary || { total: 0, inProgress: 0, deferred: 0, resolved: 0, active: 0, highPriority: 0, overdue: 0, unassigned: 0, closureRate: 0 };
  const openIssue = (id: string, tab: "basic" | "updates") => {
    setDetailTab(tab);
    const next = new URLSearchParams(linkedQuery); next.delete("issueId"); next.set("detailId",id); next.set("detailTab",tab); next.set("issueHistory.page", "1"); setSearchParams(next, {replace:false});
  };
  const closeIssue = () => {
    const next = new URLSearchParams(linkedQuery); next.delete("issueId"); next.delete("detailId"); next.delete("detailTab"); setSearchParams(next, {replace:false});
  };
  const closeIssueFromUi = () => {
    if (!detailPendingRef.current) closeIssue();
  };
  const closeIssueForm = () => setFormIssue(undefined);
  const closeIssueFormFromUi = () => {
    if (!formPendingRef.current) closeIssueForm();
  };
  return <>
    <PageHeader title="问题跟踪" actions={canContribute ? <Button variant="primary" className="primary-button" disabled={!selectedProjectId} onClick={() => setFormIssue(null)}><Plus size={16} />新建问题</Button> : null} />
    <div className="page-content issues-page">
      {referenceError && <div className="warning-banner">{referenceDataReady ? "人员与需求范围刷新失败，当前使用上次成功结果。" : "编辑所需的人员与需求范围加载失败，当前暂时只读。"}<Button variant="secondary" className="ghost-button" disabled={peopleQuery.isFetching || requirementsQuery.isFetching} onClick={retryReferenceData}>重新加载</Button></div>}
      <section className="issue-board" aria-label="问题看板">
        <article className="issue-metric metric-progress"><Clock3 size={20} /><div><span>处理中</span><strong>{summary.inProgress}</strong></div></article>
        <article className="issue-metric metric-deferred"><PauseCircle size={20} /><div><span>挂起</span><strong>{summary.deferred}</strong></div></article>
        <article className="issue-metric metric-resolved"><CheckCircle2 size={20} /><div><span>已解决</span><strong>{summary.resolved}</strong></div></article>
        <article className="issue-metric metric-overdue"><AlertTriangle size={20} /><div><span>已逾期</span><strong>{summary.overdue}</strong></div></article>
      </section>
      <FilterBar className="issue-filters" result={`${data?.total || 0} / ${summary.total} 条`} onReset={clearFilters} resetDisabled={!hasFilters}>
        <SearchInput value={keyword} onChange={(value) => updateFilter("q", value)} placeholder="搜索问题、影响、人员、进展或拼音" />
        <select value={status} onChange={(event) => changeStatus(event.target.value)}><option value="in_progress">处理中</option><option value="active">全部未闭环</option><option value="">全部状态</option>{statusEntries.filter(([value]) => value !== "in_progress").map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <select value={priority} onChange={(event) => updateFilter("priority", event.target.value)}><option value="">全部优先级</option>{priorityEntries.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <select value={ownerId} onChange={(event) => changeOwner(event.target.value)}><option value="">全部负责人</option>{people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select>
        <select value={scope} onChange={(event) => changeScope(event.target.value)}><option value="">全部范围</option><option value="public">公共问题</option>{requirements.map((requirement) => <option value={requirement.id} key={requirement.id}>{requirement.title}</option>)}</select>
        <Button variant="secondary" aria-pressed={overdue} className={`issue-filter-toggle${overdue ? " active" : ""}`} onClick={toggleOverdue}><AlertTriangle size={14} />仅逾期</Button>
        <Button variant="secondary" aria-pressed={unassigned} className={`issue-filter-toggle${unassigned ? " active" : ""}`} onClick={toggleUnassigned}><UserRound size={14} />未分配</Button>
      </FilterBar>
      {error && data && <div className="warning-banner">问题列表刷新失败，当前展示的是上次成功结果。<Button variant="secondary" className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</Button></div>}
      <AdaptiveDataList
        label="问题跟踪列表"
        layout="scroll"
        className="issue-data-list paged-panel"
        bodyRef={pagination.scrollRef}
        columns={issueColumns}
        empty={listUnavailable
          ? <EmptyState title="问题列表加载失败" detail={error?.message || "暂时无法读取问题数据。"} action={<Button variant="secondary" className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</Button>} />
          : !data?.items.length && !isLoading ? <EmptyState title="没有符合条件的问题" detail="调整筛选条件，或新建一条公共问题。" /> : null}
        footer={!listUnavailable ? <Pagination {...pagination.props} label="问题列表分页" /> : null}
      >
        {data?.items.map((issue) => <AdaptiveDataRow className={`issue-data-row${issue.overdue ? " is-overdue" : ""}`} key={issue.id}>
          <AdaptiveDataCell column="issue" className="issue-data-primary"><button type="button" className="issue-title-button" onClick={() => openIssue(issue.id, "basic")}><DataCell primary={<strong>{issue.title}</strong>} secondary={issue.impact || "暂无影响说明"} /></button></AdaptiveDataCell>
          <AdaptiveDataCell column="scope" className="issue-data-scope"><DataCell primary={<IssueScopeControl issue={issue} requirements={requirements} canEdit={canEditIssue(issue)} onSave={(input) => saveIssue(issue, input)} />} /></AdaptiveDataCell>
          <AdaptiveDataCell column="status" className="issue-data-status"><DataCell primary={<IssueStatusControl issue={issue} canManage={canEditIssue(issue)} compact />} /></AdaptiveDataCell>
          <AdaptiveDataCell column="progress" className="issue-data-progress"><DataCell primary={<span className="issue-table-progress"><i><b style={{ width: `${issue.progress}%` }} /></i>{issue.progress}%</span>} /></AdaptiveDataCell>
          <AdaptiveDataCell column="priority" className="issue-data-priority"><DataCell primary={canEditIssue(issue) ? <InlineSelectCell value={issue.priority} label="问题优先级" options={priorityOptions} displayMode="badge" onSave={(priority) => saveIssue(issue, { priority })} renderValue={(value) => <StatusBadge kind="priority" value={value} />} /> : <StatusBadge kind="priority" value={issue.priority} />} /></AdaptiveDataCell>
          <AdaptiveDataCell column="owner" className="issue-data-owner"><DataCell primary={canEditIssue(issue) ? <InlineSelectCell value={issue.ownerId} label="问题负责人" options={[{ value: "", label: "未分配" }, ...(issue.status==="resolved"?people.filter(p=>p.projectRole!=="viewer"):eligiblePeople).map((person) => ({ value: person.id, label: person.name })), ...(issue.ownerId && !(issue.status==="resolved"?people:eligiblePeople).some((person) => person.id === issue.ownerId) ? [{ value: issue.ownerId, label: issue.ownerName || "历史负责人", description: "历史负责人" }] : [])]} onSave={(ownerId) => saveIssue(issue, { ownerId: ownerId || null })} placeholder="未分配" renderValue={(_value, selected) => selected?.value ? selected.label : <span className="muted-text">未分配</span>} /> : issue.ownerName || <span className="muted-text">未分配</span>} /></AdaptiveDataCell>
          <AdaptiveDataCell column="dueDate" className={`issue-data-due${issue.overdue ? " danger-text" : ""}`}><DataCell primary={canEditIssue(issue) && issue.status !== "deferred" ? <InlineDateCell value={issue.dueDate} label="目标日期" onSave={(dueDate) => saveIssue(issue, { dueDate })} /> : issue.status === "deferred" ? "挂起 · 无日期" : issue.dueDate || "未设置"} secondary={issue.status === "resolved" ? `解决 ${issue.resolvedAt || "日期未记录"}` : issue.overdue ? "已逾期" : undefined} /></AdaptiveDataCell>
          <AdaptiveDataCell column="latest" className="issue-data-latest"><button type="button" className="issue-latest-update-button" onClick={() => openIssue(issue.id, "updates")}><DataCell primary={<span className="issue-latest-update" title={issue.latestUpdate || undefined}>{issue.latestUpdate || "暂无进展"}</span>} secondary={issue.latestUpdateAt ? shortDateTime(issue.latestUpdateAt) : "查看进展"} /></button></AdaptiveDataCell>
        </AdaptiveDataRow>)}
      </AdaptiveDataList>
    </div>
    {selectedIssueId && <ObjectDetailContext.Provider value={{key:(session.accountId||"guest")+":"+selectedProjectId+":"+selectedIssueId,tab:searchParams.get("detailTab")||undefined,onTabChange:tab=>setSearchParams(current=>{const next=new URLSearchParams(current);next.set("detailTab",tab);return next;},{replace:true})}}><Modal title="问题详情" width={960} layout="workspace" closable={!detailPending} onClose={closeIssueFromUi}><IssueDetail key={selectedIssueId} issueId={selectedIssueId} projectId={selectedProjectId} people={people} requirements={requirements} defaultReporter={defaultReporter} initialTab={detailTab} canEdit={canEdit && referenceDataReady} canContribute={canContribute} personId={session.personId} onClose={closeIssue} pending={detailPending} onPendingChange={changeDetailPending} /></Modal></ObjectDetailContext.Provider>}
    {formIssue !== undefined && <Modal title={formIssue ? "编辑问题" : "新建问题"} width={760} closable={!formPending} onClose={closeIssueFormFromUi}><IssueForm issue={formIssue || undefined} projectId={selectedProjectId} people={people} requirements={requirements} canManage={canEdit} defaultReporter={defaultReporter} onClose={closeIssueForm} onPendingChange={changeFormPending} /></Modal>}
  </>;
}
