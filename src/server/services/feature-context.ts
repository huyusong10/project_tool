import type {Actor} from '../auth';
import type {PathAnalysis,PathRequirement} from '../../shared/paths';
import {getGroupOverview} from './group-overview';
import {readFeatureRelations} from './features';

/** Called inside the execution snapshot transaction. Planning never enters scheduling. */
export function withFeatureContext(analysis:PathAnalysis,requirements:PathRequirement[],actor:Actor):PathAnalysis {
  return {...analysis,featureContext:{overview:getGroupOverview(analysis.projectId,actor,analysis.asOfDate,'all'),relations:readFeatureRelations(analysis.projectId),requirements}};
}
