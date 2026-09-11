import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { KeyRound, LogIn } from "lucide-react";
import { api,ApiError, setUnauthorizedHandler } from "./api";
import {clearGraphDrafts,clearProjectGraphDrafts} from './use-graph-draft';
import type { Project, Session, SystemBranding } from "./types";
import {
  ProjectsContext,
  BusinessDateContext,
  SessionContext,
  UiActionsContext,
  useUiActions,
} from "./app-context";
import { appRoutes, preloadPage } from "./routes";
import { invalidate, invalidateBusinessDateViews, keys } from "./query-keys";
import {usePageResolution} from "./use-page-resolution";
import {PageResourcesContext, ResolvedPageContext, rememberProject} from "./page-context";
import {createPageChrome, PageChromeContext} from "./page-chrome";
import { useResourceQuery } from "./use-resource-query";
import { clearBusinessQueries, commitSession, guestSession, projectAccessKey, sessionAccessKey } from "./session-cache";
import { useToast } from "./components/Toast";
import { InlineEditProvider } from "./components/InlineEdit";
import { defaultBranding, useDocumentBranding } from "./components/BrandLogo";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { LoginDialog, PasswordDialog } from "./components/AuthForms";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LoadingState, RefreshNotice } from "./components/Feedback";
import { todayIso } from "../shared/domain";
import {useProjectRefresh} from './use-project-refresh';

const noProjects: Project[] = [];

function GuestLanding() {
  const { openLogin } = useUiActions();
  return <div className="page-content guest-landing"><div className="panel"><KeyRound size={32} /><h1>登录项目工作台</h1><p>项目、需求、问题和人员数据仅对已授权账号开放。</p><button className="primary-button" onClick={openLogin}><LogIn size={16} />用户登录</button></div></div>;
}

