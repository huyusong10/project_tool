
import { Button } from "../Button";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { Search } from "lucide-react";

import { rankSearchItems } from "../../../shared/search";

import { type Revision, type BaseProps, type InlineOption, type EditReason, useSaveState, useRevisionGuard, focusTrigger, EditableCell, EditorError, RevisionNotice } from './shared';
import { AnchoredPopover } from './popover';

export function InlineMultiSelectCell<TRevision extends Revision = number>({
  value,
  options,
  onSave,
  label,
  className = "",
  disabled = false,
  placeholder = "未选择",
  displayMode = "single",
  revision,
  revisionSubject = "记录",
  onReloadRevision,
  renderValue,
  excludedValues = [],
  reason,
}: BaseProps<TRevision> & {
  value: string[];
  options: InlineOption[];
  onSave: (value: string[], expectedRevision?: TRevision, reason?: string) => Promise<unknown>;
  reason?: EditReason;
  renderValue?: (selected: InlineOption[]) => ReactNode;
  excludedValues?: string[];

}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null), optionsRef = useRef<HTMLDivElement>(null);
  const knownOptions = useRef(new Map(options.map((option) => [option.value, option])));
  for (const option of options) knownOptions.current.set(option.value, option);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [reasonText, setReasonText] = useState("");
  const [search, setSearch] = useState("");
  const feedback = useSaveState();
  const revisionGuard = useRevisionGuard({ revision, subject: revisionSubject, onReload: onReloadRevision, feedback });
  const normalizedValue = [...value].sort().join("|");
  const normalizedDraft = [...draft].sort().join("|");
  const liveOptions = options.filter((option) => !excludedValues.includes(option.value) && !option.disabled);
  const unavailableDraftValues = draft.filter((optionValue) => !liveOptions.some((option) => option.value === optionValue));
  const unavailableDraftOptions: InlineOption[] = unavailableDraftValues.map((optionValue) => {
    const known = knownOptions.current.get(optionValue);
    return { value: optionValue, label: known?.label || "已选择项", description: "已不可用，请取消选择" };
  });
  const available = [...liveOptions, ...unavailableDraftOptions];
  const selected = value.flatMap((optionValue) => {
    const live = liveOptions.find((option) => option.value === optionValue);
    if (live) return [live];
    const known = knownOptions.current.get(optionValue);
    return known ? [{ ...known, label: `${known.label}（已不可用）` }] : [];
  });
  const unavailableDraftLabel = unavailableDraftValues.map((optionValue) => knownOptions.current.get(optionValue)?.label || "已选择项").join("、");
  const unavailableDraftError = unavailableDraftValues.length ? `${unavailableDraftLabel}已不可用，请取消选择后保存。` : "";
  const visible = rankSearchItems(available, search, (option) => [{ text: option.label, weight: 100 }, option.description, option.keywords]);

  useEffect(() => { if (!open && feedback.state !== "saving" && feedback.state !== "error") setDraft(value); }, [feedback.state, normalizedValue, open, value]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => (searchRef.current || optionsRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)'))?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const cancel = useCallback((refocus = true) => {
    if (!feedback.isSaving()) {
      setDraft(value);
      setReasonText("");
      feedback.clearError();
    }
    setOpen(false);
    setSearch("");
    if (refocus) focusTrigger(anchorRef);
  }, [feedback, value]);

  const commit = useCallback(async () => {
    if (feedback.isSaving()) return;
    if (unavailableDraftError) return feedback.fail(unavailableDraftError);
    if (!revisionGuard.ensureCurrent()) return;
    if (normalizedDraft === normalizedValue) { setOpen(false); setSearch(""); focusTrigger(anchorRef); return; }
    const normalizedReason = reasonText.trim();
    if (reason?.required && !normalizedReason) return feedback.fail(`${reason.label || "变更原因"}不能为空`);
    const next = [...draft];
    const saved = await feedback.save(() => onSave(next, revisionGuard.baselineRevision, normalizedReason || undefined));
    if (saved) { setOpen(false); setSearch(""); setReasonText(""); focusTrigger(anchorRef); }
  }, [draft, feedback, normalizedDraft, normalizedValue, onSave, reason, reasonText, revisionGuard, unavailableDraftError]);

  const display = renderValue
    ? renderValue(selected)
    : selected.map((option) => option.label).join("、") || <span className="is-placeholder">{placeholder}</span>;
  const fullText = selected.map((option) => option.label).join("、") || placeholder;
  return <div ref={anchorRef} className="inline-edit-anchor">
    <EditableCell label={label} display={display} fullText={fullText} open={open} disabled={disabled} state={feedback.state} error={feedback.error} displayMode={displayMode} className={className} onOpen={() => {
      if (feedback.state !== "error") { setDraft(value); setReasonText(""); }
      if (feedback.state !== "error") revisionGuard.capture();
      feedback.clearError();
      setSearch("");
      setOpen(true);
    }}>
      <AnchoredPopover anchorRef={anchorRef} open={open} width={320} matchAnchor onOutside={() => cancel(false)} onEscape={cancel} className="inline-multi-popover">
        <div className="inline-picker-heading"><strong>{label}</strong><span>已选 {draft.length} 项</span></div>
        {available.length > 6 && <label className="inline-picker-search"><Search size={14} /><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`搜索${label}`} /></label>}
        <div ref={optionsRef} className="inline-multi-options" role="listbox" aria-multiselectable="true">
          {visible.map((option) => {
            const checked = draft.includes(option.value);
            return <label key={option.value} className={checked ? "is-selected" : ""} title={option.label}>
              <input type="checkbox" checked={checked} disabled={feedback.state === "saving"} onChange={(event) => { setDraft((current) => event.target.checked ? [...current, option.value] : current.filter((id) => id !== option.value)); feedback.clearValidationError(); }} />
              <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
            </label>;
          })}
          {!visible.length && <p className="inline-picker-empty">没有匹配选项</p>}
        </div>
        {reason && (normalizedDraft !== normalizedValue || feedback.state === "saving") && <label className="inline-select-reason"><span>{reason.label || "变更原因"}{reason.required && <em>必填</em>}</span><textarea rows={3} readOnly={feedback.state === "saving"} value={reasonText} onChange={(event) => { setReasonText(event.target.value); feedback.clearValidationError(); }} aria-label={reason.label || "变更原因"} placeholder={reason.placeholder || "请说明本次变更原因"} /></label>}
        <EditorError error={unavailableDraftError || feedback.error} />
        <RevisionNotice guard={revisionGuard} showReload={feedback.reloadRequired || revisionGuard.changed && feedback.state === "error"} subject={revisionSubject} />
        <footer className="inline-multi-actions">
          <Button variant="secondary" type="button" disabled={feedback.state === "saving"} onClick={() => setDraft([])}>清空</Button>
          <div><Button variant="secondary" type="button" className="ghost-button" onClick={() => cancel()}>取消</Button><Button variant="primary" type="button" className="primary-button" disabled={feedback.state === "saving" || feedback.reloadRequired || revisionGuard.changed || revisionGuard.refreshing || Boolean(unavailableDraftError)} onClick={() => void commit()}>完成</Button></div>
        </footer>
      </AnchoredPopover>
    </EditableCell>
  </div>;
}
