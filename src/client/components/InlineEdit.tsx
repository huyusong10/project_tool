import {
  createContext,
  type AriaRole,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Check, ChevronDown, ChevronLeft, ChevronRight, LoaderCircle, Search, X } from "lucide-react";
import { requiresWriteRecheck } from "../api";
import type { UiOption } from "../ui-options";
import { useBusinessDate } from "../app-context";
import { rankSearchItems } from "../../shared/search";

type SaveState = "idle" | "saving" | "saved" | "error";
type DisplayMode = "single" | "stacked" | "badge";
type EditReason = { required?: boolean; label?: string; placeholder?: string; help?: string };

export type InlineOption = UiOption;

type InlineEditContextValue = {
  activeId: string | null;
  activeAnchor: HTMLElement | null;
  activate: (id: string, anchor: HTMLElement | null) => void;
  deactivate: (id: string) => void;
};

const InlineEditContext = createContext<InlineEditContextValue | null>(null);

export function useInlineEditActive(container: HTMLElement | null) {
  const anchor = useContext(InlineEditContext)?.activeAnchor;
  return Boolean(anchor && container?.closest('.paged-panel, .resizable-panel, .issue-update-settings')?.contains(anchor));
}

export function InlineEditProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<{ id: string; anchor: HTMLElement | null } | null>(null);
  const activate = useCallback((id: string, anchor: HTMLElement | null) => setActive({ id, anchor }), []);
  const deactivate = useCallback((id: string) => setActive(current => current?.id === id ? null : current), []);
  const value = useMemo(() => ({ activeId: active?.id || null, activeAnchor: active?.anchor || null, activate, deactivate }), [active, activate, deactivate]);
  return <InlineEditContext.Provider value={value}>{children}</InlineEditContext.Provider>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "保存失败，请重试";
}

function canReturnFocus(anchor: RefObject<HTMLElement | null>) {
  const focused = document.activeElement;
  return !focused || focused === document.body || Boolean(anchor.current?.contains(focused));
}

/** 弹层关闭后归还焦点；异步返回时用户已移到其他控件则保持当前焦点。 */
function focusTrigger(anchor: RefObject<HTMLElement | null>) {
  window.requestAnimationFrame(() => {
    if (canReturnFocus(anchor)) anchor.current?.querySelector<HTMLElement>(".inline-edit-trigger")?.focus();
  });
}

function SaveFeedback({ state, error }: { state: SaveState; error: string }) {
  if (state === "saving") return <LoaderCircle className="inline-edit-spinner" size={14} aria-label="保存中" />;
  if (state === "saved") return <Check className="inline-edit-success" size={14} aria-label="已保存" />;
  if (state === "error") return <AlertCircle className="inline-edit-error-icon" size={14} aria-label={error} />;
  return null;
}

function EditorError({ error }: { error: string }) {
  return error ? <p className="inline-editor-error" role="alert"><AlertCircle size={14} />{error}</p> : null;
}

