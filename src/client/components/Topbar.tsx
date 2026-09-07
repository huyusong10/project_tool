import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Check, ChevronDown, LogIn, LogOut, Moon, Sun } from "lucide-react";
import { api, isWriteOutcomeUnknown } from "../api";
import { useProjects, useSession, useTopbarSlots, useUiActions } from "../app-context";
import { invalidate, keys } from "../query-keys";
import { commitSession, guestSession } from "../session-cache";
import { toggleTheme, useTheme } from "../theme";
import { AnchoredPopover } from "./InlineEdit";
import { useSynchronousPendingLock } from "./Modal";
import { useToast } from "./Toast";
import type { PageScope } from "../routes";

function ProjectSwitcher({ ready }: { ready: boolean }) {
  const { projects, selectedProjectId, changeProject } = useProjects();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selected = projects.find((project) => project.id === selectedProjectId) || projects[0];
  return <div className="project-switcher">
    {!ready ? <span className="project-switcher-empty"><span className="project-dot" />正在加载项目…</span> : projects.length ? <>
      <button type="button" ref={buttonRef} className="project-switcher-button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="project-dot" />
        <span className="project-switcher-name">{selected?.name}</span>
        {selected?.isSample && <span className="sample-project-badge">样板</span>}
        <ChevronDown className={open ? "is-open" : ""} size={15} />
      </button>
      <AnchoredPopover anchorRef={buttonRef} open={open} onOutside={() => setOpen(false)} width={240}>
        <div className="project-switcher-menu" role="listbox" aria-label="切换项目">
          {projects.map((project) => <button type="button" role="option" aria-selected={project.id === selectedProjectId} key={project.id} onClick={() => { changeProject(project.id); setOpen(false); }}>
            <span className="project-switcher-option"><span>{project.name}</span>{project.isSample && <em className="sample-project-badge">样板</em>}</span>
            {project.id === selectedProjectId && <Check size={15} />}
          </button>)}
        </div>
      </AnchoredPopover>
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

export function Topbar({ scope, projectSelectionReady }: { scope: PageScope; projectSelectionReady: boolean }) {
  const { session } = useSession();
  const { openLogin } = useUiActions();
  const { setTitleEl, setActionsEl } = useTopbarSlots();
  const theme = useTheme();
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const logout = useMutation({
    mutationFn: () => api("/api/logout", { method: "POST" }),
    onSuccess: async () => {
      await commitSession(client, guestSession);
      invalidate(client, keys.session);
    },
    onError: async (error) => {
      if (isWriteOutcomeUnknown(error)) {
        try {
          const latest = await api<typeof guestSession>("/api/session", { readOnly: true });
          if (!latest.authenticated) {
            await commitSession(client, guestSession);
            invalidate(client, keys.session);
            logout.reset();
            return;
          }
        } catch {
          // 保留原退出异常；会话读取失败或仍已登录时不能确认退出成功。
        }
      }
      toast.error(error instanceof Error ? error.message : "退出登录失败，请重试");
    },
  });
  const logoutLock = useSynchronousPendingLock(logout.isPending);
  return (
    <header className="topbar">
      <div className="topbar-context">
        <div id="topbar-title-slot" ref={setTitleEl} />
        {scope === "project"
          ? <ProjectSwitcher ready={projectSelectionReady} />
          : <ScopeIndicator scope={scope} />}
      </div>
      <div className="top-actions">
        <div id="topbar-action-slot" ref={setActionsEl} />
        <button
          type="button"
          className="icon-button theme-toggle"
          aria-label={theme === "dark" ? "切换到亮色主题" : "切换到暗色主题"}
          title={theme === "dark" ? "切换到亮色主题" : "切换到暗色主题"}
          onClick={toggleTheme}
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <div className="topbar-account">
          {session.authenticated ? (
            <>
            <button className="session-badge session-button" disabled={logoutLock.busy} onClick={() => navigate("/settings")} title="个人设置">
              <span />
              {session.username}
            </button>
            <button className="ghost-button" disabled={logoutLock.busy} onClick={() => logoutLock.run(() => { logout.reset(); logout.mutate(); })}>
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
