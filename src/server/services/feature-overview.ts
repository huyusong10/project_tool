import { readFeaturePhases } from './feature-phases';
import { sqlite } from '../database';
import type { Actor } from '../auth';
import { assertProjectReadable, requireAuthorizationActor } from '../authorization';
import { todayIso } from '../../shared/domain';
import { summarizeFeatureOverview, type FeatureProgressSummary } from '../../shared/feature-overview';
import { readFeatures } from './features';
import { listRequirements } from './requirements';

export function getFeatureOverview(projectId: string, actor: Actor, asOfDate = todayIso(), state: 'active'|'archived'|'all' = 'active') {
  assertProjectReadable(requireAuthorizationActor(actor), projectId);
  return sqlite.transaction(() => {
    const report = summarizeFeatureOverview(readFeatures(projectId,state), listRequirements({ projectId }, asOfDate), asOfDate);
    const updates = sqlite.prepare(`SELECT id,featureId,requirementId,requirementTitle,content,createdAt FROM (
      SELECT u.id,r.feature_id AS featureId,r.id AS requirementId,r.title AS requirementTitle,u.content,u.created_at AS createdAt,
        ROW_NUMBER() OVER (PARTITION BY r.feature_id ORDER BY u.created_at DESC,u.rowid DESC) AS rank
      FROM progress_updates u JOIN requirements r ON r.id=u.requirement_id
      WHERE r.project_id=? AND r.feature_id IS NOT NULL AND r.deleted_at IS NULL AND r.status<>'cancelled'
    ) ranked WHERE rank<=3 ORDER BY featureId,rank`).all(projectId) as Array<FeatureProgressSummary & { featureId: string }>;
    const byFeature = new Map(report.features.map(feature => [feature.id, feature]));
    for (const {featureId,...update} of updates) byFeature.get(featureId)?.recentUpdates.push(update);
    const phases=readFeaturePhases(projectId,asOfDate);
    for(const feature of report.features){feature.phases=phases.filter(p=>p.featureId===feature.id);feature.unassignedPhaseCount=Number((sqlite.prepare("SELECT count(*) AS n FROM requirements WHERE feature_id=? AND phase_id IS NULL AND deleted_at IS NULL AND status<>'cancelled'").get(feature.id) as {n:number}).n);}
    return report;
  })();
}
