import { Button, MenuButtons } from './Button';
import { AlertTriangle, CheckCircle2, Copy, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {useDetailActionHost} from './DetailWorkspace';
import {hasActiveSortDrag} from './DragPreview';

let openModalCount = 0;
let previousBodyOverflow = '';

export function Modal({ title, children, onClose, width = 560, closable = true, layout = 'adaptive', placement = 'center' }: { title: string; children: ReactNode; onClose: () => void; width?: number; closable?: boolean; layout?: 'adaptive' | 'workspace'; placement?: 'center' | 'right' }) {
  const host = useDetailActionHost();
  const inline = Boolean(host);
  const cardRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const closableRef = useRef(closable);
  const titleId = useId();
  const requestClose = () => {
    const child = Array.from(cardRef.current?.querySelectorAll<HTMLElement>('[data-detail-action]') || []).at(-1);
    if (child) {child.querySelector<HTMLButtonElement>('[data-detail-back]')?.click(); return;}
    if (closable) onClose();
  };
  const register = host?.register;
  useEffect(() => register?.(titleId), [register, titleId]);
  useEffect(() => { closeRef.current = requestClose; });
  useEffect(() => { closableRef.current = closable; }, [closable]);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (openModalCount++ === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    const frame = requestAnimationFrame(() => {
      const card = cardRef.current;
      if (!card || card.contains(document.activeElement)) return;
      const initial = Array.from(card.querySelectorAll<HTMLElement>('[autofocus]:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled):not(.icon-button)')).find(element => element.getClientRects().length > 0 && !element.closest('[inert]'));
      (initial || card).focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      const card = cardRef.current;
      if (!card) return;
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter(dialog => dialog.getClientRects().length > 0);
      if (dialogs.at(-1) !== card) return;
      if (event.key === 'Escape') {
        if (hasActiveSortDrag()) return;
        event.preventDefault();
        if (closableRef.current) closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || inline) return;
      const focusable = Array.from(card.querySelectorAll<HTMLElement>('button, input, textarea, select, [href], [tabindex]:not([tabindex="-1"])'))
        .filter((element) => !element.matches(':disabled') && !element.closest('[inert]') && element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        card.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      openModalCount = Math.max(0, openModalCount - 1);
      if (openModalCount === 0) document.body.style.overflow = previousBodyOverflow;
      previousFocus?.focus();
    };
  }, [inline]);
  const content = (
    <MenuButtons enabled={false}>
    <div className={`modal-backdrop${placement === 'right' ? ' modal-backdrop-right' : ''}`} role="presentation" onMouseDown={(event) => closable && event.target === event.currentTarget && requestClose()}>
      <section ref={cardRef} data-detail-action={host ? true : undefined} className={`modal-card modal-card-${layout}`} style={{ width, maxWidth: width ? `min(94vw, ${width}px)` : undefined }} role="dialog" aria-modal={!host} aria-labelledby={titleId} tabIndex={-1} onKeyDown={event => {
        if (host && event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing && !hasActiveSortDrag()) {event.preventDefault(); event.stopPropagation(); requestClose();}
      }}>
        <header><h2 id={titleId}>{title}</h2>{host ? <Button variant="secondary" type="button" data-detail-back className="ghost-button" disabled={!closable} onClick={requestClose}>返回</Button> : <Button variant="ghost" iconOnly disabled={!closable} className="icon-button" aria-label="关闭" onClick={requestClose}><X size={18} /></Button>}</header>
        <div className={`modal-body modal-body-${layout}`}>{children}</div>
      </section>
    </div></MenuButtons>
  );
  return typeof document === 'undefined' ? content : host ? host.element && createPortal(content, host.element) : createPortal(content, document.body);
}

export function useSynchronousPendingLock(pending: boolean) {
  const [submitted, setSubmitted] = useState(false);
  const submittingRef = useRef(false);
  const pendingRef = useRef(pending);
  const pendingSeenRef = useRef(false);
  const resetTimerRef = useRef<number | undefined>(undefined);
  pendingRef.current = pending;
  useEffect(() => {
    if (pending) {
      pendingSeenRef.current = true;
      if (resetTimerRef.current !== undefined) window.clearTimeout(resetTimerRef.current);
      return;
    }
    if (pendingSeenRef.current) {
      pendingSeenRef.current = false;
      submittingRef.current = false;
      setSubmitted(false);
    }
  }, [pending]);
  useEffect(() => () => {
    if (resetTimerRef.current !== undefined) window.clearTimeout(resetTimerRef.current);
  }, []);
  const run = (action: () => void) => {
    if (submittingRef.current || pendingRef.current) return;
    submittingRef.current = true;
    setSubmitted(true);
    try {
      action();
    } catch (error) {
      submittingRef.current = false;
      setSubmitted(false);
      throw error;
    }
    resetTimerRef.current = window.setTimeout(() => {
      if (pendingRef.current || pendingSeenRef.current) return;
      submittingRef.current = false;
      setSubmitted(false);
    }, 0);
  };
  return {
    busy: pending || submitted,
    canClose: () => !submittingRef.current && !pendingRef.current,
    run,
  };
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = '确认',
  pendingLabel = '处理中…',
  pending = false,
  disabled = false,
  danger = false,
  error,
  onClose,
  onConfirm,
}: {
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  pendingLabel?: string;
  pending?: boolean;
  disabled?: boolean;
  danger?: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const lock = useSynchronousPendingLock(pending);
  const close = () => {
    if (!lock.canClose()) return;
    onClose();
  };
  const confirm = () => {
    if (!disabled) lock.run(onConfirm);
  };
  return <Modal title={title} width={500} onClose={close} closable={!lock.busy}>
    <div className={`confirm-dialog${danger ? ' is-danger' : ''}`}>
      <div className="confirm-dialog-message"><span className="confirm-dialog-icon"><AlertTriangle size={21} /></span><div>{description}</div></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><Button variant="secondary" type="button" className="ghost-button" disabled={lock.busy} onClick={close}>取消</Button><Button busy={(lock.busy)} aria-label={lock.busy ? pendingLabel : confirmLabel} tone={danger ? "danger" : "primary"} variant={danger ? "soft" : "primary"} type="button" autoFocus className={`primary-button${danger ? ' danger-button' : ''}`} disabled={lock.busy || disabled} onClick={confirm}>{confirmLabel}</Button></div>
    </div>
  </Modal>;
}

export function ResultDialog({ title, message, value, error = false, onClose }: { title: string; message: ReactNode; value?: string; error?: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copyValue = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value || '');
      else {
        const input = document.createElement('textarea');
        input.value = value || ''; input.style.position = 'fixed'; input.style.opacity = '0';
        document.body.appendChild(input);
        try {
          input.select();
          if (!document.execCommand('copy')) throw new Error('copy failed');
        } finally { input.remove(); }
      }
      setCopied(true); setCopyFailed(false);
    } catch { setCopyFailed(true); }
  };
  return <Modal title={title} width={500} onClose={onClose}>
    <div className={`result-dialog${error ? ' is-error' : ''}`}>
      <div className="result-dialog-message">{error ? <AlertTriangle size={24} /> : <CheckCircle2 size={24} />}<div>{message}</div></div>
      {value && <div className="result-dialog-value"><code>{value}</code><Button variant="ghost" iconOnly type="button" className="icon-button" title="复制" aria-label="复制结果" onClick={() => void copyValue()}><Copy size={16} /></Button>{copied && <span>已复制</span>}{copyFailed && <span>复制失败，请手动选择</span>}</div>}
      <div className="form-actions"><Button variant="primary" type="button" autoFocus className="primary-button" onClick={onClose}>知道了</Button></div>
    </div>
  </Modal>;
}

