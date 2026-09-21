import { isTerminalRequirementStatus } from '../../shared/domain';

import { assertHistoricalProjectPeople, changeSnapshot } from './support';

import { requirementReferenceLinks } from '../../shared/reference-links';

import { persistRequirementLinks } from './reference-links';

import { describeChanges } from './support';

import { persistOrganization } from './intake-metadata';

import { coordinationKeys } from '../../shared/blocker-coordination';

import { rescheduleDirectRequirement, createDirectRequirement, updateDeliveryRequirement, validateDeliveryFields, assertRequirementAcceptor } from './delivery-execution';

import { createHash, randomUUID } from 'node:crypto';

import { getDatabaseContext } from '../database-context';

import type { Actor } from '../auth';

import { businessDaysInclusive, plannedDatesFromOffset, plannedStartFromDeadline, priorities, rebaseBusinessDate, isTerminalWorkItemStatus, todayIso } from '../../shared/domain';

import { fail, notFound } from '../errors';

import { assertProjectManager, requireAuthorizationActor } from '../authorization';

import { getRequirement } from './requirements';

import { recordAudit as audit } from './audit';

import { settleMilestones } from './milestones';

import { instantiateTemplateGraph } from './path-templates';

import { requireActiveProject, assertExpectedVersion, assertTransition, assertVersionedWrite, ensureEnum, nowIso, nextUpdatedAt, nullableText, requireDate, requireLabel, requireText, row, rows, type JsonObject } from './support';

import { firstActiveTemplateId } from './template-defaults';

import { requirementOwner } from './requirement-owner';

import { syncStoredRequirementState, updateStoredRequirementSchedule } from './requirement-state';

import { appendRequirementEvent } from './requirement-events';

import { assertOptionalArchiveGeneration } from './archive-guards';

function activeTemplateItems(templateId: string) {
  return rows<{ id: string; title: string; sortOrder: number; startOffsetDays: number; durationDays: number; milestoneLabel: string | null }>(`SELECT id, title,
    sort_order AS sortOrder, start_offset_days AS startOffsetDays, duration_days AS durationDays, milestone_label AS milestoneLabel,kind,arrangement,arrangement_anchor AS arrangementAnchor,confirmation_mode AS confirmationMode
    FROM template_items WHERE template_id=? AND deleted_at IS NULL AND kind='work' ORDER BY sort_order`, templateId);
}

function applyTemplateInternal(requirementId: string, templateId: string, baseStart: string, deferAnalysis=false) {
  const createdIds: string[] = [];
  const items = activeTemplateItems(templateId);
  if (!items.length && !row("SELECT 1 FROM template_items WHERE template_id=? AND deleted_at IS NULL AND kind='milestone' LIMIT 1", templateId)) fail('模板没有可用元素');
  const existing = new Set(rows<{ templateItemId: string | null; title: string }>(
    'SELECT template_item_id AS templateItemId, title FROM work_items WHERE requirement_id=?', requirementId,
  ).flatMap((item) => [item.templateItemId, item.title].filter(Boolean) as string[]));
  const insert = getDatabaseContext().sqlite.prepare(`INSERT INTO work_items
    (id, requirement_id, template_item_id, title, milestone_label, status, planned_start, planned_end, sort_order, created_at, updated_at,duration_days,progress_weight)
    VALUES (?, ?, ?, ?, ?, 'not_started', ?, ?, ?, ?, ?, ?, ?)`);
  const now = nowIso();
  let nextOrder = (row<{ maxOrder: number | null }>('SELECT MAX(sort_order) AS maxOrder FROM work_items WHERE requirement_id=?', requirementId)?.maxOrder ?? -1) + 1;
  for (const item of items) {
    if (existing.has(item.id) || existing.has(item.title)) continue;
    const plan = plannedDatesFromOffset(baseStart, item.startOffsetDays, item.durationDays);
    const workId = randomUUID(); createdIds.push(workId);
    insert.run(workId, requirementId, item.id, item.title, item.milestoneLabel, plan.plannedStart, plan.plannedEnd, nextOrder++, now, now,item.durationDays,item.durationDays);
  }
  instantiateTemplateGraph(requirementId, templateId, createdIds, baseStart, deferAnalysis);
  return createdIds;
}

function shiftRequirementWorkItems(requirementId: string, currentAnchor: string, targetAnchor: string, updatedAt: string) {
  if (currentAnchor === targetAnchor) return;
  const items = rows<{ id: string; plannedStart: string | null; plannedEnd: string | null }>(
    `SELECT id, planned_start AS plannedStart, planned_end AS plannedEnd FROM work_items
      WHERE requirement_id=? AND status<>'cancelled'`, requirementId,
  );
  const update = getDatabaseContext().sqlite.prepare('UPDATE work_items SET duration_days=COALESCE(duration_days,?),progress_weight=COALESCE(progress_weight,?),planned_start=?, planned_end=?, version=version+1, updated_at=? WHERE id=?');
  for (const item of items) {
    update.run(
      businessDaysInclusive(item.plannedStart,item.plannedEnd)||null,businessDaysInclusive(item.plannedStart,item.plannedEnd)||1,
      item.plannedStart ? rebaseBusinessDate(item.plannedStart, currentAnchor, targetAnchor) : null,
      item.plannedEnd ? rebaseBusinessDate(item.plannedEnd, currentAnchor, targetAnchor) : null,
      updatedAt,
      item.id,
    );
  }
}

