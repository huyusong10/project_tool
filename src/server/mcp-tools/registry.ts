

import type { FastifyRequest } from 'fastify';
import { captureRequestError, setMcpOutcome } from "../request-logging";
import { recordCreatedResource, recordInputContext } from "../log-context";
import { McpServer, type StandardSchemaWithJSON, type ToolCallback } from '@modelcontextprotocol/server';

import { errorResponse } from "../errors";

export const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  structuredContent: { result: value },
});

export function createToolRegistrar(server: McpServer, request: FastifyRequest, inputSchemas: Map<string, StandardSchemaWithJSON>) {
const registerTool = <InputArgs extends StandardSchemaWithJSON>(
    name: string,
    config: { description?: string; inputSchema: InputArgs },
    callback: ToolCallback<InputArgs>,
  ) => {
    inputSchemas.set(name, config.inputSchema);
    const readOnly = /^(get_|list_|query_|preview_|dashboard_summary$|people_concurrency$)/.test(name);
    return server.registerTool(name, { ...config, annotations: { readOnlyHint: readOnly, ...(readOnly ? { destructiveHint: false, idempotentHint: true, openWorldHint: false } : {}) } }, (async (...args: Parameters<ToolCallback<InputArgs>>) => {
    setMcpOutcome(request, { tool: name, readOnly });
    recordInputContext(name, args[0], /^(update_|correct_)/.test(name));
    try {
      const result = await (callback as (...values: unknown[]) => unknown)(...(args as unknown[]));
      if (/^create_/.test(name)) recordCreatedResource(name, (result as { structuredContent?: { result?: unknown } })?.structuredContent?.result);
      return result;
    } catch (error) {
      const response = errorResponse(error);
      captureRequestError(request, error);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response.payload) }],
        structuredContent: { error: response.payload, statusCode: response.statusCode },
        isError: true,
      };
    }
    }) as ToolCallback<InputArgs>);
  };
return registerTool;
}
export type ToolRegistrar = ReturnType<typeof createToolRegistrar>;
