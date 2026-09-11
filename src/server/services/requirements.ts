import {nodeForecastBasis} from '../../shared/forecast-basis';
import {type DeliveryFields,type ProcessingResult,deliveryReadiness,processingPriority} from '../../shared/delivery';
import { sqlite } from '../database';
import { config } from '../config';
import { notFound } from '../errors';
import { businessDateFromDateTime, calculateWorkItemGap, deriveRequirementMetrics, todayIso } from '../../shared/domain';
import { getCancellationHistory } from './work-item-history';
import { chunkValues } from './support';
import { getPathAnalysis, startConditions } from './paths';
import type { PathRisk } from '../../shared/paths';

export type WorkItemRecord = import('../../shared/forecast-basis').ExecutionMetadata & {
  durationDays?:number|null;
  dependencyRevision?:number; unmetPredecessors?:Array<{id:string;title:string}>;
  id: string; requirementId: string; templateItemId: string | null; title: string; ownerId: string | null; ownerName: string | null;
  status: string; plannedStart: string | null; plannedEnd: string | null; actualStart: string | null; actualEnd: string | null;
  cancelledAt?: string | null;
  forecastEnd: string | null; blockedAt: string | null; blockedReason: string | null; milestoneLabel: string | null; progress: number; sortOrder: number; version: number; createdAt: string; updatedAt: string;
  collaborators: Array<{ id: string; name: string; jobTitle: string | null }>;
  assigneeIds: string[]; assigneeNames: string[];
};

export type RequirementRecord = DeliveryFields & import('../../shared/intake').Organization & Partial<ProcessingResult> & {
  readinessIssues?:string[];
  pathRisk?: PathRisk; pathEnabled?:number;
  id: string; projectId: string; projectName: string; templateId: string | null; templateName: string | null; title: string; ownerId: string | null; ownerName: string | null;
  background: string | null; acceptanceCriteria: string | null; referenceUrl: string | null; sourceNotes?: string | null;
  status: string; plannedStart: string | null; plannedEnd: string | null; progress: number; plannedProgress?: number | null; progressGap?: number;
  scheduleComplete?: boolean;
  asOfDate?: string;
  actualStart?: string | null; actualEnd?: string | null;
  riskLevel: string; priority: string; acceptedAt: string | null; acceptedByAccountId: string | null; version: number; createdAt: string; updatedAt: string; deletedAt?: string | null; workItems?: WorkItemRecord[];
  delayed?: boolean; highRisk?: boolean; riskEvaluated?: boolean; riskReason?: string; finishVariance?: number; durationVariance?: number; effectiveEnd?: string | null;
  scheduleVarianceDays?: number | null; scheduleReferenceDate?: string | null;
  issueSummary?: { active: number; overdue: number };
};