export function createRequirement(input: JsonObject, actor: Actor, deferNormalization=false) {
  if(!input.templateId)return createDirectRequirement({...input,executionMode:'direct'},actor,deferNormalization);
  if (Object.keys(input).some((key) => ![
    'reason','phaseId','featureId','projectId', 'title', 'priority', 'ownerId', 'background', 'acceptanceCriteria', 'referenceUrl', 'referenceLinks',
    'plannedStart', 'plannedEnd', 'templateId','deliveryScope','executionMode','acceptanceOwnerId','durationDays','forecastEnd','unblockEstimate',
  ].includes(key))) fail('新建需求不能提交未声明字段');
  const commandFields = ['status', 'progress', 'acceptedAt', 'acceptedByAccountId', 'scheduleMode', 'confirmTemplateReset', 'expectedVersion'];
  if (commandFields.some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    fail('新建需求不能提交状态、进度、验收、排期模式、重选确认或版本字段');
  }
  const id = randomUUID(); const now = nowIso(); const projectId = requireText(input.projectId, '项目');
  const project = row<{ id: string; defaultTemplateId: string | null }>(
    'SELECT id, default_template_id AS defaultTemplateId FROM projects WHERE id=? AND deleted_at IS NULL', projectId,
  );
  if (!project) notFound('项目不存在');
  const title = requireLabel(input.title, '需求标题');
  const priority = ensureEnum(input.priority ?? 'P2', priorities, '优先级');
  const ownerId = requirementOwner(projectId, input.ownerId);
  const background = nullableText(input.background);
  const acceptanceCriteria = nullableText(input.acceptanceCriteria);
  const referenceLinks = requirementReferenceLinks(input);
  const referenceUrl = referenceLinks[0]?.url||null;
  const inputPlannedStart = nullableText(input.plannedStart);
  const inputPlannedEnd = nullableText(input.plannedEnd);
  if (inputPlannedStart && inputPlannedEnd) fail('计划开始和截止日期只能选择一项');
  const hasSchedule = Boolean(inputPlannedStart || inputPlannedEnd);
  const templateId = nullableText(input.templateId) || (hasSchedule ? project.defaultTemplateId || firstActiveTemplateId(projectId) : null);
  if (templateId && !row('SELECT id FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL', templateId, projectId)) {
    fail('请选择当前项目的有效流程设计');
  }
  if (hasSchedule && !templateId) fail('立即规划时请选择当前项目的有效流程设计');
  let plannedStart: string | null = null;
  if (inputPlannedStart) {
    plannedStart = requireDate(inputPlannedStart, '计划开始');
    if (businessDaysInclusive(plannedStart, plannedStart) !== 1) fail('计划开始需为工作日');
  } else if (inputPlannedEnd) {
    const deadline = requireDate(inputPlannedEnd, '截止日期');
    if (businessDaysInclusive(deadline, deadline) !== 1) fail('截止日期需为工作日');
    plannedStart = plannedStartFromDeadline(deadline, activeTemplateItems(templateId!));
  }
  const tx = getDatabaseContext().sqlite.transaction(() => {
    getDatabaseContext().sqlite.prepare(`INSERT INTO requirements
      (id, project_id, template_id, title, background, acceptance_criteria, reference_url, owner_id,
        status, planned_start, progress, risk_level, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'not_started', ?, 0, 'low', ?, ?, ?)`).run(
      id, projectId, templateId, title, background, acceptanceCriteria, referenceUrl, ownerId, plannedStart, priority, now, now,
    );
    persistRequirementLinks(id,input);
    validateDeliveryFields(projectId,input,actor);persistOrganization(id,projectId,input);
    getDatabaseContext().sqlite.prepare('UPDATE requirements SET delivery_scope=?,acceptance_owner_id=? WHERE id=?').run(input.deliveryScope||'committed',input.acceptanceOwnerId||null,id);
    if (plannedStart && templateId) applyTemplateInternal(id, templateId, plannedStart, deferNormalization);
    else if(templateId){applyTemplateInternal(id,templateId,todayIso(),deferNormalization);getDatabaseContext().sqlite.prepare('UPDATE work_items SET planned_start=NULL,planned_end=NULL WHERE requirement_id=?').run(id);}
    updateStoredRequirementSchedule(id);
    getDatabaseContext().sqlite.prepare('UPDATE requirements SET dependencies_reviewed_at=? WHERE id=?').run(now,id);
    requirementOwner(projectId, ownerId, true);
    requireActiveProject(projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), projectId);
    const organization = JSON.stringify({featureId:input.featureId,phaseId:input.phaseId,reason:input.reason});
    audit(actor, 'create', 'requirement', id, plannedStart ? `创建需求并生成工作项：${title}` : `创建需求：${title}${organization==='{}'?'':'；'+organization}`);
  });
  tx();
  return getRequirement(id, false, !deferNormalization);
}

