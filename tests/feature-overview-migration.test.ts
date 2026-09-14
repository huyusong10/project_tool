import { expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

it.each([27,28])('迁移 %i 保留原 ID、需求和已有评估，重复迁移不覆盖资料',(cutoff)=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pm-overview-migration-')),folder=path.join(directory,'migrations');fs.mkdirSync(path.join(folder,'meta'),{recursive:true});
  const journal=JSON.parse(fs.readFileSync('drizzle/meta/_journal.json','utf8'));journal.entries=journal.entries.filter((entry:{idx:number})=>entry.idx<cutoff);
  for(const entry of journal.entries)fs.copyFileSync('drizzle/'+entry.tag+'.sql',path.join(folder,entry.tag+'.sql'));
  fs.writeFileSync(path.join(folder,'meta/_journal.json'),JSON.stringify(journal));const db=new Database(path.join(directory,'legacy.db'));
  try {
    migrate(drizzle(db),{migrationsFolder:folder});const now='2026-09-10T00:00:00Z';
    db.prepare("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p','项目',?,?)").run(now,now);
    db.prepare("INSERT INTO requirement_groups(id,project_id,name,sort_order,version,created_at,updated_at) VALUES('g','p','大特性',2,7,?,?)").run(now,now);
    db.prepare("INSERT INTO requirements(id,project_id,group_id,title,created_at,updated_at) VALUES('r','p','g','需求',?,?)").run(now,now);
    if(cutoff===28)db.prepare("UPDATE requirement_groups SET expectation='已有预期',progress_summary='已有进展',assessment='off_track',assessment_note='已有原因',assessed_at=?").run(now);
    const group=db.prepare('SELECT * FROM requirement_groups').get() as Record<string,unknown>,requirement=db.prepare('SELECT * FROM requirements').get();
    migrate(drizzle(db),{migrationsFolder:'drizzle'});const migrated=db.prepare('SELECT * FROM features').get() as Record<string,unknown>;
    for(const [key,value] of Object.entries(group))expect(migrated[key]).toEqual(value);
    expect(migrated).toMatchObject({description:'',archived_at:null,...(cutoff===27?{expectation:'',progress_summary:'',assessment:'pending',assessment_note:'',assessed_at:null,assessed_by:null}:{expectation:'已有预期',progress_summary:'已有进展',assessment:'off_track',assessment_note:'已有原因',assessed_at:now})});expect(db.prepare('SELECT * FROM requirements').get()).toMatchObject(Object.fromEntries(Object.entries(requirement as Record<string,unknown>).map(([key,value])=>[key==='group_id'?'feature_id':key,value])));
    db.prepare("UPDATE features SET expectation='季度试用',assessment='off_track'").run();
    migrate(drizzle(db),{migrationsFolder:'drizzle'});expect(db.prepare('SELECT expectation,assessment FROM features').get()).toEqual({expectation:'季度试用',assessment:'off_track'});
    expect(db.pragma('foreign_key_check')).toEqual([]);expect(db.pragma('integrity_check')).toEqual([{integrity_check:'ok'}]);
  } finally {db.close();expect(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep)).toBe(true);fs.rmSync(directory,{recursive:true,force:true});}
});
