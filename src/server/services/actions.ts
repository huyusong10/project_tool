import type { AuthorizationActor } from '../authorization';
import { canContributeProject, canManageProject } from '../authorization';
import { businessDayDelta, isOverdueByWorkday, todayIso } from '../../shared/domain';
import {
  actionReasonLabels,
  type ActionItem,
  type ActionItemsPage,
  type ActionReasonCode,
  type ActionSeverity,
} from '../../shared/action-items';
import { listRequirements, type RequirementRecord } from './requirements';
import { rows } from './support';

type Filters = {
  projectId: string;
  severity?: string;
  reason?: string;
  ownerId?: string;
  page?: number;
  pageSize?: number;
};

type WorkItemRow = {
  id: string; requirementId: string; requirementTitle: string; requirementOwnerId: string | null;
  title: string; ownerId: string | null; ownerName: string | null; status: string;
  plannedEnd: string | null; updatedAt: string; actorCollaborator: number;
};

type IssueRow = {
  id: string; requirementId: string | null; requirementTitle: string | null; requirementOwnerId: string | null;
  title: string; ownerId: string | null; ownerName: string | null; dueDate: string | null; updatedAt: string;
};

const reasonSeverity: Record<ActionReasonCode, ActionSeverity> = {
  planning: 'low',
  missing_owner: 'low',
  missing_work_items: 'low',
  incomplete_schedule: 'low',
  high_risk: 'high',
  delayed: 'high',
  pending_acceptance: 'medium',
  blocked: 'high',
  unassigned: 'medium',
  overdue: 'high',
};

const severityWeight: Record<ActionSeverity, number> = { high: 3, medium: 2, low: 1 };

export function deriveRequirementActionReasons(requirement: Pick<RequirementRecord,
  'status' | 'ownerId' | 'highRisk' | 'delayed' | 'workItems'>): ActionReasonCode[] {
  if (['completed', 'cancelled'].includes(requirement.status)) return [];
  const activeWorkItems = (requirement.workItems || []).filter((item) => item.status !== 'cancelled');
  const reasonCodes: ActionReasonCode[] = [];
  if (requirement.status === 'planning') reasonCodes.push('planning');
  if (!requirement.ownerId) reasonCodes.push('missing_owner');
  if (!activeWorkItems.length) reasonCodes.push('missing_work_items');
  else if (activeWorkItems.some((item) => !item.plannedStart || !item.plannedEnd)) reasonCodes.push('incomplete_schedule');
  if (requirement.highRisk) reasonCodes.push('high_risk');
  if (requirement.delayed) reasonCodes.push('delayed');
  if (requirement.status === 'pending_acceptance') reasonCodes.push('pending_acceptance');
  return reasonCodes;
}

export function deriveWorkItemActionReasons(workItem: { status: string; ownerId: string | null }): ActionReasonCode[] {
  if (['completed', 'cancelled'].includes(workItem.status)) return [];
  const reasonCodes: ActionReasonCode[] = [];
  if (workItem.status === 'blocked') reasonCodes.push('blocked');
  if (!workItem.ownerId) reasonCodes.push('unassigned');
  return reasonCodes;
}

function makeItem(input: Omit<ActionItem, 'id' | 'severity' | 'reasons' | 'reasonCodes'> & { reasonCodes: ActionReasonCode[] }): ActionItem {
  const reasonCodes = [...new Set(input.reasonCodes)];
  const severity = reasonCodes.reduce<ActionSeverity>(
    (current, reason) => severityWeight[reasonSeverity[reason]] > severityWeight[current] ? reasonSeverity[reason] : current,
    'low',
  );
  return {
    ...input,
    id: `${input.sourceType}:${input.sourceId}`,
    severity,
    reasonCodes,
    reasons: reasonCodes.map((code) => ({ code, label: actionReasonLabels[code] })),
  };
}

function emptyPage(page: number, pageSize: number, asOfDate: string): ActionItemsPage {
  return {
    asOfDate,
    items: [], total: 0, page, pageSize, pages: 0,
    ownerOptions: [], hasUnassigned: false,
    summary: { total: 0, high: 0, medium: 0, low: 0, byReason: {} },
  };
}