function changeRequirement(id: string, input: JsonObject, actor: Actor, deferAnalysis=false) {
  const current = getRequirement(id, false, !deferAnalysis);
  assertExpectedVersion(input, current.version);
  if (['completed', 'cancelled'].includes(current.status)) {
    fail('已完成或已取消需求已锁定，请使用返工或纠错操作', 'TERMINAL_LOCKED');
  }
  if (current.status === 'pending_acceptance' && ['plannedStart', 'plannedEnd', 'scheduleMode', 'templateId', 'confirmTemplateReset']
    .some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    fail('待验收需求只能修改基本信息，不能调整排期或流程', 'TERMINAL_LOCKED');
  }
  const title = input.title === undefined ? current.title : requireLabel(input.title, '需求标题');
  const priority = input.priority === undefined ? current.priority : ensureEnum(input.priority, priorities, '优先级');
  const ownerId = input.ownerId === undefined ? current.ownerId : requirementOwner(current.projectId, input.ownerId);
  const background = input.background === undefined ? current.background : nullableText(input.background);
  const acceptanceCriteria = input.acceptanceCriteria === undefined ? current.acceptanceCriteria : nullableText(input.acceptanceCriteria);
  const referenceLinks = requirementReferenceLinks(input,current);
  const referenceUrl = referenceLinks[0]?.url||null;
  const requestedPlannedStart = input.plannedStart === undefined ? undefined : requireDate(input.plannedStart, '计划开始');
  const requestedPlannedEnd = input.plannedEnd === undefined ? undefined : requireDate(input.plannedEnd, '计划完成');
  if (requestedPlannedStart !== undefined && requestedPlannedEnd !== undefined) fail('计划开始和完成日期请选择一项');
  const scheduleMode = input.scheduleMode === undefined
    ? (requestedPlannedEnd !== undefined ? 'deadline' : 'start')
    : ensureEnum(input.scheduleMode, ['start', 'deadline'] as const, '排期方式');
  if (scheduleMode === 'start' && requestedPlannedEnd !== undefined) fail('正排时请设置计划开始日期');
  if (scheduleMode === 'deadline' && requestedPlannedStart !== undefined) fail('倒排时请设置计划完成日期');
  const templateId = input.templateId === undefined ? current.templateId : nullableText(input.templateId);
  const templateChanged = input.templateId !== undefined && templateId !== current.templateId;
  const hasExecution = current.workItems!.some((item) => item.status !== 'not_started' || item.progress > 0 || item.actualStart)
    || Boolean(row(`SELECT 1 FROM progress_updates WHERE requirement_id=? AND event_type NOT IN ('note','correction') LIMIT 1`, id));
  if (input.ownerId !== undefined && !ownerId && hasExecution) {
    fail('需求已有执行记录，只能更换负责人，不能清空负责人', 'DEPENDENCY_CONFLICT', 409);
  }
  if (ownerId !== current.ownerId) validateDeliveryFields(current.projectId, { ownerId }, actor, current);
  let nextPlannedStart = current.plannedStart;
  let scheduleShift: { currentAnchor: string; targetAnchor: string } | null = null;
  let generateInitialPlan = false;
  if (requestedPlannedStart !== undefined || requestedPlannedEnd !== undefined) {
    const targetDate = requestedPlannedStart ?? requestedPlannedEnd!;
    if (businessDaysInclusive(targetDate, targetDate) !== 1) fail(`${scheduleMode === 'start' ? '计划开始' : '计划完成'}需为工作日`);
    if (!templateChanged) {
      const currentAnchor = scheduleMode === 'start' ? current.plannedStart : current.plannedEnd;
      if (!currentAnchor) {
        if (current.workItems!.length || !current.templateId) fail('当前需求缺少可用于顺延的计划日期');
        nextPlannedStart = scheduleMode === 'start'
          ? targetDate
          : plannedStartFromDeadline(targetDate, activeTemplateItems(current.templateId));
        generateInitialPlan = true;
      } else {
        scheduleShift = { currentAnchor, targetAnchor: targetDate };
        nextPlannedStart = current.plannedStart
          ? rebaseBusinessDate(current.plannedStart, currentAnchor, targetDate)
          : null;
      }
    }
  }
  if (templateChanged) {
    if (hasExecution) fail('需求已有执行记录，不能重选流程；请取消后重新创建', 'INVALID_TRANSITION');
    if (!templateId || !row('SELECT id FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL', templateId, current.projectId)) fail('请选择当前项目的有效流程设计');
    if (requestedPlannedEnd !== undefined) {
      nextPlannedStart = plannedStartFromDeadline(requestedPlannedEnd, activeTemplateItems(templateId));
    } else if (requestedPlannedStart !== undefined) {
      nextPlannedStart = requestedPlannedStart;
    }
    if (!nextPlannedStart) fail('重选流程前请设置计划日期');
    if (input.confirmTemplateReset !== true) fail('重选流程会替换未执行工作项并重新生成计划；需求级说明将保留，请确认后重试');
  }
  if (generateInitialPlan && !row('SELECT id FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL', current.templateId, current.projectId)) {
    fail('当前流程设计已归档，请恢复流程或重新选择', 'DEPENDENCY_CONFLICT', 409);
  }
  const informationChanged = title !== current.title || priority !== current.priority || ownerId !== current.ownerId
    || background !== current.background || acceptanceCriteria !== current.acceptanceCriteria || referenceUrl !== current.referenceUrl || JSON.stringify(referenceLinks)!==JSON.stringify(current.referenceLinks||[]);
  const scheduleRequested = requestedPlannedStart !== undefined || requestedPlannedEnd !== undefined;
  const scheduleChanged = templateChanged || generateInitialPlan
    || Boolean(scheduleRequested && scheduleShift && scheduleShift.currentAnchor !== scheduleShift.targetAnchor);
  if (!informationChanged && !scheduleChanged) {
    getDatabaseContext().sqlite.transaction(() => {
      requirementOwner(current.projectId, ownerId, true);
      requireActiveProject(current.projectId, true);
      assertProjectManager(requireAuthorizationActor(actor), current.projectId);
    })();
    return current;
  }
  const now = nowIso();
  const auditAction = templateChanged ? 'apply_template' : 'update';
  const auditSummary = templateChanged ? `重选流程并重建计划：${title}`
    : requestedPlannedStart !== undefined || requestedPlannedEnd !== undefined ? `调整需求排期：${title}` : `更新需求：${title}`;
  getDatabaseContext().sqlite.transaction(() => {
    if (templateChanged && templateId) {
      const removedDependencies = rows(`SELECT * FROM dependency_edges WHERE source_work_item_id IN (SELECT id FROM work_items WHERE requirement_id=?) OR target_work_item_id IN (SELECT id FROM work_items WHERE requirement_id=?)`,id,id);
      getDatabaseContext().sqlite.prepare('DELETE FROM dependency_edges WHERE source_work_item_id IN (SELECT id FROM work_items WHERE requirement_id=?) OR target_work_item_id IN (SELECT id FROM work_items WHERE requirement_id=?)').run(id,id);
      getDatabaseContext().sqlite.prepare('UPDATE milestones SET legacy_work_item_id=NULL WHERE legacy_work_item_id IN (SELECT id FROM work_items WHERE requirement_id=?)').run(id);
      getDatabaseContext().sqlite.prepare('DELETE FROM work_items WHERE requirement_id=?').run(id);
      if(removedDependencies.length) audit(actor,'delete_dependencies','requirement',id,JSON.stringify({reason:'重新选择流程',removedDependencies}));
      const changed = getDatabaseContext().sqlite.prepare(`UPDATE requirements SET template_id=?, title=?, status='not_started', planned_start=?,
        planned_end=NULL, progress=0, risk_level='low', priority=?, owner_id=?, background=?, acceptance_criteria=?, reference_url=?,
        accepted_at=NULL, accepted_by_account_id=NULL,
        version=version+1, updated_at=? WHERE id=? AND version=?`)
        .run(templateId, title, nextPlannedStart, priority, ownerId, background, acceptanceCriteria, referenceUrl, now, id, current.version);
      assertVersionedWrite(changed, '需求');
      persistRequirementLinks(id,input,current);
      applyTemplateInternal(id, templateId, nextPlannedStart!);
      updateStoredRequirementSchedule(id);
      requirementOwner(current.projectId, ownerId, true);
      if (ownerId !== current.ownerId) validateDeliveryFields(current.projectId, { ownerId }, actor, current, true);
      requireActiveProject(current.projectId, true);
      assertProjectManager(requireAuthorizationActor(actor), current.projectId);
      audit(actor, auditAction, 'requirement', id, auditSummary);
      return;
    }
    if (scheduleShift) shiftRequirementWorkItems(id, scheduleShift.currentAnchor, scheduleShift.targetAnchor, now);
    const changed = getDatabaseContext().sqlite.prepare(`UPDATE requirements SET title=?, priority=?, owner_id=?, background=?, acceptance_criteria=?, reference_url=?,
      planned_start=?, version=version+1, updated_at=? WHERE id=? AND version=?`)
      .run(title, priority, ownerId, background, acceptanceCriteria, referenceUrl, nextPlannedStart, now, id, current.version);
    assertVersionedWrite(changed, '需求');
    persistRequirementLinks(id,input,current);
    if (generateInitialPlan) applyTemplateInternal(id, current.templateId!, nextPlannedStart!);
    if (requestedPlannedStart !== undefined || requestedPlannedEnd !== undefined) updateStoredRequirementSchedule(id);
    else if (ownerId !== current.ownerId) syncStoredRequirementState(id, now, false);
    requirementOwner(current.projectId, ownerId, true);
    if (ownerId !== current.ownerId) validateDeliveryFields(current.projectId, { ownerId }, actor, current, true);
    requireActiveProject(current.projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), current.projectId);
    audit(actor, auditAction, 'requirement', id, auditSummary);
  })();
  return getRequirement(id, false, !deferAnalysis);
}