export const requirementSelect = `SELECT EXISTS(SELECT 1 FROM project_people op JOIN accounts oa ON oa.person_id=op.person_id JOIN people person ON person.id=op.person_id WHERE op.project_id=r.project_id AND op.person_id=r.owner_id AND op.project_role IN ('member','manager') AND oa.status='active' AND oa.deleted_at IS NULL AND person.active=1 AND person.deleted_at IS NULL) AS ownerValid,r.delivery_scope AS deliveryScope,r.execution_mode AS executionMode,r.acceptance_owner_id AS acceptanceOwnerId,
    r.forecast_review AS forecastReview,r.blocked_coordinator_id AS blockedCoordinatorId,r.blocked_next_review_at AS blockedNextReviewAt,r.blocked_issue_id AS blockedIssueId,r.actual_start AS actualStart,r.actual_end AS actualEnd,r.blocked_at AS blockedAt,r.blocked_reason AS blockedReason,
    r.forecast_duration AS forecastDuration,r.forecast_ready_at AS forecastReadyAt,r.duration_days AS durationDays,r.forecast_end AS forecastEnd,r.unblock_estimate AS unblockEstimate,r.split_base_progress AS splitBaseProgress,r.split_at AS splitAt,
    (SELECT name FROM people WHERE id=r.acceptance_owner_id) AS acceptanceOwnerName,
    EXISTS(SELECT 1 FROM project_people ap JOIN accounts aa ON aa.person_id=ap.person_id JOIN people person ON person.id=ap.person_id WHERE ap.project_id=r.project_id AND ap.person_id=r.acceptance_owner_id AND ap.project_role IN ('member','manager') AND aa.status='active' AND aa.deleted_at IS NULL AND person.active=1 AND person.deleted_at IS NULL) AS acceptanceOwnerValid,r.id, r.project_id AS projectId, pr.name AS projectName,
  r.template_id AS templateId, t.name AS templateName, r.title,
  r.background, r.source_notes AS sourceNotes, r.acceptance_criteria AS acceptanceCriteria, r.reference_url AS referenceUrl, r.group_id AS groupId,(SELECT name FROM requirement_groups WHERE id=r.group_id) AS groupName,
  r.owner_id AS ownerId, p.name AS ownerName, r.status, r.planned_start AS plannedStart,
  r.planned_end AS plannedEnd, r.progress, r.risk_level AS riskLevel, r.priority,
  r.accepted_at AS acceptedAt, r.accepted_by_account_id AS acceptedByAccountId, r.version,
  r.created_at AS createdAt, r.updated_at AS updatedAt, r.deleted_at AS deletedAt,
  (EXISTS(SELECT 1 FROM requirements reviewed WHERE reviewed.project_id=r.project_id AND reviewed.dependencies_reviewed_at IS NOT NULL) OR EXISTS(SELECT 1 FROM dependency_edges dep WHERE dep.project_id=r.project_id)) AS pathEnabled
  FROM requirements r JOIN projects pr ON pr.id = r.project_id
  LEFT JOIN people p ON p.id = r.owner_id
  LEFT JOIN work_item_templates t ON t.id = r.template_id`;

export function requirementCompletionDate(requirement: RequirementRecord) {
  if (requirement.status !== 'completed') return null;
  return requirement.executionCompletedAt || requirement.actualEnd || requirement.effectiveEnd || null;
}

export const workItemSelect = `SELECT w.duration_days AS durationDays,w.id, w.requirement_id AS requirementId, w.template_item_id AS templateItemId,
  w.title, w.owner_id AS ownerId, p.name AS ownerName, w.status,
  w.planned_start AS plannedStart, w.planned_end AS plannedEnd,
  w.forecast_review AS forecastReview,w.blocked_coordinator_id AS blockedCoordinatorId,w.blocked_next_review_at AS blockedNextReviewAt,w.blocked_issue_id AS blockedIssueId,w.actual_start AS actualStart, w.actual_end AS actualEnd, w.forecast_end AS forecastEnd,
  w.blocked_at AS blockedAt, w.blocked_reason AS blockedReason, w.milestone_label AS milestoneLabel, w.progress,
  w.sort_order AS sortOrder, w.version, w.created_at AS createdAt, w.updated_at AS updatedAt,
  (w.status='not_started' AND EXISTS(SELECT 1 FROM dependency_edges dep WHERE dep.target_requirement_id=w.requirement_id)) AS hasDependencies
  FROM work_items w LEFT JOIN people p ON p.id = w.owner_id`;

type WorkItemRow = Omit<WorkItemRecord, 'collaborators' | 'assigneeIds' | 'assigneeNames'> & {hasDependencies:number};
type CollaboratorRow = { workItemId: string; id: string; name: string; jobTitle: string | null };

function rows<T>(sql: string, ...params: unknown[]) {
  return sqlite.prepare(sql).all(...params) as T[];
}

function row<T>(sql: string, ...params: unknown[]) {
  return sqlite.prepare(sql).get(...params) as T | undefined;
}

