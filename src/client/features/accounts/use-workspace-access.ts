import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useResourceQuery } from '../../use-resource-query';
import * as accountsApi from './api';
import * as projectsApi from '../projects/api';
import { clearGraphDrafts, clearProjectGraphDrafts } from '../../use-graph-draft';
import { clearBusinessQueries, guestSession, projectAccessKey, sessionAccessKey } from '../../session-cache';
import { keys } from '../../query-keys';
import { ApiError } from '../../api';
import { preloadPage } from '../../routes';
import type { Session, Project } from '../../types';
const noProjects: Project[] = [];
export function useWorkspaceAccess(pathname: string) {
  const client = useQueryClient();
  const sessionQuery = useResourceQuery<Session>(keys.session, signal => accountsApi.session<Session>({ signal }), true, (next) => {
    const previous = client.getQueryData<Session | null>(keys.session);
    if(previous&&(previous.accountId!==next.accountId||previous.personId!==next.personId||previous.globalRole!==next.globalRole||previous.role!==next.role||!next.authenticated||next.mustChangePassword))clearGraphDrafts(previous.accountId);
    else if(previous)for(const id of previous.managedProjectIds)if(!next.managedProjectIds.includes(id))clearProjectGraphDrafts(previous.accountId||'guest',id);
    if (previous === null || previous && sessionAccessKey(previous) !== sessionAccessKey(next)) clearBusinessQueries(client);
  });
  const session = sessionQuery.data || guestSession;
  const sessionReady = !sessionQuery.unavailable;
  const projectsEnabled = sessionReady && !session.mustChangePassword;
  useEffect(() => { if (projectsEnabled) preloadPage(pathname); }, [projectsEnabled, pathname]);
  const projectKey = [...keys.projects, session.accountId];
  const projectsQuery = useResourceQuery<Project[]>(projectKey, signal => projectsApi.projects<Project[]>({ signal }), projectsEnabled, (next) => {
    const previous = client.getQueryData<Project[] | null>(projectKey);
    for(const project of previous||[]){const updated=next.find(p=>p.id===project.id);if(!updated||project.canManage&&!updated.canManage||project.projectRole!==updated.projectRole)clearProjectGraphDrafts(session.accountId||'guest',project.id);}
    if (previous === null || previous && projectAccessKey(previous) !== projectAccessKey(next)) clearBusinessQueries(client, true);
  });
  const projects = projectsEnabled ? projectsQuery.data || noProjects : noProjects;
  useEffect(()=>{if([sessionQuery.error,projectsQuery.error].some(error=>error instanceof ApiError&&[401,403].includes(error.status)))clearGraphDrafts(session.accountId);},[sessionQuery.error,projectsQuery.error,session.accountId]);

  return { sessionQuery, session, sessionReady, projectsEnabled, projectsQuery, projects };
}
