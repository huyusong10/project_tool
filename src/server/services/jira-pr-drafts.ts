import { randomUUID } from 'node:crypto';
import type { Actor } from '../auth';
import type { JiraPr, PrEdit, PrGeneration, PrItem, PrRemote, PrScope, PrSource } from '../../shared/jira-pr';
import type { JiraStatus } from '../../shared/jira';
import { workStageLabels, type WorkStage } from '../../shared/execution-stage';
import { AppError, fail, notFound } from '../errors';
import { targetRoutes } from '../../shared/jira-workflow';
import { capturePrWork, draftRouteComments, summarizePrComment } from './jira-pr-comments';
import { jiraSession, jiraSite } from './jira-connection';
import { assertJiraProject, readJiraOperation, requireJiraEnabled, storeJiraOperation, updateJiraOperation } from './jira-scan';
import { getRequirement } from './requirements';
import { recordJiraRead } from './jira-progress';
import { recordAudit } from './audit';
import { assertEditable, claimSources, newPrStep, persistPr, prBinding, prBindingVersion, prCandidates, prDb, prHash, prNow, readPr, stepDone } from './jira-pr-store';

export const sourceVersion = (s: PrSource) => prHash([s.id, s.requirementId, s.workItemId, s.percent, s.workItemPercent, s.content, s.eventType, s.supersedesId, s.createdAt, s.updatedAt]);
export function assertPrSourcesCurrent(projectId: string, actor: Actor, items: PrItem[]) {
  const current = new Map(prCandidates(projectId, actor).flatMap(r => r.sources).map(s => [s.id, s]));
  for (const item of items) for (const source of item.sources.filter(s => item.steps.some(step => step.comment.state !== 'success' && step.sourceIds.includes(s.id)))) {
    const latest = current.get(source.id);
    if (!latest || sourceVersion(latest) !== sourceVersion(source)) fail('来源进展已变化，请移除旧来源并更新草稿后重新确认', 'STALE_WRITE', 409);
  }
}
export async function prRemote(projectId: string, actor: Actor, requirementId: string): Promise<PrRemote> {
  requireJiraEnabled(projectId, actor);
  const b = prBinding(projectId, requirementId); if (!b) fail('请先在 Jira 进展管理中关联此需求');
  const session = jiraSession(actor), version = prBindingVersion(projectId, requirementId);
  if (b.site !== session.site) fail('关联属于其他 Jira 站点，请重新确认关联');
  const issue = await session.client.issue(b.issue_id), transitions = await session.client.transitions(b.issue_id);
  if (issue.id !== b.issue_id) fail('Jira 读取结果与主要关联不符，请重新确认关联');
  const types = await session.client.issueTypes(issue.key.replace(/-\d+$/, ''));
  const workflow = await session.client.workflow(issue.key.replace(/-\d+$/, ''), issue.typeId);
  session.assertCurrent(); requireJiraEnabled(projectId, actor);
  if (prBindingVersion(projectId, requirementId) !== version) fail('需求关联已变化，请重新读取', 'STALE_WRITE', 409);
  recordJiraRead(projectId, actor, requirementId, issue);
  const statuses = [...new Map([...(types.find(t => t.id === issue.typeId)?.statuses || []), issue.status, ...transitions.map(t => t.to)].map(s => [s.id, s])).values()];
  return { issue, site: session.site, bindingVersion: version, transitions, statuses, workflow, checkedAt: prNow() };
}
function suggest(requirementId: string, remote: PrRemote) {
  const r = getRequirement(requirementId, true, false), stage = r.executionStage;
  const aliases: Record<string, string[]> = { completed: ['已完成', '完成'], cancelled: ['已取消', '取消'], not_started: ['未开始', '待排期'], analysis: ['分析设计', '设计'] };
  const active = (r.workItems || []).filter(w => w.status === 'in_progress');
  const singleStage = active.length > 0 && active.every(w => w.workStage === stage.key);
  const eligible = ['completed', 'cancelled', 'not_started'].includes(stage.key) || singleStage;
  const names = eligible ? aliases[stage.key] || (stage.key in workStageLabels ? [workStageLabels[stage.key as WorkStage]] : []) : [];
  const matches = remote.statuses.filter(s => names.includes(s.name.trim()));
  const target = matches.length === 1 ? matches[0] : null;
  const choices = target ? remote.transitions.filter(t => t.to.id === target.id) : [];
  return { basis: `本地：${stage.label}`, target, transition: choices.length === 1 ? choices[0] : null, decisionRequired: !target };
}
export async function previewPrGeneration(projectId: string, actor: Actor, scope: PrScope, prId?: string, version?: number): Promise<PrGeneration> {
  requireJiraEnabled(projectId, actor);
  const session = jiraSession(actor), current = prId ? readPr(projectId, actor, prId) : null;
  if (current) { assertEditable(current, version || 0); if (current.startedAt) fail('已经开始推送的 PR 不能再加入新进展'); }
  const candidates = prCandidates(projectId, actor).filter(r => scope.featureIds.includes(r.featureId) && !scope.excludedRequirementIds.includes(r.requirementId));
  const collectedAt = prNow(), items: PrItem[] = [], warnings: string[] = [];
  // Jira reads are bounded; generation never performs a remote write.
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
    while (cursor < candidates.length) {
      const r = candidates[cursor++], sources = r.sources.filter(s => s.jiraSyncState === 'pending' && s.createdAt <= collectedAt);
      const b = prBinding(projectId, r.requirementId), existing = current?.items.find(i => i.requirementId === r.requirementId);
      if (!b || b.site !== session.site) { if (sources.length) warnings.push(`${r.title}：${sources.length} 条进展未关联当前 Jira 站点，仍保持待同步`); continue; }
      const manual = scope.manualRequirementIds?.includes(r.requirementId);
      if (existing && !sources.length && !manual) continue;
      const bindingVersion = prBindingVersion(projectId, r.requirementId);
      let result: ReturnType<typeof suggest> = { basis: 'Jira 尚未读取', target: null, transition: null, decisionRequired: true };
      let remote: PrRemote | null = null;
      try { remote = await prRemote(projectId, actor, r.requirementId); result = suggest(r.requirementId, remote); }
      catch (e) { warnings.push(`${r.title}：${e instanceof AppError ? e.message : 'Jira 暂时无法读取'}`); }
      if (prBindingVersion(projectId, r.requirementId) !== bindingVersion) fail('生成期间需求关联已变化，请重新生成', 'STALE_WRITE', 409);
      const needTransition = !!result.target && result.target.id !== remote?.issue.status.id;
      if (!sources.length && !manual && (existing || !needTransition)) continue;
      const work = capturePrWork(r.requirementId);
      const step = newPrStep(summarizePrComment(work, sources, r.sources, collectedAt, !existing && needTransition ? result.target : null, result.basis), sources.map(s => s.id));
      if (!existing && needTransition) Object.assign(step, { kind: 'transition', target: result.target, transitionId: result.transition?.id || null, transitionName: result.transition?.name || null });
      const steps = [step];
      if (!existing && needTransition && remote && result.target) {
        const routes = targetRoutes(remote, result.target.id);
        if (routes.length === 1) steps.splice(0, 1, ...draftRouteComments(work, sources, r.sources, collectedAt, result.basis, routes[0]));
        else { result.decisionRequired = true; warnings.push(`${r.title}：请确认到达 ${result.target.name} 的路径`); }
      }
      items.push({ requirementId: r.requirementId, title: r.title, featureName: r.featureName, phaseName: r.phaseName, key: remote?.issue.key || b.issue_key, issueId: b.issue_id, site: b.site, bindingVersion, basis: result.basis, localStatus: r.localStatus, localProgress: r.localProgress, decisionRequired: !existing && result.decisionRequired, work, sources, steps });
    }
  }));
  session.assertCurrent(); requireJiraEnabled(projectId, actor);
  const generation: PrGeneration = { id: '', prId: prId || null, version: version || 0, scope, collectedAt, items: items.sort((a, b) => candidates.findIndex(r => r.requirementId === a.requirementId) - candidates.findIndex(r => r.requirementId === b.requirementId)), warnings };
  generation.id = storeJiraOperation(projectId, actor, 'pr_generation', generation).id;
  updateJiraOperation(generation.id, 'preview', generation);
  return generation;
}
export function applyPrGeneration(projectId: string, actor: Actor, generationId: string) {
  requireJiraEnabled(projectId, actor); jiraSession(actor);
  const operation = readJiraOperation<PrGeneration & { appliedId?: string }>(generationId, projectId, actor, 'pr_generation'), g = operation.payload;
  if (g.appliedId) return readPr(projectId, actor, g.appliedId);
  if (Date.now() - Date.parse(g.collectedAt) > 15 * 60_000) fail('生成预览已过期，请重新生成', 'STALE_WRITE', 409);
  assertPrSourcesCurrent(projectId, actor, g.items);
  for (const item of g.items) if (item.site !== jiraSite() || prBindingVersion(projectId, item.requirementId) !== item.bindingVersion) fail('需求关联已变化，请重新生成', 'STALE_WRITE', 409);
  return prDb().transaction(() => {
    let pr: JiraPr;
    if (g.prId) {
      pr = readPr(projectId, actor, g.prId); assertEditable(pr, g.version); if (pr.startedAt) fail('已经开始推送的 PR 不能再加入新进展');
      for (const item of g.items) {
        const old = pr.items.find(i => i.requirementId === item.requirementId);
        if (old) { old.sources = [...new Map([...old.sources, ...item.sources].map(s => [s.id, s])).values()]; old.work = [...new Map([...(old.work || []), ...(item.work || [])].map(w => [w.id, w])).values()]; old.steps.push(...item.steps); }
        else pr.items.push(item);
      }
      pr.scope = g.scope; pr.collectedAt = g.collectedAt; pr.warnings = g.warnings;
    } else {
      if (prDb().prepare("SELECT 1 FROM jira_prs WHERE project_id=? AND state IN ('active','running')").get(projectId)) fail('项目已有进行中的 PR，请继续现有 PR', 'DEPENDENCY_CONFLICT', 409);
      if (!g.items.length && g.warnings.length) fail('没有可纳入的事项，请先处理关联或读取问题');
      pr = { id: randomUUID(), projectId, version: 1, state: 'active', startedAt: null, createdAt: prNow(), updatedAt: prNow(), scope: g.scope, collectedAt: g.collectedAt, items: g.items, warnings: g.warnings };
      prDb().prepare('INSERT INTO jira_prs(id,project_id,payload,created_at,updated_at) VALUES (?,?,?,?,?)').run(pr.id, projectId, JSON.stringify({ scope: pr.scope, collectedAt: pr.collectedAt, items: pr.items, warnings: pr.warnings }), pr.createdAt, pr.updatedAt);
    }
    claimSources(pr); persistPr(pr); g.appliedId = pr.id; updateJiraOperation(generationId, 'applied', g);
    recordAudit(actor, 'jira_pr_generate', 'jira_pr', pr.id, `生成 ${g.items.length} 项草稿，未写入 Jira`, projectId);
    return pr;
  })();
}
export function savePr(projectId: string, actor: Actor, id: string, input: PrEdit) {
  const pr = readPr(projectId, actor, id); assertEditable(pr, input.version);
  const seenItems = new Set<string>(), seenSteps = new Set<string>();
  const next: PrItem[] = [];
  for (const edit of input.items) {
    const old = pr.items.find(i => i.requirementId === edit.requirementId);
    if (!old || seenItems.has(edit.requirementId)) fail('PR 需求列表不正确'); seenItems.add(edit.requirementId);
    const assigned = new Set<string>();
    const steps = edit.steps.map((inputStep, index) => {
      const step = { ...inputStep, generatedBody: inputStep.generatedBody ?? old.steps.find(s => s.id === inputStep.id)?.generatedBody };
      if (seenSteps.has(step.id)) fail('操作编号重复'); seenSteps.add(step.id);
      const before = old.steps.find(s => s.id === step.id);
      if (before?.comment.state === 'success' && (before.body !== step.body || prHash(before.sourceIds) !== prHash(step.sourceIds) || old.steps[index]?.id !== step.id)) fail('已经发布的评论及来源不能修改或移动');
      if (before && stepDone(before) && prHash({ ...before, comment: null, transition: null }) !== prHash({ ...step, comment: null, transition: null })) fail('已完成操作不能修改');
      for (const sourceId of step.sourceIds) {
        if (!old.sources.some(s => s.id === sourceId) || assigned.has(sourceId)) fail('进展来源不存在或在多条评论中重复分配'); assigned.add(sourceId);
      }
      return { ...step, comment: before?.comment || { state: 'pending' as const }, transition: before?.transition || { state: 'pending' as const } };
    });
    for (const s of old.steps) if (s.comment.state === 'success' && !steps.some(n => n.id === s.id)) fail('已经发布的评论不能删除');
    if (steps.length) next.push({ ...old, decisionRequired: edit.decisionRequired, reviewRequired: edit.reviewRequired ?? old.reviewRequired, steps });
  }
  for (const old of pr.items) if (!seenItems.has(old.requirementId) && old.steps.some(s => s.comment.state === 'success')) fail('已有发布结果的需求不能移出 PR');
  prDb().transaction(() => { pr.items = next; claimSources(pr); persistPr(pr); recordAudit(actor, 'jira_pr_edit', 'jira_pr', id, '修改 PR 草稿', projectId); })();
  return pr;
}
export function regeneratePrComment(projectId: string, actor: Actor, id: string, requirementId: string, sourceIds: string[], target?: JiraStatus | null) {
  const pr = readPr(projectId, actor, id), item = pr.items.find(i => i.requirementId === requirementId);
  if (!item) notFound('PR 中没有此需求');
  const row = prCandidates(projectId, actor).find(r => r.requirementId === requirementId)!;
  const selected = item.sources.filter(s => sourceIds.includes(s.id));
  if (selected.length !== new Set(sourceIds).size) fail('来源记录不正确');
  return { body: summarizePrComment(item.work || capturePrWork(requirementId), selected, row.sources, pr.collectedAt, target, item.basis) };
}
export async function prComments(projectId: string, actor: Actor, requirementId: string, startAt: number) {
  assertJiraProject(projectId, actor); requireJiraEnabled(projectId, actor);
  const session = jiraSession(actor), b = prBinding(projectId, requirementId);
  if (!b || b.site !== session.site) fail('请先确认需求关联');
  const result = await session.client.comments(b.issue_id, startAt); session.assertCurrent(); requireJiraEnabled(projectId, actor); return result;
}
export async function addPrRequirement(projectId: string, actor: Actor, id: string, version: number, requirementId: string) {
  const pr = readPr(projectId, actor, id); assertEditable(pr, version);
  if (pr.items.some(i => i.requirementId === requirementId)) fail('此需求已在草稿中，请直接添加评论或操作');
  const candidates = prCandidates(projectId, actor), row = candidates.find(r => r.requirementId === requirementId);
  if (!row) notFound('需求不存在');
  const generation = await previewPrGeneration(projectId, actor, { featureIds: [row.featureId], excludedRequirementIds: candidates.filter(r => r.requirementId !== requirementId).map(r => r.requirementId), manualRequirementIds: [requirementId] }, id, version);
  if (!generation.items.length) fail('此需求暂时无法加入草稿，请先确认 Jira 关联');
  generation.scope = { featureIds: [...new Set([...pr.scope.featureIds, row.featureId])], excludedRequirementIds: pr.scope.excludedRequirementIds.filter(i => i !== requirementId) };
  updateJiraOperation(generation.id, 'preview', generation);
  return applyPrGeneration(projectId, actor, generation.id);
}