export function updateRequirement(id: string, input: JsonObject, actor: Actor, deferAnalysis=false) {
  if (isTerminalRequirementStatus(getRequirement(id, false, !deferAnalysis).status)) return correctRequirement(id,input,actor);
  if(['phaseId','featureId','deliveryScope','executionMode','acceptanceOwnerId','durationDays','forecastEnd','unblockEstimate',...coordinationKeys].some(k=>input[k]!==undefined)||getRequirement(id, false, !deferAnalysis).executionMode==='direct')return updateDeliveryRequirement(id,input,actor,false,deferAnalysis);
  const commandFields = ['status', 'progress', 'acceptedAt', 'acceptedByAccountId', 'plannedStart', 'plannedEnd', 'scheduleMode', 'templateId', 'confirmTemplateReset'];
  if (commandFields.some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    fail('需求状态、进度、验收、排期和流程不能通过普通编辑修改，请使用对应操作命令');
  }
  if (Object.keys(input).some((key) => ![
    'expectedVersion', 'title', 'priority', 'ownerId', 'background', 'acceptanceCriteria', 'referenceUrl', 'referenceLinks', 'reason',
  ].includes(key))) fail('需求编辑不能提交未声明字段');
  return changeRequirement(id, input, actor, deferAnalysis);
}

