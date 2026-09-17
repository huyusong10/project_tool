

import { assertProjectManager, assertProjectReadable, assertProjectResourceManager, assertProjectResourceReadable, projectIdForRequirement, projectIdForTemplate, type AuthorizationActor } from "../authorization";

import { applyTemplate } from "../services/requirement-commands";

import { archiveTemplate, createTemplate, copyTemplate, listTemplates, restoreTemplate, updateTemplate } from "../services/templates";

import { archiveRestoreInputSchema, applyTemplateInputSchema, copyTemplateInputSchema, createTemplateInputSchema, idSchema, projectResourceListInputSchema, templateCommandSchema, updateTemplateInputSchema } from "../../shared/contracts";
import { json, type ToolRegistrar } from './registry';

export function registerTemplatesTools(registerTool: ToolRegistrar, actor: AuthorizationActor) {
  registerTool('list_templates', { description: '按项目查询结构化流程设计', inputSchema: projectResourceListInputSchema }, async ({ projectId, includeDeleted }) => {
    if (includeDeleted) assertProjectManager(actor, projectId); else assertProjectReadable(actor, projectId);
    return json(listTemplates(projectId, includeDeleted));
  });

  registerTool('create_template', { description: '创建带设计说明、偏移和工期的流程', inputSchema: createTemplateInputSchema }, async (input) => {
    assertProjectManager(actor, input.projectId); return json(createTemplate(input, actor));
  });

  registerTool('update_template', { description: '修改流程，只影响之后应用流程的需求', inputSchema: updateTemplateInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForTemplate(id), '流程设计不存在'); return json(updateTemplate(id, input, actor));
  });

  registerTool('archive_template', { description: '归档流程', inputSchema: templateCommandSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForTemplate(id), '流程设计不存在'); return json(archiveTemplate(id, actor, input));
  });

  registerTool('restore_template', { description: '恢复流程', inputSchema: archiveRestoreInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForTemplate(id), '流程设计不存在'); return json(restoreTemplate(id, actor, input));
  });

  registerTool('apply_template', { description: '向已有需求补充流程中缺少的工作项', inputSchema: applyTemplateInputSchema.safeExtend({ requirementId: idSchema }) }, async ({ requirementId, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(requirementId), '需求不存在'); return json(applyTemplate(requirementId, input, actor));
  });

  registerTool('copy_template', { description: '将已有流程复制到目标项目', inputSchema: copyTemplateInputSchema }, async ({ projectId, sourceTemplateId }) => {
    assertProjectManager(actor, projectId); assertProjectResourceReadable(actor, projectIdForTemplate(sourceTemplateId), '来源流程不存在');
    return json(copyTemplate(projectId, sourceTemplateId, actor));
  });
}
