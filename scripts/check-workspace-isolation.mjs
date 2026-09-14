import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
const root=process.cwd(),preview=path.join(root,'.preview');
if(path.basename(root)!=='project-manage-workspace')throw Error('只能校验隔离 worktree');
const baseline=JSON.parse(fs.readFileSync(path.join(preview,'isolation-baseline.json'),'utf8'));
const snapshot=new Database(path.join(preview,'source-snapshot.db'),{readonly:true});
const database=new Database(path.join(preview,'workspace.db'),{readonly:true});
try{
  const integrity=database.pragma('integrity_check'),foreignKeys=database.pragma('foreign_key_check');
  const preserved=[];
  for(const {name} of snapshot.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()){
    const table='"'+name.replaceAll('"','""')+'"';
    if(!snapshot.prepare('PRAGMA table_info('+table+')').all().some(c=>c.name==='id'))continue;
    const references=[...new Set(snapshot.prepare('PRAGMA foreign_key_list('+table+')').all().map(f=>f.from))];
    const columns=['id',...references].map(column=>'"'+column.replaceAll('"','""')+'"').join(',');
    const before=snapshot.prepare('SELECT '+columns+' FROM '+table).all(),after=new Map(database.prepare('SELECT '+columns+' FROM '+table).all().map(r=>[r.id,r]));
    preserved.push({table:name,sourceIds:before.length,missingIds:before.filter(r=>!after.has(r.id)).length,changedReferences:before.filter(r=>after.has(r.id)&&references.some(column=>r[column]!==after.get(r.id)[column])).length});
  }
  const services=[];
  for(const old of baseline.services){const response=await fetch('http://127.0.0.1:'+old.port+'/');const sha=createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');services.push({port:old.port,status:response.status,indexUnchanged:sha===old.indexSha256});}
  const report={checkedAt:new Date().toISOString(),integrity,foreignKeys,preserved,services};
  fs.writeFileSync(path.join(preview,'migration-validation.json'),JSON.stringify(report,null,2));
  if(foreignKeys.length||integrity[0].integrity_check!=='ok'||preserved.some(t=>t.missingIds||t.changedReferences)||services.some(s=>!s.indexUnchanged))throw Error('校验未通过，请检查 .preview/migration-validation.json');
  console.log(JSON.stringify({integrity:'ok',foreignKeyErrors:0,tablesChecked:preserved.length,preservedIds:preserved.reduce((n,t)=>n+t.sourceIds,0),services}));
}finally{snapshot.close();database.close();}
