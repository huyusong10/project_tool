import type { FastifyInstance } from 'fastify';
import { McpServer, type StandardSchemaWithJSON, type ToolCallback } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { z } from 'zod';
import { todayIso } from '../shared/domain';
import {
  assertAdmin, assertCanAddProgress, assertProgressOwnerOrManager, assertProjectManager, assertProjectMember, assertProjectReadable,
  assertProjectResourceManager, assertProjectResourceReadable, assertRequirementOwnerOrManager,
  assertWorkItemParticipantOrManager, assertWorkItemRequirementOwnerOrManager, canManageProject, canUpdateIssueProgress,
  isAdmin, projectIdForIssue, projectIdForRequirement, projectIdForTemplate, projectIdForWorkItem,
  type AuthorizationActor,
} from './authorization';
import {
  acceptRequirement, addProgress, addProjectPerson, applyRequirementPlan, applyTemplate, archivePerson, archiveProject, archiveRequirement, archiveTemplate,
  addIssueUpdate, blockWorkItem, cancelRequirement, cancelWorkItem, completeWorkItem, correctIssue, correctRequirement, correctWorkItem, createIssue, createPerson, createProject, createRequirement, createTemplate,
  copyTemplate, createWorkItem, deleteIssueUpdate, deleteProgress, deleteWorkItem, getDashboard, getIssue, getPeopleConcurrency, getRequirement, listActionItems, listArchives,
  listAudit, listIssues, listPeople, listPeopleCandidates, listProjects, listRequirements, listTemplates, permanentlyDeleteArchive, previewRequirementPlan, removeProjectPerson, reorderWorkItems,
  deferIssue, reopenIssue, reopenWorkItem, reselectRequirementTemplate, rescheduleRequirement, resolveIssue, restorePerson, restoreProject, restoreRequirement, restoreTemplate, resumeIssue, startWorkItem, unblockWorkItem, updateIssue, updatePerson,
  updateIssueUpdate, updateProgress, updateProject, updateRequirement, updateTemplate, updateWorkItem,
} from './services';
import { getMyWork } from './accounts';
import { completeRequirementAsPlanned, completeWorkItemAsPlanned } from './services';
import { getAnalyticsCatalog, queryAnalytics } from './analytics';
import { errorResponse } from './errors';
import {
  actionItemsInputSchema,
  analyticsQueryInputSchema,
  archiveDeleteInputSchema,
  archiveListInputSchema,
  archiveRestoreInputSchema,
  auditListInputSchema,
  applyRequirementPlanInputSchema,
  applyTemplateInputSchema,
  contentCommandSchema,
  optionalContentCommandSchema,
  completeAsPlannedInputSchema,
  copyTemplateInputSchema,
  createIssueInputSchema,
  createPersonInputSchema,
  createProjectInputSchema,
  createRequirementInputSchema,
  createTemplateInputSchema,
  createWorkItemInputSchema,
  emptyCommandInputSchema,
  expectedVersionInputSchema,
  idParamsSchema,
  idSchema,
  issueCorrectionInputSchema,
  issueListInputSchema,
  issueUpdateParamsSchema,
  issueUpdateHistoryInputSchema,
  issueUpdateInputSchema,
  projectPeopleConcurrencyInputSchema,
  peopleListInputSchema,
  personCandidatesInputSchema,
  personCommandSchema,
  updatePersonInputSchema,
  progressInputSchema,
  progressHistoryUpdateInputSchema,
  previewRequirementPlanInputSchema,
  projectArchiveInputSchema,
  projectInputSchema,
  projectListInputSchema,
  projectMemberMutationCommandSchema,
  projectMemberMutationInputSchema,
  projectParamsSchema,
  projectResourceListInputSchema,
  projectScopeInputSchema,
  rescheduleRequirementInputSchema,
  reselectRequirementTemplateInputSchema,
  reasonCommandSchema,
  requirementCorrectionInputSchema,
  reopenIssueInputSchema,
  reopenWorkItemInputSchema,
  requirementListInputSchema,
  reorderWorkItemsInputSchema,
  templateCommandSchema,
  updateTemplateInputSchema,
  updateRequirementInputSchema,
  updateIssueInputSchema,
  updateWorkItemInputSchema,
  workItemCorrectionSchema,
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

  registerTool('dashboard_summary', { description: '查询项目看板、自动风险和图表', inputSchema: projectScopeInputSchema }, async ({ projectId }) => {
    assertProjectReadable(actor, projectId); const asOfDate = todayIso(); const dashboard = getDashboard(projectId, asOfDate);
    return json({ ...dashboard, actions: listActionItems({ projectId, pageSize: 5 }, actor, dashboard.requirements, asOfDate) });
  });
  registerTool('get_my_work', { description: '查询当前账号负责的需求、工作项和近期进展', inputSchema: emptyCommandInputSchema }, async () => json(getMyWork(actor.accountId)));
  registerTool('list_action_items', { description: '查询当前账号可见的客观异常与待处理事项', inputSchema: actionItemsInputSchema }, async (input) => {
    assertProjectReadable(actor, input.projectId); return json(listActionItems(input, actor));
  });
  registerTool('get_analytics_catalog', { description: '查询可用的业务分析主题、指标和维度', inputSchema: emptyCommandInputSchema }, async () => json(getAnalyticsCatalog()));
  registerTool('query_analytics', { description: '按项目查询业务分析指标', inputSchema: analyticsQueryInputSchema }, async (input) => {
    assertProjectReadable(actor, input.projectId); return json(queryAnalytics(input));
  });
  registerTool('people_concurrency', { description: '查询人员当前及未来并发度', inputSchema: projectPeopleConcurrencyInputSchema }, async (input) => {
    const projectId = input.projectId!;
    assertProjectReadable(actor, projectId); return json(getPeopleConcurrency({
      ...input,
      from: input.from || undefined,
      to: input.to || undefined,
      includeExternalAggregate: canManageProject(actor, projectId),
    }));
  });

  registerTool('list_projects', { description: '查询项目', inputSchema: projectListInputSchema }, async ({ includeDeleted }) => json(listProjects(includeDeleted, actor)));
  registerTool('create_project', { description: '创建项目', inputSchema: createProjectInputSchema }, async (input) => {
    assertAdmin(actor); return json(createProject(input, actor));
  });
  registerTool('update_project', { description: '修改项目', inputSchema: projectInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProjectManager(actor, id); return json(updateProject(id, input, actor));
  });
  registerTool('archive_project', { description: '归档项目', inputSchema: projectArchiveInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertAdmin(actor); return json(archiveProject(id, actor, input));
  });
  registerTool('restore_project', { description: '恢复项目', inputSchema: archiveRestoreInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertAdmin(actor); return json(restoreProject(id, actor, input));
  });

  registerTool('list_requirements', { description: '筛选查询需求', inputSchema: requirementListInputSchema }, async (input) => {
    if (input.includeDeleted) assertProjectManager(actor, input.projectId); else assertProjectReadable(actor, input.projectId);
    return json(listRequirements(input));
  });
  registerTool('get_requirement', { description: '获取需求、自动指标、工作项和进展', inputSchema: projectListInputSchema.safeExtend({ id: idSchema }) }, async ({ id, includeDeleted }) => {
    const projectId = projectIdForRequirement(id);
    if (includeDeleted) assertProjectResourceManager(actor, projectId, '需求不存在'); else assertProjectResourceReadable(actor, projectId, '需求不存在');
    return json(getRequirement(id, includeDeleted));
  });
  registerTool('create_requirement', { description: '轻量创建待规划需求；提供计划开始或截止日期时按模板生成工作项', inputSchema: createRequirementInputSchema }, async (input) => {
    assertProjectManager(actor, input.projectId); return json(createRequirement(input, actor));
  });
  registerTool('update_requirement', { description: '修改非终态需求的标题、优先级、负责人和辅助信息；不修改状态、排期或流程', inputSchema: updateRequirementInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在'); return json(updateRequirement(id, input, actor));
  });
  registerTool('correct_requirement', { description: '项目经理修正已完成或已取消需求的基本信息；保持交付状态并追加不可变纠错记录', inputSchema: requirementCorrectionInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在'); return json(correctRequirement(id, input, actor));
  });
  registerTool('reschedule_requirement', { description: '按开始日期正排或截止日期倒排并整体顺延需求计划', inputSchema: rescheduleRequirementInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在'); return json(rescheduleRequirement(id, input, actor));
  });
  registerTool('reselect_requirement_template', { description: '仅对未执行需求重新选择流程，替换工作项并保留需求级说明', inputSchema: reselectRequirementTemplateInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在'); return json(reselectRequirementTemplate(id, input, actor));
  });
  registerTool('archive_requirement', { description: '归档需求', inputSchema: expectedVersionInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在'); return json(archiveRequirement(id, input, actor));
  });
  registerTool('accept_requirement', { description: '项目经理确认验收待验收需求', inputSchema: contentCommandSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在'); return json(acceptRequirement(id, input, actor));
  });
  registerTool('complete_requirement_as_planned', { description: '经理历史补录：未执行工作项按过去计划日期完成，并验收需求；保留已完成或取消记录', inputSchema: completeAsPlannedInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在'); return json(completeRequirementAsPlanned(id, input, actor));
  });
  registerTool('complete_work_item_as_planned', { description: '经理历史补录：仅无执行记录且计划已结束的工作项可按计划日期完成', inputSchema: completeAsPlannedInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForWorkItem(id), '工作项不存在'); return json(completeWorkItemAsPlanned(id, input, actor));
  });
  registerTool('cancel_requirement', { description: '取消需求并级联取消未完成工作项', inputSchema: reasonCommandSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在'); return json(cancelRequirement(id, input, actor));
  });
  registerTool('restore_requirement', { description: '恢复需求', inputSchema: archiveRestoreInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在'); return json(restoreRequirement(id, actor, input));
  });
  registerTool('preview_requirement_plan', { description: '预览按模板补全缺失计划，不写入数据；返回requirementVersion和previewToken供确认时原样提交', inputSchema: previewRequirementPlanInputSchema.safeExtend({ requirementId: idSchema }) }, async ({ requirementId, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(requirementId), '需求不存在'); return json(previewRequirementPlan(requirementId, input));
  });
  registerTool('apply_requirement_plan', { description: '确认后只补充缺失计划或工作项；传入预览的previewToken及requirementVersion作为expectedVersion，预览失效时重新预览', inputSchema: applyRequirementPlanInputSchema.safeExtend({ requirementId: idSchema }) }, async ({ requirementId, ...input }) => {
    assertProjectResourceManager(actor, projectIdForRequirement(requirementId), '需求不存在'); return json(applyRequirementPlan(requirementId, input, actor));
  });

  registerTool('create_work_item', { description: '新增工作项', inputSchema: createWorkItemInputSchema.safeExtend({ requirementId: idSchema }) }, async ({ requirementId, ...input }) => {
    assertRequirementOwnerOrManager(actor, requirementId); return json(createWorkItem(requirementId, input, actor));
  });
  registerTool('update_work_item', { description: '修改工作项元数据、负责人和计划日期；执行数据需使用状态命令', inputSchema: updateWorkItemInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertWorkItemRequirementOwnerOrManager(actor, id); return json(updateWorkItem(id, input, actor));
  });
  registerTool('start_work_item', { description: '开始工作项并自动记录实际开始', inputSchema: expectedVersionInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertWorkItemParticipantOrManager(actor, id); return json(startWorkItem(id, input, actor));
  });
  registerTool('complete_work_item', { description: '完成工作项；完成说明可选', inputSchema: optionalContentCommandSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertWorkItemParticipantOrManager(actor, id); return json(completeWorkItem(id, input, actor));
  });
  registerTool('block_work_item', { description: '标记工作项阻塞', inputSchema: reasonCommandSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertWorkItemParticipantOrManager(actor, id); return json(blockWorkItem(id, input, actor));
  });
  registerTool('unblock_work_item', { description: '解除工作项阻塞', inputSchema: expectedVersionInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertWorkItemParticipantOrManager(actor, id); return json(unblockWorkItem(id, input, actor));
  });
  registerTool('cancel_work_item', { description: '取消工作项', inputSchema: reasonCommandSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertWorkItemRequirementOwnerOrManager(actor, id); return json(cancelWorkItem(id, input, actor));
  });
  registerTool('reopen_work_item', { description: '需求负责人或项目经理重开已完成或已取消工作项，并使已验收需求恢复执行', inputSchema: reopenWorkItemInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertWorkItemRequirementOwnerOrManager(actor, id); return json(reopenWorkItem(id, input, actor));
  });
  registerTool('correct_work_item', { description: '项目经理受控修正工作项标题、完成度或实际日期；保持状态并追加不可变纠错记录', inputSchema: workItemCorrectionSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForWorkItem(id), '工作项不存在'); return json(correctWorkItem(id, input, actor));
  });
  registerTool('delete_work_item', { description: '删除未开始且无历史的工作项', inputSchema: expectedVersionInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertWorkItemRequirementOwnerOrManager(actor, id); return json(deleteWorkItem(id, input, actor));
  });
  registerTool('reorder_work_items', { description: '调整工作项顺序', inputSchema: reorderWorkItemsInputSchema.safeExtend({ requirementId: idSchema }) }, async ({ requirementId, ids, ...input }) => {
    assertRequirementOwnerOrManager(actor, requirementId); return json(reorderWorkItems(requirementId, ids, actor, input));
  });

  registerTool('add_progress', { description: '追加工作项进展；完成度不能达到100%', inputSchema: progressInputSchema.safeExtend({ requirementId: idSchema }) }, async ({ requirementId, ...input }) => {
    assertCanAddProgress(actor, requirementId, input.workItemId || null); return json(addProgress(requirementId, input, actor));
  });
  registerTool('update_progress', { description: '尝试修改进展记录；现有只追加规则会返回明确冲突', inputSchema: progressHistoryUpdateInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProgressOwnerOrManager(actor, id, Object.prototype.hasOwnProperty.call(input, 'workItemId') ? input.workItemId : undefined);
    return json(updateProgress(id, input, actor));
  });
  registerTool('delete_progress', { description: '尝试删除进展记录；现有只追加规则会返回明确冲突', inputSchema: idParamsSchema }, async ({ id }) => {
    assertProgressOwnerOrManager(actor, id); return json(deleteProgress(id, actor));
  });

  registerTool('list_issues', { description: '按项目筛选查询问题', inputSchema: issueListInputSchema }, async (input) => {
    assertProjectReadable(actor, input.projectId); return json(listIssues(input));
  });
  registerTool('get_issue', { description: '获取问题详情和只追加进展历史', inputSchema: idParamsSchema }, async ({ id }) => {
    assertProjectResourceReadable(actor, projectIdForIssue(id), '问题不存在'); return json(getIssue(id));
  });
  registerTool('create_issue', { description: '创建处理中问题', inputSchema: createIssueInputSchema }, async (input) => {
    assertProjectMember(actor, input.projectId);
    return json(createIssue(canManageProject(actor, input.projectId) ? input : { ...input, ownerId: null }, actor));
  });
  registerTool('update_issue', { description: '项目经理修改问题元数据，不直接修改状态或进度', inputSchema: updateIssueInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在'); return json(updateIssue(id, input, actor));
  });
  registerTool('add_issue_update', { description: '追加问题说明或0-99%进度', inputSchema: issueUpdateInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    const projectId = projectIdForIssue(id);
    assertProjectResourceReadable(actor, projectId, '问题不存在'); assertProjectMember(actor, projectId);
    return json(addIssueUpdate(id, input, actor, { canSetProgress: canUpdateIssueProgress(actor, id), canResolve: canManageProject(actor, projectId) }));
  });
  registerTool('update_issue_update', { description: '尝试修改问题进展；现有只追加规则会返回明确冲突', inputSchema: issueUpdateHistoryInputSchema.safeExtend({ id: idSchema, updateId: idSchema }) }, async ({ id, updateId, ...input }) => {
    assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在'); return json(updateIssueUpdate(id, updateId, input, actor));
  });
  registerTool('delete_issue_update', { description: '尝试删除问题进展；现有只追加规则会返回明确冲突', inputSchema: issueUpdateParamsSchema }, async ({ id, updateId }) => {
    assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在'); return json(deleteIssueUpdate(id, updateId, actor));
  });
  registerTool('defer_issue', { description: '挂起问题', inputSchema: reasonCommandSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在'); return json(deferIssue(id, input, actor));
  });
  registerTool('resume_issue', { description: '恢复挂起问题', inputSchema: reasonCommandSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在'); return json(resumeIssue(id, input, actor));
  });
  registerTool('resolve_issue', { description: '确认问题解决', inputSchema: contentCommandSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在'); return json(resolveIssue(id, input, actor));
  });
  registerTool('reopen_issue', { description: '重开已解决问题', inputSchema: reopenIssueInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在'); return json(reopenIssue(id, input, actor));
  });
  registerTool('correct_issue', { description: '项目经理受控修正问题标题、影响、完成度或解决日期；保持状态并追加不可变纠错记录', inputSchema: issueCorrectionInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在'); return json(correctIssue(id, input, actor));
  });

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

  registerTool('list_people', { description: '按项目查询人员和岗位', inputSchema: peopleListInputSchema }, async ({ projectId, includeDeleted }) => {
    if (!projectId) assertAdmin(actor);
    else if (includeDeleted) assertProjectManager(actor, projectId);
    else assertProjectReadable(actor, projectId);
    return json(listPeople(includeDeleted, projectId));
  });
  registerTool('list_project_members', { description: '查询项目成员、项目角色与账号绑定状态', inputSchema: projectParamsSchema }, async ({ projectId }) => {
    assertProjectReadable(actor, projectId); return json(listPeople(false, projectId));
  });
  registerTool('set_project_member_role', { description: '添加项目成员或调整项目角色', inputSchema: projectMemberMutationInputSchema }, async ({ projectId, personId, role, expectedMembershipUpdatedAt }) => {
    assertProjectManager(actor, projectId); return json(addProjectPerson(projectId, personId, actor, role, expectedMembershipUpdatedAt));
  });
  registerTool('list_person_candidates', { description: '查询可加入项目的有效人员', inputSchema: personCandidatesInputSchema }, async ({ projectId, q }) => {
    assertProjectManager(actor, projectId); return json(listPeopleCandidates(projectId, q || ''));
  });
  registerTool('create_person', { description: '新增平台人员', inputSchema: createPersonInputSchema }, async (input) => {
    assertAdmin(actor); return json(createPerson(input, actor));
  });
  registerTool('add_project_person', { description: '将已有人员加入项目', inputSchema: projectMemberMutationInputSchema }, async ({ projectId, personId, role, expectedMembershipUpdatedAt }) => {
    assertProjectManager(actor, projectId); return json(addProjectPerson(projectId, personId, actor, role, expectedMembershipUpdatedAt));
  });
  registerTool('remove_project_person', { description: '安全地将人员移出项目', inputSchema: projectMemberMutationCommandSchema }, async ({ projectId, personId, expectedMembershipUpdatedAt }) => {
    assertProjectManager(actor, projectId); return json(removeProjectPerson(projectId, personId, actor, expectedMembershipUpdatedAt));
  });
  registerTool('update_person', { description: '修改平台人员或岗位；项目关系请使用项目成员工具', inputSchema: updatePersonInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertAdmin(actor); return json(updatePerson(id, input, actor));
  });
  registerTool('archive_person', { description: '归档平台人员', inputSchema: personCommandSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertAdmin(actor); return json(archivePerson(id, input, actor));
  });
  registerTool('restore_person', { description: '恢复平台人员', inputSchema: archiveRestoreInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertAdmin(actor); return json(restorePerson(id, actor, input));
  });
  registerTool('list_archives', { description: '查询有权限的归档；项目经理需指定项目', inputSchema: archiveListInputSchema }, async ({ projectId }) => {
    if (!projectId) { assertAdmin(actor); return json(listArchives()); }
    assertProjectManager(actor, projectId); return json(listArchives(projectId));
  });
  registerTool('permanently_delete_archive', {
    description: '永久删除已归档的项目、需求、人员或模板；必须传入list_archives返回的deletedAt作为expectedDeletedAt，该操作不可恢复',
    inputSchema: archiveDeleteInputSchema.safeExtend({ entity: z.enum(['projects', 'requirements', 'people', 'templates']), id: idSchema }),
  }, async ({ entity, id, ...input }) => { assertAdmin(actor); return json(permanentlyDeleteArchive(entity, id, actor, input)); });
  registerTool('list_audit_logs', { description: '查询审计日志；管理员可查全局，项目经理需指定项目', inputSchema: auditListInputSchema }, async ({ projectId, limit }) => {
    if (!isAdmin(actor)) assertProjectManager(actor, projectId || '');
    return json(listAudit(limit, projectId));
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
