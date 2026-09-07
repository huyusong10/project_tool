import { useSyncExternalStore } from "react";

let media: MediaQueryList | undefined;
const reducedMotionMedia = () => media ??= window.matchMedia("(prefers-reduced-motion: reduce)");
export const prefersReducedMotion = () => reducedMotionMedia().matches;
export const motionScrollBehavior = (): ScrollBehavior => prefersReducedMotion() ? "auto" : "smooth";

function subscribe(notify: () => void) {
  const query = reducedMotionMedia();
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => true);
}

let initialized = false;
export function initMotion() {
  if (initialized) return;
  const update = () => document.documentElement.toggleAttribute("data-page-hidden", document.hidden);
  update();
  document.addEventListener("visibilitychange", update);
  initialized = true;
}

/** 小图表短时过渡；换肤、密集数据和减少动态效果设置直接更新。 */
export function chartAnimationEnabled(option: Record<string, unknown>, reduced: boolean, themeChanged: boolean, visible: boolean) {
  if (reduced || themeChanged || !visible) return false;
  const series = (Array.isArray(option.series) ? option.series : [option.series]) as Array<{ data?: unknown[] } | undefined>;
  return series.reduce((count, item) => count + (Array.isArray(item?.data) ? item.data.length : 0), 0) <= 200;
}
