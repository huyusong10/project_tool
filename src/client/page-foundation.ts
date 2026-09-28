export type PageScope = 'project' | 'personal' | 'platform';
import type {Project} from './types';
export type NavigationRuntime = {commitFields: (reveal?: boolean) => boolean; cancel: () => void};
export type PathSource = {projectId:string;label:string;index:number};

export function pathBackTarget(projectId:string, source:PathSource|undefined, historyIndex:number|undefined) {
  const valid = Boolean(source && source.projectId === projectId && typeof source.label === 'string' && Number.isInteger(source.index) && source.index >= 0 && source.index === (historyIndex ?? 0) - 1);
  return {label:valid ? '返回'+source!.label : '返回项目路径', fallback:'/paths', kind:valid ? 'history' as const : 'path' as const};
}

/** 每个导航只接收自己的声明；旧组件的清理不能删除新组件发布的操作。 */
export function createChromeStore<T extends {runtime?: NavigationRuntime | null}>(navigationKey: string) {
  let current: { owner: symbol; value: T } | null = null;
  let preparing = false;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());
  return {
    navigationKey,
    getSnapshot: () => current?.value || null,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    publish: (key: string, owner: symbol, value: T) => {
      if (key !== navigationKey) return;
      current = {owner, value}; notify();
    },
    release: (key: string, owner: symbol) => {
      if (key !== navigationKey || current?.owner !== owner) return;
      current = null; notify();
    },
    prepareNavigation: () => {
      if (preparing) return;
      preparing = true;
      queueMicrotask(() => { preparing = false; });
      const runtime = current?.value.runtime;
      runtime?.commitFields(false); runtime?.cancel();
    },
  };
}

const projectSelections = new Map<string, string>();
export function rememberedProject(account: string) {
  if (projectSelections.has(account)) return projectSelections.get(account)!;
  try { return localStorage.getItem(`project-manage:selected-project:${account}`) || ''; } catch { return ''; }
}
export function rememberProject(account: string, project: string) {
  if (!account || !project) return;
  projectSelections.set(account, project);
  try { localStorage.setItem(`project-manage:selected-project:${account}`, project); } catch { /* 当前页面仍可使用。 */ }
}
/** 只有对象、页面模式和明确项目参与导航身份；筛选、聚焦和视口不会重建页面。 */
export function pageIdentity(pathname: string, params: URLSearchParams) {
  if(pathname==='/'&&params.has('workspaceView'))return 'workspace|'+(params.get('projectId')||'');
  if(pathname==='/jira')return 'jira|'+(params.get('projectId')||'');
  return [pathname, ...['view','edit','draft','draftProject','projectId','issueId','requirementId','featureId','root'].map(key => `${key}=${params.get(key) || ''}`)].join('|');
}
export function chooseProject(projects: Project[], explicit: string | null, remembered: string) {
  if (explicit !== null) return projects.find(project => project.id === explicit);
  return projects.find(project => project.id === remembered) || projects[0];
}

/** 仅指定项目的链接仍恢复该项目的个人视图；明确筛选或对象参数优先。 */
export function restorePageSearch(current: string, saved: string) {
  const params = new URLSearchParams(current), view = new URLSearchParams(current);
  view.delete('projectId');
  if (view.size) return params;
  const restored = new URLSearchParams(saved);
  if (params.has('projectId')) restored.set('projectId', params.get('projectId')!);
  return restored;
}
