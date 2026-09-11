import { lazy, type ComponentType, type LazyExoticComponent, type SVGProps } from "react";
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
  ScanSearch,
  ServerCog,
  SlidersHorizontal,
  UsersRound,
  Workflow,
} from "lucide-react";
import { DashboardPage } from "./pages/DashboardPage";

export type PageScope = "project" | "personal" | "platform";
export type RouteAccess = "all" | "manager" | "admin";
export type NavIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: string | number }>;
export type NavVisibilityContext = { admin: boolean; managesCurrentProject: boolean };

export type NavEntry = {
  group: string;
  label: string;
  icon: NavIcon;
  end?: boolean;
  visible?: (context: NavVisibilityContext) => boolean;
};

export type AppRoute = {
  path: string;
  scope: PageScope;
  /** 管理员视角下的作用域覆盖（/logs：管理员归入平台运维）。 */
  adminScope?: PageScope;
  access: RouteAccess;
  component: LazyExoticComponent<ComponentType> | ComponentType;
  /** project 作用域下切换项目时是否随项目重挂载（详情页为 false）。 */
  resetOnProjectChange?: boolean;
  nav?: NavEntry[];
};

const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage").then((module) => ({ default: module.AnalyticsPage })));
const FeaturesPage = lazy(() => import("./pages/FeaturesPage").then(module => ({default:module.FeaturesPage})));
const PathsPage = lazy(() => import("./pages/PathsPage").then((module) => ({ default: module.PathsPage })));
const MyWorkPage = lazy(() => import("./pages/MyWorkPage").then((module) => ({ default: module.MyWorkPage })));
const ActionCenterPage = lazy(() => import("./pages/ActionCenterPage").then((module) => ({ default: module.ActionCenterPage })));
const RequirementsPage = lazy(() => import("./pages/RequirementsPage").then((module) => ({ default: module.RequirementsPage })));
const RequirementPage = lazy(() => import("./pages/RequirementPage").then((module) => ({ default: module.RequirementPage })));
const IssuesPage = lazy(() => import("./pages/IssuesPage").then((module) => ({ default: module.IssuesPage })));
const PeoplePage = lazy(() => import("./pages/PeoplePage").then((module) => ({ default: module.PeoplePage })));
const TemplatesPage = lazy(() => import("./pages/TemplatesPage").then((module) => ({ default: module.TemplatesPage })));
const ProjectSettingsPage = lazy(() => import("./pages/ProjectSettingsPage").then((module) => ({ default: module.ProjectSettingsPage })));
const ProjectsPage = lazy(() => import("./pages/ProjectsPage").then((module) => ({ default: module.ProjectsPage })));
const AccountsPage = lazy(() => import("./pages/AccountsPage").then((module) => ({ default: module.AccountsPage })));
const ArchiveCenterPage = lazy(() => import("./pages/ArchiveCenterPage").then((module) => ({ default: module.ArchiveCenterPage })));
const SystemPage = lazy(() => import("./pages/SystemPage").then((module) => ({ default: module.SystemPage })));
const PersonalSettingsPage = lazy(() => import("./pages/PersonalSettingsPage").then((module) => ({ default: module.PersonalSettingsPage })));
const LogsPage = lazy(() => import("./pages/LogsPage").then((module) => ({ default: module.LogsPage })));

/**
 * 全站路由清单：路由表、侧边栏导航、页面作用域的唯一事实来源。
 * 数组顺序即导航分组与组内顺序（新增页面只需在此登记一次）。
 */
