import type { FastifyInstance, FastifyRequest } from 'fastify';
import { fail } from './errors';
import { getDatabaseContext, type DatabaseContext } from './database-context';

const states = new WeakMap<DatabaseContext, { paused: boolean; requests: Set<FastifyRequest> }>();
function stateFor(context: DatabaseContext) {
  let state = states.get(context);
  if (!state) { state = { paused: false, requests: new Set() }; states.set(context, state); }
  return state;
}

function isDatabaseRequest(request: { url: string }) {
  const pathname = request.url.split('?')[0];
  // 恢复入口自己持有互斥锁；状态查询供页面在切换期间核对结果。
  return (pathname.startsWith('/api/') || pathname === '/mcp')
    && !['/api/backups/restore', '/api/backups/import/restore', '/api/system/overview'].includes(pathname);
}

export function registerDatabaseMaintenance(app: FastifyInstance, context: DatabaseContext) {
  const state = stateFor(context), { requests } = state;
  const check = (request: FastifyRequest) => {
    if (!isDatabaseRequest(request)) return;
    if (state.paused) fail('数据库正在恢复，请稍后重试', 'DATABASE_MAINTENANCE', 503);
  };
  app.addHook('onRequest', async (request) => { check(request); });
  app.addHook('preHandler', async (request) => { check(request); });
  app.addHook('onRoute', (route) => {
    if (!isDatabaseRequest(route)) return;
    const handler = route.handler;
    route.handler = async function (request, reply) {
      check(request);
      requests.add(request);
      // A disconnected response may never finish; its database work must still finish before restore.
      try { return await handler.call(this, request, reply); }
      finally { requests.delete(request); }
    };
  });
}

export async function pauseDatabaseRequests(context = getDatabaseContext()) {
  const state = stateFor(context), { requests } = state;
  state.paused = true;
  const deadline = Date.now() + 10_000;
  while (requests.size) {
    if (Date.now() >= deadline) fail('仍有请求正在执行，本次恢复已取消，请稍后重试', 'DEPENDENCY_CONFLICT', 409);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export function resumeDatabaseRequests(context = getDatabaseContext()) { stateFor(context).paused = false; }
