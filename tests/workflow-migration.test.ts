import {it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';

it('简化迁移保留原文、执行日期、依赖、布局和历史，重复启动不重复迁移',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pm-workflow-migration-')),folder=path.join(directory,'legacy');
 fs.mkdirSync(path.join(folder,'meta'),{recursive:true});
 const journal=JSON.parse(fs.readFileSync('drizzle/meta/_journal.json','utf8'));
 journal.entries=journal.entries.filter((e:{idx:number})=>e.idx<26);
 for(const entry of journal.entries)fs.copyFileSync('drizzle/'+entry.tag+'.sql',path.join(folder,entry.tag+'.sql'));
 fs.writeFileSync(path.join(folder,'meta/_journal.json'),JSON.stringify(journal));
 const db=new Database(path.join(directory,'legacy.db')),now='2026-09-04T10:00:00.000Z';
 try {
  migrate(drizzle(db),{migrationsFolder:folder});
  db.prepare("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p','迁移验证',?,?)").run(now,now);
  const req=db.prepare('INSERT INTO requirements(id,project_id,title,status,progress,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
  req.run('r','p','已完成工作待确认','pending_acceptance',100,now,now);
  req.run('waiting','p','原始未安排需求','planning',0,now,now);
  req.run('blocked','p','等待环境','blocked',25,now,now);
  const work=db.prepare('INSERT INTO work_items(id,requirement_id,title,status,progress,planned_start,planned_end,actual_start,actual_end,blocked_at,blocked_reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
  work.run('w','r','实现','completed',100,'2026-08-19','2026-08-28','2026-08-19','2026-08-28',null,null,now,now);
  work.run('b','blocked','联调','blocked',25,'2026-09-01','2026-09-10','2026-09-01',null,now,'等待原始系统恢复',now,now);
  db.prepare("INSERT INTO dependency_edges(id,project_id,source_requirement_id,source_work_item_id,target_requirement_id,target_work_item_id,origin,created_at,updated_at) VALUES('edge','p','r','w','blocked','b','manual',?,?)").run(now,now);
  db.prepare("INSERT INTO diagram_layouts(project_id,scope,direction,positions,version,updated_at) VALUES('p','requirement:r','right','{\"w\":{\"x\":123,\"y\":456},\"acceptance:r\":{\"x\":500,\"y\":456}}',3,?)").run(now);
  db.prepare("INSERT INTO source_documents(id,project_id,source_key,title,url,source_version,created_at,updated_at) VALUES('doc','p','MPS','原始需求文档','https://example.com/original','v7',?,?)").run(now,now);
  db.prepare("INSERT INTO source_clauses(id,document_id,source_key,current_revision_id,created_at,updated_at) VALUES('clause','doc','REQ-36','rev',?,?)").run(now,now);
  db.prepare("INSERT INTO source_revisions(id,clause_id,document_version,section,external_id,title,content,priority,created_at) VALUES('rev','clause','v7','登录','REQ-36','认证','必须支持用户登录和退出','P1',?)").run(now);
  db.prepare("INSERT INTO source_links(id,clause_id,requirement_id,work_item_id,scope,reviewed_revision_id,created_at,updated_at) VALUES('link','clause','r','w','用户认证全部范围','rev',?,?)").run(now,now);
  db.prepare("INSERT INTO delivery_commitments(id,project_id,confirmed_at,snapshot) VALUES('history','p',?,'{\"original\":true}')").run(now);
  const unchanged=['dependency_edges','diagram_layouts','source_documents','source_clauses','source_revisions','source_links','delivery_commitments'];
  const before=Object.fromEntries(unchanged.map(table=>[table,db.prepare('SELECT * FROM '+table).all()]));
  db.pragma('foreign_keys=OFF');migrate(drizzle(db),{migrationsFolder:'drizzle'});db.pragma('foreign_keys=ON');
  expect(db.prepare('SELECT id,status FROM requirements ORDER BY id').all()).toEqual([{id:'blocked',status:'in_progress'},{id:'r',status:'completed'},{id:'waiting',status:'not_started'}]);
  expect(db.prepare("SELECT status,progress,actual_start,actual_end,blocked_reason FROM work_items WHERE id='b'").get()).toEqual({status:'in_progress',progress:25,actual_start:'2026-09-01',actual_end:null,blocked_reason:null});
  const completed=db.prepare("SELECT accepted_at,source_notes FROM requirements WHERE id='r'").get() as {accepted_at:null;source_notes:string};
  expect(completed.accepted_at).toBeNull();
  for(const original of ['REQ-36','v7','https://example.com/original','必须支持用户登录和退出','用户认证全部范围','实现'])expect(completed.source_notes).toContain(original);
  expect(db.prepare("SELECT actual_end FROM work_items WHERE id='w'").get()).toEqual({actual_end:'2026-08-28'});
  expect(JSON.stringify(db.prepare("SELECT summary FROM audit_logs WHERE action='workflow_migration'").all())).toContain('等待原始系统恢复');
  for(const table of unchanged)expect(db.prepare('SELECT * FROM '+table).all(),table).toEqual(before[table]);
  const after=db.serialize();migrate(drizzle(db),{migrationsFolder:'drizzle'});expect(db.serialize()).toEqual(after);
  expect(db.pragma('foreign_key_check')).toEqual([]);expect(db.pragma('integrity_check')).toEqual([{integrity_check:'ok'}]);
 } finally {db.close();fs.rmSync(directory,{recursive:true,force:true});}
});
