import * as requirementsApi from './features/requirements/api';
import * as issuesApi from './features/issues/api';
import * as templatesApi from './features/templates/api';
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { keys } from './query-keys';
import { useResourceQuery } from './use-resource-query';
import { isGuestRoute, matchRoute, pageScopeFor } from './routes';
import { canManageProject, isAdmin } from './permissions';
import { sessionAccessKey } from './session-identity';
import { ApiError } from './api';
import { clearProjectGraphDrafts } from './use-graph-draft';
import { pathBackTarget } from './page-foundation';
import { toolbarForRoute } from './page-presentation';
import { chooseProject, pageIdentity, rememberedProject, rememberProject, type ResourceQuery, type ResolvedPageContext } from './page-context';
import type { Issue, Project, Requirement, Session, WorkItemTemplate } from './types';

/** 对象查询与项目列表并行；所属项目确认前不挂载项目业务页面。 */
export function usePageResolution(sessionQuery: ResourceQuery<Session>, projectsQuery: ResourceQuery<Project[]>, session: Session, projects: Project[]) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const def = matchRoute(location.pathname);
  const scope = pageScopeFor(location.pathname, isAdmin(session));
  const browseReady = !sessionQuery.unavailable && !session.mustChangePassword;
  const authenticated = !sessionQuery.unavailable && session.authenticated && !session.mustChangePassword;
  const account = session.accountId || session.username || 'guest';
  const remembered = rememberedProject(account);
  const requirementId = /^\/requirements\/([^/]+)$/.exec(location.pathname)?.[1] || '';
  const draft = Boolean(requirementId && params.has('draftProject'));
  const issueId = location.pathname === '/issues' ? params.get('detailId')?.replace(/^issue:/, '') || params.get('issueId') || '' : '';
  const requirement = useResourceQuery<Requirement>(keys.requirement(requirementId), signal => requirementsApi.requirementsById<Requirement>(encodeURIComponent(requirementId), { signal }), browseReady && Boolean(requirementId) && !draft);
  const issue = useResourceQuery<Issue>(keys.issue(issueId), signal => issuesApi.issuesById<Issue>(encodeURIComponent(issueId), { signal }), authenticated && Boolean(issueId));
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
    : !session.authenticated && explicitProject === null && projects.length > 1 && !projects.some(p => p.id === remembered) ? undefined : chooseProject(projects, explicitProject, remembered);
  const templateMode = location.pathname === '/templates';
  const templateId = templateMode ? params.get('edit') || '' : '';
  const templates = useResourceQuery<WorkItemTemplate[]>([...keys.templates, project?.id || ''], signal => templatesApi.templatesQuery<WorkItemTemplate[]>(encodeURIComponent(project?.id || ''), { signal }), authenticated && templateMode && Boolean(project));
  const template = templates.data?.find(t => t.id === templateId);
  const nav = def?.nav?.find(entry => !entry.visible || entry.visible({admin: isAdmin(session), managesCurrentProject: canManageProject(session, project?.id || '')}));
  let phase: ResolvedPageContext['phase'] = 'ready';
  let error: Error | undefined, errorTitle: string | undefined;
  let retry: () => unknown = () => sessionQuery.refetch();
  const waitFor = (query: {unavailable: boolean; data?: unknown; error: Error | null; refetch: () => unknown}, title: string) => {
    if (!query.unavailable) return;
    // A write's recheck can revoke cached access before the background query finishes.
    const denied = query.data === null;
    phase = query.error || denied ? 'error' : 'loading';
    error = query.error || (denied ? new Error(title.startsWith('问题') ? '问题不存在或当前账号无权访问。' : '资源不存在或当前账号无权访问。') : undefined);
    errorTitle = title; retry = query.refetch;
  };
  waitFor(sessionQuery, '登录状态加载失败');
  if (phase === 'ready' && browseReady && scope === 'project') waitFor(projectsQuery, '项目列表加载失败');
  if (phase === 'ready' && browseReady && objectQuery) waitFor(objectQuery, requirementId ? '需求无法打开' : '问题详情加载失败');
  if (phase === 'ready' && browseReady && scope === 'project' && !project && (objectQuery || explicitProject !== null)) {
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
  if (phase === 'ready' && browseReady && (!session.authenticated || project?.publicReadOnly) && !isGuestRoute(location.pathname)) {
    phase = 'error'; errorTitle = '此页面需要项目授权'; error = new Error('游客可以浏览项目空间。登录有权限的账号后可使用此页面。'); retry = () => projectsQuery.refetch();
  }
  const resolvedProjectId = phase === 'ready' ? project?.id : undefined;
  useEffect(() => { if (browseReady && resolvedProjectId) rememberProject(account, resolvedProjectId); }, [account, browseReady, resolvedProjectId]);
  let title = def?.chrome?.title || nav?.label || '';
  let back: ResolvedPageContext['back'];
  if (requirementId) {
    title = draft ? '需求草稿' : requirement.data?.title || '需求详情';
    back = params.get('view') === 'path' ? pathBackTarget(project?.id || '', location.state?.pathSource, window.history.state?.idx) : {label:phase === 'error' ? '返回需求清单' : '返回', fallback:'/requirements', kind:'history'};
  } else if (templateId) {
    const templateProjectId = project?.id || explicitProject;
    title = template?.name || '新建流程'; back = {label:'返回流程列表', fallback:'/templates'+(templateProjectId?'?projectId='+encodeURIComponent(templateProjectId):''), kind:'templates'};
  } else if (location.pathname === '/paths' && project) title = '项目空间';
  const navigationKey = `${sessionAccessKey(session)}|${pageIdentity(location.pathname, params)}|${project?.id || ''}|${project?.projectRole || ''}|${Boolean(project?.canManage)}|${Boolean(project?.publicReadOnly)}`;
  const toolbar = toolbarForRoute(location.pathname, location.search);
  const page: ResolvedPageContext = {navigationKey, phase, scope, project: phase === 'ready' ? project : undefined, title, back, toolbar, actionRow: toolbar !== 'none', error, errorTitle, retry,
    object: requirementId ? {kind:draft ? 'draft' : 'requirement', id:requirementId} : issueId ? {kind:'issue',id:issueId} : templateId ? {kind:'template',id:templateId} : undefined};
  const resources = {requirement, issue, templates, projects: projectsQuery};
  return {page, resources, pageIcon: nav?.icon};
}
