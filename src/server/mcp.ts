import type { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { z } from 'zod';
import {
  assertAdmin, assertCanAddProgress, assertProgressOwnerOrManager, assertProjectManager, assertProjectReadable,
  assertProjectResourceManager, assertProjectResourceReadable, assertWorkItemParticipantOrManager, canManageProject,
  projectIdForProgress, projectIdForRequirement, projectIdForTemplate, projectIdForWorkItem,
  type AuthorizationActor,
} from './authorization';
import {
  addProgress, addProjectPerson, applyRequirementPlan, applyTemplate, archivePerson, archiveProject, archiveRequirement, archiveTemplate,
  blockWorkItem, cancelWorkItem, completeWorkItem, createPerson, createProject, createRequirement, createTemplate,
  createWorkItem, deleteProgress, deleteWorkItem, getDashboard, getPeopleConcurrency, getRequirement, listArchives,
  listAudit, listPeople, listProjects, listRequirements, listTemplates, permanentlyDeleteArchive, previewRequirementPlan, removeProjectPerson, reorderWorkItems,
  restorePerson, restoreProject, restoreRequirement, restoreTemplate, startWorkItem, unblockWorkItem, updatePerson,
  updateProgress, updateProject, updateRequirement, updateTemplate, updateWorkItem,
} from './services';
import { priorities } from '../shared/domain';

const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  structuredContent: { result: value },
});

const optionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const templateItem = z.object({
  id: z.string().optional(), title: z.string().min(1), startOffsetDays: z.number().int().min(0),
  durationDays: z.number().int().min(1), sortOrder: z.number().int().min(0),
});
const requirementInput = z.object({
  projectId: z.string().optional(), title: z.string().min(1).optional(), priority: z.enum(priorities).optional(),
  plannedStart: optionalDate, plannedEnd: optionalDate, scheduleMode: z.enum(['start', 'deadline']).optional(),
  templateId: z.string().optional(), confirmTemplateReset: z.boolean().optional(),
});
const workItemInput = z.object({
  title: z.string().min(1).optional(), ownerId: z.string().nullable().optional(),
  assigneeIds: z.array(z.string()).optional(), plannedStart: optionalDate,
  plannedEnd: optionalDate, actualStart: optionalDate, actualEnd: optionalDate,
  progress: z.number().int().min(0).max(100).optional(), sortOrder: z.number().int().min(0).optional(),
});