function StartupError({ title, error, pending, onRetry }: { title: string; error: Error; pending: boolean; onRetry: () => void }) {
  return <div className="page-content guest-landing"><div className="panel"><h1>{title}</h1><p>{error.message}</p><button className="primary-button" disabled={pending} onClick={onRetry}>{pending ? "重新加载中…" : "重新加载"}</button></div></div>;
}

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const toast = useToast();
  const [loginOpen, setLoginOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return window.localStorage.getItem("project-manage:sidebar-collapsed") === "true"; } catch { return false; }
  });
  const [narrowScreen, setNarrowScreen] = useState(() => window.matchMedia('(max-width: 620px)').matches);
  const [narrowSidebarExpanded, setNarrowSidebarExpanded] = useState(false);
  const visibleSidebarCollapsed = narrowScreen ? !narrowSidebarExpanded : sidebarCollapsed;
  const [businessDate, setBusinessDate] = useState(todayIso);
  const previousBusinessDate = useRef(businessDate);

  useEffect(() => {
    const refreshBusinessDate = () => setBusinessDate((current) => {
      const next = todayIso();
      return next === current ? current : next;
    });
    const timer = window.setInterval(refreshBusinessDate, 60_000);
    window.addEventListener("focus", refreshBusinessDate);
    document.addEventListener("visibilitychange", refreshBusinessDate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshBusinessDate);
      document.removeEventListener("visibilitychange", refreshBusinessDate);
    };
  }, []);

  useEffect(() => {
    if (previousBusinessDate.current === businessDate) return;
    previousBusinessDate.current = businessDate;
    invalidateBusinessDateViews(client);
  }, [businessDate, client]);

  const brandingQuery = useQuery({
    queryKey: [...keys.branding],
    queryFn: ({ signal }) => api<SystemBranding>("/api/branding", { signal }),
  });
  const branding = brandingQuery.data || defaultBranding;
  useDocumentBranding(brandingQuery.data);
  const sessionQuery = useResourceQuery<Session>(keys.session, "/api/session", true, (next) => {
    const previous = client.getQueryData<Session | null>(keys.session);
    if(previous&&(previous.accountId!==next.accountId||previous.personId!==next.personId||previous.globalRole!==next.globalRole||previous.role!==next.role||!next.authenticated||next.mustChangePassword))clearGraphDrafts(previous.accountId);
    else if(previous)for(const id of previous.managedProjectIds)if(!next.managedProjectIds.includes(id))clearProjectGraphDrafts(previous.accountId||'guest',id);
    if (previous === null || previous && sessionAccessKey(previous) !== sessionAccessKey(next)) clearBusinessQueries(client);
  });
  const session = sessionQuery.data || guestSession;
  const sessionReady = !sessionQuery.unavailable;
  const projectsEnabled = session.authenticated && !session.mustChangePassword;
  useEffect(() => { if (projectsEnabled) preloadPage(location.pathname); }, [projectsEnabled, location.pathname]);
  const projectKey = [...keys.projects, session.accountId];
  const projectsQuery = useResourceQuery<Project[]>(projectKey, "/api/projects", projectsEnabled, (next) => {
    const previous = client.getQueryData<Project[] | null>(projectKey);
    for(const project of previous||[]){const updated=next.find(p=>p.id===project.id);if(!updated||project.canManage&&!updated.canManage||project.projectRole!==updated.projectRole)clearProjectGraphDrafts(session.accountId||'guest',project.id);}
    if (previous === null || previous && projectAccessKey(previous) !== projectAccessKey(next)) clearBusinessQueries(client, true);
  });
  const projects = projectsEnabled ? projectsQuery.data || noProjects : noProjects;
  useEffect(()=>{if([sessionQuery.error,projectsQuery.error].some(error=>error instanceof ApiError&&[401,403].includes(error.status)))clearGraphDrafts(session.accountId);},[sessionQuery.error,projectsQuery.error,session.accountId]);
  const {page, resources, pageIcon} = usePageResolution(sessionQuery, projectsQuery, session, projects);
  // 已确认的项目是当前工作范围。读取下一对象期间保留它，不把一次导航当作重新启动。
  // 只保留身份和 ID，每次仍从最新可访问项目中解析，权限失效时不能沿用旧对象。
  const accessKey = sessionAccessKey(session);
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
  useProjectRefresh(selectedProjectId,session.accountId||'',projectsEnabled&&projectSelectionReady);

  useEffect(() => {
    try { window.localStorage.setItem("project-manage:sidebar-collapsed", String(sidebarCollapsed)); } catch { /* 当前页面仍可收起侧栏。 */ }
  }, [sidebarCollapsed]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 620px)');
    const change = () => { setNarrowScreen(media.matches); setNarrowSidebarExpanded(false); };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);

  const openLogin = useCallback(() => setLoginOpen(true), []);
  const openPassword = useCallback(() => setPasswordOpen(true), []);

  // 401 统一处理：会话失效并提示重新登录（3 秒去重，避免并发请求刷屏）。
  const lastUnauthorizedRef = useRef(0);
  useEffect(() => {
    setUnauthorizedHandler(() => {
      const now = Date.now();
      if (now - lastUnauthorizedRef.current < 3000) return;
      lastUnauthorizedRef.current = now;
      void commitSession(client, null).then(() => invalidate(client, keys.session));
      toast.info("登录状态已过期，请重新登录");
    });
    return () => setUnauthorizedHandler(null);
  }, [client, toast]);

  const changeProject = useCallback((projectId: string) => {
    if (projectId === selectedProjectId || !projects.some(project => project.id === projectId)) return;
    chrome.prepareNavigation();
    rememberProject(session.accountId || session.username || 'guest', projectId);
    const params = location.pathname === '/issues' ? new URLSearchParams(location.search) : new URLSearchParams();
    if (location.pathname === '/issues') for (const key of ['issueId','requirementId','ownerId','page','q']) params.delete(key);
    params.set('projectId',projectId);
    let pathname = location.pathname;
    if (/^\/requirements\/[^/]+$/.test(pathname)) pathname = new URLSearchParams(location.search).get('view') === 'path' ? '/paths' : '/requirements';
    navigate({pathname, search: `?${params}`}, {state:null});
  }, [chrome, projects, session.accountId, session.username, location.pathname, location.search, navigate, selectedProjectId]);

  const sessionValue = useMemo(() => ({ session }), [session]);
  const projectsValue = useMemo(
    () => ({ projects, selectedProjectId, changeProject }),
    [projects, selectedProjectId, changeProject],
  );
  const uiActionsValue = useMemo(() => ({ openLogin, openPassword }), [openLogin, openPassword]);
  const businessDateValue = useMemo(() => ({ businessDate }), [businessDate]);
  const rootRefreshFailed = Boolean(sessionQuery.error || projectsEnabled && projectsQuery.error);
  return (
    <InlineEditProvider resetKey={page.navigationKey}>
      <SessionContext.Provider value={sessionValue}>
        <ProjectsContext.Provider value={projectsValue}>
          <BusinessDateContext.Provider value={businessDateValue}>
            <UiActionsContext.Provider value={uiActionsValue}>
              <ResolvedPageContext.Provider value={page}><PageResourcesContext.Provider value={resources}><PageChromeContext.Provider value={chrome}>
              <div className={`app-shell${visibleSidebarCollapsed ? " is-sidebar-collapsed" : ""}`} data-immersive={page.toolbar === 'path' || page.toolbar === 'editor'}>
              <Sidebar branding={brandingQuery.data || (brandingQuery.isError ? defaultBranding : undefined)} ready={sessionReady && (page.scope !== 'project' || page.phase !== 'loading' || Boolean(activeProject))} collapsed={visibleSidebarCollapsed} onToggle={() => narrowScreen ? setNarrowSidebarExpanded(value => !value) : setSidebarCollapsed(value => !value)} onNavigate={() => { chrome.prepareNavigation(); setNarrowSidebarExpanded(false); }} />
              <main>
                <Topbar pageIcon={pageIcon} sessionReady={sessionReady} />
                {rootRefreshFailed && page.phase === 'ready' && <div className="app-refresh-notice"><RefreshNotice
                  pending={sessionQuery.isFetching || projectsQuery.isFetching}
                  onRetry={() => { void sessionQuery.refetch(); if (projectsEnabled) void projectsQuery.refetch(); }}
                /></div>}
                <ErrorBoundary resetKey={page.navigationKey}>
                  <Suspense key={page.navigationKey} fallback={<LoadingState label="正在加载页面…" className="tall" />}>
                    {page.phase === 'error' ? <StartupError title={page.errorTitle || '页面加载失败'} error={page.error!} pending={sessionQuery.isFetching || projectsQuery.isFetching || resources.requirement.isFetching || resources.issue.isFetching || resources.templates.isFetching} onRetry={() => void page.retry()} /> : page.phase === 'loading' ? <LoadingState label="正在加载页面…" className="tall" /> : !session.authenticated ? <GuestLanding /> : session.mustChangePassword ? null :
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
