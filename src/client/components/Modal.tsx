import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Modal({ title, children, onClose, width = 560, closable = true, layout = 'adaptive' }: { title: string; children: ReactNode; onClose: () => void; width?: number; closable?: boolean; layout?: 'adaptive' | 'workspace' }) {
  const content = (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => closable && event.target === event.currentTarget && onClose()}>
      <section className={`modal-card modal-card-${layout}`} style={{ width, maxWidth: width ? `min(94vw, ${width}px)` : undefined }} role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2>{closable && <button className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button>}</header>
        <div className={`modal-body modal-body-${layout}`}>{children}</div>
      </section>
    </div>
  );
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><strong>{title}</strong><p>{detail}</p>{action}</div>;
}
