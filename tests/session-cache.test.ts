import { expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { api, AccessChangedError, isTemporaryReadError, setUnauthorizedHandler } from '../src/client/api';
import { cacheResourceUpdate } from '../src/client/use-resource-query';
import { clearBusinessQueries, commitSession, guestSession, projectAccessKey, sessionAccessKey } from '../src/client/session-cache';
import type { Project, Session } from '../src/client/types';

const session: Session = { ...guestSession, authenticated: true, accountId: 'a1', username: '原名', role: 'project_manager', globalRole: 'user', personId: 'u1', managedProjectIds: ['p2', 'p1'] };
const projects = [{ id: 'p1', name: '原项目', projectRole: 'member', canManage: false }, { id: 'p2', name: '二项目', projectRole: 'manager', canManage: true }] as Project[];

it('改名及项目顺序变化不重置权限边界', () => {
  expect(sessionAccessKey({ ...session, username: '新名字', managedProjectIds: ['p1', 'p2'] })).toBe(sessionAccessKey(session));
  expect(projectAccessKey([{ ...projects[1], name: '新二项目' }, projects[0]])).toBe(projectAccessKey(projects));
});

it.each([
  { accountId: 'a2' }, { personId: 'u2' }, { mustChangePassword: true }, { managedProjectIds: ['p1'] },
  { globalRole: 'admin' as const }, { authenticated: false },
])('身份/权限变化必须切换页面和缓存边界：%j', (change) => {
  expect(sessionAccessKey({ ...session, ...change })).not.toBe(sessionAccessKey(session));
});

it('项目移除或角色变化必须重新读取业务范围', () => {
  expect(projectAccessKey([projects[0]])).not.toBe(projectAccessKey(projects));
  expect(projectAccessKey([{ ...projects[0], projectRole: 'viewer' }, projects[1]])).not.toBe(projectAccessKey(projects));
});

it('切换身份取消旧会话读取，迟到响应不能重新登录旧账号', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let release!: (value: Session) => void;
  let signal!: AbortSignal;
  try {
    client.setQueryData(['session'], session);
    client.setQueryData(['requirement', 'r1'], { id: 'r1' });
    client.setQueryData(['projects', 'a1'], projects);
    client.setQueryData(['branding'], { siteName: '不变品牌' });
    const pending = client.fetchQuery({ queryKey: ['session'], queryFn: (context) => {
      signal = context.signal;
      return new Promise<Session>((resolve) => { release = resolve; });
    } }).catch(() => undefined);
    await commitSession(client, guestSession);
    expect(signal.aborted).toBe(true);
    expect(client.getQueryData(['session'])).toEqual(guestSession);
    expect(client.getQueryData(['requirement', 'r1'])).toBeUndefined();
    expect(client.getQueryData(['projects', 'a1'])).toBeUndefined();
    expect(client.getQueryData(['branding'])).toEqual({ siteName: '不变品牌' });
    release(session);
    await pending;
    expect(client.getQueryData(['session'])).toEqual(guestSession);
  } finally { client.clear(); }
});

it('项目授权变化保留会话和当前项目读取，只清除业务缓存', () => {
  const client = new QueryClient();
  try {
    client.setQueryData(['session'], session);
    client.setQueryData(['projects', 'a1'], projects);
    client.setQueryData(['my-work', 'a1'], { items: ['old'] });
    clearBusinessQueries(client, true);
    expect(client.getQueryData(['session'])).toEqual(session);
    expect(client.getQueryData(['projects', 'a1'])).toEqual(projects);
    expect(client.getQueryData(['my-work', 'a1'])).toBeUndefined();
  } finally { client.clear(); }
});

it('切换身份后迟到的写响应不能把旧账号数据填回新缓存', async () => {
  const client = new QueryClient();
  let release!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
  try {
    client.setQueryData(['session'], session);
    client.setQueryData(['issue', 'i1'], { title: '旧账号私有问题' });
    const pending = api('/api/issues/i1/resolve', { method: 'POST' }).then((saved) => cacheResourceUpdate(client, ['issue', 'i1'], saved));
    await commitSession(client, { ...session, accountId: 'a2' });
    release(new Response(JSON.stringify({ title: '旧账号私有问题', status: 'resolved' })));
    await expect(pending).rejects.toThrow(/权限已变化/);
    expect(client.getQueryData(['issue', 'i1'])).toBeUndefined();
  } finally { client.clear(); vi.unstubAllGlobals(); }
});

it.each([200, 401, 503])('HTTP %i 正文读取期间切换身份，旧响应不能回填或踢掉新账号', async (status) => {
  const client = new QueryClient();
  let release!: (data: unknown) => void;
  let began!: () => void;
  const reading = new Promise<void>((resolve) => { began = resolve; });
  const unauthorized = vi.fn();
  setUnauthorizedHandler(unauthorized);
  const fetcher = vi.fn().mockResolvedValue({ status, ok: status === 200, json: () => {
    began();
    return new Promise((resolve) => { release = resolve; });
  } });
  vi.stubGlobal('fetch', fetcher);
  try {
    const pending = api('/api/issues/i1/resolve', { method: 'POST' }).catch((error: unknown) => error);
    await reading;
    await commitSession(client, { ...session, accountId: 'a2' });
    release({ title: '旧私有数据', error: '旧会话已失效' });
    const error = await pending;
    expect(error).toBeInstanceOf(AccessChangedError);
    expect(isTemporaryReadError(error)).toBe(false);
    expect(unauthorized).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { client.clear(); vi.unstubAllGlobals(); setUnauthorizedHandler(null); }
});

it.each([200, 401])('已取消的权限来源请求即使JSON仍返回HTTP %i也不能生效', async (status) => {
  const controller = new AbortController();
  const unauthorized = vi.fn();
  setUnauthorizedHandler(unauthorized);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status, ok: status === 200, json: async () => {
    controller.abort();
    return { error: '旧权限读取已失效' };
  } }));
  try {
    await expect(api('/api/projects', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(unauthorized).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); setUnauthorizedHandler(null); }
});
