import {expect,it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {reconcileFeatureBranch} from '../src/server/feature-branch-migration';

it.each(['dev','feature','empty'])('合并后的迁移兼容 %s 数据库，保留 ID、评估及工作项资料',branch=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'pm-branch-migration-')),db=new Database(':memory:');
  try{
    const journal=JSON.parse(fs.readFileSync('drizzle/meta/_journal.json','utf8'));
    const entries=journal.entries.filter((e:{idx:number})=>e.idx<27||branch==='dev'&&e.idx===29||branch==='feature'&&e.idx<29);
    fs.mkdirSync(path.join(folder,'meta'));fs.writeFileSync(path.join(folder,'meta/_journal.json'),JSON.stringify({...journal,entries}));
    for(const e of entries)fs.copyFileSync('drizzle/'+e.tag+'.sql',path.join(folder,e.tag+'.sql'));
    if(branch!=='empty'){
      migrate(drizzle(db),{migrationsFolder:folder});
      db.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p','项目','2026-09-11','2026-09-11'); INSERT INTO requirement_groups(id,project_id,name,created_at,updated_at) VALUES('g','p','特性','2026-09-11','2026-09-11');");
      if(branch==='feature')db.exec("UPDATE requirement_groups SET expectation='保留预期',assessment='off_track',assessed_at='2026-09-11'");
    }
    const before=branch==='empty'?null:db.prepare('SELECT * FROM requirement_groups').get() as Record<string,unknown>;
    for(let i=0;i<2;i++){
      reconcileFeatureBranch(db,'drizzle');migrate(drizzle(db),{migrationsFolder:'drizzle'});
      if(before){const group=db.prepare('SELECT * FROM requirement_groups').get();expect(group).toMatchObject(before);}
      expect(db.prepare('SELECT id FROM feature_relations').all()).toEqual([]);
      expect((db.pragma('table_info(work_items)') as {name:string}[]).some(c=>c.name==='progress_weight')).toBe(true);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    }
  }finally{db.close();fs.rmSync(folder,{recursive:true,force:true});}
});
