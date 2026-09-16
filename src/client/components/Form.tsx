import { Button } from './Button';
import { useId, useState, type ReactNode } from "react";

/** 首次展开时挂载字段，之后只隐藏，保留表单值和原生校验。 */
export function FormDisclosure({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const contentId = useId();
  return <>
    <div className="form-disclosure field-full">
      <button type="button" className={open ? "is-open" : ""} aria-expanded={open} aria-controls={contentId} onClick={() => { setInitialized(true); setOpen((value) => !value); }}>
        <strong>{label}</strong><span>{open ? "收起" : hint}</span>
      </button>
    </div>
    <div id={contentId} className="form-grid form-disclosure-fields field-full" hidden={!open} onInvalidCapture={(event) => {
      if (open) return;
      event.preventDefault();
      setOpen(true);
      const input = event.target as HTMLInputElement;
      requestAnimationFrame(() => {
        if (input.isConnected) { input.focus(); input.reportValidity(); }
      });
    }}>
      {initialized && children}
    </div>
  </>;
}

/**
 * 表单三件套：FormField / FormError / FormSubmitActions。
 * 渲染与裸写 `label.field` 完全一致的 DOM，替代 12+ 处逐字重复的表单样板。
 */
export function FormField({
  label,
  full = false,
  help,
  className = "",
  asLabel = true,
  children,
}: {
  label: ReactNode;
  full?: boolean;
  help?: ReactNode;
  className?: string;
  asLabel?: boolean;
  children: ReactNode;
}) {
  const classes = `field${full ? " field-full" : ""}${className ? ` ${className}` : ""}`;
  const content = (
    <>
      <span>{label}</span>
      {children}
      {help ? <small className="field-help">{help}</small> : null}
    </>
  );
  return asLabel ? <label className={classes}>{content}</label> : <div className={classes}>{content}</div>;
}

export function FormError({ children, full = true }: { children?: ReactNode; full?: boolean }) {
  if (!children) return null;
  return <p className={`form-error${full ? " field-full" : ""}`} role="alert">{children}</p>;
}

export function FormSubmitActions({
  submitLabel,
  pendingLabel = "保存中…",
  cancelLabel = "取消",
  onCancel,
  pending = false,
  disabled = false,
  danger = false,
}: {
  submitLabel: ReactNode;
  pendingLabel?: string;
  cancelLabel?: string;
  onCancel?: () => void;
  pending?: boolean;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="form-actions field-full">
      {onCancel && <Button variant="secondary" type="button" className="ghost-button" disabled={pending} onClick={onCancel}>{cancelLabel}</Button>}
      <Button busy={(pending)} aria-label={pending ? pendingLabel : undefined} type="submit" tone={danger ? "danger" : "primary"} variant={danger ? "soft" : "primary"} className={`primary-button${danger ? " danger-button" : ""}`} disabled={pending || disabled}>{submitLabel}</Button>
    </div>
  );
}
