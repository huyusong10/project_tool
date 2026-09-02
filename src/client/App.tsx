import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
} from "react-router-dom";
import {
  Check,
  ChevronDown,
  CircleAlert,
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

const guestSession: Session = {
  authenticated: false,
  username: null,
  httpWarning: true,
};

function LoginForm({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const [error, setError] = useState("");
  const login = useMutation({
    mutationFn: (value: object) =>
      api<Session>("/api/login", { method: "POST", body: jsonBody(value) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["session"] });
      onClose();
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
        登录后可新建、修改项目数据并管理MCP Token。
      </p>
      <label className="field field-full">
        <span>用户名</span>
        <input
          name="username"
          defaultValue="user"
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

function Sidebar() {
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
        <span className="nav-section">管理</span>
        <NavLink to="/projects">
          <FolderKanban size={18} />
          项目管理
        </NavLink>
        <NavLink to="/templates">
          <Settings2 size={18} />
          流程设计
        </NavLink>
        <NavLink to="/system">
          <LockKeyhole size={18} />
          系统管理
        </NavLink>
        <NavLink to="/logs">
          <ScrollText size={18} />
          操作日志
        </NavLink>
      </nav>
      <div className="security-note">
        <LockKeyhole size={15} />
        <span>
          可信局域网运行
          <br />
          当前使用 HTTP
        </span>
      </div>
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
}: {
  session: Session;
  projects: Project[];
  selectedProjectId: string;
  setSelectedProjectId: (id: string) => void;
  openLogin: () => void;
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
        {session.authenticated ? (
          <>
            <span className="session-badge">
              <span />
              {session.username}
            </span>
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
    </header>
  );
}

export function App() {
  const [loginOpen, setLoginOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const { data: session = guestSession } = useQuery({
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
        <Sidebar />
        <main>
          <Topbar
            session={session}
            projects={projects}
            selectedProjectId={selectedProjectId}
            setSelectedProjectId={setSelectedProjectId}
            openLogin={() => setLoginOpen(true)}
          />
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/requirements" element={<RequirementsPage />} />
            <Route path="/requirements/:id" element={<RequirementPage />} />
            <Route path="/issues" element={<IssuesPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/people" element={<PeoplePage />} />
            <Route path="/concurrency" element={<Navigate to="/people?view=analysis" replace />} />
            <Route path="/templates" element={<TemplatesPage />} />
            <Route path="/system" element={<SystemPage />} />
            <Route path="/logs" element={<LogsPage />} />
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
      </div>
    </AppContext.Provider>
  );
}
