
import { Button } from "../Button";
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { Check, Search, X } from "lucide-react";

import { rankSearchItems } from "../../../shared/search";

import { type Revision, type BaseProps, type InlineOption, type EditReason, useSaveState, useRevisionGuard, focusTrigger, EditableCell, EditorError, RevisionNotice } from './shared';
import { AnchoredPopover } from './popover';

export function InlineSelectCell<TRevision extends Revision = number>({
  value,
  options,
  onSave,
  label,
  className = "",
  disabled = false,
  placeholder = "请选择",
  displayMode = "single",
  revision,
  revisionSubject = "记录",
  onReloadRevision,
  renderValue,
  renderOption,
  reason,
}: BaseProps<TRevision> & {
  value: string | null | undefined;
  options: InlineOption[];
  onSave: (value: string, reason?: string, expectedRevision?: TRevision) => Promise<unknown>;
  renderValue?: (value: string, option?: InlineOption) => ReactNode;
  renderOption?: (option: InlineOption, selected: boolean) => ReactNode;
  reason?: EditReason;
}) {
  const currentValue = value || "";
  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const knownOptions = useRef(new Map(options.map((option) => [option.value, option])));
  for (const option of options) knownOptions.current.set(option.value, option);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [pendingValue, setPendingValue] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState("");
  const feedback = useSaveState();
  const revisionGuard = useRevisionGuard({ revision, subject: revisionSubject, onReload: onReloadRevision, feedback });
  const listId = useId();
  const currentOption = options.find((option) => option.value === currentValue);
  const knownCurrentOption = currentValue ? knownOptions.current.get(currentValue) : undefined;
  const selected = currentOption || (knownCurrentOption ? { ...knownCurrentOption, label: `${knownCurrentOption.label}（已不可用）` } : undefined);
  const pendingOptionUnavailable = pendingValue !== null && !options.some((option) => option.value === pendingValue && !option.disabled);
  const pendingOptionLabel = pendingValue === null ? "所选项" : knownOptions.current.get(pendingValue)?.label || "所选项";
  const searchable = options.length > 7;
  const filtered = useMemo(() => {
    return rankSearchItems(options, query, (option) => [{ text: option.label, weight: 100 }, option.description, option.keywords]);
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = Math.max(0, filtered.findIndex((option) => option.value === currentValue));
    setActiveIndex(selectedIndex);
    window.requestAnimationFrame(() => searchable ? searchRef.current?.focus() : listRef.current?.focus());
  }, [currentValue, filtered, open, searchable]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  useEffect(() => {
    if (open && pendingValue !== null) reasonRef.current?.focus();
  }, [open, pendingValue]);

  const cancel = useCallback((refocus = true) => {
    setOpen(false);
    if (!feedback.isSaving()) {
      setQuery("");
      setPendingValue(null);
      setReasonText("");
      feedback.clearError();
    }
    if (refocus) focusTrigger(anchorRef);
  }, [feedback]);

  const choose = useCallback(async (next: string) => {
    if (feedback.isSaving()) return;
    if (options.find(option => option.value === next)?.disabled) return;
    if (next === currentValue) {
      cancel();
      return;
    }
    if (reason) {
      setPendingValue(next);
      setReasonText("");
      feedback.clearError();
      return;
    }
    setPendingValue(next);
    if (!revisionGuard.ensureCurrent()) return;
    const saved = await feedback.save(() => onSave(next, undefined, revisionGuard.baselineRevision));
    if (saved) {
      setOpen(false);
      setQuery("");
      setPendingValue(null);
      focusTrigger(anchorRef);
    }
  }, [cancel, currentValue, feedback, onSave, options, reason, revisionGuard]);

  const commit = useCallback(async () => {
    if (feedback.isSaving()) return;
    if (pendingValue === null) return;
    if (pendingOptionUnavailable) return feedback.fail(`${pendingOptionLabel}已不可用，请重新选择`);
    const normalizedReason = reasonText.trim();
    if (reason?.required && !normalizedReason) return feedback.fail(`${reason.label || "变更原因"}不能为空`);
    if (!revisionGuard.ensureCurrent()) return;
    const saved = await feedback.save(() => onSave(pendingValue, normalizedReason || undefined, revisionGuard.baselineRevision));
    if (saved) {
      setOpen(false);
      setQuery("");
      setPendingValue(null);
      setReasonText("");
      focusTrigger(anchorRef);
    }
  }, [feedback, onSave, pendingOptionLabel, pendingOptionUnavailable, pendingValue, reason?.label, reason?.required, reasonText, revisionGuard]);

  const keyDown = (event: ReactKeyboardEvent) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (!filtered.length) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => (index + 1) % filtered.length); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => (index - 1 + filtered.length) % filtered.length); }
    if (event.key === "Enter") { event.preventDefault(); void choose(filtered[activeIndex]?.value || currentValue); }
  };

  const display = renderValue
    ? renderValue(currentValue, selected)
    : selected?.label || <span className="is-placeholder">{placeholder}</span>;
  return <div ref={anchorRef} className="inline-edit-anchor">
    <EditableCell label={label} display={display} fullText={selected?.label || placeholder} open={open} disabled={disabled} state={feedback.state} error={feedback.error} displayMode={displayMode} className={className} onOpen={() => {
      if (feedback.state !== "error") {
        setPendingValue(null);
        setReasonText("");
        revisionGuard.capture();
      }
      feedback.clearError();
      setQuery("");
      setOpen(true);
    }}>
      <AnchoredPopover anchorRef={anchorRef} open={open} width={300} matchAnchor onOutside={() => cancel(false)} onEscape={cancel} className={`inline-select-popover${reason && pendingValue !== null ? " has-pending" : ""}`}>
        <div className="inline-picker-heading"><strong>{label}</strong><Button variant="ghost" iconOnly type="button" onClick={() => cancel()} aria-label={`关闭${label}`}><X size={14} /></Button></div>
        {searchable && <label className="inline-picker-search"><Search size={14} /><input ref={searchRef} role="combobox" aria-label={`搜索${label}`} aria-expanded="true" aria-autocomplete="list" aria-controls={listId} aria-activedescendant={filtered[activeIndex] ? `${listId}-option-${activeIndex}` : undefined} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={keyDown} placeholder={`搜索${label}`} /></label>}
        <div ref={listRef} id={listId} className="inline-option-list" role="listbox" tabIndex={searchable ? -1 : 0} aria-label={label} aria-activedescendant={filtered[activeIndex] ? `${listId}-option-${activeIndex}` : undefined} onKeyDown={keyDown}>
          {filtered.map((option, index) => {
            const isSelected = option.value === (pendingValue ?? currentValue);
            return <button
              type="button"
              id={`${listId}-option-${index}`}
              role="option"
              aria-selected={isSelected}
              className={`${isSelected ? "is-selected" : ""}${index === activeIndex ? " is-active" : ""}`}
              key={option.value}
              title={option.label}
              disabled={feedback.state === "saving" || option.disabled}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => void choose(option.value)}
            >
              <span>{renderOption ? renderOption(option, isSelected) : <><strong className={option.toneClass}>{option.label}</strong>{option.description && <small>{option.description}</small>}</>}</span>
              {isSelected && <Check size={15} />}
            </button>;
          })}
          {!filtered.length && <p className="inline-picker-empty">没有匹配选项</p>}
        </div>
        {reason && pendingValue !== null && <>
          <label className="inline-select-reason"><span>{reason.label || "变更原因"}{reason.required && <em>必填</em>}</span><textarea ref={reasonRef} rows={3} readOnly={feedback.state === "saving"} value={reasonText} onChange={(event) => { setReasonText(event.target.value); feedback.clearValidationError(); }} aria-label={reason.label || "变更原因"} placeholder={reason.placeholder || "请说明本次变更原因"} /></label>
          <div className="inline-select-actions"><Button variant="secondary" type="button" className="ghost-button" onClick={() => cancel()}>取消</Button><Button variant="primary" type="button" className="primary-button" disabled={feedback.state === "saving" || feedback.reloadRequired || revisionGuard.changed || revisionGuard.refreshing || pendingOptionUnavailable} onClick={() => void commit()}>保存</Button></div>
        </>}
        <EditorError error={pendingOptionUnavailable ? `${pendingOptionLabel}已不可用，请重新选择` : feedback.error} />
        <RevisionNotice guard={revisionGuard} showReload={feedback.reloadRequired || revisionGuard.changed && feedback.state === "error"} subject={revisionSubject} />
        {!reason && pendingValue !== null && (revisionGuard.changed || revisionGuard.refreshed || feedback.state === "error") && <div className="inline-select-actions"><Button variant="secondary" type="button" className="ghost-button" onClick={() => cancel()}>取消</Button><Button variant="primary" type="button" className="primary-button" disabled={feedback.state === "saving" || feedback.reloadRequired || revisionGuard.changed || revisionGuard.refreshing || pendingOptionUnavailable} onClick={() => void commit()}>保存所选</Button></div>}
      </AnchoredPopover>
    </EditableCell>
  </div>;
}
