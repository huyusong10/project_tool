

import type { FastifyRequest } from 'fastify';

import { McpServer, type StandardSchemaWithJSON } from '@modelcontextprotocol/server';

import { type AuthorizationActor } from "./authorization";

import { createToolRegistrar } from './mcp-tools/registry';
import { registerIntakeTools } from './mcp-tools/intake';
import { registerRequirementsTools } from './mcp-tools/requirements';
import { registerWorkItemsTools } from './mcp-tools/work-items';
import { registerProgressTools } from './mcp-tools/progress';
import { registerProjectsTools } from './mcp-tools/projects';
import { registerPathsTools } from './mcp-tools/paths';
import { registerReportingTools } from './mcp-tools/reporting';
import { registerIssuesTools } from './mcp-tools/issues';
import { registerTemplatesTools } from './mcp-tools/templates';
import { registerPeopleTools } from './mcp-tools/people';
import { registerArchivesTools } from './mcp-tools/archives';
import { registerAuditTools } from './mcp-tools/audit';

export function createServer(actor: AuthorizationActor, request: FastifyRequest) {
const server = new McpServer({ name: 'project-manage', version: '1.5.0' }, {
    capabilities: { resources: { listChanged: false }, prompts: { listChanged: false } },
  });
const inputSchemas = new Map<string, StandardSchemaWithJSON>();
const registerTool = createToolRegistrar(server, request, inputSchemas);
registerIntakeTools(registerTool, actor);
registerRequirementsTools(registerTool, actor);
registerWorkItemsTools(registerTool, actor);
registerProgressTools(registerTool, actor);
registerProjectsTools(registerTool, actor);
registerPathsTools(registerTool, actor);
registerReportingTools(registerTool, actor);
registerIssuesTools(registerTool, actor);
registerTemplatesTools(registerTool, actor);
registerPeopleTools(registerTool, actor);
registerArchivesTools(registerTool, actor);
registerAuditTools(registerTool, actor);
return { server, inputSchemas };
}
