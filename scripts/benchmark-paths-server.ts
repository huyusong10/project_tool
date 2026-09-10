import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
const directory=path.resolve('.preview');if(path.basename(process.cwd())!=='project-manage-paths')throw new Error('只能在隔离工作区运行');fs.mkdirSync(directory,{recursive:true});
const dbPath=path.join(directory,`benchmark-${randomUUID()}.db`);Object.assign(process.env,{DB_PATH:dbPath,BACKUP_DIR:path.join(directory,'benchmark-backups'),SEED_DEMO:'0'});
const {sqlite}=await import('../src/server/database');const {getPathAnalysis}=await import('../src/server/services/paths');
const now=new Date().toISOString(),day='2026-09-07';
try{
 sqlite.transaction(()=>{
  sqlite.prepare('INSERT INTO projects(id,name,planned_end,created_at,updated_at)VALUES(?,?,?,?,?)').run('p','服务端性能验证','2026-12-31',now,now);
  const r=sqlite.prepare("INSERT INTO requirements(id,project_id,title,status,planned_start,planned_end,dependencies_reviewed_at,created_at,updated_at)VALUES(?,'p',?,'not_started',?,'2026-09-30',?,?,?)");
  for(let i=0;i<100;i++)r.run(`r${i}`,`需求${i}`,day,now,now,now);
  const w=sqlite.prepare("INSERT INTO work_items(id,requirement_id,title,status,planned_start,planned_end,duration_days,created_at,updated_at)VALUES(?,?,?,'not_started',?,?,1,?,?)");
  for(let i=0;i<2000;i++)w.run(`w${i}`,`r${Math.floor(i/20)}`,`工作${i}`,day,day,now,now);
  sqlite.prepare('UPDATE requirements SET dependencies_reviewed_at=?').run(now);
  const e=sqlite.prepare("INSERT INTO dependency_edges(id,project_id,source_requirement_id,source_work_item_id,target_requirement_id,target_work_item_id,origin,created_at,updated_at)VALUES(?,'p',?,?,?,?,'manual',?,?)");let count=0;
  for(let i=1;i<2000;i++)for(const d of [1,3,7])if(i>=d){e.run(`e${count++}`,`r${Math.floor((i-d)/20)}`,`w${i-d}`,`r${Math.floor(i/20)}`,`w${i}`,now,now);}
  for(let i=12;count<6000;i++)e.run(`e${count++}`,`r${Math.floor((i-11)/20)}`,`w${i-11}`,`r${Math.floor(i/20)}`,`w${i}`,now,now);
 })();
 const measure=()=>{const values:number[]=[];for(let i=0;i<21;i++){const start=performance.now();JSON.stringify(getPathAnalysis('p','project',day));if(i)values.push(performance.now()-start);}values.sort((a,b)=>a-b);return {samples:values.length,p50Ms:+values[10].toFixed(1),p95Ms:+values[18].toFixed(1),maxMs:+values[19].toFixed(1)};};
 const serial=measure();sqlite.prepare("UPDATE work_items SET status='in_progress',actual_start=?,duration_days=NULL,planned_end=NULL").run(day);const unestimated=measure();
 const result={measuredAt:new Date().toISOString(),device:{cpu:os.cpus()[0].model,logicalCpus:os.cpus().length,memoryGiB:Math.round(os.totalmem()/2**30),node:process.version},workItems:2000,dependencies:6000,includes:'SQLite完整快照、项目关键路径、依赖影响汇总、JSON序列化；单进程顺序采样',serial,unestimated};fs.mkdirSync('.preview/qa',{recursive:true});fs.writeFileSync('.preview/qa/server-performance.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 if(serial.p95Ms>1000||unestimated.p95Ms>1000)process.exitCode=1;
}finally{sqlite.close();for(const suffix of ['','-wal','-shm'])fs.rmSync(dbPath+suffix,{force:true});}
