import { isTerminalRequirementStatus } from '../../shared/domain';

import { assertHistoricalProjectPeople, changeSnapshot } from './support';

import { readReferenceLinks, normalizeReferenceLinks } from '../../shared/reference-links';

import { workStageInput } from '../../shared/execution-stage';

import { describeChanges } from './support';

import { invalidateForecastReview } from './forecast-reviews';

import { preserveRecordedAcceptance } from './acceptance-history';

import { validateCoordination, persistCoordination, assertCoordinationAccess } from './blocker-coordination';

import { coordinationKeys } from '../../shared/blocker-coordination';

import { validateDeliveryFields } from './delivery-execution';

import { randomUUID } from 'node:crypto';

import { getDatabaseContext } from '../database-context';

import type { Actor } from '../auth';

import { businessDaysInclusive, initialWorkEstimates, canDeleteWorkItem, isTerminalWorkItemStatus, todayIso } from '../../shared/domain';

import { fail, notFound } from '../errors';

import { assertProjectManager, assertRequirementOwnerOrManager, assertWorkItemParticipantOrManager, assertWorkItemRequirementOwnerOrManager, requireAuthorizationActor } from '../authorization';

import { getRequirement, workItemSelect, type WorkItemRecord } from './requirements';

import { recordAudit as audit } from './audit';

import { getCancellationHistory } from './work-item-history';

import { settleMilestones } from './milestones';

import { requireActiveProject, assertExpectedVersion, assertTransition, assertVersionedWrite, milestoneLabel, nowIso, nullableDate, nullableText, requireLabel, requireProgress, requireText, row, rows, type JsonObject } from './support';

import { syncStoredRequirementState } from './requirement-state';

import { appendRequirementEvent } from './requirement-events';

import { collaboratorIdsFromInput, assertProjectAssignees, syncWorkItemCollaborators } from './work-item-assignees';

const workItemExecutionKeys = ['status', 'progress', 'actualStart', 'actualEnd', 'blockedAt', 'blockedReason'];

