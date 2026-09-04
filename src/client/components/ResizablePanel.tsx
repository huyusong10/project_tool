import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

type ResizablePanelProps = ComponentPropsWithoutRef<"section"> & {
  storageKey: string;
  defaultHeight: number;
  minHeight: number;
  maxViewportRatio?: number | null;
};

const storagePrefix = "project-manage:panel-height:";

function maximumHeight(minHeight: number, ratio: number | null) {
  return ratio === null ? Number.MAX_SAFE_INTEGER : Math.max(minHeight, Math.floor(window.innerHeight * ratio));
}

function clampHeight(value: number, minHeight: number, maxHeight: number) {
  return Math.min(maxHeight, Math.max(minHeight, Math.round(value)));
}

function storedHeight(storageKey: string) {
  try {
    const value = Number(window.localStorage.getItem(`${storagePrefix}${storageKey}`));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function saveHeight(storageKey: string, value: number | null) {
  try {
    if (value === null) window.localStorage.removeItem(`${storagePrefix}${storageKey}`);
    else window.localStorage.setItem(`${storagePrefix}${storageKey}`, String(value));
  } catch {
    // Storage can be unavailable in hardened browser contexts; resizing still works for the current page.
  }
}

export function ResizablePanel({
  storageKey,
  defaultHeight,
  minHeight,
  maxViewportRatio = null,
  className = "",
  style,
  children,
  ...props
}: ResizablePanelProps) {
  const maxHeight = () => maximumHeight(minHeight, maxViewportRatio);
  const defaultPanelHeight = () => clampHeight(defaultHeight, minHeight, maxHeight());
  const [height, setHeight] = useState(() => clampHeight(storedHeight(storageKey) ?? defaultHeight, minHeight, maxHeight()));
  const heightRef = useRef(height);
  const dragRef = useRef<{ pointerId: number; startY: number; startHeight: number } | undefined>(undefined);

  const updateHeight = (value: number) => {
    const next = clampHeight(value, minHeight, maxHeight());
    heightRef.current = next;
    setHeight(next);
    return next;
  };

  const resetHeight = () => {
    const next = updateHeight(defaultPanelHeight());
    saveHeight(storageKey, null);
    return next;
  };

  useEffect(() => {
    const next = clampHeight(storedHeight(storageKey) ?? defaultHeight, minHeight, maximumHeight(minHeight, maxViewportRatio));
    heightRef.current = next;
    setHeight(next);
  }, [defaultHeight, minHeight, maxViewportRatio, storageKey]);

  useEffect(() => {
    const onResize = () => {
      const previous = heightRef.current;
      const next = clampHeight(previous, minHeight, maximumHeight(minHeight, maxViewportRatio));
      heightRef.current = next;
      setHeight(next);
      if (next !== previous) saveHeight(storageKey, next);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [minHeight, maxViewportRatio, storageKey]);

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: heightRef.current };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const continueResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    updateHeight(drag.startHeight + event.clientY - drag.startY);
  };

  const finishResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    saveHeight(storageKey, heightRef.current);
  };

  const resizeFromKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Home") {
      event.preventDefault();
      resetHeight();
      return;
    }
    const delta = event.key === "ArrowUp" ? -24 : event.key === "ArrowDown" ? 24 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = updateHeight(heightRef.current + delta);
    saveHeight(storageKey, next);
  };

  return <section
    {...props}
    className={`resizable-panel ${className}`.trim()}
    style={{ ...style, height, minHeight, maxHeight: maxViewportRatio === null ? undefined : `${maxViewportRatio * 100}dvh` } as CSSProperties}
  >
    {children}
    <button
      type="button"
      className="panel-resize-handle"
      aria-label="调整卡片高度"
      title="上下拖动调整高度；双击或按 Home 恢复默认"
      onPointerDown={beginResize}
      onPointerMove={continueResize}
      onPointerUp={finishResize}
      onPointerCancel={finishResize}
      onDoubleClick={resetHeight}
      onKeyDown={resizeFromKeyboard}
    />
  </section>;
}
