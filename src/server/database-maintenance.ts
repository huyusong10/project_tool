import type { FastifyInstance, FastifyRequest } from 'fastify';
import { fail } from './errors';

let paused = false;
const requests = new Set<FastifyRequest>();

function isDatabaseRequest(request: FastifyRequest) {
  const pathname = request.url.split('?')[0];
  // 恢复入口自己持有互斥锁；状态查询供页面在切换期间核对结果。
  return (pathname.startsWith('/api/') || pathname === '/mcp')
    && !['/api/backups/restore', '/api/backups/import/restore', '/api/system/overview'].includes(pathname);
}

export function registerDatabaseMaintenance(app: FastifyInstance) {
  const check = (request: FastifyRequest) => {
    if (!isDatabaseRequest(request)) return;
    if (paused) fail('数据库正在恢复，请稍后重试', 'DATABASE_MAINTENANCE', 503);
  };
  app.addHook('onRequest', async (request) => { check(request); });
  app.addHook('preHandler', async (request) => {
    check(request);
    if (!isDatabaseRequest(request)) return;
    requests.add(request);
  });
  app.addHook('onResponse', async (request) => { requests.delete(request); });
  app.addHook('onError', async (request) => { requests.delete(request); });
}

export async function pauseDatabaseRequests() {
  paused = true;
  const deadline = Date.now() + 10_000;
  while (requests.size) {
    if (Date.now() >= deadline) fail('仍有请求正在执行，本次恢复已取消，请稍后重试', 'DEPENDENCY_CONFLICT', 409);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export function resumeDatabaseRequests() { paused = false; }