function useSaveState() {
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const [reloadRequired, setReloadRequired] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const saving = useRef(false);
  const isSaving = useCallback(() => saving.current, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const save = useCallback(async (operation: () => Promise<unknown>) => {
    if (saving.current) return false;
    saving.current = true;
    window.clearTimeout(timer.current);
    setError("");
    setReloadRequired(false);
    setState("saving");
    try {
      await operation();
      setState("saved");
      timer.current = window.setTimeout(() => setState("idle"), 1100);
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      setReloadRequired(requiresWriteRecheck(caught));
      setState("error");
      return false;
    } finally { saving.current = false; }
  }, []);

  const clearError = useCallback(() => {
    if (saving.current) return;
    setError("");
    setReloadRequired(false);
    setState("idle");
  }, []);

  const fail = useCallback((message: string) => {
    if (saving.current) return;
    window.clearTimeout(timer.current);
    setError(message);
    setReloadRequired(false);
    setState("error");
  }, []);

  const clearValidationError = useCallback(() => {
    if (!reloadRequired) clearError();
  }, [clearError, reloadRequired]);

  return { state, error, reloadRequired, save, clearError, clearValidationError, fail, isSaving };
}

type Revision = number | string;

type BaseProps<TRevision extends Revision = number> = {
  label: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  displayMode?: DisplayMode;
  revision?: TRevision;
  revisionSubject?: string;
  onReloadRevision?: () => Promise<TRevision>;
};

type RevisionGuard<TRevision extends Revision> = {
  baselineRevision: TRevision | undefined;
  changed: boolean;
  capture: () => void;
  ensureCurrent: () => boolean;
  onReload: (() => Promise<TRevision>) | undefined;
  refreshed: boolean;
  refreshing: boolean;
  reload: () => Promise<void>;
};

function useRevisionGuard<TRevision extends Revision>({
  revision,
  subject = "记录",
  onReload,
  feedback,
}: {
  revision?: TRevision;
  subject?: string;
  onReload?: () => Promise<TRevision>;
  feedback: ReturnType<typeof useSaveState>;
}): RevisionGuard<TRevision> {
  const [baselineRevision, setBaselineRevision] = useState(revision);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const changed = revision !== undefined && baselineRevision !== undefined && revision !== baselineRevision;
  const capture = useCallback(() => {
    setBaselineRevision(revision);
    setRefreshed(false);
  }, [revision]);
  const ensureCurrent = useCallback(() => {
    if (feedback.reloadRequired) return false;
    if (!changed) return true;
    feedback.fail(`${subject}已更新。草稿已保留，请重新读取并核对后保存。`);
    return false;
  }, [changed, feedback, subject]);
  const reload = useCallback(async () => {
    if (!onReload || refreshing) return;
    setRefreshing(true);
    try {
      const latestRevision = await onReload();
      if (!mounted.current) return;
      setBaselineRevision(latestRevision);
      setRefreshed(true);
      feedback.clearError();
    } catch (caught) {
      if (mounted.current) feedback.fail(errorMessage(caught));
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [feedback, onReload, refreshing]);
  return { baselineRevision, changed, capture, ensureCurrent, onReload, refreshed, refreshing, reload };
}

function RevisionNotice<TRevision extends Revision>({
  guard,
  showReload,
  subject = "记录",
}: {
  guard: RevisionGuard<TRevision>;
  showReload: boolean;
  subject?: string;
}) {
  if (!guard.onReload || (!guard.changed && !guard.refreshed && !showReload)) return null;
  return <div className="inline-editor-revision">
    {guard.changed && !showReload && <p role="alert">{subject}已更新，当前草稿尚未提交。</p>}
    {guard.refreshed && !guard.changed && <p>已读取最新{subject}（版本 {guard.baselineRevision}），草稿已保留，请核对后保存。</p>}
    {(guard.changed || showReload) && <button type="button" className="ghost-button" disabled={guard.refreshing} onClick={() => void guard.reload()}>{guard.refreshing ? "读取中…" : `重新读取${subject}`}</button>}
  </div>;
}

export function EditableCell({
  label,
  display,
  fullText,
  open,
  disabled,
  state,
  error,
  displayMode = "single",
  className = "",
  onOpen,
  children,
}: {
  label: string;
  display: ReactNode;
  fullText: string;
  open: boolean;
  disabled: boolean;
  state: SaveState;
  error: string;
  displayMode?: DisplayMode;
  className?: string;
  onOpen: () => void;
  children?: ReactNode;
}) {
  return <div
    className={`inline-edit-cell is-${displayMode}${open ? " is-open" : ""} is-${state}${error ? " has-error" : ""} ${className}`.trim()}
    onClick={(event) => event.stopPropagation()}
    title={error || fullText || undefined}
  >
    <button
      type="button"
      className="inline-edit-trigger"
      disabled={disabled || state === "saving"}
      aria-label={`${label}：${fullText}，点击编辑`}
      aria-expanded={open}
      onClick={onOpen}
    >
      <span className={`inline-edit-value inline-edit-value-${displayMode}`}>{display}</span>
      {!disabled && <ChevronDown className="inline-edit-chevron" size={13} />}
      <span className="inline-edit-feedback"><SaveFeedback state={state} error={error} /></span>
    </button>
    {children}
  </div>;
}

export function AnchoredPopover({
  anchorRef,
  open,
  onOutside,
  onEscape = onOutside,
  onSuperseded = onOutside,
  children,
  className = "",
  width = 320,
  matchAnchor = false,
  role = "dialog",
  preserveEditing = false,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onOutside: () => void;
  onEscape?: () => void;
  onSuperseded?: () => void;
  children: ReactNode;
  className?: string;
  width?: number;
  matchAnchor?: boolean;
  role?: AriaRole;
  preserveEditing?: boolean;
}) {
  const context = useContext(InlineEditContext);
  const activate = preserveEditing ? undefined : context?.activate;
  const deactivate = preserveEditing ? undefined : context?.deactivate;
  const editorId = useId();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width, ready: false });
  const [ownershipReady, setOwnershipReady] = useState(false);

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const availableWidth = Math.max(160, window.innerWidth - 24);
    const layerWidth = Math.min(Math.max(width, matchAnchor ? rect.width : 0), availableWidth);
    const measuredHeight = popoverRef.current?.offsetHeight || 240;
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - layerWidth - 12);
    const below = rect.bottom + 7;
    const top = below + measuredHeight <= window.innerHeight - 12
      ? below
      : Math.max(12, rect.top - measuredHeight - 7);
    setPosition({ top, left, width: layerWidth, ready: true });
  }, [anchorRef, matchAnchor, width]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition((current) => ({ ...current, ready: false }));
      return;
    }
    reposition();
    const frame = window.requestAnimationFrame(reposition);
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reposition);
    if (popoverRef.current) resizeObserver?.observe(popoverRef.current);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open || !activate || !deactivate) {
      setOwnershipReady(false);
      return;
    }
    setOwnershipReady(false);
    activate(editorId, anchorRef.current);
    // 等上下文确认本浮层成为当前编辑器后，再响应其他编辑器的抢占。
    // 否则从旧浮层直接切换操作菜单时，会读取到上一帧的 activeId 并立即关闭自己。
    const frame = window.requestAnimationFrame(() => setOwnershipReady(true));
    return () => {
      window.cancelAnimationFrame(frame);
      deactivate(editorId);
    };
  }, [activate, deactivate, editorId, open, anchorRef]);

  useEffect(() => {
    if (open && ownershipReady && context?.activeId && context.activeId !== editorId) onSuperseded();
  }, [context?.activeId, editorId, onSuperseded, open, ownershipReady]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!preserveEditing && target instanceof Element && target.closest("[data-preserve-edit]")) return;
      if (anchorRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      onOutside();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
      if (event.target instanceof Element && event.target.closest("[data-preserve-edit]")) return;
      event.preventDefault();
      onEscape();
    };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [anchorRef, onEscape, onOutside, open, preserveEditing]);

  if (!open) return null;
  return createPortal(
    <div
      ref={popoverRef}
      className={`inline-edit-popover ${className}`.trim()}
      style={{ top: position.top, left: position.left, width: position.width, visibility: position.ready ? "visible" : "hidden" }}
      role={role}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

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
        {reason && <footer className="inline-multi-actions"><span /><div><button type="button" className="ghost-button" onClick={cancel}>取消</button><button type="button" className="primary-button" disabled={feedback.state === "saving" || feedback.reloadRequired || revisionGuard.changed || revisionGuard.refreshing || draft.trim() === currentValue} onClick={() => void commit(false, true)}>保存</button></div></footer>}
        <p className="inline-editor-hint">Enter保存 · Esc取消</p>
      </AnchoredPopover>
    </EditableCell>
  </div>;
}

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
        <div className="inline-picker-heading"><strong>{label}</strong><button type="button" onClick={() => cancel()} aria-label={`关闭${label}`}><X size={14} /></button></div>
        {searchable && <label className="inline-picker-search"><Search size={14} /><input ref={searchRef} role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls={listId} aria-activedescendant={filtered[activeIndex] ? `${listId}-option-${activeIndex}` : undefined} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={keyDown} placeholder={`搜索${label}`} /></label>}
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
          <div className="inline-select-actions"><button type="button" className="ghost-button" onClick={() => cancel()}>取消</button><button type="button" className="primary-button" disabled={feedback.state === "saving" || feedback.reloadRequired || revisionGuard.changed || revisionGuard.refreshing || pendingOptionUnavailable} onClick={() => void commit()}>保存</button></div>
        </>}
        <EditorError error={pendingOptionUnavailable ? `${pendingOptionLabel}已不可用，请重新选择` : feedback.error} />
        <RevisionNotice guard={revisionGuard} showReload={feedback.reloadRequired || revisionGuard.changed && feedback.state === "error"} subject={revisionSubject} />
        {!reason && pendingValue !== null && (revisionGuard.changed || revisionGuard.refreshed || feedback.state === "error") && <div className="inline-select-actions"><button type="button" className="ghost-button" onClick={() => cancel()}>取消</button><button type="button" className="primary-button" disabled={feedback.state === "saving" || feedback.reloadRequired || revisionGuard.changed || revisionGuard.refreshing || pendingOptionUnavailable} onClick={() => void commit()}>保存所选</button></div>}
      </AnchoredPopover>
    </EditableCell>
  </div>;
}

function dateFromIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateToIso(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function moveMonth(date: Date, offset: number) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1, 12);
}

function monthLabel(date: Date) {
  return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, "0")}月`;
}

function calendarDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - mondayOffset, 12);
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index, 12));
}

export function InlineDateCell<TRevision extends Revision = number>({
  value,
  onSave,
  label,
  className = "",
  disabled = false,
  allowClear = true,
  placeholder = "未设置",
  displayMode = "single",
  revision,
  revisionSubject = "记录",
  onReloadRevision,
  reason,
}: BaseProps<TRevision> & {
  value: string | null | undefined;
  onSave: (value: string | null, reason?: string, expectedRevision?: TRevision) => Promise<unknown>;
  allowClear?: boolean;
  reason?: EditReason;
}) {
  const { businessDate: today } = useBusinessDate();
  const currentValue = value || "";
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(currentValue);
  const [reasonText, setReasonText] = useState("");
  const [visibleMonth, setVisibleMonth] = useState(() => dateFromIso(currentValue) || dateFromIso(today)!);
  const feedback = useSaveState();
  const revisionGuard = useRevisionGuard({ revision, subject: revisionSubject, onReload: onReloadRevision, feedback });

  useEffect(() => {
    if (!open && feedback.state !== "saving" && feedback.state !== "error") setDraft(currentValue);
  }, [currentValue, feedback.state, open]);

  const cancel = useCallback((refocus = true) => {
    if (!feedback.isSaving()) {
      setDraft(currentValue);
      setReasonText("");
      feedback.clearError();
    }
    setOpen(false);
    if (refocus) focusTrigger(anchorRef);
  }, [currentValue, feedback]);

  const openPicker = useCallback(() => {
    if (feedback.state !== "error") {
      setDraft(currentValue);
      setReasonText("");
      revisionGuard.capture();
    }
    setVisibleMonth(dateFromIso(feedback.state === "error" ? draft : currentValue) || dateFromIso(today)!);
    feedback.clearError();
    setOpen(true);
  }, [currentValue, draft, feedback, revisionGuard, today]);

  const commit = useCallback(async () => {
    if (feedback.isSaving()) return;
    if (!allowClear && !draft) return feedback.fail(`${label}不能为空`);
    if (!revisionGuard.ensureCurrent()) return;
    if (draft === currentValue) {
      setOpen(false);
      setReasonText("");
      focusTrigger(anchorRef);
      return;
    }
    const normalizedReason = reasonText.trim();
    if (reason?.required && !normalizedReason) return feedback.fail(`${reason.label || "变更原因"}不能为空`);
    const saved = await feedback.save(() => onSave(draft || null, normalizedReason || undefined, revisionGuard.baselineRevision));
    if (saved) {
      setOpen(false);
      setReasonText("");
      focusTrigger(anchorRef);
    }
  }, [allowClear, currentValue, draft, feedback, label, onSave, reason?.label, reason?.required, reasonText, revisionGuard]);

  const monthDays = calendarDays(visibleMonth);
  return <div ref={anchorRef} className="inline-edit-anchor">
    <EditableCell label={label} display={currentValue || <span className="is-placeholder">{placeholder}</span>} fullText={currentValue || placeholder} open={open} disabled={disabled} state={feedback.state} error={feedback.error} displayMode={displayMode} className={className} onOpen={() => {
      openPicker();
    }}>
      <AnchoredPopover anchorRef={anchorRef} open={open} width={320} onOutside={() => cancel(false)} onEscape={cancel} onSuperseded={() => cancel(false)} className="inline-date-popover">
        <div className="inline-date-editor">
          <header>
            <button type="button" aria-label="上一个月" onClick={() => setVisibleMonth((month) => moveMonth(month, -1))}><ChevronLeft size={16} /></button>
            <strong>{monthLabel(visibleMonth)}</strong>
            <button type="button" aria-label="下一个月" onClick={() => setVisibleMonth((month) => moveMonth(month, 1))}><ChevronRight size={16} /></button>
          </header>
          <div className="inline-calendar-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="inline-calendar-grid" role="grid" aria-label={label}>
            {monthDays.map((date) => {
              const iso = dateToIso(date);
              const outside = date.getMonth() !== visibleMonth.getMonth();
              return <button type="button" role="gridcell" key={iso} disabled={feedback.state === "saving"} className={`${outside ? "is-outside" : ""}${draft === iso ? " is-selected" : ""}${today === iso ? " is-today" : ""}`} aria-selected={draft === iso} aria-label={iso} onClick={() => { setDraft(iso); feedback.clearValidationError(); }}>{date.getDate()}</button>;
            })}
          </div>
          {reason && (draft !== currentValue || feedback.state === "saving") && <label className="inline-date-reason"><span>{reason.label || "变更原因"}{reason.required && <em>必填</em>}</span><textarea rows={3} autoFocus readOnly={feedback.state === "saving"} value={reasonText} onChange={(event) => { setReasonText(event.target.value); feedback.clearValidationError(); }} aria-label={reason.label || "变更原因"} placeholder={reason.placeholder || "请说明本次调整原因"} />{reason.help && <small>{reason.help}</small>}</label>}
          <EditorError error={feedback.error} />
          <RevisionNotice guard={revisionGuard} showReload={feedback.reloadRequired || revisionGuard.changed && feedback.state === "error"} subject={revisionSubject} />
          <footer>
            <div>{allowClear && <button type="button" disabled={feedback.state === "saving"} className="inline-date-clear" onClick={() => setDraft("")}>清除</button>}<button type="button" disabled={feedback.state === "saving"} className="inline-date-today" onClick={() => { setDraft(today); setVisibleMonth(dateFromIso(today)!); }}>今天</button></div>
            <div><button type="button" className="ghost-button" onClick={() => cancel()}>取消</button><button type="button" className="primary-button" disabled={feedback.state === "saving" || feedback.reloadRequired || revisionGuard.changed || revisionGuard.refreshing || draft === currentValue} onClick={() => void commit()}>保存</button></div>
          </footer>
        </div>
      </AnchoredPopover>
    </EditableCell>
  </div>;
}

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
        {available.length > 6 && <label className="inline-picker-search"><Search size={14} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`搜索${label}`} /></label>}
        <div className="inline-multi-options" role="listbox" aria-multiselectable="true">
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
          <button type="button" disabled={feedback.state === "saving"} onClick={() => setDraft([])}>清空</button>
          <div><button type="button" className="ghost-button" onClick={() => cancel()}>取消</button><button type="button" className="primary-button" disabled={feedback.state === "saving" || feedback.reloadRequired || revisionGuard.changed || revisionGuard.refreshing || Boolean(unavailableDraftError)} onClick={() => void commit()}>完成</button></div>
        </footer>
      </AnchoredPopover>
    </EditableCell>
  </div>;
}
