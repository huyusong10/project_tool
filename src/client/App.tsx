import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import {
  Check,
  ChevronDown,
  CircleAlert,
  ClipboardList,
  FolderKanban,
  GanttChartSquare,
  KeyRound,
  ListChecks,
  LockKeyhole,
  LogIn,
  LogOut,
  Settings2,
  ScrollText,
  Users,
  UserRoundCog,
} from "lucide-react";
import { api, jsonBody } from "./api";
import type { Project, Session } from "./types";
import { AppContext } from "./app-context";
import { DashboardPage } from "./pages/DashboardPage";
import { IssuesPage } from "./pages/IssuesPage";
import { RequirementPage } from "./pages/RequirementPage";
import {
  LogsPage,
  PeoplePage,
  ProjectsPage,
  RequirementsPage,
  SystemPage,
  TemplatesPage,
} from "./pages/ManagePages";
import { Modal } from "./components/Modal";
import { MyWorkPage } from "./pages/MyWorkPage";
import { AccountsPage } from "./pages/AccountsPage";
import { isAdmin } from "./permissions";

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

function LoginForm({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const login = useMutation({
    mutationFn: (value: object) =>
      api<Session>("/api/login", { method: "POST", body: jsonBody(value) }),
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ["session"] });
      onClose();
      if (result.role === "user") navigate("/my-work");
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
      <div className="login-symbol">
        <KeyRound size={25} />
      </div>
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
        <button type="button" className="ghost-button" onClick={onClose}>
          继续访客查看
        </button>
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

function Sidebar({ session }: { session: Session }) {
  return (
    <aside className="sidebar">
      <div className="brand-mark">
        <span>PM</span>
        <div>
          <strong>项目管理</strong>
          <small>LOCAL WORKSPACE</small>
        </div>
      </div>
      <nav>
        {session.authenticated && <NavLink to="/my-work">
          <ClipboardList size={18} />
          我的工作
        </NavLink>}
        <NavLink to="/" end>
          <GanttChartSquare size={18} />
          项目进展
        </NavLink>
        <NavLink to="/requirements">
          <ListChecks size={18} />
          需求管理
        </NavLink>
        <NavLink to="/issues">
          <CircleAlert size={18} />
          问题跟踪
        </NavLink>
        <NavLink to="/people">
          <Users size={18} />
          人员矩阵
        </NavLink>
        {(isAdmin(session) || session.managedProjectIds.length > 0) && <span className="nav-section">管理</span>}
        {(isAdmin(session) || session.managedProjectIds.length > 0) && <NavLink to="/projects">
          <FolderKanban size={18} />
          项目管理
        </NavLink>}
        {isAdmin(session) && <NavLink to="/accounts">
          <UserRoundCog size={18} />
          账号管理
        </NavLink>}
        {isAdmin(session) && <NavLink to="/templates">
          <Settings2 size={18} />
          流程设计
        </NavLink>}
        {isAdmin(session) && <NavLink to="/system">
          <LockKeyhole size={18} />
          系统管理
        </NavLink>}
        {isAdmin(session) && <NavLink to="/logs">
          <ScrollText size={18} />
          操作日志
        </NavLink>}
      </nav>
    </aside>
  );
}

function ProjectSwitcher({
  projects,
  selectedProjectId,
  setSelectedProjectId,
}: {
  projects: Project[];
  selectedProjectId: string;
  setSelectedProjectId: (id: string) => void;
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
    {projects.length ? <>
      <button type="button" className="project-switcher-button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="project-dot" />
        <span>{selected?.name}</span>
        <ChevronDown className={open ? "is-open" : ""} size={15} />
      </button>
      {open && <div className="project-switcher-menu" role="listbox" aria-label="切换项目">
        {projects.map((project) => <button type="button" role="option" aria-selected={project.id === selectedProjectId} key={project.id} onClick={() => { setSelectedProjectId(project.id); setOpen(false); }}>
          <span>{project.name}</span>
          {project.id === selectedProjectId && <Check size={15} />}
        </button>)}
      </div>}
    </> : <span className="project-switcher-empty"><span className="project-dot" />尚未创建项目</span>}
  </div>;
}

function Topbar({
  session,
  projects,
  selectedProjectId,
  setSelectedProjectId,
  openLogin,
  openPassword,
}: {
  session: Session;
  projects: Project[];
  selectedProjectId: string;
  setSelectedProjectId: (id: string) => void;
  openLogin: () => void;
  openPassword: () => void;
}) {
  const client = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api("/api/logout", { method: "POST" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["session"] }),
  });
  return (
    <header className="topbar">
      <div className="topbar-context">
        <div id="topbar-title-slot" />
        <ProjectSwitcher projects={projects} selectedProjectId={selectedProjectId} setSelectedProjectId={setSelectedProjectId} />
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
            <span className="guest-badge">访客只读</span>
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

function RoleRoute({ session, ready, admin = false, manager = false, children }: { session: Session; ready: boolean; admin?: boolean; manager?: boolean; children: ReactNode }) {
  if (!ready) return <div className="page-content"><div className="loading-block">正在确认账号权限…</div></div>;
  if (!session.authenticated) return <Navigate to="/" replace />;
  if (admin && !isAdmin(session)) return <Navigate to="/my-work" replace />;
  if (manager && !isAdmin(session) && !session.managedProjectIds.length) return <Navigate to="/my-work" replace />;
  return children;
}

export function App() {
  const [loginOpen, setLoginOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const { data: session = guestSession, isFetched: sessionReady } = useQuery({
    queryKey: ["session"],
    queryFn: () => api<Session>("/api/session"),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>("/api/projects"),
  });
  useEffect(() => {
    if (
      projects.length &&
      !projects.some((project) => project.id === selectedProjectId)
    )
      setSelectedProjectId(projects[0].id);
  }, [projects, selectedProjectId]);
  const context = {
    session,
    projects,
    selectedProjectId,
    setSelectedProjectId,
    openLogin: () => setLoginOpen(true),
  };
  return (
    <AppContext.Provider value={context}>
      <div className="app-shell">
        <Sidebar session={session} />
        <main>
          <Topbar
            session={session}
            projects={projects}
            selectedProjectId={selectedProjectId}
            setSelectedProjectId={setSelectedProjectId}
            openLogin={() => setLoginOpen(true)}
            openPassword={() => setPasswordOpen(true)}
          />
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/my-work" element={<RoleRoute session={session} ready={sessionReady}><MyWorkPage /></RoleRoute>} />
            <Route path="/requirements" element={<RequirementsPage />} />
            <Route path="/requirements/:id" element={<RequirementPage />} />
            <Route path="/issues" element={<IssuesPage />} />
            <Route path="/projects" element={<RoleRoute session={session} ready={sessionReady} manager><ProjectsPage /></RoleRoute>} />
            <Route path="/people" element={<PeoplePage />} />
            <Route path="/concurrency" element={<Navigate to="/people?view=analysis" replace />} />
            <Route path="/accounts" element={<RoleRoute session={session} ready={sessionReady} admin><AccountsPage /></RoleRoute>} />
            <Route path="/templates" element={<RoleRoute session={session} ready={sessionReady} admin><TemplatesPage /></RoleRoute>} />
            <Route path="/system" element={<RoleRoute session={session} ready={sessionReady} admin><SystemPage /></RoleRoute>} />
            <Route path="/logs" element={<RoleRoute session={session} ready={sessionReady} admin><LogsPage /></RoleRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        {loginOpen && (
          <Modal
            title="用户登录"
            onClose={() => setLoginOpen(false)}
            width={440}
          >
            <LoginForm onClose={() => setLoginOpen(false)} />
          </Modal>
        )}
        {session.authenticated && (passwordOpen || session.mustChangePassword) && <Modal title={session.mustChangePassword ? "修改初始密码" : "修改密码"} onClose={() => setPasswordOpen(false)} width={460} closable={!session.mustChangePassword}>
          <PasswordForm forced={session.mustChangePassword} onClose={() => setPasswordOpen(false)} />
        </Modal>}
      </div>
    </AppContext.Provider>
  );
}
