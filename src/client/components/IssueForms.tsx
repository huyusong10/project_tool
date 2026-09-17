import * as issuesApi from '../features/issues/api';
import { useDeliveryForm } from '../use-delivery-form';
import { useProjects } from '../app-context';
import { Button } from './Button';
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, ChevronDown, Search } from "lucide-react";
import { ApiError, isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from "../api";
import { useBusinessDate, useSession } from "../app-context";
import { invalidateIssueViews, keys } from "../query-keys";
import { cacheResourceUpdate, readResourceFresh, ResourceReadInvalidatedError } from "../use-resource-query";
import type { Issue, IssuePage, Person, Requirement } from "../types";
import { issueStatusLabels } from "../../shared/domain";
import { canonicalizeContent, canonicalizeLabel, rankSearchItems } from "../../shared/search";
import { FieldShell } from "./LayoutPrimitives";
import { StatusBadge } from "./Badge";
import { ProgressInput } from "./ProgressInput";
import { priorityOptions } from "../ui-options";
import { useToast } from "./Toast";
import { AnchoredPopover } from './inline-edit/popover';

type BusyChange = (pending: boolean) => void;

/** 草稿使用自己的版本；刷新只更新基线，不覆盖已输入字段。 */
export function useIssueDraft(issue: Issue | undefined, onPendingChange?: BusyChange, action='edit', projectId?:string) {
  const client = useQueryClient();
  const {selectedProjectId}=useProjects();
  const [memory,setMemory,clearMemory]=useDeliveryForm(issue?.projectId||projectId||selectedProjectId,(issue?.id||'new')+':issue-meta:'+action,()=>({baseline:issue,dirty:false,needsRefresh:false}));
  const baseline=memory.baseline,dirty=memory.dirty;
  const setBaseline=useCallback((baseline:Issue)=>setMemory(value=>({...value,baseline})),[setMemory]);
  const setDirty=useCallback((dirty:boolean)=>setMemory(value=>({...value,dirty})),[setMemory]);
  const [pending, setPending] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [error, setError] = useState<Error | null>(null);
  const [readError, setReadError] = useState<Error | null>(null);
  const needsRefresh=memory.needsRefresh;
  const setNeedsRefresh=useCallback((needsRefresh:boolean)=>setMemory(value=>({...value,needsRefresh})),[setMemory]);
  const [refreshed, setRefreshed] = useState(false);
  const [unavailable, setUnavailable] = useState(() => Boolean(issue && client.getQueryData(keys.issue(issue.id)) === null));
  useEffect(() => {
    if (!dirty && !pending && issue && (!baseline || issue.version > baseline.version)) setBaseline(issue);
  }, [issue, baseline, dirty, pending,setBaseline]);
  const changed = Boolean(issue && baseline && (issue.version > baseline.version || (issue.version === baseline.version && issue.status !== baseline.status)));
  const begin = () => {
    if (busyRef.current) return false;
    busyRef.current = true; setPending(true); onPendingChange?.(true);
    return true;
  };
  const finish = () => { busyRef.current = false; setPending(false); onPendingChange?.(false); };
  const read = async () => {
    if (!issue) throw new Error("问题不存在");
    setNeedsRefresh(true); setReadError(null);
    try {
      const latest = await readResourceFresh<Issue>(client, keys.issue(issue.id), signal => issuesApi.issuesById<Issue>(issue.id, { signal }), () => mounted.current);
      if (!mounted.current) return latest;
      setBaseline(latest); setNeedsRefresh(false); setRefreshed(true); setUnavailable(false);
      return latest;
    } catch (caught) {
      const invalidated = caught instanceof ResourceReadInvalidatedError;
      const failure = invalidated
        ? new Error("问题访问状态已变更，请重新读取。")
        : caught instanceof Error ? caught : new Error("读取失败");
      if (!mounted.current) throw failure;
      setReadError(failure);
      if (invalidated) setUnavailable(true);
      if (failure instanceof ApiError && [401, 403, 404].includes(failure.status)) {
        setUnavailable(true);
        client.setQueryData(keys.issue(issue.id), null);
      }
      throw failure;
    }
  };
  const reload = async () => {
    if (!begin()) return;
    try { await read(); } catch { /* 错误显示在原表单，草稿不清空。 */ } finally { finish(); }
  };
  const save = async (
    operation: () => Promise<Issue>,
    onSaved: (saved: Issue) => void,
    reconcile?: {
      matches: (latest: Issue) => boolean;
      onReconciled: () => void;
      read?: () => Promise<Issue | undefined>;
      when?: (error: Error) => boolean;
    },
  ) => {
    if (!begin()) return;
    setError(null); setReadError(null);
    try {
      const saved = await operation();
      cacheResourceUpdate(client, keys.issue(saved.id), saved);
      setBaseline(saved); setDirty(false); setRefreshed(false);
      invalidateIssueViews(client, saved.id);
      clearMemory();onSaved(saved);
    } catch (caught) {
      const failure = caught instanceof Error ? caught : new Error("保存失败");
      setError(failure);
      if (requiresWriteRecheck(failure)) {
        setNeedsRefresh(true);
        invalidateIssueViews(client, issue?.id);
        if (reconcile && (!reconcile.when || reconcile.when(failure))) try {
          const latest = reconcile.read ? await reconcile.read() : issue ? await read() : undefined;
          if (latest && reconcile.matches(latest) && mounted.current) {
            cacheResourceUpdate(client, keys.issue(latest.id), latest);
            setBaseline(latest); setNeedsRefresh(false);
            setError(null); setDirty(false); setRefreshed(false);
            reconcile.onReconciled();
            clearMemory();onSaved(latest);
          }
        } catch { /* 保留原输入，等待用户重新读取。 */ }
      }
    } finally { finish(); }
  };
  return { discard:clearMemory, baseline, dirty, setDirty, pending, changed, needsRefresh, refreshed, unavailable, canReload: Boolean(issue), error, readError, reload, save };
}

export function DraftNotice({ editor, warning }: { editor: ReturnType<typeof useIssueDraft>; warning?: string | null }) {
  const message = warning || (editor.changed || editor.needsRefresh
    ? editor.canReload ? "问题已更新，请重新读取并核对；已保留你的输入。" : "创建结果暂时无法确认，请关闭窗口并核对问题列表；确认未创建后再重新提交。"
    : editor.error?.message);
  return <>
    {message && <p className="form-error field-full" role="alert">{message}</p>}
    {(message || editor.refreshed) && editor.baseline && <div className="field-full">
      {editor.refreshed && <p className="field-help">已读取最新问题，输入保持不变；请核对后再次保存。</p>}
      <p className="field-help">当前核对记录：{editor.baseline.title} · {issueStatusLabels[editor.baseline.status as keyof typeof issueStatusLabels]} · {editor.baseline.progress}% · 负责人 {editor.baseline.ownerName || "未分配"} · 目标 {editor.baseline.dueDate || "未设置"}</p>
      <details className="field-help"><summary>查看当前问题信息</summary><p>影响：{editor.baseline.impact || "未填写"}</p><p>关联：{editor.baseline.requirementTitle || editor.baseline.sourceRef || "公共问题"} · 优先级 {editor.baseline.priority}</p><p>提出人：{editor.baseline.reporter || "未指定"} · 发现日期 {editor.baseline.discoveredAt}</p></details>
    </div>}
    {editor.readError && <p className="form-error field-full" role="alert">{editor.readError.message}</p>}
    {editor.canReload && (editor.changed || editor.needsRefresh) && <div className="field-full"><Button variant="secondary" type="button" className="ghost-button" disabled={editor.pending} onClick={() => void editor.reload()}>重新读取问题</Button></div>}
  </>;
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value);
  const pinned = options.filter((option) => pinnedValues.includes(option.value));
  const matched = rankSearchItems(
    options.filter((option) => !pinnedValues.includes(option.value)),
    query,
    (option) => [{ text: option.label, weight: 100 }, { text: option.description, weight: 20 }],
  );
  const visibleOptions = [...pinned];
  if (selected && !visibleOptions.some((option) => option.value === selected.value)) visibleOptions.push(selected);
  for (const option of matched) {
    if (visibleOptions.length >= 20) break;
    if (!visibleOptions.some((current) => current.value === option.value)) visibleOptions.push(option);
  }

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    setQuery("");
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  return <FieldShell label={label} help={helper} className="issue-search-select-field" asLabel={false}>
    <div className={`issue-search-select${open ? " is-open" : ""}`}>
      <input type="hidden" name={name} value={value} readOnly />
      <button ref={triggerRef} type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}：${selected?.label || value || placeholder}`} onClick={() => { setOpen((current) => !current); setQuery(""); }}>
        <span className={!selected && !value ? "is-placeholder" : ""}>{selected?.label || value || placeholder}</span><ChevronDown size={15} />
      </button>
      <AnchoredPopover anchorRef={triggerRef} open={open} onOutside={() => close()} onEscape={() => close(true)} width={360} matchAnchor role="presentation" className="issue-search-select-menu">
        <label><Search size={14} /><input autoFocus value={query} placeholder={searchPlaceholder || `搜索${label}`} onChange={(event) => setQuery(event.target.value)} /></label>
        <div role="listbox" aria-label={label}>
          {visibleOptions.map((option) => <button type="button" role="option" aria-selected={option.value === value} key={option.value || "__empty"} onClick={() => { onChange(option.value); close(true); }}>
            <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>{option.value === value && <Check size={15} />}
          </button>)}
          {!visibleOptions.length && <p>没有匹配选项</p>}
        </div>
      </AnchoredPopover>
    </div>
  </FieldShell>;
}


function issueFields(issue: Issue | undefined, reporter: string | null | undefined, today: string) {
  return {
    title: issue?.title || "", impact: issue?.impact || "", requirementId: issue?.requirementId || "",
    sourceRef: issue?.sourceRef || "", priority: issue?.priority || "P2", ownerId: issue?.ownerId || "",
    reporter: issue ? issue.reporter || "" : reporter || "", discoveredAt: issue?.discoveredAt || today,
    nextReviewAt:issue?.nextReviewAt||"", resolvedAt:issue?.resolvedAt||"", reason:"",
    dueDate: issue?.status === "deferred" ? "" : issue?.dueDate || "",
  };
}

export function IssueForm({ issue, projectId, people, requirements, canManage, defaultReporter, autoFocusTitle = true, onClose, onPendingChange, busy = false }: {
  issue?: Issue; projectId: string; people: Person[]; requirements: Requirement[]; canManage: boolean;
  defaultReporter?: string | null; autoFocusTitle?: boolean; onClose: () => void; onPendingChange?: BusyChange; busy?: boolean;
}) {
  const toast = useToast();
  const { session } = useSession();
  const { businessDate: today } = useBusinessDate();
  const editor = useIssueDraft(issue, onPendingChange,'basic',projectId);
  const [draft,setDraft,clearDraft]=useDeliveryForm(projectId,(issue?.id||'new')+':issue-basic',()=>issueFields(issue,defaultReporter,today));
  const [discoveredDateEdited, setDiscoveredDateEdited] = useState(false);
  useEffect(() => {
    if (!editor.dirty && editor.baseline) setDraft(issueFields(editor.baseline, defaultReporter, today));
  }, [editor.baseline, editor.dirty, defaultReporter, today,setDraft]);
  useEffect(() => {
    if (issue || discoveredDateEdited) return;
    setDraft((current) => current.discoveredAt === today ? current : { ...current, discoveredAt: today });
  }, [discoveredDateEdited, issue, today,setDraft]);
  const change = (field: keyof typeof draft, value: string) => {
    if (field === "discoveredAt") setDiscoveredDateEdited(true);
    editor.setDirty(true); setDraft((current) => ({ ...current, [field]: value }));
  };
  const current = editor.baseline || issue;
  const resolved = issue?.status === "resolved" || current?.status === "resolved";
  const deferred = current?.status === "deferred";
  const requirementOptions: SearchSelectOption[] = [{ value: "", label: "公共问题", description: "不绑定具体需求" }, ...requirements.map((value) => ({ value: value.id, label: value.title }))];
  const reporterOptions: SearchSelectOption[] = [{ value: "", label: "未指定" }, ...people.map((value) => ({ value: value.name, label: value.name }))];
  if (draft.reporter && !reporterOptions.some((value) => value.value === draft.reporter)) reporterOptions.push({ value: draft.reporter, label: draft.reporter, description: current?.reporter === draft.reporter ? "历史记录" : "当前登录账号" });
  const ownerOptions: SearchSelectOption[] = [{ value: "", label: "未分配" }, ...people.filter((person) => (resolved || person.active) && person.projectRole !== "viewer").map((person) => ({ value: person.id, label: person.name }))];
  if (draft.ownerId && !ownerOptions.some((value) => value.value === draft.ownerId)) ownerOptions.push({ value: draft.ownerId, label: current?.ownerId === draft.ownerId ? current.ownerName || "历史负责人" : draft.ownerId, description: "历史负责人" });
  const blocked = !!issue&&!canManage || editor.changed || editor.needsRefresh;
  return <form className="issue-form" onSubmit={(event) => {
    event.preventDefault();
    if (blocked || busy) return;
    const attemptedAt = new Date().toISOString();
    const payload = { ...draft, resolvedAt: resolved ? draft.resolvedAt : undefined, reason: current ? draft.reason : undefined, dueDate: deferred ? null : draft.dueDate || null,
      ownerId: canManage ? draft.ownerId || null : null,
      ...(current ? { expectedVersion: current.version } : { projectId }),
    };
    void editor.save(
      () => (current ? issuesApi.issuesById<Issue>(current.id, { method: current ? "PATCH" : "POST", body: jsonBody(payload) }) : issuesApi.issues<Issue>({ method: current ? "PATCH" : "POST", body: jsonBody(payload) })),
      ()=>{clearDraft();onClose();},
      current ? {
        matches: (latest) => latest.version === current.version + 1
          && latest.status === current.status
          && (!resolved || (latest.updates || []).some(update => update.eventType === 'correction'
            && !(current.updates || []).some(previous => previous.id === update.id)
            && update.createdByAccountId === session.accountId
            && update.createdAt === latest.updatedAt
            && (!canonicalizeContent(draft.reason) || update.content === canonicalizeContent(draft.reason))))
          && latest.title === canonicalizeLabel(draft.title)
          && latest.impact === (canonicalizeContent(draft.impact) || null)
          && latest.requirementId === (draft.requirementId || null)
          && latest.sourceRef === (canonicalizeLabel(draft.sourceRef) || null)
          && latest.priority === draft.priority
          && latest.ownerId === (draft.ownerId || null)
          && latest.reporter === (canonicalizeLabel(draft.reporter) || null)
          && latest.discoveredAt === draft.discoveredAt
          && (!resolved || latest.resolvedAt === draft.resolvedAt)
          && latest.nextReviewAt === (draft.nextReviewAt || null)
          && latest.dueDate === (deferred ? null : draft.dueDate || null),
        onReconciled: () => toast.success("已核对最新状态：问题信息已保存"),
      } : {
        when: isWriteOutcomeUnknown,
        read: async () => {
          const params = new URLSearchParams({
            projectId,
            q: canonicalizeLabel(draft.title),
            status: "in_progress",
            pageSize: "100",
          });
          const latest = await issuesApi.issuesQuery<IssuePage>(params, { readOnly: true });
          const matches = latest.items.filter((item) => item.createdAt >= attemptedAt
            && item.projectId === projectId
            && item.status === "in_progress"
            && item.progress === 0
            && item.title === canonicalizeLabel(draft.title)
            && item.impact === (canonicalizeContent(draft.impact) || null)
            && item.requirementId === (draft.requirementId || null)
            && item.sourceRef === (canonicalizeLabel(draft.sourceRef) || null)
            && item.priority === draft.priority
            && item.ownerId === (canManage ? draft.ownerId || null : null)
            && item.reporter === (canonicalizeLabel(draft.reporter) || null)
            && item.discoveredAt === draft.discoveredAt
            && item.nextReviewAt === (draft.nextReviewAt || null)
            && item.dueDate === (draft.dueDate || null));
          return matches.length === 1 ? matches[0] : undefined;
        },
        matches: () => true,
        onReconciled: () => toast.success("已核对最新状态：问题已创建"),
      },
    );
  }}>
    <fieldset className="form-grid form-fieldset" disabled={editor.pending || busy}>
      <FieldShell label="问题标题" full><input name="title" required autoFocus={autoFocusTitle} value={draft.title} onChange={(event) => change("title", event.target.value)} placeholder="用一句话说明要跟踪的问题" /></FieldShell>
      <FieldShell label="问题影响" full><textarea name="impact" rows={3} value={draft.impact} onChange={(event) => change("impact", event.target.value)} placeholder="可选：说明影响范围、风险或被阻塞的工作" /></FieldShell>
      {!canManage && <p className="issue-contributor-note field-full">提交后问题直接进入“处理中”，由项目经理分配负责人并确认关闭。</p>}
      <SearchSelectField label="关联需求" name="requirementId" value={draft.requirementId} options={requirementOptions} onChange={(value) => change("requirementId", value)} pinnedValues={[""]} searchPlaceholder="搜索需求编号或名称" helper="默认展示最多20项，输入关键字可快速筛选" />
      <FieldShell label="范围标识"><input name="sourceRef" value={draft.sourceRef} onChange={(event) => change("sourceRef", event.target.value)} placeholder="可选，如 DCIM-36" /></FieldShell>
      {issue && <FieldShell label="当前状态" help="在详情顶部点击状态可挂起、解决或重开" className="issue-readonly-field" asLabel={false}><StatusBadge kind="issue" value={issue.status} /></FieldShell>}
      <FieldShell label="优先级"><select name="priority" value={draft.priority} onChange={(event) => change("priority", event.target.value)}>{priorityOptions.map(({ value, label }) => <option value={value} key={value}>{label}</option>)}</select></FieldShell>
      {canManage && <SearchSelectField label="负责人" name="ownerId" value={draft.ownerId} options={ownerOptions} onChange={(value) => change("ownerId", value)} pinnedValues={[""]} searchPlaceholder="搜索负责人姓名" />}
      <SearchSelectField label="提出人" name="reporter" value={draft.reporter} options={reporterOptions} onChange={(value) => change("reporter", value)} pinnedValues={[""]} searchPlaceholder="搜索项目成员" helper={current?.reporter && !people.some((person) => person.name === current.reporter) ? "当前值为历史自由文本，重新选择后将使用项目成员姓名" : undefined} />
      <FieldShell label="发现日期"><input name="discoveredAt" type="date" required value={draft.discoveredAt} onChange={(event) => change("discoveredAt", event.target.value)} /></FieldShell>
      <FieldShell label="下次核对日期" help="用于跟进提醒，与解决目标日期分开"><input name="nextReviewAt" type="date" value={draft.nextReviewAt} onChange={event=>change("nextReviewAt",event.target.value)}/></FieldShell>
      <FieldShell label="目标日期" help={deferred ? "挂起问题不设置目标日期" : undefined}><input name="dueDate" type="date" value={deferred ? "" : draft.dueDate} disabled={deferred} onChange={(event) => change("dueDate", event.target.value)} /></FieldShell>
      {resolved&&<><FieldShell label="解决日期"><input aria-label="解决日期" name="resolvedAt" type="date" required min={draft.discoveredAt} max={today} value={draft.resolvedAt} onChange={event=>change('resolvedAt',event.target.value)}/></FieldShell><FieldShell label="修改说明" full><textarea aria-label="修改说明" rows={2} value={draft.reason} onChange={event=>change('reason',event.target.value)}/></FieldShell><p className="field-help field-full">修改资料保留已解决状态，并记录修改前后的内容。</p></>}
      <DraftNotice editor={editor} />
      <div className="form-actions field-full"><Button variant="secondary" type="button" className="ghost-button" onClick={()=>{clearDraft();if(!editor.needsRefresh)editor.discard();onClose();}}>取消</Button><Button busy={(editor.pending)} aria-label={editor.pending ? "保存中…" : issue ? "保存修改" : "创建问题"} variant="primary" type="submit" className="primary-button" disabled={blocked}>{issue ? "保存修改" : "创建问题"}</Button></div>
    </fieldset>
  </form>;
}

export function IssueUpdateForm({ issue, canSetProgress, canResolve = false, onPendingChange, busy = false }: {
  issue: Issue; canSetProgress: (value: Issue) => boolean; canResolve?: boolean; onPendingChange?: BusyChange; busy?: boolean;
}) {
  const toast = useToast();
  const { session } = useSession();
  const editor = useIssueDraft(issue, onPendingChange,'progress');
  const [input,setInput,clearInput]=useDeliveryForm(issue.projectId,issue.id+':issue-progress',()=>({progress:issue.progress,content:''}));
  const {progress,content}=input;
  const setProgress=useCallback((progress:number)=>setInput(value=>({...value,progress})),[setInput]);
  const setContent=(content:string)=>setInput(value=>({...value,content}));
  const baseline = editor.baseline || issue;
  useEffect(() => { if (!editor.dirty) setProgress(baseline.progress); }, [baseline.progress, editor.dirty,setProgress]);
  const writesProgress = canSetProgress(baseline);
  const resolved = issue.status === "resolved" || baseline.status === "resolved";
  const decreasing = writesProgress && progress < Math.max(issue.progress, baseline.progress);
  const resolving = writesProgress && progress === 100;
  const permissionChanged = writesProgress !== canSetProgress(issue);
  const warning = resolved ? "问题已解决，不能追加进展；已保留本次输入。"
    : decreasing && !canResolve ? "降低完成度需要项目经理更正。已保留本次输入。"
    : resolving && !canResolve ? "解决问题需要项目经理权限。已保留本次输入。" : null;
  if (resolved && !editor.dirty) return <p className="issue-settings-resolved-note"><CheckCircle2 size={17} />问题已闭环并锁定。如需继续处理，请先执行“重开”。</p>;
  const blocked = Boolean(warning || editor.changed || editor.needsRefresh || permissionChanged);
  return <form className="issue-update-form" onSubmit={(event) => {
    event.preventDefault();
    if (blocked || busy) return;
    const action = resolving ? 'resolve' : decreasing ? 'correct' : 'updates';
    const input = resolving ? {content, expectedVersion: baseline.version}
      : decreasing ? {progress, reason: content, expectedVersion: baseline.version}
      : writesProgress ? { content, progress, expectedVersion: baseline.version } : { content };
    const initialUpdateIds = new Set((baseline.updates || []).map(update => update.id));
    void editor.save(
      () => issuesApi.issuesById2<Issue>(issue.id, action, { method: "POST", body: jsonBody(input) }),
      (saved) => { setContent(""); setProgress(saved.progress); clearInput(); },
      {
        matches: (latest) => (!writesProgress || latest.version === baseline.version + 1 && latest.progress === progress)
          && (!resolving || latest.status === 'resolved')
          && Boolean(latest.updates?.some((update) => !initialUpdateIds.has(update.id)
          && (decreasing && !canonicalizeContent(content) || update.content === (canonicalizeContent(content) || (resolving ? '问题已解决' : writesProgress ? `完成度：${baseline.progress}% → ${progress}%` : "")))
          && update.eventType === (resolving ? 'resolve' : decreasing ? 'correction' : writesProgress ? "progress" : "note")
          && update.createdByAccountId === session.accountId
          && (writesProgress ? update.progress === progress : update.progress === null))),
        onReconciled: () => toast.success("已核对最新状态：问题进展已记录"),
      },
    );
  }}>
    <fieldset className="form-fieldset issue-update-fields" disabled={editor.pending || busy}>
      {writesProgress && <ProgressInput value={progress} onChange={(value) => { editor.setDirty(true); setProgress(value); }} max={canResolve ? 100 : 99} presets={[20, 50, 80, 100]} label="本次进度（更新后）" />}
      <p className="field-help issue-progress-result" role="status">{!writesProgress ? '本次仅记录说明，不修改完成度。' : resolving ? '保存后将问题标记为已解决，记录解决日期和本次说明。' : decreasing && canResolve && !resolved ? '本次将更正完成度，并新增更正记录，原历史保留。' : !canResolve ? '可更新至 99%；由项目经理确认解决。' : '保存后将记录当前进度和本次说明。'}</p>
      <textarea name="content" aria-label="本次进展说明" rows={3} required={!writesProgress} value={content} onChange={(event) => { editor.setDirty(true); setContent(event.target.value); }} placeholder={writesProgress ? "说明（可选）" : "记录新进展、决策或待办结果"} />
      <DraftNotice editor={editor} warning={warning} />
      <div className="issue-update-actions"><Button busy={(editor.pending)} aria-label={editor.pending ? "提交中…" : resolving ? "保存并解决" : decreasing && canResolve && !resolved ? "保存更正" : "追加进展"} variant="primary" type="submit" className="primary-button" disabled={blocked}>{resolving ? "保存并解决" : decreasing && canResolve && !resolved ? "保存更正" : "追加进展"}</Button></div>
    </fieldset>
  </form>;
}