export const appRoutes: AppRoute[] = [
  {
    path: "/", scope: "project", access: "all", component: DashboardPage,
    nav: [{ group: "工作台", label: "项目进展", icon: GanttChartSquare, end: true }],
  },
  { path: "/paths", scope: "project", access: "all", component: PathsPage, nav: [{ group: "工作台", label: "路径分析", icon: Network }] },
  {
    path: "/analytics", scope: "project", access: "all", component: AnalyticsPage,
    nav: [{ group: "工作台", label: "统计分析", icon: BarChart3 }],
  },
  {
    path: "/my-work", scope: "personal", access: "all", component: MyWorkPage,
    nav: [{ group: "个人", label: "我的工作", icon: ClipboardList }],
  },
  {
    path: "/settings", scope: "personal", access: "all", component: PersonalSettingsPage,
    nav: [{ group: "个人", label: "个人设置", icon: SlidersHorizontal }],
  },
  {
    path: "/features", scope: "project", access: "all", component: FeaturesPage,
    nav: [{group:"项目空间",label:"特性规划",icon:BriefcaseBusiness}],
  },
  {
    path: "/requirements", scope: "project", access: "all", component: RequirementsPage,
    nav: [{ group: "项目空间", label: "需求管理", icon: ListChecks }],
  },
  { path: "/requirements/:id", scope: "project", access: "all", component: RequirementPage, resetOnProjectChange: false },
  {
    path: "/actions", scope: "project", access: "all", component: ActionCenterPage,
    nav: [{ group: "项目空间", label: "异常行动", icon: CircleAlert }],
  },
  {
    path: "/issues", scope: "project", access: "all", component: IssuesPage,
    nav: [{ group: "项目空间", label: "问题跟踪", icon: CircleAlert }],
  },
  {
    path: "/people", scope: "project", access: "all", component: PeoplePage,
    nav: [{ group: "项目空间", label: "人员矩阵", icon: Network }],
  },
  {
    path: "/templates", scope: "project", access: "all", component: TemplatesPage,
    nav: [{ group: "项目空间", label: "流程设计", icon: Workflow }],
  },
  {
    path: "/project-settings", scope: "project", access: "manager", component: ProjectSettingsPage,
    nav: [{ group: "项目空间", label: "项目设置", icon: FolderCog, visible: ({ managesCurrentProject }) => managesCurrentProject }],
  },
  {
    path: "/projects", scope: "platform", access: "admin", component: ProjectsPage,
    nav: [{ group: "平台治理", label: "项目中心", icon: BriefcaseBusiness, visible: ({ admin }) => admin }],
  },
  {
    path: "/resources", scope: "platform", access: "admin", component: AccountsPage,
    nav: [{ group: "平台治理", label: "人员与权限", icon: UsersRound, visible: ({ admin }) => admin }],
  },
  {
    path: "/archives", scope: "platform", access: "admin", component: ArchiveCenterPage,
    nav: [{ group: "平台治理", label: "归档中心", icon: Archive, visible: ({ admin }) => admin }],
  },
  {
    path: "/system", scope: "platform", access: "admin", component: SystemPage,
    nav: [{ group: "平台运维", label: "系统管理", icon: ServerCog, visible: ({ admin }) => admin }],
  },
  {
    path: "/logs", scope: "project", adminScope: "platform", access: "manager", component: LogsPage,
    nav: [
      { group: "项目空间", label: "项目日志", icon: FileClock, visible: ({ admin, managesCurrentProject }) => !admin && managesCurrentProject },
      { group: "平台运维", label: "操作审计", icon: ScanSearch, visible: ({ admin }) => admin },
    ],
  },
];

export function matchRoute(pathname: string): AppRoute | undefined {
  return appRoutes.find((def) => {
    if (def.path === pathname) return true;
    if (!def.path.includes(":")) return false;
    return new RegExp(`^${def.path.replace(/:[^/]+/g, "[^/]+")}$`).test(pathname);
  });
}

export function pageScopeFor(pathname: string, admin: boolean): PageScope {
  const def = matchRoute(pathname);
  if (!def) return "project";
  return admin && def.adminScope ? def.adminScope : def.scope;
}

export type NavItem = { label: string; to: string; icon: NavIcon; end?: boolean };
export type NavGroup = { label: string; items: NavItem[] };

/** 由路由清单生成侧边栏导航分组（保持清单顺序）。 */
export function navGroupsFor(context: NavVisibilityContext & { authenticated: boolean }): NavGroup[] {
  if (!context.authenticated) return [];
  const groups = new Map<string, NavGroup>();
  for (const route of appRoutes) {
    for (const entry of route.nav ?? []) {
      if (entry.visible && !entry.visible(context)) continue;
      const group = groups.get(entry.group) ?? { label: entry.group, items: [] };
      group.items.push({ label: entry.label, to: route.path, icon: entry.icon, end: entry.end });
      groups.set(entry.group, group);
    }
  }
  return [...groups.values()];
}
