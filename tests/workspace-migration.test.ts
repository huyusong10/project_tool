import {it,expect} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import Database from 'better-sqlite3';import {drizzle} from 'drizzle-orm/better-sqlite3';import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {initializeWorkspaceOrder} from '../src/server/workspace-migration';
it('系统归类迁移保留历史 Phase、交付快照、依赖和原 ID',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pm-workspace-migration-')),folder=path.join(dir,'migrations');fs.mkdirSync(path.join(folder,'meta'),{recursive:true});
  const journal=JSON.parse(fs.readFileSync('drizzle/meta/_journal.json','utf8'));journal.entries=journal.entries.filter((e:{idx:number})=>e.idx<34);
  for(const e of journal.entries)fs.copyFileSync('drizzle/'+e.tag+'.sql',path.join(folder,e.tag+'.sql'));fs.writeFileSync(path.join(folder,'meta/_journal.json'),JSON.stringify(journal));
  const db=new Database(':memory:');try{
    migrate(drizzle(db),{migrationsFolder:folder});const now='2026-09-01T01:00:00.000Z';
    db.prepare("INSERT INTO projects(id,name,created_at,updated_at)VALUES('p','项目',?,?)").run(now,now);
    for(const [id,name] of [['f','其他特性'],['f2','正常特性']])db.prepare('INSERT INTO features(id,project_id,name,created_at,updated_at)VALUES(?,?,?,?,?)').run(id,'p',name,now,now);
    db.prepare("INSERT INTO feature_phases(id,project_id,feature_id,name,created_at,updated_at)VALUES('phase','p','f','历史批次',?,?)").run(now,now);
    db.prepare("INSERT INTO requirements(id,project_id,feature_id,phase_id,title,status,progress,created_at,updated_at)VALUES('r','p','f','phase','已交付需求','completed',100,?,?)").run(now,now);
    db.prepare("INSERT INTO feature_relations(id,project_id,source_feature_id,target_feature_id,created_at,updated_at)VALUES('rel','p','f','f2',?,?)").run(now,now);
    db.prepare("UPDATE feature_phases SET delivered_at=? WHERE id='phase'").run(now);
    db.prepare("INSERT INTO phase_deliveries(id,phase_id,delivered_at,snapshot,created_at)VALUES('delivery','phase',?,'{\"requirementIds\":[\"r\"]}',?)").run(now,now);
    const before=['phase_deliveries','feature_phases','feature_relations','requirements'].map(t=>({name:t,rows:db.prepare('SELECT * FROM '+t).all()}));
    migrate(drizzle(db),{migrationsFolder:'drizzle'});initializeWorkspaceOrder(db);
    expect(db.prepare("SELECT id,kind FROM features WHERE id='f'").get()).toEqual({id:'f',kind:'other'});
    for(const t of before){const rows=db.prepare('SELECT * FROM '+t.name).all();for(const [index,row] of t.rows.entries())expect(rows[index]).toMatchObject(row as object);}
    const state=db.prepare('SELECT * FROM requirements').all();migrate(drizzle(db),{migrationsFolder:'drizzle'});initializeWorkspaceOrder(db);expect(db.prepare('SELECT * FROM requirements').all()).toEqual(state);expect(db.pragma('foreign_key_check')).toEqual([]);
  }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
