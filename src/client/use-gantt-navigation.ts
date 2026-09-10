import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { useSession } from './app-context';
import { buildBusinessDayTimeline, ganttZoomOptions, toGanttDate, type GanttZoom } from './gantt-geometry';
import { ganttAnchorAt, ganttAnchorPixel, ganttDates, surroundGanttAnchor, type GanttAnchor, type GanttBounds } from './gantt-navigation';
import { motionScrollBehavior } from './motion';

type SavedView = { version: 1; anchor: GanttAnchor; zoom: GanttZoom; cellWidth: number; bounds?: GanttBounds };
type Drag = { id: number; x: number; y: number; left: number; active: boolean };
function restore(key: string, legacyKey?: string): Partial<SavedView> {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (saved?.version === 1 && toGanttDate(saved.anchor?.date) && Number.isFinite(saved.anchor.fraction)
      && saved.anchor.fraction >= 0 && saved.anchor.fraction < 1 && saved.zoom in ganttZoomOptions
      && saved.cellWidth >= 1 && saved.cellWidth <= 80) return { ...saved, bounds: toGanttDate(saved.bounds?.start) && toGanttDate(saved.bounds?.end) && saved.bounds.start <= saved.bounds.end ? saved.bounds : undefined };
    const zoom = legacyKey && localStorage.getItem(`project-manage:gantt-zoom:${legacyKey}`);
    if (zoom && zoom in ganttZoomOptions) return { zoom: zoom as GanttZoom, cellWidth: ganttZoomOptions[zoom as GanttZoom].cellWidth };
  } catch { /* A blocked personal-view store must not block browsing. */ }
  return {};
}

