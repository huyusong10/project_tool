import type { FastifyInstance } from 'fastify';
import { McpServer, type StandardSchemaWithJSON, type ToolCallback } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { z } from 'zod';
import {
  assertAdmin, assertCanAddProgress, assertProgressOwnerOrManager, assertProjectManager, assertProjectMember, assertProjectReadable,
  assertProjectResourceManager, assertProjectResourceReadable, assertRequirementOwnerOrManager,
  assertWorkItemParticipantOrManager, assertWorkItemRequirementOwnerOrManager, canManageProject, canUpdateIssueProgress,
  projectIdForIssue, projectIdForRequirement, projectIdForTemplate, projectIdForWorkItem,
  type AuthorizationActor,
} from './authorization';
import {
  acceptRequirement, addProgress, addProjectPerson, applyRequirementPlan, applyTemplate, archivePerson, archiveProject, archiveRequirement, archiveTemplate,
  addIssueUpdate, blockWorkItem, cancelRequirement, cancelWorkItem, completeWorkItem, correctIssue, correctWorkItem, createIssue, createPerson, createProject, createRequirement, createTemplate,
  copyTemplate, createWorkItem, deleteIssueUpdate, deleteProgress, deleteWorkItem, getDashboard, getIssue, getPeopleConcurrency, getRequirement, listActionItems, listArchives,
  listAudit, listIssues, listPeople, listPeopleCandidates, listProjects, listRequirements, listTemplates, permanentlyDeleteArchive, previewRequirementPlan, removeProjectPerson, reorderWorkItems,
  deferIssue, reopenIssue, reopenWorkItem, reselectRequirementTemplate, rescheduleRequirement, resolveIssue, restorePerson, restoreProject, restoreRequirement, restoreTemplate, resumeIssue, startWorkItem, unblockWorkItem, updateIssue, updatePerson,
  updateIssueUpdate, updateProgress, updateProject, updateRequirement, updateTemplate, updateWorkItem,
} from './services';
import { getMyWork } from './accounts';
import { getAnalyticsCatalog, queryAnalytics } from './analytics';
import { errorResponse } from './errors';
import { maxTemplateItems } from '../shared/domain';
import {
  actionItemsInputSchema,
  contentCommandSchema,
  createRequirementInputSchema,
  expectedVersionInputSchema,
  issueInputSchema,
  issueListInputSchema,
  issueUpdateInputSchema,
  optionalDateSchema,
  projectPeopleConcurrencyInputSchema,
  personInputSchema,
  progressInputSchema,
  projectInputSchema,
  rescheduleRequirementInputSchema,
  reselectRequirementTemplateInputSchema,
  reasonCommandSchema,
  reorderWorkItemsInputSchema,
  templateInputSchema,
  templateItemSchema,
  updateRequirementInputSchema,
  workItemCommandSchema,
  workItemInputSchema,
} from '../shared/contracts';

const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  structuredContent: { result: value },
});

