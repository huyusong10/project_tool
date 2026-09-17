import { useMutation } from '@tanstack/react-query';
import { Button } from "../Button";
import { createContext, type ReactNode, type RefObject, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { AlertCircle, Check, ChevronDown, LoaderCircle } from "lucide-react";
import { requiresWriteRecheck } from "../../api";
import type { UiOption } from "../../ui-options";

export type SaveState = "idle" | "saving" | "saved" | "error";

export type DisplayMode = "single" | "stacked" | "badge";

export type EditReason = { required?: boolean; label?: string; placeholder?: string; help?: string };

export type InlineOption = UiOption;

export type InlineEditContextValue = {
  activeId: string | null;
  activeAnchor: HTMLElement | null;
  activate: (id: string, anchor: HTMLElement | null) => void;
  deactivate: (id: string) => void;
};

export const InlineEditContext = createContext<InlineEditContextValue | null>(null);

export function useInlineEditActive(container: HTMLElement | null) {
  const anchor = useContext(InlineEditContext)?.activeAnchor;
  return Boolean(anchor && container?.closest('.paged-panel, .resizable-panel, .issue-update-settings')?.contains(anchor));
}

export function InlineEditProvider({ children, resetKey }: { children: ReactNode; resetKey?: string }) {
  const [active, setActive] = useState<{ id: string; anchor: HTMLElement | null } | null>(null);
  useLayoutEffect(() => setActive(null), [resetKey]);
  const activate = useCallback((id: string, anchor: HTMLElement | null) => setActive({ id, anchor }), []);
  const deactivate = useCallback((id: string) => setActive(current => current?.id === id ? null : current), []);
  const value = useMemo(() => ({ activeId: active?.id || null, activeAnchor: active?.anchor || null, activate, deactivate }), [active, activate, deactivate]);
  return <InlineEditContext.Provider value={value}>{children}</InlineEditContext.Provider>;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "保存失败，请重试";
}

export function canReturnFocus(anchor: RefObject<HTMLElement | null>) {
  const focused = document.activeElement;
  return !focused || focused === document.body || Boolean(anchor.current?.contains(focused));
}

export function focusTrigger(anchor: RefObject<HTMLElement | null>) {
  window.requestAnimationFrame(() => {
    if (canReturnFocus(anchor)) anchor.current?.querySelector<HTMLElement>(".inline-edit-trigger")?.focus();
  });
}

export function SaveFeedback({ state, error }: { state: SaveState; error: string }) {
  if (state === "saving") return <LoaderCircle className="inline-edit-spinner" size={14} aria-label="保存中" />;
  if (state === "saved") return <Check className="inline-edit-success" size={14} aria-label="已保存" />;
  if (state === "error") return <AlertCircle className="inline-edit-error-icon" size={14} aria-label={error} />;
  return null;
}

export function EditorError({ error }: { error: string }) {
  return error ? <p className="inline-editor-error" role="alert"><AlertCircle size={14} />{error}</p> : null;
}

export function useSaveState() {
  const {mutateAsync}=useMutation({mutationFn:(operation:()=>Promise<unknown>)=>operation()});
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
      await mutateAsync(operation);
      setState("saved");
      timer.current = window.setTimeout(() => setState("idle"), 1100);
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      setReloadRequired(requiresWriteRecheck(caught));
      setState("error");
      return false;
    } finally { saving.current = false; }
  }, [mutateAsync]);

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

export type Revision = number | string;

export type BaseProps<TRevision extends Revision = number> = {
  label: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  displayMode?: DisplayMode;
  revision?: TRevision;
  revisionSubject?: string;
  onReloadRevision?: () => Promise<TRevision>;
};

export type RevisionGuard<TRevision extends Revision> = {
  baselineRevision: TRevision | undefined;
  changed: boolean;
  capture: () => void;
  ensureCurrent: () => boolean;
  onReload: (() => Promise<TRevision>) | undefined;
  refreshed: boolean;
  refreshing: boolean;
  reload: () => Promise<void>;
};

export function useRevisionGuard<TRevision extends Revision>({
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

export function RevisionNotice<TRevision extends Revision>({
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
    {(guard.changed || showReload) && <Button busy={(guard.refreshing)} aria-label={guard.refreshing ? "读取中…" : `重新读取${subject}`} variant="secondary" type="button" className="ghost-button" disabled={guard.refreshing} onClick={() => void guard.reload()}>{`重新读取${subject}`}</Button>}
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