export function correctRequirement(id: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => ![
    'phaseId','featureId','expectedVersion', 'reason', 'supersedesId', 'title', 'priority', 'ownerId',
    'background', 'acceptanceCriteria', 'referenceUrl', 'referenceLinks',
  ].includes(key))) fail('需求纠错不能提交未声明字段');
  const current = getRequirement(id);
  assertExpectedVersion(input, current.version);
  assertTransition(current.status, ['completed', 'cancelled'], '纠错');
  if (['status', 'progress', 'acceptedAt', 'acceptedByAccountId', 'plannedStart', 'plannedEnd', 'scheduleMode', 'templateId', 'confirmTemplateReset']
    .some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    fail('需求纠错只能修正基本信息，不能修改状态、进度、验收、排期或流程');
  }
  const reason = nullableText(input.reason) || describeChanges(current, input);
  const title = input.title === undefined ? current.title : requireLabel(input.title, '需求标题');
  const priority = input.priority === undefined ? current.priority : ensureEnum(input.priority, priorities, '优先级');
  const ownerId = input.ownerId === undefined ? current.ownerId : nullableText(input.ownerId);
  const background = input.background === undefined ? current.background : nullableText(input.background);
  const acceptanceCriteria = input.acceptanceCriteria === undefined ? current.acceptanceCriteria : nullableText(input.acceptanceCriteria);
  const referenceLinks = requirementReferenceLinks(input,current);
  const referenceUrl = referenceLinks[0]?.url||null;
  const hasExecution = current.workItems!.some((item) => item.status !== 'not_started' || item.progress > 0 || item.actualStart)
    || Boolean(row(`SELECT 1 FROM progress_updates WHERE requirement_id=? AND event_type NOT IN ('note','correction','cancel') LIMIT 1`, id));
  if (input.ownerId !== undefined && !ownerId && hasExecution) {
    fail('需求已有执行记录，只能更换负责人，不能清空负责人', 'DEPENDENCY_CONFLICT', 409);
  }
  const supersedesId = nullableText(input.supersedesId);
  if (supersedesId && !row('SELECT id FROM progress_updates WHERE id=? AND requirement_id=? AND work_item_id IS NULL', supersedesId, id)) {
    fail('纠错引用记录不存在或不是当前需求的需求级记录');
  }
  const factsChanged = (input.phaseId!==undefined&&(input.phaseId||null)!==(current.phaseId||null)) || (input.featureId!==undefined&&(input.featureId||null)!==(current.featureId||null))||title !== current.title || priority !== current.priority || ownerId !== current.ownerId
    || background !== current.background || acceptanceCriteria !== current.acceptanceCriteria || referenceUrl !== current.referenceUrl || JSON.stringify(referenceLinks)!==JSON.stringify(current.referenceLinks||[]);
  if (!factsChanged && !supersedesId) fail('没有需要纠错的需求信息，请修改字段或关联历史记录');
  const now = nowIso();
  getDatabaseContext().sqlite.transaction(() => {
    persistOrganization(id,current.projectId,input);
    const changed = getDatabaseContext().sqlite.prepare(`UPDATE requirements SET title=?, priority=?, owner_id=?, background=?, acceptance_criteria=?, reference_url=?,
      version=version+1, updated_at=? WHERE id=? AND version=? AND deleted_at IS NULL`).run(
      title, priority, ownerId, background, acceptanceCriteria, referenceUrl, now, id, current.version,
    );
    assertVersionedWrite(changed, '需求');
    persistRequirementLinks(id,input,current);
    appendRequirementEvent(id, 'correction', reason, actor, null, null, supersedesId, now);
    audit(actor, 'correct', 'requirement', id, JSON.stringify(changeSnapshot(current,{title,priority,ownerId,background,acceptanceCriteria,referenceUrl,referenceLinks,featureId:input.featureId===undefined?current.featureId:input.featureId,phaseId:input.phaseId===undefined?current.phaseId:input.phaseId},reason)));
    requireActiveProject(current.projectId, true);
    if (input.ownerId !== undefined && ownerId !== current.ownerId) assertHistoricalProjectPeople(current.projectId, [ownerId]);
    assertProjectManager(requireAuthorizationActor(actor), current.projectId);
  })();
  return getRequirement(id);
}

