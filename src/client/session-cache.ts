import { clearPageViews } from "./use-page-view";
import type { QueryClient } from '@tanstack/react-query';
import { keys } from "./query-keys";
import { invalidateAccessRequests } from "./api";
import type { Project, Session } from "./types";
import { clearGraphDrafts } from "./use-graph-draft";

export const guestSession: Session = {
  authenticated: false, username: null, httpWarning: true, role: 'guest', globalRole: 'guest',
  personId: null, mustChangePassword: false, managedProjectIds: [],
};

export function projectAccessKey(projects: Project[]) {
  return JSON.stringify(projects.map(({ id, projectRole, canManage, guestVisible, publicReadOnly }) => [id, projectRole, canManage, guestVisible, publicReadOnly])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
}

export function clearBusinessQueries(client: QueryClient, keepProjects = false) {
  invalidateAccessRequests();
  client.removeQueries({ predicate: ({ queryKey }) => ![
    'session', 'branding', ...(keepProjects ? ['projects'] : []),
  ].includes(String(queryKey[0])) });
}

export async function commitSession(client: QueryClient, session: Session | null) {
  clearGraphDrafts();
  clearPageViews();
  // 先作废旧身份的请求再等待取消；否则 await 窗口内完成的旧请求可能在清理之后回填业务缓存。
  invalidateAccessRequests();
  await client.cancelQueries({ queryKey: keys.session });
  clearBusinessQueries(client);
  client.setQueryData<Session | null>(keys.session, session);
}

export { sessionAccessKey } from './session-identity';
