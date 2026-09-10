import { Fragment, Suspense, startTransition, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  TopbarSlotsContext,
  UiActionsContext,
  useProjects,
  useSession,
  useUiActions,
} from "./app-context";
import { appRoutes, pageScopeFor, type AppRoute } from "./routes";
import { invalidate, invalidateBusinessDateViews, keys } from "./query-keys";
import { useProjectSelection } from "./use-project-selection";
import { useResourceQuery } from "./use-resource-query";
import { clearBusinessQueries, commitSession, guestSession, projectAccessKey, sessionAccessKey } from "./session-cache";
import { useToast } from "./components/Toast";
import { canManageProject, isAdmin } from "./permissions";
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

/** 路由守卫：权限/就绪检查由路由清单驱动，项目作用域页面随项目切换重挂载。 */
function RouteGuard({
  def,
  sessionReady,
  projectSelectionReady,
  children,
}: {
  def: AppRoute;
  sessionReady: boolean;
  projectSelectionReady: boolean;
  children: ReactNode;
}) {
  const { session } = useSession();
  const { selectedProjectId } = useProjects();
  const admin = isAdmin(session);
  const scope = admin && def.adminScope ? def.adminScope : def.scope;
  const ready = scope === "project" ? sessionReady && projectSelectionReady : sessionReady;
  if (!ready) return <div className="page-content"><LoadingState label="正在确认权限…" className="tall" /></div>;
  if (!session.authenticated) return def.path === "/" ? <GuestLanding /> : <Navigate to="/" replace />;
  if (session.mustChangePassword) return null;
  if (def.access === "admin" && !admin) return <Navigate to="/" replace />;
  if (def.access === "manager" && !canManageProject(session, selectedProjectId)) return <Navigate to="/" replace />;
  const boundaryKey = scope === "project"
    ? (def.resetOnProjectChange === false ? "resource-detail" : selectedProjectId || "no-project")
    : undefined;
  return <Fragment key={boundaryKey}>{children}</Fragment>;
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
  const [titleEl, setTitleEl] = useState<HTMLElement | null>(null);
  const [actionsEl, setActionsEl] = useState<HTMLElement | null>(null);
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

  const { data: branding = defaultBranding } = useQuery({
    queryKey: [...keys.branding],
    queryFn: ({ signal }) => api<SystemBranding>("/api/branding", { signal }),
  });
  useDocumentBranding(branding);
  const sessionQuery = useResourceQuery<Session>(keys.session, "/api/session", true, (next) => {
    const previous = client.getQueryData<Session | null>(keys.session);
    if(previous&&(previous.accountId!==next.accountId||previous.personId!==next.personId||previous.globalRole!==next.globalRole||previous.role!==next.role||!next.authenticated||next.mustChangePassword))clearGraphDrafts(previous.accountId);
    else if(previous)for(const id of previous.managedProjectIds)if(!next.managedProjectIds.includes(id))clearProjectGraphDrafts(previous.accountId||'guest',id);
    if (previous === null || previous && sessionAccessKey(previous) !== sessionAccessKey(next)) clearBusinessQueries(client);
  });
  const session = sessionQuery.data || guestSession;
  const sessionReady = !sessionQuery.unavailable;
  const projectsEnabled = session.authenticated && !session.mustChangePassword;
  const projectKey = [...keys.projects, session.accountId];
  const projectsQuery = useResourceQuery<Project[]>(projectKey, "/api/projects", projectsEnabled, (next) => {
    const previous = client.getQueryData<Project[] | null>(projectKey);
    for(const project of previous||[]){const updated=next.find(p=>p.id===project.id);if(!updated||project.canManage&&!updated.canManage||project.projectRole!==updated.projectRole)clearProjectGraphDrafts(session.accountId||'guest',project.id);}
    if (previous === null || previous && projectAccessKey(previous) !== projectAccessKey(next)) clearBusinessQueries(client, true);
  });
  const projects = projectsEnabled ? projectsQuery.data || noProjects : noProjects;
  useEffect(()=>{if([sessionQuery.error,projectsQuery.error].some(error=>error instanceof ApiError&&[401,403].includes(error.status)))clearGraphDrafts(session.accountId);},[sessionQuery.error,projectsQuery.error,session.accountId]);
  const { selectedProjectId, setSelectedProjectId, projectSelectionReady } = useProjectSelection({
    session,
    projects,
    enabled: projectsEnabled,
    projectsFetched: !projectsQuery.unavailable,
  });
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
    if (projectId === selectedProjectId) return;
    startTransition(() => {
      setSelectedProjectId(projectId);
      if (/^\/requirements\/[^/]+$/.test(location.pathname)) {
        navigate("/requirements");
        return;
      }
      if (["/requirements", "/actions", "/analytics", "/people"].includes(location.pathname)) {
        navigate({ pathname: location.pathname, search: "" }, { replace: true });
        return;
      }
      if (location.pathname === "/issues") {
        const params = new URLSearchParams(location.search);
        params.delete("issueId");
        params.delete("requirementId");
        params.delete("ownerId");
        const search = params.toString();
        navigate({ pathname: location.pathname, search: search ? `?${search}` : "" }, { replace: true });
      }
    });
  }, [location.pathname, location.search, navigate, selectedProjectId, setSelectedProjectId]);

  const currentPageScope = pageScopeFor(location.pathname, isAdmin(session));

  const sessionValue = useMemo(() => ({ session }), [session]);
  const projectsValue = useMemo(
    () => ({ projects, selectedProjectId, syncProjectContext: setSelectedProjectId, changeProject }),
    [projects, selectedProjectId, setSelectedProjectId, changeProject],
  );
  const uiActionsValue = useMemo(() => ({ openLogin, openPassword }), [openLogin, openPassword]);
  const businessDateValue = useMemo(() => ({ businessDate }), [businessDate]);
  const topbarSlotsValue = useMemo(
    () => ({ titleEl, actionsEl, setTitleEl, setActionsEl }),
    [titleEl, actionsEl],
  );

  if (sessionQuery.unavailable && sessionQuery.error) return <StartupError title="登录状态加载失败" error={sessionQuery.error} pending={sessionQuery.isFetching} onRetry={() => void sessionQuery.refetch()} />;
  if (sessionQuery.unavailable) return <LoadingState label="正在确认登录状态…" className="tall" />;
  if (projectsEnabled && projectsQuery.unavailable && projectsQuery.error) return <StartupError title="项目列表加载失败" error={projectsQuery.error} pending={projectsQuery.isFetching} onRetry={() => void projectsQuery.refetch()} />;
  const rootRefreshFailed = Boolean(sessionQuery.error || projectsEnabled && projectsQuery.error);
  return (
    <InlineEditProvider key={`${sessionAccessKey(session)}:${projectAccessKey(projects)}`}>
      <SessionContext.Provider value={sessionValue}>
        <ProjectsContext.Provider value={projectsValue}>
          <BusinessDateContext.Provider value={businessDateValue}>
            <UiActionsContext.Provider value={uiActionsValue}>
              <TopbarSlotsContext.Provider value={topbarSlotsValue}>
              <div className={`app-shell${visibleSidebarCollapsed ? " is-sidebar-collapsed" : ""}`}>
              <Sidebar collapsed={visibleSidebarCollapsed} onToggle={() => narrowScreen ? setNarrowSidebarExpanded(value => !value) : setSidebarCollapsed(value => !value)} onNavigate={() => setNarrowSidebarExpanded(false)} />
              <main>
                <Topbar scope={currentPageScope} projectSelectionReady={projectSelectionReady} />
                {rootRefreshFailed && <div className="app-refresh-notice"><RefreshNotice
                  pending={sessionQuery.isFetching || projectsQuery.isFetching}
                  onRetry={() => { void sessionQuery.refetch(); if (projectsEnabled) void projectsQuery.refetch(); }}
                /></div>}
                <ErrorBoundary resetKey={location.pathname}>
                  <Suspense fallback={<LoadingState label="正在加载页面…" />}>
                    <Routes>
                      {appRoutes.map((def) => {
                        const PageComponent = def.component;
                        return (
                          <Route
                            key={def.path}
                            path={def.path}
                            element={
                              <RouteGuard def={def} sessionReady={sessionReady} projectSelectionReady={projectSelectionReady}>
                                <PageComponent />
                              </RouteGuard>
                            }
                          />
                        );
                      })}
                      <Route path="/concurrency" element={<Navigate to="/people?view=analysis" replace />} />
                      <Route path="/accounts" element={<Navigate to="/resources" replace />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </Suspense>
                </ErrorBoundary>
              </main>
              {loginOpen && <LoginDialog onClose={() => setLoginOpen(false)} branding={branding} />}
              {session.authenticated && (passwordOpen || session.mustChangePassword) && <PasswordDialog forced={session.mustChangePassword} onClose={() => setPasswordOpen(false)} />}
              </div>
              </TopbarSlotsContext.Provider>
            </UiActionsContext.Provider>
          </BusinessDateContext.Provider>
        </ProjectsContext.Provider>
      </SessionContext.Provider>
    </InlineEditProvider>
  );
}