export function loadWorkItemsByRequirementIds(requirementIds: string[], requirementStatuses?: ReadonlyMap<string, string>) {
  const result = new Map(requirementIds.map((requirementId) => [requirementId, [] as WorkItemRecord[]]));
  if (!requirementIds.length) return { workItems: result, requirementCancellationDates: new Map<string, string>() };

  const batches = chunkValues(requirementIds);
  const items = batches.flatMap((batch) => {
    const placeholders = batch.map(() => '?').join(',');
    return rows<WorkItemRow>(
      `${workItemSelect} WHERE w.requirement_id IN (${placeholders}) ORDER BY w.requirement_id, w.sort_order, w.created_at`,
      ...batch,
    );
  });
  const collaborators = batches.flatMap((batch) => {
    const placeholders = batch.map(() => '?').join(',');
    return rows<CollaboratorRow>(`
      SELECT c.work_item_id AS workItemId, p.id, p.name, p.job_title AS jobTitle
      FROM work_item_collaborators c
      JOIN work_items w ON w.id=c.work_item_id
      JOIN people p ON p.id=c.person_id
      WHERE w.requirement_id IN (${placeholders}) ORDER BY c.work_item_id, p.name`, ...batch);
  });
  const collaboratorsByWorkItem = new Map<string, CollaboratorRow[]>();
  for (const collaborator of collaborators) {
    const group = collaboratorsByWorkItem.get(collaborator.workItemId) || [];
    group.push(collaborator);
    collaboratorsByWorkItem.set(collaborator.workItemId, group);
  }
  const cancelledRequirements = requirementStatuses
    ? requirementIds.filter((requirementId) => requirementStatuses.get(requirementId) === 'cancelled')
    : [];
  const cancellationHistory = getCancellationHistory(items, requirementStatuses, cancelledRequirements);

  const conditionReqIds=[...new Set(items.filter(i=>i.hasDependencies).map(i=>i.requirementId))];
  const conditions=new Map(conditionReqIds.flatMap((_,i)=>i%200===0?[...startConditions(conditionReqIds.slice(i,i+200))]:[]));
  for (const {hasDependencies:_hasDependencies,...item} of items) {
    const itemCollaborators = (collaboratorsByWorkItem.get(item.id) || [])
      .filter((person) => person.id !== item.ownerId)
      .map(({ workItemId: _workItemId, ...person }) => person);
    result.get(item.requirementId)!.push({
      ...item,forecastReview:item.forecastReview?JSON.parse(String(item.forecastReview)):null,
      ...conditions.get(item.id),
      cancelledAt: cancellationHistory.workItemDates.get(item.id) || null,
      collaborators: itemCollaborators,
      assigneeIds: [item.ownerId, ...itemCollaborators.map((person) => person.id)].filter(Boolean) as string[],
      assigneeNames: [item.ownerName, ...itemCollaborators.map((person) => person.name)].filter(Boolean) as string[],
    });
  }
  return { workItems: result, requirementCancellationDates: cancellationHistory.requirementDates };
}

export function getWorkItems(requirementId: string) {
  return loadWorkItemsByRequirementIds([requirementId]).workItems.get(requirementId) || [];
}

function requirementActualRange(requirement: RequirementRecord, workItems: WorkItemRecord[], asOfDate: string, cancelledAt?: string) {
  const activeItems = workItems.filter(item => item.status !== 'cancelled');
  const actualStart = [requirement.actualStart, ...workItems.map(item => item.actualStart)]
    .filter((date): date is string => Boolean(date)).sort()[0] || null;
  const completed = requirement.status === 'completed';
  const actualEnd = !completed ? null : requirement.executionMode === 'direct'
    ? requirement.actualEnd || null
    : activeItems.length && activeItems.every(item => item.status === 'completed' && item.actualEnd)
      ? activeItems.map(item => item.actualEnd!).sort().at(-1)! : null;
  const cancellationDate = requirement.status === 'cancelled'
    ? cancelledAt || businessDateFromDateTime(requirement.updatedAt) : null;
  const observationEnd = !actualStart ? null : completed ? actualEnd : cancellationDate
    ? cancellationDate < actualStart ? actualStart : cancellationDate : asOfDate;
  return { actualStart, actualEnd, observationEnd };
}

