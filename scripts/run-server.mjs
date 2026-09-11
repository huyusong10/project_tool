import { spawn } from 'node:child_process';
import path from 'node:path';

const entry = path.resolve(process.argv[2] || 'dist-server/index.js');
let child;
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  stopping = true;
  child?.kill(signal);
});

function run(args = []) {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [entry, ...args], { stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

try {
  let code;
  do {
    code = await run();
    if (stopping) break;
    // 64 表示尚未打开数据库的启动拒绝；75 表示数据库已切换，重新启动。
    if (![0, 64, 75].includes(code) && await run(['--recover-database-swap']) === 0) code = 75;
  } while (!stopping && code === 75);
  process.exitCode = stopping ? 0 : code;
} catch (error) {
  console.error('服务启动失败：', error.message);
  process.exitCode = 1;
}
