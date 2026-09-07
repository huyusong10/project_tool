import { useSyncExternalStore } from "react";

export const themes = [
  { id: "swiss", label: "瑞士排版", detail: "米白 · 砖红 · 清晰结构" },
  { id: "forest", label: "暖纸森林", detail: "暖纸 · 松绿 · 柔和边界" },
  { id: "midnight", label: "午夜控制台", detail: "深炭 · 薄荷 · 低亮度" },
  { id: "soft", label: "柔彩悬浮", detail: "浅紫 · 柔彩 · 轻阴影" },
  { id: "industrial", label: "工业黄黑", detail: "黑黄 · 方正 · 强网格" },
  { id: "dcim", label: "DCIM 石墨橙", detail: "石墨 · 品牌橙 · 细描边" },
] as const;
export type Theme = typeof themes[number]["id"];
const storageKey = "project-manage:theme";
const listeners = new Set<() => void>();
let current: Theme = "forest";
let initialized = false;

export function resolveTheme(value: string | null): Theme {
  if (value === "dark") return "midnight";
  return themes.some((theme) => theme.id === value) ? value as Theme : "forest";
}
export function getTheme(): Theme { return current; }
export function applyTheme(theme: Theme) {
  current = theme;
  document.documentElement.dataset.theme = theme;
  listeners.forEach((listener) => listener());
}
export function setTheme(theme: Theme) {
  applyTheme(theme);
  try { window.localStorage.setItem(storageKey, theme); } catch { /* 本次页面仍可换肤。 */ }
}
/** 首屏应用；旧明暗偏好迁移到固定风格。 */
export function initTheme() {
  let stored: string | null = null;
  try { stored = window.localStorage.getItem(storageKey); } catch { /* 使用默认风格。 */ }
  applyTheme(resolveTheme(stored));
  if (stored === "dark" || stored === "light") setTheme(current);
  if (!initialized) {
    window.addEventListener("storage", (event) => {
      if (event.key === storageKey || event.key === null) applyTheme(resolveTheme(event.newValue));
    });
    initialized = true;
  }
}
export function useTheme(): Theme {
  return useSyncExternalStore((notify) => {
    listeners.add(notify);
    return () => listeners.delete(notify);
  }, getTheme, () => "forest");
}
