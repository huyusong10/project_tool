import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  Check,
  ChevronDown,
  KeyRound,
  LockKeyhole,
  LogIn,
  LogOut,
} from "lucide-react";
import { api, jsonBody } from "./api";
import type { Project, Session, SystemBranding } from "./types";
import { AppContext } from "./app-context";
import { DashboardPage } from "./pages/DashboardPage";
import { Modal } from "./components/Modal";
import { canManageProject, isAdmin } from "./permissions";
import { InlineEditProvider } from "./components/InlineEdit";
import { BrandLogo, defaultBranding, useDocumentBranding } from "./components/BrandLogo";
import { Sidebar } from "./components/Sidebar";

const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage").then((module) => ({ default: module.AnalyticsPage })));
const MyWorkPage = lazy(() => import("./pages/MyWorkPage").then((module) => ({ default: module.MyWorkPage })));
const ActionCenterPage = lazy(() => import("./pages/ActionCenterPage").then((module) => ({ default: module.ActionCenterPage })));
const RequirementPage = lazy(() => import("./pages/RequirementPage").then((module) => ({ default: module.RequirementPage })));
const IssuesPage = lazy(() => import("./pages/IssuesPage").then((module) => ({ default: module.IssuesPage })));
const AccountsPage = lazy(() => import("./pages/AccountsPage").then((module) => ({ default: module.AccountsPage })));
const RequirementsPage = lazy(() => import("./pages/ManagePages").then((module) => ({ default: module.RequirementsPage })));
const PeoplePage = lazy(() => import("./pages/ManagePages").then((module) => ({ default: module.PeoplePage })));
const TemplatesPage = lazy(() => import("./pages/ManagePages").then((module) => ({ default: module.TemplatesPage })));
const ProjectSettingsPage = lazy(() => import("./pages/ManagePages").then((module) => ({ default: module.ProjectSettingsPage })));
const PersonalSettingsPage = lazy(() => import("./pages/ManagePages").then((module) => ({ default: module.PersonalSettingsPage })));
const ProjectsPage = lazy(() => import("./pages/ManagePages").then((module) => ({ default: module.ProjectsPage })));
const ArchiveCenterPage = lazy(() => import("./pages/ManagePages").then((module) => ({ default: module.ArchiveCenterPage })));
const SystemPage = lazy(() => import("./pages/SystemPage").then((module) => ({ default: module.SystemPage })));
const LogsPage = lazy(() => import("./pages/LogsPage").then((module) => ({ default: module.LogsPage })));

const guestSession: Session = {
  authenticated: false,
  username: null,
  httpWarning: true,
  role: "guest",
  globalRole: "guest",
  personId: null,
  mustChangePassword: false,
  managedProjectIds: [],
};

type PageScope = "project" | "personal" | "platform";
type ProjectSelection = { accountKey: string; projectId: string };

const projectSelectionStorageKey = (accountKey: string) => `project-manage:selected-project:${accountKey}`;

function pageScope(pathname: string, admin: boolean): PageScope {
  if (pathname === "/my-work" || pathname === "/settings") return "personal";
  if (["/projects", "/resources", "/accounts", "/archives", "/system"].includes(pathname)) return "platform";
  if (pathname === "/logs" && admin) return "platform";
  return "project";
}

function LoginForm({ onClose, branding }: { onClose: () => void; branding: SystemBranding }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const login = useMutation({
    mutationFn: (value: object) =>
      api<Session>("/api/login", { method: "POST", body: jsonBody(value) }),
    onSuccess: (_result) => {
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" });
      void client.invalidateQueries({ queryKey: ["session"] });
      onClose();
      navigate("/");
    },
    onError: (value) => setError(value.message),
  });
  return (
    <form
      className="form-grid login-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        login.mutate(Object.fromEntries(new FormData(event.currentTarget)));
      }}
    >
      <BrandLogo branding={branding} className="login-brand-logo" />
      <p className="field-help field-full">
        登录后按账号角色进入个人工作台或项目管理功能。
      </p>
      <label className="field field-full">
        <span>用户名</span>
        <input
          name="username"
          defaultValue="admin"
          required
          autoFocus
          autoComplete="username"
        />
      </label>
      <label className="field field-full">
        <span>密码</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />
      </label>
      {error && <p className="form-error field-full">{error}</p>}
      <div className="form-actions field-full">
        <button type="button" className="ghost-button" onClick={onClose}>取消</button>
        <button className="primary-button" disabled={login.isPending}>
          <LogIn size={16} />
          用户登录
        </button>
      </div>
      <div className="http-form-warning field-full">
        <LockKeyhole size={14} />
        当前为HTTP局域网访问，请仅在可信网络中输入密码。
      </div>
    </form>
  );
}

