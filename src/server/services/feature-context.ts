import type { PathAnalysis, PathRequirement } from '../../shared/paths';
import { projectPhaseOverview, projectRequirementFacts } from '../../shared/phase-projection';
import type { Actor } from '../auth';
import { getFeatureOverview } from './feature-overview';
import { readFeatureRelations } from './features';

/** Called inside the execution snapshot transaction. Planning never enters scheduling. */
export function withFeatureContext(analysis:PathAnalysis,requirements:PathRequirement[],actor:Actor,context={
  overview:getFeatureOverview(analysis.projectId,actor,analysis.asOfDate,'all'),
  relations:readFeatureRelations(analysis.projectId),
}):PathAnalysis {
  const facts=projectRequirementFacts(context.overview,requirements.map(r=>({...r,...analysis.requirements.find(n=>n.id===r.id)})));
  return {...analysis,requirements:facts,featureContext:{overview:projectPhaseOverview(context.overview,facts),relations:context.relations,requirements:facts}};
}
