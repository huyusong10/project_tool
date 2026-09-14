import {createChromeStore} from './page-foundation';
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { WorkspaceRuntime } from './workspace-runtime';

export type PageChrome = {
  title: string; titlePending?: boolean; actions?: ReactNode; secondaryActions?: ReactNode;
  breadcrumbs?: Array<{label:string;onClick?:()=>void}>; navigationLabel?:string; views?:ReactNode;
  moreActions?: ReactNode; moreLabel?: string; moreDisabled?: boolean;
  context?: ReactNode; status?: ReactNode; onBack?: () => void; backLabel?: string;
  runtime?: WorkspaceRuntime | null;
};

export const createPageChrome = (key: string) => createChromeStore<PageChrome>(key);
export type PageChromeStore = ReturnType<typeof createPageChrome>;
export const PageChromeContext = createContext<PageChromeStore | null>(null);
export function usePageChromeStore() {
  const store = useContext(PageChromeContext);
  if (!store) throw new Error('页面外壳未初始化');
  return store;
}
export function usePageChrome() {
  const store = usePageChromeStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
