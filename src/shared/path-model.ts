import type { DeliveryFields, ProcessingResult } from './delivery';
import type { Arrangement } from './late-schedule';
import type { RiskLevel } from './domain';
export type Dependency = {
  id: string; projectId: string; sourceRequirementId: string; sourceWorkItemId: string | null;
  targetRequirementId: string; targetWorkItemId: string | null; origin: string;
  sourceMilestoneId?:string|null; targetMilestoneId?:string|null;
};

export type PathMilestone={milestoneKind?:import('./execution-stage').MilestoneKind;achievedRecordedAt?:string|null;forecastEnd?:string|null;id:string;projectId:string;requirementId:string|null;title:string;targetDate:string|null;confirmationMode:'auto'|'manual';achievedAt:string|null;version:number;cancelled?:boolean};

export type DiagramLayout={scope:string;direction:'right'|'down';version:number;positions:Record<string,{x:number;y:number}>};

export type PathWork = ExecutionMetadata & {
  jiraLinks?: import('./jira-links').JiraEntry[];
  referenceLinks?:import('./reference-links').ReferenceLink[]; workStage?:import('./execution-stage').WorkStage|null; progressWeight?:number|null;
  version?:number;
  arrangement?:Arrangement; arrangementAnchor?:string|null; acknowledgedDependencies?:string[];
  ownerId?:string|null; assigneeIds?:string[]; assigneeNames?:string[];
  id: string; requirementId: string; title: string; status: string; progress: number;
  plannedStart: string | null; plannedEnd: string | null; actualStart: string | null; actualEnd: string | null;
  durationDays: number | null; earliestStart: string | null; unblockEstimate: string | null;
  forecastEnd: string | null; forecastDuration: number | null; forecastReadyAt: string | null;
  blockedAt: string | null; blockedReason: string | null; milestoneLabel: string | null; ownerName: string | null;
};

export type PathRequirement = import('./intake').Organization & DeliveryFields & Partial<ProcessingResult> & {
  jiraLinks?: import('./jira-links').JiraEntry[];
  sortOrder?:number; executionStage?:import('./execution-stage').ExecutionStage; stageResetAt?:string|null; createdAt?:string;updatedAt?:string;
  acknowledgedDependencies?:string[]; version?:number; background?:string|null;acceptanceCriteria?:string|null;referenceUrl?:string|null;referenceLinks?:import('./reference-links').ReferenceLink[];templateId?:string|null;
  ownerId?:string|null; assigneeIds?:string[]; assigneeNames?:string[]; delayed?:boolean; scheduleComplete?:boolean;
  id: string; projectId: string; title: string; status: string; priority: string; ownerName: string | null;
  plannedStart: string | null; plannedEnd: string | null; acceptedAt: string | null;
  dependenciesReviewedAt: string | null; scheduleAnchor: string | null; forecastAcceptance: string | null; deletedAt: string | null;
};

export type PathInput = {
  projectId: string; projectName: string; revision: number; highRiskDelayDays?: number; projectEnd: string | null; asOfDate: string;
  requirements: PathRequirement[]; workItems: PathWork[]; dependencies: Dependency[];
  milestones?:PathMilestone[]; layouts?:DiagramLayout[];
};

export type PathNode = {
  jiraLinks?: import('./jira-links').JiraEntry[];
  progress?:number;progressWeight?:number|null;
  workStage?:import('./execution-stage').WorkStage|null;
  blockerCoordination?:import('./blocker-coordination').BlockerCoordination;
  forecastBasis?:ForecastBasis;
  version?:number;
  ownerId?:string|null; assigneeIds?:string[]; assigneeNames?:string[]; delayed?:boolean; scheduleComplete?:boolean;
  id: string; requirementId: string | null; workItemId: string | null; kind: 'execution' | 'work' | 'start' | 'acceptance' | 'project' | 'milestone';
  arrangement?:Arrangement; arrangementAnchor?:string|null; scheduledStart?:string|null; scheduledEnd?:string|null; scheduleBuffer?:number|null; startAcknowledged?:boolean;
  title: string; status: string; ownerName: string | null; milestoneLabel: string | null;
  plannedStart: string | null; plannedEnd: string | null; forecastStart: string | null; forecastEnd: string | null;
  remainingDays: number; earliestStart: number; earliestFinish: number; floatDays: number | null;
  critical: boolean; planCritical: boolean; nearCritical: boolean; inScope: boolean;
  unknownReasons: string[]; ownReasons: string[]; source: string; riskLevel: RiskLevel; complete: boolean;
  estimate: {durationDays:number|null;earliestStart:string|null;unblockEstimate:string|null;forecastEnd:string|null};
};

export type PathEdge = { id: string; source: string; target: string; dependencyId: string | null; critical: boolean };

export type PathRisk = Partial<ProcessingResult> & { drivesLateTarget?:boolean;inDeliveryNetwork?:boolean; riskLevel: RiskLevel; riskEvaluated: boolean; riskReason: string; highRisk: boolean;
  critical: boolean; criticalCount: number; minFloat: number | null; blockedCritical: boolean; complete: boolean };

export type PathBlocker = { nodeId: string; requirementId: string; workItemId: string | null; title: string; ownerName: string | null;
  reasons: string[]; affectedRequirementIds: string[]; targetCount: number; critical: boolean; waitingDays: number; riskLevel: RiskLevel };

export type PathAnalysis = {
  featureContext?:FeatureCanvasContext;
  projectId: string; projectName: string; revision: number; asOfDate: string; calendarVersion: string;
  target: string; targetLabel: string; targetDate: string | null; forecastEnd: string | null; deadlineSlack: number | null;
  complete: boolean; coverage: { reviewed: number; total: number; unplanned: number };
  nodes: PathNode[]; edges: PathEdge[]; requirements: PathRequirement[]; dependencies: Dependency[];
  risks: Record<string, PathRisk>; blockers: PathBlocker[];
  milestones?:PathMilestone[]; layouts?:DiagramLayout[];
};

export type ForecastReview = {
  confirmedAt:string; confirmedBy:string; confirmedName?:string; remainingDays:number|null; forecastEnd:string|null;
  progress:number; actualStart:string|null; predecessorBasis:string;
  invalidatedAt?:string;
};

export type ForecastBasis = {
  source:string; review:ForecastReview|null; needsReview:boolean; reasons:string[];
  concurrentWorkCount:number;
  concurrentWork?:Array<{id:string;requirementId:string|null;title:string;requirementTitle:string;forecastEnd:string|null;critical:boolean}>;
};

export type ExecutionMetadata = {
  deliveryForecast?: DeliveryForecast;
  blockerCoordination?:import('./blocker-coordination').BlockerCoordination;
  forecastReview?:ForecastReview|null; forecastBasis?:ForecastBasis;
  blockedCoordinatorId?:string|null; blockedNextReviewAt?:string|null; blockedIssueId?:string|null;
};

export type DeliveryForecast = {
  revision: number; asOfDate: string; start: string | null; end: string | null;
  remainingDays: number; source: string; reasons: string[];
};

export type FeatureRelation = { id: string; projectId: string; sourceFeatureId: string; targetFeatureId: string; note: string; version: number };

export type FeatureCanvasContext = {
  overview: import('./feature-overview').FeatureOverviewReport;
  relations: FeatureRelation[];
  requirements: PathRequirement[];
};
