
import { Button } from "../Button";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { type Revision, type BaseProps, type EditReason, useSaveState, useRevisionGuard, focusTrigger, canReturnFocus, EditableCell, EditorError, RevisionNotice } from './shared';
import { AnchoredPopover } from './popover';

export function InlineTextCell<TRevision extends Revision = number>({
  value,
  onSave,
  label,
  className = "",
  disabled = false,
  required = false,
  placeholder = "点击编辑",
  displayMode = "single",
  revision,
  revisionSubject = "记录",
  onReloadRevision,
  renderValue,
  reason,
}: BaseProps<TRevision> & {
  value: string | null | undefined;
  onSave: (value: string, expectedRevision?: TRevision, reason?: string) => Promise<unknown>;
  required?: boolean;
  reason?: EditReason;
  renderValue?: (value: string) => ReactNode;
}) {
  const currentValue = value || "";
  const anchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const committing = useRef(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(currentValue);
  const [reasonText, setReasonText] = useState("");
  const feedback = useSaveState();
  const revisionGuard = useRevisionGuard({ revision, subject: revisionSubject, onReload: onReloadRevision, feedback });

  useEffect(() => { if (!open && feedback.state !== "saving" && feedback.state !== "error") setDraft(currentValue); }, [currentValue, feedback.state, open]);
  useEffect(() => { if (open) window.requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); }); }, [open]);

  const cancel = useCallback(() => {
    if (!committing.current) {
      setDraft(currentValue);
      setReasonText("");
      feedback.clearError();
    }
    setOpen(false);
    focusTrigger(anchorRef);
  }, [currentValue, feedback]);

  const commit = useCallback(async (closeBeforeSave = false, refocus = false) => {
    if (committing.current) return;
    const next = draft.trim();
    if (required && !next) {
      feedback.fail(`${label}不能为空`);
      if (closeBeforeSave && !refocus) setOpen(false);
      return;
    }
    if (!revisionGuard.ensureCurrent()) return;
    if (next === currentValue) {
      setOpen(false);
      setReasonText("");
      if (refocus) focusTrigger(anchorRef);
      return;
    }
    const normalizedReason = reasonText.trim();
    if (reason?.required && !normalizedReason) {
      feedback.fail(`${reason.label || "变更原因"}不能为空`);
      if (closeBeforeSave && !refocus) setOpen(false);
      else reasonRef.current?.focus();
      return;
    }
    if (closeBeforeSave) setOpen(false);
    committing.current = true;
    const saved = await feedback.save(() => onSave(next, revisionGuard.baselineRevision, normalizedReason || undefined));
    committing.current = false;
    if (saved) {
      setOpen(false);
      setReasonText("");
      if (refocus) focusTrigger(anchorRef);
    } else if (closeBeforeSave && canReturnFocus(anchorRef)) setOpen(true);
  }, [currentValue, draft, feedback, label, onSave, required, reason, reasonText, revisionGuard]);

  const display = renderValue ? renderValue(currentValue) : currentValue || <span className="is-placeholder">{placeholder}</span>;
  return <div ref={anchorRef} className="inline-edit-anchor">
    <EditableCell label={label} display={display} fullText={currentValue || placeholder} open={open} disabled={disabled} state={feedback.state} error={feedback.error} displayMode={displayMode} className={className} onOpen={() => {
      if (feedback.state !== "error") {
        setDraft(currentValue);
        setReasonText("");
        revisionGuard.capture();
      }
      feedback.clearError();
      setOpen(true);
    }}>
      <AnchoredPopover anchorRef={anchorRef} open={open} width={reason ? 320 : 280} matchAnchor onOutside={() => void commit(true)} onSuperseded={() => void commit(true)} onEscape={cancel} className="inline-text-popover">
        <label className="inline-editor-field"><span>{label}</span><input ref={inputRef} value={draft} readOnly={feedback.state === "saving"} placeholder={placeholder} aria-label={label} onChange={(event) => { setDraft(event.target.value); feedback.clearValidationError(); }} onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.key === "Enter") { event.preventDefault(); void commit(true, true); }
        }} /></label>
        {reason && (draft.trim() !== currentValue || feedback.state === "saving") && <label className="inline-select-reason"><span>{reason.label || "变更原因"}{reason.required && <em>必填</em>}</span><textarea ref={reasonRef} rows={3} readOnly={feedback.state === "saving"} value={reasonText} onChange={(event) => { setReasonText(event.target.value); feedback.clearValidationError(); }} aria-label={reason.label || "变更原因"} placeholder={reason.placeholder || "请说明本次变更原因"} /></label>}
        <EditorError error={feedback.error} />
        <RevisionNotice guard={revisionGuard} showReload={feedback.reloadRequired || revisionGuard.changed && feedback.state === "error"} subject={revisionSubject} />
        {reason && <footer className="inline-multi-actions"><span /><div><Button variant="secondary" type="button" className="ghost-button" onClick={cancel}>取消</Button><Button variant="primary" type="button" className="primary-button" disabled={feedback.state === "saving" || feedback.reloadRequired || revisionGuard.changed || revisionGuard.refreshing || draft.trim() === currentValue} onClick={() => void commit(false, true)}>保存</Button></div></footer>}
        <p className="inline-editor-hint">Enter保存 · Esc取消</p>
      </AnchoredPopover>
    </EditableCell>
  </div>;
}
