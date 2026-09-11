import type { ActionItemsPage } from '../shared/action-items';

export type { ActionItem, ActionItemsPage, ActionReason, ActionReasonCode, ActionSeverity } from '../shared/action-items';

export type Session = {
  authenticated: boolean; accountId?: string; username: string | null; httpWarning: boolean;
  role: 'guest' | 'user' | 'project_manager' | 'admin'; globalRole: 'guest' | 'user' | 'admin';
  personId: string | null; mustChangePassword: boolean; managedProjectIds: string[];
};
export type Project = {
  id: string; name: string; status: string; plannedStart: string | null; plannedEnd: string | null;
  defaultTemplateId: string | null; createdAt: string; updatedAt: string; deletedAt?: string | null;
  isSample: boolean; projectRole?: 'viewer' | 'member' | 'manager'; canManage?: boolean;
};

// 仅用于控制界面可见性；服务端始终独立执行授权校验。
export type ProjectPermission = {
  canRead: boolean;
  canContribute: boolean;
  canManage: boolean;
};
export type Person = {
  id: string; name: string; jobTitle: string | null; active: boolean | number;
  projectRole?: 'viewer' | 'member' | 'manager'; username?: string | null; accountStatus?: 'active' | 'disabled' | null;
  accountDeletedAt?: string | null;
  membershipUpdatedAt?: string | null;
  createdAt: string; updatedAt: string; deletedAt?: string | null;
};
export type TemplateItem = {
  kind?:'work'|'milestone';arrangement?:'early'|'late';arrangementAnchor?:string|null;confirmationMode?:'auto'|'manual';
  predecessorIds?: string[];
  id: string; templateId: string; title: string; sortOrder: number;
  startOffsetDays: number; durationDays: number; milestoneLabel: string | null; deletedAt?: string | null;
};
export type WorkItemTemplate = {
  layout?:{positions:Record<string,{x:number;y:number}>;version:number;direction:'right'|'down'};
  dependencyMode?: 'legacy' | 'dependencies';
  id: string; projectId: string; name: string; description: string; createdAt: string; updatedAt: string; deletedAt?: string | null; items: TemplateItem[];
};
export type WorkItem = import('../shared/forecast-basis').ExecutionMetadata & {
  durationDays?:number|null;
  dependencyRevision?:number; unmetPredecessors?:Array<{id:string;title:string}>;
  id: string; requirementId: string; templateItemId: string | null; title: string; ownerId: string | null; ownerName: string | null;
  collaborators: Array<{ id: string; name: string; jobTitle: string | null }>;
  assigneeIds: string[]; assigneeNames: string[];
  status: string; plannedStart: string | null; plannedEnd: string | null; actualStart: string | null; actualEnd: string | null;
  cancelledAt?: string | null;
  forecastEnd: string | null; blockedAt: string | null; blockedReason: string | null;
  milestoneLabel: string | null;
  progress: number;
  sortOrder: number; version: number; createdAt: string; updatedAt: string;
};
export type ProgressUpdate = {
  id: string; requirementId: string; workItemId: string | null; workItemTitle: string | null;
  percent: number; workItemPercent: number | null; content: string; eventType: string; supersedesId?: string | null;
  createdByAccountId?: string | null; createdByName?: string | null; createdAt: string; updatedAt: string;
};
export type IssueUpdate = {
  id: string; issueId: string; progress: number | null; content: string; eventType: string; supersedesId?: string | null;
  createdByAccountId: string | null; createdByName: string | null; createdAt: string; updatedAt: string;
};
export type Issue = {
  nextReviewAt?:string|null;
  id: string; projectId: string; projectName: string; requirementId: string | null; requirementTitle: string | null;
  sourceRef: string | null; title: string; impact: string | null; reporter: string | null;
  ownerId: string | null; ownerName: string | null; status: string; priority: string; progress: number;
  discoveredAt: string; dueDate: string | null; resolvedAt: string | null;
  version: number; createdAt: string; updatedAt: string; latestUpdate: string | null; latestUpdateAt: string | null;
  overdue: boolean; updates?: IssueUpdate[];
};
export type IssuePage = {
  items: Issue[]; total: number; page: number; pageSize: number; pages: number;
  summary: {
    total: number; inProgress: number; deferred: number; resolved: number;
    active: number; highPriority: number; overdue: number; unassigned: number; closureRate: number;
  };
};
export type Requirement = import('../shared/delivery').DeliveryFields & import('../shared/intake').Organization & Partial<import('../shared/delivery').ProcessingResult> & {
  readinessIssues?:string[];
  milestones?:import('../shared/paths').PathMilestone[];
  pathRisk?: import('../shared/paths').PathRisk;
  id: string; projectId: string; projectName: string; templateId: string | null; templateName: string | null; title: string; ownerId: string | null; ownerName: string | null;
  sourceNotes?: string | null; background?: string | null; acceptanceCriteria?: string | null; referenceUrl?: string | null;
  status: string; plannedStart: string | null; plannedEnd: string | null; progress: number; plannedProgress: number | null; progressGap: number;
  asOfDate?: string; scheduleComplete?: boolean;
  actualStart?: string | null; actualEnd?: string | null;
  acceptedAt: string | null; acceptedByAccountId: string | null; version: number;
  riskLevel: string; riskEvaluated: boolean; riskReason: string; priority: string; createdAt: string; updatedAt: string; deletedAt?: string | null;
  workItems: WorkItem[]; progressUpdates?: ProgressUpdate[]; recentProgressUpdates?: ProgressUpdate[]; delayed: boolean; highRisk: boolean;
  issueSummary?: { active: number; overdue: number };
  finishVariance: number; durationVariance: number; effectiveEnd: string | null;
  scheduleVarianceDays?: number | null; scheduleReferenceDate?: string | null;
};
export type Dashboard = {
  asOfDate: string;
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
export type PlanPreview = {
  requirementId: string; templateId: string; baseStart: string;
  requirementVersion: number; previewToken: string;
  entries: Array<{
    templateItemId: string; workItemId: string | null; title: string; currentStart: string | null; currentEnd: string | null;
    milestoneLabel?: string | null; proposedStart: string; proposedEnd: string; willChange: boolean; reason: 'missing_item' | 'missing_plan' | 'terminal' | 'unchanged';
  }>;
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
export type Archives = {
  projects: ArchiveItem[]; requirements: ArchiveItem[]; people: ArchiveItem[]; templates: ArchiveItem[];
};
export type ArchiveItem = {
  id: string; title: string; jobTitle?: string | null; deletedAt: string;
  requirementCount?: number; workItemCount?: number; issueCount?: number; templateCount?: number;
  progressCount?: number; linkedIssueCount?: number;
};
export type ApiToken = { id: string; name: string; prefix: string; accountId: string; accountName?: string | null; expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null; createdAt: string };
export type AuditLog = { id: string; actorType: string; actorId: string | null; actorName: string | null; tokenName: string | null; action: string; entityType: string; entityId: string | null; projectId: string | null; projectName?: string | null; summary: string; createdAt: string };
export type AuditPage = { items: AuditLog[]; total: number; page: number; pageSize: number; pages: number; snapshot: number };
export type Backup = {
  name: string; size: number; createdAt: string; fingerprint: string;
  restorable?: boolean; validationError?: string | null;
};
export type SystemOverview = {
  status: 'ok';
  service: {
    version: string; startedAt: string; uptimeSeconds: number; environment: string;
    timezone: string; host: string; port: number; protocol: 'http';
  };
  database: {
    path: string; backupDirectory: string; mainSizeBytes: number; walSizeBytes: number;
    shmSizeBytes: number; totalSizeBytes: number; journalMode: string;
  };
  backups: {
    count: number; restorableCount: number; totalSizeBytes: number; lastCreatedAt: string | null; overdue: boolean;
    retentionDays: number; maxCount: number; nextScheduledAt: string;
  };
  lastRestore: {
    operationId: string; outcome: 'pending' | 'succeeded' | 'rolled_back'; backupName: string;
    safetyBackupName: string; updatedAt: string; message: string; failedDatabase: string | null;
  } | null;
};
export type DatabaseIntegrityCheck = { ok: boolean; checkedAt: string; durationMs: number; message: string };
export type SystemBranding = {
  systemName: string;
  shortName: string;
  logoUrl: string | null;
  updatedAt: string | null;
};
export type Account = {
  id: string; username: string; personId: string | null; personName: string | null; jobTitle: string | null;
  globalRole: 'user' | 'admin'; role: 'user' | 'project_manager' | 'admin'; status: 'active' | 'disabled';
  mustChangePassword: boolean; isBuiltin: boolean; lastLoginAt: string | null; createdAt: string; updatedAt: string;
  managedProjects: Array<{ id: string; name: string }>;
  activeAssignments: { requirements: number; workItems: number; issues: number };
};
export type MyWorkItem = WorkItem & {
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
