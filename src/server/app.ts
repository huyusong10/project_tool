import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { config } from './config';
import { initializeDatabase } from './database';
import { runWithDatabase, type DatabaseContext } from './database-context';
import { registerApiRoutes } from './routes';
import { registerPathRoutes } from './path-routes';
import { registerQueryRoutes } from './query-routes';
import { registerMcpRoute } from './mcp';
import { authenticateApiToken } from './services/tokens';
import { errorResponse } from './errors';
import { registerDatabaseMaintenance } from './database-maintenance';
import { getRuntimeLogger, type RuntimeLogger } from '../../scripts/runtime-logger.mjs';
import { RequestLogController, registerRequestLogging, captureRequestError } from './request-logging';

export async function buildApp(runtime: RuntimeLogger = getRuntimeLogger(), database?: DatabaseContext) {
  const context = database ?? await initializeDatabase();
  const controller = new RequestLogController(runtime.settings.slowMs);
  const loggerInstance: FastifyBaseLogger = runtime.logger;
  const app = Fastify({ loggerInstance, logController: controller, bodyLimit: 1024 * 1024 });
  app.addHook('onRequest', (_request, _reply, done) => runWithDatabase(context, done));
  registerRequestLogging(app, controller);
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  registerDatabaseMaintenance(app, context);
  app.setErrorHandler((error, request, reply) => {
    const response = errorResponse(error);
    captureRequestError(request, error);
    reply.code(response.statusCode).send(response.payload);
  });
  app.get('/health', async () => ({ status: 'ok', time: new Date().toISOString(), service: 'project-manage' }));
  registerApiRoutes(app);
  registerPathRoutes(app);
  registerQueryRoutes(app);
  registerMcpRoute(app, (token) => token ? authenticateApiToken(token) : null);
  const distDir = config.webDistDir;
  if (fs.existsSync(distDir)) {
    const assetsDir = path.join(distDir, 'assets');
    if (fs.existsSync(assetsDir)) {
      await app.register(fastifyStatic, { root: assetsDir, prefix: '/assets/' });
    }
    app.get('/project-management-logo.png', async (_request, reply) =>
      reply.type('image/png').send(fs.createReadStream(path.join(distDir, 'project-management-logo.png'))));
    app.get('/*', async (request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/mcp/')) {
        return reply.code(404).send({ error: '接口不存在' });
      }
      return reply.type('text/html; charset=utf-8').send(await fs.promises.readFile(path.join(distDir, 'index.html')));
    });
  }
  return app;
}
