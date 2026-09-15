import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { api, jsonBody } from "../api";
import { useBusinessDate, useSession } from "../app-context";
import type { Issue } from "../types";
import { issueStatusLabels } from "../../shared/domain";
import { canonicalizeContent, canonicalizeLabel } from "../../shared/search";
import { AnchoredPopover } from "./InlineEdit";
import { DraftNotice, useIssueDraft } from "./IssueForms";
import { useToast } from "./Toast";

const issueStateChoices: Record<string, Array<{ action: string; label: string; target: string; prompt: string; result: string }>> = {
  in_progress: [
    { action: "defer", label: "挂起", target: "deferred", prompt: "说明挂起原因", result: "问题已挂起" },
    { action: "resolve", label: "确认解决", target: "resolved", prompt: "填写闭环说明", result: "问题已解决" },
  ],
  deferred: [{ action: "resume", label: "恢复处理", target: "in_progress", prompt: "说明恢复原因", result: "问题已恢复处理" }],
  resolved: [{ action: "reopen", label: "重新打开", target: "in_progress", prompt: "说明重开原因", result: "问题已重新打开" }],
};

function IssueStatusEditor({ issue, disabled, onPendingChange, onSaved }: {
  issue: Issue; disabled: boolean; onPendingChange: (pending: boolean) => void; onSaved: () => void;
}) {
  const toast = useToast();
  const { session } = useSession();
  const editor = useIssueDraft(issue, onPendingChange);
  const [selected, setSelected] = useState<(typeof issueStateChoices)[string][number] | null>(null);
  const [note, setNote] = useState("");
  const current = editor.baseline || issue;
  const choices = issueStateChoices[current.status] || [];
  const invalidAction = selected && !choices.some((choice) => choice.action === selected.action);
  const warning = invalidAction ? `当前状态不支持“${selected.label}”，请重新选择操作并核对说明。` : null;
  const busy = disabled || editor.pending;
  const submit = (selected: (typeof issueStateChoices)[string][number]) => {
    if (busy || editor.changed || editor.needsRefresh || editor.unavailable) return;
    editor.setDirty(true); setSelected(selected);
    const payload = { expectedVersion: current.version, ...(selected.action === "resolve" ? { content: note.trim() } : { reason: note.trim() }) };
    const expected = selected;
    const expectedContent = canonicalizeContent(note) || ({defer:"挂起问题",resume:"恢复处理",resolve:"问题已解决",reopen:"重新打开问题"}[selected.action]);
    const baselineUpdateIds = new Set((current.updates || []).map((update) => update.id));
    void editor.save(
      () => api<Issue>(`/api/issues/${current.id}/${expected.action}`, { method: "POST", body: jsonBody(payload) }),
      onSaved,
      {
        matches: (latest) => latest.status === expected.target
          && latest.version === current.version + 1
          && Boolean(latest.updates?.some((update) => !baselineUpdateIds.has(update.id)
            && update.eventType === expected.action && update.content === expectedContent
            && update.createdByAccountId === session.accountId && update.createdAt === latest.updatedAt)),
        onReconciled: () => toast.success(`已核对最新状态：${expected.result}`),
      },
    );
  };
  if (editor.unavailable) return <div className="issue-status-notice">
    <p className="form-error" role="alert">{editor.readError?.message || "暂时无法访问问题，请重新读取。"}</p>
    <button type="button" className="ghost-button" disabled={busy} onClick={() => void editor.reload()}>重新读取问题</button>
  </div>;
  return <>
    <header><strong>变更问题状态</strong><small>当前：{issueStatusLabels[current.status as keyof typeof issueStatusLabels]}</small></header>
    <div className="issue-status-choice-list">
      {choices.map((choice) => <button type="button" key={choice.action} disabled={busy || editor.changed || editor.needsRefresh} className={selected?.action === choice.action ? "is-selected" : ""} onClick={() => submit(choice)}><span className={`issue-status issue-status-${choice.target}`}>{issueStatusLabels[choice.target as keyof typeof issueStatusLabels]}</span><span>{choice.label}</span></button>)}
    </div>
    <details className="issue-status-note"><summary>补充说明（可选）</summary>
      <label><span>说明</span><textarea autoFocus rows={3} disabled={busy} value={note} onChange={(event) => { editor.setDirty(true); setNote(event.target.value); }} /></label>
    </details>
    <div className="issue-status-notice"><DraftNotice editor={editor} warning={warning} /></div>
  </>;
}

