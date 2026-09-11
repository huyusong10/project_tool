import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { createPortal } from "react-dom";
import { useTopbarSlots } from "../app-context";
import { useGanttTooltip } from "./GanttTooltip";
import { TopbarMenu } from './TopbarMenu';

/**
 * 页面标题/操作区：通过 TopbarSlotsContext 注册的挂载点 portal 到顶栏，
 * 不再依赖静态 DOM id 暗号。
 */
export function PageHeader({
  title,
  actions,
  secondaryActions,
  moreActions,
  moreLabel = '更多操作',
  moreDisabled = false,
  context,
  status,
  persistentStatus = false,
  onBack,
  backLabel = "返回",
}: {
  title: string;
  actions?: ReactNode;
  secondaryActions?: ReactNode;
  moreActions?: ReactNode;
  moreLabel?: string;
  moreDisabled?: boolean;
  context?: ReactNode;
  status?: ReactNode;
  persistentStatus?: boolean;
  onBack?: () => void;
  backLabel?: string;
}) {
  const { titleEl, actionsEl, contextEl, statusEl, width } = useTopbarSlots();
  const compact = width < 960;
  const dense = width < 360;
  const menu = <>{dense && !persistentStatus && status && <div className="topbar-menu-status" role="status">{status}</div>}{compact && secondaryActions}{moreActions}</>;
  const hasMenu = Boolean(moreActions || compact && secondaryActions || dense && !persistentStatus && status);
  const fullTitle = useGanttTooltip();
  const titleEvents = fullTitle.bind(<div className="page-title-full">{title}</div>);

  if (!titleEl) return null;
  return (
    <>
      {fullTitle.tooltip}
      {createPortal(
        <div className="integrated-page-title" data-workspace-zone="tools">
          {onBack && (
            <button onClick={onBack} aria-label={backLabel} title={backLabel}>
              <ArrowLeft size={17} />
              <span>{backLabel}</span>
            </button>
          )}
          <h1 title={title} tabIndex={0} {...titleEvents}
            onPointerEnter={(event) => { if (event.currentTarget.scrollWidth > event.currentTarget.clientWidth) titleEvents.onPointerEnter(event); }}
            onPointerMove={(event) => { if (event.currentTarget.scrollWidth > event.currentTarget.clientWidth) titleEvents.onPointerMove(event); }}
            onFocus={(event) => { if (event.currentTarget.scrollWidth > event.currentTarget.clientWidth) titleEvents.onFocus(event); }}
          >{title}</h1>
        </div>,
        titleEl,
      )}
      {context && contextEl ? createPortal(<div className="topbar-page-context" data-workspace-zone="tools">{context}</div>, contextEl) : null}
      {status && (!dense || persistentStatus) && statusEl ? createPortal(<div className="topbar-page-status" role="status" data-workspace-zone="tools">{status}</div>, statusEl) : null}
      {(actions || secondaryActions || moreActions) && actionsEl ? createPortal(<div className="integrated-page-actions" data-workspace-zone="tools">
        {!compact && secondaryActions}{actions}{hasMenu && <TopbarMenu label={moreLabel} disabled={moreDisabled}>{menu}</TopbarMenu>}
      </div>, actionsEl) : null}
    </>
  );
}
