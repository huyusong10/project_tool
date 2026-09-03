import {
  createContext,
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
import { AlertCircle, Check, ChevronDown, LoaderCircle, Search, X } from "lucide-react";
import type { UiOption } from "../ui-options";

type SaveState = "idle" | "saving" | "saved" | "error";
type DisplayMode = "single" | "stacked" | "badge";

export type InlineOption = UiOption;

type InlineEditContextValue = {
  activeId: string | null;
  activate: (id: string) => void;
  deactivate: (id: string) => void;
};

const InlineEditContext = createContext<InlineEditContextValue | null>(null);

export function InlineEditProvider({ children }: { children: ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const activate = useCallback((id: string) => setActiveId(id), []);
  const deactivate = useCallback((id: string) => setActiveId((current) => current === id ? null : current), []);
  const value = useMemo(() => ({ activeId, activate, deactivate }), [activeId, activate, deactivate]);
  return <InlineEditContext.Provider value={value}>{children}</InlineEditContext.Provider>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "保存失败，请重试";
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
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const save = useCallback(async (operation: () => Promise<unknown>) => {
    window.clearTimeout(timer.current);
    setError("");
    setState("saving");
    try {
      await operation();
      setState("saved");
      timer.current = window.setTimeout(() => setState("idle"), 1100);
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      setState("error");
      return false;
    }
  }, []);

  const clearError = useCallback(() => {
    setError("");
    setState("idle");
  }, []);

  const fail = useCallback((message: string) => {
    window.clearTimeout(timer.current);
    setError(message);
    setState("error");
  }, []);

  return { state, error, save, clearError, fail };
}

type BaseProps = {
  label: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  displayMode?: DisplayMode;
};

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
    </button>
    <span className="inline-edit-feedback"><SaveFeedback state={state} error={error} /></span>
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
}) {
  const context = useContext(InlineEditContext);
  const activate = context?.activate;
  const deactivate = context?.deactivate;
  const editorId = useId();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width, ready: false });

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
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open || !activate || !deactivate) return;
    activate(editorId);
    return () => deactivate(editorId);
  }, [activate, deactivate, editorId, open]);

  useEffect(() => {
    if (open && context?.activeId && context.activeId !== editorId) onSuperseded();
  }, [context?.activeId, editorId, onSuperseded, open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      onOutside();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onEscape();
    };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [anchorRef, onEscape, onOutside, open]);

  if (!open) return null;
  return createPortal(
    <div
      ref={popoverRef}
      className={`inline-edit-popover ${className}`.trim()}
      style={{ top: position.top, left: position.left, width: position.width, visibility: position.ready ? "visible" : "hidden" }}
      role="dialog"
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

export function InlineTextCell({
  value,
  onSave,
  label,
  className = "",
  disabled = false,
  required = false,
  placeholder = "点击编辑",
  displayMode = "single",
  renderValue,
}: BaseProps & {
  value: string | null | undefined;
  onSave: (value: string) => Promise<unknown>;
  required?: boolean;
  renderValue?: (value: string) => ReactNode;
}) {
  const currentValue = value || "";
  const anchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const committing = useRef(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(currentValue);
  const feedback = useSaveState();

  useEffect(() => { if (!open && feedback.state !== "saving") setDraft(currentValue); }, [currentValue, feedback.state, open]);
  useEffect(() => { if (open) window.requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); }); }, [open]);

  const cancel = useCallback(() => {
    setDraft(currentValue);
    setOpen(false);
    feedback.clearError();
  }, [currentValue, feedback]);

  const commit = useCallback(async (closeBeforeSave = false) => {
    if (committing.current) return;
    const next = draft.trim();
    if (required && !next) {
      feedback.fail(`${label}不能为空`);
      return;
    }
    if (next === currentValue) {
      setOpen(false);
      return;
    }
    if (closeBeforeSave) setOpen(false);
    committing.current = true;
    const saved = await feedback.save(() => onSave(next));
    committing.current = false;
    if (saved) setOpen(false);
    else if (closeBeforeSave) setOpen(true);
  }, [currentValue, draft, feedback, label, onSave, required]);

  const display = renderValue ? renderValue(currentValue) : currentValue || <span className="is-placeholder">{placeholder}</span>;
  return <div ref={anchorRef} className="inline-edit-anchor">
    <EditableCell label={label} display={display} fullText={currentValue || placeholder} open={open} disabled={disabled} state={feedback.state} error={feedback.error} displayMode={displayMode} className={className} onOpen={() => {
      feedback.clearError();
      setDraft(currentValue);
      setOpen(true);
    }}>
      <AnchoredPopover anchorRef={anchorRef} open={open} width={280} matchAnchor onOutside={() => void commit(true)} onSuperseded={() => void commit(true)} onEscape={cancel} className="inline-text-popover">
        <label className="inline-editor-field"><span>{label}</span><input ref={inputRef} value={draft} placeholder={placeholder} aria-label={label} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); void commit(true); }
        }} /></label>
        <EditorError error={feedback.error} />
        <p className="inline-editor-hint">Enter保存 · Esc取消</p>
      </AnchoredPopover>
    </EditableCell>
  </div>;
}

