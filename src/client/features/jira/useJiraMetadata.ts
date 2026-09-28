import { useQueries, useQuery } from '@tanstack/react-query';
import { useSession } from '../../app-context';
import type { JiraIssueType, JiraProject, JiraStatus } from '../../../shared/jira';
import * as jira from './api';

export function useJiraMetadata(projectId: string, selected: string[]) {
  const { session } = useSession();
  const connection = useQuery({ queryKey: ['jira-connection', session.accountId], queryFn: jira.connection, retry: false });
  const version = connection.data?.version || '';
  const ready = !!connection.data?.verifiedAt && connection.data.available;
  const scope = ['jira-metadata', session.accountId, projectId, connection.data?.baseUrl, version];
  const options = { retry: false, refetchOnWindowFocus: false, staleTime: 60_000, gcTime: 0 } as const;
  const projects = useQuery({ ...options, queryKey: [...scope, 'projects'], queryFn: () => jira.metadata<JiraProject[]>(projectId, { kind: 'projects', version }), enabled: ready });
  const keys = [...new Set(selected.map(value => projects.data?.find(p => p.key === value || p.id === value)?.key).filter((key): key is string => !!key))];
  const types = useQueries({ queries: keys.map(project => ({ ...options, queryKey: [...scope, 'types', project], queryFn: () => jira.metadata<JiraIssueType[]>(projectId, { kind: 'types', project, version }), enabled: ready })) });
  const components = useQueries({ queries: keys.map(project => ({ ...options, queryKey: [...scope, 'components', project], queryFn: () => jira.metadata<JiraStatus[]>(projectId, { kind: 'components', project, version }), enabled: ready })) });
  const typeRows = types.flatMap((q, i) => q.data?.map(type => ({ ...type, project: keys[i] })) || []);
  const componentRows = components.flatMap((q, i) => q.data?.map(component => ({ ...component, project: keys[i] })) || []);
  return { connection, ready, version, scope, projects, types, components, typeRows, componentRows, keys };
}