export function rescheduleRequirement(id: string, input: JsonObject, actor: Actor) {
  if(getRequirement(id).executionMode==='direct')return rescheduleDirectRequirement(id,input,actor);
  if (input.plannedStart === undefined && input.plannedEnd === undefined) fail('请设置计划开始或计划完成日期');
  if (['status', 'progress', 'acceptedAt', 'acceptedByAccountId', 'templateId', 'title', 'priority', 'ownerId', 'background', 'acceptanceCriteria', 'referenceUrl', 'referenceLinks']
    .some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    fail('排期命令不能修改需求信息、状态、进度、验收或流程');
  }
  if (Object.keys(input).some((key) => !['expectedVersion', 'scheduleMode', 'plannedStart', 'plannedEnd', 'reason'].includes(key))) {
    fail('排期命令不能提交未声明字段');
  }
  return changeRequirement(id, input, actor);
}

export function reselectRequirementTemplate(id: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => ![
    'templateId', 'expectedVersion', 'plannedStart', 'plannedEnd', 'scheduleMode', 'confirmTemplateReset', 'reason',
  ].includes(key))) fail('流程重选命令不能提交未声明字段');
  if (!nullableText(input.templateId)) fail('请选择要重新绑定的流程');
  if (['status', 'progress', 'acceptedAt', 'acceptedByAccountId', 'title', 'priority', 'ownerId', 'background', 'acceptanceCriteria', 'referenceUrl', 'referenceLinks']
    .some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    fail('流程重选命令不能修改需求信息、状态、进度或验收信息');
  }
  return changeRequirement(id, { ...input, confirmTemplateReset: true }, actor);
}

export function archiveRequirement(id: string, input: JsonObject, actor: Actor, deferAnalysis=false) {
  if (Object.keys(input).some((key) => key !== 'expectedVersion')) fail('归档命令不能提交无关的需求字段');
  const current = getRequirement(id, false, !deferAnalysis);
  assertExpectedVersion(input, current.version);
  if (!['completed', 'cancelled'].includes(current.status)) fail('需求必须先完成验收或取消，才能归档', 'DEPENDENCY_CONFLICT');
  const now = nextUpdatedAt(current.updatedAt);
  getDatabaseContext().sqlite.transaction(() => {
    const changed = getDatabaseContext().sqlite.prepare(`UPDATE requirements SET deleted_at=?, version=version+1, updated_at=?
      WHERE id=? AND version=? AND deleted_at IS NULL`).run(now, now, id, current.version);
    if (!changed.changes) fail('需求已被其他用户修改，请重新打开后再归档', 'STALE_WRITE', 409);
    const activeIssues = row<{ count: number }>(`SELECT COUNT(*) AS count FROM issues WHERE requirement_id=? AND status<>'resolved'`, id)?.count || 0;
    if (activeIssues) fail(`需求仍有${activeIssues}个未解决问题，不能归档`, 'DEPENDENCY_CONFLICT', 409, { issues: activeIssues });
    requireActiveProject(current.projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), current.projectId);
    audit(actor, 'archive', 'requirement', id, `归档需求：${current.title}`);
  })();
  return { ok: true };
}

export function acceptRequirement(id: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => key !== 'expectedVersion' && key !== 'content')) fail('验收命令不能提交无关的需求字段');
  assertRequirementAcceptor(id,actor);
  const current = getRequirement(id);
  assertExpectedVersion(input, current.version);
  assertTransition(current.status, ['pending_acceptance'], '验收');
  const content = requireText(input.content, '验收说明')+(current.acceptanceOwnerId&&current.acceptanceOwnerId!==requireAuthorizationActor(actor).personId?'；项目经理代验，指定验收人：'+(current.acceptanceOwnerName||current.acceptanceOwnerId):''); const now = nowIso();
  getDatabaseContext().sqlite.transaction(() => {
    if(getDatabaseContext().sqlite.prepare('SELECT 1 FROM milestones WHERE requirement_id=? AND achieved_at IS NULL AND cancelled=0 LIMIT 1').get(id))fail('尚有未达成里程碑，请先完成交付或确认里程碑');
    const changed = getDatabaseContext().sqlite.prepare(`UPDATE requirements SET status='completed', progress=100, accepted_at=?, accepted_by_account_id=?,
      version=version+1, updated_at=? WHERE id=? AND version=?`).run(now, actor.accountId || null, now, id, current.version);
    assertVersionedWrite(changed, '需求');
    appendRequirementEvent(id, 'accept', content, actor, null, null, null, now);
    audit(actor, 'accept', 'requirement', id, `验收需求：${current.title}`);settleMilestones(current.projectId,actor);
    requireActiveProject(current.projectId, true);
    assertRequirementAcceptor(id,actor);
  })();
  return getRequirement(id);
}

