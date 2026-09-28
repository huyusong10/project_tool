import { createHash, randomUUID } from 'node:crypto';
import { jiraSettingsSchema, type JiraSettingsRecord, type JiraScan, type JiraScanRow, type JiraIssue, type JiraImportPreview, type JiraCandidate } from '../../shared/jira';
import { jiraKeyFromUrl, jiraKeysFromTitle, normalizedJiraTitle } from '../../shared/jira-links';
import { readReferenceLinks } from '../../shared/reference-links';
import type { Actor } from '../auth';
import { assertProjectManager, requireAuthorizationActor } from '../authorization';
import { getDatabaseContext } from '../database-context';
import { AppError, fail, notFound } from '../errors';
import { recordAudit } from './audit';
import { jiraAccount, jiraSession, jiraSessionVersion, jiraSite } from './jira-connection';
import { getRequirement } from './requirements';
import { createRequirement } from './requirement-commands';
import { createRequirementInputSchema } from '../../shared/contracts';

export type Binding = { requirement_id: string; project_id: string; site: string; issue_id: string; issue_key: string };
export function assertJiraProject(projectId: string, actor: Actor) { jiraAccount(actor); assertProjectManager(requireAuthorizationActor(actor), projectId); }
export function jiraSettings(projectId: string, actor: Actor): JiraSettingsRecord {
  assertJiraProject(projectId, actor);
  const row = getDatabaseContext().sqlite.prepare('SELECT settings,version FROM jira_project_settings WHERE project_id=?').get(projectId) as { settings: string; version: number } | undefined;
  return row ? { version: row.version, settings: jiraSettingsSchema.parse(JSON.parse(row.settings)) } : { version: 0, settings: jiraSettingsSchema.parse({}) };
}
export function saveJiraSettings(projectId: string, actor: Actor, expectedVersion: number, raw: unknown) {
  const settings = jiraSettingsSchema.parse(raw), current = jiraSettings(projectId, actor);
  if (current.version !== expectedVersion) fail('Jira 项目规则已变化，请刷新', 'STALE_WRITE', 409);
  getDatabaseContext().sqlite.transaction(() => {
    assertJiraProject(projectId, actor);
    getDatabaseContext().sqlite.prepare('INSERT INTO jira_project_settings(project_id,settings,version) VALUES (?,?,?) ON CONFLICT(project_id) DO UPDATE SET settings=excluded.settings,version=excluded.version').run(projectId, JSON.stringify(settings), expectedVersion + 1);
    recordAudit(actor, 'update', 'jira_settings', projectId, '修改 Jira 发现范围', projectId);
  })();
  return jiraSettings(projectId, actor);
}
export function requireJiraEnabled(projectId: string, actor: Actor) {
  const config = jiraSettings(projectId, actor);
  if (!config.settings.enabled || !getDatabaseContext().config.jiraEnabled) fail('Jira 集成已关闭', 'JIRA_DISABLED', 409);
  return config;
}
export function projectBindings(projectId: string): Binding[] { return getDatabaseContext().sqlite.prepare('SELECT * FROM jira_bindings WHERE project_id=?').all(projectId) as Binding[]; }
export function requirementFacts(id: string, projectId: string) {
  const requirement = getDatabaseContext().sqlite.prepare(`SELECT r.id,r.title,r.status,f.name AS featureName,p.name AS phaseName FROM requirements r
    LEFT JOIN features f ON f.id=r.feature_id LEFT JOIN feature_phases p ON p.id=r.phase_id
    WHERE r.id=? AND r.project_id=? AND r.deleted_at IS NULL`).get(id, projectId) as { id: string; title: string; status: string; featureName: string | null; phaseName: string | null } | undefined;
  if (!requirement) notFound('需求不存在');
  return { requirement };
}
export function bindingVersion(id: string, projectId: string) {
  requirementFacts(id, projectId);
  const binding = projectBindings(projectId).find(b => b.requirement_id === id);
  return createHash('sha256').update(JSON.stringify(binding || null)).digest('hex');
}
export function storeJiraOperation(projectId: string, actor: Actor, kind: string, payload: unknown, state = 'preview') {
  const id = randomUUID(), now = new Date().toISOString();
  getDatabaseContext().sqlite.prepare('INSERT INTO jira_operations(id,account_id,project_id,credential_version,kind,state,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, jiraAccount(actor), projectId, jiraSessionVersion(actor), kind, state, JSON.stringify(payload), now, now);
  return { id, createdAt: now };
}
export function readJiraOperation<T>(id: string, projectId: string, actor: Actor, kind: string, requireCurrent = true) {
  assertJiraProject(projectId, actor);
  const row = getDatabaseContext().sqlite.prepare('SELECT * FROM jira_operations WHERE id=? AND project_id=? AND account_id=? AND kind=?').get(id, projectId, jiraAccount(actor), kind) as { credential_version: string; payload: string; state: string; created_at: string } | undefined;
  if (!row) notFound('本账号的操作记录不存在');
  if (requireCurrent && row.credential_version !== jiraSessionVersion(actor)) fail('个人连接已变化，请重新预览', 'STALE_WRITE', 409);
  return { id, payload: JSON.parse(row.payload) as T, state: row.state, createdAt: row.created_at };
}
export function updateJiraOperation(id: string, state: string, payload: unknown) {
  getDatabaseContext().sqlite.prepare('UPDATE jira_operations SET state=?,payload=?,updated_at=? WHERE id=?').run(state, JSON.stringify(payload), new Date().toISOString(), id);
}
export function localReferences(projectId: string) {
  const work = getDatabaseContext().sqlite.prepare('SELECT w.requirement_id,w.reference_links FROM work_items w JOIN requirements r ON r.id=w.requirement_id WHERE r.project_id=? ORDER BY w.id').all(projectId) as Array<{ requirement_id: string; reference_links: string }>;
  const keys = (links: ReturnType<typeof readReferenceLinks>) => [...new Set(links.map(l => jiraKeyFromUrl(l.url, jiraSite())).filter((key): key is string => !!key))];
  const requirements = getDatabaseContext().sqlite.prepare('SELECT id,title,reference_links,reference_url FROM requirements WHERE project_id=? AND deleted_at IS NULL ORDER BY id').all(projectId) as Array<{ id: string; title: string; reference_links: string; reference_url: string | null }>;
  return requirements.map(r => ({ id: r.id, title: r.title,
    direct: keys(readReferenceLinks(r.reference_links, r.reference_url)),
    work: keys(work.filter(w => w.requirement_id === r.id).flatMap(w => readReferenceLinks(w.reference_links))),
    titleKeys: jiraKeysFromTitle(r.title),
  }));
}
function otherProjectReferences(projectId: string) {
  return getDatabaseContext().sqlite.prepare('SELECT r.reference_links,r.reference_url FROM requirements r JOIN projects p ON p.id=r.project_id WHERE r.project_id<>? AND r.deleted_at IS NULL AND p.deleted_at IS NULL ORDER BY r.id').all(projectId) as Array<{ reference_links: string; reference_url: string | null }>;
}
type ScanSnapshot = { scan: JiraScan; configVersion: number; format: number };
function discoveryRows(projectId: string, issues: JiraIssue[]): JiraScanRow[] {
  const db = getDatabaseContext().sqlite, references = localReferences(projectId), site = jiraSite();
  const bindings = db.prepare('SELECT * FROM jira_bindings').all() as Binding[];
  const ignored = new Set((db.prepare('SELECT issue_key FROM jira_ignored WHERE project_id=? AND site=?').all(projectId, site) as Array<{ issue_key: string }>).map(r => r.issue_key));
  const excluded = db.prepare('SELECT requirement_id,issue_id FROM jira_reference_only WHERE site=?').all(site) as Array<{ requirement_id: string; issue_id: string }>;
  const externalKeys = otherProjectReferences(projectId).flatMap(r => readReferenceLinks(r.reference_links, r.reference_url).map(l => jiraKeyFromUrl(l.url, site)));
  return issues.map(issue => {
    const binding = bindings.find(b => b.site === site && b.issue_id === issue.id);
    const local = binding?.project_id === projectId && references.some(r => r.id === binding.requirement_id) ? requirementFacts(binding.requirement_id, projectId).requirement : null;
    const direct = references.filter(r => r.direct.includes(issue.key));
    const candidates: JiraCandidate[] = references.flatMap(r => {
      const reason = r.direct.includes(issue.key) ? excluded.some(e => e.requirement_id === r.id && e.issue_id === issue.id) ? '已解除关联，仅保留参考' : '需求中的 Jira 链接'
        : r.work.includes(issue.key) ? '工作项中的 Jira 链接'
        : r.titleKeys.includes(issue.key) ? '需求标题中的 Jira 编号'
        : normalizedJiraTitle(issue.title).length >= 3 && normalizedJiraTitle(issue.title) === normalizedJiraTitle(r.title) ? '需求标题相近' : null;
      return reason ? [{ id: r.id, title: r.title, reason }] : [];
    });
    const problem = binding && !local ? '此 Jira 事项已有主要关联，请核对原需求'
      : !binding && (direct.length > 1 || externalKeys.includes(issue.key)) ? '多个需求引用此事项，请人工确认主要关联'
      : !binding && direct.some(r => r.direct.length > 1 || bindings.some(b => b.requirement_id === r.id)) ? '候选需求包含多个 Jira 事项或已有主要关联，请人工确认'
      : null;
    return { key: issue.key, issue, requirementId: local?.id || null, requirementTitle: local?.title || null,
      featureName: local?.featureName || null, phaseName: local?.phaseName || null, localStatus: local?.status || null,
      association: local ? 'linked' : problem ? 'conflict' : candidates.length ? 'candidate' : 'none', candidates, ignored: !local && ignored.has(issue.key), problem };
  });
}
function discoveryJql(settings: JiraSettingsRecord['settings']) {
  if (settings.jql) return settings.jql;
  if (!settings.projects.length) fail('请先配置 Jira 项目范围或高级 JQL');
  const quote = (s: string) => JSON.stringify(s);
  const clauses = ([['project', settings.projects], ['issuetype', settings.issueTypes], ['labels', settings.labels], ['component', settings.components], ['assignee', settings.assignees]] as const)
    .filter(([, values]) => values.length).map(([field, values]) => `${field} IN (${values.map(quote).join(',')})`);
  return clauses.join(' AND ') + ' ORDER BY key ASC';
}
export async function scanJira(projectId: string, actor: Actor, startAt = 0, previousId?: string): Promise<JiraScan> {
  const config = requireJiraEnabled(projectId, actor), session = jiraSession(actor), issues = new Map<string, JiraIssue>();
  let total = 0;
  if (previousId && startAt) {
    const { payload } = readJiraOperation<ScanSnapshot>(previousId, projectId, actor, 'scan');
    if (payload.format !== 3 || payload.configVersion !== config.version || payload.scan.nextStartAt !== startAt) fail('发现范围或扫描进度已变化，请重新扫描', 'STALE_WRITE', 409);
    for (const row of payload.scan.rows) if (row.issue) issues.set(row.issue.id, row.issue);
    total = payload.scan.total;
  } else if (startAt) fail('后续分页必须引用本账号的扫描记录');
  const warnings: string[] = [];
  let nextStartAt: number | null = null;
  try {
    const page = await session.client.search(discoveryJql(config.settings), startAt);
    for (const issue of page.issues) issues.set(issue.id, issue);
    total = page.total; nextStartAt = page.nextStartAt;
  } catch (error) { warnings.push(error instanceof AppError ? error.message : '暂时无法读取发现结果，请稍后重试'); }
  session.assertCurrent(); requireJiraEnabled(projectId, actor);
  if (jiraSettings(projectId, actor).version !== config.version) fail('扫描期间发现范围已变化，请重新扫描', 'STALE_WRITE', 409);
  const scan: JiraScan = { id: '', checkedAt: new Date().toISOString(), rows: discoveryRows(projectId, [...issues.values()]), nextStartAt, total, complete: !warnings.length && nextStartAt === null, warnings };
  const payload: ScanSnapshot = { scan, configVersion: config.version, format: 3 };
  const stored = storeJiraOperation(projectId, actor, 'scan', payload, 'finished');
  scan.id = stored.id; updateJiraOperation(stored.id, 'finished', payload);
  return scan;
}
export function latestScan(projectId: string, actor: Actor): JiraScan | null {
  assertJiraProject(projectId, actor);
  const row = getDatabaseContext().sqlite.prepare("SELECT id FROM jira_operations WHERE account_id=? AND project_id=? AND kind='scan' AND credential_version=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(jiraAccount(actor), projectId, jiraSessionVersion(actor)) as { id: string } | undefined;
  if (!row) return null;
  const { payload } = readJiraOperation<ScanSnapshot>(row.id, projectId, actor, 'scan');
  if (payload.format !== 3 || payload.configVersion !== jiraSettings(projectId, actor).version) return null;
  return { ...payload.scan, rows: discoveryRows(projectId, payload.scan.rows.flatMap(row => row.issue ? [row.issue] : [])) };
}
export function insertBinding(projectId: string, actor: Actor, requirementId: string, issue: JiraIssue, source = '人工确认') {
  requirementFacts(requirementId, projectId);
  const conflict = getDatabaseContext().sqlite.prepare('SELECT requirement_id FROM jira_bindings WHERE requirement_id=? OR (site=? AND issue_id=?)').get(requirementId, jiraSite(), issue.id) as { requirement_id: string } | undefined;
  if (conflict) fail('需求或 Jira 事项已有主要绑定，请先核对并解除原绑定', 'DEPENDENCY_CONFLICT', 409);
  getDatabaseContext().sqlite.prepare('INSERT INTO jira_bindings(requirement_id,project_id,site,issue_id,issue_key,created_by,created_at) VALUES (?,?,?,?,?,?,?)').run(requirementId, projectId, jiraSite(), issue.id, issue.key, jiraAccount(actor), new Date().toISOString());
  getDatabaseContext().sqlite.prepare('DELETE FROM jira_ignored WHERE project_id=? AND site=? AND issue_key=?').run(projectId, jiraSite(), issue.key);
  getDatabaseContext().sqlite.prepare('DELETE FROM jira_reference_only WHERE requirement_id=? AND site=? AND issue_id=?').run(requirementId, jiraSite(), issue.id);
  recordAudit(actor, 'bind', 'jira_binding', requirementId, '绑定 Jira：' + issue.key + '（' + source + '）', projectId);
}
export async function bindJira(projectId: string, actor: Actor, requirementId: string, key: string) {
  requireJiraEnabled(projectId, actor); const session = jiraSession(actor), issue = await session.client.issue(key);
  session.assertCurrent();
  getDatabaseContext().sqlite.transaction(() => { assertJiraProject(projectId, actor); insertBinding(projectId, actor, requirementId, issue); })();
  return { ok: true };
}
export function unbindJira(projectId: string, actor: Actor, requirementId: string) {
  assertJiraProject(projectId, actor);
  getDatabaseContext().sqlite.transaction(() => {
    const db = getDatabaseContext().sqlite;
    const binding = projectBindings(projectId).find(b => b.requirement_id === requirementId);
    if (!binding) return;
    db.prepare('INSERT OR IGNORE INTO jira_reference_only(requirement_id,site,issue_id) VALUES (?,?,?)').run(requirementId, binding.site, binding.issue_id);
    db.prepare('DELETE FROM jira_bindings WHERE requirement_id=? AND project_id=?').run(requirementId, projectId);
    recordAudit(actor, 'unbind', 'jira_binding', requirementId, '解除 Jira 主要绑定：' + binding.issue_key + '；保留为参考，不再自动关联', projectId);
  })();
  return { ok: true };
}
export function ignoreJira(projectId: string, actor: Actor, key: string, ignored: boolean) {
  assertJiraProject(projectId, actor);
  if (ignored && getDatabaseContext().sqlite.prepare('SELECT 1 FROM jira_bindings WHERE project_id=? AND site=? AND issue_key=?').get(projectId, jiraSite(), key)) fail('已绑定事项不能忽略，请先解除主要绑定');
  if (ignored) getDatabaseContext().sqlite.prepare('INSERT OR IGNORE INTO jira_ignored(project_id,site,issue_key) VALUES (?,?,?)').run(projectId, jiraSite(), key);
  else getDatabaseContext().sqlite.prepare('DELETE FROM jira_ignored WHERE project_id=? AND site=? AND issue_key=?').run(projectId, jiraSite(), key);
  recordAudit(actor, ignored ? 'ignore' : 'restore', 'jira_issue', key, (ignored ? '忽略' : '恢复') + ' Jira 候选事项：' + key, projectId); return { ok: true };
}
export async function previewJiraImport(projectId: string, actor: Actor, key: string): Promise<JiraImportPreview> {
  requireJiraEnabled(projectId, actor); const session = jiraSession(actor), issue = await session.client.issue(key), warnings: string[] = [];
  let documents: JiraImportPreview['links'] = [];
  try { documents = await session.client.documentLinks(key); } catch { warnings.push('文档链接读取失败，可在录入表单中手动补充'); }
  session.assertCurrent(); assertJiraProject(projectId, actor);
  const links: JiraImportPreview['links'] = [{ title: issue.key, url: issue.url, kind: 'task' as const }, ...documents].filter((l, i, all) => all.findIndex(v => v.url === l.url) === i).slice(0, 20);
  const stored = storeJiraOperation(projectId, actor, 'import', { issue, links, warnings });
  return { id: stored.id, issue, links, warnings };
}
export async function confirmJiraImport(projectId: string, actor: Actor, previewId: string, raw: unknown) {
  requireJiraEnabled(projectId, actor);
  const operation = readJiraOperation<JiraImportPreview & { requirementId?: string }>(previewId, projectId, actor, 'import');
  if (operation.payload.requirementId) return getRequirement(operation.payload.requirementId);
  const input = createRequirementInputSchema.parse(raw);
  if (input.projectId !== projectId) fail('录入项目不匹配');
  const session = jiraSession(actor), issue = await session.client.issue(operation.payload.issue.id);
  session.assertCurrent();
  if (issue.updated !== operation.payload.issue.updated) fail('Jira 事项已变化，请重新预览录入', 'STALE_WRITE', 409);
  return getDatabaseContext().sqlite.transaction(() => {
    assertJiraProject(projectId, actor);
    const latest = readJiraOperation<JiraImportPreview & { requirementId?: string }>(previewId, projectId, actor, 'import');
    if (latest.payload.requirementId) return getRequirement(latest.payload.requirementId);
    const requirement = createRequirement(input, actor);
    insertBinding(projectId, actor, requirement.id, issue);
    updateJiraOperation(previewId, 'finished', { ...operation.payload, requirementId: requirement.id });
    return requirement;
  })();
}