export function createWorkItem(requirementId: string, input: JsonObject, actor: Actor, deferAnalysis=false) {
  if (Object.keys(input).some((key) => ![
    'referenceLinks','title', 'ownerId', 'collaboratorIds', 'assigneeIds', 'plannedStart', 'plannedEnd',
    'workStage','milestoneLabel', 'expectedVersion', 'reason',
  ].includes(key))) fail('新建工作项不能提交未声明字段');
  const requirement = getRequirement(requirementId, false, !deferAnalysis);
  assertExpectedVersion(input, requirement.version);
  if (workItemExecutionKeys.some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    fail('新建工作项不能提交状态、进度、实际日期或阻塞信息');
  }
  if (Object.prototype.hasOwnProperty.call(input, 'sortOrder')) {
    fail('新增工作项不能指定排序位置，请创建后使用工作项排序');
  }
  if (['pending_acceptance', 'completed', 'cancelled'].includes(requirement.status)) fail('当前需求已锁定，不能新增工作项', 'TERMINAL_LOCKED');
  const id = randomUUID(); const now = nowIso(); const title = requireLabel(input.title, '工作项标题');
  const referenceLinks=normalizeReferenceLinks(input.referenceLinks||[]);
  const max = row<{ value: number | null }>('SELECT MAX(sort_order) AS value FROM work_items WHERE requirement_id=?', requirementId)?.value ?? -1;
  const ownerId = nullableText(input.ownerId);
  const collaboratorIds = collaboratorIdsFromInput(input, ownerId) || [];
  assertProjectAssignees(requirementId, [ownerId, ...collaboratorIds]);
  const milestone = milestoneLabel(input.milestoneLabel);
  const plannedStart = nullableDate(input.plannedStart, '计划开始'); const plannedEnd = nullableDate(input.plannedEnd, '计划完成');
  if (plannedStart && businessDaysInclusive(plannedStart, plannedStart) !== 1) fail('计划开始需为工作日');
  if (plannedEnd && businessDaysInclusive(plannedEnd, plannedEnd) !== 1) fail('计划完成需为工作日');
  if (plannedStart && plannedEnd && plannedStart > plannedEnd) fail('计划完成日期不能早于计划开始日期');
  getDatabaseContext().sqlite.transaction(() => {
    if (requirement.executionMode === 'direct') {
      getDatabaseContext().sqlite.prepare("UPDATE requirements SET execution_mode='work_items',split_base_progress=?,split_at=? WHERE id=?").run(Math.min(99,requirement.progress),requirement.actualStart ? now : null,requirementId);
    }
    const reviewed = row<{ reviewedAt: string | null }>('SELECT dependencies_reviewed_at AS reviewedAt FROM requirements WHERE id=?', requirementId)?.reviewedAt;
    getDatabaseContext().sqlite.prepare(`INSERT INTO work_items
      (id, requirement_id, title, owner_id, work_stage, milestone_label, status, planned_start, planned_end, progress, sort_order, created_at, updated_at,duration_days,progress_weight)
      VALUES (?, ?, ?, ?, ?, ?, 'not_started', ?, ?, 0, ?, ?, ?, ?, ?)`).run(
      id, requirementId, title, ownerId, workStageInput.parse(input.workStage)||null, milestone, plannedStart, plannedEnd, max + 1, now, now,
      initialWorkEstimates({ status: 'not_started', plannedStart, plannedEnd }).durationDays,
      initialWorkEstimates({ status: 'not_started', plannedStart, plannedEnd }).progressWeight,
    );
    getDatabaseContext().sqlite.prepare('UPDATE work_items SET reference_links=? WHERE id=?').run(JSON.stringify(referenceLinks),id);
    // Explicitly adding independent work preserves the previously checked dependency facts.
    if (reviewed) getDatabaseContext().sqlite.prepare('UPDATE requirements SET dependencies_reviewed_at=? WHERE id=?').run(reviewed, requirementId);
    syncWorkItemCollaborators(id, collaboratorIds);
    syncStoredRequirementState(requirementId, now, true, requirement.version);
    requireActiveProject(requirement.projectId, true);
    assertRequirementOwnerOrManager(requireAuthorizationActor(actor), requirementId);
    audit(actor, 'create', 'work_item', id, `新增工作项：${title}${collaboratorIds.length ? `（${collaboratorIds.length + (ownerId ? 1 : 0)}人协作）` : ''}`);
    assertProjectAssignees(requirementId, [ownerId, ...collaboratorIds], true);
  })();
  return getRequirement(requirementId, false, !deferAnalysis).workItems!.find((item) => item.id === id);
}

