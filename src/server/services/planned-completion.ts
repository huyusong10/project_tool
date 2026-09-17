

import { getDatabaseContext } from '../database-context';

import type { Actor } from '../auth';

import { todayIso } from '../../shared/domain';

import { fail, notFound } from '../errors';

import { assertProjectManager, requireAuthorizationActor } from '../authorization';

import { getRequirement, workItemSelect, type RequirementRecord, type WorkItemRecord } from './requirements';

import { recordAudits } from './audit';

import { settleMilestones } from './milestones';

import { assertExpectedVersion, assertTransition, assertVersionedWrite, nowIso, requireActiveProject, requireDate, requireText, row, rows, type JsonObject } from './support';

import { syncStoredRequirementState } from './requirement-state';

import { appendRequirementEvents } from './requirement-events';

function validatePlannedCompletion(requirement: RequirementRecord, items: WorkItemRecord[]) {
  assertTransition(requirement.status, ['planning', 'not_started', 'in_progress', 'blocked', 'pending_acceptance'], '补录完成');
  const history = new Set(rows<{ workItemId: string }>(
    `SELECT DISTINCT work_item_id AS workItemId FROM progress_updates
     WHERE requirement_id=? AND work_item_id IS NOT NULL AND event_type NOT IN ('note','correction')`, requirement.id,
  ).map((entry) => entry.workItemId));
  const today = todayIso();
  for (const item of items) {
    if (item.status !== 'not_started' || item.progress !== 0 || item.actualStart || item.actualEnd || item.blockedAt || history.has(item.id)) {
      fail(`“${item.title}”已有执行记录，请使用正常完成或实际日期修正`, 'DEPENDENCY_CONFLICT', 409);
    }
    const start = requireDate(item.plannedStart, `${item.title}计划开始`);
    const end = requireDate(item.plannedEnd, `${item.title}计划完成`);
    if (start > end) fail(`“${item.title}”计划完成日期不能早于开始日期`);
    if (end > today) fail(`“${item.title}”计划尚未结束，不能补录完成`, 'DEPENDENCY_CONFLICT', 409);
  }
}

function recordPlannedCompletions(requirement: RequirementRecord, items: WorkItemRecord[], content: string, actor: Actor, expectedRequirementVersion?: number) {
  const now = nowIso();
  if (!items.length) {
    if (expectedRequirementVersion !== undefined) syncStoredRequirementState(requirement.id, now, true, expectedRequirementVersion);
    return;
  }
  const update = getDatabaseContext().sqlite.prepare(`UPDATE work_items SET status='completed', progress=100,
    actual_start=planned_start, actual_end=planned_end, blocked_at=NULL, blocked_reason=NULL,
    version=version+1, updated_at=? WHERE id=? AND version=?`);
  for (const item of items) assertVersionedWrite(update.run(now, item.id, item.version), '工作项');
  const metrics = syncStoredRequirementState(requirement.id, now, true, expectedRequirementVersion);
  appendRequirementEvents(requirement.id, items.map((item) => ({
    eventType: 'complete', content: `${content}（${item.plannedStart} 至 ${item.plannedEnd}）`, workItemId: item.id, workItemPercent: 100,
  })), actor, now, metrics.progress);
  recordAudits(actor, items.map((item) => ({
    action: 'complete', entityType: 'work_item', entityId: item.id,
    summary: `按计划补录完成：${item.title}`, projectId: requirement.projectId,
  })));settleMilestones(requirement.projectId,actor);
}

export function completeWorkItemAsPlanned(id: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => key !== 'expectedVersion' && key !== 'content')) {
    fail('按期完成命令不能提交实际日期、进度或其他工作项字段');
  }
  const current = row<WorkItemRecord>(`${workItemSelect} WHERE w.id=?`, id);
  if (!current) notFound('工作项不存在');
  const requirement = getRequirement(current.requirementId);
  assertExpectedVersion(input, current.version);
  validatePlannedCompletion(requirement, [current]);
  const content = requireText(input.content ?? '历史补录，按计划完成', '补录说明');
  getDatabaseContext().sqlite.transaction(() => {
    recordPlannedCompletions(requirement, [current], content, actor, requirement.version);
    requireActiveProject(requirement.projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), requirement.projectId);
  })();
  return getRequirement(requirement.id).workItems!.find((item) => item.id === id);
}

export function completeRequirementAsPlanned(id: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => key !== 'expectedVersion' && key !== 'content')) {
    fail('按期完成命令不能提交实际日期、进度或其他需求字段');
  }
  const current = getRequirement(id);
  assertExpectedVersion(input, current.version);
  const active = (current.workItems || []).filter((item) => item.status !== 'cancelled');
  if (!active.length) fail('请先添加有效工作项并补齐计划日期', 'DEPENDENCY_CONFLICT', 409);
  const pending = active.filter((item) => item.status !== 'completed');
  if (!pending.length) fail('所有工作项均已完成', 'DEPENDENCY_CONFLICT', 409);
  validatePlannedCompletion(current, pending);
  const content = requireText(input.content ?? '历史补录，按计划完成', '补录说明');
  return getDatabaseContext().sqlite.transaction(() => {
    recordPlannedCompletions(current, pending, content, actor, current.version);
    requireActiveProject(current.projectId,true);
    assertProjectManager(requireAuthorizationActor(actor),current.projectId);
    return getRequirement(id);
  })();
}
