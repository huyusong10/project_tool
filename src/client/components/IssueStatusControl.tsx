import * as issuesApi from '../features/issues/api';
import { useDeliveryForm } from '../use-delivery-form';
import { Button } from './Button';
import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { jsonBody } from "../api";
import { useSession } from "../app-context";
import type { Issue } from "../types";
import { issueStatusLabels } from "../../shared/domain";
import { canonicalizeContent } from "../../shared/search";
import { AnchoredPopover } from './inline-edit/popover';
import { DraftNotice, useIssueDraft } from "./IssueForms";
import { useToast } from "./Toast";

const issueStateChoices: Record<string, Array<{ action: string; label: string; target: string; prompt: string; result: string }>> = {
  in_progress: [
    { action: "defer", label: "挂起", target: "deferred", prompt: "说明挂起原因", result: "问题已挂起" },
    { action: "resolve", label: "确认解决", target: "resolved", prompt: "填写解决说明", result: "问题已解决" },
  ],
  deferred: [{ action: "resume", label: "恢复处理", target: "in_progress", prompt: "说明恢复原因", result: "问题已恢复处理" }],
  resolved: [{ action: "reopen", label: "重新打开", target: "in_progress", prompt: "填写重新打开的原因", result: "问题已重新打开" }],
};

function IssueStatusEditor({ issue, disabled, onPendingChange, onSaved }: {
  issue: Issue; disabled: boolean; onPendingChange: (pending: boolean) => void; onSaved: () => void;
}) {
  const toast = useToast();
  const { session } = useSession();
  const editor = useIssueDraft(issue, onPendingChange,'status');
  const [selected, setSelected,clearSelected] = useDeliveryForm<(typeof issueStateChoices)[string][number] | null>(issue.projectId,issue.id+':issue-status-choice',()=>null);
  const [note, setNote,clearNote] = useDeliveryForm(issue.projectId,issue.id+':issue-status-note',()=>"");
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
      () => issuesApi.issuesById2<Issue>(current.id, expected.action, { method: "POST", body: jsonBody(payload) }),
      ()=>{clearSelected();clearNote();onSaved();},
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
    <Button variant="secondary" type="button" className="ghost-button" disabled={busy} onClick={() => void editor.reload()}>重新读取问题</Button>
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
