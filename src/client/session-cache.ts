import { clearPageViews } from './use-page-view';
import type { QueryClient } from '@tanstack/react-query';
import { keys } from './query-keys';
import { invalidateAccessRequests } from './api';
import type { Project, Session } from './types';
import { clearGraphDrafts } from './use-graph-draft';

export const guestSession: Session = {
  authenticated: false, username: null, httpWarning: true, role: 'guest', globalRole: 'guest',
  personId: null, mustChangePassword: false, managedProjectIds: [],
};

/** 名称和项目顺序变化不影响草稿；身份、角色或授权范围变化必须重新读取业务数据。 */
export function sessionAccessKey(session: Session) {
  return session.authenticated ? JSON.stringify([
    session.accountId || session.username, session.personId, session.globalRole, session.role,
    session.mustChangePassword, [...session.managedProjectIds].sort(),
  ]) : 'guest';
}

export function projectAccessKey(projects: Project[]) {
  return JSON.stringify(projects.map(({ id, projectRole, canManage }) => [id, projectRole, canManage])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
}

export function clearBusinessQueries(client: QueryClient, keepProjects = false) {
  invalidateAccessRequests();
  client.removeQueries({ predicate: ({ queryKey }) => ![
    'session', 'branding', ...(keepProjects ? ['projects'] : []),
  ].includes(String(queryKey[0])) });
}

/** 登录/退出的已确认结果立即生效，取消旧会话读取，不能等待另一次请求才切换身份。 */
export async function commitSession(client: QueryClient, session: Session | null) {
  clearGraphDrafts();
  clearPageViews();
  // 先作废旧身份的请求再等待取消；否则 await 窗口内完成的旧请求可能在清理之后回填业务缓存。
  invalidateAccessRequests();
  await client.cancelQueries({ queryKey: keys.session });
  clearBusinessQueries(client);
  client.setQueryData<Session | null>(keys.session, session);
}
