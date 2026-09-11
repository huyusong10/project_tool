import { useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Check, ChevronDown, LogIn, LogOut, Settings, UserRound } from "lucide-react";
import { api, isWriteOutcomeUnknown } from "../api";
import { useProjects, useSession, useTopbarSlots, useUiActions } from "../app-context";
import { invalidate, keys } from "../query-keys";
import { commitSession, guestSession } from "../session-cache";
import { ThemePicker } from "./ThemePicker";
import { AnchoredPopover } from "./InlineEdit";
import { useSynchronousPendingLock } from "./Modal";
import { useToast } from "./Toast";
import { TopbarMenu } from "./TopbarMenu";
import type { PageScope } from "../routes";

function ProjectSwitcher({ ready }: { ready: boolean }) {
  const { projects, selectedProjectId, changeProject } = useProjects();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selected = projects.find((project) => project.id === selectedProjectId) || projects[0];
  return <div className="project-switcher">
    {!ready ? <span className="project-switcher-empty"><span className="project-dot" />正在加载项目…</span> : projects.length ? <>
      <button type="button" ref={buttonRef} className="project-switcher-button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)} onKeyDown={event => {
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.project-switcher-menu [aria-selected="true"]')?.focus()); }
      }}>
        <span className="project-dot" />
        <span className="project-switcher-name">{selected?.name}</span>
        {selected?.isSample && <span className="sample-project-badge">样板</span>}
        <ChevronDown className={open ? "is-open" : ""} size={15} />
      </button>
      <AnchoredPopover anchorRef={buttonRef} open={open} onOutside={() => setOpen(false)} width={240} preserveEditing onEscape={() => { setOpen(false); buttonRef.current?.focus(); }}>
        <div className="project-switcher-menu" role="listbox" aria-label="切换项目" data-workspace-zone="tools" data-preserve-edit onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); buttonRef.current?.focus(); return; }
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index + items.length - 1) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null;
          if (next !== null) { event.preventDefault(); items[next]?.focus(); }
        }} onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && !buttonRef.current?.contains(event.relatedTarget)) setOpen(false); }}>
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
  const { setTitleEl, setActionsEl, setContextEl, setStatusEl, width, setWidth } = useTopbarSlots();
  const root = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = root.current!;
    const measure = () => setWidth(Math.round(element.getBoundingClientRect().width));
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => observer.disconnect();
  }, [setWidth]);
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
    <header ref={root} className="topbar" data-compact={width < 960} data-narrow={width < 640} data-workspace-zone="tools" data-preserve-edit>
      <div className="topbar-context">
        {scope === "project" ? <ProjectSwitcher ready={projectSelectionReady} /> : <ScopeIndicator scope={scope} />}
        <div id="topbar-title-slot" ref={setTitleEl} />
      </div>
      <div className="topbar-page-tools">
        <div id="topbar-context-slot" ref={setContextEl} />
        <div id="topbar-status-slot" ref={setStatusEl} />
        <div id="topbar-action-slot" ref={setActionsEl} />
      </div>
      <div className="topbar-personal">
        {width >= 640 && <ThemePicker />}
        <TopbarMenu label={session.authenticated ? `账号菜单：${session.username}` : '账号菜单'} icon={<UserRound size={17}/>} disabled={logoutLock.busy}
          text={width >= 960 ? <><span className={session.authenticated ? 'topbar-account-name' : 'topbar-guest-name'}>{session.authenticated ? session.username : '请登录'}</span><ChevronDown size={13}/></> : undefined}>
          <div className="topbar-account-heading">{session.authenticated ? session.username : '尚未登录'}</div>
          {session.authenticated ? <>
            <button type="button" role="menuitem" onClick={() => navigate('/settings')}><Settings size={16}/>个人设置</button>
            <button type="button" role="menuitem" disabled={logoutLock.busy} onClick={() => logoutLock.run(() => { logout.reset(); logout.mutate(); })}><LogOut size={16}/>退出登录</button>
          </> : <button type="button" role="menuitem" onClick={openLogin}><LogIn size={16}/>用户登录</button>}
          {width < 640 && <div data-menu-stay><ThemePicker showLabel /></div>}
        </TopbarMenu>
      </div>
    </header>
  );
}