export function TextPromptModal({
  title,
  description,
  label,
  placeholder,
  confirmLabel = '确认',
  expectedValue,
  pending = false,
  danger = false,
  error,
  blocked = false,
  notice,
  refreshing = false,
  onRefresh,
  onClose,
  onConfirm,
}: {
  title: string;
  description?: ReactNode;
  label: string;
  placeholder?: string;
  confirmLabel?: string;
  expectedValue?: string;
  pending?: boolean;
  danger?: boolean;
  error?: string;
  blocked?: boolean;
  notice?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  onClose: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState('');
  const normalized = value.trim();
  const matches = expectedValue === undefined || value === expectedValue;
  const lock = useSynchronousPendingLock(pending || refreshing);
  const close = () => {
    if (lock.canClose()) onClose();
  };
  return <Modal title={title} width={500} onClose={close} closable={!lock.busy}>
    <form className="text-prompt-form" onSubmit={(event) => {
      event.preventDefault();
      if (normalized && matches && !lock.busy && !blocked) lock.run(() => onConfirm(expectedValue === undefined ? normalized : value));
    }}>
      {description && <div className={danger ? 'text-prompt-description is-danger' : 'text-prompt-description'}>{description}</div>}
      {notice}
      <label className="field field-full"><span>{label}</span>{expectedValue === undefined
        ? <textarea autoFocus rows={4} disabled={lock.busy} value={value} onChange={(event) => setValue(event.target.value)} placeholder={placeholder} />
        : <input autoFocus disabled={lock.busy} value={value} onChange={(event) => setValue(event.target.value)} placeholder={placeholder || expectedValue} autoComplete="off" />}</label>
      {expectedValue !== undefined && <p className="text-prompt-match">请输入完整名称：<strong>{expectedValue}</strong></p>}
      {error && <p className="form-error">{error}</p>}
      {onRefresh && <div><Button busy={(refreshing)} aria-label={refreshing ? '读取中…' : '重新读取需求'} variant="secondary" type="button" className="ghost-button" disabled={lock.busy} onClick={() => lock.run(onRefresh)}>{'重新读取需求'}</Button></div>}
      <div className="form-actions"><Button variant="secondary" type="button" className="ghost-button" disabled={lock.busy} onClick={close}>取消</Button><Button busy={(lock.busy)} aria-label={lock.busy ? '处理中…' : confirmLabel} tone={danger ? "danger" : "primary"} variant={danger ? "soft" : "primary"} type="submit" className={`primary-button${danger ? ' danger-button' : ''}`} disabled={!normalized || !matches || lock.busy || blocked}>{confirmLabel}</Button></div>
    </form>
  </Modal>;
}
