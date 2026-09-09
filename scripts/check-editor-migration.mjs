import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {createHash} from 'node:crypto';
assert.equal(path.basename(process.cwd()),'project-manage-paths');
if(process.argv.includes('--verify-live')){
 const record=JSON.parse(fs.readFileSync('.preview/qa/editor-migration.json','utf8'));
 assert.ok(path.resolve(record.backup).startsWith(path.resolve('.preview/backups')+path.sep));
 const old=new Database(record.backup,{readonly:true}),live=new Database('.preview/paths.db',{readonly:true});
 const originalCounts={};
 for(const table of ['requirements','work_items','dependency_edges','work_item_templates','template_items','progress_updates','audit_logs']){
  const columns=old.pragma('table_info('+table+')').map(c=>c.name),rows=old.prepare('SELECT * FROM '+table+' ORDER BY id').all();originalCounts[table]=rows.length;
  const read=live.prepare('SELECT '+columns.map(c=>'"'+c+'"').join(',')+' FROM '+table+' WHERE id=?');
  for(const row of rows)assert.deepEqual(read.get(row.id),row,table+':'+row.id+' changed during deployment');
 }
 assert.deepEqual(live.pragma('foreign_key_check'),[]);assert.equal(live.pragma('integrity_check')[0].integrity_check,'ok');
 const result={checkedAt:new Date().toISOString(),backup:record.backup,originalCounts,oldRowsUnchanged:true,foreignKeys:'ok',integrity:'ok',milestones:live.prepare('SELECT COUNT(*) AS n FROM milestones').get().n};
 old.close();live.close();fs.writeFileSync('.preview/qa/editor-live-upgrade.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exit(0);
}

const stamp=Date.now(),backup=path.resolve('.preview/backups/editor-before-'+stamp+'.db'),copy=path.resolve('.preview/qa/editor-migration-'+stamp+'.db');
fs.mkdirSync(path.dirname(copy),{recursive:true});const live=new Database('.preview/paths.db',{readonly:true});await live.backup(backup);live.close();fs.copyFileSync(backup,copy);
const db=new Database(copy),tables=['requirements','work_items','dependency_edges','work_item_templates','template_items','progress_updates','audit_logs'];
const before=Object.fromEntries(tables.map(table=>[table,{columns:db.pragma('table_info('+table+')').map(c=>c.name),rows:db.prepare('SELECT * FROM '+table+' ORDER BY id').all()}]));
const run=()=>{db.pragma('foreign_keys=OFF');try{migrate(drizzle(db),{migrationsFolder:'drizzle'});}finally{db.pragma('foreign_keys=ON');}};run();
for(const [table,{columns,rows}] of Object.entries(before)){
 const query=db.prepare('SELECT '+columns.map(c=>'"'+c+'"').join(',')+' FROM '+table+' WHERE id=?');
 for(const row of rows)assert.deepEqual(query.get(row.id),row,table+':'+row.id+' changed historical fields');
}
const milestones=db.prepare('SELECT id,legacy_work_item_id AS source,template_item_id AS template FROM milestones ORDER BY id').all();
assert.equal(milestones.filter(m=>m.source).length,before.work_items.rows.filter(w=>w.milestone_label?.trim()).length);
assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.equal(db.pragma('integrity_check')[0].integrity_check,'ok');
const counts=()=>Object.fromEntries([...tables,'milestones','diagram_layouts'].map(t=>[t,db.prepare('SELECT COUNT(*) AS n FROM '+t).get().n]));const once=counts();run();assert.deepEqual(counts(),once);
const result={checkedAt:new Date().toISOString(),backup,copy,counts:once,legacyMilestones:milestones.length,oldRowsUnchanged:true,repeatMigrationUnchanged:true,foreignKeys:'ok',integrity:'ok',historicalHash:createHash('sha256').update(JSON.stringify(before)).digest('hex')};db.close();fs.writeFileSync('.preview/qa/editor-migration.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
