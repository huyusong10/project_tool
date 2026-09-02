import { useState, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

type TooltipState = { x: number; y: number; content: ReactNode };

export function useGanttTooltip() {
  const [state, setState] = useState<TooltipState | null>(null);
  const bind = (content: ReactNode) => ({
    onPointerEnter: (event: PointerEvent<HTMLElement>) => setState({ x: event.clientX, y: event.clientY, content }),
    onPointerMove: (event: PointerEvent<HTMLElement>) => setState((current) => current ? { ...current, x: event.clientX, y: event.clientY } : current),
    onPointerLeave: () => setState(null),
    onFocus: (event: FocusEvent<HTMLElement>) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      setState({ x: bounds.left + bounds.width / 2, y: bounds.bottom, content });
    },
    onBlur: () => setState(null),
  });
  const tooltip = state && typeof document !== "undefined" ? createPortal(
    <div
      className="gantt-popover"
      role="tooltip"
      style={{
        left: Math.max(12, Math.min(window.innerWidth - 372, state.x > window.innerWidth - 390 ? state.x - 356 : state.x + 14)),
        top: Math.max(12, Math.min(window.innerHeight - 304, state.y > window.innerHeight - 320 ? state.y - 286 : state.y + 14)),
      }}
    >
      {state.content}
    </div>,
    document.body,
  ) : null;
  return { bind, tooltip };
}
