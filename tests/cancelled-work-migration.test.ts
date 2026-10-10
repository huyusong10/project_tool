import {it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';

it('升级清理已有取消占位，备份、历史、依赖和里程碑一致，重复启动不再修改',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pm-cancel-migration-')),folder=path.join(dir,'migrations'),dbPath=path.join(dir,'legacy.db');
  fs.mkdirSync(path.join(folder,'meta'),{recursive:true});
  const journal=JSON.parse(fs.readFileSync('drizzle/meta/_journal.json','utf8'));
  journal.entries=journal.entries.filter((entry:{idx:number})=>entry.idx<43);
  for(const entry of journal.entries)fs.copyFileSync('drizzle/'+entry.tag+'.sql',path.join(folder,entry.tag+'.sql'));
  fs.writeFileSync(path.join(folder,'meta/_journal.json'),JSON.stringify(journal));
  let db=new Database(dbPath);
  try {
    migrate(drizzle(db),{migrationsFolder:folder});
    const now='2026-09-01T01:00:00.000Z';
    db.prepare("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p','迁移测试',?,?)").run(now,now);
    db.prepare("INSERT INTO requirements(id,project_id,title,status,progress,execution_mode,created_at,updated_at) VALUES('r','p','保留需求','in_progress',30,'work_items',?,?)").run(now,now);
    db.prepare("INSERT INTO work_items(id,requirement_id,title,status,progress,actual_start,created_at,updated_at) VALUES('old','r','历史调查','cancelled',30,'2026-08-28',?,?)").run(now,now);
    db.prepare("INSERT INTO progress_updates(id,requirement_id,work_item_id,percent,work_item_percent,content,event_type,created_at,updated_at) VALUES('note','r','old',30,30,'调查原文','progress',?,?)").run(now,now);
    db.prepare("INSERT INTO milestones(id,project_id,title,confirmation_mode,legacy_work_item_id,created_at,updated_at) VALUES('m','p','待交付','auto','old',?,?)").run(now,now);
    db.prepare("INSERT INTO dependency_edges(id,project_id,source_requirement_id,source_work_item_id,target_milestone_id,origin,created_at,updated_at) VALUES('edge','p','r','old','m','manual',?,?)").run(now,now);
    db.close();
    const env={...process.env,DB_PATH:dbPath,BACKUP_DIR:path.join(dir,'backups'),SEED_DEMO:'0',APP_PASSWORD_HASH:'scrypt$test$00',SESSION_SECRET:'cancel-migration-test-secret-more-than-32-chars'};
    const start=()=>spawnSync(process.execPath,['--import','tsx','--eval',"const {sqlite}=await (await import('./src/server/database.ts')).initializeDatabase(); sqlite.close();"],{cwd:process.cwd(),env,encoding:'utf8'});
    const first=start();expect(first.status,first.stderr).toBe(0);db=new Database(dbPath);
    expect(db.prepare('SELECT id FROM work_items').all()).toEqual([]);
    expect(db.prepare('SELECT id FROM dependency_edges').all()).toEqual([]);
    expect(db.prepare('SELECT work_item_id,deleted_work_item_id,deleted_work_item_title,content FROM progress_updates WHERE id=?').get('note')).toEqual({work_item_id:null,deleted_work_item_id:'old',deleted_work_item_title:'历史调查',content:'调查原文'});
    expect(db.prepare('SELECT status,progress,execution_mode,actual_start FROM requirements WHERE id=?').get('r')).toEqual({status:'in_progress',progress:30,execution_mode:'direct',actual_start:'2026-08-28'});
    expect(db.prepare('SELECT confirmation_mode,achieved_at,legacy_work_item_id FROM milestones WHERE id=?').get('m')).toEqual({confirmation_mode:'manual',achieved_at:null,legacy_work_item_id:null});
    expect(db.pragma('foreign_key_check')).toEqual([]);
    const records=db.prepare('SELECT * FROM progress_updates ORDER BY id').all(),requirement=db.prepare('SELECT * FROM requirements WHERE id=?').get('r');db.close();
    const second=start();expect(second.status,second.stderr).toBe(0);db=new Database(dbPath);
    expect(db.prepare('SELECT * FROM progress_updates ORDER BY id').all()).toEqual(records);
    expect(db.prepare('SELECT * FROM requirements WHERE id=?').get('r')).toEqual(requirement);
    const backups=fs.readdirSync(path.join(dir,'backups')).filter(name=>name.endsWith('.db'));expect(backups).toHaveLength(1);
    const backup=new Database(path.join(dir,'backups',backups[0]),{readonly:true});try{expect(backup.prepare('SELECT title FROM work_items WHERE id=?').get('old')).toEqual({title:'历史调查'});}finally{backup.close();}
  } finally {if(db.open)db.close();fs.rmSync(dir,{recursive:true,force:true});}
},15000);
