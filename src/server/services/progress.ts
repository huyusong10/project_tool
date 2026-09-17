

import { executeDirectRequirement } from './delivery-execution';

import { randomUUID } from 'node:crypto';

import { getDatabaseContext } from '../database-context';

import type { Actor } from '../auth';

import { isTerminalWorkItemStatus } from '../../shared/domain';

import { fail, notFound } from '../errors';

import { assertCanAddProgress, requireAuthorizationActor } from '../authorization';

import { getRequirement } from './requirements';

import { recordAudit as audit } from './audit';

import { assertExpectedVersion, assertVersionedWrite, nowIso, nullableText, requireActiveProject, requireProgress, requireText, row, type JsonObject } from './support';

import { syncStoredRequirementState } from './requirement-state';

export function addProgress(requirementId: string, input: JsonObject, actor: Actor) {
  if(input.requirementPercent!==undefined){if(input.workItemId||input.workItemPercent!==undefined)fail('需求进度不能与工作项进度同时提交');return executeDirectRequirement(requirementId,'progress',{expectedVersion:input.expectedVersion,content:input.content,progress:input.requirementPercent},actor);}
  if (Object.keys(input).some((key) => !['content', 'workItemId', 'workItemPercent', 'expectedVersion'].includes(key))) {
    fail('进展命令不能提交无关的需求或工作项字段');
  }
  const requirement = getRequirement(requirementId);
  const id = randomUUID(); const now = nowIso(); const workItemId = nullableText(input.workItemId);
  if (workItemId && !requirement.workItems!.some((item) => item.id === workItemId)) notFound('关联工作项不存在');
  if (!workItemId && input.workItemPercent !== undefined && nullableText(input.workItemPercent) !== null) fail('填写完成度前请选择工作项');
  const hasPercent = input.workItemPercent !== undefined && input.workItemPercent !== null && String(input.workItemPercent).trim() !== '';
  const workItemPercent = workItemId && hasPercent ? requireProgress(input.workItemPercent, '工作项完成度') : null;
  const workItem = workItemId ? requirement.workItems!.find((item) => item.id === workItemId)! : null;
  const content = nullableText(input.content) || (workItemPercent !== null ? `完成度：${workItem?.progress ?? 0}% → ${workItemPercent}%` : requireText(input.content, '说明'));
  if (workItemPercent !== null && workItem) assertExpectedVersion(input, workItem.version);
  if (workItem && isTerminalWorkItemStatus(workItem.status)) fail('已完成或已取消工作项不能再提交进展', 'TERMINAL_LOCKED');
  if (workItemPercent !== null && workItem?.status !== 'in_progress') fail('只有进行中工作项可以更新完成度；请先开始或解除阻塞', 'INVALID_TRANSITION');
  if (workItemPercent === 100) fail('100%只能通过“完成工作项”操作提交');
  if (workItemPercent !== null && workItem && workItemPercent < workItem.progress) fail('普通进展不能降低完成度，请由项目经理执行纠错');
  if (!workItemId && ['pending_acceptance', 'completed', 'cancelled'].includes(requirement.status)) fail('终态需求已锁定，不能追加进展', 'TERMINAL_LOCKED');
  const tx = getDatabaseContext().sqlite.transaction(() => {
    if (workItemId && workItemPercent !== null) {
      const changed = getDatabaseContext().sqlite.prepare(`UPDATE work_items SET progress=?, version=version+1, updated_at=? WHERE id=? AND version=?`)
        .run(workItemPercent, now, workItemId, workItem!.version);
      assertVersionedWrite(changed, '工作项');
      syncStoredRequirementState(requirementId, now, true, requirement.version);
    }
    const percent = row<{ progress: number }>('SELECT progress FROM requirements WHERE id=?', requirementId)?.progress ?? requirement.progress;
    getDatabaseContext().sqlite.prepare(`INSERT INTO progress_updates (id, requirement_id, work_item_id, percent, work_item_percent, content, event_type, created_by_account_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, requirementId, workItemId, percent, workItemPercent, content, workItemPercent === null ? 'note' : 'progress', actor.accountId || null, now, now);
    const latestRequirement = row<{ status: string; deletedAt: string | null }>(
      'SELECT status, deleted_at AS deletedAt FROM requirements WHERE id=?', requirementId,
    );
    if (!latestRequirement || latestRequirement.deletedAt) fail('需求已归档，不能追加进展', 'DEPENDENCY_CONFLICT', 409);
    if (workItemId) {
      const latestItem = row<{ status: string }>('SELECT status FROM work_items WHERE id=? AND requirement_id=?', workItemId, requirementId);
      if (!latestItem) notFound('关联工作项不存在');
      if (isTerminalWorkItemStatus(latestItem.status)) fail('已完成或已取消工作项不能再提交进展', 'TERMINAL_LOCKED', 409);
    } else if (['pending_acceptance', 'completed', 'cancelled'].includes(latestRequirement.status)) {
      fail('终态需求已锁定，不能追加进展', 'TERMINAL_LOCKED', 409);
    }
    requireActiveProject(requirement.projectId, true);
    assertCanAddProgress(requireAuthorizationActor(actor), requirementId, workItemId);
    const result = getRequirement(requirementId);
    audit(actor, 'create', 'progress', id, `追加进展：${result.progress}% ${content.slice(0, 50)}`);
    return result;
  });
  return tx();
}

export function updateProgress(id: string, input: JsonObject, _actor: Actor) {
  if (Object.keys(input).some((key) => !['content', 'workItemId', 'workItemPercent', 'expectedVersion'].includes(key))) {
    fail('进展历史修改不能提交未声明字段');
  }
  if (!row('SELECT id FROM progress_updates WHERE id=?', id)) notFound('进展记录不存在');
  fail('进展历史为只追加记录，不能修改；如需更正请追加纠错记录', 'HISTORY_IMMUTABLE');
}

export function deleteProgress(id: string, _actor: Actor) {
  if (!row('SELECT id FROM progress_updates WHERE id=?', id)) notFound('进展记录不存在');
  fail('进展历史为只追加记录，不能删除', 'HISTORY_IMMUTABLE');
}
