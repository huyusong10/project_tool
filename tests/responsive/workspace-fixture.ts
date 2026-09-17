import { analysePaths, type PathAnalysis, type PathRequirement, type PathWork } from '../../src/shared/paths';
import { summarizeFeatureOverview } from '../../src/shared/feature-overview';
import { emptyFeatureOverview, type Feature } from '../../src/shared/intake';

/** Complete workspace projection for mocked detail/progress journeys. */
export function workspaceFixture(projectId: string, projectName: string, requirements: Array<Pick<PathRequirement, 'id'|'title'|'status'|'priority'|'ownerName'|'plannedStart'|'plannedEnd'> & Partial<PathRequirement> & {workItems: Array<Pick<PathWork,'id'|'title'|'status'|'progress'|'plannedStart'|'plannedEnd'|'actualStart'|'actualEnd'|'blockedAt'|'blockedReason'|'milestoneLabel'|'ownerName'> & Partial<PathWork>>}>, asOfDate = '2026-09-03') {
  const feature: Feature = { id: 'other-'+projectId, projectId, name: '其他需求', kind: 'other', sortOrder: 0, version: 1, description: '', archivedAt: null, overview: emptyFeatureOverview, assessedAt: null, assessedBy: null, assessedByName: null };
  const facts: PathRequirement[] = requirements.map(r => ({ acceptedAt:null, dependenciesReviewedAt:null, scheduleAnchor:null, forecastAcceptance:null, deletedAt:null, ...r, projectId, featureId:r.featureId||feature.id }));
  const overview = summarizeFeatureOverview([feature], facts, asOfDate);
  const analysis: PathAnalysis = analysePaths({projectId,projectName,revision:1,projectEnd:'2026-09-30',asOfDate,requirements:facts,dependencies:[],workItems:requirements.flatMap(r=>r.workItems.map(w=>({durationDays:null,earliestStart:null,unblockEstimate:null,forecastEnd:null,forecastDuration:null,forecastReadyAt:null,...w,requirementId:r.id})))});
  analysis.featureContext = {overview,relations:[],requirements:facts};
  return {analysis, overview, features:[feature]};
}