function createServer(actor: AuthorizationActor, onUnknownError: (error: unknown) => void) {
  const server = new McpServer({ name: 'project-manage', version: '1.2.0' });
  const inputSchemas = new Map<string, StandardSchemaWithJSON>();
  const registerTool = <InputArgs extends StandardSchemaWithJSON>(
    name: string,
    config: { description?: string; inputSchema: InputArgs },
    callback: ToolCallback<InputArgs>,
  ) => {
    inputSchemas.set(name, config.inputSchema);
    return server.registerTool(name, config, (async (...args: Parameters<ToolCallback<InputArgs>>) => {
    try {
      return await (callback as (...values: unknown[]) => unknown)(...(args as unknown[]));
    } catch (error) {
      const response = errorResponse(error);
      if (!response.known) onUnknownError(error);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response.payload) }],
        structuredContent: { error: response.payload, statusCode: response.statusCode },
        isError: true,
      };
    }
    }) as ToolCallback<InputArgs>);
  };

  registerTool('dashboard_summary', { description: '查询项目看板、自动风险和图表', inputSchema: z.object({ projectId: z.string() }) }, async ({ projectId }) => {
    assertProjectReadable(actor, projectId); const dashboard = getDashboard(projectId);
    return json({ ...dashboard, actions: listActionItems({ projectId, pageSize: 5 }, actor, dashboard.requirements) });
  });
  registerTool('get_my_work', { description: '查询当前账号负责的需求、工作项和近期进展', inputSchema: z.object({}) }, async () => json(getMyWork(actor.accountId)));
  registerTool('list_action_items', { description: '查询当前账号可见的客观异常与待处理事项', inputSchema: actionItemsInputSchema }, async (input) => {
    assertProjectReadable(actor, input.projectId); return json(listActionItems(input, actor));
  });
  registerTool('get_analytics_catalog', { description: '查询可用的业务分析主题、指标和维度', inputSchema: z.object({}) }, async () => json(getAnalyticsCatalog()));
  registerTool('query_analytics', { description: '按项目查询业务分析指标', inputSchema: z.object({
    projectId: z.string(), range: z.object({ from: z.string(), to: z.string() }), panels: z.array(z.record(z.string(), z.unknown())).min(1),
  }) }, async (input) => { assertProjectReadable(actor, input.projectId); return json(queryAnalytics(input)); });
  registerTool('people_concurrency', { description: '查询人员当前及未来并发度', inputSchema: projectPeopleConcurrencyInputSchema }, async (input) => {
    const projectId = input.projectId!;
    assertProjectReadable(actor, projectId); return json(getPeopleConcurrency({
      ...input,
      from: input.from || undefined,
      to: input.to || undefined,
      includeExternalAggregate: canManageProject(actor, projectId),
    }));
  });

  registerTool('list_projects', { description: '查询项目', inputSchema: z.object({ includeDeleted: z.boolean().optional() }) }, async ({ includeDeleted }) => json(listProjects(includeDeleted, actor)));
  registerTool('create_project', { description: '创建项目', inputSchema: projectInputSchema.extend({ name: z.string().min(1) }) }, async (input) => {
    assertAdmin(actor); return json(createProject(input, actor));
  });
  registerTool('update_project', { description: '修改项目', inputSchema: projectInputSchema.extend({ id: z.string() }) }, async ({ id, ...input }) => {
    assertProjectManager(actor, id); return json(updateProject(id, input, actor));
  });
  registerTool('archive_project', { description: '归档项目', inputSchema: z.object({ id: z.string(), force: z.boolean().optional() }) }, async ({ id, force }) => {
    assertAdmin(actor); return json(archiveProject(id, actor, { force }));
  });
  registerTool('restore_project', { description: '恢复项目', inputSchema: z.object({ id: z.string() }) }, async ({ id }) => {
    assertAdmin(actor); return json(restoreProject(id, actor));
  });

  registerTool('list_requirements', { description: '筛选查询需求', inputSchema: z.object({ projectId: z.string(), status: z.string().optional(), view: z.enum(['delayed', 'high_risk']).optional(), includeDeleted: z.boolean().optional() }) }, async (input) => {
    assertProjectReadable(actor, input.projectId); return json(listRequirements(input));
  });
  registerTool('get_requirement', { description: '获取需求、自动指标、工作项和进展', inputSchema: z.object({ id: z.string(), includeDeleted: z.boolean().optional() }) }, async ({ id, includeDeleted }) => {
    assertProjectResourceReadable(actor, projectIdForRequirement(id), '需求不存在'); return json(getRequirement(id, includeDeleted));
  });
  registerTool('create_requirement', { description: '轻量创建待规划需求；提供计划开始或截止日期时按模板生成工作项', inputSchema: createRequirementInputSchema }, async (input) => {
    assertProjectManager(actor, input.projectId); return json(createRequirement(input, actor));
  });
  registerTool('update_requirement', { description: '修改需求标题或优先级，不修改执行状态和计划', inputSchema: updateRequirementInputSchema.extend({ id: z.string() }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在'); return json(updateRequirement(id, input, actor));
  });
  registerTool('reschedule_requirement', { description: '按开始日期正排或截止日期倒排并整体顺延需求计划', inputSchema: rescheduleRequirementInputSchema.extend({ id: z.string() }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在'); return json(rescheduleRequirement(id, input, actor));
  });
  registerTool('reselect_requirement_template', { description: '仅对未执行需求重新选择流程，替换工作项并保留需求级说明', inputSchema: reselectRequirementTemplateInputSchema.extend({ id: z.string() }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在'); return json(reselectRequirementTemplate(id, input, actor));
  });
  registerTool('archive_requirement', { description: '归档需求', inputSchema: expectedVersionInputSchema.extend({ id: z.string() }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在'); return json(archiveRequirement(id, input, actor));
  });
  registerTool('accept_requirement', { description: '项目经理确认验收待验收需求', inputSchema: contentCommandSchema.extend({ id: z.string() }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在'); return json(acceptRequirement(id, input, actor));
  });
  registerTool('cancel_requirement', { description: '取消需求并级联取消未完成工作项', inputSchema: reasonCommandSchema.extend({ id: z.string() }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在'); return json(cancelRequirement(id, input, actor));
  });
  registerTool('restore_requirement', { description: '恢复需求', inputSchema: z.object({ id: z.string() }) }, async ({ id }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在'); return json(restoreRequirement(id, actor));
  });
  registerTool('preview_requirement_plan', { description: '预览按模板补全缺失计划，不写入数据', inputSchema: z.object({ requirementId: z.string(), templateId: z.string(), baseStart: z.string() }) }, async ({ requirementId, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(requirementId), '需求不存在'); return json(previewRequirementPlan(requirementId, input));
  });
  registerTool('apply_requirement_plan', { description: '确认后只补充缺失计划或工作项', inputSchema: z.object({ requirementId: z.string(), templateId: z.string(), baseStart: z.string(), templateItemIds: z.array(z.string()).optional(), reason: z.string().optional(), expectedVersion: z.number().int().min(1) }) }, async ({ requirementId, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(requirementId), '需求不存在'); return json(applyRequirementPlan(requirementId, input, actor));
  });

  registerTool('create_work_item', { description: '新增工作项', inputSchema: workItemInputSchema.extend({ requirementId: z.string(), title: z.string().min(1), expectedVersion: z.number().int().min(1) }) }, async ({ requirementId, ...input }) => {
    assertRequirementOwnerOrManager(actor, requirementId); return json(createWorkItem(requirementId, input, actor));
  });
  registerTool('update_work_item', { description: '修改工作项元数据、负责人和计划日期；执行数据需使用状态命令', inputSchema: workItemInputSchema.extend({ id: z.string(), expectedVersion: z.number().int().min(1) }) }, async ({ id, ...input }) => {
    assertWorkItemRequirementOwnerOrManager(actor, id); return json(updateWorkItem(id, input, actor));
  });
  registerTool('start_work_item', { description: '开始工作项并自动记录实际开始', inputSchema: expectedVersionInputSchema.extend({ id: z.string() }) }, async ({ id, ...input }) => {
    assertWorkItemParticipantOrManager(actor, id); return json(startWorkItem(id, input, actor));
  });
  registerTool('complete_work_item', { description: '完成工作项并记录完成说明', inputSchema: contentCommandSchema.extend({ id: z.string() }) }, async ({ id, ...input }) => {
    assertWorkItemParticipantOrManager(actor, id); return json(completeWorkItem(id, input, actor));
  });
  registerTool('block_work_item', { description: '标记工作项阻塞', inputSchema: reasonCommandSchema.extend({ id: z.string() }) }, async ({ id, ...input }) => {
    assertWorkItemParticipantOrManager(actor, id); return json(blockWorkItem(id, input, actor));
  });
  registerTool('unblock_work_item', { description: '解除工作项阻塞', inputSchema: workItemCommandSchema.extend({ id: z.string() }) }, async ({ id, ...input }) => {
    assertWorkItemParticipantOrManager(actor, id); return json(unblockWorkItem(id, input, actor));
  });
  registerTool('cancel_work_item', { description: '取消工作项', inputSchema: reasonCommandSchema.extend({ id: z.string() }) }, async ({ id, ...input }) => {
    assertWorkItemRequirementOwnerOrManager(actor, id); return json(cancelWorkItem(id, input, actor));
  });
  registerTool('reopen_work_item', { description: '项目经理重开已完成或已取消工作项', inputSchema: z.object({ id: z.string(), reason: z.string().min(1), progress: z.number().int().min(0).max(99).optional(), expectedVersion: z.number().int().min(1) }) }, async ({ id, ...input }) => {
    assertWorkItemRequirementOwnerOrManager(actor, id); return json(reopenWorkItem(id, input, actor));
  });
  registerTool('correct_work_item', { description: '项目经理追加工作项纠错记录', inputSchema: z.object({
    id: z.string(), reason: z.string().min(1), title: z.string().min(1).optional(),
    progress: z.number().int().min(0).max(100).optional(), actualStart: optionalDateSchema,
    actualEnd: optionalDateSchema, supersedesId: z.string().nullable().optional(), expectedVersion: z.number().int().min(1),
  }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForWorkItem(id), '工作项不存在'); return json(correctWorkItem(id, input, actor));
  });
  registerTool('delete_work_item', { description: '删除未开始且无历史的工作项', inputSchema: expectedVersionInputSchema.extend({ id: z.string() }) }, async ({ id, ...input }) => {
    assertWorkItemRequirementOwnerOrManager(actor, id); return json(deleteWorkItem(id, input, actor));
  });
  registerTool('reorder_work_items', { description: '调整工作项顺序', inputSchema: reorderWorkItemsInputSchema.extend({ requirementId: z.string() }) }, async ({ requirementId, ids, ...input }) => {
    assertRequirementOwnerOrManager(actor, requirementId); return json(reorderWorkItems(requirementId, ids, actor, input));
  });

  registerTool('add_progress', { description: '追加工作项进展；完成度不能达到100%', inputSchema: progressInputSchema.extend({ requirementId: z.string() }) }, async ({ requirementId, ...input }) => {
    assertCanAddProgress(actor, requirementId, input.workItemId || null); return json(addProgress(requirementId, input, actor));
  });
  registerTool('update_progress', { description: '尝试修改进展记录；现有只追加规则会返回明确冲突', inputSchema: z.object({
    id: z.string(), content: z.string().optional(), workItemId: z.string().nullable().optional(),
    workItemPercent: z.number().int().min(0).max(99).optional(), expectedVersion: z.number().int().min(1).optional(),
  }) }, async ({ id, ...input }) => {
    assertProgressOwnerOrManager(actor, id, Object.prototype.hasOwnProperty.call(input, 'workItemId') ? input.workItemId : undefined);
    return json(updateProgress(id, input, actor));
  });
  registerTool('delete_progress', { description: '尝试删除进展记录；现有只追加规则会返回明确冲突', inputSchema: z.object({ id: z.string() }) }, async ({ id }) => {
    assertProgressOwnerOrManager(actor, id); return json(deleteProgress(id, actor));
  });

  registerTool('list_issues', { description: '按项目筛选查询问题', inputSchema: issueListInputSchema }, async (input) => {
    assertProjectReadable(actor, input.projectId); return json(listIssues(input));
  });
  registerTool('get_issue', { description: '获取问题详情和只追加进展历史', inputSchema: z.object({ id: z.string() }) }, async ({ id }) => {
    assertProjectResourceReadable(actor, projectIdForIssue(id), '问题不存在'); return json(getIssue(id));
  });
  registerTool('create_issue', { description: '创建处理中问题', inputSchema: issueInputSchema.extend({ projectId: z.string(), title: z.string().min(1) }) }, async (input) => {
    assertProjectMember(actor, input.projectId);
    return json(createIssue(canManageProject(actor, input.projectId) ? input : { ...input, ownerId: null, progress: 0 }, actor));
  });
  registerTool('update_issue', { description: '项目经理修改问题元数据，不直接修改状态或进度', inputSchema: issueInputSchema.extend({ id: z.string(), expectedVersion: z.number().int().min(1) }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在'); return json(updateIssue(id, input, actor));
  });
  registerTool('add_issue_update', { description: '追加问题说明或0-99%进度', inputSchema: issueUpdateInputSchema.extend({ id: z.string() }) }, async ({ id, ...input }) => {
    const projectId = projectIdForIssue(id);
    assertProjectResourceReadable(actor, projectId, '问题不存在'); assertProjectMember(actor, projectId);
    return json(addIssueUpdate(id, input, actor, { canSetProgress: canUpdateIssueProgress(actor, id), canResolve: canManageProject(actor, projectId) }));
  });
  registerTool('update_issue_update', { description: '尝试修改问题进展；现有只追加规则会返回明确冲突', inputSchema: z.object({
    id: z.string(), updateId: z.string(), content: z.string().optional(), progress: z.number().int().min(0).max(99).optional(),
  }) }, async ({ id, updateId, ...input }) => {
    assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在'); return json(updateIssueUpdate(id, updateId, input, actor));
  });
  registerTool('delete_issue_update', { description: '尝试删除问题进展；现有只追加规则会返回明确冲突', inputSchema: z.object({ id: z.string(), updateId: z.string() }) }, async ({ id, updateId }) => {
    assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在'); return json(deleteIssueUpdate(id, updateId, actor));
  });
  for (const [name, description, handler] of [
    ['defer_issue', '挂起问题', deferIssue], ['resume_issue', '恢复挂起问题', resumeIssue],
    ['resolve_issue', '确认问题解决', resolveIssue], ['reopen_issue', '重开已解决问题', reopenIssue],
    ['correct_issue', '追加问题纠错记录', correctIssue],
  ] as const) {
    registerTool(name, { description, inputSchema: z.object({
      id: z.string(), reason: z.string().optional(), content: z.string().optional(),
      title: z.string().min(1).optional(), impact: z.string().nullable().optional(),
      resolvedAt: optionalDateSchema, supersedesId: z.string().nullable().optional(),
      progress: z.number().int().min(0).max(100).optional(), expectedVersion: z.number().int().min(1),
    }) }, async ({ id, ...input }) => {
      assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在'); return json(handler(id, input, actor));
    });
  }

  registerTool('list_templates', { description: '按项目查询结构化流程设计', inputSchema: z.object({ projectId: z.string(), includeDeleted: z.boolean().optional() }) }, async ({ projectId, includeDeleted }) => {
    assertProjectReadable(actor, projectId); return json(listTemplates(projectId, includeDeleted));
  });
  registerTool('create_template', { description: '创建带设计说明、偏移和工期的流程', inputSchema: templateInputSchema.extend({ projectId: z.string(), name: z.string().min(1), items: z.array(templateItemSchema).min(1).max(maxTemplateItems) }) }, async (input) => {
    assertProjectManager(actor, input.projectId); return json(createTemplate(input, actor));
  });
  registerTool('update_template', { description: '修改流程，只影响之后应用流程的需求', inputSchema: templateInputSchema.extend({ id: z.string() }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForTemplate(id), '流程设计不存在'); return json(updateTemplate(id, input, actor));
  });
  registerTool('archive_template', { description: '归档流程', inputSchema: z.object({ id: z.string() }) }, async ({ id }) => {
    assertProjectResourceManager(actor, projectIdForTemplate(id), '流程设计不存在'); return json(archiveTemplate(id, actor));
  });
  registerTool('restore_template', { description: '恢复流程', inputSchema: z.object({ id: z.string() }) }, async ({ id }) => {
    assertProjectResourceManager(actor, projectIdForTemplate(id), '流程设计不存在'); return json(restoreTemplate(id, actor));
  });
  registerTool('apply_template', { description: '向已有需求补充流程中缺少的工作项', inputSchema: z.object({ requirementId: z.string(), templateId: z.string(), reason: z.string().optional(), expectedVersion: z.number().int().min(1) }) }, async ({ requirementId, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(requirementId), '需求不存在'); return json(applyTemplate(requirementId, input, actor));
  });
  registerTool('copy_template', { description: '将已有流程复制到目标项目', inputSchema: z.object({ projectId: z.string(), sourceTemplateId: z.string() }) }, async ({ projectId, sourceTemplateId }) => {
    assertProjectManager(actor, projectId); assertProjectResourceReadable(actor, projectIdForTemplate(sourceTemplateId), '来源流程不存在');
    return json(copyTemplate(projectId, sourceTemplateId, actor));
  });

  registerTool('list_people', { description: '按项目查询人员和岗位', inputSchema: z.object({ projectId: z.string().optional(), includeDeleted: z.boolean().optional() }) }, async ({ projectId, includeDeleted }) => {
    if (projectId) assertProjectReadable(actor, projectId); else assertAdmin(actor); return json(listPeople(includeDeleted, projectId));
  });
  registerTool('list_project_members', { description: '查询项目成员、项目角色与账号绑定状态', inputSchema: z.object({ projectId: z.string() }) }, async ({ projectId }) => {
    assertProjectReadable(actor, projectId); return json(listPeople(false, projectId));
  });
  registerTool('set_project_member_role', { description: '添加项目成员或调整项目角色', inputSchema: z.object({
    projectId: z.string(), personId: z.string(), role: z.enum(['viewer', 'member', 'manager']),
  }) }, async ({ projectId, personId, role }) => {
    assertProjectManager(actor, projectId); return json(addProjectPerson(projectId, personId, actor, role));
  });
  registerTool('list_person_candidates', { description: '查询可加入项目的有效人员', inputSchema: z.object({ projectId: z.string(), q: z.string().optional() }) }, async ({ projectId, q }) => {
    assertProjectManager(actor, projectId); return json(listPeopleCandidates(projectId, q || ''));
  });
  registerTool('create_person', { description: '新增平台人员', inputSchema: personInputSchema.extend({ name: z.string().min(1) }) }, async (input) => {
    assertAdmin(actor); return json(createPerson(input, actor));
  });
  registerTool('add_project_person', { description: '将已有人员加入项目', inputSchema: z.object({ projectId: z.string(), personId: z.string(), role: z.enum(['viewer', 'member']).optional() }) }, async ({ projectId, personId, role }) => {
    assertProjectManager(actor, projectId); return json(addProjectPerson(projectId, personId, actor, role));
  });
  registerTool('remove_project_person', { description: '安全地将人员移出项目', inputSchema: z.object({ projectId: z.string(), personId: z.string() }) }, async ({ projectId, personId }) => {
    assertProjectManager(actor, projectId); return json(removeProjectPerson(projectId, personId, actor));
  });
  registerTool('update_person', { description: '修改平台人员或岗位', inputSchema: personInputSchema.extend({ id: z.string() }) }, async ({ id, ...input }) => {
    assertAdmin(actor); return json(updatePerson(id, input, actor));
  });
  registerTool('archive_person', { description: '归档平台人员', inputSchema: z.object({ id: z.string() }) }, async ({ id }) => {
    assertAdmin(actor); return json(archivePerson(id, actor));
  });
  registerTool('restore_person', { description: '恢复平台人员', inputSchema: z.object({ id: z.string() }) }, async ({ id }) => {
    assertAdmin(actor); return json(restorePerson(id, actor));
  });
  registerTool('list_archives', { description: '查询有权限的归档；项目经理需指定项目', inputSchema: z.object({ projectId: z.string().optional() }) }, async ({ projectId }) => {
    if (!projectId) { assertAdmin(actor); return json(listArchives()); }
    assertProjectManager(actor, projectId); return json(listArchives(projectId));
  });
  registerTool('permanently_delete_archive', {
    description: '永久删除已归档的项目、需求、人员或模板；该操作不可恢复',
    inputSchema: z.object({ entity: z.enum(['projects', 'requirements', 'people', 'templates']), id: z.string(), confirmName: z.string().optional() }),
  }, async ({ entity, id, ...input }) => { assertAdmin(actor); return json(permanentlyDeleteArchive(entity, id, actor, input)); });
  registerTool('list_audit_logs', { description: '查询审计日志', inputSchema: z.object({ limit: z.number().int().min(1).max(500).optional() }) }, async ({ limit }) => {
    assertAdmin(actor); return json(listAudit(limit));
  });
  return { server, inputSchemas };
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
      const { server, inputSchemas } = createServer(actor, (error) => request.log.error({ err: error }, 'Unhandled MCP tool error'));
      const envelope = request.body as { jsonrpc?: string; id?: unknown; method?: string; params?: { name?: string; arguments?: unknown } } | null;
      if (envelope?.method === 'tools/call' && envelope.params?.name) {
        const schema = inputSchemas.get(envelope.params.name);
        const validation = schema ? await schema['~standard'].validate(envelope.params.arguments ?? {}) : null;
        if (validation?.issues?.length) {
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
      await server.connect(transport); reply.hijack();
      try { await transport.handleRequest(request.raw, reply.raw, request.body); }
      finally { await server.close(); }
    },
  });
}
