import type { Actor } from '../auth';
import { fail } from '../errors';
import { jiraAccount } from './jira-connection';
import { assertEditable, persistPr, prBindingVersion, prCandidates, prDb, prHash, prNow, readPr } from './jira-pr-store';
import { recordAudit } from './audit';

export function previewManualSync(projectId: string, actor: Actor, ids: string[], restore = false) {
  const wanted = new Set(ids), candidates = prCandidates(projectId, actor);
  const sources = candidates.flatMap(r => r.sources.filter(s => wanted.has(s.id)).map(s => ({ ...s, title: r.title, key: r.key, bindingVersion: prBindingVersion(projectId, r.requirementId) })));
  if (!sources.length || sources.length !== wanted.size) fail('所选进展不存在，请重新读取');
  for (const s of sources) {
    if (restore ? s.jiraSyncState !== 'synced' || !s.jiraManualAccountId : !['pending', 'in_pr', 'ignored'].includes(s.jiraSyncState)) fail('部分记录状态已变化；只能撤销人工确认，不能撤销实际发布结果', 'STALE_WRITE', 409);
    if (!restore && !s.key) fail(`${s.title}：请先关联 Jira，再确认已同步`);
  }
  const drafts = [...new Set(sources.filter(s => s.jiraSyncState === 'in_pr').map(s => s.jiraPrId!))].map(id => readPr(projectId, actor, id));
  for (const pr of drafts) {
    assertEditable(pr, pr.version);
    for (const item of pr.items) for (const step of item.steps) if (step.sourceIds.some(id => wanted.has(id)) && step.comment.state === 'success') fail('已发布的评论不能人工覆盖');
  }
  return { version: prHash([restore, sources, drafts.map(p => [p.id, p.version])]), sources, affectedPrIds: drafts.map(p => p.id) };
}

export function confirmManualSync(projectId: string, actor: Actor, input: { ids: string[]; version: string; reason: string; url?: string; restore?: boolean }) {
  return prDb().transaction(() => {
    const preview = previewManualSync(projectId, actor, input.ids, input.restore);
    if (preview.version !== input.version) fail('进展或草稿已变化，请重新确认', 'STALE_WRITE', 409);
    const now = prNow(), account = jiraAccount(actor), wanted = new Set(input.ids);
    for (const prId of preview.affectedPrIds) {
      const pr = readPr(projectId, actor, prId);
      for (const item of pr.items) {
        for (const step of item.steps) {
          if (step.sourceIds.some(id => wanted.has(id))) { item.reviewRequired = true; step.sourceIds = step.sourceIds.filter(id => !wanted.has(id)); }
        }
        item.sources = item.sources.filter(s => !wanted.has(s.id));
      }
      persistPr(pr);
    }
    for (const source of preview.sources) {
      if (input.restore) prDb().prepare("UPDATE jira_progress_sync SET state='pending',pr_id=NULL,comment_id=NULL,synced_at=NULL,manual_account_id=NULL,manual_reason=NULL,manual_url=NULL,updated_at=? WHERE project_id=? AND progress_id=?").run(now, projectId, source.id);
      else prDb().prepare(`INSERT INTO jira_progress_sync(project_id,progress_id,state,synced_at,updated_at,manual_account_id,manual_reason,manual_url) VALUES (?,?,'synced',?,?,?,?,?)
        ON CONFLICT(project_id,progress_id) DO UPDATE SET state='synced',pr_id=NULL,comment_id=NULL,synced_at=excluded.synced_at,updated_at=excluded.updated_at,manual_account_id=excluded.manual_account_id,manual_reason=excluded.manual_reason,manual_url=excluded.manual_url`).run(projectId, source.id, now, now, account, input.reason.trim(), input.url || null);
    }
    recordAudit(actor, input.restore ? 'jira_manual_sync_undo' : 'jira_manual_sync', 'project', projectId, JSON.stringify({ ids: input.ids, reason: input.reason, url: input.url, sources: preview.sources.map(s => ({ id: s.id, key: s.key })), affectedPrIds: preview.affectedPrIds }), projectId);
    return { ok: true, affectedPrIds: preview.affectedPrIds };
  })();
}
