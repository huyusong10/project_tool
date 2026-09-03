import { sqlite } from '../database';
import { config } from '../config';
import { notFound } from '../errors';
import { calculateWorkItemGap, deriveRequirementMetrics, todayIso } from '../../shared/domain';

export type WorkItemRecord = {
  id: string; requirementId: string; templateItemId: string | null; title: string; ownerId: string | null; ownerName: string | null;
  status: string; plannedStart: string | null; plannedEnd: string | null; actualStart: string | null; actualEnd: string | null;
  forecastEnd: string | null; blockedAt: string | null; blockedReason: string | null; milestoneLabel: string | null; progress: number; sortOrder: number; version: number; createdAt: string; updatedAt: string;
  collaborators: Array<{ id: string; name: string; jobTitle: string | null }>;
  assigneeIds: string[]; assigneeNames: string[];
};

export type RequirementRecord = {
  id: string; projectId: string; projectName: string; templateId: string | null; templateName: string | null; title: string; ownerId: string | null; ownerName: string | null;
  status: string; plannedStart: string | null; plannedEnd: string | null; progress: number; plannedProgress?: number; progressGap?: number;
  asOfDate?: string;
  riskLevel: string; priority: string; acceptedAt: string | null; acceptedByAccountId: string | null; version: number; createdAt: string; updatedAt: string; deletedAt?: string | null; workItems?: WorkItemRecord[];
  delayed?: boolean; highRisk?: boolean; riskEvaluated?: boolean; riskReason?: string; finishVariance?: number; durationVariance?: number; effectiveEnd?: string | null;
  scheduleVarianceDays?: number | null; scheduleReferenceDate?: string | null;
};

export const requirementSelect = `SELECT r.id, r.project_id AS projectId, pr.name AS projectName,
  r.template_id AS templateId, t.name AS templateName, r.title,
  r.owner_id AS ownerId, p.name AS ownerName, r.status, r.planned_start AS plannedStart,
  r.planned_end AS plannedEnd, r.progress, r.risk_level AS riskLevel, r.priority,
  r.accepted_at AS acceptedAt, r.accepted_by_account_id AS acceptedByAccountId, r.version,
  r.created_at AS createdAt, r.updated_at AS updatedAt, r.deleted_at AS deletedAt
  FROM requirements r JOIN projects pr ON pr.id = r.project_id
  LEFT JOIN people p ON p.id = r.owner_id
  LEFT JOIN work_item_templates t ON t.id = r.template_id`;

export const workItemSelect = `SELECT w.id, w.requirement_id AS requirementId, w.template_item_id AS templateItemId,
  w.title, w.owner_id AS ownerId, p.name AS ownerName, w.status,
  w.planned_start AS plannedStart, w.planned_end AS plannedEnd,
  w.actual_start AS actualStart, w.actual_end AS actualEnd, w.forecast_end AS forecastEnd,
  w.blocked_at AS blockedAt, w.blocked_reason AS blockedReason, w.milestone_label AS milestoneLabel, w.progress,
  w.sort_order AS sortOrder, w.version, w.created_at AS createdAt, w.updated_at AS updatedAt
  FROM work_items w LEFT JOIN people p ON p.id = w.owner_id`;

type WorkItemRow = Omit<WorkItemRecord, 'collaborators' | 'assigneeIds' | 'assigneeNames'>;
type CollaboratorRow = { workItemId: string; id: string; name: string; jobTitle: string | null };

function rows<T>(sql: string, ...params: unknown[]) {
  return sqlite.prepare(sql).all(...params) as T[];
}

function row<T>(sql: string, ...params: unknown[]) {
  return sqlite.prepare(sql).get(...params) as T | undefined;
}