export function updateWorkItem(id: string, input: JsonObject, actor: Actor, deferAnalysis=false) {
  const current = row<WorkItemRecord>(`${workItemSelect} WHERE w.id=?`, id);
  if (!current) notFound('工作项不存在');
  const requirement = getRequirement(current.requirementId, false, !deferAnalysis);
  assertExpectedVersion(input, current.version);
  const historical = isTerminalWorkItemStatus(current.status) || isTerminalRequirementStatus(requirement.status);
  if (historical) assertProjectManager(requireAuthorizationActor(actor), requirement.projectId);
  if (workItemExecutionKeys.some((key) => Object.prototype.hasOwnProperty.call(input, key))) fail('状态、进度和实际日期不能通过普通编辑修改，请使用对应操作命令');
  if (Object.keys(input).some((key) => ![
    'referenceLinks','expectedVersion', 'title', 'ownerId', 'collaboratorIds', 'assigneeIds',
    'workStage','plannedStart', 'plannedEnd', 'sortOrder', 'milestoneLabel', 'reason',...coordinationKeys,
  ].includes(key))) fail('工作项编辑不能提交未声明字段');
  const referenceLinks=input.referenceLinks===undefined?readReferenceLinks(current.referenceLinks):normalizeReferenceLinks(input.referenceLinks);
  const linksChanged=JSON.stringify(referenceLinks)!==JSON.stringify(readReferenceLinks(current.referenceLinks));
  const title = input.title === undefined ? current.title : requireLabel(input.title, '工作项标题');
  const milestone = input.milestoneLabel === undefined ? current.milestoneLabel : milestoneLabel(input.milestoneLabel);
  const ownerId = input.ownerId === undefined ? current.ownerId : nullableText(input.ownerId);
  const collaboratorIds = collaboratorIdsFromInput(input, ownerId, false);
  const previousCollaboratorIds = rows<{ personId: string }>('SELECT person_id AS personId FROM work_item_collaborators WHERE work_item_id=?', id)
    .map((item) => item.personId);
  const nextCollaboratorIds = (collaboratorIds ?? previousCollaboratorIds).filter((personId) => personId !== ownerId);
  const newAssigneeIds = [ownerId !== current.ownerId ? ownerId : null, ...nextCollaboratorIds.filter(personId => !previousCollaboratorIds.includes(personId))];
  const validateAssignees = (conflict = true) => historical
    ? assertHistoricalProjectPeople(requirement.projectId, newAssigneeIds)
    : assertProjectAssignees(current.requirementId, newAssigneeIds, conflict);
  validateAssignees(false);
  const plannedStart = input.plannedStart === undefined ? current.plannedStart : nullableDate(input.plannedStart, '计划开始');
  const plannedEnd = input.plannedEnd === undefined ? current.plannedEnd : nullableDate(input.plannedEnd, '计划完成');
  if (plannedStart && businessDaysInclusive(plannedStart, plannedStart) !== 1) fail('计划开始需为工作日');
  if (plannedEnd && businessDaysInclusive(plannedEnd, plannedEnd) !== 1) fail('计划完成需为工作日');
  if (plannedStart && plannedEnd && plannedStart > plannedEnd) fail('计划完成日期不能早于计划开始日期');
  const scheduleChanged = plannedStart !== current.plannedStart || plannedEnd !== current.plannedEnd;
  const estimates = initialWorkEstimates(current);
  if (estimates.durationDays === null) estimates.durationDays = businessDaysInclusive(plannedStart, plannedEnd) || null;
  const requirementHasExecution = Boolean(row(`SELECT 1 FROM work_items WHERE requirement_id=? AND status<>'not_started' LIMIT 1`, current.requirementId));
  const collaboratorsChanged = collaboratorIds !== undefined
    && [...collaboratorIds].sort().join(',') !== [...previousCollaboratorIds].sort().join(',');
  const structuralChanged = linksChanged || input.workStage!==undefined&&input.workStage!==current.workStage || title !== current.title || milestone !== current.milestoneLabel || ownerId !== current.ownerId
    || collaboratorsChanged || scheduleChanged || input.sortOrder !== undefined && Number(input.sortOrder) !== current.sortOrder;
  const coordinationChanged=coordinationKeys.some(k=>input[k]!==undefined);const coordination=coordinationChanged?validateCoordination(requirement.projectId,{...current,...input}):undefined;if(coordinationChanged&&current.status!=='blocked')fail('只有阻塞对象可以修改协调信息');
  if(coordinationChanged&&!structuralChanged)assertCoordinationAccess('work',id,input,actor);
  if (!structuralChanged&&!coordinationChanged) {
    getDatabaseContext().sqlite.transaction(() => {
      requireActiveProject(requirement.projectId, true);
      if (historical) assertProjectManager(requireAuthorizationActor(actor), requirement.projectId);
      if(coordinationChanged&&!structuralChanged)assertCoordinationAccess('work',id,input,actor);else assertWorkItemRequirementOwnerOrManager(requireAuthorizationActor(actor), id);
      validateAssignees();
    })();
    return requirement.workItems!.find((item) => item.id === id);
  }
  const now = nowIso();
  const cancellation = current.status === 'cancelled' ? getCancellationHistory([current], new Map([[requirement.id, requirement.status]])) : null;
  const updatedAt = cancellation?.inferredWorkItemIds.has(current.id) ? current.updatedAt : now;
  getDatabaseContext().sqlite.transaction(() => {
    const result = getDatabaseContext().sqlite.prepare(`UPDATE work_items SET title=?, owner_id=?, work_stage=?, milestone_label=?, planned_start=?, planned_end=?,
      sort_order=?, duration_days=?,progress_weight=?, version=version+1, updated_at=? WHERE id=? AND version=?`).run(
      title, ownerId, input.workStage===undefined?current.workStage||null:workStageInput.parse(input.workStage),milestone, plannedStart, plannedEnd,
      input.sortOrder === undefined ? current.sortOrder : Number(input.sortOrder), estimates.durationDays, estimates.progressWeight, updatedAt, id, current.version,
    );
    assertVersionedWrite(result, '工作项');
    getDatabaseContext().sqlite.prepare('UPDATE work_items SET reference_links=? WHERE id=?').run(JSON.stringify(referenceLinks),id);
    if(coordination)persistCoordination('work',id,requirement.projectId,{...coordination,reason:input.reason},actor);
    if (collaboratorIds !== undefined) syncWorkItemCollaborators(id, collaboratorIds);
    else if (ownerId) getDatabaseContext().sqlite.prepare('DELETE FROM work_item_collaborators WHERE work_item_id=? AND person_id=?').run(id, ownerId);
    syncStoredRequirementState(current.requirementId, now, true, requirement.version);
    requireActiveProject(requirement.projectId, true);
    if (historical) assertProjectManager(requireAuthorizationActor(actor), requirement.projectId);
    if(coordinationChanged&&!structuralChanged)assertCoordinationAccess('work',id,input,actor);else assertWorkItemRequirementOwnerOrManager(requireAuthorizationActor(actor), id);
    if ((historical || requirementHasExecution) && structuralChanged) appendRequirementEvent(current.requirementId, 'correction', nullableText(input.reason) || describeChanges(current, input), actor, id, current.progress, null, now);
    audit(actor, historical ? 'correct' : 'update', 'work_item', id, JSON.stringify(changeSnapshot({...current,collaboratorIds:previousCollaboratorIds},{title,ownerId,workStage:input.workStage===undefined?current.workStage:input.workStage,milestoneLabel:milestone,plannedStart,plannedEnd,referenceLinks,collaboratorIds:nextCollaboratorIds},nullableText(input.reason) || describeChanges(current,input))));
    validateAssignees();
  })();
  return getRequirement(current.requirementId, false, !deferAnalysis).workItems!.find((item) => item.id === id);
}

