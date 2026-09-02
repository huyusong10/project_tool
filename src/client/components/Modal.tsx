import { X } from 'lucide-react';
import type { ReactNode } from 'react';

export function Modal({ title, children, onClose, width = 560 }: { title: string; children: ReactNode; onClose: () => void; width?: number }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card" style={{ width }} role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button></header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><strong>{title}</strong><p>{detail}</p>{action}</div>;
}
