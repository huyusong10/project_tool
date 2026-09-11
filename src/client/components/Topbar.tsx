import { useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppNavigate } from '../use-app-navigation';
import {useResolvedPage} from '../page-context';
import {usePageChrome, usePageChromeStore} from '../page-chrome';
import {WorkspaceRuntimeContext} from '../workspace-runtime';
import {useGanttTooltip} from './GanttTooltip';
import { ArrowLeft, Check, ChevronDown, LogIn, LogOut, Settings, UserRound } from "lucide-react";
import { api, isWriteOutcomeUnknown } from "../api";
import { useProjects, useSession, useUiActions } from "../app-context";
import { invalidate, keys } from "../query-keys";
import { commitSession, guestSession } from "../session-cache";
import { ThemePicker } from "./ThemePicker";
import { AnchoredPopover } from "./InlineEdit";
import { useSynchronousPendingLock } from "./Modal";
import { useToast } from "./Toast";
import { TopbarMenu } from "./TopbarMenu";
import type { NavIcon, PageScope } from "../routes";

function ProjectSwitcher({ ready }: { ready: boolean }) {
  const { projects, selectedProjectId, changeProject } = useProjects();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const page = useResolvedPage();
  const selectable = ready || Boolean(selectedProjectId) || page.phase === 'error' && projects.length > 0;
  const selected = projects.find((project) => project.id === selectedProjectId);
  return <div className="project-switcher">
    {!selectable ? <span className="project-switcher-empty" aria-label="正在加载项目"><span className="project-dot"/><span className="shell-placeholder project-name-placeholder"/></span> : projects.length ? <>
      <button type="button" ref={buttonRef} className="project-switcher-button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)} onKeyDown={event => {
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.project-switcher-menu [aria-selected="true"]')?.focus()); }
      }}>
        <span className="project-dot" />
        <span className="project-switcher-name">{selected?.name || '选择项目'}</span>
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