export function InlineSelectCell({
  value,
  options,
  onSave,
  label,
  className = "",
  disabled = false,
  placeholder = "请选择",
  displayMode = "single",
  renderValue,
  renderOption,
}: BaseProps & {
  value: string | null | undefined;
  options: InlineOption[];
  onSave: (value: string) => Promise<unknown>;
  renderValue?: (value: string, option?: InlineOption) => ReactNode;
  renderOption?: (option: InlineOption, selected: boolean) => ReactNode;
}) {
  const currentValue = value || "";
  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const feedback = useSaveState();
  const selected = options.find((option) => option.value === currentValue);
  const searchable = options.length > 7;
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return options;
    return options.filter((option) => `${option.label} ${option.description || ""} ${option.keywords || ""}`.toLowerCase().includes(keyword));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = Math.max(0, filtered.findIndex((option) => option.value === currentValue));
    setActiveIndex(selectedIndex);
    window.requestAnimationFrame(() => searchable ? searchRef.current?.focus() : listRef.current?.focus());
  }, [currentValue, filtered, open, searchable]);

  const cancel = useCallback(() => {
    setOpen(false);
    setQuery("");
    feedback.clearError();
  }, [feedback]);

  const choose = useCallback(async (next: string) => {
    if (next === currentValue) {
      setOpen(false);
      setQuery("");
      return;
    }
    const saved = await feedback.save(() => onSave(next));
    if (saved) {
      setOpen(false);
      setQuery("");
    }
  }, [currentValue, feedback, onSave]);

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
      feedback.clearError();
      setQuery("");
      setOpen(true);
    }}>
      <AnchoredPopover anchorRef={anchorRef} open={open} width={300} matchAnchor onOutside={cancel} onEscape={cancel} className="inline-select-popover">
        <div className="inline-picker-heading"><strong>{label}</strong><button type="button" onClick={cancel} aria-label={`关闭${label}`}><X size={14} /></button></div>
        {searchable && <label className="inline-picker-search"><Search size={14} /><input ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={keyDown} placeholder={`搜索${label}`} /></label>}
        <div ref={listRef} className="inline-option-list" role="listbox" tabIndex={searchable ? -1 : 0} aria-label={label} onKeyDown={keyDown}>
          {filtered.map((option, index) => {
            const isSelected = option.value === currentValue;
            return <button
              type="button"
              role="option"
              aria-selected={isSelected}
              className={`${isSelected ? "is-selected" : ""}${index === activeIndex ? " is-active" : ""}`}
              key={option.value}
              title={option.label}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => void choose(option.value)}
            >
              <span>{renderOption ? renderOption(option, isSelected) : <><strong className={option.toneClass}>{option.label}</strong>{option.description && <small>{option.description}</small>}</>}</span>
              {isSelected && <Check size={15} />}
            </button>;
          })}
          {!filtered.length && <p className="inline-picker-empty">没有匹配选项</p>}
        </div>
        <EditorError error={feedback.error} />
      </AnchoredPopover>
    </EditableCell>
  </div>;
}