function validateWorkItemActualDates(actualStart: string | null, actualEnd: string | null, today = todayIso()) {
  if (actualStart && actualEnd && actualStart > actualEnd) fail('实际完成日期不能早于实际开始日期');
  if (actualStart && actualStart > today) fail('实际开始日期不能晚于今天，请先修正实际日期');
  if (actualEnd && actualEnd > today) fail('实际完成日期不能晚于今天');
}

function workItemEvent(id: string, action: 'start' | 'complete' | 'cancel', input: JsonObject, actor: Actor) {
  const allowedFields = new Set([
    'expectedVersion',
    ...(action === 'complete' ? ['content'] : action === 'cancel' ? ['reason'] : action === 'start' ? ['reason','ownerId','requirementOwnerId','expectedRequirementVersion'] : []),
  ]);
  if (Object.keys(input).some((key) => !allowedFields.has(key))) {
    const labels = { start: '开始', complete: '完成', cancel: '取消' } as const;
    fail(`${labels[action]}命令不能提交无关的工作项字段`);
  }
  const current = row<WorkItemRecord>(`${workItemSelect} WHERE w.id=?`, id);
  if (!current) notFound('工作项不存在');
  const parentRequirement = getRequirement(current.requirementId);
  assertExpectedVersion(input, current.version);
  const today = todayIso(); const now = nowIso();
  const labels = { start: '开始', complete: '完成', cancel: '取消' } as const;
  const eventContent = action === 'complete' ? nullableText(input.content) || '完成工作项'
    : action === 'cancel' ? nullableText(input.reason) || '取消工作项'
        : action==='start' && nullableText(input.reason) ? requireText(input.reason,'执行例外原因') : `${labels[action]}工作项`;
  const startOwner = input.ownerId ? String(input.ownerId) : current.ownerId;
  const requirementStartOwner = input.requirementOwnerId ? String(input.requirementOwnerId) : parentRequirement.ownerId;
  const assigning=action==='start'&&(input.ownerId!==undefined||input.requirementOwnerId!==undefined);
  if(assigning){
    assertWorkItemRequirementOwnerOrManager(requireAuthorizationActor(actor),id);
    if(input.expectedRequirementVersion===undefined)fail('补选负责人时缺少expectedRequirementVersion，请读取所属需求的最新版本后重试');
    assertExpectedVersion({expectedVersion:input.expectedRequirementVersion},parentRequirement.version);
    if(parentRequirement.ownerId&&parentRequirement.ownerValid&&requirementStartOwner!==parentRequirement.ownerId)fail('需求负责人已指定，请刷新后开始');
    if(current.ownerId&&startOwner!==current.ownerId)fail('工作项负责人已指定，请刷新后开始');
  }
  if (action === 'start') {
    assertTransition(current.status, ['not_started'], '开始');
    const requirement = getRequirement(current.requirementId);
    if(!requirementStartOwner)fail('开始前请指定有效需求负责人','DEPENDENCY_CONFLICT',409);
    validateDeliveryFields(requirement.projectId,{ownerId:requirementStartOwner},actor);
    validateDeliveryFields(requirement.projectId,{ownerId:startOwner},actor);
    if (!startOwner) fail('开始工作项前请指定负责人');

  }
  if (action === 'complete') {
    assertTransition(current.status, ['in_progress'], '完成');
    validateWorkItemActualDates(current.actualStart, today, today);
  }
  if (action === 'cancel') assertTransition(current.status, ['not_started', 'in_progress'], '取消');
  getDatabaseContext().sqlite.transaction(() => {
    if(assigning){
      if(requirementStartOwner!==parentRequirement.ownerId)assertVersionedWrite(getDatabaseContext().sqlite.prepare('UPDATE requirements SET owner_id=? WHERE id=? AND version=?').run(requirementStartOwner,parentRequirement.id,parentRequirement.version),'需求');
      if(startOwner)getDatabaseContext().sqlite.prepare('DELETE FROM work_item_collaborators WHERE work_item_id=? AND person_id=?').run(id,startOwner);
      audit(actor,'update','work_item',id,'开始时补选负责人：'+describeChanges(current,{ownerId:startOwner})+'；需求负责人ID：'+requirementStartOwner);
    }
    const changed = action === 'start'
      ? getDatabaseContext().sqlite.prepare(`UPDATE work_items SET actual_start=?, owner_id=?, status='in_progress', version=version+1, updated_at=? WHERE id=? AND version=?`).run(today, startOwner, now, id, current.version)
      : action === 'complete'
        ? getDatabaseContext().sqlite.prepare(`UPDATE work_items SET actual_end=?, progress=100, status='completed', blocked_at=NULL, blocked_reason=NULL, version=version+1, updated_at=? WHERE id=? AND version=?`).run(today, now, id, current.version)
        : getDatabaseContext().sqlite.prepare(`UPDATE work_items SET status='cancelled', progress=min(progress,99), actual_end=NULL, blocked_at=NULL, blocked_reason=NULL, version=version+1, updated_at=? WHERE id=? AND version=?`).run(now, id, current.version);
    assertVersionedWrite(changed, '工作项');
    syncStoredRequirementState(current.requirementId, now, true, parentRequirement.version);
    requireActiveProject(parentRequirement.projectId, true);
    assertWorkItemParticipantOrManager(requireAuthorizationActor(actor), id);
    const nextProgress = action === 'complete' ? 100 : current.progress;
    appendRequirementEvent(current.requirementId, action, eventContent, actor, id, nextProgress, null, now);
    audit(actor, action, 'work_item', id, `${labels[action]}工作项：${current.title}`);settleMilestones(parentRequirement.projectId,actor);
  })();
  return getRequirement(current.requirementId).workItems!.find((item) => item.id === id);
}

