import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { config } from './config';
import './database';
import { registerApiRoutes } from './routes';
import { registerPathRoutes } from './path-routes';
import { registerQueryRoutes } from './query-routes';
import { registerMcpRoute } from './mcp';
import { authenticateApiToken } from './services';
import { errorResponse } from './errors';
import { registerDatabaseMaintenance } from './database-maintenance';

export async function buildApp() {
  const app = Fastify({ logger: { level: config.nodeEnv === 'production' ? 'info' : 'warn' }, bodyLimit: 1024 * 1024 });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  registerDatabaseMaintenance(app);
  app.setErrorHandler((error, request, reply) => {
    const response = errorResponse(error);
    if (!response.known) request.log.error({ err: error }, 'Unhandled request error');
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