export function InlineDateCell({
  value,
  onSave,
  label,
  className = "",
  disabled = false,
  allowClear = true,
  placeholder = "未设置",
  displayMode = "single",
}: BaseProps & {
  value: string | null | undefined;
  onSave: (value: string | null) => Promise<unknown>;
  allowClear?: boolean;
}) {
  const currentValue = value || "";
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const feedback = useSaveState();

  const choose = useCallback(async (next: string) => {
    if (!allowClear && !next) { setOpen(false); return; }
    if (next === currentValue) { setOpen(false); return; }
    const saved = await feedback.save(() => onSave(next || null));
    if (saved) setOpen(false);
  }, [allowClear, currentValue, feedback, onSave]);

  const openPicker = useCallback(() => {
    feedback.clearError();
    setOpen(true);
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    try { input.showPicker?.(); } catch { input.click(); }
  }, [feedback]);

  return <div className="inline-edit-anchor inline-date-native-anchor">
    <EditableCell label={label} display={currentValue || <span className="is-placeholder">{placeholder}</span>} fullText={currentValue || placeholder} open={open} disabled={disabled} state={feedback.state} error={feedback.error} displayMode={displayMode} className={className} onOpen={() => {
      openPicker();
    }}>
    </EditableCell>
    <input
      ref={inputRef}
      className="inline-date-native-control"
      type="date"
      value={currentValue}
      aria-label={label}
      disabled={disabled}
      onChange={(event) => void choose(event.target.value)}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
          inputRef.current?.blur();
        }
      }}
    />
  </div>;
}

export function InlineMultiSelectCell({
  value,
  options,
  onSave,
  label,
  className = "",
  disabled = false,
  placeholder = "未选择",
  displayMode = "single",
  renderValue,
  excludedValues = [],
}: BaseProps & {
  value: string[];
  options: InlineOption[];
  onSave: (value: string[]) => Promise<unknown>;
  renderValue?: (selected: InlineOption[]) => ReactNode;
  excludedValues?: string[];
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [search, setSearch] = useState("");
  const feedback = useSaveState();
  const normalizedValue = [...value].sort().join("|");
  const normalizedDraft = [...draft].sort().join("|");
  const available = options.filter((option) => !excludedValues.includes(option.value));
  const selected = available.filter((option) => value.includes(option.value));
  const visible = available.filter((option) => `${option.label}${option.description || ""}${option.keywords || ""}`.toLowerCase().includes(search.trim().toLowerCase()));

  useEffect(() => { if (!open && feedback.state !== "saving") setDraft(value); }, [feedback.state, normalizedValue, open]);

  const cancel = useCallback(() => {
    setDraft(value);
    setOpen(false);
    setSearch("");
    feedback.clearError();
  }, [feedback, value]);

  const commit = useCallback(async () => {
    if (normalizedDraft === normalizedValue) { setOpen(false); setSearch(""); return; }
    const next = [...draft];
    const saved = await feedback.save(() => onSave(next));
    if (saved) { setOpen(false); setSearch(""); }
  }, [draft, feedback, normalizedDraft, normalizedValue, onSave]);

  const display = renderValue
    ? renderValue(selected)
    : selected.map((option) => option.label).join("、") || <span className="is-placeholder">{placeholder}</span>;
  const fullText = selected.map((option) => option.label).join("、") || placeholder;
  return <div ref={anchorRef} className="inline-edit-anchor">
    <EditableCell label={label} display={display} fullText={fullText} open={open} disabled={disabled} state={feedback.state} error={feedback.error} displayMode={displayMode} className={className} onOpen={() => {
      feedback.clearError();
      setDraft(value);
      setSearch("");
      setOpen(true);
    }}>
      <AnchoredPopover anchorRef={anchorRef} open={open} width={320} matchAnchor onOutside={cancel} onEscape={cancel} className="inline-multi-popover">
        <div className="inline-picker-heading"><strong>{label}</strong><span>已选 {draft.length} 项</span></div>
        {available.length > 6 && <label className="inline-picker-search"><Search size={14} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`搜索${label}`} /></label>}
        <div className="inline-multi-options" role="listbox" aria-multiselectable="true">
          {visible.map((option) => {
            const checked = draft.includes(option.value);
            return <label key={option.value} className={checked ? "is-selected" : ""} title={option.label}>
              <input type="checkbox" checked={checked} onChange={(event) => setDraft((current) => event.target.checked ? [...current, option.value] : current.filter((id) => id !== option.value))} />
              <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
            </label>;
          })}
          {!visible.length && <p className="inline-picker-empty">没有匹配选项</p>}
        </div>
        <EditorError error={feedback.error} />
        <footer className="inline-multi-actions">
          <button type="button" onClick={() => setDraft([])}>清空</button>
          <div><button type="button" className="ghost-button" onClick={cancel}>取消</button><button type="button" className="primary-button" disabled={feedback.state === "saving"} onClick={() => void commit()}>完成</button></div>
        </footer>
      </AnchoredPopover>
    </EditableCell>
  </div>;
}
