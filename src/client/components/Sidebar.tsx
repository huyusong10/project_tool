import {workspaceParams} from '../workspace-location';
import { issueTrackingHome, useIssueTrackingOnly } from '../application-mode';
import {isProjectWorkspace} from '../project-workspace-navigation';
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, NavLink, useLocation } from "react-router-dom";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { SystemBranding } from "../types";
import { useProjects, useSession } from "../app-context";
import { canManageProject, isAdmin } from "../permissions";
import { navGroupsFor, pageScopeFor } from "../routes";
import { rememberedProject } from '../page-foundation';
import { BrandLogo } from "./BrandLogo";

type TooltipState = { anchor: HTMLElement; label: string; group: string };

function NavigationTooltip({ value }: { value: TooltipState | null }) {
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (!value) return;
    const update = () => {
      const rect = value.anchor.getBoundingClientRect();
      setPosition({ left: rect.right + 10, top: Math.max(8, Math.min(window.innerHeight - 66, rect.top + rect.height / 2 - 27)) });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [value]);
  if (!value || typeof document === "undefined") return null;
  return createPortal(
    <div className="sidebar-tooltip" role="tooltip" style={position}>
      <strong>{value.label}</strong>
      <span>{value.group}</span>
    </div>,
    document.body,
  );
}

export function Sidebar({ collapsed, onToggle, onNavigate, branding, ready }: { collapsed: boolean; onToggle: () => void; onNavigate?: () => void; branding?: SystemBranding; ready: boolean }) {
  const { session } = useSession();
  const issueTrackingOnly = useIssueTrackingOnly();
  const { selectedProjectId, projects } = useProjects();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const groups = navGroupsFor({
    issueTrackingOnly,
    authenticated: session.authenticated,
    workspaceOnly: projects.find(p => p.id === selectedProjectId)?.publicReadOnly,
    admin: isAdmin(session),
    managesCurrentProject: canManageProject(session, selectedProjectId),
  });
  useEffect(() => setTooltip(null), [collapsed]);
  const showTooltip = (anchor: HTMLElement, label: string, group: string) => {
    if (collapsed) setTooltip({ anchor, label, group });
  };
  const location=useLocation();
  const navigationProjectId = selectedProjectId || projects.find(project => project.id === rememberedProject(session.accountId || session.username || 'guest'))?.id;
  const home=issueTrackingOnly?issueTrackingHome(navigationProjectId):navigationProjectId?'/?'+workspaceParams({projectId:navigationProjectId,view:'list',scope:{kind:'project',id:navigationProjectId}}):'/';
  return (
    <aside className={`sidebar${collapsed ? " sidebar-collapsed" : ""}`} aria-label="主导航">
      <div className="brand-mark">
        <Link to={home} className="brand-home" aria-label="返回主页" title={issueTrackingOnly ? '返回问题跟踪' : '返回项目主页'} onClick={onNavigate}>
          {branding ? <BrandLogo branding={branding} /> : <span className="brand-logo shell-placeholder" aria-hidden="true"/>}
        </Link>
        <strong className="brand-name">{branding?.systemName || <span className="brand-name-placeholder shell-placeholder" aria-hidden="true"/>}</strong>
        <button
          type="button"
          className="sidebar-collapse-button"
          onClick={onToggle}
          aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
          aria-expanded={!collapsed}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>
      <nav className="sidebar-nav" aria-label="功能导航">
        {!ready ? <span className="nav-login-hint" aria-label="正在加载导航"/> : groups.length ? groups.map((group, groupIndex) => (
          <section className="nav-group" aria-label={group.label} key={group.label}>
            <span className={`nav-section${groupIndex === 0 ? " nav-section-first" : ""}`}>{group.label}</span>
            <div className="nav-group-items">
              {group.items.map((item) => {
                const Icon = item.icon;
                return <NavLink
                  to={navigationProjectId && pageScopeFor(item.to, isAdmin(session)) === 'project' ? `${item.to}?${new URLSearchParams({ projectId: navigationProjectId })}` : item.to}
                  end={item.end}
                  className={({isActive})=>isActive||item.to==='/'&&isProjectWorkspace(location.pathname)?'active':undefined}
                  key={`${group.label}-${item.label}`}
                  aria-label={item.label}
                  onClick={onNavigate}
                  onMouseEnter={(event) => showTooltip(event.currentTarget, item.label, group.label)}
                  onMouseLeave={() => setTooltip(null)}
                  onFocus={(event) => showTooltip(event.currentTarget, item.label, group.label)}
                  onBlur={() => setTooltip(null)}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span className="nav-label">{item.label}</span>
                </NavLink>;
              })}
            </div>
          </section>
        )) : <span className="nav-login-hint">{issueTrackingOnly ? '登录后使用问题跟踪' : '登录后使用项目工作台'}</span>}
      </nav>
      <NavigationTooltip value={tooltip} />
    </aside>
  );
}
