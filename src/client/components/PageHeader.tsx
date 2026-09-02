import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { createPortal } from "react-dom";

export function PageHeader({
  title,
  actions,
  onBack,
}: {
  title: string;
  actions?: ReactNode;
  onBack?: () => void;
}) {
  const [slots, setSlots] = useState<{ title: HTMLElement; actions: HTMLElement }>();

  useEffect(() => {
    const titleSlot = document.getElementById("topbar-title-slot");
    const actionSlot = document.getElementById("topbar-action-slot");
    if (titleSlot && actionSlot) setSlots({ title: titleSlot, actions: actionSlot });
  }, []);

  if (!slots) return null;
  return (
    <>
      {createPortal(
        <div className="integrated-page-title">
          {onBack && (
            <button onClick={onBack} aria-label="返回项目进展" title="返回项目进展">
              <ArrowLeft size={17} />
            </button>
          )}
          <h1 title={title}>{title}</h1>
        </div>,
        slots.title,
      )}
      {actions ? createPortal(<div className="integrated-page-actions">{actions}</div>, slots.actions) : null}
    </>
  );
}
