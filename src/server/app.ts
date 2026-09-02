import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { config } from './config';
import './database';
import { registerApiRoutes } from './routes';
import { registerMcpRoute } from './mcp';
import { authenticateApiToken } from './services';

export async function buildApp() {
  const app = Fastify({ logger: { level: config.nodeEnv === 'production' ? 'info' : 'warn' }, bodyLimit: 1024 * 1024 });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.setErrorHandler((error, _request, reply) => {
    const status = (error as any).statusCode && (error as any).statusCode < 500 ? (error as any).statusCode : 400;
    reply.code(status).send({ error: error instanceof Error ? error.message : '请求处理失败' });
  });
  app.get('/health', async () => ({ status: 'ok', time: new Date().toISOString(), service: 'project-manage' }));
  registerApiRoutes(app);
  registerMcpRoute(app, (token) => token ? authenticateApiToken(token) : null);
  const distDir = path.join(config.rootDir, 'dist');
  if (fs.existsSync(distDir)) {
    await app.register(fastifyStatic, { root: distDir, wildcard: false });
    app.get('/*', async (_request, reply) => reply.sendFile('index.html'));
  }
  return app;
}
