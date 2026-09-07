import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const storageKey = "project-manage:theme";
const listeners = new Set<() => void>();

export function getTheme(): Theme {
  return window.localStorage.getItem(storageKey) === "dark" ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme) {
  window.localStorage.setItem(storageKey, theme);
  applyTheme(theme);
  listeners.forEach((listener) => listener());
}

export function toggleTheme() {
  setTheme(getTheme() === "dark" ? "light" : "dark");
}

/** 首屏渲染前调用，避免主题闪烁。 */
export function initTheme() {
  applyTheme(getTheme());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    getTheme,
  );
}
