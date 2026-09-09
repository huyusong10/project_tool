import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
const root = process.cwd();
if (path.basename(root) !== 'project-manage-paths') throw new Error('只能在隔离工作区运行');
if (fs.existsSync('.env')) throw new Error('独立配置已存在，不覆盖');
const password = `Paths-${randomBytes(9).toString('base64url')}`;
const salt = randomBytes(16).toString('hex');
const hash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
fs.mkdirSync('.preview', { recursive: true });
fs.writeFileSync('.env', ['HOST=127.0.0.1','PORT=3220','VITE_PORT=5174','DB_PATH=./.preview/paths.db','BACKUP_DIR=./.preview/backups',
  'SESSION_COOKIE_NAME=pm_paths_3220',`SESSION_SECRET=${randomBytes(48).toString('hex')}`,`APP_PASSWORD_HASH=${hash}`,'SEED_DEMO=0'].join('\n')+'\n');
fs.writeFileSync('.preview/access.txt', `地址：http://127.0.0.1:3220\n用户名：admin\n密码：${password}\n独立试用环境，不连接当前服务。\n`);
console.log('独立配置已生成，访问资料保存在 .preview/access.txt');
