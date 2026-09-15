import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,scryptSync} from 'node:crypto';
import Database from 'better-sqlite3';
const root=process.cwd();
if(path.basename(root)!=='project-manage-workspace')throw new Error('只能在 project-manage-workspace 隔离工作区运行');
if(fs.existsSync('.env')||fs.existsSync('.preview/workspace.db'))throw new Error('预览配置已经存在，不覆盖');
const source=path.resolve(process.argv[2]||'');
if(!process.argv[2]||!source.startsWith(path.join(root,'.preview')+path.sep)||!fs.existsSync(source))throw new Error('请指定本工作区内已经验证的迁移快照');
fs.mkdirSync('.preview',{recursive:true});
const password='Workspace-'+randomBytes(12).toString('base64url'),salt=randomBytes(16).toString('hex'),hash=`scrypt$${salt}$${scryptSync(password,salt,64).toString('hex')}`;
fs.copyFileSync(source,'.preview/workspace.db');
const db=new Database('.preview/workspace.db');
try{db.prepare('UPDATE accounts SET password_hash=?,must_change_password=0 WHERE is_builtin=1').run(hash);}finally{db.close();}
fs.writeFileSync('.env',[
  'HOST=127.0.0.1','PORT=3281','DB_PATH=./.preview/workspace.db','BACKUP_DIR=./.preview/backups','SESSION_COOKIE_NAME=pm_workspace_3281',
  `SESSION_SECRET=${randomBytes(48).toString('hex')}`,`APP_PASSWORD_HASH=${hash}`,'SEED_DEMO=0',
].join('\n')+'\n');
fs.writeFileSync('.preview/access.json',JSON.stringify({url:'http://127.0.0.1:3281',username:'admin',password},null,2));
console.log('隔离配置已生成；登录资料保存在 .preview/access.json');
