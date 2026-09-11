import { addBusinessDays, addCalendarDays, businessDateFromDateTime } from './domain';
import { isValidIsoDate } from './workday';

export const dashboardScopeLabels = {
  in_progress: '进行中',
  not_started: '未开始',
  attention: '需要关注',
  delayed: '已延期',
  high_risk: '未延期高风险',
  due_soon: '近期到期',
  due_attention: '近期到期且需要关注',
  recent_completed: '近 7 天完成',
  recent_created: '近 7 天新增',
  uncertain: '待排期／待评估',
} as const;
export type DashboardScope = keyof typeof dashboardScopeLabels;
export type DashboardWindow = { asOfDate: string; dueThrough: string; recentFrom: string };
export type DashboardOverview = DashboardWindow & { counts: Record<DashboardScope, number> };
type DashboardRequirement = {
  status: string; delayed?: boolean; highRisk?: boolean; riskEvaluated?: boolean;
  scheduleComplete?: boolean; plannedEnd?: string | null; createdAt?: string;
  executionCompletedAt?: string | null; actualEnd?: string | null;
};

export function dashboardWindow(asOfDate: string): DashboardWindow {
  // addBusinessDays normalizes a holiday to the next working day before counting.
  return { asOfDate, dueThrough: addBusinessDays(asOfDate, 4), recentFrom: addCalendarDays(asOfDate, -6) };
}

function businessDate(value: unknown) {
  if (isValidIsoDate(value)) return value;
  if (typeof value !== 'string' || !value.includes('T') || !Number.isFinite(Date.parse(value))) return null;
  return businessDateFromDateTime(value);
}

/** Cards and Gantt filters use the same facts and business-date window. */
export function matchesDashboardScope(item: DashboardRequirement, scope: DashboardScope, window: DashboardWindow) {
  const active = item.status === 'in_progress' || item.status === 'not_started';
  const attention = active && Boolean(item.delayed || item.highRisk);
  const due = active && item.scheduleComplete === true && isValidIsoDate(item.plannedEnd)
    && item.plannedEnd >= window.asOfDate && item.plannedEnd <= window.dueThrough;
  switch (scope) {
    case 'in_progress': return item.status === 'in_progress';
    case 'not_started': return item.status === 'not_started';
    case 'attention': return attention;
    case 'delayed': return active && Boolean(item.delayed);
    case 'high_risk': return active && !item.delayed && Boolean(item.highRisk);
    case 'due_soon': return due;
    case 'due_attention': return due && attention;
    case 'uncertain': return active && (!item.scheduleComplete || !item.riskEvaluated);
    case 'recent_completed': {
      // Observation cutoffs, update times and planned dates are not completion facts.
      const date = businessDate(item.executionCompletedAt ?? item.actualEnd);
      return item.status === 'completed' && date !== null && date >= window.recentFrom && date <= window.asOfDate;
    }
    case 'recent_created': {
      const date = businessDate(item.createdAt);
      return date !== null && date >= window.recentFrom && date <= window.asOfDate;
    }
  }
}

export function dashboardOverview(items: DashboardRequirement[], asOfDate: string): DashboardOverview {
  const window = dashboardWindow(asOfDate);
  const scopes = Object.keys(dashboardScopeLabels) as DashboardScope[];
  const counts = Object.fromEntries(scopes.map(scope => [scope, 0])) as Record<DashboardScope, number>;
  for (const item of items) for (const scope of scopes) if (matchesDashboardScope(item, scope, window)) counts[scope]++;
  return { ...window, counts };
}
