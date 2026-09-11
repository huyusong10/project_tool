import {useEffect, useRef} from 'react';
import {useLocation} from 'react-router-dom';
import {keys} from './query-keys';
import {useResourceQuery} from './use-resource-query';
import {matchRoute, pageScopeFor} from './routes';
import {canManageProject, isAdmin} from './permissions';
import {sessionAccessKey} from './session-cache';
import {ApiError} from './api';
import {clearProjectGraphDrafts} from './use-graph-draft';
import {pathBackTarget} from './page-foundation';
import {toolbarForRoute} from './page-presentation';
import {chooseProject, pageIdentity, rememberedProject, rememberProject, type ResourceQuery, type ResolvedPageContext} from './page-context';
import type {Issue, Project, Requirement, Session, WorkItemTemplate} from './types';

/** 对象查询与项目列表并行；所属项目确认前不挂载项目业务页面。 */
export function usePageResolution(sessionQuery: ResourceQuery<Session>, projectsQuery: ResourceQuery<Project[]>, session: Session, projects: Project[]) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const def = matchRoute(location.pathname);
  const scope = pageScopeFor(location.pathname, isAdmin(session));
  const authenticated = !sessionQuery.unavailable && session.authenticated && !session.mustChangePassword;
  const account = session.accountId || session.username || 'guest';
  const remembered = rememberedProject(account);
  const requirementId = /^\/requirements\/([^/]+)$/.exec(location.pathname)?.[1] || '';
  const draft = Boolean(requirementId && params.has('draftProject'));
  const issueId = location.pathname === '/issues' ? params.get('issueId') || '' : '';
  const requirement = useResourceQuery<Requirement>(keys.requirement(requirementId), `/api/requirements/${encodeURIComponent(requirementId)}`, authenticated && Boolean(requirementId) && !draft);
  const issue = useResourceQuery<Issue>(keys.issue(issueId), `/api/issues/${encodeURIComponent(issueId)}`, authenticated && Boolean(issueId));
  const objectQuery = requirementId && !draft ? requirement : issueId ? issue : undefined;
  const priorObject = useRef({id:'', projectId:''});
  useEffect(() => {
    const id = requirementId || issueId;
    if (!objectQuery?.unavailable && objectQuery?.data) priorObject.current = {id, projectId:objectQuery.data.projectId};
    if (objectQuery?.error instanceof ApiError && [401,403].includes(objectQuery.error.status) && priorObject.current.id === id) clearProjectGraphDrafts(account, priorObject.current.projectId);
  }, [requirementId, issueId, objectQuery?.data, objectQuery?.error, objectQuery?.unavailable, account]);
  const explicitProject = draft ? params.get('draftProject') : params.get('projectId');
  const project = scope !== 'project' ? undefined : objectQuery
    ? !objectQuery.unavailable ? projects.find(p => p.id === objectQuery.data?.projectId) : undefined
    : chooseProject(projects, explicitProject, remembered);
  const templateMode = location.pathname === '/templates';
  const templateId = templateMode ? params.get('edit') || '' : '';
  const templates = useResourceQuery<WorkItemTemplate[]>([...keys.templates, project?.id || ''], `/api/templates?projectId=${encodeURIComponent(project?.id || '')}`, authenticated && templateMode && Boolean(project));
  const template = templates.data?.find(t => t.id === templateId);
  const nav = def?.nav?.find(entry => !entry.visible || entry.visible({admin: isAdmin(session), managesCurrentProject: canManageProject(session, project?.id || '')}));
  let phase: ResolvedPageContext['phase'] = 'ready';
  let error: Error | undefined, errorTitle: string | undefined;
  let retry: () => unknown = () => sessionQuery.refetch();
  const waitFor = (query: {unavailable: boolean; error: Error | null; refetch: () => unknown}, title: string) => {
    if (!query.unavailable) return;
    phase = query.error ? 'error' : 'loading'; error = query.error || undefined; errorTitle = title; retry = query.refetch;
  };
  waitFor(sessionQuery, '登录状态加载失败');
  if (phase === 'ready' && authenticated && scope === 'project') waitFor(projectsQuery, '项目列表加载失败');
  if (phase === 'ready' && authenticated && objectQuery) waitFor(objectQuery, requirementId ? '需求无法打开' : '问题详情加载失败');
  if (phase === 'ready' && authenticated && scope === 'project' && !project && (objectQuery || explicitProject !== null)) {
    phase = 'error'; errorTitle = '项目不可用'; error = new Error('当前账号无法访问这个页面所属的项目。'); retry = () => projectsQuery.refetch();
  }
  if (phase === 'ready' && authenticated && templateId && templateId !== 'new' && project) {
    waitFor(templates, '流程加载失败');
    if (!templates.unavailable && !template) { phase = 'error'; errorTitle = '流程不可用'; error = new Error('当前项目中没有这个流程。请返回流程列表重新选择。'); retry = () => templates.refetch(); }
  }
  if (phase === 'ready' && authenticated && def && (def.access === 'admin' && !isAdmin(session) || def.access === 'manager' && !canManageProject(session, project?.id || ''))) {
    phase = 'error'; errorTitle = '无权访问此页面'; error = new Error('当前账号的页面权限已失效。'); retry = () => sessionQuery.refetch();
  }
  if (phase === 'ready' && authenticated && templateId && !canManageProject(session, project?.id || '')) {
    phase = 'error'; errorTitle = '无权编辑流程'; error = new Error('当前账号可以查看流程列表，不能编辑流程。'); retry = () => sessionQuery.refetch();
  }
  const resolvedProjectId = phase === 'ready' ? project?.id : undefined;
  useEffect(() => { if (authenticated && resolvedProjectId) rememberProject(account, resolvedProjectId); }, [account, authenticated, resolvedProjectId]);
  let title = def?.chrome?.title || nav?.label || '';
  let back: ResolvedPageContext['back'];
  if (requirementId) {
    title = draft ? '需求草稿' : requirement.data?.title || '需求详情';
    back = params.get('view') === 'path' ? pathBackTarget(project?.id || '', location.state?.pathSource, window.history.state?.idx) : {label:phase === 'error' ? '返回需求管理' : '返回', fallback:'/requirements', kind:'history'};
  } else if (templateId) {
    title = template?.name || '新建流程'; back = {label:'返回流程列表', fallback:'/templates', kind:'templates'};
  } else if (location.pathname === '/paths' && project) title = `${project.name} · 交付依赖`;
  const navigationKey = `${sessionAccessKey(session)}|${pageIdentity(location.pathname, params)}|${project?.id || ''}|${project?.projectRole || ''}|${Boolean(project?.canManage)}`;
  const toolbar = toolbarForRoute(location.pathname, location.search);
  const page: ResolvedPageContext = {navigationKey, phase, scope, project: phase === 'ready' ? project : undefined, title, back, toolbar, actionRow: toolbar !== 'none', error, errorTitle, retry,
    object: requirementId ? {kind:draft ? 'draft' : 'requirement', id:requirementId} : issueId ? {kind:'issue',id:issueId} : templateId ? {kind:'template',id:templateId} : undefined};
  const resources = {requirement, issue, templates};
  return {page, resources, pageIcon: nav?.icon};
}