function ProjectSwitcher({
  projects,
  selectedProjectId,
  setSelectedProjectId,
  ready,
}: {
  projects: Project[];
  selectedProjectId: string;
  setSelectedProjectId: (id: string) => void;
  ready: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = projects.find((project) => project.id === selectedProjectId) || projects[0];
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);
  return <div className="project-switcher" ref={rootRef}>
    {!ready ? <span className="project-switcher-empty"><span className="project-dot" />正在加载项目…</span> : projects.length ? <>
      <button type="button" className="project-switcher-button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="project-dot" />
        <span className="project-switcher-name">{selected?.name}</span>
        {selected?.isSample && <span className="sample-project-badge">样板</span>}
        <ChevronDown className={open ? "is-open" : ""} size={15} />
      </button>
      {open && <div className="project-switcher-menu" role="listbox" aria-label="切换项目">
        {projects.map((project) => <button type="button" role="option" aria-selected={project.id === selectedProjectId} key={project.id} onClick={() => { setSelectedProjectId(project.id); setOpen(false); }}>
          <span className="project-switcher-option"><span>{project.name}</span>{project.isSample && <em className="sample-project-badge">样板</em>}</span>
          {project.id === selectedProjectId && <Check size={15} />}
        </button>)}
      </div>}
    </> : <span className="project-switcher-empty"><span className="project-dot" />尚未创建项目</span>}
  </div>;
}

function ScopeIndicator({ scope }: { scope: Exclude<PageScope, "project"> }) {
  return <div className="project-switcher">
    <span className={`project-scope-indicator scope-${scope}`}>
      <span className="project-dot" />
      {scope === "personal" ? "跨项目" : "平台范围"}
    </span>
  </div>;
}

function Topbar({
  session,
  projects,
  selectedProjectId,
  setSelectedProjectId,
  projectSelectionReady,
  scope,
  openLogin,
  openPassword,
}: {
  session: Session;
  projects: Project[];
  selectedProjectId: string;
  setSelectedProjectId: (id: string) => void;
  projectSelectionReady: boolean;
  scope: PageScope;
  openLogin: () => void;
  openPassword: () => void;
}) {
  const client = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api("/api/logout", { method: "POST" }),
    onSuccess: () => {
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" });
      void client.invalidateQueries({ queryKey: ["session"] });
    },
  });
  return (
    <header className="topbar">
      <div className="topbar-context">
        <div id="topbar-title-slot" />
        {scope === "project"
          ? <ProjectSwitcher projects={projects} selectedProjectId={selectedProjectId} setSelectedProjectId={setSelectedProjectId} ready={projectSelectionReady} />
          : <ScopeIndicator scope={scope} />}
      </div>
      <div className="top-actions">
        <div id="topbar-action-slot" />
        <div className="topbar-account">
          {session.authenticated ? (
            <>
            <button className="session-badge session-button" onClick={openPassword} title="修改密码">
              <span />
              {session.username}
            </button>
            <button className="ghost-button" onClick={() => logout.mutate()}>
              <LogOut size={15} />
              退出
            </button>
            </>
          ) : (
            <>
            <span className="guest-badge">请登录</span>
            <button className="primary-button" onClick={openLogin}>
              <LogIn size={15} />
              用户登录
            </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function PasswordForm({ forced, onClose }: { forced: boolean; onClose: () => void }) {
  const client = useQueryClient(); const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: (value: object) => api("/api/account/change-password", { method: "POST", body: jsonBody(value) }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["session"] }); onClose(); },
    onError: (value) => setError(value.message),
  });
  return <form className="form-grid" onSubmit={(event) => {
    event.preventDefault(); setError(""); const values = Object.fromEntries(new FormData(event.currentTarget));
    if (values.newPassword !== values.confirmPassword) return setError("两次输入的新密码不一致");
    mutation.mutate({ currentPassword: values.currentPassword, newPassword: values.newPassword });
  }}>
    {forced && <div className="password-required field-full"><KeyRound size={19} /><div><strong>首次登录需要修改密码</strong><span>修改后才能使用工作台和业务功能。</span></div></div>}
    <label className="field field-full"><span>当前密码</span><input name="currentPassword" type="password" required autoFocus autoComplete="current-password" /></label>
    <label className="field field-full"><span>新密码</span><input name="newPassword" type="password" minLength={8} required autoComplete="new-password" placeholder="至少8个字符" /></label>
    <label className="field field-full"><span>确认新密码</span><input name="confirmPassword" type="password" minLength={8} required autoComplete="new-password" /></label>
    {error && <p className="form-error field-full">{error}</p>}
    <div className="form-actions field-full">{!forced && <button type="button" className="ghost-button" onClick={onClose}>取消</button>}<button className="primary-button" disabled={mutation.isPending}>保存新密码</button></div>
  </form>;
}