export function cancelRequirement(id: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => key !== 'expectedVersion' && key !== 'reason')) fail('取消命令不能提交无关的需求字段');
  const current = getRequirement(id);
  assertExpectedVersion(input, current.version);
  assertTransition(current.status, ['planning', 'not_started', 'in_progress', 'blocked', 'pending_acceptance'], '取消');
  const reason = nullableText(input.reason) || '取消需求'; const now = nowIso();
  getDatabaseContext().sqlite.transaction(() => {
    getDatabaseContext().sqlite.prepare(`UPDATE work_items SET status='cancelled', progress=min(progress,99), actual_end=NULL,
      blocked_at=NULL, blocked_reason=NULL, version=version+1, updated_at=?
      WHERE requirement_id=? AND status NOT IN ('completed','cancelled')`).run(now, id);
    const changed = getDatabaseContext().sqlite.prepare(`UPDATE requirements SET status='cancelled', accepted_at=NULL, accepted_by_account_id=NULL,
      version=version+1, updated_at=? WHERE id=? AND version=?`).run(now, id, current.version);
    assertVersionedWrite(changed, '需求');
    syncStoredRequirementState(id, now, false);
    appendRequirementEvent(id, 'cancel', reason, actor, null, null, null, now);
    audit(actor, 'cancel', 'requirement', id, `取消需求：${current.title}`);
    requireActiveProject(current.projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), current.projectId);
  })();
  return getRequirement(id);
}

export function restoreRequirement(id: string, actor: Actor, input: JsonObject = {}) {
  const current = row<{ projectId: string; version: number; deletedAt: string; updatedAt: string }>(
    'SELECT project_id AS projectId, version, deleted_at AS deletedAt, updated_at AS updatedAt FROM requirements WHERE id=? AND deleted_at IS NOT NULL', id,
  );
  if (!current) notFound('归档需求不存在');
  assertOptionalArchiveGeneration(input, current.deletedAt);
  const updatedAt = nextUpdatedAt(current.updatedAt);
  getDatabaseContext().sqlite.transaction(() => {
    const changed = getDatabaseContext().sqlite.prepare(`UPDATE requirements SET deleted_at=NULL, version=version+1, updated_at=?
      WHERE id=? AND version=? AND deleted_at=? AND updated_at=?`).run(updatedAt, id, current.version, current.deletedAt, current.updatedAt);
    if (!changed.changes) fail('归档需求已变化，请刷新后再恢复', 'STALE_WRITE', 409);
    requireActiveProject(current.projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), current.projectId);
    audit(actor, 'restore', 'requirement', id, '恢复需求');
  })();
  return getRequirement(id);
}

export function applyTemplate(requirementId: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => !['templateId', 'expectedVersion', 'reason'].includes(key))) {
    fail('补充流程命令不能提交未声明字段');
  }
  const requirement = getRequirement(requirementId);
  assertExpectedVersion(input, requirement.version);
  const templateId = requireText(input.templateId, '流程设计');
  if (['pending_acceptance', 'completed', 'cancelled'].includes(requirement.status)) fail('终态需求不能补充工作项', 'TERMINAL_LOCKED');
  if (!row('SELECT id FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL', templateId, requirement.projectId)) fail('流程设计不属于当前项目');
  const tx = getDatabaseContext().sqlite.transaction(() => {
    const added=applyTemplateInternal(requirementId, templateId, requirement.plannedStart||todayIso());
    if(!requirement.plannedStart){const clear=getDatabaseContext().sqlite.prepare('UPDATE work_items SET planned_start=NULL,planned_end=NULL WHERE id=?');for(const id of added)clear.run(id);}
    syncStoredRequirementState(requirementId, nowIso(), true, requirement.version);
    requireActiveProject(requirement.projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), requirement.projectId);
    audit(actor, 'apply_template', 'requirement', requirementId, '从模板补充工作项');
  });
  tx();
  return getRequirement(requirementId);
}

export function previewRequirementPlan(requirementId: string, input: JsonObject) {
  const requirement = getRequirement(requirementId, true);
  const templateId = requireText(input.templateId, '流程设计');
  if (!row('SELECT id FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL', templateId, requirement.projectId)) fail('流程设计不属于当前项目');
  const baseStart = requireDate(input.baseStart ?? requirement.plannedStart, '计划开始');
  if (businessDaysInclusive(baseStart, baseStart) !== 1) fail('计划开始需为工作日');
  const workItems = requirement.workItems || [];
  const entries = activeTemplateItems(templateId).map((item) => {
    const existing = workItems.find((work) => !isTerminalWorkItemStatus(work.status) && work.templateItemId === item.id)
      || workItems.find((work) => !isTerminalWorkItemStatus(work.status) && work.title === item.title)
      || workItems.find((work) => work.templateItemId === item.id)
      || workItems.find((work) => work.title === item.title);
    const terminal = Boolean(existing && ['completed', 'cancelled'].includes(existing.status));
    const proposed = plannedDatesFromOffset(baseStart, item.startOffsetDays, item.durationDays);
    return {
      templateItemId: item.id, workItemId: existing?.id || null, title: item.title,
      milestoneLabel: item.milestoneLabel,
      currentStart: existing?.plannedStart || null, currentEnd: existing?.plannedEnd || null,
      proposedStart: existing?.plannedStart || proposed.plannedStart, proposedEnd: existing?.plannedEnd || proposed.plannedEnd,
      willChange: !terminal && (!existing || !existing.plannedStart || !existing.plannedEnd),
      reason: terminal ? 'terminal' : !existing ? 'missing_item' : !existing.plannedStart || !existing.plannedEnd ? 'missing_plan' : 'unchanged',
    };
  });
  const pathRevision=row<{value:number}>('SELECT analysis_revision AS value FROM projects WHERE id=?',requirement.projectId)!.value;
  const templateUpdatedAt=row<{value:string}>('SELECT updated_at AS value FROM work_item_templates WHERE id=?',templateId)!.value;
  const preview = { requirementId, requirementVersion: requirement.version, pathRevision, templateUpdatedAt, asOfDate:todayIso(), templateId, baseStart, entries };
  // 校验实际展示的日期和流程内容，不持久化预览状态。
  const previewToken = createHash('sha256').update(JSON.stringify(preview)).digest('hex');
  return { ...preview, previewToken };
}

