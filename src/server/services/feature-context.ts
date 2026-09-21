import type { PathAnalysis, PathRequirement } from '../../shared/paths';
import { projectPhaseOverview } from '../../shared/phase-projection';
import type { Actor } from '../auth';
import { getFeatureOverview } from './feature-overview';
import { readFeatureRelations } from './features';

/** Called inside the execution snapshot transaction. Planning never enters scheduling. */
export function withFeatureContext(analysis:PathAnalysis,requirements:PathRequirement[],actor:Actor,context={
  overview:getFeatureOverview(analysis.projectId,actor,analysis.asOfDate,'all'),
  relations:readFeatureRelations(analysis.projectId),
}):PathAnalysis {
  return {...analysis,featureContext:{overview:projectPhaseOverview(context.overview,requirements.map(r=>({...r,executionStage:analysis.requirements.find(n=>n.id===r.id)?.executionStage||r.executionStage}))),relations:context.relations,requirements}};
}
