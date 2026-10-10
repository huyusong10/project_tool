import type { Requirement } from './requirements';
import type { WorkItem } from './work-items';
import type { ProgressUpdate } from './progress';
import type { Issue } from './issues';
import type { IssuePage } from './issues';
import type { ActionItemsPage } from '../action-items';

export type Dashboard = {
  featureOverview?:import('../feature-overview').FeatureOverviewReport;
  asOfDate: string;
  overview?: import('../dashboard').DashboardOverview;
  summary: { total: number; active: number; completed: number; delayed: number; highRisk: number; completionRate: number };
  requirements: Requirement[];
  issues: { summary: IssuePage["summary"]; attention: Issue[] };
  actions?: ActionItemsPage;
  charts: {
    statuses: Array<{ status: string; count: number }>;
    risks: Array<{ risk: string; count: number }>;
    weeks: Array<{ week: string; completed: number }>;
    varianceTop: Array<{ id: string; title: string; variance: number }>;
  };
};

export type ConcurrencyDay = {
  date: string; count: number; plannedCount: number; actualCount: number;
  items: Array<{ id: string; title: string; requirementId: string; requirementTitle: string }>;
};

export type PeopleConcurrency = {
  asOfDate: string;
  from: string; to: string; dates: string[];
  people: Array<{ id: string; name: string; jobTitle: string | null; currentCount: number; externalCurrentCount?: number; peakCount: number; days: ConcurrencyDay[] }>;
  currentTop: Array<{ id: string; name: string; jobTitle: string | null; currentCount: number; externalCurrentCount?: number; peakCount: number }>;
};

export type MyWorkItem = WorkItem & {
  requirementJiraLinks?: import('../jira-links').JiraEntry[];
  projectId: string; projectName: string; requirementTitle: string; requirementStatus: string;
  assignmentType: 'owner' | 'collaborator'; overdue: boolean;
};

export type MyOwnedRequirement = Partial<Requirement> & {
  id: string; projectId: string; projectName: string; title: string; status: string; priority: string;
  plannedStart: string | null; plannedEnd: string | null; progress: number; riskLevel: string;
  riskEvaluated: boolean; delayed: boolean; highRisk: boolean; planningReasons: string[];
  actionCount: number; updatedAt: string;
};

export type MyWork = {
  asOfDate: string;
  summary: { total: number; notStarted: number; inProgress: number; blocked: number; completed: number; overdue: number };
  requirements: MyOwnedRequirement[];
  items: MyWorkItem[];
  completionTrend: Array<{ week: string; completed: number }>;
  upcoming: Array<{ date: string; count: number }>;
  recentProgress: Array<ProgressUpdate & { requirementTitle: string }>;
};