function enrichRequirement(requirement: RequirementRecord, workItems: WorkItemRecord[], asOfDate: string, cancelledAt?: string): RequirementRecord {

  const metrics = deriveRequirementMetrics(requirement, workItems, asOfDate, config.highRiskDelayDays);
  const actualRange = requirementActualRange({...requirement, status: metrics.status}, workItems, asOfDate, cancelledAt);
  const gaps = workItems.map((item) => calculateWorkItemGap(item, asOfDate));
  const {pathEnabled:_pathEnabled,...value}=requirement;
  return {
    ...value, forecastReview:value.forecastReview?JSON.parse(String(value.forecastReview)):null,
    ...metrics, ...actualRange, executionCompletedAt: actualRange.actualEnd, asOfDate,
    readinessIssues:deliveryReadiness({...requirement,...metrics},workItems,metrics.scheduleComplete),
    workItems,
    durationVariance: gaps.length ? Math.max(...gaps.map((gap) => gap.durationVariance), 0) : 0,
  };
}

export const requirementAnalysisSnapshots=new WeakMap<RequirementRecord[],Map<string,import('../../shared/paths').PathAnalysis>>();
export function listRequirements(filters: { groupId?:string;deliveryScope?:'committed'|'candidate';projectId?: string; ownerId?: string; includeDeleted?: boolean; view?: string; status?: string } = {}, asOfDate = todayIso()) {
  const where = [filters.includeDeleted ? '1=1' : 'r.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (filters.projectId) { where.push('r.project_id=?'); params.push(filters.projectId); }
  if (filters.ownerId) { where.push('r.owner_id=?'); params.push(filters.ownerId); }
  const requirements = rows<RequirementRecord>(`${requirementSelect} WHERE ${where.join(' AND ')} ORDER BY r.updated_at DESC`, ...params);
  const loadedWorkItems = loadWorkItemsByRequirementIds(
    requirements.map((requirement) => requirement.id),
    new Map(requirements.map((requirement) => [requirement.id, requirement.status])),
  );
  let result = requirements.map((requirement) => enrichRequirement(
    requirement,
    loadedWorkItems.workItems.get(requirement.id) || [],
    asOfDate,
    loadedWorkItems.requirementCancellationDates.get(requirement.id),
  ));
  const analyses = new Map([...new Set(requirements.map(r => r.projectId))].map(projectId => [projectId, getPathAnalysis(projectId, undefined, asOfDate)]));
  result = result.map(r => {
    const analysis=analyses.get(r.projectId)!,facts=analysis.requirements.find(n=>n.id===r.id);r.forecastBasis=nodeForecastBasis(analysis.nodes,r.id);r.blockerCoordination=analysis.nodes.find(n=>n.id==='execute:'+r.id)?.blockerCoordination;r.commitment=facts?.commitment;Object.assign(r,{executionForecastEnd:facts?.executionForecastEnd,acceptanceForecastEnd:facts?.acceptanceForecastEnd,acceptanceAssumed:facts?.acceptanceAssumed});
    for(const w of r.workItems||[])Object.assign(w,{forecastBasis:analysis.nodes.find(n=>n.id===w.id)?.forecastBasis,blockerCoordination:analysis.nodes.find(n=>n.id===w.id)?.blockerCoordination});
    const pathRisk = analyses.get(r.projectId)?.risks[r.id];
    return pathRisk ? { ...r, ...pathRisk, pathRisk } : {...r,...processingPriority(r,asOfDate)};
  });
  if(filters.groupId!==undefined)result=result.filter(r=>(r.groupId||'')===filters.groupId);
  if(filters.deliveryScope)result=result.filter(r=>r.deliveryScope===filters.deliveryScope);
  if (filters.status) result = result.filter((item) => item.status === filters.status);
  if (filters.view === 'delayed') result = result.filter((item) => item.delayed);
  if (filters.view === 'high_risk') result = result.filter((item) => item.highRisk);
  requirementAnalysisSnapshots.set(result,analyses);
  return result;
}

/** Batch writers read execution facts while their final dependency network is still being assembled. */
export function getRequirement(id: string, includeDeleted = false, withPathAnalysis = true) {
  const requirement = row<RequirementRecord>(`${requirementSelect} WHERE r.id=? ${includeDeleted ? '' : 'AND r.deleted_at IS NULL'}`, id);
  if (!requirement) notFound('需求不存在');
  const asOfDate = todayIso();
  const loadedWorkItems = loadWorkItemsByRequirementIds([id], new Map([[id, requirement.status]]));
  const result = enrichRequirement(
    requirement,
    loadedWorkItems.workItems.get(id) || [],
    asOfDate,
    loadedWorkItems.requirementCancellationDates.get(id),
  );
  const progressUpdates = rows(`SELECT u.id, u.requirement_id AS requirementId, u.work_item_id AS workItemId,
    w.title AS workItemTitle, u.percent, u.work_item_percent AS workItemPercent, u.content,
    u.event_type AS eventType, u.supersedes_id AS supersedesId, u.created_by_account_id AS createdByAccountId,
    a.username AS createdByName, u.created_at AS createdAt, u.updated_at AS updatedAt
    FROM progress_updates u LEFT JOIN work_items w ON w.id=u.work_item_id
    LEFT JOIN accounts a ON a.id=u.created_by_account_id
    WHERE u.requirement_id=? ORDER BY u.created_at DESC, u.rowid DESC`, id);
  const issueCounts = row<{ active: number; overdue: number }>(`SELECT COUNT(*) AS active,
    COALESCE(SUM(CASE WHEN due_date IS NOT NULL AND business_day_delta(due_date, ?)>0 THEN 1 ELSE 0 END), 0) AS overdue
    FROM issues WHERE requirement_id=? AND status<>'resolved'`, asOfDate, id) || { active: 0, overdue: 0 };
  const issueSummary = { active: Number(issueCounts.active || 0), overdue: Number(issueCounts.overdue || 0) };
  const pathAnalysis = withPathAnalysis ? getPathAnalysis(requirement.projectId, undefined, asOfDate) : undefined,pathRisk=pathAnalysis?.risks[id];
  const milestones=rows<import('../../shared/paths').PathMilestone>('SELECT id,project_id AS projectId,requirement_id AS requirementId,title,target_date AS targetDate,confirmation_mode AS confirmationMode,achieved_at AS achievedAt,version,cancelled FROM milestones WHERE requirement_id=?',id);
  for(const m of milestones)m.forecastEnd=pathAnalysis?.nodes.find(n=>n.id===m.id)?.forecastEnd||null;
  if(pathAnalysis){
    result.forecastBasis=nodeForecastBasis(pathAnalysis.nodes,id);result.blockerCoordination=pathAnalysis.nodes.find(n=>n.id==='execute:'+id)?.blockerCoordination;result.commitment=pathAnalysis.requirements.find(n=>n.id===id)?.commitment;
    const facts=pathAnalysis.requirements.find(n=>n.id===id);Object.assign(result,{executionForecastEnd:facts?.executionForecastEnd,acceptanceForecastEnd:facts?.acceptanceForecastEnd,acceptanceAssumed:facts?.acceptanceAssumed});
    for(const w of result.workItems||[])Object.assign(w,{forecastBasis:pathAnalysis.nodes.find(n=>n.id===w.id)?.forecastBasis,blockerCoordination:pathAnalysis.nodes.find(n=>n.id===w.id)?.blockerCoordination});
  }
  return { ...result,milestones, ...(pathRisk ? { ...pathRisk, pathRisk } : {}), progressUpdates, issueSummary };
}
