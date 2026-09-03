import { useEffect, useLayoutEffect, useState, type ComponentType, type SVGProps } from "react";
import { createPortal } from "react-dom";
import { NavLink } from "react-router-dom";
import {
  Archive,
  BarChart3,
  BriefcaseBusiness,
  CircleAlert,
  ClipboardList,
  FileClock,
  FolderCog,
  GanttChartSquare,
  ListChecks,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  ScanSearch,
  ServerCog,
  SlidersHorizontal,
  UsersRound,
  Workflow,
} from "lucide-react";
import type { Session, SystemBranding } from "../types";
import { canManageProject, isAdmin } from "../permissions";
import { BrandLogo } from "./BrandLogo";

type NavIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: string | number }>;
type NavItem = { label: string; to: string; icon: NavIcon; end?: boolean; visible?: boolean };
type NavGroup = { label: string; items: NavItem[] };
type TooltipState = { anchor: HTMLElement; label: string; group: string };

function groupsFor(session: Session, selectedProjectId: string): NavGroup[] {
  const managesCurrentProject = canManageProject(session, selectedProjectId);
  const admin = isAdmin(session);
  if (!session.authenticated) return [];
  return [
    { label: "工作台", items: [
      { label: "项目进展", to: "/", icon: GanttChartSquare, end: true },
      { label: "统计分析", to: "/analytics", icon: BarChart3 },
    ] },
    { label: "个人", items: [
      { label: "我的工作", to: "/my-work", icon: ClipboardList },
      { label: "个人设置", to: "/settings", icon: SlidersHorizontal },
    ] },
    { label: "项目空间", items: [
      { label: "需求管理", to: "/requirements", icon: ListChecks },
      { label: "问题跟踪", to: "/issues", icon: CircleAlert },
      { label: "人员矩阵", to: "/people", icon: Network },
      { label: "流程设计", to: "/templates", icon: Workflow },
      { label: "项目设置", to: "/project-settings", icon: FolderCog, visible: managesCurrentProject },
      { label: "项目日志", to: "/logs", icon: FileClock, visible: !admin && managesCurrentProject },
    ] },
    { label: "平台治理", items: [
      { label: "项目中心", to: "/projects", icon: BriefcaseBusiness, visible: admin },
      { label: "人员与权限", to: "/resources", icon: UsersRound, visible: admin },
      { label: "归档中心", to: "/archives", icon: Archive, visible: admin },
    ] },
    { label: "平台运维", items: [
      { label: "系统管理", to: "/system", icon: ServerCog, visible: admin },
      { label: "操作审计", to: "/logs", icon: ScanSearch, visible: admin },
    ] },
  ].map((group) => ({ ...group, items: group.items.filter((item: NavItem) => item.visible !== false) }))
    .filter((group) => group.items.length);
}

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

export function Sidebar({
  session,
  selectedProjectId,
  collapsed,
  onToggle,
  branding,
}: {
  session: Session;
  selectedProjectId: string;
  collapsed: boolean;
  onToggle: () => void;
  branding: SystemBranding;
}) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const groups = groupsFor(session, selectedProjectId);
  useEffect(() => setTooltip(null), [collapsed]);
  const showTooltip = (anchor: HTMLElement, label: string, group: string) => {
    if (collapsed) setTooltip({ anchor, label, group });
  };
  return (
    <aside className={`sidebar${collapsed ? " sidebar-collapsed" : ""}`} aria-label="主导航">
      <div className="brand-mark">
        <BrandLogo branding={branding} />
        <strong className="brand-name">{branding.systemName}</strong>
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
        {groups.length ? groups.map((group, groupIndex) => (
          <section className="nav-group" aria-label={group.label} key={group.label}>
            <span className={`nav-section${groupIndex === 0 ? " nav-section-first" : ""}`}>{group.label}</span>
            <div className="nav-group-items">
              {group.items.map((item) => {
                const Icon = item.icon;
                return <NavLink
                  to={item.to}
                  end={item.end}
                  key={`${group.label}-${item.label}`}
                  aria-label={item.label}
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
        )) : <span className="nav-login-hint">登录后使用项目工作台</span>}
      </nav>
      <NavigationTooltip value={tooltip} />
    </aside>
  );
}
