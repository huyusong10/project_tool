import type Database from 'better-sqlite3';
import {compareProgressTitles} from '../shared/progress-query';

/** SQL 增加列后，按现有的中文／编号自然顺序初始化。只处理尚未赋值的旧记录。 */
export function initializeWorkspaceOrder(database:Database.Database){
  database.transaction(()=>{
    const pending=database.prepare('SELECT id,title,feature_id AS featureId,phase_id AS phaseId FROM requirements WHERE sort_order=-1').all() as Array<{id:string;title:string;featureId:string|null;phaseId:string|null}>;
    const groups=new Map<string,typeof pending>();
    for(const row of pending){const key=JSON.stringify([row.featureId,row.phaseId]);groups.set(key,[...groups.get(key)||[],row]);}
    for(const items of groups.values()){
      let order=(database.prepare('SELECT coalesce(max(sort_order),-1) AS value FROM requirements WHERE feature_id IS ? AND phase_id IS ?').get(items[0].featureId,items[0].phaseId) as {value:number}).value+1;
      for(const row of items.sort(compareProgressTitles))database.prepare('UPDATE requirements SET sort_order=? WHERE id=?').run(order++,row.id);
    }
  }).immediate();
}