export function Topbar({ pageIcon: PageIcon, sessionReady }: { pageIcon?: NavIcon; sessionReady: boolean }) {
  const page = useResolvedPage();
  const chrome = usePageChrome();
  const store = usePageChromeStore();
  const scope = page.scope;
  const ready = page.phase === 'ready' && (page.object?.kind !== 'draft' || Boolean(chrome) && !chrome?.titlePending);
  const actionsReady = ready && Boolean(chrome) && !chrome?.titlePending;
  const title = page.phase === 'error' ? '页面不可用' : page.object?.kind === 'draft' || page.object?.kind === 'template' ? chrome?.title || page.title : page.title;
  const { session } = useSession();
  const { openLogin } = useUiActions();
  const [width, setWidth] = useState<number | null>(null);
  const root = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = root.current!;
    const measure = () => setWidth(Math.round(element.getBoundingClientRect().width));
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => observer.disconnect();
  }, [setWidth]);
  const client = useQueryClient();
  const navigate = useAppNavigate();
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
  const compact = width !== null && width < 960, narrow = width !== null && width < 640, dense = width !== null && width < 360;
  const fullTitle = useGanttTooltip();
  const titleEvents = fullTitle.bind(<div className="page-title-full">{title}</div>);
  const menu = <>{dense && !chrome?.persistentStatus && chrome?.status && <div className="topbar-menu-status" role="status">{chrome.status}</div>}{compact && chrome?.secondaryActions}{chrome?.moreActions}</>;
  const hasMenu = Boolean(chrome?.moreActions || compact && chrome?.secondaryActions || dense && !chrome?.persistentStatus && chrome?.status);
  const back = chrome?.onBack || (page.back || page.phase === 'error' ? () => {
    if (page.back?.kind === 'history' && window.history.state?.idx > 0) navigate(-1);
    else navigate(page.back?.fallback || '/', {replace: true});
  } : undefined);
  return (
    <WorkspaceRuntimeContext.Provider value={chrome?.runtime || null}>
    <header ref={root} className="topbar" data-compact={compact} data-narrow={narrow} data-actions-row={page.actionRow} data-toolbar={page.toolbar} data-page-phase={page.phase} data-navigation-key={page.navigationKey} data-workspace-zone="tools" data-preserve-edit
      onClickCapture={event => {if (chrome?.runtime?.requestSave && (event.target as Element).closest('[aria-label="保存修改"]')) {event.preventDefault();event.stopPropagation();chrome.runtime.requestSave();}}}
      onKeyDownCapture={event => {if (chrome?.runtime?.requestSave && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {event.preventDefault();event.stopPropagation();chrome.runtime.requestSave();}}}>
      <div className="topbar-context">
        {scope === "project" ? <ProjectSwitcher ready={ready} /> : <ScopeIndicator scope={scope} />}
        <div className="topbar-page-location">
          <div className="topbar-navigation">
            <div id="topbar-back-slot">{back ? <button type="button" className="ghost-button topbar-back-button" title={chrome?.backLabel || page.back?.label || '返回'} aria-label={chrome?.backLabel || page.back?.label || '返回'} onClick={() => {store.prepareNavigation(); back();}}><ArrowLeft size={14}/><span>返回</span></button> : PageIcon ? <span className="topbar-page-icon" aria-hidden="true"><PageIcon size={18}/></span> : null}</div>
          </div>
          <div id="topbar-title-slot"><div className="integrated-page-title"><h1 title={ready ? title : undefined} tabIndex={ready ? 0 : undefined} aria-busy={!ready && page.phase !== 'error'} aria-label={!ready && page.phase !== 'error' ? '正在加载页面标题' : undefined} {...titleEvents}
            onPointerEnter={event => {if (ready && event.currentTarget.scrollWidth > event.currentTarget.clientWidth) titleEvents.onPointerEnter(event);}}
            onPointerMove={event => {if (ready && event.currentTarget.scrollWidth > event.currentTarget.clientWidth) titleEvents.onPointerMove(event);}}
            onFocus={event => {if (ready && event.currentTarget.scrollWidth > event.currentTarget.clientWidth) titleEvents.onFocus(event);}}
          >{ready || page.phase === 'error' ? title : <span className="topbar-title-placeholder" aria-hidden="true"/>}</h1></div></div>
        </div>
      </div>
      <div className="topbar-page-tools">
        {actionsReady && chrome?.context && <div id="topbar-context-slot"><div className="topbar-page-context">{chrome.context}</div></div>}
        {actionsReady && chrome?.status && (!dense || chrome.persistentStatus) && <div id="topbar-status-slot"><div className="topbar-page-status" role="status">{chrome.status}</div></div>}
        <div id="topbar-action-slot">{actionsReady ? <div className="integrated-page-actions">{!compact && chrome?.secondaryActions}{chrome?.actions}{hasMenu && <TopbarMenu label={chrome?.moreLabel || '更多操作'} disabled={chrome?.moreDisabled}>{menu}</TopbarMenu>}{page.actionRow && !chrome?.actions && !chrome?.secondaryActions && !chrome?.moreActions && <span className="topbar-readonly">只读</span>}</div> : page.actionRow && <span className="topbar-actions-placeholder shell-placeholder" aria-hidden="true"/>}</div>
      </div>
      <div className="topbar-personal">
        {!narrow && <ThemePicker />}
        <TopbarMenu label={sessionReady && session.authenticated ? `账号菜单：${session.username}` : '账号菜单'} icon={<UserRound size={17}/>} disabled={!sessionReady || logoutLock.busy}
          text={!compact ? <><span className={session.authenticated ? 'topbar-account-name' : 'topbar-guest-name'}>{sessionReady ? session.authenticated ? session.username : '请登录' : <span className="shell-placeholder account-placeholder"/>}</span><ChevronDown size={13}/></> : undefined}>
          <div className="topbar-account-heading">{session.authenticated ? session.username : '尚未登录'}</div>
          {session.authenticated ? <>
            <button type="button" role="menuitem" onClick={() => navigate('/settings')}><Settings size={16}/>个人设置</button>
            <button type="button" role="menuitem" disabled={logoutLock.busy} onClick={() => logoutLock.run(() => { logout.reset(); logout.mutate(); })}><LogOut size={16}/>退出登录</button>
          </> : <button type="button" role="menuitem" onClick={openLogin}><LogIn size={16}/>用户登录</button>}
          {narrow && <div data-menu-stay><ThemePicker showLabel /></div>}
        </TopbarMenu>
      </div>
    </header>
    {fullTitle.tooltip}
    </WorkspaceRuntimeContext.Provider>
  );
}
