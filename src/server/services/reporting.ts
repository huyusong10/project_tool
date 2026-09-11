import {
  addCalendarDays,
  businessDaysInclusive,
  requirementStatuses,
  riskLevels,
  todayIso,
} from '../../shared/domain';
import { listRequirements, requirementCompletionDate } from './requirements';
import { listIssues } from './issues';
import { rows } from './support';
import { fail } from '../errors';
import { isValidIsoDate } from '../../shared/workday';
import { getWorkItemCancellationDates } from './work-item-history';
import { dashboardOverview } from '../../shared/dashboard';

type PersonRow = { id: string; name: string; jobTitle: string | null };
type ConcurrencyItem = {
  id: string; title: string; personId: string; status: string;
  plannedStart: string | null; plannedEnd: string | null;
  actualStart: string | null; actualEnd: string | null; blockedAt: string | null;
  requirementId: string; requirementTitle: string; requirementStatus: string; updatedAt: string;
};
type EffectiveConcurrencyItem = ConcurrencyItem & { effectiveActualEnd: string };

export function getPeopleConcurrency(filters: { projectId?: string; personId?: string; jobTitle?: string; from?: string; to?: string; includeExternalAggregate?: boolean } = {}, asOfDate = todayIso()) {
  const from = filters.from || asOfDate; const to = filters.to || addCalendarDays(from, 6);
  if (!isValidIsoDate(from) || !isValidIsoDate(to) || from > to) fail('人员并发查询日期范围不合法');
  if (to > addCalendarDays(from, 1830)) fail('人员并发查询范围不能超过5年');
  const dates: string[] = [];
  for (let date = from; date <= to; date = addCalendarDays(date, 1)) if (businessDaysInclusive(date, date) === 1) dates.push(date);
  const where = ['p.deleted_at IS NULL', 'p.active=1']; const params: unknown[] = [];
  if (filters.personId) { where.push('p.id=?'); params.push(filters.personId); }
  if (filters.jobTitle) { where.push('p.job_title=?'); params.push(filters.jobTitle); }
  if (filters.projectId) {
    where.push('EXISTS (SELECT 1 FROM project_people pp WHERE pp.person_id=p.id AND pp.project_id=?)');
    params.push(filters.projectId);
  }
  const people = rows<PersonRow>(`SELECT p.id, p.name, p.job_title AS jobTitle FROM people p WHERE ${where.join(' AND ')} ORDER BY p.name`, ...params);
  const itemWhere = ['a.personId IS NOT NULL', 'r.deleted_at IS NULL', 'pr.deleted_at IS NULL']; const itemParams: unknown[] = [];
  if (filters.projectId) { itemWhere.push('r.project_id=?'); itemParams.push(filters.projectId); }
  const rawItems = rows<ConcurrencyItem>(`SELECT w.id, w.title, a.personId, w.status, w.planned_start AS plannedStart,
    w.planned_end AS plannedEnd, w.actual_start AS actualStart, w.actual_end AS actualEnd,
    w.blocked_at AS blockedAt, w.updated_at AS updatedAt, r.id AS requirementId, r.title AS requirementTitle,
    r.status AS requirementStatus
    FROM work_items w
    JOIN requirements r ON r.id=w.requirement_id
    JOIN projects pr ON pr.id=r.project_id
    JOIN (
      SELECT id AS workItemId, owner_id AS personId FROM work_items WHERE owner_id IS NOT NULL
      UNION
      SELECT work_item_id AS workItemId, person_id AS personId FROM work_item_collaborators
    ) a ON a.workItemId=w.id
    WHERE ${itemWhere.join(' AND ')}`, ...itemParams);
  const directWhere=["r.execution_mode='direct'",'r.owner_id IS NOT NULL','r.deleted_at IS NULL','pr.deleted_at IS NULL'];const directArgs:unknown[]=[];
  if(filters.projectId){directWhere.push('r.project_id=?');directArgs.push(filters.projectId);}
  const directItems=rows<ConcurrencyItem>(`SELECT r.id,r.title,r.owner_id AS personId,r.status,r.planned_start AS plannedStart,r.planned_end AS plannedEnd,r.actual_start AS actualStart,r.actual_end AS actualEnd,r.blocked_at AS blockedAt,r.updated_at AS updatedAt,r.id AS requirementId,r.title AS requirementTitle,r.status AS requirementStatus FROM requirements r JOIN projects pr ON pr.id=r.project_id WHERE ${directWhere.join(' AND ')}`,...directArgs);
  rawItems.push(...directItems);
  const cancellationDates = getWorkItemCancellationDates(
    rawItems,
    new Map(rawItems.map((item) => [item.requirementId, item.requirementStatus])),
  );
  const items = rawItems.map((item) => {
    if (item.status !== 'cancelled') return { ...item, effectiveActualEnd: item.actualEnd || asOfDate };
    return { ...item, effectiveActualEnd: cancellationDates.get(item.id)! };
  });
  const itemsByPerson = new Map<string, EffectiveConcurrencyItem[]>();
  for (const item of items) {
    const group = itemsByPerson.get(item.personId) || [];
    group.push(item);
    itemsByPerson.set(item.personId, group);
  }
  const externalCounts = new Map<string, number>();
  if (filters.projectId && filters.includeExternalAggregate) {
    const external = rows<{ personId: string; count: number }>(`SELECT a.personId, COUNT(DISTINCT w.id) AS count
      FROM work_items w JOIN requirements r ON r.id=w.requirement_id JOIN projects pr ON pr.id=r.project_id
      JOIN (
        SELECT id AS workItemId, owner_id AS personId FROM work_items WHERE owner_id IS NOT NULL
        UNION SELECT work_item_id AS workItemId, person_id AS personId FROM work_item_collaborators
      ) a ON a.workItemId=w.id
      WHERE r.project_id<>? AND r.deleted_at IS NULL AND pr.deleted_at IS NULL AND w.status NOT IN ('completed','cancelled')
        AND w.actual_start IS NOT NULL AND w.actual_start<=? AND (w.actual_end IS NULL OR w.actual_end>=?)
      GROUP BY a.personId`, filters.projectId, asOfDate, asOfDate);
    external.forEach((item) => externalCounts.set(item.personId, Number(item.count)));
    const directExternal=rows<{personId:string;count:number}>("SELECT r.owner_id AS personId,COUNT(*) AS count FROM requirements r JOIN projects p ON p.id=r.project_id WHERE r.project_id<>? AND r.execution_mode='direct' AND r.deleted_at IS NULL AND p.deleted_at IS NULL AND r.status IN ('in_progress','blocked') AND r.actual_start IS NOT NULL AND r.actual_start<=? GROUP BY r.owner_id",filters.projectId,asOfDate);
    for(const item of directExternal)externalCounts.set(item.personId,(externalCounts.get(item.personId)||0)+Number(item.count));
  }
  const result = people.map((person) => {
    const owned = itemsByPerson.get(person.id) || [];
    const days = dates.map((date) => {
      const plannedItems = owned.filter((item) => !['completed', 'cancelled', 'pending_acceptance'].includes(item.status) && item.plannedStart && item.plannedEnd && date >= item.plannedStart && date <= item.plannedEnd);
      const actualItems = owned.filter((item) => item.actualStart && date >= item.actualStart && date <= item.effectiveActualEnd);
      const selected = date <= asOfDate ? actualItems : plannedItems;
      return { date, count: selected.length, plannedCount: plannedItems.length, actualCount: actualItems.length, items: selected.map((item) => ({ id: item.id, title: item.title, requirementId: item.requirementId, requirementTitle: item.requirementTitle })) };
    });
    return {
      ...person,
      currentCount: days.find((day) => day.date === asOfDate)?.count || 0,
      externalCurrentCount: filters.includeExternalAggregate ? externalCounts.get(person.id) || 0 : undefined,
      peakCount: Math.max(0, ...days.map((day) => day.count)),
      days,
    };
  });
  return { asOfDate, from, to, dates, people: result, currentTop: [...result].filter((person) => person.currentCount > 0).sort((a, b) => b.currentCount - a.currentCount).slice(0, 5) };
}

