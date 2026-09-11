import { sqlite } from '../database';
import type { Actor } from '../auth';
import { assertProjectReadable, requireAuthorizationActor } from '../authorization';
import { todayIso } from '../../shared/domain';
import { summarizeGroupOverview, type GroupProgressSummary } from '../../shared/group-overview';
import { readRequirementGroups } from './features';
import { listRequirements } from './requirements';

export function getGroupOverview(projectId: string, actor: Actor, asOfDate = todayIso(), state: 'active'|'archived'|'all' = 'active') {
  assertProjectReadable(requireAuthorizationActor(actor), projectId);
  return sqlite.transaction(() => {
    const report = summarizeGroupOverview(readRequirementGroups(projectId,state), listRequirements({ projectId }, asOfDate), asOfDate);
    const updates = sqlite.prepare(`SELECT id,groupId,requirementId,requirementTitle,content,createdAt FROM (
      SELECT u.id,r.group_id AS groupId,r.id AS requirementId,r.title AS requirementTitle,u.content,u.created_at AS createdAt,
        ROW_NUMBER() OVER (PARTITION BY r.group_id ORDER BY u.created_at DESC,u.rowid DESC) AS rank
      FROM progress_updates u JOIN requirements r ON r.id=u.requirement_id
      WHERE r.project_id=? AND r.group_id IS NOT NULL AND r.deleted_at IS NULL AND r.status<>'cancelled'
    ) ranked WHERE rank<=3 ORDER BY groupId,rank`).all(projectId) as Array<GroupProgressSummary & { groupId: string }>;
    const byGroup = new Map(report.groups.map(group => [group.id, group]));
    for (const {groupId,...update} of updates) byGroup.get(groupId)?.recentUpdates.push(update);
    return report;
  })();
}
