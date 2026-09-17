

import type { FastifyInstance } from 'fastify';
import { captureRequestError, setMcpOutcome } from "./request-logging";
import { readLogContext, recordInputContext, recordLogIdentity, recordLogReason, recordValidationIssues } from "./log-context";

import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';

import { type AuthorizationActor } from "./authorization";

import { createServer } from './mcp-server';

export function registerMcpRoute(app: FastifyInstance, authenticate: (header?: string) => AuthorizationActor | null) {
  app.route({
    method: ['GET', 'POST', 'DELETE'], url: '/mcp',bodyLimit:10*1024*1024,
    handler: async (request, reply) => {
      const envelope = request.body as { jsonrpc?: string; id?: unknown; method?: string; params?: { name?: string; arguments?: unknown } } | null;
      if (typeof envelope?.method === 'string') {
        const method = envelope.method;
        setMcpOutcome(request, { mcpMethod: method.length <= 120 && /^[A-Za-z][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_.-]+)*$/.test(method) ? method : '<invalid>' });
      }
      if (envelope?.method === 'tools/call' && typeof envelope.params?.name === 'string') {
        setMcpOutcome(request, { tool: /^[a-z][a-z0-9_]{0,79}$/.test(envelope.params.name) ? envelope.params.name : '<invalid>' });
      }
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
      const actor = token ? authenticate(token) : null;
      recordLogIdentity(actor, 'token');
      if (!actor && !readLogContext().reason) recordLogReason(token ? 'TOKEN_INVALID' : 'TOKEN_MISSING', token ? 'MCP Token 无效或已过期' : '请求未提供 MCP 认证令牌');
      if (!actor) return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ error: 'MCP Token无效或已过期' });
      if (request.method !== 'POST') return reply.code(405).send({ error: '当前MCP端点使用无状态POST模式' });
      const { server, inputSchemas } = createServer(actor, request);
      const unknownTool = envelope?.method === 'tools/call' && typeof envelope.params?.name === 'string' && !inputSchemas.has(envelope.params.name);
      if (envelope?.method === 'tools/call' && envelope.params?.name) {
        const schema = inputSchemas.get(envelope.params.name);
        if (schema) recordInputContext(envelope.params.name, envelope.params.arguments);
        const validation = schema ? await schema['~standard'].validate(envelope.params.arguments ?? {}) : null;
        if (validation?.issues?.length) {
          recordValidationIssues(validation.issues);
          setMcpOutcome(request, { resultStatus: 400, errorCode: 'VALIDATION_ERROR' });
          await server.close();
          const payload = { error: validation.issues[0].message || '输入参数不合法', code: 'VALIDATION_ERROR' };
          return reply.send({
            jsonrpc: envelope.jsonrpc || '2.0', id: envelope.id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(payload) }],
              structuredContent: { error: payload, statusCode: 400 },
              isError: true,
            },
          });
        }
      }
      const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      const send = transport.send.bind(transport);
      transport.send = async (message, options) => {
        if ('error' in message) {
          recordLogReason(`MCP_RPC_${message.error.code}`, unknownTool ? '请求的 MCP 工具不存在' : message.error.code === -32601 ? '请求的 MCP 方法不受支持' : message.error.code === -32603 ? 'MCP 内部处理异常' : 'MCP 请求格式或参数不合法');
          setMcpOutcome(request, { resultStatus: message.error.code === -32603 ? 500 : unknownTool ? 404 : message.error.code === -32601 ? 405 : 400, errorCode: `MCP_RPC_${message.error.code}` });
        } else if ('result' in message && message.result.isError === true) {
          const content = message.result.structuredContent as { statusCode?: number; error?: { code?: string } } | undefined;
          setMcpOutcome(request, { resultStatus: content?.statusCode || (unknownTool ? 404 : 500),
            errorCode: content?.error?.code || (unknownTool ? 'NOT_FOUND' : 'MCP_TOOL_ERROR') });
        }
        await send(message, options);
      };
      try {
        await server.connect(transport); reply.hijack();
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } catch (error) {
        captureRequestError(request, error);
        if (reply.raw.headersSent) reply.raw.destroy();
        else if (reply.sent) { reply.raw.writeHead(500, { 'content-type': 'application/json' }); reply.raw.end(JSON.stringify({ error: '服务器内部错误' })); }
        else throw error;
      }
      finally { await server.close(); }
    },
  });
}
