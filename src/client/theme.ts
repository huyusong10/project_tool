import { useSyncExternalStore } from "react";
import {dayTheme, resolveTheme, resolveThemePreference, type Theme, type ThemePreference} from './theme-preference';
export {themes, dayTheme, nightTheme, resolveTheme, resolveThemePreference, type Theme, type ThemePreference} from './theme-preference';
const storageKey = "project-manage:theme";
const listeners = new Set<() => void>();
let preference: ThemePreference = "system";
let current: Theme = dayTheme;
let initialized = false;
let systemScheme: MediaQueryList | undefined;

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
