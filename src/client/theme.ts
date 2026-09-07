import { useSyncExternalStore } from "react";

export const themes = [
  { id: "classic", label: "经典蓝白", detail: "默认日间 · 最初配色" },
  { id: "dcim", label: "杰瑞橙", detail: "默认夜间 · 石墨与橙色点缀" },
  { id: "swiss", label: "瑞士排版", detail: "米白 · 砖红 · 清晰结构" },
  { id: "forest", label: "暖纸森林", detail: "暖纸 · 松绿 · 柔和边界" },
  { id: "midnight", label: "午夜控制台", detail: "深炭 · 薄荷 · 低亮度" },
  { id: "soft", label: "柔彩悬浮", detail: "浅紫 · 柔彩 · 轻阴影" },
  { id: "industrial", label: "工业黄黑", detail: "黑黄 · 方正 · 强网格" },
] as const;
export type Theme = typeof themes[number]["id"];
export type ThemePreference = Theme | "system";
const storageKey = "project-manage:theme";
const listeners = new Set<() => void>();
export const dayTheme: Theme = "classic";
export const nightTheme: Theme = "dcim";
let preference: ThemePreference = "system";
let current: Theme = dayTheme;
let initialized = false;
let systemScheme: MediaQueryList | undefined;

export function resolveThemePreference(value: string | null): ThemePreference {
  if (value === "dark") return nightTheme;
  if (value === "light") return dayTheme;
  return themes.some((theme) => theme.id === value) ? value as Theme : "system";
}
export function resolveTheme(value: string | null, dark = false): Theme {
  const selected = resolveThemePreference(value);
  return selected === "system" ? (dark ? nightTheme : dayTheme) : selected;
}
export function getTheme(): Theme { return current; }
function applyPreference(value: ThemePreference) {
  preference = value;
  current = resolveTheme(value, systemScheme?.matches);
  document.documentElement.dataset.theme = current;
  document.documentElement.dataset.themePreference = preference;
  listeners.forEach((listener) => listener());
}
export function setTheme(value: ThemePreference) {
  applyPreference(value);
  try { window.localStorage.setItem(storageKey, value); } catch { /* 本次页面仍可换肤。 */ }
}
/** 首屏应用；无偏好时跟随系统，手选风格不受系统变化影响。 */
export function initTheme() {
  systemScheme ??= window.matchMedia("(prefers-color-scheme: dark)");
  let stored: string | null = null;
  try { stored = window.localStorage.getItem(storageKey); } catch { /* 使用默认风格。 */ }
  applyPreference(resolveThemePreference(stored));
  if (stored === "dark" || stored === "light") setTheme(preference);
  if (!initialized) {
    window.addEventListener("storage", (event) => {
      if (event.key === storageKey || event.key === null) applyPreference(resolveThemePreference(event.newValue));
    });
    systemScheme.addEventListener("change", () => { if (preference === "system") applyPreference("system"); });
    initialized = true;
  }
}
function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => { listeners.delete(notify); };
}
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, () => dayTheme);
}
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, () => preference, () => "system");
}
