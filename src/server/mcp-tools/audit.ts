

import { assertProjectManager, isAdmin, type AuthorizationActor } from "../authorization";

import { listAudit } from "../services/audit";

import { auditListInputSchema } from "../../shared/contracts";
import { json, type ToolRegistrar } from './registry';

export function registerAuditTools(registerTool: ToolRegistrar, actor: AuthorizationActor) {
  registerTool('list_audit_logs', { description: '查询审计日志；管理员可查全局，项目经理需指定项目', inputSchema: auditListInputSchema }, async ({ projectId, limit }) => {
    if (!isAdmin(actor)) assertProjectManager(actor, projectId || '');
    return json(listAudit(limit, projectId));
  });
}
