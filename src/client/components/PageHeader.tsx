import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { createPortal } from "react-dom";
import { useTopbarSlots } from "../app-context";
import { useGanttTooltip } from "./GanttTooltip";

/**
 * 页面标题/操作区：通过 TopbarSlotsContext 注册的挂载点 portal 到顶栏，
 * 不再依赖静态 DOM id 暗号。
 */
export function PageHeader({
  title,
  actions,
  onBack,
  backLabel = "返回",
}: {
  title: string;
  actions?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
}) {
  const { titleEl, actionsEl } = useTopbarSlots();
  const fullTitle = useGanttTooltip();

  if (!titleEl) return null;
  return (
    <>
      {fullTitle.tooltip}
      {createPortal(
        <div className="integrated-page-title">
          {onBack && (
            <button onClick={onBack} aria-label={backLabel} title={backLabel}>
              <ArrowLeft size={17} />
            </button>
          )}
          <h1 tabIndex={0} {...fullTitle.bind(<div className="page-title-full">{title}</div>)}>{title}</h1>
        </div>,
        titleEl,
      )}
      {actions && actionsEl ? createPortal(<div className="integrated-page-actions">{actions}</div>, actionsEl) : null}
    </>
  );
}
