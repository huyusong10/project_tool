import {it,expect} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import Database from 'better-sqlite3';import {drizzle} from 'drizzle-orm/better-sqlite3';import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
it('来源升级保留全部旧字段与承诺，默认未分组且不生成来源，再次迁移无变化',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pm-intake-migration-')),folder=path.join(dir,'migrations');fs.mkdirSync(path.join(folder,'meta'),{recursive:true});
  const journal=JSON.parse(fs.readFileSync('drizzle/meta/_journal.json','utf8'));journal.entries=journal.entries.filter((e:{idx:number})=>e.idx<25);
  for(const e of journal.entries)fs.copyFileSync('drizzle/'+e.tag+'.sql',path.join(folder,e.tag+'.sql'));
  fs.writeFileSync(path.join(folder,'meta/_journal.json'),JSON.stringify(journal));const db=new Database(path.join(dir,'legacy.db'));
  try{
    migrate(drizzle(db),{migrationsFolder:folder});const now='2026-09-01T01:00:00.000Z';
    db.prepare("INSERT INTO projects(id,name,created_at,updated_at)VALUES('p','旧项目',?,?)").run(now,now);
    db.prepare("INSERT INTO requirements(id,project_id,title,status,progress,accepted_at,reference_url,created_at,updated_at)VALUES('r','p','已验收交付','completed',100,?,'https://example.com/legacy',?,?)").run(now,now,now);
    db.prepare("INSERT INTO delivery_commitments(id,project_id,confirmed_at,snapshot)VALUES('c','p',?,'{}')").run(now);
    const before=db.prepare('SELECT * FROM requirements').get() as Record<string,unknown>,commitments=db.prepare('SELECT * FROM delivery_commitments').all();
    migrate(drizzle(db),{migrationsFolder:'drizzle'});const after=db.prepare('SELECT * FROM requirements').get() as Record<string,unknown>;
    for(const key of Object.keys(before))expect(after[key],key).toEqual(before[key]);expect(after.group_id).toBeNull();expect(after.tags).toBe('[]');
    expect(db.prepare('SELECT * FROM delivery_commitments').all()).toEqual(commitments);expect(db.prepare('SELECT count(*) n FROM source_documents').get()).toEqual({n:0});
    migrate(drizzle(db),{migrationsFolder:'drizzle'});expect(db.prepare('SELECT * FROM requirements').get()).toEqual(after);expect(db.pragma('foreign_key_check')).toEqual([]);expect(db.pragma('integrity_check')).toEqual([{integrity_check:'ok'}]);
  }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