/** The scroll surface, footer scrollbar, and date anchor share one navigation state. */
export function useGanttNavigation({ values, asOfDate, storageKey, legacyKey, onPan }: {
  values: Array<string | null | undefined>; asOfDate: string; storageKey: string; legacyKey?: string; onPan?: () => void;
}) {
  const { session } = useSession();
  const key = `pm-gantt-view:1:${session.accountId || session.username || 'guest'}:${storageKey}`;
  const [saved] = useState(() => restore(key, legacyKey));
  const scrollRef = useRef<HTMLDivElement>(null), barRef = useRef<HTMLDivElement>(null);
  const [surface, setSurface] = useState<HTMLDivElement | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => { scrollRef.current = node; setSurface(node); }, []);
  const [scale, setScale] = useState({ zoom: saved.zoom || 'day', cellWidth: saved.cellWidth || 40 });
  const dateKey = values.filter(value => toGanttDate(value)).sort().join('|');
  const base = useMemo(() => buildBusinessDayTimeline(dateKey.split('|'), 'day', asOfDate), [dateKey, asOfDate]);
  const [bounds, setBounds] = useState<GanttBounds>(() => saved.bounds || ({ start: format(base.start, 'yyyy-MM-dd'), end: format(base.end, 'yyyy-MM-dd') }));
  const dates = useMemo(() => ganttDates(bounds), [bounds]);
  const anchor = useRef<GanttAnchor>(saved.anchor || { date: asOfDate, fraction: .5 });
  const drag = useRef<Drag | null>(null), suppressClick = useRef(false), ready = useRef(false);
  const [size, setSize] = useState({ width: 0, fixed: 0 });
  const [visible, setVisible] = useState('');
  const state = useRef({ dates, bounds, scale, size, key, onPan });
  const frame = useRef(0), pointerFrame = useRef(0), lastPointer = useRef(0);
  const timelineWidth = dates.length * scale.cellWidth;
  const usableWidth = Math.max(1, size.width - size.fixed);
  const persist = () => {
    const current = state.current;
    try { sessionStorage.setItem(current.key, JSON.stringify({ version: 1, anchor: anchor.current, bounds: current.bounds, ...current.scale })); } catch { /* Personal view only. */ }
  };
  const syncScrollbar = () => {
    const element = scrollRef.current, bar = barRef.current;
    if (!element || !bar) return;
    const limit = Math.max(0, element.scrollWidth - element.clientWidth);
    const width = Math.min(bar.clientWidth, Math.max(24, bar.clientWidth * element.clientWidth / element.scrollWidth));
    bar.style.setProperty('--gantt-scroll-width', `${width}px`);
    bar.style.setProperty('--gantt-scroll-left', `${limit ? element.scrollLeft / limit * (bar.clientWidth - width) : 0}px`);
    bar.setAttribute('aria-valuenow', String(Math.round(element.scrollLeft)));
    bar.setAttribute('aria-valuemax', String(limit));
  };
  const updateVisible = () => {
    const current = state.current, element = scrollRef.current;
    if (!element) return;
    const width = Math.max(1, current.size.width - current.size.fixed);
    const first = ganttAnchorAt(current.dates, element.scrollLeft, current.scale.cellWidth).date;
    const last = ganttAnchorAt(current.dates, element.scrollLeft + width - 1, current.scale.cellWidth).date;
    const text = `${first.replaceAll('-', '/')} — ${last.replaceAll('-', '/')}`;
    setVisible(previous => previous === text ? previous : text);
  };
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const fixed = [...element.querySelectorAll<HTMLElement>('[data-gantt-fixed]')].reduce((sum, node) => sum + node.getBoundingClientRect().width, 0);
    if (size.fixed !== fixed || size.width !== element.clientWidth) setSize({ width: element.clientWidth, fixed });
  }, [size.fixed, size.width, surface]);
  useLayoutEffect(() => {
    state.current = { dates, bounds, scale, size, key, onPan };
    const element = scrollRef.current;
    if (!element || !size.width) return;
    if (!ready.current && !saved.anchor) anchor.current = { date: asOfDate, fraction: .5 };
    const desired = surroundGanttAnchor({ start: bounds.start < format(base.start, 'yyyy-MM-dd') ? bounds.start : format(base.start, 'yyyy-MM-dd'), end: bounds.end > format(base.end, 'yyyy-MM-dd') ? bounds.end : format(base.end, 'yyyy-MM-dd') }, anchor.current, usableWidth / scale.cellWidth);
    if (desired.start !== bounds.start || desired.end !== bounds.end) { setBounds(desired); return; }
    const left = Math.max(0, ganttAnchorPixel(dates, anchor.current, scale.cellWidth) - usableWidth / 2);
    if (drag.current) drag.current.left += left - element.scrollLeft;
    element.scrollLeft = left;
    syncScrollbar();
    ready.current = true;
    element.dataset.ganttReady = 'true';
    updateVisible();
  // Coordinate publication is independent of row content and callbacks.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates, bounds, scale, size, key, base, usableWidth, surface]);
  // Callback changes do not reinstall pointer listeners or interrupt an active gesture.
  useLayoutEffect(() => { state.current.onPan = onPan; }, [onPan]);
  useEffect(() => {
    const element = scrollRef.current, scrollbar = barRef.current;
    if (!element) return;
    const measure = () => {
      const fixed = [...element.querySelectorAll<HTMLElement>('[data-gantt-fixed]')].reduce((total, node) => total + node.getBoundingClientRect().width, 0);
      const width = element.clientWidth;
      setSize(previous => previous.width === width && previous.fixed === fixed ? previous : { width, fixed });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    const mutation = new MutationObserver(measure);
    mutation.observe(element, { childList: true, subtree: true });
    const publishScroll = () => {
      frame.current = 0;
      if (!ready.current) return;
      const current = state.current, width = Math.max(1, current.size.width - current.size.fixed);
      anchor.current = ganttAnchorAt(current.dates, element.scrollLeft + width / 2, current.scale.cellWidth);
      syncScrollbar();
      updateVisible(); persist();
      const limit = element.scrollWidth - element.clientWidth, threshold = width * .6;
      if (element.scrollLeft < threshold || limit - element.scrollLeft < threshold) {
        const desired = surroundGanttAnchor(current.bounds, anchor.current, width / current.scale.cellWidth);
        if (desired.start !== current.bounds.start || desired.end !== current.bounds.end) setBounds(desired);
      }
    };
    const scroll = () => {
      const current = state.current;
      if (ready.current) anchor.current = ganttAnchorAt(current.dates, element.scrollLeft + Math.max(1, current.size.width - current.size.fixed) / 2, current.scale.cellWidth);
      if (!frame.current) frame.current = requestAnimationFrame(publishScroll);
    };
    let barPointer: { id: number; offset: number } | null = null;
    const moveBar = (event: PointerEvent) => {
      if (!scrollbar || barPointer?.id !== event.pointerId) return;
      const thumb = scrollbar.firstElementChild!.getBoundingClientRect();
      const travel = Math.max(1, scrollbar.clientWidth - thumb.width);
      const x = event.clientX - scrollbar.getBoundingClientRect().left - barPointer.offset;
      element.scrollLeft = Math.max(0, Math.min(1, x / travel)) * (element.scrollWidth - element.clientWidth);
      syncScrollbar(); event.preventDefault();
    };
    const startBar = (event: PointerEvent) => {
      if (!scrollbar || event.button !== 0) return;
      const thumb = scrollbar.firstElementChild!.getBoundingClientRect();
      barPointer = { id: event.pointerId, offset: (event.target as Element).classList.contains('gantt-scroll-thumb') ? event.clientX - thumb.left : thumb.width / 2 };
      scrollbar.setPointerCapture(event.pointerId); state.current.onPan?.(); moveBar(event);
    };
    const stopBar = () => { const previous = barPointer; barPointer = null; if (previous && scrollbar?.hasPointerCapture(previous.id)) scrollbar.releasePointerCapture(previous.id); };
    const cancel = () => {
      stopBar();
      const current = drag.current; drag.current = null;
      delete element.dataset.ganttPanning;
      if (current && element.hasPointerCapture(current.id)) element.releasePointerCapture(current.id);
      cancelAnimationFrame(pointerFrame.current); pointerFrame.current = 0;
    };
    const down = (event: PointerEvent) => {
      suppressClick.current = false;
      if (event.button !== 0 && event.button !== 1 || event.ctrlKey || event.metaKey) return;
      const target = event.target as Element;
      if (!target.closest('.unified-gantt-track,.gantt-scale,.gantt-milestone-rail,.path-draft-gantt-track') || target.closest('input,select,textarea,a,.gantt-milestone-label,.gantt-milestone-actual')) return;
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, active: false };
      if (event.button === 1) event.preventDefault();
    };
    const applyPointer = () => {
      pointerFrame.current = 0;
      const current = drag.current;
      if (current?.active) element.scrollLeft = current.left + current.x - lastPointer.current;
    };
    const move = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      if (!current.active) {
        if (event.pointerType === 'touch' && Math.abs(event.clientY - current.y) > Math.abs(event.clientX - current.x)) { cancel(); return; }
        if (Math.abs(event.clientX - current.x) < 5) return;
        current.active = true; suppressClick.current = true;
        element.dataset.ganttPanning = 'true'; element.setPointerCapture(event.pointerId); state.current.onPan?.();
      }
      event.preventDefault(); lastPointer.current = event.clientX;
      if (!pointerFrame.current) pointerFrame.current = requestAnimationFrame(applyPointer);
    };
    const up = (event: PointerEvent) => {
      if (drag.current?.id !== event.pointerId) return;
      if (drag.current.active) { lastPointer.current = event.clientX; applyPointer(); publishScroll(); }
      cancel();
    };
    const click = (event: MouseEvent) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      const delta = event.shiftKey ? event.deltaY || event.deltaX : Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : 0;
      if (!delta) return;
      event.preventDefault(); state.current.onPan?.(); element.scrollLeft += delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && drag.current) { cancel(); event.preventDefault(); return; }
      if (event.target !== element && event.target !== scrollbar) return;
      const step = event.key === 'ArrowLeft' ? -80 : event.key === 'ArrowRight' ? 80 : event.key === 'PageUp' ? -element.clientWidth : event.key === 'PageDown' ? element.clientWidth : 0;
      if (step) { event.preventDefault(); element.scrollLeft += step; }
    };
    const hidden = () => { if (document.hidden) cancel(); };
    element.addEventListener('scroll', scroll);
    scrollbar?.addEventListener('pointerdown', startBar); scrollbar?.addEventListener('pointermove', moveBar);
    scrollbar?.addEventListener('pointerup', stopBar); scrollbar?.addEventListener('pointercancel', stopBar); scrollbar?.addEventListener('lostpointercapture', stopBar); scrollbar?.addEventListener('keydown', keyboard);
    element.addEventListener('pointerdown', down); element.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up); element.addEventListener('pointercancel', cancel);
    element.addEventListener('lostpointercapture', cancel); element.addEventListener('click', click, true);
    element.addEventListener('wheel', wheel, { passive: false }); element.addEventListener('keydown', keyboard);
    window.addEventListener('blur', cancel); document.addEventListener('visibilitychange', hidden);
    return () => {
      if (ready.current) persist();
      cancel(); cancelAnimationFrame(frame.current); frame.current = 0;
      observer.disconnect(); mutation.disconnect();
      element.removeEventListener('scroll', scroll);
      scrollbar?.removeEventListener('pointerdown', startBar); scrollbar?.removeEventListener('pointermove', moveBar);
      scrollbar?.removeEventListener('pointerup', stopBar); scrollbar?.removeEventListener('pointercancel', stopBar); scrollbar?.removeEventListener('lostpointercapture', stopBar); scrollbar?.removeEventListener('keydown', keyboard);
      element.removeEventListener('pointerdown', down); element.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up); element.removeEventListener('pointercancel', cancel);
      element.removeEventListener('lostpointercapture', cancel); element.removeEventListener('click', click, true);
      element.removeEventListener('wheel', wheel); element.removeEventListener('keydown', keyboard);
      window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', hidden);
    };
  // The surface may appear after data arrives or return after an empty filter result.
  }, [surface, key]);
  const captureAnchor = () => {
    const element = scrollRef.current;
    if (element && ready.current) anchor.current = ganttAnchorAt(dates, element.scrollLeft + usableWidth / 2, scale.cellWidth);
  };
  const navigateTo = (date: string) => {
    if (!toGanttDate(date)) return;
    const target = { date, fraction: .5 };
    const desired = surroundGanttAnchor(bounds, target, usableWidth / scale.cellWidth);
    if (desired.start !== bounds.start || desired.end !== bounds.end) { anchor.current = target; setBounds(desired); }
    else scrollRef.current?.scrollTo({ left: Math.max(0, ganttAnchorPixel(dates, target, scale.cellWidth) - usableWidth / 2), behavior: motionScrollBehavior() });
  };
  const fit = () => {
    const width = Math.max(1, Math.min(40, usableWidth / base.days));
    anchor.current = ganttAnchorAt(base.dates, base.days / 2, 1);
    setScale({ zoom: width >= 32 ? 'day' : width >= 10 ? 'week' : 'month', cellWidth: width });
    // Also moves to the data when it already has the requested density.
    setBounds(previous => ({ ...previous }));
  };
  return {
    scrollRef, attach, barRef, zoom: scale.zoom, cellWidth: scale.cellWidth, dates, timelineWidth,
    viewportWidth: size.width, totalWidth: timelineWidth + size.fixed, visible,
    changeZoom: (zoom: GanttZoom) => { captureAnchor(); setScale({ zoom, cellWidth: ganttZoomOptions[zoom].cellWidth }); },
    today: () => navigateTo(asOfDate), navigateTo, fit,
  };
}
