import { todayIso } from '../../shared/domain';
import { createHash } from 'node:crypto';
import { getDatabaseContext } from '../database-context';
import type { Actor } from '../auth';
import { assertProjectReadable, requireAuthorizationActor } from '../authorization';

/** Read revision metadata only; background checks never run path analysis. */
export function projectChangeVersion(projectId:string,actor:Actor) {
  assertProjectReadable(requireAuthorizationActor(actor),projectId);
  return getDatabaseContext().sqlite.transaction(()=>{
    const project=getDatabaseContext().sqlite.prepare('SELECT analysis_revision,updated_at FROM projects WHERE id=?').get(projectId);
    const aggregate=(table:string,where:string)=>getDatabaseContext().sqlite.prepare(`SELECT count(*) n,max(updated_at) updated FROM ${table} WHERE ${where}`).get(projectId);
    const members=getDatabaseContext().sqlite.prepare(`SELECT pp.person_id,pp.project_role,p.updated_at AS person_updated,p.active,p.deleted_at AS person_deleted,a.updated_at AS account_updated,a.status,a.deleted_at AS account_deleted FROM project_people pp
      JOIN people p ON p.id=pp.person_id LEFT JOIN accounts a ON a.person_id=p.id WHERE pp.project_id=? ORDER BY pp.person_id`).all(projectId);
    // Each mutable object has its own revision. A global maximum timestamp can hide an edit.
    const issues=getDatabaseContext().sqlite.prepare('SELECT id,version FROM issues WHERE project_id=? ORDER BY id').all(projectId);
    const templates=getDatabaseContext().sqlite.prepare('SELECT id,updated_at FROM work_item_templates WHERE project_id=? ORDER BY id').all(projectId);
    const layouts=getDatabaseContext().sqlite.prepare('SELECT scope,direction,version FROM diagram_layouts WHERE project_id=? ORDER BY scope,direction').all(projectId);
    const values=[todayIso(),project,members,issues,templates,
      aggregate('progress_updates','requirement_id IN (SELECT id FROM requirements WHERE project_id=?)'),
      aggregate('issue_updates','issue_id IN (SELECT id FROM issues WHERE project_id=?)'),layouts];
    return {version:createHash('sha256').update(JSON.stringify(values)).digest('hex')};
  })();
}