export const startWorkItem = (id: string, input: JsonObject, actor: Actor) => workItemEvent(id, 'start', input, actor);

export const completeWorkItem = (id: string, input: JsonObject, actor: Actor) => workItemEvent(id, 'complete', input, actor);

export const blockWorkItem = (_id: string, _input: JsonObject, _actor: Actor) => fail('阻塞操作已移除，请在进展中记录情况','WORKFLOW_RETIRED',410);

export const unblockWorkItem = (_id: string, _input: JsonObject, _actor: Actor) => fail('解除阻塞操作已移除','WORKFLOW_RETIRED',410);

export const cancelWorkItem = (id: string, input: JsonObject, actor: Actor) => workItemEvent(id, 'cancel', input, actor);

export function reopenWorkItem(id: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => !['expectedVersion', 'reason', 'progress'].includes(key))) {
    fail('重开命令不能提交无关的工作项字段');
  }
  const current = row<WorkItemRecord>(`${workItemSelect} WHERE w.id=?`, id);
  if (!current) notFound('工作项不存在');
  const requirement = getRequirement(current.requirementId);
  if (requirement.status === 'cancelled') fail('已取消需求的工作项不能重开', 'DEPENDENCY_CONFLICT', 409);
  const item = requirement.workItems!.find((entry) => entry.id === id)!;
  assertProjectAssignees(current.requirementId, [requirement.ownerId, item.ownerId, ...item.collaborators.map((person) => person.id)], true);
  assertExpectedVersion(input, current.version); assertTransition(current.status, ['completed', 'cancelled'], '重开');
  const reason = nullableText(input.reason) || '重新打开工作项';
  const restoredProgress = input.progress === undefined ? (current.status === 'completed' ? 99 : Math.min(current.progress, 99)) : requireProgress(input.progress, '恢复进度');
  if (restoredProgress >= 100) fail('恢复进度必须小于100%');
  if (!current.actualStart && input.progress !== undefined && restoredProgress !== 0) {
    fail('无实际开始日期的工作项只能按0%重开，请重开后再开始并更新进度');
  }
  validateWorkItemActualDates(current.actualStart, null);
  const nextStatus = current.actualStart ? 'in_progress' : 'not_started'; const nextProgress = nextStatus === 'not_started' ? 0 : restoredProgress;
  const now = nowIso();
  getDatabaseContext().sqlite.transaction(() => {
    preserveRecordedAcceptance(current.requirementId);
    const changed = getDatabaseContext().sqlite.prepare(`UPDATE work_items SET status=?, progress=?, actual_end=NULL, blocked_at=NULL, blocked_reason=NULL,
      version=version+1, updated_at=? WHERE id=? AND version=?`).run(nextStatus, nextProgress, now, id, current.version);
    assertVersionedWrite(changed, '工作项');
    syncStoredRequirementState(current.requirementId, now, true, requirement.version);
    requireActiveProject(requirement.projectId, true);
    assertWorkItemRequirementOwnerOrManager(requireAuthorizationActor(actor), id);
    invalidateForecastReview('work',id);
    appendRequirementEvent(current.requirementId, 'reopen', reason, actor, id, nextProgress, null, now);
    if (['pending_acceptance', 'completed'].includes(requirement.status)) {
      appendRequirementEvent(current.requirementId, 'rework', `重开工作项：${current.title}；${reason}`, actor, null, null, null, now);
    }
    audit(actor, 'reopen', 'work_item', id, `重开工作项：${current.title}`);
    assertProjectAssignees(current.requirementId, [requirement.ownerId, item.ownerId, ...item.collaborators.map((person) => person.id)], true);
  })();
  return getRequirement(current.requirementId).workItems!.find((item) => item.id === id);
}

