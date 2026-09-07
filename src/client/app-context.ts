import { createContext, useContext } from 'react';
import type { Project, Session } from './types';

/**
 * 全局状态拆分为独立 Context，配合 Provider 端的 useMemo/useCallback，
 * 避免低频状态（如侧边栏折叠）触发所有页面重渲染。
 */
export type SessionContextValue = { session: Session };

export type ProjectsContextValue = {
  projects: Project[];
  selectedProjectId: string;
  /** 静默同步选中项目（详情页深链使用，不触发路由清理）。 */
  syncProjectContext: (id: string) => void;
  /** 主动切换项目（带路由参数清理）。 */
  changeProject: (id: string) => void;
};

export type UiActionsContextValue = {
  openLogin: () => void;
  openPassword: () => void;
};

export type BusinessDateContextValue = { businessDate: string };

/** 顶栏插槽：Topbar 注册挂载点，PageHeader 通过 portal 渲染标题与操作区。 */
export type TopbarSlotsContextValue = {
  titleEl: HTMLElement | null;
  actionsEl: HTMLElement | null;
  setTitleEl: (element: HTMLElement | null) => void;
  setActionsEl: (element: HTMLElement | null) => void;
};

export const SessionContext = createContext<SessionContextValue | null>(null);
export const ProjectsContext = createContext<ProjectsContextValue | null>(null);
export const UiActionsContext = createContext<UiActionsContextValue | null>(null);
export const BusinessDateContext = createContext<BusinessDateContextValue | null>(null);
export const TopbarSlotsContext = createContext<TopbarSlotsContextValue | null>(null);

function useRequired<T>(context: React.Context<T | null>, name: string): T {
  const value = useContext(context);
  if (!value) throw new Error(`${name}未初始化`);
  return value;
}

export function useSession() {
  return useRequired(SessionContext, 'SessionContext');
}

export function useProjects() {
  return useRequired(ProjectsContext, 'ProjectsContext');
}

export function useUiActions() {
  return useRequired(UiActionsContext, 'UiActionsContext');
}

export function useBusinessDate() {
  return useRequired(BusinessDateContext, 'BusinessDateContext');
}

export function useTopbarSlots() {
  return useRequired(TopbarSlotsContext, 'TopbarSlotsContext');
}
