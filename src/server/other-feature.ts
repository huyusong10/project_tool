import type Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';


/** Stable system collection; the stored legacy name does not determine its identity. */
export function ensureOtherFeature(sqlite:Database.Database,projectId:string):string{
  const existing=sqlite.prepare("SELECT id,archived_at AS archivedAt FROM features WHERE project_id=? AND kind='other'").get(projectId) as {id:string;archivedAt:string|null}|undefined;
  if(existing)return existing.id;
  const id=randomUUID(),now=new Date().toISOString();
  sqlite.prepare('INSERT INTO features(id,project_id,kind,name,description,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,(SELECT coalesce(max(sort_order),-1)+1 FROM features WHERE project_id=?),?,?)').run(id,projectId,'other','其他特性','暂未归入其他特性的需求',projectId,now,now);
  sqlite.prepare("INSERT INTO audit_logs(id,actor_type,action,entity_type,entity_id,project_id,summary,created_at) VALUES(?,'system','create','feature',?,?,?,?)").run(randomUUID(),id,projectId,'创建其他特性，承接未指定特性的需求',now);
  return id;
}