export function correctWorkItem(id: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => ![
    'referenceLinks','expectedVersion', 'reason', 'supersedesId', 'title', 'progress', 'actualStart', 'actualEnd',
  ].includes(key))) fail('工作项纠错不能提交完成说明或未声明字段');
  const current = row<WorkItemRecord>(`${workItemSelect} WHERE w.id=?`, id);
  if (!current) notFound('工作项不存在');
  const requirement = getRequirement(current.requirementId);
  assertExpectedVersion(input, current.version); const reason = nullableText(input.reason) || describeChanges(current, input);
  const progress = input.progress === undefined ? current.progress : requireProgress(input.progress, '完成度');
  if (isTerminalWorkItemStatus(current.status) && progress !== current.progress) fail('终态工作项调整进度时必须使用重开操作', 'TERMINAL_LOCKED');
  if (progress >= 100 && current.status !== 'completed') fail('100%只能由完成操作产生');
  const actualStart = input.actualStart === undefined ? current.actualStart : nullableDate(input.actualStart, '实际开始');
  const actualEnd = input.actualEnd === undefined ? current.actualEnd : nullableDate(input.actualEnd, '实际完成');
  if (current.status === 'not_started' && (actualStart || actualEnd || progress !== 0)) fail('未开始工作项不能设置实际日期或非零进度');
  if (['in_progress', 'blocked'].includes(current.status) && (!actualStart || actualEnd || progress >= 100)) fail('进行中或阻塞工作项必须保留实际开始日期，且不能设置实际完成日期');
  if (current.status === 'completed' && (!actualStart || !actualEnd)) fail('已完成工作项必须保留实际开始和完成日期');
  if (current.status === 'cancelled' && actualEnd) fail('已取消工作项不能设置实际完成日期');
  validateWorkItemActualDates(actualStart, actualEnd);
  const cancellationHistory = current.status === 'cancelled'
    ? getCancellationHistory([current], new Map([[requirement.id, requirement.status]]))
    : null;
  if (actualStart && cancellationHistory) {
    const cancelledAt = cancellationHistory.workItemDates.get(current.id)!;
    if (actualStart > cancelledAt) fail(`实际开始日期不能晚于取消日期（${cancelledAt}）`);
  }
  const supersedesId = nullableText(input.supersedesId);
  if (supersedesId && !row('SELECT id FROM progress_updates WHERE id=? AND requirement_id=? AND work_item_id=?', supersedesId, current.requirementId, id)) {
    fail('纠错引用记录不存在或不属于当前工作项');
  }
  const referenceLinks=input.referenceLinks===undefined?readReferenceLinks(current.referenceLinks):normalizeReferenceLinks(input.referenceLinks);
  const linksChanged=JSON.stringify(referenceLinks)!==JSON.stringify(readReferenceLinks(current.referenceLinks));
  const title = input.title === undefined ? current.title : requireLabel(input.title, '工作项标题');
  const factsChanged = linksChanged || title !== current.title || progress !== current.progress
    || actualStart !== current.actualStart || actualEnd !== current.actualEnd;
  if (!factsChanged && !supersedesId) fail('没有需要纠错的工作项信息，请修改字段或关联历史记录');
  const now = nowIso();
  // 旧取消数据可能没有取消事件，只能以原 updated_at 推断取消日期。此时保留该时间戳，避免一次纠错把取消上限推迟到今天。
  const itemUpdatedAt = cancellationHistory?.inferredWorkItemIds.has(current.id) ? current.updatedAt : now;
  getDatabaseContext().sqlite.transaction(() => {
    const changed = getDatabaseContext().sqlite.prepare(`UPDATE work_items SET title=?, actual_start=?, actual_end=?, progress=?, version=version+1, updated_at=? WHERE id=? AND version=?`)
      .run(title, actualStart, actualEnd, progress, itemUpdatedAt, id, current.version);
    assertVersionedWrite(changed, '工作项');
    getDatabaseContext().sqlite.prepare('UPDATE work_items SET reference_links=? WHERE id=?').run(JSON.stringify(referenceLinks),id);
    syncStoredRequirementState(current.requirementId, now, true, requirement.version);
    requireActiveProject(requirement.projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), requirement.projectId);
    appendRequirementEvent(current.requirementId, 'correction', reason, actor, id, progress, supersedesId, now);
    audit(actor, 'correct', 'work_item', id, JSON.stringify(changeSnapshot(current,{title,actualStart,actualEnd,progress,referenceLinks},reason)));
  })();
  return getRequirement(current.requirementId).workItems!.find((item) => item.id === id);
}

