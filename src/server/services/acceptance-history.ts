import { randomUUID } from 'node:crypto';
import { getDatabaseContext } from '../database-context';

/** Preserve an existing acceptance date before rework clears the current state. Never infer dates from text. */
export function preserveRecordedAcceptance(id:string) {
  const r=getDatabaseContext().sqlite.prepare('SELECT accepted_at AS acceptedAt,accepted_by_account_id AS accountId FROM requirements WHERE id=?').get(id) as {acceptedAt:string|null;accountId:string|null};
  if(!r?.acceptedAt||getDatabaseContext().sqlite.prepare("SELECT 1 FROM progress_updates WHERE requirement_id=? AND work_item_id IS NULL AND event_type='accept' LIMIT 1").get(id))return;
  getDatabaseContext().sqlite.prepare("INSERT INTO progress_updates(id,requirement_id,percent,content,event_type,created_by_account_id,created_at,updated_at) VALUES (?,?,100,?,'accept',?,?,?)")
    .run(randomUUID(),id,'保留原已记录的验收日期',r.accountId,r.acceptedAt,r.acceptedAt);
}

export function loadAcceptanceHistory(projectId:string) {
  return getDatabaseContext().sqlite.prepare(`SELECT p.requirement_id AS requirementId,p.event_type AS eventType,p.created_at AS occurredAt
    FROM progress_updates p JOIN requirements r ON r.id=p.requirement_id
    WHERE r.project_id=? AND p.work_item_id IS NULL AND p.event_type IN ('accept','rework','reopen')
    ORDER BY p.created_at,p.rowid`).all(projectId) as Array<{requirementId:string;eventType:string;occurredAt:string}>;
}

export function firstAcceptanceDates(projectId:string){
  const dates=new Map<string,string>();
  for(const e of loadAcceptanceHistory(projectId))if(e.eventType==='accept'&&!dates.has(e.requirementId))dates.set(e.requirementId,e.occurredAt);
  return dates;
}
