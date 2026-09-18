import { useProjectSelection } from './features/projects/use-project-selection';
import { useWorkspaceAccess } from "./features/accounts/use-workspace-access";
import { useBusinessDateClock } from "./core/use-business-date";
import { useSidebarPreference } from "./core/use-sidebar-preference";
import * as systemApi from "./features/system/api";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { setUnauthorizedHandler } from "./api";
import type { SystemBranding } from "./types";
import { ProjectsContext, BusinessDateContext, SessionContext, UiActionsContext } from "./app-context";
import { appRoutes } from "./routes";
import { invalidate, keys } from "./query-keys";

import { usePageResolution } from "./use-page-resolution";
import { PageResourcesContext, ResolvedPageContext } from "./page-context";
import { PageChromeContext } from "./page-chrome";
import { commitSession } from "./session-cache";

import { useToast } from "./components/Toast";
import { InlineEditProvider } from "./components/inline-edit/shared";
import { defaultBranding, useDocumentBranding } from "./components/BrandLogo";
import { Sidebar } from "./components/Sidebar";
import { PageToolbar } from "./components/PageToolbar";
import { Topbar } from "./components/Topbar";
import { LoginDialog, PasswordDialog } from "./components/AuthForms";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LoadingState, RefreshNotice } from "./components/Feedback";

import { StartupError, GuestLanding } from './features/accounts/AccessLanding';

export function App() {
  const location = useLocation();
  const client = useQueryClient();
  const toast = useToast();
  const [loginOpen, setLoginOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const sidebar = useSidebarPreference();
  const businessDate = useBusinessDateClock();

  const brandingQuery = useQuery({
    queryKey: [...keys.branding],
    queryFn: ({ signal }) => systemApi.branding<SystemBranding>({ signal }),
  });
  const branding = brandingQuery.data || defaultBranding;
  useDocumentBranding(brandingQuery.data);
  const { sessionQuery, session, sessionReady, projectsEnabled, projectsQuery, projects } = useWorkspaceAccess(location.pathname);
  const {page, resources, pageIcon} = usePageResolution(sessionQuery, projectsQuery, session, projects);
  const { activeProject, selectedProjectId, chrome, changeProject }=useProjectSelection(page,projects,session,projectsEnabled);

  const openLogin = useCallback(() => setLoginOpen(true), []);
  const openPassword = useCallback(() => setPasswordOpen(true), []);

  // 401 统一处理：会话失效并提示重新登录（3 秒去重，避免并发请求刷屏）。
  const lastUnauthorizedRef = useRef(0);
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (!session.authenticated) return;
      const now = Date.now();
      if (now - lastUnauthorizedRef.current < 3000) return;
      lastUnauthorizedRef.current = now;
      void commitSession(client, null).then(() => invalidate(client, keys.session));
      toast.info("登录状态已过期，请重新登录");
    });
    return () => setUnauthorizedHandler(null);
  }, [client, toast, session.authenticated]);

  const sessionValue = useMemo(() => ({ session }), [session]);
  const projectsValue = useMemo(
    () => ({ projects, selectedProjectId, changeProject }),
    [projects, selectedProjectId, changeProject],
  );
  const uiActionsValue = useMemo(() => ({ openLogin, openPassword }), [openLogin, openPassword]);
  const businessDateValue = useMemo(() => ({ businessDate }), [businessDate]);
  const rootRefreshFailed = Boolean(sessionQuery.error || projectsEnabled && !projectsQuery.unavailable && projectsQuery.error);
  return (
    <InlineEditProvider resetKey={page.navigationKey}>
      <SessionContext.Provider value={sessionValue}>
        <ProjectsContext.Provider value={projectsValue}>
          <BusinessDateContext.Provider value={businessDateValue}>
            <UiActionsContext.Provider value={uiActionsValue}>
              <ResolvedPageContext.Provider value={page}><PageResourcesContext.Provider value={resources}><PageChromeContext.Provider value={chrome}>
              <div className={`app-shell${sidebar.collapsed ? " is-sidebar-collapsed" : ""}`} data-immersive={page.toolbar === 'path' || page.toolbar === 'editor'}>
              <Sidebar branding={brandingQuery.data || (brandingQuery.isError ? defaultBranding : undefined)} ready={sessionReady && (page.scope !== 'project' || page.phase !== 'loading' || Boolean(activeProject))} collapsed={sidebar.collapsed} onToggle={sidebar.toggle} onNavigate={() => { chrome.prepareNavigation(); sidebar.navigated(); }} />
              <main>
                <Topbar pageIcon={pageIcon} sessionReady={sessionReady} />
                {(!sessionReady || !session.mustChangePassword && (page.scope !== 'project' || Boolean(activeProject))) && <PageToolbar />}
                {rootRefreshFailed && page.phase === 'ready' && <div className="app-refresh-notice"><RefreshNotice
                  pending={sessionQuery.isFetching || projectsQuery.isFetching}
                  onRetry={() => { void sessionQuery.refetch(); if (projectsEnabled) void projectsQuery.refetch(); }}
                /></div>}
                <ErrorBoundary resetKey={page.navigationKey}>
                  <Suspense key={page.navigationKey} fallback={<LoadingState label="正在加载页面…" className="tall" />}>
                    {page.phase === 'error' ? <StartupError title={page.errorTitle || '页面加载失败'} error={page.error!} pending={sessionQuery.isFetching || projectsQuery.isFetching || resources.requirement.isFetching || resources.issue.isFetching || resources.templates.isFetching} onRetry={() => void page.retry()} /> : page.phase === 'loading' ? <LoadingState label="正在加载页面…" className="tall" /> : !session.authenticated && !page.project ? <GuestLanding /> : session.mustChangePassword ? null :
                    <Routes>
                      {appRoutes.map((def) => {
                        const PageComponent = def.component;
                        return (
                          <Route
                            key={def.path}
                            path={def.path}
                            element={
                              <PageComponent />
                            }
                          />
                        );
                      })}
                      <Route path="/concurrency" element={<Navigate to="/people?view=analysis" replace />} />
                      <Route path="/accounts" element={<Navigate to="/resources" replace />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>}
                  </Suspense>
                </ErrorBoundary>
              </main>
              {loginOpen && <LoginDialog onClose={() => setLoginOpen(false)} branding={branding} />}
              {session.authenticated && (passwordOpen || session.mustChangePassword) && <PasswordDialog forced={session.mustChangePassword} onClose={() => setPasswordOpen(false)} />}
              </div>
              </PageChromeContext.Provider></PageResourcesContext.Provider></ResolvedPageContext.Provider>
            </UiActionsContext.Provider>
          </BusinessDateContext.Provider>
        </ProjectsContext.Provider>
      </SessionContext.Provider>
    </InlineEditProvider>
  );
}
