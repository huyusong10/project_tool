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
  /** 主动切换项目（带路由参数清理）。 */
  changeProject: (id: string) => void;
};

export type UiActionsContextValue = {
  openLogin: () => void;
  openPassword: () => void;
};

export type BusinessDateContextValue = { businessDate: string };

export const SessionContext = createContext<SessionContextValue | null>(null);
export const ProjectsContext = createContext<ProjectsContextValue | null>(null);
export const UiActionsContext = createContext<UiActionsContextValue | null>(null);
export const BusinessDateContext = createContext<BusinessDateContextValue | null>(null);

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

export function useGuestWorkspace(projectId?: string) {
  const {session}=useSession(),{projects,selectedProjectId}=useProjects();
  return !session.authenticated || Boolean(projects.find(p=>p.id===(projectId||selectedProjectId))?.publicReadOnly);
}

export function useUiActions() {
  return useRequired(UiActionsContext, 'UiActionsContext');
}

export function useBusinessDate() {
  return useRequired(BusinessDateContext, 'BusinessDateContext');
}
