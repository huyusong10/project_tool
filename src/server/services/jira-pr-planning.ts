import type { z } from 'zod';
import type { PrTargetPlan, prTargetSchema } from '../../shared/jira-pr';
import type { Actor } from '../auth';
import { targetRoutes } from '../../shared/jira-workflow';
import { fail, notFound } from '../errors';
import { capturePrWork, draftRouteComments, summarizePrComment } from './jira-pr-comments';
import { prRemote } from './jira-pr-drafts';
import { assertEditable, newPrStep, readPr } from './jira-pr-store';

export async function previewPrTarget(projectId: string, actor: Actor, id: string, input: z.infer<typeof prTargetSchema>): Promise<PrTargetPlan> {
  const pr = readPr(projectId, actor, id); assertEditable(pr, input.version);
  const item = pr.items.find(i => i.requirementId === input.requirementId);
  if (!item) notFound('PR 中没有此需求');
  const remote = await prRemote(projectId, actor, item.requirementId);
  if (remote.site !== item.site || remote.bindingVersion !== item.bindingVersion || remote.issue.id !== item.issueId) fail('需求关联已变化，请移出后重新生成草稿', 'STALE_WRITE', 409);
  assertEditable(readPr(projectId, actor, id), input.version);
  // A posted comment is tied to its operation. Resolve that operation before replanning later steps.
  if (item.steps.some(s => s.comment.state === 'success' && s.kind === 'transition' && s.transition.state !== 'success')) fail('已有评论发布成功，请先完成或核对此次状态操作，再调整目标');
  const target = input.targetId === null || input.targetId === remote.issue.status.id ? null : remote.statuses.find(s => s.id === input.targetId);
  if (input.targetId && input.targetId !== remote.issue.status.id && !target) fail('目标状态已变化，请刷新 Jira 后重新选择');
  const routes = target ? targetRoutes(remote, target.id) : [];
  if (target && !routes.length) fail('当前无法确认到达此状态的路径，请选择当前可达状态，或在 Jira 中处理');
  const result: PrTargetPlan = { version: pr.version, requirementId: item.requirementId, remote, routes, steps: null, retainedComments: 0 };
  const route = input.routeIds ? routes.find(p => JSON.stringify(p.map(e => e.id)) === JSON.stringify(input.routeIds)) : routes.length === 1 ? routes[0] : undefined;
  if (input.routeIds && !route) fail('所选路径已变化，请重新选择', 'STALE_WRITE', 409);
  if (target && !route) return result;
  const locked = item.steps.filter(s => s.comment.state === 'success');
  const editable = item.steps.filter(s => s.comment.state !== 'success');
  const retained = input.regenerate ? [] : editable.filter(s => s.generatedBody === undefined || s.generatedBody !== s.body);
  const matched = new Set<string>();
  const work = item.work || capturePrWork(item.requirementId);
  const used = new Set([...locked, ...retained].flatMap(s => s.sourceIds));
  const assigned = new Set(editable.flatMap(s => s.sourceIds));
  const sources = item.sources.filter(s => assigned.has(s.id) && !used.has(s.id));
  const steps = route ? draftRouteComments(work, sources, item.sources, pr.collectedAt, item.basis, route) : [];
  for (const step of steps) {
    const same = retained.find(s => !matched.has(s.id) && s.kind === 'transition' && s.transitionId === step.transitionId && s.target?.id === step.target?.id);
    if (same) { matched.add(same.id); Object.assign(step, same); }
  }
  // Keep edited/legacy text as independent comments when its old edge disappears. Never discard it.
  const extra = retained.filter(s => !matched.has(s.id)).map(s => {
    if (s.kind === 'comment') return s;
    result.retainedComments++;
    return { ...s, kind: 'comment' as const, target: null, transitionId: null, transitionName: null };
  });
  const allocated = new Set([...locked, ...extra, ...steps].flatMap(s => s.sourceIds));
  const remaining = sources.filter(s => !allocated.has(s.id));
  if (remaining.length) extra.push(newPrStep(summarizePrComment(work, remaining, item.sources, pr.collectedAt), remaining.map(s => s.id)));
  if (!steps.length && !extra.length && !locked.length) extra.push(newPrStep(item.basis, []));
  result.steps = [...locked, ...extra, ...steps];
  if (result.steps.length > 30) fail('评论与状态操作超过 30 条，请先精简草稿');
  return result;
}
