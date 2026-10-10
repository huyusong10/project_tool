import { getDatabaseContext } from '../database-context';
import type { WorkItemCancellationImpact } from '../../shared/api/work-items';

/** Read the exact relationships that cancellation will remove. */
export function workItemCancellationImpact(id: string): WorkItemCancellationImpact {
  const db = getDatabaseContext().sqlite;
  const project = db.prepare('SELECT p.analysis_revision AS revision FROM work_items w JOIN requirements r ON r.id=w.requirement_id JOIN projects p ON p.id=r.project_id WHERE w.id=?').get(id) as { revision: number };
  const dependencies = db.prepare(`SELECT e.id,
    COALESCE(sw.title,sm.title,sr.title) AS sourceTitle,COALESCE(tw.title,tm.title,tr.title) AS targetTitle
    FROM dependency_edges e LEFT JOIN work_items sw ON sw.id=e.source_work_item_id LEFT JOIN work_items tw ON tw.id=e.target_work_item_id
    LEFT JOIN requirements sr ON sr.id=e.source_requirement_id LEFT JOIN requirements tr ON tr.id=e.target_requirement_id
    LEFT JOIN milestones sm ON sm.id=e.source_milestone_id LEFT JOIN milestones tm ON tm.id=e.target_milestone_id
    WHERE e.source_work_item_id=? OR e.target_work_item_id=? ORDER BY e.id`).all(id,id) as WorkItemCancellationImpact['dependencies'];
  const milestones = db.prepare(`SELECT id,title FROM milestones WHERE achieved_at IS NULL AND (legacy_work_item_id=? OR id IN
    (SELECT target_milestone_id FROM dependency_edges WHERE source_work_item_id=?)) ORDER BY id`).all(id,id) as WorkItemCancellationImpact['milestones'];
  return { revision: project.revision, dependencies, milestones };
}

/** Call inside the command transaction, after authorization and version checks. */
export function removeWorkItemRecord(id: string) {
  const db = getDatabaseContext().sqlite;
  const removedDependencies = db.prepare('SELECT * FROM dependency_edges WHERE source_work_item_id=? OR target_work_item_id=?').all(id,id);
  db.prepare(`UPDATE milestones SET confirmation_mode='manual',version=version+1,updated_at=? WHERE achieved_at IS NULL AND
    (legacy_work_item_id=? OR id IN(SELECT target_milestone_id FROM dependency_edges WHERE source_work_item_id=?))`).run(new Date().toISOString(),id,id);
  db.prepare('UPDATE milestones SET legacy_work_item_id=NULL WHERE legacy_work_item_id=?').run(id);
  db.prepare('DELETE FROM dependency_edges WHERE source_work_item_id=? OR target_work_item_id=?').run(id,id);
  // The database trigger snapshots the original ID and title before the FK is cleared.
  db.prepare('DELETE FROM work_items WHERE id=?').run(id);
  return removedDependencies;
}
