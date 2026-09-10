import {todayIso} from '../../shared/domain';
import {createHash} from 'node:crypto';
import {sqlite} from '../database';
import type {Actor} from '../auth';
import {assertProjectReadable,requireAuthorizationActor} from '../authorization';

/** Read only small revision aggregates; never run path analysis for a background check. */
export function projectChangeVersion(projectId:string,actor:Actor) {
  assertProjectReadable(requireAuthorizationActor(actor),projectId);
  return sqlite.transaction(()=>{
    const project=sqlite.prepare('SELECT analysis_revision,updated_at FROM projects WHERE id=?').get(projectId);
    const aggregate=(table:string,where:string)=>sqlite.prepare(`SELECT count(*) n,max(updated_at) updated FROM ${table} WHERE ${where}`).get(projectId);
    const members=sqlite.prepare(`SELECT pp.person_id,pp.project_role,p.updated_at AS person_updated,p.active,p.deleted_at AS person_deleted,a.updated_at AS account_updated,a.status,a.deleted_at AS account_deleted FROM project_people pp
      JOIN people p ON p.id=pp.person_id LEFT JOIN accounts a ON a.person_id=p.id WHERE pp.project_id=? ORDER BY pp.person_id`).all(projectId);
    const values=[todayIso(),project,members,aggregate('issues','project_id=?'),aggregate('work_item_templates','project_id=?'),
      aggregate('progress_updates','requirement_id IN (SELECT id FROM requirements WHERE project_id=?)'),
      aggregate('issue_updates','issue_id IN (SELECT id FROM issues WHERE project_id=?)'),aggregate('diagram_layouts','project_id=?')];
    return {version:createHash('sha256').update(JSON.stringify(values)).digest('hex')};
  })();
}