function createServer(actor: AuthorizationActor) {
  const server = new McpServer({ name: 'project-manage', version: '1.1.0' });

  server.registerTool('dashboard_summary', { description: '查询项目看板、自动风险和图表', inputSchema: z.object({ projectId: z.string() }) }, async ({ projectId }) => {
    assertProjectReadable(actor, projectId); return json(getDashboard(projectId));
  });
  server.registerTool('people_concurrency', { description: '查询人员当前及未来并发度', inputSchema: z.object({ projectId: z.string(), personId: z.string().optional(), jobTitle: z.string().optional(), from: optionalDate, to: optionalDate }) }, async (input) => {
    assertProjectReadable(actor, input.projectId); return json(getPeopleConcurrency({ ...input, includeExternalAggregate: canManageProject(actor, input.projectId) } as any));
  });

  server.registerTool('list_projects', { description: '查询项目', inputSchema: z.object({ includeDeleted: z.boolean().optional() }) }, async ({ includeDeleted }) => json(listProjects(includeDeleted, actor)));
  server.registerTool('create_project', { description: '创建项目', inputSchema: z.object({ name: z.string().min(1), plannedStart: optionalDate, plannedEnd: optionalDate }) }, async (input) => {
    assertAdmin(actor); return json(createProject(input, actor));
  });
  server.registerTool('update_project', { description: '修改项目', inputSchema: z.object({ id: z.string(), name: z.string().min(1).optional(), plannedStart: optionalDate, plannedEnd: optionalDate, defaultTemplateId: z.string().nullable().optional() }) }, async ({ id, ...input }) => {
    assertProjectManager(actor, id); return json(updateProject(id, input, actor));
  });
  server.registerTool('archive_project', { description: '归档项目', inputSchema: z.object({ id: z.string() }) }, async ({ id }) => {
    assertAdmin(actor); return json(archiveProject(id, actor));
  });
  server.registerTool('restore_project', { description: '恢复项目', inputSchema: z.object({ id: z.string() }) }, async ({ id }) => {
    assertAdmin(actor); return json(restoreProject(id, actor));
  });

  server.registerTool('list_requirements', { description: '筛选查询需求', inputSchema: z.object({ projectId: z.string(), status: z.string().optional(), view: z.enum(['delayed', 'high_risk']).optional(), includeDeleted: z.boolean().optional() }) }, async (input) => {
    assertProjectReadable(actor, input.projectId); return json(listRequirements(input));
  });
  server.registerTool('get_requirement', { description: '获取需求、自动指标、工作项和进展', inputSchema: z.object({ id: z.string(), includeDeleted: z.boolean().optional() }) }, async ({ id, includeDeleted }) => {
    assertProjectResourceReadable(actor, projectIdForRequirement(id), '需求不存在'); return json(getRequirement(id, includeDeleted));
  });
  server.registerTool('create_requirement', { description: '创建需求并按模板自动生成工作项；计划开始和截止日期二选一', inputSchema: requirementInput.extend({ projectId: z.string(), title: z.string().min(1), priority: z.enum(priorities), templateId: z.string().optional() }).refine((input) => Boolean(input.plannedStart) !== Boolean(input.plannedEnd), { message: '计划开始和截止日期请选择一项' }) }, async (input) => {
    assertProjectManager(actor, input.projectId); return json(createRequirement(input, actor));
  });
  server.registerTool('update_requirement', { description: '修改需求；可按开始日期正排或截止日期倒排并整体顺延现有计划；重选流程时须确认清空已有工作项和进展', inputSchema: requirementInput.extend({ id: z.string() }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在'); return json(updateRequirement(id, input, actor));
  });
  server.registerTool('archive_requirement', { description: '归档需求', inputSchema: z.object({ id: z.string() }) }, async ({ id }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在'); return json(archiveRequirement(id, actor));
  });
  server.registerTool('restore_requirement', { description: '恢复需求', inputSchema: z.object({ id: z.string() }) }, async ({ id }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在'); return json(restoreRequirement(id, actor));
  });
  server.registerTool('preview_requirement_plan', { description: '预览按模板补全缺失计划，不写入数据', inputSchema: z.object({ requirementId: z.string(), templateId: z.string(), baseStart: z.string() }) }, async ({ requirementId, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(requirementId), '需求不存在'); return json(previewRequirementPlan(requirementId, input));
  });
  server.registerTool('apply_requirement_plan', { description: '确认后只补充缺失计划或工作项', inputSchema: z.object({ requirementId: z.string(), templateId: z.string(), baseStart: z.string(), templateItemIds: z.array(z.string()).optional() }) }, async ({ requirementId, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(requirementId), '需求不存在'); return json(applyRequirementPlan(requirementId, input, actor));
  });

  server.registerTool('create_work_item', { description: '新增工作项', inputSchema: workItemInput.extend({ requirementId: z.string(), title: z.string().min(1) }) }, async ({ requirementId, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(requirementId), '需求不存在'); return json(createWorkItem(requirementId, input, actor));
  });
  server.registerTool('update_work_item', { description: '修改工作项主负责人、协作人员、计划和实际日期；默认只设置一个主负责人', inputSchema: workItemInput.extend({ id: z.string() }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForWorkItem(id), '工作项不存在'); return json(updateWorkItem(id, input, actor));
  });
  server.registerTool('start_work_item', { description: '开始工作项并自动记录实际开始', inputSchema: z.object({ id: z.string() }) }, async ({ id }) => {
    assertWorkItemParticipantOrManager(actor, id); return json(startWorkItem(id, actor));
  });
  server.registerTool('complete_work_item', { description: '完成工作项并自动记录实际完成', inputSchema: z.object({ id: z.string() }) }, async ({ id }) => {
    assertWorkItemParticipantOrManager(actor, id); return json(completeWorkItem(id, actor));
  });
  server.registerTool('block_work_item', { description: '标记工作项阻塞', inputSchema: z.object({ id: z.string(), reason: z.string().min(1) }) }, async ({ id, ...input }) => {
    assertWorkItemParticipantOrManager(actor, id); return json(blockWorkItem(id, input, actor));
  });
  server.registerTool('unblock_work_item', { description: '解除工作项阻塞', inputSchema: z.object({ id: z.string() }) }, async ({ id }) => {
    assertWorkItemParticipantOrManager(actor, id); return json(unblockWorkItem(id, actor));
  });
  server.registerTool('cancel_work_item', { description: '取消工作项', inputSchema: z.object({ id: z.string() }) }, async ({ id }) => {
    assertProjectResourceManager(actor, projectIdForWorkItem(id), '工作项不存在'); return json(cancelWorkItem(id, actor));
  });
  server.registerTool('delete_work_item', { description: '删除工作项', inputSchema: z.object({ id: z.string() }) }, async ({ id }) => {
    assertProjectResourceManager(actor, projectIdForWorkItem(id), '工作项不存在'); return json(deleteWorkItem(id, actor));
  });
  server.registerTool('reorder_work_items', { description: '调整工作项顺序', inputSchema: z.object({ requirementId: z.string(), ids: z.array(z.string()) }) }, async ({ requirementId, ids }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(requirementId), '需求不存在'); return json(reorderWorkItems(requirementId, ids, actor));
  });

  server.registerTool('add_progress', { description: '追加工作项进展；关联工作项时需提供累计完成度', inputSchema: z.object({ requirementId: z.string(), content: z.string().min(1), workItemId: z.string().nullable().optional(), workItemPercent: z.number().int().min(0).max(100).optional() }) }, async ({ requirementId, ...input }) => {
    assertCanAddProgress(actor, requirementId, input.workItemId || null); return json(addProgress(requirementId, input, actor));
  });
  server.registerTool('update_progress', { description: '修改历史进展文本或关联工作项；完成度请通过新进展更新', inputSchema: z.object({ id: z.string(), content: z.string().min(1).optional(), workItemId: z.string().nullable().optional() }) }, async ({ id, ...input }) => {
    assertProgressOwnerOrManager(actor, id, input.workItemId); return json(updateProgress(id, input, actor));
  });
  server.registerTool('delete_progress', { description: '删除进展记录', inputSchema: z.object({ id: z.string() }) }, async ({ id }) => {
    assertProgressOwnerOrManager(actor, id); return json(deleteProgress(id, actor));
  });

  server.registerTool('list_templates', { description: '按项目查询结构化流程设计', inputSchema: z.object({ projectId: z.string(), includeDeleted: z.boolean().optional() }) }, async ({ projectId, includeDeleted }) => {
    assertProjectReadable(actor, projectId); return json(listTemplates(projectId, includeDeleted));
  });
  server.registerTool('create_template', { description: '创建带设计说明、偏移和工期的流程', inputSchema: z.object({ projectId: z.string(), name: z.string().min(1), description: z.string().max(2000).optional(), items: z.array(templateItem).min(1) }) }, async (input) => {
    assertProjectManager(actor, input.projectId); return json(createTemplate(input, actor));
  });
  server.registerTool('update_template', { description: '修改流程，只影响之后应用流程的需求', inputSchema: z.object({ id: z.string(), name: z.string().min(1).optional(), description: z.string().max(2000).optional(), items: z.array(templateItem).min(1).optional() }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForTemplate(id), '流程设计不存在'); return json(updateTemplate(id, input, actor));
  });
  server.registerTool('archive_template', { description: '归档流程', inputSchema: z.object({ id: z.string() }) }, async ({ id }) => {
    assertProjectResourceManager(actor, projectIdForTemplate(id), '流程设计不存在'); return json(archiveTemplate(id, actor));
  });
  server.registerTool('restore_template', { description: '恢复流程', inputSchema: z.object({ id: z.string() }) }, async ({ id }) => {
    assertProjectResourceManager(actor, projectIdForTemplate(id), '流程设计不存在'); return json(restoreTemplate(id, actor));
  });
  server.registerTool('apply_template', { description: '向已有需求补充流程中缺少的工作项', inputSchema: z.object({ requirementId: z.string(), templateId: z.string() }) }, async ({ requirementId, templateId }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(requirementId), '需求不存在'); return json(applyTemplate(requirementId, templateId, actor));
  });

  server.registerTool('list_people', { description: '按项目查询人员和岗位', inputSchema: z.object({ projectId: z.string().optional(), includeDeleted: z.boolean().optional() }) }, async ({ projectId, includeDeleted }) => {
    if (projectId) assertProjectReadable(actor, projectId); else assertAdmin(actor); return json(listPeople(includeDeleted, projectId));
  });
  server.registerTool('create_person', { description: '新增平台人员', inputSchema: z.object({ projectId: z.string().optional(), name: z.string().min(1), jobTitle: z.string().nullable().optional() }) }, async (input) => {
    assertAdmin(actor); return json(createPerson(input, actor));
  });
  server.registerTool('add_project_person', { description: '将已有人员加入项目', inputSchema: z.object({ projectId: z.string(), personId: z.string(), role: z.enum(['viewer', 'member']).optional() }) }, async ({ projectId, personId, role }) => {
    assertProjectManager(actor, projectId); return json(addProjectPerson(projectId, personId, actor, role));
  });
  server.registerTool('remove_project_person', { description: '安全地将人员移出项目', inputSchema: z.object({ projectId: z.string(), personId: z.string() }) }, async ({ projectId, personId }) => {
    assertProjectManager(actor, projectId); return json(removeProjectPerson(projectId, personId, actor));
  });
  server.registerTool('update_person', { description: '修改平台人员或岗位', inputSchema: z.object({ id: z.string(), name: z.string().min(1).optional(), jobTitle: z.string().nullable().optional(), active: z.boolean().optional() }) }, async ({ id, ...input }) => {
    assertAdmin(actor); return json(updatePerson(id, input, actor));
  });
  server.registerTool('archive_person', { description: '归档平台人员', inputSchema: z.object({ id: z.string() }) }, async ({ id }) => {
    assertAdmin(actor); return json(archivePerson(id, actor));
  });
  server.registerTool('restore_person', { description: '恢复平台人员', inputSchema: z.object({ id: z.string() }) }, async ({ id }) => {
    assertAdmin(actor); return json(restorePerson(id, actor));
  });
  server.registerTool('list_archives', { description: '查询全部归档', inputSchema: z.object({}) }, async () => {
    assertAdmin(actor); return json(listArchives());
  });
  server.registerTool('permanently_delete_archive', {
    description: '永久删除已归档的项目、需求、人员或模板；该操作不可恢复',
    inputSchema: z.object({ entity: z.enum(['projects', 'requirements', 'people', 'templates']), id: z.string() }),
  }, async ({ entity, id }) => { assertAdmin(actor); return json(permanentlyDeleteArchive(entity, id, actor)); });
  server.registerTool('list_audit_logs', { description: '查询审计日志', inputSchema: z.object({ limit: z.number().int().min(1).max(500).optional() }) }, async ({ limit }) => {
    assertAdmin(actor); return json(listAudit(limit));
  });
  return server;
}

export function registerMcpRoute(app: FastifyInstance, authenticate: (header?: string) => AuthorizationActor | null) {
  app.route({
    method: ['GET', 'POST', 'DELETE'], url: '/mcp',
    handler: async (request, reply) => {
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
      const actor = token ? authenticate(token) : null;
      if (!actor) return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ error: 'MCP Token无效或已过期' });
      if (request.method !== 'POST') return reply.code(405).send({ error: '当前MCP端点使用无状态POST模式' });
      const server = createServer(actor);
      const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport); reply.hijack();
      try { await transport.handleRequest(request.raw, reply.raw, request.body); }
      finally { await server.close(); }
    },
  });
}
