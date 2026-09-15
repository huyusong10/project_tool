import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {initializeWorkspaceOrder} from '../src/server/workspace-migration';

// Read a consistent SQLite snapshot, including committed WAL contents. Never migrate the source.
const sourcePath=path.resolve(process.argv[2]||''),outputDir=path.resolve('.preview');
if(!process.argv[2]||!fs.existsSync(sourcePath))throw new Error('请指定要验证的旧数据库文件');
fs.mkdirSync(outputDir,{recursive:true});
const snapshotPath=path.join(outputDir,'workspace-migration-'+Date.now()+'.db');
const source=new Database(sourcePath,{readonly:true});
try{await source.backup(snapshotPath);}finally{source.close();}
const db=new Database(snapshotPath);
try{
  const tables=['features','requirements','feature_phases','phase_deliveries','feature_relations','diagram_layouts','dependency_edges','work_items','progress_updates','delivery_commitments'];
  const existing=tables.filter(name=>db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name));
  const snapshots=existing.map(name=>({name,columns:(db.prepare('PRAGMA table_info("'+name+'")').all() as Array<{name:string}>).map(c=>c.name).filter(c=>!(name==='features'&&['version','archived_at'].includes(c))),rows:[] as unknown[]}));
  for(const t of snapshots)t.rows=db.prepare('SELECT '+t.columns.map(c=>'"'+c+'"').join(',')+' FROM "'+t.name+'" ORDER BY '+t.columns.map(c=>'"'+c+'"').join(',')).all();
  const otherBefore=db.prepare("SELECT id,project_id,(SELECT count(*) FROM requirements r WHERE r.feature_id=f.id) AS requirements FROM features f WHERE name='其他特性'").all();
  migrate(drizzle(db),{migrationsFolder:'drizzle'});initializeWorkspaceOrder(db);
  for(const t of snapshots)assert.deepEqual(db.prepare('SELECT '+t.columns.map(c=>'"'+c+'"').join(',')+' FROM "'+t.name+'" ORDER BY '+t.columns.map(c=>'"'+c+'"').join(',')).all(),t.rows,t.name+' 旧字段必须完整保留');
  assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.deepEqual(db.pragma('integrity_check'),[{integrity_check:'ok'}]);
  const first=db.prepare('SELECT id,kind FROM features ORDER BY id').all(),order=db.prepare('SELECT id,sort_order FROM requirements ORDER BY id').all();
  migrate(drizzle(db),{migrationsFolder:'drizzle'});initializeWorkspaceOrder(db);
  assert.deepEqual(db.prepare('SELECT id,kind FROM features ORDER BY id').all(),first);assert.deepEqual(db.prepare('SELECT id,sort_order FROM requirements ORDER BY id').all(),order);
  const result={snapshot:snapshotPath,checkedTables:snapshots.map(t=>({table:t.name,rows:t.rows.length})),systemCollections:otherBefore,integrity:'ok',references:'preserved',repeatMigration:'unchanged'};
  fs.writeFileSync(path.join(outputDir,'workspace-migration-validation.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{db.close();}
