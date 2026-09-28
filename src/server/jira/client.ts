import { z } from 'zod';
import { jiraConnectionMessages, type JiraIssue, type JiraStatus, type JiraProject, type JiraIssueType, type JiraUser } from '../../shared/jira';
import { AppError } from '../errors';
import type { JiraWorkflow } from '../../shared/jira-pr';

export class JiraRemoteError extends AppError {
  constructor(public readonly status: number, public readonly uncertain = false) {
    super(status === 401 ? jiraConnectionMessages.invalidToken : status === 403 ? jiraConnectionMessages.permission : status === 404 ? '当前 Jira 账号无法读取此事项' : status === 429 ? 'Jira 请求受限，请稍后手动重试' : uncertain ? 'Jira 操作结果不明，请先核对远端状态' : jiraConnectionMessages.unavailable, 502, status === 401 ? 'JIRA_AUTH_FAILED' : status === 403 ? 'JIRA_PERMISSION_DENIED' : 'JIRA_CONNECTION_FAILED');
  }
}
const named = z.object({ id: z.string(), name: z.string() });
const issueSchema = z.object({ id: z.string(), key: z.string(), fields: z.object({ summary: z.string(), issuetype: named, status: named, updated: z.string() }) });
const transitionsSchema = z.object({ transitions: z.array(z.object({ id: z.string(), name: z.string(), to: named, fields: z.record(z.string(), z.object({ required: z.boolean().optional(), hasDefaultValue: z.boolean().optional(), name: z.string().optional() })).optional() })) });
export type JiraTransition = { id: string; name: string; to: JiraStatus; requiredFields: string[] };
export type JiraComment = { id: string; body: string; created: string; author?: { displayName: string } };
const commentSchema = z.object({ id: z.string(), body: z.string(), created: z.string(), author: z.object({ displayName: z.string() }).optional() });
export interface JiraClient {
  myself(): Promise<string>;
  projects(): Promise<JiraProject[]>;
  issueTypes(project: string): Promise<JiraIssueType[]>;
  components(project: string): Promise<JiraStatus[]>;
  users(query: string): Promise<JiraUser[]>;
  labels(query: string): Promise<string[]>;
  search(jql: string, startAt: number): Promise<{ issues: JiraIssue[]; total: number; nextStartAt: number | null }>;
  issue(key: string): Promise<JiraIssue>;
  transitions(key: string): Promise<JiraTransition[]>;
  workflow(project: string, typeId: string): Promise<JiraWorkflow | null>;
  transition(key: string, transitionId: string): Promise<void>;
  comments(key: string, startAt: number): Promise<{ comments: JiraComment[]; nextStartAt: number | null; total: number }>;
  addComment(key: string, body: string): Promise<JiraComment>;
  documentLinks(key: string): Promise<Array<{ title: string; url: string; kind: 'document' }>>;
}

