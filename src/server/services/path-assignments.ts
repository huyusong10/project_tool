import type { PathInput } from '../../shared/paths';
import { getDatabaseContext } from '../database-context';
import { chunkValues } from './support';

/** Resolve display names and assignment groups from the final snapshot, in bounded reads. */
export function refreshPathAssignments(snapshot:Pick<PathInput,'projectId'|'requirements'|'workItems'>){
  const ids=[...new Set([...snapshot.requirements.flatMap(r=>[r.ownerId,r.acceptanceOwnerId]),...snapshot.workItems.flatMap(w=>[w.ownerId,...w.assigneeIds||[]])].filter((id):id is string=>!!id))];
  const people=new Map<string,{name:string;valid:number}>();
  for(const batch of chunkValues(ids,899)){
    const rows=getDatabaseContext().sqlite.prepare(`SELECT p.id,p.name,CASE WHEN pp.project_role IN ('member','manager') AND p.active=1 AND p.deleted_at IS NULL AND a.status='active' AND a.deleted_at IS NULL THEN 1 ELSE 0 END AS valid
      FROM people p LEFT JOIN project_people pp ON pp.person_id=p.id AND pp.project_id=? LEFT JOIN accounts a ON a.person_id=p.id
      WHERE p.id IN (${batch.map(()=>'?').join(',')})`).all(snapshot.projectId,...batch) as Array<{id:string;name:string;valid:number}>;
    for(const p of rows)people.set(p.id,p);
  }
  const byRequirement=new Map<string,Map<string,string>>();
  for(const w of snapshot.workItems){
    w.ownerName=people.get(w.ownerId||'')?.name||null;
    const collaborators=[...new Set(w.assigneeIds||[])].filter(id=>id!==w.ownerId);
    collaborators.sort((a,b)=>{const x=people.get(a)?.name||'',y=people.get(b)?.name||'';return x<y?-1:x>y?1:a.localeCompare(b);});
    w.assigneeIds=[...collaborators,...w.ownerId?[w.ownerId]:[]];
    w.assigneeNames=w.assigneeIds.map(id=>people.get(id)?.name||'未命名人员');
    const group=byRequirement.get(w.requirementId)||new Map<string,string>();
    w.assigneeIds.forEach((id,i)=>group.set(id,w.assigneeNames![i]));byRequirement.set(w.requirementId,group);
  }
  for(const r of snapshot.requirements){
    r.ownerName=people.get(r.ownerId||'')?.name||null;r.ownerValid=!!people.get(r.ownerId||'')?.valid;
    r.acceptanceOwnerName=people.get(r.acceptanceOwnerId||'')?.name||null;r.acceptanceOwnerValid=!!people.get(r.acceptanceOwnerId||'')?.valid;
    r.assigneeIds=[...(byRequirement.get(r.id)?.keys()||[])];r.assigneeNames=[...(byRequirement.get(r.id)?.values()||[])];
  }
}