export function listActionItems(
  filters: Filters,
  actor: AuthorizationActor,
  loadedRequirements?: RequirementRecord[],
  asOfDate = todayIso(),
): ActionItemsPage {
  const requestedPage = Math.max(1, Math.trunc(Number(filters.page) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(Number(filters.pageSize) || 20)));
  const manager = canManageProject(actor, filters.projectId);
  if (!manager && !canContributeProject(actor, filters.projectId)) return emptyPage(1, pageSize, asOfDate);
  const personId = actor.personId;
  const today = asOfDate;
  const items: ActionItem[] = [];

  for (const requirement of loadedRequirements || listRequirements({ projectId: filters.projectId }, today)) {
    if (!manager && requirement.ownerId !== personId) continue;
    const reasonCodes = deriveRequirementActionReasons(requirement);
    if (!reasonCodes.length) continue;
    items.push(makeItem({
      sourceType: 'requirement', sourceId: requirement.id, projectId: requirement.projectId,
      requirementId: requirement.id, contextTitle: null, title: requirement.title, reasonCodes,
      ownerId: requirement.ownerId, ownerName: requirement.ownerName, dueDate: requirement.plannedEnd,
      overdueWorkdays: requirement.delayed ? Math.max(0, requirement.finishVariance || 0) : 0,
      targetPath: `/requirements/${requirement.id}`, updatedAt: requirement.updatedAt,
    }));
  }

  const workItems = rows<WorkItemRow>(`SELECT w.id, w.requirement_id AS requirementId, r.title AS requirementTitle,
    r.owner_id AS requirementOwnerId, w.title, w.owner_id AS ownerId, p.name AS ownerName, w.status,
    w.planned_end AS plannedEnd, w.updated_at AS updatedAt,
    CASE WHEN ? IS NOT NULL AND EXISTS (
      SELECT 1 FROM work_item_collaborators c WHERE c.work_item_id=w.id AND c.person_id=?
    ) THEN 1 ELSE 0 END AS actorCollaborator
    FROM work_items w JOIN requirements r ON r.id=w.requirement_id
    LEFT JOIN people p ON p.id=w.owner_id
    WHERE r.project_id=? AND r.deleted_at IS NULL AND r.status NOT IN ('completed','cancelled')
      AND w.status NOT IN ('completed','cancelled')`, personId, personId, filters.projectId);
  for (const workItem of workItems) {
    if (!manager && workItem.requirementOwnerId !== personId && workItem.ownerId !== personId && !workItem.actorCollaborator) continue;
    const reasonCodes = deriveWorkItemActionReasons(workItem);
    if (!reasonCodes.length) continue;
    items.push(makeItem({
      sourceType: 'work_item', sourceId: workItem.id, projectId: filters.projectId,
      requirementId: workItem.requirementId, contextTitle: workItem.requirementTitle, title: workItem.title,
      reasonCodes, ownerId: workItem.ownerId, ownerName: workItem.ownerName, dueDate: workItem.plannedEnd,
      overdueWorkdays: isOverdueByWorkday(workItem.plannedEnd, today)
        ? Math.max(0, businessDayDelta(workItem.plannedEnd, today)) : 0,
      targetPath: `/requirements/${workItem.requirementId}?workItemId=${encodeURIComponent(workItem.id)}`, updatedAt: workItem.updatedAt,
    }));
  }

  const issues = rows<IssueRow>(`SELECT i.id, i.requirement_id AS requirementId, r.title AS requirementTitle,
    r.owner_id AS requirementOwnerId, i.title, i.owner_id AS ownerId, p.name AS ownerName,
    i.due_date AS dueDate, i.updated_at AS updatedAt
    FROM issues i LEFT JOIN requirements r ON r.id=i.requirement_id
    LEFT JOIN people p ON p.id=i.owner_id
    WHERE i.project_id=? AND i.status<>'resolved'
      AND (i.requirement_id IS NULL OR r.deleted_at IS NULL)`, filters.projectId);
  for (const issue of issues) {
    if (!manager && issue.ownerId !== personId && issue.requirementOwnerId !== personId) continue;
    const reasonCodes: ActionReasonCode[] = [];
    if (isOverdueByWorkday(issue.dueDate, today)) reasonCodes.push('overdue');
    if (!issue.ownerId) reasonCodes.push('unassigned');
    if (!reasonCodes.length) continue;
    items.push(makeItem({
      sourceType: 'issue', sourceId: issue.id, projectId: filters.projectId,
      requirementId: issue.requirementId, contextTitle: issue.requirementTitle, title: issue.title,
      reasonCodes, ownerId: issue.ownerId, ownerName: issue.ownerName, dueDate: issue.dueDate,
      overdueWorkdays: isOverdueByWorkday(issue.dueDate, today) ? Math.max(0, businessDayDelta(issue.dueDate, today)) : 0,
      targetPath: `/issues?issueId=${encodeURIComponent(issue.id)}`, updatedAt: issue.updatedAt,
    }));
  }

  const byReason: Partial<Record<ActionReasonCode, number>> = {};
  for (const item of items) for (const reason of item.reasonCodes) byReason[reason] = (byReason[reason] || 0) + 1;
  const summary = {
    total: items.length,
    high: items.filter((item) => item.severity === 'high').length,
    medium: items.filter((item) => item.severity === 'medium').length,
    low: items.filter((item) => item.severity === 'low').length,
    byReason,
  };
  const ownerCounts = new Map<string, { id: string; name: string; count: number }>();
  for (const item of items) {
    if (!item.ownerId) continue;
    const current = ownerCounts.get(item.ownerId);
    if (current) current.count += 1;
    else ownerCounts.set(item.ownerId, {
      id: item.ownerId,
      name: item.ownerName || '历史负责人',
      count: 1,
    });
  }
  const ownerOptions = [...ownerCounts.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  const hasUnassigned = items.some((item) => !item.ownerId);

  let filtered = items;
  if (filters.severity) filtered = filtered.filter((item) => item.severity === filters.severity);
  if (filters.reason) filtered = filtered.filter((item) => item.reasonCodes.includes(filters.reason as ActionReasonCode));
  if (filters.ownerId) filtered = filtered.filter((item) => filters.ownerId === 'unassigned' ? !item.ownerId : item.ownerId === filters.ownerId);
  filtered.sort((left, right) => severityWeight[right.severity] - severityWeight[left.severity]
    || right.overdueWorkdays - left.overdueWorkdays
    || (left.dueDate || '9999-12-31').localeCompare(right.dueDate || '9999-12-31')
    || right.updatedAt.localeCompare(left.updatedAt)
    || left.id.localeCompare(right.id));

  const total = filtered.length;
  const pages = total ? Math.ceil(total / pageSize) : 0;
  const page = total ? Math.min(requestedPage, pages) : 1;
  const offset = (page - 1) * pageSize;
  return {
    asOfDate,
    items: filtered.slice(offset, offset + pageSize), total, page, pageSize,
    pages,
    ownerOptions,
    hasUnassigned,
    summary,
  };
}