export function applyRequirementPlan(requirementId: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => ![
    'templateId', 'baseStart', 'expectedVersion', 'templateItemIds', 'reason', 'previewToken',
  ].includes(key))) fail('应用计划命令不能提交未声明字段');
  const requirement = getRequirement(requirementId);
  assertExpectedVersion(input, requirement.version);
  if (['pending_acceptance', 'completed', 'cancelled'].includes(requirement.status)) fail('终态需求不能修改工作计划', 'TERMINAL_LOCKED');
  const preview = previewRequirementPlan(requirementId, input);
  if (input.previewToken !== undefined && input.previewToken !== preview.previewToken) {
    fail('需求或流程已更新，原预览已失效，请重新预览后确认', 'STALE_WRITE', 409, undefined, requirement.version);
  }
  const selected = new Set(Array.isArray(input.templateItemIds) ? input.templateItemIds.map(String) : preview.entries.filter((item) => item.willChange).map((item) => item.templateItemId));
  for (const item of preview.entries) {
    if (selected.has(item.templateItemId) && item.willChange && item.proposedStart > item.proposedEnd) {
      fail(`工作项「${item.title}」补全后的开始日期晚于完成日期，请调整计划开始或先编辑该工作项`);
    }
  }
  const now = nowIso();
  const tx = getDatabaseContext().sqlite.transaction(() => {
    const createdIds:string[]=[];
    if(previewRequirementPlan(requirementId,input).previewToken!==preview.previewToken)fail('排期预览已失效，请重新预览','STALE_WRITE',409);
    let nextOrder = (row<{ maxOrder: number | null }>('SELECT MAX(sort_order) AS maxOrder FROM work_items WHERE requirement_id=?', requirementId)?.maxOrder ?? -1) + 1;
    for (const item of preview.entries) {
      if (!selected.has(item.templateItemId) || !item.willChange) continue;
      if (item.workItemId) {
        getDatabaseContext().sqlite.prepare(`UPDATE work_items SET duration_days=COALESCE(duration_days,?),progress_weight=COALESCE(progress_weight,?),planned_start=COALESCE(planned_start, ?), planned_end=COALESCE(planned_end, ?), version=version+1, updated_at=?
          WHERE id=? AND status NOT IN ('completed','cancelled')`)
          .run(businessDaysInclusive(item.proposedStart,item.proposedEnd)||null,businessDaysInclusive(item.proposedStart,item.proposedEnd)||1,item.proposedStart, item.proposedEnd, now, item.workItemId);
      } else {
        const createdId=randomUUID();createdIds.push(createdId);
        getDatabaseContext().sqlite.prepare(`INSERT INTO work_items
          (id, requirement_id, template_item_id, title, milestone_label, status, planned_start, planned_end, sort_order, created_at, updated_at,duration_days,progress_weight)
          VALUES (?, ?, ?, ?, ?, 'not_started', ?, ?, ?, ?, ?, ?, ?)`).run(
          createdId, requirementId, item.templateItemId, item.title, item.milestoneLabel, item.proposedStart, item.proposedEnd, nextOrder++, now, now,
          businessDaysInclusive(item.proposedStart,item.proposedEnd)||null,businessDaysInclusive(item.proposedStart,item.proposedEnd)||1,
        );
      }
    }
    instantiateTemplateGraph(requirementId,preview.templateId,createdIds,preview.baseStart);
    const changed = getDatabaseContext().sqlite.prepare('UPDATE requirements SET planned_start=?, version=version+1, updated_at=? WHERE id=? AND version=?')
      .run(preview.baseStart, now, requirementId, requirement.version);
    assertVersionedWrite(changed, '需求');
    syncStoredRequirementState(requirementId, now, false);
    requireActiveProject(requirement.projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), requirement.projectId);
    audit(actor, 'apply_plan', 'requirement', requirementId, `按模板补全计划：${selected.size}项`);
  });
  tx();
  return getRequirement(requirementId);
}
