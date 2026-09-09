import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';

if (path.basename(process.cwd()) !== 'project-manage-debug') throw new Error('只允许在独立调试 worktree 运行');
if (fs.existsSync('.env')) throw new Error('调试配置已存在，不覆盖');
const password = `Debug-${randomBytes(12).toString('base64url')}`;
const salt = randomBytes(16).toString('hex');
const hash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
fs.mkdirSync('.preview/qa', { recursive: true });
fs.writeFileSync('.env', [
  'HOST=127.0.0.1', 'PORT=3230', 'VITE_PORT=5175', 'DB_PATH=./.preview/debug.db',
  'BACKUP_DIR=./.preview/backups', 'SESSION_COOKIE_NAME=pm_debug_3230',
  `SESSION_SECRET=${randomBytes(48).toString('hex')}`, `APP_PASSWORD_HASH=${hash}`, 'SEED_DEMO=1',
].join('\n') + '\n', { flag: 'wx' });
fs.writeFileSync('.preview/access.txt', `调试后端：http://127.0.0.1:3230\n开发前端：http://127.0.0.1:5175\n账号：admin\n密码：${password}\n独立样例数据，不连接正式或原试用服务。\n`, { flag: 'wx' });
console.log('独立调试配置已生成，访问资料在 .preview/access.txt。');
