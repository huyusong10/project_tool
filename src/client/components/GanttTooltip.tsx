import { useEffect, useRef, useState, useSyncExternalStore, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

type TooltipState = { x: number; y: number; content: ReactNode };
let closeActiveTooltip: (() => void) | undefined;

function createTooltipStore() {
  let state: TooltipState | null = null;
  const listeners = new Set<() => void>();
  const close = () => { state = null; listeners.forEach((notify) => notify()); };
  return {
    getSnapshot: () => state,
    subscribe: (notify: () => void) => { listeners.add(notify); return () => listeners.delete(notify); },
    set: (next: TooltipState | null) => {
      if (next) {
        if (closeActiveTooltip !== close) closeActiveTooltip?.();
        closeActiveTooltip = close;
      } else if (closeActiveTooltip === close) closeActiveTooltip = undefined;
      state = next; listeners.forEach((notify) => notify());
    },
  };
}
type TooltipStore = ReturnType<typeof createTooltipStore>;

/** 指针移动只更新浮层，不重绘整张甘特图。 */
export function useGanttTooltip() {
  const [store] = useState(createTooltipStore);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (!closeTimer.current) return;
    clearTimeout(closeTimer.current); closeTimer.current = null;
  };
  const closeSoon = () => { cancelClose(); closeTimer.current = setTimeout(() => store.set(null), 120); };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); store.set(null); }, [store]);
  const bind = (content: ReactNode) => ({
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      if (event.buttons) return;
      cancelClose(); store.set({ x: event.clientX, y: event.clientY, content });
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (event.buttons) return;
      cancelClose(); store.set({ x: event.clientX, y: event.clientY, content });
    },
    onPointerLeave: closeSoon,
    onFocus: (event: FocusEvent<HTMLElement>) => {
      cancelClose(); const bounds = event.currentTarget.getBoundingClientRect();
      store.set({ x: bounds.left + bounds.width / 2, y: bounds.bottom, content });
    },
    onBlur: closeSoon,
  });
  return { bind, close: () => { cancelClose(); store.set(null); }, tooltip: <TooltipLayer store={store} onEnter={cancelClose} onLeave={closeSoon} /> };
}

function TooltipLayer({ store, onEnter, onLeave }: { store: TooltipStore; onEnter: () => void; onLeave: () => void }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, () => null);
  const open = Boolean(state);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('.gantt-popover')) return;
      store.set(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') store.set(null); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); window.removeEventListener('keydown', escape); };
  }, [open, store]);
  if (!state || typeof document === 'undefined') return null;
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
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
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
}
