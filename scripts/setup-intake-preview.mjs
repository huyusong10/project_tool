import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
if(path.basename(process.cwd())!=='project-manage-intake')throw new Error('只能在 project-manage-intake 隔离工作区运行');
if(fs.existsSync('.env'))throw new Error('隔离配置已存在，不覆盖');
fs.mkdirSync('.preview',{recursive:true});
const password='Intake-'+randomBytes(12).toString('base64url'),salt=randomBytes(16).toString('hex');
fs.writeFileSync('.env',[
  'HOST=127.0.0.1','PORT=3240','VITE_PORT=5176','DB_PATH=./.preview/intake.db','BACKUP_DIR=./.preview/backups','SESSION_COOKIE_NAME=pm_intake_3240',
  `SESSION_SECRET=${randomBytes(48).toString('hex')}`,`APP_PASSWORD_HASH=scrypt$${salt}$${scryptSync(password,salt,64).toString('hex')}`,'SEED_DEMO=0',
].join('\n')+'\n');
fs.writeFileSync('.preview/access.json',JSON.stringify({url:'http://127.0.0.1:3240',developmentUrl:'http://127.0.0.1:5176',username:'admin',password},null,2));
console.log('隔离配置已生成，登录资料保存在 .preview/access.json');
