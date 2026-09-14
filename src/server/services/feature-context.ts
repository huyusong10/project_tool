import {projectPhaseOverview} from '../../shared/phase-projection';
import type {Actor} from '../auth';
import type {PathAnalysis,PathRequirement} from '../../shared/paths';
import {getFeatureOverview} from './feature-overview';
import {readFeatureRelations} from './features';

/** Called inside the execution snapshot transaction. Planning never enters scheduling. */
export function withFeatureContext(analysis:PathAnalysis,requirements:PathRequirement[],actor:Actor):PathAnalysis {
  return {...analysis,featureContext:{overview:projectPhaseOverview(getFeatureOverview(analysis.projectId,actor,analysis.asOfDate,'all'),requirements.map(r=>({...r,executionStage:analysis.requirements.find(n=>n.id===r.id)?.executionStage||r.executionStage}))),relations:readFeatureRelations(analysis.projectId),requirements}};
}
