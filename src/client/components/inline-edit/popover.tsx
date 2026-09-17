
import { MenuButtons } from "../Button";
import { type AriaRole, type ReactNode, type RefObject, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { InlineEditContext } from './shared';

export function AnchoredPopover({
  anchorRef,
  open,
  onOutside,
  onEscape = onOutside,
  onSuperseded = onOutside,
  children,
  className = "",
  width = 320,
  matchAnchor = false,
  align = 'start',
  role = "dialog",
  preserveEditing = false,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onOutside: () => void;
  onEscape?: () => void;
  onSuperseded?: () => void;
  children: ReactNode;
  className?: string;
  width?: number;
  matchAnchor?: boolean;
  align?: 'start'|'end';
  role?: AriaRole;
  preserveEditing?: boolean;
}) {
  const context = useContext(InlineEditContext);
  const activate = preserveEditing ? undefined : context?.activate;
  const deactivate = preserveEditing ? undefined : context?.deactivate;
  const editorId = useId();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width, maxHeight: 640, ready: false });
  const [ownershipReady, setOwnershipReady] = useState(false);

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const boundary=anchor.closest('[role=dialog]')?.getBoundingClientRect();
    const minLeft=boundary?Math.max(12,boundary.left+12):12,maxRight=boundary?Math.min(window.innerWidth-12,boundary.right-12):window.innerWidth-12;
    const availableWidth = Math.max(160, maxRight-minLeft);
    const layerWidth = Math.min(Math.max(width, matchAnchor ? rect.width : 0), availableWidth);
    const measuredHeight = popoverRef.current?.offsetHeight || 240;
    const left = Math.min(Math.max(minLeft, align==='end'?rect.right-layerWidth:rect.left), maxRight-layerWidth);
    const minTop=boundary?Math.max(12,boundary.top+12):12,maxBottom=boundary?Math.min(window.innerHeight-12,boundary.bottom-12):window.innerHeight-12;
    const maxHeight=Math.max(80,maxBottom-minTop),height=Math.min(measuredHeight,maxHeight);
    const below = rect.bottom + 7;
    const top = below + height <= maxBottom ? Math.max(minTop,below) : Math.max(minTop,Math.min(rect.top-height-7,maxBottom-height));
    setPosition({ top, left, width: layerWidth, maxHeight, ready: true });
  }, [anchorRef, matchAnchor, width, align]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition((current) => ({ ...current, ready: false }));
      return;
    }
    reposition();
    const frame = window.requestAnimationFrame(reposition);
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reposition);
    if (popoverRef.current) resizeObserver?.observe(popoverRef.current);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open || !activate || !deactivate) {
      setOwnershipReady(false);
      return;
    }
    setOwnershipReady(false);
    activate(editorId, anchorRef.current);
    // 等上下文确认本浮层成为当前编辑器后，再响应其他编辑器的抢占。
    // 否则从旧浮层直接切换操作菜单时，会读取到上一帧的 activeId 并立即关闭自己。
    const frame = window.requestAnimationFrame(() => setOwnershipReady(true));
    return () => {
      window.cancelAnimationFrame(frame);
      deactivate(editorId);
    };
  }, [activate, deactivate, editorId, open, anchorRef]);

  useEffect(() => {
    if (open && ownershipReady && context?.activeId && context.activeId !== editorId) onSuperseded();
  }, [context?.activeId, editorId, onSuperseded, open, ownershipReady]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!preserveEditing && target instanceof Element && target.closest("[data-preserve-edit]")) return;
      if (anchorRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      onOutside();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
      if (event.target instanceof Element && event.target.closest("[data-preserve-edit]")) return;
      event.preventDefault();
      onEscape();
    };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [anchorRef, onEscape, onOutside, open, preserveEditing]);

  if (!open) return null;
  return createPortal(
    <MenuButtons enabled={false}>
    <div
      ref={popoverRef}
      className={`inline-edit-popover ${className}`.trim()}
      style={{ top: position.top, left: position.left, width: position.width, maxHeight:position.maxHeight, overflowY:"auto", visibility: position.ready ? "visible" : "hidden" }}
      role={role}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div></MenuButtons>,
    anchorRef.current?.closest('[role=dialog]') || document.body,
  );
}