export function deleteWorkItem(id: string, input: JsonObject, actor: Actor, deferAnalysis=false) {
  if (Object.keys(input).some((key) => key !== 'expectedVersion')) fail('删除命令不能提交无关的工作项字段');
  const current = row<WorkItemRecord>(`${workItemSelect} WHERE w.id=?`, id);
  if (!current) notFound('工作项不存在');
  const requirement = getRequirement(current.requirementId, false, !deferAnalysis);
  assertExpectedVersion(input, current.version);
  if (['pending_acceptance', 'completed', 'cancelled'].includes(requirement.status)) fail('当前需求已锁定，不能删除工作项', 'TERMINAL_LOCKED');
  if (!canDeleteWorkItem(current, Boolean(row('SELECT 1 FROM progress_updates WHERE work_item_id=? LIMIT 1', id)))) {
    fail('只有未开始、0%且无执行信息和进展历史的工作项可以删除，其他工作项请使用取消', 'DEPENDENCY_CONFLICT');
  }
  getDatabaseContext().sqlite.transaction(() => {
    const removedDependencies = rows('SELECT * FROM dependency_edges WHERE source_work_item_id=? OR target_work_item_id=?',id,id);
    getDatabaseContext().sqlite.prepare('DELETE FROM dependency_edges WHERE source_work_item_id=? OR target_work_item_id=?').run(id,id);
    getDatabaseContext().sqlite.prepare('UPDATE milestones SET legacy_work_item_id=NULL WHERE legacy_work_item_id=?').run(id);
    const deleted = getDatabaseContext().sqlite.prepare('DELETE FROM work_items WHERE id=? AND version=?').run(id, current.version);
    assertVersionedWrite(deleted, '工作项');
    syncStoredRequirementState(current.requirementId, nowIso(), true, requirement.version);
    requireActiveProject(requirement.projectId, true);
    assertRequirementOwnerOrManager(requireAuthorizationActor(actor), current.requirementId);
    audit(actor, 'delete', 'work_item', id, JSON.stringify({title:current.title,removedDependencies}), requirement.projectId);
  })();
  return { ok: true };
}

