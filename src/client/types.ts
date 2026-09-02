export type Session = {
  authenticated: boolean; accountId?: string; username: string | null; httpWarning: boolean;
  role: 'guest' | 'user' | 'project_manager' | 'admin'; globalRole: 'guest' | 'user' | 'admin';
  personId: string | null; mustChangePassword: boolean; managedProjectIds: string[];
};
export type Project = {
  id: string; name: string; status: string; plannedStart: string | null; plannedEnd: string | null;
  defaultTemplateId: string | null; createdAt: string; updatedAt: string; deletedAt?: string | null;
};
export type Person = {
  id: string; name: string; jobTitle: string | null; active: boolean | number;
  projectRole?: 'member' | 'manager'; username?: string | null; accountStatus?: 'active' | 'disabled' | null;
  createdAt: string; updatedAt: string; deletedAt?: string | null;
};
export type TemplateItem = {
  id: string; templateId: string; title: string; sortOrder: number;
  startOffsetDays: number; durationDays: number; deletedAt?: string | null;
};
export type WorkItemTemplate = {
  id: string; name: string; createdAt: string; updatedAt: string; deletedAt?: string | null; items: TemplateItem[];
};
export type WorkItem = {
  id: string; requirementId: string; templateItemId: string | null; title: string; ownerId: string | null; ownerName: string | null;
  collaborators: Array<{ id: string; name: string; jobTitle: string | null }>;
  assigneeIds: string[]; assigneeNames: string[];
  status: string; plannedStart: string | null; plannedEnd: string | null; actualStart: string | null; actualEnd: string | null;
  forecastEnd: string | null; blockedAt: string | null; blockedReason: string | null;
  sortOrder: number; createdAt: string; updatedAt: string;
};
export type ProgressUpdate = {
  id: string; requirementId: string; workItemId: string | null; workItemTitle: string | null;
  percent: number; content: string; createdByAccountId?: string | null; createdByName?: string | null; createdAt: string; updatedAt: string;
};
export type IssueUpdate = {
  id: string; issueId: string; content: string; createdAt: string; updatedAt: string;
};
export type Issue = {
  id: string; projectId: string; projectName: string; requirementId: string | null; requirementTitle: string | null;
  sourceRef: string | null; title: string; impact: string | null; reporter: string | null;
  ownerId: string | null; ownerName: string | null; status: string; priority: string;
  discoveredAt: string; dueDate: string | null; resolvedAt: string | null;
  createdAt: string; updatedAt: string; latestUpdate: string | null; latestUpdateAt: string | null;
  overdue: boolean; updates?: IssueUpdate[];
};
export type IssuePage = {
  items: Issue[]; total: number; page: number; pageSize: number; pages: number;
  summary: { total: number; open: number; inProgress: number; deferred: number; resolved: number; overdue: number; unassigned: number };
};
export type Requirement = {
  id: string; projectId: string; projectName: string; title: string; ownerId: string | null; ownerName: string | null;
  status: string; plannedStart: string | null; plannedEnd: string | null; progress: number; plannedProgress: number; progressGap: number;
  riskLevel: string; priority: string; createdAt: string; updatedAt: string; deletedAt?: string | null;
  workItems: WorkItem[]; progressUpdates?: ProgressUpdate[]; recentProgressUpdates?: ProgressUpdate[]; delayed: boolean; highRisk: boolean;
  finishVariance: number; durationVariance: number; effectiveEnd: string | null;
};
export type Dashboard = {
  summary: { total: number; active: number; completed: number; delayed: number; highRisk: number; completionRate: number };
  requirements: Requirement[];
  charts: {
    statuses: Array<{ status: string; count: number }>;
    risks: Array<{ risk: string; count: number }>;
    weeks: Array<{ week: string; completed: number }>;
    varianceTop: Array<{ id: string; title: string; variance: number }>;
  };
};
export type PlanPreview = {
  requirementId: string; templateId: string; baseStart: string;
  entries: Array<{
    templateItemId: string; workItemId: string | null; title: string; currentStart: string | null; currentEnd: string | null;
    proposedStart: string; proposedEnd: string; willChange: boolean; reason: 'missing_item' | 'missing_plan' | 'unchanged';
  }>;
};
export type ConcurrencyDay = {
  date: string; count: number; plannedCount: number; actualCount: number;
  items: Array<{ id: string; title: string; requirementId: string; requirementTitle: string }>;
};
export type PeopleConcurrency = {
  from: string; to: string; dates: string[];
  people: Array<{ id: string; name: string; jobTitle: string | null; currentCount: number; peakCount: number; days: ConcurrencyDay[] }>;
  currentTop: Array<{ id: string; name: string; jobTitle: string | null; currentCount: number; peakCount: number }>;
};
export type Archives = {
  projects: ArchiveItem[]; requirements: ArchiveItem[]; people: ArchiveItem[]; templates: ArchiveItem[];
};
export type ArchiveItem = { id: string; title: string; jobTitle?: string | null; deletedAt: string };
export type ApiToken = { id: string; name: string; prefix: string; expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null; createdAt: string };
export type AuditLog = { id: string; actorType: string; actorId: string | null; action: string; entityType: string; entityId: string | null; summary: string; createdAt: string };
export type AuditPage = { items: AuditLog[]; total: number; page: number; pageSize: number; pages: number };
export type Backup = { name: string; size: number; createdAt: string };
export type Account = {
  id: string; username: string; personId: string | null; personName: string | null; jobTitle: string | null;
  globalRole: 'user' | 'admin'; role: 'user' | 'project_manager' | 'admin'; status: 'active' | 'disabled';
  mustChangePassword: boolean; isBuiltin: boolean; lastLoginAt: string | null; createdAt: string; updatedAt: string;
  managedProjects: Array<{ id: string; name: string }>;
};
export type MyWorkItem = WorkItem & {
  projectId: string; projectName: string; requirementTitle: string; assignmentType: 'owner' | 'collaborator'; overdue: boolean;
};
export type MyWork = {
  summary: { total: number; notStarted: number; inProgress: number; blocked: number; completed: number; overdue: number };
  items: MyWorkItem[];
  completionTrend: Array<{ week: string; completed: number }>;
  upcoming: Array<{ date: string; count: number }>;
  recentProgress: Array<ProgressUpdate & { requirementTitle: string }>;
};
