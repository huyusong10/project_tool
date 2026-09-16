import {createContext, useContext} from 'react';
export type ObjectDetailSession = {key: string; tab?: string; onTabChange?: (tab: string) => void};
export const ObjectDetailContext = createContext<ObjectDetailSession | null>(null);
export const useObjectDetail = () => useContext(ObjectDetailContext);
export function readDetailMemory<T>(key: string, fallback: T): T {
  try { return JSON.parse(sessionStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
export function writeDetailMemory(key: string, value: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep the open detail usable. */ }
}

export const GraphInspectContext = createContext<((id:string)=>void)|null>(null);
export const useGraphInspect = () => useContext(GraphInspectContext);
