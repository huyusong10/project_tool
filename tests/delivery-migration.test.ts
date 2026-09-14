import {it,expect} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import Database from 'better-sqlite3';import {drizzle} from 'drizzle-orm/better-sqlite3';import {migrate} from 'drizzle-orm/better-sqlite3/migrator';

it('交付升级保留旧事实，只有零工作项需求采用直接执行，重复启动不重复改写',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pm-delivery-migration-')),folder=path.join(dir,'migrations'),dbPath=path.join(dir,'legacy.db');
 fs.mkdirSync(path.join(folder,'meta'),{recursive:true});
 const journal=JSON.parse(fs.readFileSync('drizzle/meta/_journal.json','utf8'));journal.entries=journal.entries.filter((e:{idx:number})=>e.idx<23);
 for(const e of journal.entries)fs.copyFileSync('drizzle/'+e.tag+'.sql',path.join(folder,e.tag+'.sql'));
 fs.writeFileSync(path.join(folder,'meta/_journal.json'),JSON.stringify(journal));
 let db=new Database(dbPath);
 try{
  migrate(drizzle(db),{migrationsFolder:folder});const now='2026-09-01T01:00:00.000Z';
  db.prepare("INSERT INTO projects(id,name,created_at,updated_at)VALUES('legacy','旧项目',?,?)").run(now,now);
  const add=db.prepare("INSERT INTO requirements(id,project_id,title,status,progress,priority,planned_start,planned_end,created_at,updated_at)VALUES(?,'legacy',?,'not_started',0,'P0','2026-09-01','2026-09-30',?,?)");
  for(const id of ['plain','split','cancelled-work'])add.run(id,id,now,now);
  db.prepare("INSERT INTO work_items(id,requirement_id,title,status,progress,created_at,updated_at)VALUES('work','split','旧工作','not_started',0,?,?)").run(now,now);
  db.prepare("INSERT INTO work_items(id,requirement_id,title,status,progress,created_at,updated_at)VALUES('cancelled','cancelled-work','取消历史','cancelled',30,?,?)").run(now,now);
  const original=db.prepare('SELECT * FROM requirements ORDER BY id').all() as Record<string,unknown>[],works=db.prepare('SELECT * FROM work_items ORDER BY id').all() as Record<string,unknown>[];db.close();
  const env={...process.env,DB_PATH:dbPath,BACKUP_DIR:path.join(dir,'backups'),SEED_DEMO:'0',APP_PASSWORD_HASH:'scrypt$test$00',SESSION_SECRET:'delivery-migration-test-secret-more-than-32-chars'};
  const start=()=>spawnSync(process.execPath,['--import','tsx','--eval',"const {sqlite}=await import('./src/server/database.ts'); sqlite.close();"],{cwd:process.cwd(),env,encoding:'utf8'});
  const first=start();expect(first.status,first.stderr).toBe(0);db=new Database(dbPath);
  const after=db.prepare('SELECT * FROM requirements ORDER BY id').all() as Record<string,unknown>[];
  for(let i=0;i<original.length;i++)for(const key of Object.keys(original[i]).filter(k=>k!=='updated_at'&&k!=='version'))expect(after[i][key],key).toEqual(original[i][key]);
  for(let i=0;i<original.length;i++){expect(after[i].version).toBe(Number(original[i].version)+1);expect(after[i].feature_id).toBeTruthy();}
  expect(after.map(r=>[r.id,r.delivery_scope,r.execution_mode,r.actual_start])).toEqual([['cancelled-work','committed','work_items',null],['plain','committed','direct',null],['split','committed','work_items',null]]);
  const afterWorks=db.prepare('SELECT * FROM work_items ORDER BY id').all() as Record<string,unknown>[];
  for(let i=0;i<works.length;i++)for(const key of Object.keys(works[i]))expect(afterWorks[i][key],key).toEqual(key==='version'?Number(works[i][key])+1:works[i][key]);
  expect(afterWorks.map(w=>w.progress_weight)).toEqual([1,1]);
  for(const row of [...after,...afterWorks])for(const field of ['forecast_review','blocked_coordinator_id','blocked_next_review_at','blocked_issue_id'])expect(row[field],field).toBeNull();
  expect(db.prepare('SELECT COUNT(*) AS n FROM delivery_commitments').get()).toEqual({n:0});
  expect(db.pragma('integrity_check')).toEqual([{integrity_check:'ok'}]);expect(db.pragma('foreign_key_check')).toEqual([]);
  const count=db.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get();db.close();
  const second=start();expect(second.status,second.stderr).toBe(0);db=new Database(dbPath);expect(db.prepare('SELECT * FROM requirements ORDER BY id').all()).toEqual(after);expect(db.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get()).toEqual(count);
 }finally{if(db.open)db.close();fs.rmSync(dir,{recursive:true,force:true});}
},15000);
