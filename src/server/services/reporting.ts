import {
  addCalendarDays,
  businessDaysInclusive,
  deriveWorkItemStatus,
  requirementStatuses,
  riskLevels,
  todayIso,
} from '../../shared/domain';
import { listRequirements } from './requirements';
import { listIssues } from './issues';
import { rows } from './support';
import { fail } from '../errors';
import { isValidIsoDate } from '../../shared/workday';

type PersonRow = { id: string; name: string; jobTitle: string | null };
type ConcurrencyItem = {
  id: string; title: string; personId: string; status: string;
  plannedStart: string | null; plannedEnd: string | null;
  actualStart: string | null; actualEnd: string | null; blockedAt: string | null;
  requirementId: string; requirementTitle: string;
};

export function getPeopleConcurrency(filters: { projectId?: string; personId?: string; jobTitle?: string; from?: string; to?: string; includeExternalAggregate?: boolean } = {}) {
  const from = filters.from || todayIso(); const to = filters.to || addCalendarDays(from, 6);
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
  const items = rows<ConcurrencyItem>(`SELECT w.id, w.title, a.personId, w.status, w.planned_start AS plannedStart,
    w.planned_end AS plannedEnd, w.actual_start AS actualStart, w.actual_end AS actualEnd,
    w.blocked_at AS blockedAt, r.id AS requirementId, r.title AS requirementTitle
    FROM work_items w
    JOIN requirements r ON r.id=w.requirement_id
    JOIN projects pr ON pr.id=r.project_id
    JOIN (
      SELECT id AS workItemId, owner_id AS personId FROM work_items WHERE owner_id IS NOT NULL
      UNION
      SELECT work_item_id AS workItemId, person_id AS personId FROM work_item_collaborators
    ) a ON a.workItemId=w.id
    WHERE ${itemWhere.join(' AND ')}`, ...itemParams)
    .filter((item) => deriveWorkItemStatus(item) !== 'cancelled');
  const itemsByPerson = new Map<string, ConcurrencyItem[]>();
  for (const item of items) {
    const group = itemsByPerson.get(item.personId) || [];
    group.push(item);
    itemsByPerson.set(item.personId, group);
  }
  const today = todayIso();
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
      GROUP BY a.personId`, filters.projectId, today, today);
    external.forEach((item) => externalCounts.set(item.personId, Number(item.count)));
  }
  const result = people.map((person) => {
    const owned = itemsByPerson.get(person.id) || [];
    const days = dates.map((date) => {
      const plannedItems = owned.filter((item) => item.status !== 'completed' && item.plannedStart && item.plannedEnd && date >= item.plannedStart && date <= item.plannedEnd);
      const actualItems = owned.filter((item) => item.actualStart && date >= item.actualStart && date <= (item.actualEnd || today));
      const selected = date <= today ? actualItems : plannedItems;
      return { date, count: selected.length, plannedCount: plannedItems.length, actualCount: actualItems.length, items: selected.map((item) => ({ id: item.id, title: item.title, requirementId: item.requirementId, requirementTitle: item.requirementTitle })) };
    });
    return {
      ...person,
      currentCount: days.find((day) => day.date === today)?.count || 0,
      externalCurrentCount: filters.includeExternalAggregate ? externalCounts.get(person.id) || 0 : undefined,
      peakCount: Math.max(0, ...days.map((day) => day.count)),
      days,
    };
  });
  return { from, to, dates, people: result, currentTop: [...result].filter((person) => person.currentCount > 0).sort((a, b) => b.currentCount - a.currentCount).slice(0, 5) };
}

export function getDashboard(projectId?: string) {
  const requirements = listRequirements({ projectId });
  const recentProgress = rows<{ id: string; requirementId: string; workItemId: string | null; workItemTitle: string | null; percent: number; content: string; createdAt: string; updatedAt: string }>(`
    SELECT id, requirementId, workItemId, workItemTitle, percent, content, createdAt, updatedAt FROM (
      SELECT u.id, u.requirement_id AS requirementId, u.work_item_id AS workItemId,
        w.title AS workItemTitle, u.percent, u.content, u.created_at AS createdAt, u.updated_at AS updatedAt,
        ROW_NUMBER() OVER (PARTITION BY u.requirement_id ORDER BY u.created_at DESC, u.id DESC) AS rank
      FROM progress_updates u
      LEFT JOIN work_items w ON w.id=u.work_item_id
      JOIN requirements r ON r.id=u.requirement_id
      WHERE r.deleted_at IS NULL ${projectId ? 'AND r.project_id=?' : ''}
    ) ranked WHERE rank<=3 ORDER BY createdAt DESC`, ...(projectId ? [projectId] : []));
  const recentByRequirement = new Map<string, typeof recentProgress>();
  for (const update of recentProgress) recentByRequirement.set(update.requirementId, [...(recentByRequirement.get(update.requirementId) || []), update]);
  const requirementIssueCounts = rows<{ requirementId: string; active: number; overdue: number }>(`
    SELECT requirement_id AS requirementId, COUNT(*) AS active,
      SUM(CASE WHEN due_date IS NOT NULL AND business_day_delta(due_date, ?)>0 THEN 1 ELSE 0 END) AS overdue
    FROM issues
    WHERE requirement_id IS NOT NULL AND status<>'resolved' ${projectId ? 'AND project_id=?' : ''}
    GROUP BY requirement_id`, todayIso(), ...(projectId ? [projectId] : []));
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
  const weeks: Array<{ week: string; completed: number }> = []; const now = new Date();
  for (let i = 11; i >= 0; i -= 1) {
    const start = new Date(now); start.setDate(now.getDate() - now.getDay() - i * 7 + 1); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(start.getDate() + 7);
    weeks.push({ week: `${start.getMonth() + 1}/${start.getDate()}`, completed: requirements.filter((item) => item.status === 'completed' && new Date(item.updatedAt) >= start && new Date(item.updatedAt) < end).length });
  }
  const varianceTop = requirements.filter((item) => (item.finishVariance ?? 0) > 0).sort((a, b) => (b.finishVariance ?? 0) - (a.finishVariance ?? 0)).slice(0, 10)
    .map((item) => ({ id: item.id, title: item.title, variance: item.finishVariance }));
  const issuePage = listIssues({ projectId, scope: 'public', page: 1, pageSize: 10 });
  const attention = issuePage.items.filter((item) => item.status === 'in_progress').slice(0, 5);
  return {
    summary: { total: requirements.length, active, completed, delayed, highRisk, completionRate },
    requirements: dashboardRequirements,
    issues: { summary: issuePage.summary, attention },
    charts: { statuses, risks, weeks, varianceTop },
  };
}