export function getDashboard(projectId?: string, asOfDate = todayIso()) {
  const requirements = listRequirements({ projectId }, asOfDate);
  const recentProgress = rows<{ id: string; requirementId: string; workItemId: string | null; workItemTitle: string | null; percent: number; workItemPercent: number | null; content: string; eventType: string; createdAt: string; updatedAt: string }>(`
    SELECT id, requirementId, workItemId, workItemTitle, percent, workItemPercent, content, eventType, createdAt, updatedAt FROM (
      SELECT u.id, u.requirement_id AS requirementId, u.work_item_id AS workItemId,
        w.title AS workItemTitle, u.percent, u.work_item_percent AS workItemPercent, u.content, u.event_type AS eventType,
        u.created_at AS createdAt, u.updated_at AS updatedAt,
        u.rowid AS writeOrder,
        ROW_NUMBER() OVER (PARTITION BY u.requirement_id ORDER BY u.created_at DESC, u.rowid DESC) AS rank
      FROM progress_updates u
      LEFT JOIN work_items w ON w.id=u.work_item_id
      JOIN requirements r ON r.id=u.requirement_id
      WHERE r.deleted_at IS NULL ${projectId ? 'AND r.project_id=?' : ''}
    ) ranked WHERE rank<=3 ORDER BY createdAt DESC, writeOrder DESC`, ...(projectId ? [projectId] : []));
  const recentByRequirement = new Map<string, typeof recentProgress>();
  for (const update of recentProgress) recentByRequirement.set(update.requirementId, [...(recentByRequirement.get(update.requirementId) || []), update]);
  const requirementIssueCounts = rows<{ requirementId: string; active: number; overdue: number }>(`
    SELECT requirement_id AS requirementId, COUNT(*) AS active,
      SUM(CASE WHEN due_date IS NOT NULL AND business_day_delta(due_date, ?)>0 THEN 1 ELSE 0 END) AS overdue
    FROM issues
    WHERE requirement_id IS NOT NULL AND status<>'resolved' ${projectId ? 'AND project_id=?' : ''}
    GROUP BY requirement_id`, asOfDate, ...(projectId ? [projectId] : []));
  const issuesByRequirement = new Map(requirementIssueCounts.map((item) => [item.requirementId, {
    active: Number(item.active || 0), overdue: Number(item.overdue || 0),
  }]));
  const dashboardRequirements = requirements.map((item) => ({
    ...item,
    recentProgressUpdates: recentByRequirement.get(item.id) || [],
    issueSummary: issuesByRequirement.get(item.id) || { active: 0, overdue: 0 },
  }));
  const active = requirements.filter((item) => !['completed', 'cancelled'].includes(item.status)).length;
  const completed = requirements.filter((item) => item.status === 'completed').length;
  const delayed = requirements.filter((item) => item.delayed).length;
  const highRisk = requirements.filter((item) => item.highRisk).length;
  const completionRate = requirements.length ? Math.round((completed / requirements.length) * 1000) / 10 : 0;
  const statusCounts = new Map<string, number>();
  const riskCounts = new Map<string, number>();
  for (const requirement of requirements) {
    statusCounts.set(requirement.status, (statusCounts.get(requirement.status) || 0) + 1);
    if (requirement.riskEvaluated) riskCounts.set(requirement.riskLevel, (riskCounts.get(requirement.riskLevel) || 0) + 1);
  }
  const statuses = requirementStatuses.map((status) => ({ status, count: statusCounts.get(status) || 0 }));
  const risks = riskLevels.map((risk) => ({ risk, count: riskCounts.get(risk) || 0 }));
  const weeks: Array<{ week: string; completed: number }> = [];
  const monday = addCalendarDays(asOfDate, -((new Date(`${asOfDate}T00:00:00Z`).getUTCDay() + 6) % 7));
  const completionDates = requirements.map(requirementCompletionDate).filter((date): date is string => Boolean(date));
  for (let i = 11; i >= 0; i -= 1) {
    const start = addCalendarDays(monday, -i * 7);
    const end = addCalendarDays(start, 7);
    weeks.push({ week: `${Number(start.slice(5, 7))}/${Number(start.slice(8, 10))}`, completed: completionDates.filter((date) => date >= start && date < end).length });
  }
  const varianceTop = requirements.filter((item) => (item.finishVariance ?? 0) > 0).sort((a, b) => (b.finishVariance ?? 0) - (a.finishVariance ?? 0)).slice(0, 10)
    .map((item) => ({ id: item.id, title: item.title, variance: item.finishVariance }));
  const issuePage = listIssues({ projectId, scope: 'public', status: 'in_progress', page: 1, pageSize: 5 }, asOfDate);
  const attention = issuePage.items;
  return {
    asOfDate,
    summary: { total: requirements.length, active, completed, delayed, highRisk, completionRate },
    overview: dashboardOverview(requirements, asOfDate),
    requirements: dashboardRequirements,
    issues: { summary: issuePage.summary, attention },
    charts: { statuses, risks, weeks, varianceTop },
  };
}