export function IssueStatusControl({ issue, canManage, compact = false, disabled = false, onPendingChange }: {
  issue: Issue; canManage: boolean; compact?: boolean; disabled?: boolean; onPendingChange?: (pending: boolean) => void;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const close = () => { if (!pending) setOpen(false); };
  const badge = <span className={`issue-status issue-status-${issue.status}`}>{issueStatusLabels[issue.status as keyof typeof issueStatusLabels] || issue.status}</span>;
  if (!canManage) return badge;
  return <div className={`issue-status-control${compact ? " is-compact" : ""}`} onClick={(event) => event.stopPropagation()}>
    <button ref={anchorRef} type="button" disabled={disabled || pending} className="issue-status-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{badge}<ChevronDown size={13} /></button>
    <AnchoredPopover anchorRef={anchorRef} open={open} onOutside={close} width={340} className="issue-status-popover">
      {open && <IssueStatusEditor issue={issue} disabled={disabled} onPendingChange={(value) => { setPending(value); onPendingChange?.(value); }} onSaved={() => setOpen(false)} />}
    </AnchoredPopover>
  </div>;
}

const correctionEventLabels: Record<string, string> = {
  note: "说明", progress: "进度", start: "开始", defer: "挂起", resume: "恢复",
  resolve: "解决", reopen: "重开", correction: "纠错", migration: "迁移",
};

export function IssueFactForm({ issue, disabled, onPendingChange, onSaved, onCancel }: {
  issue: Issue;
  disabled: boolean;
  onPendingChange: (pending: boolean) => void;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const { businessDate: today } = useBusinessDate();
  const { session } = useSession();
  const editor = useIssueDraft(issue, onPendingChange);
  const current = editor.baseline || issue;
  const [title, setTitle] = useState(issue.title);
  const [impact, setImpact] = useState(issue.impact || "");
  const [progress, setProgress] = useState(String(issue.progress));
  const [resolvedAt, setResolvedAt] = useState(issue.resolvedAt || "");
  const [supersedesId, setSupersedesId] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (editor.dirty) return;
    setTitle(current.title); setImpact(current.impact || ''); setProgress(String(current.progress)); setResolvedAt(current.resolvedAt || '');
  }, [current, editor.dirty]);
  const reconciled = useRef(false);
  const numericProgress = Number(progress);
  const resolved = current.status === "resolved";
  const normalizedTitle = canonicalizeLabel(title);
  const normalizedImpact = canonicalizeContent(impact) || null;
  const correctedProgress = resolved ? 100 : numericProgress;
  const correctedResolvedAt = resolved ? resolvedAt : null;
  const factsChanged = normalizedTitle !== current.title || normalizedImpact !== current.impact
    || correctedProgress !== current.progress || correctedResolvedAt !== current.resolvedAt;
  const validation = !canonicalizeLabel(title) ? "问题标题不能为空。"
    : !resolved && (!Number.isInteger(numericProgress) || numericProgress < 0 || numericProgress > 99) ? "处理中或挂起问题的完成度必须是 0–99 的整数。"
    : resolved && !resolvedAt ? "请选择解决日期。"
    : resolved && resolvedAt < current.discoveredAt ? `解决日期不能早于发现日期（${current.discoveredAt}）。`
    : resolved && resolvedAt > today ? "解决日期不能晚于今天。"
    : !factsChanged && !supersedesId ? "请至少修改一项问题信息，或关联一条需要更正的历史记录。" : "";
  const busy = disabled || editor.pending;
  const blocked = busy || editor.changed || editor.needsRefresh || editor.unavailable || Boolean(validation);
  const updates = current.updates || [];
  const submit = () => {
    if (blocked) return;
    const expectedTitle = normalizedTitle;
    const expectedImpact = normalizedImpact;
    const expectedProgress = correctedProgress;
    const expectedResolvedAt = correctedResolvedAt;
    const expectedReason = canonicalizeContent(reason);
    const expectedSupersedesId = supersedesId || null;
    reconciled.current = false;
    void editor.save(
      () => api<Issue>(`/api/issues/${current.id}/correct`, {
        method: "POST",
        body: jsonBody({
          expectedVersion: current.version,
          title,
          impact: impact || null,
          progress: expectedProgress,
          resolvedAt: expectedResolvedAt,
          supersedesId: expectedSupersedesId,
          reason: reason.trim(),
        }),
      }),
      () => {
        toast.success(reconciled.current ? "已核对最新状态：问题纠错已记录" : "问题纠错已记录");
        onSaved();
      },
      {
        matches: (latest) => latest.version === current.version + 1
          && latest.status === current.status
          && latest.title === expectedTitle
          && latest.impact === expectedImpact
          && latest.progress === expectedProgress
          && latest.resolvedAt === expectedResolvedAt
          && Boolean(latest.updates?.some((update) => update.eventType === "correction"
            && (!expectedReason || update.content === expectedReason) && (update.supersedesId || null) === expectedSupersedesId
            && update.createdByAccountId === session.accountId && update.createdAt === latest.updatedAt)),
        onReconciled: () => { reconciled.current = true; },
      },
    );
  };
  if (editor.unavailable) return <div className="issue-status-notice">
    <p className="form-error" role="alert">{editor.readError?.message || "暂时无法访问问题，请重新读取。"}</p>
    <button type="button" className="ghost-button" disabled={busy} onClick={() => void editor.reload()}>重新读取问题</button>
  </div>;
  return <form className="inline-action-form issue-correction-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
    <p>已解决问题可修正标题、影响和解决日期。修改会追加更正记录，原历史保留。</p>
    <label><span>问题标题</span><input aria-label="问题标题" disabled={busy} value={title} onChange={(event) => { editor.setDirty(true); setTitle(event.target.value); }} /></label>
    <label><span>问题影响</span><textarea aria-label="问题影响" disabled={busy} rows={2} value={impact} onChange={(event) => { editor.setDirty(true); setImpact(event.target.value); }} /></label>
    {resolved
      ? <label><span>解决日期</span><input aria-label="解决日期" type="date" disabled={busy} min={current.discoveredAt} max={today} value={resolvedAt} onChange={(event) => { editor.setDirty(true); setResolvedAt(event.target.value); }} /></label>
      : <label><span>当前完成度</span><input aria-label="纠错后的问题完成度" type="number" min={0} max={99} step={1} disabled={busy} value={progress} onChange={(event) => { editor.setDirty(true); setProgress(event.target.value); }} /></label>}
    {!!updates.length && <label><span>关联历史记录（可选）</span><select aria-label="关联历史记录" disabled={busy} value={supersedesId} onChange={(event) => { editor.setDirty(true); setSupersedesId(event.target.value); }}><option value="">不指定</option>{updates.map((update) => <option value={update.id} key={update.id}>{new Date(update.createdAt).toLocaleDateString("zh-CN")} · {correctionEventLabels[update.eventType] || update.eventType} · {update.content.slice(0, 28)}</option>)}</select></label>}
    <label><span>修改说明（可选）</span><textarea aria-label="修改说明" disabled={busy} rows={2} value={reason} onChange={(event) => { editor.setDirty(true); setReason(event.target.value); }} placeholder="说明修改原因" /></label>
    {validation && editor.dirty && <p className="form-error" role="alert">{validation}</p>}
    <div className="issue-status-notice"><DraftNotice editor={editor} /></div>
    <footer><button type="button" className="ghost-button" disabled={busy} onClick={onCancel}>取消</button><button className="primary-button" disabled={blocked}>{editor.pending ? "保存中…" : "保存修改"}</button></footer>
  </form>;
}
