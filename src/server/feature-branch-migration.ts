import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type Database from 'better-sqlite3';

/** The dev branch shipped a later timestamp before the feature branch was merged. */
export function reconcileFeatureBranch(sqlite:Database.Database,folder:string){
  if(!sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE name='__drizzle_migrations'").get())return;
  const latest=Number((sqlite.prepare('SELECT MAX(created_at) AS time FROM __drizzle_migrations').get() as {time:number}).time);
  if(latest<1789140000000)return;
  sqlite.transaction(()=>{
    for(const [column,file,time] of [
      ['expectation','0027_group_overview',1789092000000],
      ['description','0028_feature_planning',1789092000001],
    ] as const){
      const columns=sqlite.pragma('table_info(requirement_groups)') as {name:string}[];
      if(columns.some(c=>c.name===column))continue;
      const sql=fs.readFileSync(path.join(folder,file+'.sql'),'utf8');
      sqlite.exec(sql);
      sqlite.prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES(?,?)').run(createHash('sha256').update(sql).digest('hex'),time);
    }
  }).immediate();
}
