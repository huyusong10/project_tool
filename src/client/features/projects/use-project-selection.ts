import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Project, Session } from '../../types';
import type { ResolvedPageContext } from '../../page-context';
import { rememberProject } from '../../page-context';
import { sessionAccessKey } from '../../session-identity';
import { createPageChrome } from '../../page-chrome';
import { usePageReturnSource } from '../../page-return';
import { useProjectRefresh } from '../../use-project-refresh';
export function useProjectSelection(page: ResolvedPageContext, projects: Project[], session: Session, projectsEnabled: boolean) {
  const location=useLocation(),navigate=useNavigate();
  // 已确认的项目是当前工作范围。读取下一对象期间保留它，不把一次导航当作重新启动。
  // 只保留身份和 ID，每次仍从最新可访问项目中解析，权限失效时不能沿用旧对象。
  const accessKey = sessionAccessKey(session);
  usePageReturnSource(accessKey,page.project?.id||'');
  const [activeScope, setActiveScope] = useState<{accessKey: string; projectId: string} | null>(null);
  const resolvedProjectId = page.project?.id;
  useEffect(() => {
    if (page.phase === 'ready' && resolvedProjectId) setActiveScope(previous =>
      previous?.accessKey === accessKey && previous.projectId === resolvedProjectId ? previous : {accessKey, projectId: resolvedProjectId});
    else if (activeScope && activeScope.accessKey !== accessKey) setActiveScope(null);
  }, [page.phase, resolvedProjectId, accessKey, activeScope]);
  const activeProject = page.project || (page.phase === 'loading' && page.scope === 'project' && activeScope?.accessKey === accessKey
    ? projects.find(project => project.id === activeScope.projectId) : undefined);
  const selectedProjectId = activeProject?.id || '';
  const projectSelectionReady = page.phase === 'ready';
  const chrome = useMemo(() => createPageChrome(page.navigationKey), [page.navigationKey]);
  useProjectRefresh(selectedProjectId,session.accountId||'guest',projectsEnabled&&projectSelectionReady);

  const changeProject = useCallback((projectId: string) => {
    if (projectId === selectedProjectId || !projects.some(project => project.id === projectId)) return;
    chrome.prepareNavigation();
    rememberProject(session.accountId || session.username || 'guest', projectId);
    const params = location.pathname === '/issues' ? new URLSearchParams(location.search) : new URLSearchParams();
    if (location.pathname === '/issues') for (const key of ['issueId','requirementId','ownerId','page','q']) params.delete(key);
    params.set('projectId',projectId);
    let pathname = projects.find(p => p.id === projectId)?.publicReadOnly ? '/' : location.pathname;
    if (/^\/requirements\/[^/]+$/.test(pathname)) pathname = new URLSearchParams(location.search).get('view') === 'path' ? '/paths' : '/requirements';
    navigate({pathname, search: `?${params}`}, {state:null});
  }, [chrome, projects, session.accountId, session.username, location.pathname, location.search, navigate, selectedProjectId]);

  return { activeProject, selectedProjectId, chrome, changeProject };
}
