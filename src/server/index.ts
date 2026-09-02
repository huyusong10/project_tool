import { assertRuntimeConfig, config } from './config';
import { startBackupScheduler } from './backups';
import { buildApp } from './app';

assertRuntimeConfig();

const app = await buildApp();
startBackupScheduler();

await app.listen({ host: config.host, port: config.port });
console.log(`项目管理系统已启动：http://localhost:${config.port}`);
