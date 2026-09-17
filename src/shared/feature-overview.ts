import type { Feature } from './intake';
import { dashboardWindow, matchesDashboardScope } from './dashboard';

export type FeatureRequirementSummary = {
  progress?:number|null; progressWeight?:number|null;
  phaseId?:string|null; actualStart?:string|null; actualEnd?:string|null;
  executionStage?:import('./execution-stage').ExecutionStage;
  id: string; title: string; status: string; delayed: boolean; scheduleComplete: boolean;
};
export type FeatureProgressSummary = {
  id: string; requirementId: string; requirementTitle: string; content: string; createdAt: string;
};
export type FeatureOverview = Feature & {
  completion?:import('./feature-phases').PhaseCompletion;
  phases?:import('./feature-phases').FeaturePhase[]; unassignedPhaseCount?:number;
  counts: { total: number; completed: number; inProgress: number; delayed: number; unscheduled: number; recentCompleted: number };
  requirements: FeatureRequirementSummary[];
  recentUpdates: FeatureProgressSummary[];
};
export type FeatureOverviewReport = { asOfDate: string; recentFrom: string; features: FeatureOverview[]; unassignedCount: number };
type RequirementFact = {
  phaseId?:string|null; actualStart?:string|null;
  executionStage?:import('./execution-stage').ExecutionStage;
  id: string; title: string; status: string; featureId?: string | null; deletedAt?: string | null;
  delayed?: boolean; scheduleComplete?: boolean; executionCompletedAt?: string | null; actualEnd?: string | null;
};

/** 人工评估原样保留；计数仅说明当前特性中的执行事实。 */
export function summarizeFeatureOverview(features: Feature[], requirements: RequirementFact[], asOfDate: string): FeatureOverviewReport {
  const window = dashboardWindow(asOfDate);
  const active = requirements.filter(item => !item.deletedAt && item.status !== 'cancelled');
  const byFeature = new Map<string, RequirementFact[]>();
  for (const item of active) if (item.featureId) {
    const items = byFeature.get(item.featureId) || [];
    items.push(item); byFeature.set(item.featureId, items);
  }
  return { asOfDate, recentFrom: window.recentFrom, unassignedCount: active.filter(item => !item.featureId).length,
    features: features.map(feature => {
      const items = byFeature.get(feature.id) || [];
      return { ...feature,
        counts: {
          total: items.length,
          completed: items.filter(item => item.status === 'completed').length,
          inProgress: items.filter(item => item.status === 'in_progress').length,
          delayed: items.filter(item => matchesDashboardScope(item, 'delayed', window)).length,
          unscheduled: items.filter(item => item.status !== 'completed' && item.scheduleComplete !== true).length,
          recentCompleted: items.filter(item => matchesDashboardScope(item, 'recent_completed', window)).length,
        },
        requirements: items.map(item => ({ id: item.id, title: item.title, status: item.status, phaseId:item.phaseId, actualStart:item.actualStart, actualEnd:item.actualEnd, executionStage:item.executionStage, delayed: Boolean(item.delayed), scheduleComplete: item.scheduleComplete === true })),
        recentUpdates: [],
      };
    }),
  };
}