function getWorkItemsByRequirementIds(requirementIds: string[]): Map<string, WorkItemRecord[]> {
  const result = new Map(requirementIds.map((requirementId) => [requirementId, [] as WorkItemRecord[]]));
  if (!requirementIds.length) return result;

  const placeholders = requirementIds.map(() => '?').join(',');
  const items = rows<WorkItemRow>(
    `${workItemSelect} WHERE w.requirement_id IN (${placeholders}) ORDER BY w.requirement_id, w.sort_order, w.created_at`,
    ...requirementIds,
  );
  const collaborators = rows<CollaboratorRow>(`
    SELECT c.work_item_id AS workItemId, p.id, p.name, p.job_title AS jobTitle
    FROM work_item_collaborators c
    JOIN work_items w ON w.id=c.work_item_id
    JOIN people p ON p.id=c.person_id
    WHERE w.requirement_id IN (${placeholders}) ORDER BY c.work_item_id, p.name`, ...requirementIds);
  const collaboratorsByWorkItem = new Map<string, CollaboratorRow[]>();
  for (const collaborator of collaborators) {
    const group = collaboratorsByWorkItem.get(collaborator.workItemId) || [];
    group.push(collaborator);
    collaboratorsByWorkItem.set(collaborator.workItemId, group);
  }

  for (const item of items) {
    const itemCollaborators = (collaboratorsByWorkItem.get(item.id) || [])
      .filter((person) => person.id !== item.ownerId)
      .map(({ workItemId: _workItemId, ...person }) => person);
    result.get(item.requirementId)!.push({
      ...item,
      collaborators: itemCollaborators,
      assigneeIds: [item.ownerId, ...itemCollaborators.map((person) => person.id)].filter(Boolean) as string[],
      assigneeNames: [item.ownerName, ...itemCollaborators.map((person) => person.name)].filter(Boolean) as string[],
    });
  }
  return result;
}

export function getWorkItems(requirementId: string) {
  return getWorkItemsByRequirementIds([requirementId]).get(requirementId) || [];
}

function enrichRequirement(requirement: RequirementRecord, workItems: WorkItemRecord[], asOfDate: string): RequirementRecord {
  const metrics = deriveRequirementMetrics(requirement, workItems, asOfDate, config.highRiskDelayDays);
  const gaps = workItems.map((item) => calculateWorkItemGap(item));
  return {
    ...requirement, ...metrics, asOfDate,
    status: requirement.status, progress: requirement.progress, plannedEnd: requirement.plannedEnd,
    workItems,
    durationVariance: gaps.length ? Math.max(...gaps.map((gap) => gap.durationVariance), 0) : 0,
  };
}

export function listRequirements(filters: { projectId?: string; includeDeleted?: boolean; view?: string; status?: string } = {}) {
  const where = [filters.includeDeleted ? '1=1' : 'r.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (filters.projectId) { where.push('r.project_id=?'); params.push(filters.projectId); }
  const requirements = rows<RequirementRecord>(`${requirementSelect} WHERE ${where.join(' AND ')} ORDER BY r.updated_at DESC`, ...params);
  const workItemsByRequirement = getWorkItemsByRequirementIds(requirements.map((requirement) => requirement.id));
  const asOfDate = todayIso();
  let result = requirements.map((requirement) => enrichRequirement(requirement, workItemsByRequirement.get(requirement.id) || [], asOfDate));
  if (filters.status) result = result.filter((item) => item.status === filters.status);
  if (filters.view === 'delayed') result = result.filter((item) => item.delayed);
  if (filters.view === 'high_risk') result = result.filter((item) => item.highRisk);
  return result;
}

export function getRequirement(id: string, includeDeleted = false) {
  const requirement = row<RequirementRecord>(`${requirementSelect} WHERE r.id=? ${includeDeleted ? '' : 'AND r.deleted_at IS NULL'}`, id);
  if (!requirement) notFound('需求不存在');
  const result = enrichRequirement(requirement, getWorkItems(id), todayIso());
  const progressUpdates = rows(`SELECT u.id, u.requirement_id AS requirementId, u.work_item_id AS workItemId,
    w.title AS workItemTitle, u.percent, u.work_item_percent AS workItemPercent, u.content,
    u.event_type AS eventType, u.supersedes_id AS supersedesId, u.created_by_account_id AS createdByAccountId,
    a.username AS createdByName, u.created_at AS createdAt, u.updated_at AS updatedAt
    FROM progress_updates u LEFT JOIN work_items w ON w.id=u.work_item_id
    LEFT JOIN accounts a ON a.id=u.created_by_account_id
    WHERE u.requirement_id=? ORDER BY u.created_at DESC`, id);
  return { ...result, progressUpdates };
}
