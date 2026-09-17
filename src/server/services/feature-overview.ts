import { todayIso } from '../../shared/domain';
import { summarizeFeatureOverview, type FeatureProgressSummary } from '../../shared/feature-overview';
import { phaseCompletion } from '../../shared/feature-phases';
import type { Actor } from '../auth';
import { assertProjectReadable, requireAuthorizationActor } from '../authorization';
import { getDatabaseContext } from '../database-context';
import { phaseRequirementFacts, readFeaturePhases } from './feature-phases';
import { readFeatures } from './features';
import { listRequirements, type RequirementRecord } from './requirements';

export function getFeatureOverview(projectId: string, actor: Actor, asOfDate = todayIso(), state: 'active'|'archived'|'all' = 'active') {
  assertProjectReadable(requireAuthorizationActor(actor), projectId);
  return readFeatureOverview(projectId,asOfDate,state);
}

export function readFeatureOverview(projectId:string,asOfDate=todayIso(),state:'active'|'archived'|'all'='active',requirements?:RequirementRecord[]) {
  return getDatabaseContext().sqlite.transaction(() => {
    const report = summarizeFeatureOverview(readFeatures(projectId,state), requirements ?? listRequirements({ projectId }, asOfDate), asOfDate);
    const updates = getDatabaseContext().sqlite.prepare(`SELECT id,featureId,requirementId,requirementTitle,content,createdAt FROM (
      SELECT u.id,r.feature_id AS featureId,r.id AS requirementId,r.title AS requirementTitle,u.content,u.created_at AS createdAt,
        ROW_NUMBER() OVER (PARTITION BY r.feature_id ORDER BY u.created_at DESC,u.rowid DESC) AS rank
      FROM progress_updates u JOIN requirements r ON r.id=u.requirement_id
      WHERE r.project_id=? AND r.feature_id IS NOT NULL AND r.deleted_at IS NULL AND r.status<>'cancelled'
    ) ranked WHERE rank<=3 ORDER BY featureId,rank`).all(projectId) as Array<FeatureProgressSummary & { featureId: string }>;
    const byFeature = new Map(report.features.map(feature => [feature.id, feature]));
    for (const {featureId,...update} of updates) byFeature.get(featureId)?.recentUpdates.push(update);
    const facts=phaseRequirementFacts(projectId,asOfDate),byId=new Map(facts.map(r=>[r.id,r]));
    const phases=readFeaturePhases(projectId,asOfDate,facts);
    for(const feature of report.features){
      feature.phases=phases.filter(p=>p.featureId===feature.id);
      // Summing requirement weights equals weighting Phases by their scope, without rounding each Phase first.
      // Archived completions and requirements awaiting a Phase retain their contribution.
      feature.completion=phaseCompletion(facts.filter(r=>r.featureId===feature.id));
      feature.requirements=feature.requirements.map(r=>({...r,progress:byId.get(r.id)?.progress,progressWeight:byId.get(r.id)?.progressWeight}));
      feature.unassignedPhaseCount=facts.filter(r=>r.featureId===feature.id&&!r.phaseId&&!r.deletedAt&&r.status!=='cancelled').length;
    }
    return report;
  })();
}
