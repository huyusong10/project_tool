import { lazy, type ComponentType, type LazyExoticComponent, type SVGProps } from "react";
import {
  Archive,
  BriefcaseBusiness,
  CircleAlert,
  ClipboardList,
  FileClock,
  FolderCog,
  Network,
  ScanSearch,
  ServerCog,
  SlidersHorizontal,
  UsersRound,
  Workflow,
} from "lucide-react";
import { DashboardPage } from "./pages/DashboardPage";

import type {PageScope} from './page-foundation';
export type {PageScope} from './page-foundation';
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
  component: (LazyExoticComponent<ComponentType> | ComponentType) & {preload?: () => Promise<unknown>};
  nav?: NavEntry[];
  chrome?: { title?: string };
};

/** 导航确定后即可下载页面模块，与对象读取并行；渲染错误仍由页面边界处理。 */
function lazyPage(load: () => Promise<{default: ComponentType}>) {
  return Object.assign(lazy(load), {preload: load});
}
export function preloadPage(pathname: string) {
  void matchRoute(pathname)?.component.preload?.().catch(() => { /* 正式渲染时显示原加载错误。 */ });
}
const AnalyticsPage = lazyPage(() => import("./pages/AnalyticsPage").then((module) => ({ default: module.AnalyticsPage })));
const PathsPage = lazyPage(() => import("./pages/PathsPage").then((module) => ({ default: module.PathsPage })));
const MyWorkPage = lazyPage(() => import("./pages/MyWorkPage").then((module) => ({ default: module.MyWorkPage })));
const ActionCenterPage = lazyPage(() => import("./pages/ActionCenterPage").then((module) => ({ default: module.ActionCenterPage })));
const RequirementPage = lazyPage(() => import("./pages/RequirementPage").then((module) => ({ default: module.RequirementPage })));
const IssuesPage = lazyPage(() => import("./pages/IssuesPage").then((module) => ({ default: module.IssuesPage })));
const PeoplePage = lazyPage(() => import("./pages/PeoplePage").then((module) => ({ default: module.PeoplePage })));
const TemplatesPage = lazyPage(() => import("./pages/TemplatesPage").then((module) => ({ default: module.TemplatesPage })));
const ProjectSettingsPage = lazyPage(() => import("./pages/ProjectSettingsPage").then((module) => ({ default: module.ProjectSettingsPage })));
const ProjectsPage = lazyPage(() => import("./pages/ProjectsPage").then((module) => ({ default: module.ProjectsPage })));
const AccountsPage = lazyPage(() => import("./pages/AccountsPage").then((module) => ({ default: module.AccountsPage })));
const ArchiveCenterPage = lazyPage(() => import("./pages/ArchiveCenterPage").then((module) => ({ default: module.ArchiveCenterPage })));
const SystemPage = lazyPage(() => import("./pages/SystemPage").then((module) => ({ default: module.SystemPage })));
const PersonalSettingsPage = lazyPage(() => import("./pages/PersonalSettingsPage").then((module) => ({ default: module.PersonalSettingsPage })));
const LogsPage = lazyPage(() => import("./pages/LogsPage").then((module) => ({ default: module.LogsPage })));

/**
 * 全站路由清单：路由表、侧边栏导航、页面作用域的唯一事实来源。
 * 数组顺序即导航分组与组内顺序（新增页面只需在此登记一次）。
 */
export const appRoutes: AppRoute[] = [
  {
    path: "/", scope: "project", access: "all", component: PathsPage,
    nav: [{ group: "项目", label: "项目工作区", icon: BriefcaseBusiness, end: true }],
  },
  { path: "/execution", scope:"project", access:"all", component:DashboardPage, chrome:{title:"项目工作区"} },
  { path: "/paths", scope: "project", access: "all", component: PathsPage },
  {
    path: "/analytics", scope: "project", access: "all", component: AnalyticsPage,
    chrome: {title: "项目工作区"},
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
    path: "/features", scope: "project", access: "all", component: PathsPage,

  },
  {
    path: "/requirements", scope: "project", access: "all", component: PathsPage,
    chrome: {title: "项目工作区"},
  },
  { path: "/requirements/:id", scope: "project", access: "all", component: RequirementPage, chrome: {title: '需求详情'} },
  {
    path: "/actions", scope: "project", access: "all", component: ActionCenterPage, chrome: {title: '异常行动中心'},

  },
  {
    path: "/issues", scope: "project", access: "all", component: IssuesPage,
    nav: [{ group: "项目", label: "问题跟踪", icon: CircleAlert }],
  },
  {
    path: "/people", scope: "project", access: "all", component: PeoplePage,
    nav: [{ group: "项目配置", label: "人员矩阵", icon: Network }],
  },
  {
    path: "/templates", scope: "project", access: "all", component: TemplatesPage,
    nav: [{ group: "项目配置", label: "流程设计", icon: Workflow }],
  },
  {
    path: "/project-settings", scope: "project", access: "manager", component: ProjectSettingsPage,
    nav: [{ group: "项目配置", label: "项目设置", icon: FolderCog, visible: ({ managesCurrentProject }) => managesCurrentProject }],
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
  {path:"/project-logs",scope:"project",access:"manager",component:LogsPage,nav:[{group:"项目配置",label:"项目日志",icon:FileClock,visible:({managesCurrentProject})=>managesCurrentProject}]},
  {
    path: "/logs", scope: "project", adminScope: "platform", access: "manager", component: LogsPage,
    nav: [
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
