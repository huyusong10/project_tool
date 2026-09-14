import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';

const root=fs.realpathSync(process.cwd()),preview=path.join(root,'.preview');
if(path.basename(root)!=='project-manage-workspace')throw new Error('只能在项目工作区隔离 worktree 执行');
fs.mkdirSync(preview,{recursive:true});
const configFile=path.join(preview,'preview-env.json');
if(fs.existsSync(configFile))throw new Error('隔离配置已存在，保留现有预览数据');
const sourceRoot=path.resolve(root,'../project-manage'),sourceEnv=dotenv.parse(fs.readFileSync(path.join(sourceRoot,'.env')));
const sourcePath=path.resolve(sourceRoot,sourceEnv.DB_PATH||'data/project-manage.db');
const snapshot=path.join(preview,'source-snapshot.db'),database=path.join(preview,'workspace.db');
const source=new Database(sourcePath,{readonly:true,fileMustExist:true});
try{await source.backup(snapshot);}finally{source.close();}
fs.copyFileSync(snapshot,database);
const copy=new Database(snapshot,{readonly:true,fileMustExist:true});
const integrity=copy.pragma('integrity_check'),foreignKeys=copy.pragma('foreign_key_check');
const counts=Object.fromEntries(copy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(({name})=>[name,copy.prepare('SELECT count(*) AS n FROM "'+name.replaceAll('"','""')+'"').get().n]));
copy.close();
if(integrity[0]?.integrity_check!=='ok'||foreignKeys.length)throw new Error('源快照完整性检查失败');
const password='Workspace-'+randomBytes(12).toString('base64url');
fs.writeFileSync(configFile,JSON.stringify({HOST:'127.0.0.1',PORT:'3270',DB_PATH:database,BACKUP_DIR:path.join(preview,'backups'),WEB_DIST_DIR:path.join(root,'dist'),SESSION_COOKIE_NAME:'pm_workspace_3270',SESSION_SECRET:randomBytes(32).toString('hex'),ADMIN_PASSWORD:password,SEED_DEMO:'0',NODE_ENV:'production'},null,2));
fs.writeFileSync(path.join(preview,'access.txt'),'地址：http://127.0.0.1:3270\n预览管理员：admin\n预览口令：'+password+'\n仅用于隔离预览。\n');
const services=[];
for(const port of [3210,3260]){const response=await fetch('http://127.0.0.1:'+port+'/');services.push({port,status:response.status,indexSha256:createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex')});}
const report={sourcePath,snapshot,capturedAt:new Date().toISOString(),integrity,foreignKeys,counts,services};
fs.writeFileSync(path.join(preview,'isolation-baseline.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({snapshot,tables:Object.keys(counts).length,rows:Object.values(counts).reduce((a,b)=>a+b,0),integrity:'ok',services},null,2));
