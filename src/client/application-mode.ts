import { createContext, useContext } from 'react';

export const ApplicationModeContext = createContext(false);
export const useIssueTrackingOnly = () => useContext(ApplicationModeContext);

/** 页面和导航共用同一个范围；原有角色权限继续生效。 */
export const isIssueTrackingRoute = (pathname: string) =>
  ['/issues', '/settings', '/project-settings', '/resources', '/system', '/accounts'].includes(pathname);

export function issueTrackingHome(projectId?: string | null) {
  return '/issues' + (projectId ? '?' + new URLSearchParams({ projectId }) : '');
}