export function reorderWorkItems(requirementId: string, ids: string[], actor: Actor, input: JsonObject = {}) {
  if (Object.keys(input).some((key) => !['ids', 'reason', 'expectedVersion'].includes(key))) {
    fail('工作项排序不能提交未声明字段');
  }
  const requirement = getRequirement(requirementId); assertExpectedVersion(input, requirement.version);
  const historical = isTerminalRequirementStatus(requirement.status);
  if (historical) assertProjectManager(requireAuthorizationActor(actor), requirement.projectId);
  const currentIds = requirement.workItems!.map((item) => item.id);
  if (ids.length !== currentIds.length || new Set(ids).size !== ids.length
    || ids.some((id) => !currentIds.includes(id))) {
    fail('工作项顺序必须包含当前需求的全部工作项，且不能重复');
  }
  const workItemsById = new Map(requirement.workItems!.map((item) => [item.id, item]));
  const movedItems = ids.map((id, index) => ({ item: workItemsById.get(id)!, index }))
    .filter(({ item, index }) => item.sortOrder !== index);
  if (!movedItems.length) {
    getDatabaseContext().sqlite.transaction(() => {
      requireActiveProject(requirement.projectId, true);
      if (historical) assertProjectManager(requireAuthorizationActor(actor), requirement.projectId);
      assertRequirementOwnerOrManager(requireAuthorizationActor(actor), requirementId);
    })();
    return requirement.workItems;
  }
  const reason = nullableText(input.reason) || '调整工作项顺序：' + ids.map(id => workItemsById.get(id)!.title).join(' → ');
  const now = nowIso();
  const tx = getDatabaseContext().sqlite.transaction(() => {
    const update = getDatabaseContext().sqlite.prepare(`UPDATE work_items SET sort_order=?, version=version+1, updated_at=CASE WHEN status='cancelled' THEN updated_at ELSE ? END
      WHERE id=? AND requirement_id=? AND sort_order=? AND version=?`);
    for (const { item, index } of movedItems) {
      assertVersionedWrite(update.run(index, now, item.id, requirementId, item.sortOrder, item.version), '工作项');
    }
    syncStoredRequirementState(requirementId, now, true, requirement.version);
    requireActiveProject(requirement.projectId, true);
    if (historical) assertProjectManager(requireAuthorizationActor(actor), requirement.projectId);
    assertRequirementOwnerOrManager(requireAuthorizationActor(actor), requirementId);
    if (reason) appendRequirementEvent(requirementId, 'correction', reason, actor, null, null, null, now);
    audit(actor, 'reorder', 'work_item', requirementId, '调整工作项顺序', requirement.projectId);
  });
  tx();
  return getRequirement(requirementId).workItems;
}
