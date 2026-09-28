import type { Actor } from '../auth';
import type { JiraIssue } from '../../shared/jira';
import type { JiraPr, PrItem, PrPreview, PrReceipt, PrStep } from '../../shared/jira-pr';
import type { z } from 'zod';
import type { prRecheckSchema } from '../../shared/jira-pr';
import { AppError, fail, notFound } from '../errors';
import { JiraRemoteError, type JiraTransition } from '../jira/client';
import { jiraAccount, jiraSession } from './jira-connection';
import { readJiraOperation, requireJiraEnabled, storeJiraOperation, updateJiraOperation } from './jira-scan';
import { assertEditable, itemUnknown, livePrExecutions, markPrSourcesPublished, persistPr, prBindingVersion, prDb, prNow, readPr, stepDone } from './jira-pr-store';
import { assertPrSourcesCurrent, prRemote } from './jira-pr-drafts';
import { assertJiraWriteUnlocked } from './jira-write-lock';
import { recordAudit } from './audit';
import { recordJiraRead } from './jira-progress';
import { stepChoices } from '../../shared/jira-workflow';

export const prMarker = (id: string, stepId: string) => `[PM-PR:${id}:${stepId}]`;
export const publishedPrBody = (id: string, step: PrStep) => `${step.body.trim()}\n\n${prMarker(id, step.id)}`;
const safeError = (e: unknown) => e instanceof AppError ? e.message : '操作未完成，请先读取本次结果';
function chooseTransition(step: PrStep, transitions: JiraTransition[]) {
  const candidates = transitions.filter(t => t.to.id === step.target?.id && (!step.transitionId || t.id === step.transitionId));
  if (candidates.length !== 1) fail(candidates.length ? '存在多个同目标操作，请重新选择具体操作' : '当前无法直达目标状态，请调整操作后重新确认');
  if (candidates[0].requiredFields.length) fail('请先在 Jira 补充：' + candidates[0].requiredFields.join('、'));
  return candidates[0];
}
function checkBinding(pr: JiraPr, item: PrItem, actor: Actor, session: ReturnType<typeof jiraSession>) {
  requireJiraEnabled(pr.projectId, actor); session.assertCurrent();
  if (item.site !== session.site || prBindingVersion(pr.projectId, item.requirementId) !== item.bindingVersion) fail('需求关联或 Jira 站点已变化，请移除该项并重新生成草稿', 'STALE_WRITE', 409);
}
function checkRemote(actual: JiraIssue, expected: JiraIssue) {
  if (actual.id !== expected.id || actual.status.id !== expected.status.id || actual.updated !== expected.updated) fail('Jira 状态或内容已变化，请重新预览确认', 'STALE_WRITE', 409);
}
function itemOutcome(item: PrItem): PrPreview['items'][number]['outcome'] {
  if (itemUnknown(item)) return 'unknown';
  if (item.steps.every(stepDone)) return 'success';
  if (item.steps.some(s => s.comment.state === 'running' || s.transition.state === 'running')) return 'running';
  return 'failed';
}
function finishIfComplete(pr: JiraPr) {
  if (pr.items.length && pr.items.every(i => i.steps.length && i.steps.every(stepDone))) pr.state = 'completed';
}
export async function preparePr(projectId: string, actor: Actor, id: string, version: number): Promise<PrPreview> {
  const pr = readPr(projectId, actor, id); assertEditable(pr, version); requireJiraEnabled(projectId, actor);
  const session = jiraSession(actor), identity = await session.client.myself(); session.assertCurrent();
  assertPrSourcesCurrent(projectId, actor, pr.items);
  const preview: PrPreview = { id: '', prId: id, version, identity, createdAt: prNow(), items: [] };
  for (const item of pr.items) {
    if (item.steps.every(stepDone)) continue;
    checkBinding(pr, item, actor, session); assertJiraWriteUnlocked(item.issueId, item.site, '', id);
    if (item.decisionRequired) fail(`${item.key}：请选择状态操作，或明确保持 Jira 状态不变`);
    if (item.reviewRequired) fail(`${item.key}：来源已人工标记同步，请检查评论正文并确认`);
    const remote = await prRemote(projectId, actor, item.requirementId), steps = structuredClone(item.steps);
    for (const step of steps.filter(s => !stepDone(s))) {
      if (!step.body.trim() || step.body.trim().length > 30000) fail(`${item.key}：评论不能为空，且不能超过 30000 字符，请编辑或拆分评论`);
      if (step.kind === 'transition') {
        const target = remote.statuses.find(s => s.id === step.target?.id);
        if (!target) fail(`${item.key}：请选择 Jira 返回的目标状态`);
        step.target = target;
      }
    }
    for (const [index, step] of steps.entries()) {
      if (stepDone(step) || step.kind !== 'transition') continue;
      const choices = stepChoices(remote, steps, index);
      if (choices.future && !remote.workflow) fail(`${item.key}：无法读取后续工作流，请先只提交当前可执行的步骤`);
      const transition = chooseTransition(step, choices.options);
      step.transitionId = transition.id; step.transitionName = transition.name;
    }
    preview.items.push({ requirementId: item.requirementId, issueId: item.issueId, site: item.site, issue: remote.issue, steps, outcome: 'ready' });
  }
  if (!preview.items.length) fail('没有需要推送的操作');
  session.assertCurrent(); requireJiraEnabled(projectId, actor);
  if (readPr(projectId, actor, id).version !== version) fail('预览期间 PR 已变化，请重新确认', 'STALE_WRITE', 409);
  preview.id = storeJiraOperation(projectId, actor, 'pr', preview).id; updateJiraOperation(preview.id, 'preview', preview);
  return preview;
}
export function readPrPreview(projectId: string, actor: Actor, id: string) {
  let op = readJiraOperation<PrPreview>(id, projectId, actor, 'pr', false);
  if (op.state === 'running') { readPr(projectId, actor, op.payload.prId); op = readJiraOperation<PrPreview>(id, projectId, actor, 'pr', false); }
  return { ...op.payload, state: op.state };
}
export async function executePr(projectId: string, actor: Actor, id: string, previewId: string) {
  const op = readJiraOperation<PrPreview>(previewId, projectId, actor, 'pr', false), preview = op.payload;
  if (preview.prId !== id) notFound('此预览不属于当前 PR');
  if (op.state !== 'preview') return readPr(projectId, actor, id);
  readJiraOperation(previewId, projectId, actor, 'pr');
  const pr = readPr(projectId, actor, id); assertEditable(pr, preview.version);
  if (Date.now() - Date.parse(preview.createdAt) > 15 * 60_000) fail('推送预览已过期，请重新确认', 'STALE_WRITE', 409);
  const session = jiraSession(actor); assertPrSourcesCurrent(projectId, actor, pr.items);
  prDb().transaction(() => {
    for (const item of pr.items.filter(i => !i.steps.every(stepDone))) { checkBinding(pr, item, actor, session); assertJiraWriteUnlocked(item.issueId, item.site, previewId, id); }
    const claim = prDb().prepare("UPDATE jira_operations SET state='running' WHERE id=? AND state='preview'").run(previewId);
    if (!claim.changes) fail('本次推送已经提交，请读取结果', 'STALE_WRITE', 409);
    for (const planned of preview.items) pr.items.find(i => i.requirementId === planned.requirementId)!.steps = planned.steps;
    pr.state = 'running'; pr.startedAt ||= prNow(); persistPr(pr);
    prDb().prepare('UPDATE jira_prs SET stop_requested=0 WHERE id=?').run(id);
  })();
  livePrExecutions.add(id);
  const stopped = () => !!(prDb().prepare('SELECT stop_requested AS stopped FROM jira_prs WHERE id=?').get(id) as { stopped: number }).stopped;
  const persist = () => prDb().transaction(() => {
    for (const item of pr.items) for (const step of item.steps) if (step.comment.state === 'success') markPrSourcesPublished(pr, step);
    persistPr(pr);
    for (const item of preview.items) item.outcome = itemOutcome(pr.items.find(i => i.requirementId === item.requirementId)!);
    updateJiraOperation(previewId, 'running', preview);
  })();
  function beforeWrite(item: PrItem) {
    checkBinding(pr, item, actor, session);
    if (stopped()) fail('已停止后续推送；已发布内容保留');
    assertPrSourcesCurrent(projectId, actor, [item]);
  }
  async function write(item: PrItem, step: PrStep, part: 'comment' | 'transition', from: JiraIssue['status'], call: () => Promise<string | void>) {
    beforeWrite(item);
    const receipt: PrReceipt = { state: 'running', accountId: jiraAccount(actor), identity: preview.identity || undefined, at: prNow(), from, ...(part === 'transition' ? { target: step.target || undefined, operation: step.transitionName || undefined } : {}) };
    step[part] = receipt; persist();
    try {
      const commentId = await call();
      Object.assign(receipt, { state: part === 'comment' ? 'success' : 'unknown', commentId: commentId || undefined, message: part === 'comment' ? '进展已同步' : '正在核对流转结果' });
    } catch (e) {
      receipt.state = e instanceof JiraRemoteError && e.uncertain ? 'unknown' : 'failed'; receipt.message = safeError(e); throw e;
    } finally {
      persist(); recordAudit(actor, 'jira_pr_write', 'jira_pr', id, JSON.stringify({ previewId, key: item.key, stepId: step.id, part, identity: preview.identity, from, target: step.target, receipt }), projectId);
    }
  }
  try {
    for (const planned of preview.items) {
      if (stopped()) break;
      const item = pr.items.find(i => i.requirementId === planned.requirementId)!;
      let baseline = planned.issue;
      for (const step of item.steps) {
        if (stepDone(step)) continue;
        if (stopped()) break;
        try {
          beforeWrite(item);
          checkRemote(await session.client.issue(item.issueId), baseline);
          const transition = step.kind === 'transition' ? chooseTransition(step, await session.client.transitions(item.issueId)) : null;
          if (transition) { step.transitionId = transition.id; step.transitionName = transition.name; }
          if (step.comment.state !== 'success') {
            // A restored database can predate a successful remote write. The stable marker survives it.
            const existing = await findPublishedComment(session, item, step, id, projectId, actor);
            if (existing) persist();
            else {
              checkRemote(await session.client.issue(item.issueId), baseline);
              await write(item, step, 'comment', baseline.status, async () => (await session.client.addComment(item.issueId, publishedPrBody(id, step))).id);
            }
            const after = await session.client.issue(item.issueId);
            if (after.status.id !== baseline.status.id || after.title !== baseline.title || after.typeId !== baseline.typeId) fail('发布评论后 Jira 内容发生变化，请重新确认状态操作');
            baseline = after;
          }
          if (step.kind === 'transition') {
            beforeWrite(item);
            const current = chooseTransition(step, await session.client.transitions(item.issueId));
            checkRemote(await session.client.issue(item.issueId), baseline);
            await write(item, step, 'transition', baseline.status, () => session.client.transition(item.issueId, current.id));
            const after = await session.client.issue(item.issueId);
            if (after.status.id !== step.target?.id) fail('当前 Jira 状态与目标不同，请核对本次结果');
            step.transition.state = 'success'; step.transition.message = '状态已修改'; baseline = after; persist();
          }
          checkBinding(pr, item, actor, session); recordJiraRead(projectId, actor, item.requirementId, baseline);
        } catch (e) {
          const receipt = step.comment.state === 'success' && step.kind === 'transition' ? step.transition : step.comment;
          if (receipt.state !== 'success' && receipt.state !== 'unknown') receipt.state = 'failed';
          if (receipt.state !== 'success') receipt.message = safeError(e);
          // An uncertain write may be read back, but is never sent twice.
          if (step.comment.state === 'unknown') {
            try { await findPublishedComment(session, item, step, id, projectId, actor); } catch { /* Preserve uncertainty on read failure. */ }
          } else if (step.transition.state === 'unknown') {
            try { const after = await session.client.issue(item.issueId); step.transition.message = `当前状态：${after.status.name}；请人工核对本次流转结果`; } catch { /* Keep the last known receipt. */ }
          }
          persist(); break;
        }
      }
    }
  } finally {
    pr.state = 'active'; finishIfComplete(pr); persist(); updateJiraOperation(previewId, 'finished', preview); livePrExecutions.delete(id);
    recordAudit(actor, 'jira_pr_result', 'jira_pr', id, JSON.stringify({ previewId, identity: preview.identity, state: pr.state, outcomes: preview.items.map(i => ({ key: i.issue.key, outcome: i.outcome })) }), projectId);
  }
  return pr;
}
async function findPublishedComment(session: ReturnType<typeof jiraSession>, item: PrItem, step: PrStep, prId: string, projectId: string, actor: Actor) {
  let startAt: number | null = 0;
  while (startAt !== null) {
    session.assertCurrent(); requireJiraEnabled(projectId, actor);
    const page = await session.client.comments(item.issueId, startAt);
    const found = page.comments.find(c => c.body.split(/\r?\n/).includes(prMarker(prId, step.id)));
    if (found) { step.comment = { ...step.comment, state: 'success', commentId: found.id, at: found.created, message: '已在 Jira 找到本次评论，未重复发布' }; return true; }
    startAt = page.nextStartAt;
  }
  return false;
}
export function stopPr(projectId: string, actor: Actor, id: string) {
  readPr(projectId, actor, id);
  prDb().prepare('UPDATE jira_prs SET stop_requested=1 WHERE id=?').run(id);
  return { ok: true };
}
export async function recheckPr(projectId: string, actor: Actor, id: string, input: z.infer<typeof prRecheckSchema>) {
  const pr = readPr(projectId, actor, id); requireJiraEnabled(projectId, actor);
  if (pr.state !== 'active') fail('请等待正在执行的请求结束');
  const item = pr.items.find(i => i.requirementId === input.requirementId), step = item?.steps.find(s => s.id === input.stepId);
  if (!item || !step) notFound('操作不存在');
  if (step[input.part].state !== 'unknown') return pr;
  const session = jiraSession(actor);
  if (item.site !== session.site) fail('请使用原 Jira 站点的个人连接核对');
  if (input.part === 'comment') {
    const found = await findPublishedComment(session, item, step, id, projectId, actor);
    if (!found) {
      step.comment.message = '未找到本次来源标识，不能据此认定发布失败；请打开 Jira 人工核对';
      if (input.resolution === 'applied') fail('请先在 Jira 找到包含本次来源标识的评论');
      if (input.resolution === 'not_applied') step.comment = { ...step.comment, state: 'failed', message: '操作者已核对并确认评论未发布；再次推送须重新预览' };
    }
  } else {
    const latest = await session.client.issue(item.issueId);
    step.transition.message = `当前状态：${latest.status.name}；未重发原操作`;
    if (input.resolution === 'applied') {
      if (latest.status.id !== step.target?.id) fail('当前状态与目标不同，不能确认本次流转成功');
      step.transition.state = 'success'; step.transition.message = '操作者已核对并确认流转成功';
    } else if (input.resolution === 'not_applied') step.transition = { ...step.transition, state: 'failed', message: '操作者已核对并结束原操作；再次推送须重新预览' };
  }
  session.assertCurrent(); requireJiraEnabled(projectId, actor);
  prDb().transaction(() => { if (step.comment.state === 'success') markPrSourcesPublished(pr, step); finishIfComplete(pr); persistPr(pr); recordAudit(actor, 'jira_pr_recheck', 'jira_pr', id, JSON.stringify({ ...input, identity: session.identity, receipt: step[input.part] }), projectId); })();
  return pr;
}