function RoleRoute({ session, ready, admin = false, manager = false, currentProjectId = "", children }: { session: Session; ready: boolean; admin?: boolean; manager?: boolean; currentProjectId?: string; children: ReactNode }) {
  if (!ready) return <div className="page-content"><div className="loading-block">正在确认账号权限…</div></div>;
  if (!session.authenticated) return <Navigate to="/" replace />;
  if (admin && !isAdmin(session)) return <Navigate to="/" replace />;
  if (manager && !canManageProject(session, currentProjectId)) return <Navigate to="/" replace />;
  return children;
}

function ProjectScopeBoundary({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function ProjectRoute({
  session,
  ready,
  projectSelectionReady,
  currentProjectId,
  manager = false,
  resetOnProjectChange = true,
  children,
}: {
  session: Session;
  ready: boolean;
  projectSelectionReady: boolean;
  currentProjectId: string;
  manager?: boolean;
  resetOnProjectChange?: boolean;
  children: ReactNode;
}) {
  if (!ready || !projectSelectionReady)
    return <div className="page-content"><div className="loading-block">正在确认项目权限…</div></div>;
  if (!session.authenticated) return <Navigate to="/" replace />;
  if (manager && !canManageProject(session, currentProjectId)) return <Navigate to="/" replace />;
  const boundaryKey = resetOnProjectChange ? currentProjectId || "no-project" : "resource-detail";
  return <ProjectScopeBoundary key={boundaryKey}>{children}</ProjectScopeBoundary>;
}

function GuestLanding({ openLogin }: { openLogin: () => void }) {
  return <div className="page-content guest-landing"><div className="panel"><KeyRound size={32} /><h1>登录项目工作台</h1><p>项目、需求、问题和人员数据仅对已授权账号开放。</p><button className="primary-button" onClick={openLogin}><LogIn size={16} />用户登录</button></div></div>;
}

function StartupError({ title, error, onRetry }: { title: string; error: Error; onRetry: () => void }) {
  return <div className="page-content guest-landing"><div className="panel"><h1>{title}</h1><p>{error.message}</p><button className="primary-button" onClick={onRetry}>重新加载</button></div></div>;
}

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [loginOpen, setLoginOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem("project-manage:sidebar-collapsed") === "true");
  const [projectSelection, setProjectSelection] = useState<ProjectSelection>({ accountKey: "", projectId: "" });
  const { data: branding = defaultBranding } = useQuery({
    queryKey: ["branding"],
    queryFn: () => api<SystemBranding>("/api/branding"),
  });
  useDocumentBranding(branding);
  const { data: session = guestSession, isFetched: sessionReady, error: sessionError, refetch: refetchSession } = useQuery({
    queryKey: ["session"],
    queryFn: () => api<Session>("/api/session"),
  });
  const projectsEnabled = session.authenticated && !session.mustChangePassword;
  const { data: projectData = [], isFetched: projectsFetched, error: projectsError, refetch: refetchProjects } = useQuery({
    queryKey: ["projects", session.accountId],
    queryFn: () => api<Project[]>("/api/projects"),
    enabled: projectsEnabled,
  });
  const projects = useMemo(
    () => projectsEnabled ? projectData : [],
    [projectData, projectsEnabled],
  );
  const selectionAccountKey = projectsEnabled ? session.accountId || session.username || "authenticated" : "";
  const selectedProjectId = projectSelection.accountKey === selectionAccountKey ? projectSelection.projectId : "";
  useEffect(() => {
    if (!projectsEnabled) {
      setProjectSelection((current) => current.accountKey || current.projectId ? { accountKey: "", projectId: "" } : current);
      return;
    }
    if (!projectsFetched || !selectionAccountKey) return;
    setProjectSelection((current) => {
      const storedProjectId = window.localStorage.getItem(projectSelectionStorageKey(selectionAccountKey)) || "";
      const candidate = current.accountKey === selectionAccountKey ? current.projectId : storedProjectId;
      const projectId = projects.some((project) => project.id === candidate) ? candidate : projects[0]?.id || "";
      if (current.accountKey === selectionAccountKey && current.projectId === projectId) return current;
      return { accountKey: selectionAccountKey, projectId };
    });
  }, [projects, projectsEnabled, projectsFetched, selectionAccountKey]);
  const projectSelectionReady = !projectsEnabled || Boolean(
    projectsFetched
    && projectSelection.accountKey === selectionAccountKey
    && (!projects.length || projects.some((project) => project.id === selectedProjectId)),
  );
  useEffect(() => {
    if (!projectSelectionReady || !selectionAccountKey) return;
    const storageKey = projectSelectionStorageKey(selectionAccountKey);
    if (selectedProjectId) window.localStorage.setItem(storageKey, selectedProjectId);
    else window.localStorage.removeItem(storageKey);
  }, [projectSelectionReady, selectedProjectId, selectionAccountKey]);
  useEffect(() => {
    window.localStorage.setItem("project-manage:sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);
  const setSelectedProjectId = useCallback((projectId: string) => {
    if (!selectionAccountKey) return;
    setProjectSelection((current) => current.accountKey === selectionAccountKey && current.projectId === projectId
      ? current
      : { accountKey: selectionAccountKey, projectId });
  }, [selectionAccountKey]);
  const currentPageScope = pageScope(location.pathname, isAdmin(session));
  const changeProject = useCallback((projectId: string) => {
    if (projectId === selectedProjectId) return;
    setSelectedProjectId(projectId);
    if (/^\/requirements\/[^/]+$/.test(location.pathname)) {
      navigate("/requirements");
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
  }, [location.pathname, location.search, navigate, selectedProjectId, setSelectedProjectId]);
  const context = {
    session,
    projects,
    selectedProjectId,
    syncProjectContext: setSelectedProjectId,
    openLogin: () => setLoginOpen(true),
    openPassword: () => setPasswordOpen(true),
  };
  if (sessionError) return <StartupError title="登录状态加载失败" error={sessionError} onRetry={() => void refetchSession()} />;
  if (projectsEnabled && projectsError) return <StartupError title="项目列表加载失败" error={projectsError} onRetry={() => void refetchProjects()} />;
  return (
    <InlineEditProvider>
      <AppContext.Provider value={context}>
        <div className={`app-shell${sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}>
        <Sidebar session={session} selectedProjectId={selectedProjectId} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((value) => !value)} branding={branding} />
        <main>
          <Topbar
            session={session}
            projects={projects}
            selectedProjectId={selectedProjectId}
            setSelectedProjectId={changeProject}
            projectSelectionReady={projectSelectionReady}
            scope={currentPageScope}
            openLogin={() => setLoginOpen(true)}
            openPassword={() => setPasswordOpen(true)}
          />
          <Suspense fallback={<div className="route-loading" role="status">正在加载页面…</div>}>
          <Routes>
            <Route path="/" element={session.authenticated ? <ProjectRoute session={session} ready={sessionReady} projectSelectionReady={projectSelectionReady} currentProjectId={selectedProjectId}><DashboardPage /></ProjectRoute> : <GuestLanding openLogin={() => setLoginOpen(true)} />} />
            <Route path="/analytics" element={<ProjectRoute session={session} ready={sessionReady} projectSelectionReady={projectSelectionReady} currentProjectId={selectedProjectId}><AnalyticsPage /></ProjectRoute>} />
            <Route path="/my-work" element={<RoleRoute session={session} ready={sessionReady}><MyWorkPage /></RoleRoute>} />
            <Route path="/actions" element={<ProjectRoute session={session} ready={sessionReady} projectSelectionReady={projectSelectionReady} currentProjectId={selectedProjectId}><ActionCenterPage /></ProjectRoute>} />
            <Route path="/settings" element={<RoleRoute session={session} ready={sessionReady}><PersonalSettingsPage /></RoleRoute>} />
            <Route path="/requirements" element={<ProjectRoute session={session} ready={sessionReady} projectSelectionReady={projectSelectionReady} currentProjectId={selectedProjectId}><RequirementsPage /></ProjectRoute>} />
            <Route path="/requirements/:id" element={<ProjectRoute session={session} ready={sessionReady} projectSelectionReady={projectSelectionReady} currentProjectId={selectedProjectId} resetOnProjectChange={false}><RequirementPage /></ProjectRoute>} />
            <Route path="/issues" element={<ProjectRoute session={session} ready={sessionReady} projectSelectionReady={projectSelectionReady} currentProjectId={selectedProjectId}><IssuesPage /></ProjectRoute>} />
            <Route path="/people" element={<ProjectRoute session={session} ready={sessionReady} projectSelectionReady={projectSelectionReady} currentProjectId={selectedProjectId}><PeoplePage /></ProjectRoute>} />
            <Route path="/concurrency" element={<Navigate to="/people?view=analysis" replace />} />
            <Route path="/templates" element={<ProjectRoute session={session} ready={sessionReady} projectSelectionReady={projectSelectionReady} currentProjectId={selectedProjectId}><TemplatesPage /></ProjectRoute>} />
            <Route path="/project-settings" element={<ProjectRoute session={session} ready={sessionReady} projectSelectionReady={projectSelectionReady} manager currentProjectId={selectedProjectId}><ProjectSettingsPage /></ProjectRoute>} />
            <Route path="/logs" element={isAdmin(session)
              ? <RoleRoute session={session} ready={sessionReady} admin><LogsPage /></RoleRoute>
              : <ProjectRoute session={session} ready={sessionReady} projectSelectionReady={projectSelectionReady} manager currentProjectId={selectedProjectId}><LogsPage /></ProjectRoute>} />
            <Route path="/projects" element={<RoleRoute session={session} ready={sessionReady} admin><ProjectsPage /></RoleRoute>} />
            <Route path="/resources" element={<RoleRoute session={session} ready={sessionReady} admin><AccountsPage /></RoleRoute>} />
            <Route path="/accounts" element={<Navigate to="/resources" replace />} />
            <Route path="/archives" element={<RoleRoute session={session} ready={sessionReady} admin><ArchiveCenterPage /></RoleRoute>} />
            <Route path="/system" element={<RoleRoute session={session} ready={sessionReady} admin><SystemPage /></RoleRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </main>
        {loginOpen && (
          <Modal
            title="用户登录"
            onClose={() => setLoginOpen(false)}
            width={440}
          >
            <LoginForm onClose={() => setLoginOpen(false)} branding={branding} />
          </Modal>
        )}
        {session.authenticated && (passwordOpen || session.mustChangePassword) && <Modal title={session.mustChangePassword ? "修改初始密码" : "修改密码"} onClose={() => setPasswordOpen(false)} width={460} closable={!session.mustChangePassword}>
          <PasswordForm forced={session.mustChangePassword} onClose={() => setPasswordOpen(false)} />
        </Modal>}
        </div>
      </AppContext.Provider>
    </InlineEditProvider>
  );
}
