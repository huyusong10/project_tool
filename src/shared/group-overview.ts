import type { RequirementGroup } from './intake';
import { dashboardWindow, matchesDashboardScope } from './dashboard';

export type GroupRequirementSummary = {
  id: string; title: string; status: string; delayed: boolean; scheduleComplete: boolean;
};
export type GroupProgressSummary = {
  id: string; requirementId: string; requirementTitle: string; content: string; createdAt: string;
};
export type GroupOverview = RequirementGroup & {
  counts: { total: number; completed: number; inProgress: number; delayed: number; unscheduled: number; recentCompleted: number };
  requirements: GroupRequirementSummary[];
  recentUpdates: GroupProgressSummary[];
};
export type GroupOverviewReport = { asOfDate: string; recentFrom: string; groups: GroupOverview[]; ungroupedCount: number };
type RequirementFact = {
  id: string; title: string; status: string; groupId?: string | null; deletedAt?: string | null;
  delayed?: boolean; scheduleComplete?: boolean; executionCompletedAt?: string | null; actualEnd?: string | null;
};

/** 人工评估原样保留；计数仅说明当前分组中的执行事实。 */
export function summarizeGroupOverview(groups: RequirementGroup[], requirements: RequirementFact[], asOfDate: string): GroupOverviewReport {
  const window = dashboardWindow(asOfDate);
  const active = requirements.filter(item => !item.deletedAt && item.status !== 'cancelled');
  const byGroup = new Map<string, RequirementFact[]>();
  for (const item of active) if (item.groupId) {
    const items = byGroup.get(item.groupId) || [];
    items.push(item); byGroup.set(item.groupId, items);
  }
  return { asOfDate, recentFrom: window.recentFrom, ungroupedCount: active.filter(item => !item.groupId).length,
    groups: groups.map(group => {
      const items = byGroup.get(group.id) || [];
      return { ...group,
        counts: {
          total: items.length,
          completed: items.filter(item => item.status === 'completed').length,
          inProgress: items.filter(item => item.status === 'in_progress').length,
          delayed: items.filter(item => matchesDashboardScope(item, 'delayed', window)).length,
          unscheduled: items.filter(item => item.status !== 'completed' && item.scheduleComplete !== true).length,
          recentCompleted: items.filter(item => matchesDashboardScope(item, 'recent_completed', window)).length,
        },
        requirements: items.map(item => ({ id: item.id, title: item.title, status: item.status, delayed: Boolean(item.delayed), scheduleComplete: item.scheduleComplete === true })),
        recentUpdates: [],
      };
    }),
  };
}
