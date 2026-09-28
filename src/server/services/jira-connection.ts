import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import type { Actor } from '../auth';
import { requireAuthorizationActor } from '../authorization';
import { getDatabaseContext } from '../database-context';
import { AppError, fail } from '../errors';
import { createJiraClient, JiraRemoteError, type JiraClient } from '../jira/client';
import { jiraEncryptionKey } from '../jira/encryption-key';
import { jiraConnectionMessages, jiraSetupMessages, type JiraConnection } from '../../shared/jira';

type ConnectionRow = { account_id: string; site: string; encrypted_token: string; version: string; verified_at: string | null; identity: string | null; problem: string | null };
export function jiraSite() { return getDatabaseContext().config.jiraBaseUrl.replace(/\/+$/, ''); }
function encryptionKey() {
  return jiraEncryptionKey(getDatabaseContext().config);
}
function row(accountId: string) { return getDatabaseContext().sqlite.prepare('SELECT * FROM jira_connections WHERE account_id=?').get(accountId) as ConnectionRow | undefined; }
function decryptToken(c: ConnectionRow) {
  const [iv, tag, encrypted] = c.encrypted_token.split('.').map(v => Buffer.from(v, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAAD(Buffer.from(c.account_id + '\n' + c.site));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
export function jiraAccount(actor: Actor) {
  const auth = requireAuthorizationActor(actor);
  if (auth.type !== 'user') fail('Jira 操作仅允许登录用户发起', 'FORBIDDEN', 403);
  return auth.accountId;
}
export function connectionStatus(actor: Actor): JiraConnection {
  const c = row(jiraAccount(actor)), { config } = getDatabaseContext();
  let deploymentReady = true;
  if (config.jiraEnabled) {
    try { encryptionKey(); createJiraClient(jiraSite(), config.jiraApiVersion, ''); } catch { deploymentReady = false; }
  }
  const setupIssue = !config.jiraEnabled ? 'disabled' : !deploymentReady ? 'deployment' : null;
  const storedProblem = c?.problem ? Object.values(jiraConnectionMessages).find(message => message === c.problem) || '个人 Jira 连接需要重新验证，请测试已保存的连接。' : null;
  let problem = !config.jiraEnabled ? jiraSetupMessages.disabled : !deploymentReady ? jiraSetupMessages.deployment : c && c.site !== jiraSite() ? 'Jira 站点已变更，请重新配置 Token' : storedProblem;
  if (!problem && c) {
    try { decryptToken(c); } catch { problem = jiraConnectionMessages.savedUnavailable; }
  }
  return { configured: !!c, available: !problem, baseUrl: jiraSite(), version: c?.version || '', verifiedAt: problem ? null : c?.verified_at || null, identity: c?.identity || null, problem, setupIssue };
}
export function saveJiraConnection(actor: Actor, token: string) {
  const account = jiraAccount(actor), site = jiraSite(), key = encryptionKey();
  if (!getDatabaseContext().config.jiraEnabled) fail('Jira 集成已关闭');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(account + '\n' + site));
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const payload = [iv, cipher.getAuthTag(), encrypted].map(b => b.toString('base64')).join('.');
  getDatabaseContext().sqlite.transaction(() => {
    getDatabaseContext().sqlite.prepare(`INSERT INTO jira_connections(account_id,site,encrypted_token,version,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(account_id) DO UPDATE SET site=excluded.site,encrypted_token=excluded.encrypted_token,version=excluded.version,verified_at=NULL,identity=NULL,problem=NULL,updated_at=excluded.updated_at`).run(account, site, payload, randomUUID(), new Date().toISOString());
    getDatabaseContext().sqlite.prepare("DELETE FROM jira_operations WHERE account_id=? AND kind IN ('scan','import','jira_read','refresh','pr_generation')").run(account);
  })();
  return connectionStatus(actor);
}
export async function verifyAndSaveJiraConnection(actor: Actor, token: string) {
  const accountId = jiraAccount(actor), site = jiraSite(), version = row(accountId)?.version;
  encryptionKey();
  if (!getDatabaseContext().config.jiraEnabled) fail('Jira 集成已关闭');
  // A failed replacement must leave the currently saved connection usable.
  const identity = await createJiraClient(site, getDatabaseContext().config.jiraApiVersion, token).myself();
  jiraAccount(actor);
  return getDatabaseContext().sqlite.transaction(() => {
    if (row(accountId)?.version !== version || jiraSite() !== site) fail('连接已变化，请重新验证并保存', 'STALE_WRITE', 409);
    saveJiraConnection(actor, token);
    getDatabaseContext().sqlite.prepare('UPDATE jira_connections SET identity=?,verified_at=? WHERE account_id=?').run(identity, new Date().toISOString(), accountId);
    return connectionStatus(actor);
  })();
}
export function removeJiraConnection(actor: Actor) {
  const account = jiraAccount(actor);
  getDatabaseContext().sqlite.transaction(() => {
    getDatabaseContext().sqlite.prepare('DELETE FROM jira_connections WHERE account_id=?').run(account);
    getDatabaseContext().sqlite.prepare("DELETE FROM jira_operations WHERE account_id=? AND kind IN ('scan','import','jira_read','refresh','pr_generation')").run(account);
  })();
  return connectionStatus(actor);
}
export function jiraSession(actor: Actor, allowUnverified = false) {
  const accountId = jiraAccount(actor), c = row(accountId), status = connectionStatus(actor);
  if (!c) fail('请先在个人设置中配置 Jira Token', 'JIRA_CONNECTION_REQUIRED', 409);
  if (!status.available && !(allowUnverified && c.site === jiraSite() && !status.setupIssue)) fail(status.problem || 'Jira 连接不可用', 'JIRA_CONNECTION_REQUIRED', 409);
  if (!allowUnverified && !c.verified_at) fail('请先测试并验证个人 Jira 连接', 'JIRA_CONNECTION_REQUIRED', 409);
  let token: string;
  try {
    token = decryptToken(c);
  } catch { return fail(jiraConnectionMessages.savedUnavailable, 'JIRA_CONNECTION_REQUIRED', 409); }
  const adapter = createJiraClient(c.site, getDatabaseContext().config.jiraApiVersion, token);
  async function checked<T>(call: () => Promise<T>): Promise<T> {
    try { return await call(); } catch (error) {
      if (error instanceof JiraRemoteError && error.status === 401) getDatabaseContext().sqlite.prepare('UPDATE jira_connections SET verified_at=NULL,problem=? WHERE account_id=? AND version=?').run(error.message, accountId, c!.version);
      throw error;
    }
  }
  const client: JiraClient = {
    projects: () => checked(() => adapter.projects()), issueTypes: project => checked(() => adapter.issueTypes(project)),
    components: project => checked(() => adapter.components(project)), users: query => checked(() => adapter.users(query)), labels: query => checked(() => adapter.labels(query)),
    myself: () => checked(() => adapter.myself()), search: (jql, startAt) => checked(() => adapter.search(jql, startAt)),
    issue: key => checked(() => adapter.issue(key)), transitions: key => checked(() => adapter.transitions(key)),
    workflow: (project, typeId) => checked(() => adapter.workflow(project, typeId)),
    transition: (key, transitionId) => checked(() => adapter.transition(key, transitionId)), documentLinks: key => checked(() => adapter.documentLinks(key)),
    comments: (key, startAt) => checked(() => adapter.comments(key, startAt)), addComment: (key, body) => checked(() => adapter.addComment(key, body)),
  };
  return { accountId, version: c.version, identity: c.identity, site: c.site, client, assertCurrent() {
    const latest = jiraSessionVersion(actor);
    if (latest !== c.version || c.site !== jiraSite()) fail('个人 Jira 连接已变化，请重新扫描或预览', 'STALE_WRITE', 409);
  } };
}
export function jiraSessionVersion(actor: Actor) {
  const c = row(jiraAccount(actor));
  if (!c?.verified_at || !connectionStatus(actor).available) fail('个人 Jira 连接需要重新验证', 'JIRA_CONNECTION_REQUIRED', 409);
  return c.version;
}
export async function testJiraConnection(actor: Actor) {
  const session = jiraSession(actor, true);
  try {
    const identity = await session.client.myself();
    jiraAccount(actor);
    const changed = getDatabaseContext().sqlite.prepare('UPDATE jira_connections SET identity=?,verified_at=?,problem=NULL WHERE account_id=? AND version=? AND site=?').run(identity, new Date().toISOString(), session.accountId, session.version, jiraSite());
    if (!changed.changes) fail('连接已变化，请重新测试', 'STALE_WRITE', 409);
  } catch (error) {
    const message = error instanceof AppError ? error.message : jiraConnectionMessages.unavailable;
    getDatabaseContext().sqlite.prepare('UPDATE jira_connections SET verified_at=NULL,problem=? WHERE account_id=? AND version=?').run(message, session.accountId, session.version);
    if (error instanceof AppError) throw error;
    fail(message, 'JIRA_CONNECTION_FAILED', 502);
  }
  return connectionStatus(actor);
}