export function createJiraClient(site: string, apiVersion: string, token: string): JiraClient {
  if (!/^\d+$/.test(apiVersion)) throw new Error('Jira API 版本配置无效');
  const base = new URL(site);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Jira 地址必须是无凭据的 HTTPS 地址');
  const root = site.replace(/\/$/, '') + '/rest/api/' + apiVersion;
  async function request(resource: string, body?: unknown, resourceRoot = root): Promise<unknown> {
    const writing = body !== undefined;
    let response: Response;
    try {
      response = await fetch(resourceRoot + resource, { method: writing ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(writing ? { 'Content-Type': 'application/json' } : {}) }, ...(writing ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch { throw new JiraRemoteError(0, writing); }
    if (!response.ok) throw new JiraRemoteError(response.status, writing && response.status >= 500);
    if (response.status === 204) return null;
    try { return await response.json(); } catch { throw new JiraRemoteError(0, writing); }
  }
  function normalize(raw: unknown): JiraIssue {
    const parsed = issueSchema.safeParse(raw);
    if (!parsed.success) throw new JiraRemoteError(0);
    const i = parsed.data;
    return { id: i.id, key: i.key, title: i.fields.summary, typeId: i.fields.issuetype.id, type: i.fields.issuetype.name, status: i.fields.status, updated: i.fields.updated, url: site + '/browse/' + encodeURIComponent(i.key) };
  }
  const fields = 'summary,issuetype,status,updated';
  async function read<T>(resource: string, schema: z.ZodType<T>): Promise<T> {
    const parsed = schema.safeParse(await request(resource));
    if (!parsed.success) throw new JiraRemoteError(0);
    return parsed.data;
  }
  return {
    projects: () => read('/project', z.array(named.extend({ key: z.string() }))),
    issueTypes: project => read('/project/' + encodeURIComponent(project) + '/statuses', z.array(named.extend({ statuses: z.array(named) }))),
    components: project => read('/project/' + encodeURIComponent(project) + '/components', z.array(named)),
    users: query => read('/user/search?' + new URLSearchParams({ username: query, maxResults: '50', includeActive: 'true', includeInactive: 'true' }), z.array(z.object({ name: z.string(), displayName: z.string() }))),
    async labels(query) {
      const result = await read('/jql/autocompletedata/suggestions?' + new URLSearchParams({ fieldName: 'labels', fieldValue: query }), z.object({ results: z.array(z.object({ value: z.string() })) }));
      return [...new Set(result.results.map(r => r.value))];
    },
    async myself() {
      const p = z.object({ displayName: z.string(), name: z.string().optional(), key: z.string().optional() }).safeParse(await request('/myself'));
      if (!p.success) throw new JiraRemoteError(0);
      return `${p.data.displayName} (${p.data.name || p.data.key || p.data.displayName})`;
    },
    async search(jql, startAt) {
      const query = new URLSearchParams({ jql, startAt: String(startAt), maxResults: '50', fields });
      const p = z.object({ issues: z.array(z.unknown()), total: z.number(), startAt: z.number() }).safeParse(await request('/search?' + query));
      if (!p.success) throw new JiraRemoteError(0);
      const { issues, total } = p.data, next = p.data.startAt + issues.length;
      if (p.data.startAt !== startAt || (!issues.length && next < total)) throw new JiraRemoteError(0);
      return { issues: issues.map(normalize), total, nextStartAt: next < total && issues.length ? next : null };
    },
    async issue(key) { return normalize(await request('/issue/' + encodeURIComponent(key) + '?fields=' + fields)); },
    async transitions(key) {
      const p = transitionsSchema.safeParse(await request('/issue/' + encodeURIComponent(key) + '/transitions?expand=transitions.fields'));
      if (!p.success) throw new JiraRemoteError(0);
      const required = [...new Set(p.data.transitions.flatMap(t => Object.entries(t.fields || {}).filter(([, f]) => f.required && !f.hasDefaultValue).map(([key]) => key)))];
      const values = required.length ? (await read('/issue/' + encodeURIComponent(key) + '?fields=' + encodeURIComponent(required.join(',')), z.object({ fields: z.record(z.string(), z.unknown()) }))).fields : {};
      const empty = (value: unknown) => value == null || typeof value === 'string' && !value.trim() || Array.isArray(value) && !value.length;
      return p.data.transitions.map(t => ({ id: t.id, name: t.name, to: t.to, requiredFields: Object.entries(t.fields || {}).filter(([key, f]) => f.required && !f.hasDefaultValue && (key === 'comment' || empty(values[key]))).map(([key, f]) => f.name || key) }));
    },
    async workflow(project, typeId) {
      try {
        const scheme = await read('/project/' + encodeURIComponent(project) + '/workflowscheme', z.object({ defaultWorkflow: z.string(), issueTypeMappings: z.record(z.string(), z.string()).default({}) }));
        const name = scheme.issueTypeMappings[typeId] || scheme.defaultWorkflow;
        const graph = z.object({ layout: z.object({ statuses: z.array(z.object({ id: z.string(), name: z.string(), statusId: z.string().optional() })), transitions: z.array(z.object({ actionId: z.union([z.number(), z.string()]), name: z.string(), sourceId: z.string(), targetId: z.string(), initial: z.boolean().optional(), globalTransition: z.boolean().optional() })) }) }).parse(await request('/workflows?name=' + encodeURIComponent(name), undefined, site.replace(/\/$/, '') + '/rest/workflowDesigner/latest'));
        const statuses = graph.layout.statuses.filter(s => s.statusId).map(s => ({ node: s.id, id: s.statusId!, name: s.name }));
        const edges = graph.layout.transitions.flatMap(t => {
          const to = statuses.find(s => s.node === t.targetId);
          if (t.initial || !to) return [];
          const origins = t.globalTransition ? statuses : statuses.filter(s => s.node === t.sourceId);
          return origins.map(from => ({ id: String(t.actionId), name: t.name, from: { id: from.id, name: from.name }, to: { id: to.id, name: to.name } }));
        });
        return { name, edges };
      } catch (e) {
        if (e instanceof JiraRemoteError && e.status === 401) throw e;
        return null;
      }
    },
    async transition(key, transitionId) { await request('/issue/' + encodeURIComponent(key) + '/transitions', { transition: { id: transitionId } }); },
    async comments(key, startAt) {
      const result = await read('/issue/' + encodeURIComponent(key) + '/comment?' + new URLSearchParams({ startAt: String(startAt), maxResults: '50' }), z.object({ comments: z.array(commentSchema), startAt: z.number(), total: z.number() }));
      const next = startAt + result.comments.length;
      if (result.startAt !== startAt || (!result.comments.length && next < result.total)) throw new JiraRemoteError(0);
      return { comments: result.comments, total: result.total, nextStartAt: next < result.total ? next : null };
    },
    async addComment(key, body) {
      const parsed = commentSchema.safeParse(await request('/issue/' + encodeURIComponent(key) + '/comment', { body }));
      if (!parsed.success) throw new JiraRemoteError(0, true);
      return parsed.data;
    },
    async documentLinks(key) {
      const p = z.array(z.object({ object: z.object({ url: z.string(), title: z.string() }) })).safeParse(await request('/issue/' + encodeURIComponent(key) + '/remotelink'));
      if (!p.success) throw new JiraRemoteError(0);
      return p.data.flatMap(({ object }) => {
        try { const u = new URL(object.url); return u.protocol === 'https:' && (u.hostname === 'ec-confluence.jereh.cn' || /confluence/i.test(u.hostname) || /\/pages\/|\/spaces\//.test(u.pathname)) ? [{ ...object, kind: 'document' as const }] : []; } catch { return []; }
      });
    },
  };
}
