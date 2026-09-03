import { useEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

type TooltipState = { x: number; y: number; content: ReactNode };

export function useGanttTooltip() {
  const [state, setState] = useState<TooltipState | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (!closeTimer.current) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setState(null), 120);
  };
  useEffect(() => () => cancelClose(), []);
  const bind = (content: ReactNode) => ({
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      cancelClose();
      setState({ x: event.clientX, y: event.clientY, content });
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => setState((current) => current ? { ...current, x: event.clientX, y: event.clientY } : current),
    onPointerLeave: closeSoon,
    onFocus: (event: FocusEvent<HTMLElement>) => {
      cancelClose();
      const bounds = event.currentTarget.getBoundingClientRect();
      setState({ x: bounds.left + bounds.width / 2, y: bounds.bottom, content });
    },
    onBlur: closeSoon,
  });
  const tooltip = state && typeof document !== "undefined" ? (() => {
    const width = Math.min(400, window.innerWidth - 24);
    const viewportMaxHeight = Math.min(520, window.innerHeight - 24);
    const spaceBelow = window.innerHeight - state.y - 12;
    const spaceAbove = state.y - 12;
    const placeBelow = spaceBelow >= Math.min(260, viewportMaxHeight) || spaceBelow >= spaceAbove;
    const maxHeight = Math.max(120, Math.min(viewportMaxHeight, (placeBelow ? spaceBelow : spaceAbove) - 2));
    const left = state.x + width + 26 <= window.innerWidth
      ? state.x + 14
      : Math.max(12, state.x - width - 14);
    const top = placeBelow
      ? state.y + 14
      : Math.max(12, state.y - maxHeight - 14);
    return createPortal(
    <div
      className="gantt-popover"
      role="tooltip"
      onPointerEnter={cancelClose}
      onPointerLeave={closeSoon}
      style={{
        left,
        top,
        width,
        maxHeight,
      }}
    >
      {state.content}
    </div>,
    document.body,
    );
  })() : null;
  return { bind, tooltip };
}
