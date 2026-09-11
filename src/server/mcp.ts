import {dependencyChangesInput,applyDependencyChangesInput,pathEstimateInput} from '../shared/workflow-contracts';
import {createRequirementInputSchema,updateRequirementInputSchema,requirementCorrectionInputSchema,createWorkItemInputSchema,updateWorkItemInputSchema,startWorkItemInputSchema,reasonCommandSchema,rescheduleRequirementInputSchema} from '../shared/workflow-contracts';
import {intakeOperations} from './intake-api';

import {isCoordinationEdit,assertCoordinationAccess} from './services/blocker-coordination';
import { executeDirectRequirement, returnRequirement } from './services/delivery-execution';
import { queryRequirements, queryWorkItems, readWorkItem, queryProgressUpdates } from './services/queries';
import { readPathGraph } from './services/path-graph';
import { projectChangeVersion } from './services/project-change-version';
import { requirementQuerySchema, workItemQuerySchema, progressQuerySchema, pathGraphQuerySchema } from '../shared/query-contracts';
import {directRequirementCommandSchema} from '../shared/contracts';
import type { FastifyInstance } from 'fastify';
import { McpServer, type StandardSchemaWithJSON, type ToolCallback } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { z } from 'zod';
import { todayIso } from '../shared/domain';
import { pathQuery, dependencyInput, pathVersion, dependencyPlanInput, applyDependencyPlanInput } from '../shared/path-contracts';
import { applyDependencyChanges, getDependencyChangeReceipt, previewDependencyChanges } from './services/path-changes';
import {milestoneCommand,readDiagramLayouts} from './services/milestones';
import { readPathAnalysis, addDependency, removeDependency, updatePathEstimate, previewDependencyPlan, applyDependencyPlan } from './services/paths';
import { assertAdmin, assertCanAddProgress, assertProjectManager, assertProjectMember, assertProjectReadable, assertProjectResourceManager, assertProjectResourceReadable, assertRequirementOwnerOrManager, assertWorkItemParticipantOrManager, assertWorkItemRequirementOwnerOrManager, canManageProject, canUpdateIssueProgress, isAdmin, projectIdForIssue, projectIdForRequirement, projectIdForTemplate, projectIdForWorkItem, type AuthorizationActor } from './authorization';
import { addProgress, addProjectPerson, applyRequirementPlan, applyTemplate, archivePerson, archiveProject, archiveRequirement, archiveTemplate, addIssueUpdate, cancelRequirement, cancelWorkItem, completeWorkItem, correctIssue, correctRequirement, correctWorkItem, createIssue, createPerson, createProject, createRequirement, createTemplate, copyTemplate, createWorkItem, deleteWorkItem, getDashboard, getIssue, getPeopleConcurrency, getRequirement, listActionItems, listArchives, listAudit, listIssues, listPeople, listPeopleCandidates, listProjects, listRequirements, listTemplates, permanentlyDeleteArchive, previewRequirementPlan, removeProjectPerson, reorderWorkItems, deferIssue, reopenIssue, reopenWorkItem, reselectRequirementTemplate, rescheduleRequirement, resolveIssue, restorePerson, restoreProject, restoreRequirement, restoreTemplate, resumeIssue, startWorkItem, updateIssue, updatePerson, updateProject, updateRequirement, updateTemplate, updateWorkItem } from './services';
import { getMyWork } from './accounts';
import { completeRequirementAsPlanned, completeWorkItemAsPlanned } from './services';
import { getAnalyticsCatalog, queryAnalytics } from './analytics';
import { errorResponse } from './errors';
import { actionItemsInputSchema, analyticsQueryInputSchema, archiveDeleteInputSchema, archiveListInputSchema, archiveRestoreInputSchema, auditListInputSchema, applyRequirementPlanInputSchema, applyTemplateInputSchema, contentCommandSchema, optionalContentCommandSchema, completeAsPlannedInputSchema, copyTemplateInputSchema, createIssueInputSchema, createPersonInputSchema, createProjectInputSchema, createTemplateInputSchema, emptyCommandInputSchema, expectedVersionInputSchema, idParamsSchema, idSchema, issueCorrectionInputSchema, issueListInputSchema, issueUpdateInputSchema, projectPeopleConcurrencyInputSchema, peopleListInputSchema, personCandidatesInputSchema, personCommandSchema, updatePersonInputSchema, progressInputSchema, previewRequirementPlanInputSchema, projectArchiveInputSchema, projectInputSchema, projectListInputSchema, projectMemberMutationCommandSchema, projectMemberMutationInputSchema, projectParamsSchema, projectResourceListInputSchema, projectScopeInputSchema, reselectRequirementTemplateInputSchema, reopenIssueInputSchema, reopenWorkItemInputSchema, requirementListInputSchema, reorderWorkItemsInputSchema, templateCommandSchema, updateTemplateInputSchema, updateIssueInputSchema, workItemCorrectionSchema } from '../shared/contracts';

const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  structuredContent: { result: value },
});

function createServer(actor: AuthorizationActor, onUnknownError: (error: unknown) => void) {
  const server = new McpServer({ name: 'project-manage', version: '1.3.0' });
  const inputSchemas = new Map<string, StandardSchemaWithJSON>();
  const registerTool = <InputArgs extends StandardSchemaWithJSON>(
    name: string,
    config: { description?: string; inputSchema: InputArgs },
    callback: ToolCallback<InputArgs>,
  ) => {
    inputSchemas.set(name, config.inputSchema);
    const readOnly = /^(get_|list_|query_|preview_|dashboard_summary$|people_concurrency$)/.test(name);
    return server.registerTool(name, { ...config, annotations: { readOnlyHint: readOnly, ...(readOnly ? { destructiveHint: false, idempotentHint: true, openWorldHint: false } : {}) } }, (async (...args: Parameters<ToolCallback<InputArgs>>) => {
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

  for(const op of intakeOperations)registerTool(op.name,{description:op.description,inputSchema:op.inputSchema},async input=>json(op.execute(input,actor)));
  registerTool('query_requirements', { description: '分页查询需求：支持关键词、分组 groupId、负责人、参与人、状态、高风险/延期及计划日期区间相交筛选。默认省略工作项，includeWorkItems=true 返回工作项。返回 items/total/page/pageSize/pages；旧 list_requirements 仍返回完整数组。', inputSchema: requirementQuerySchema }, async input => json(queryRequirements(input, actor)));
  registerTool('list_work_items', { description: '分页查询项目内工作项，支持需求、关键词、负责人 ownerId、负责人或协作者 participantId、状态、未完成 active、逾期 overdue、未分派 unassigned。from/to 按计划区间相交筛选，未排期不匹配日期。返回完整工作项字段及所属需求、项目、预测依据和版本。', inputSchema: workItemQuerySchema }, async input => json(queryWorkItems(input, actor)));
  registerTool('get_work_item', { description: '按工作项 ID 读取执行详情、负责人和协作者、计划与实际日期、进度及预测依据、未满足前置和版本。进展历史使用 list_progress_updates。', inputSchema: idParamsSchema }, async ({ id }) => json(readWorkItem(id, actor)));
  registerTool('list_progress_updates', { description: '分页读取项目进展历史，可按需求、工作项、发布账号、事件类型和正文关键词筛选。from/to 为北京时间自然日，含首尾日；按发布时间及写入顺序倒序。翻页原样传入首次返回的 snapshot，避免新记录挤动分页。', inputSchema: progressQuerySchema }, async input => json(queryProgressUpdates(input, actor)));
  registerTool('get_project_change_version', { description: '轻量读取项目变更版本，用于比较是否需要刷新；包括业务日期、分析版本及共享布局等，不执行路径分析。返回 version。', inputSchema: projectScopeInputSchema }, async ({ projectId }) => json(projectChangeVersion(projectId, actor)));
  registerTool('get_path_graph', { description: '读取与网页共用的拓扑视图 cards/links。view=features 为顶层特性图（planning/actual 分别控制规划和实际关系），view=feature 传 featureId 读取特性内需求图（ungrouped 为未归属集合）；特性图含空特性与历史依赖上下文，规划关系不参与排期。view=project 为原需求汇总，view=requirement 必须传 requirementId，展示内部及直接外部节点；target 决定关键性分析目标。可用 rootNodeId、traversal、depth 查询上下游，q 过滤节点。返回省略数量和可见节点的已存布局；保存前用 get_diagram_layouts 读取完整坐标再合并，避免覆盖隐藏坐标。layout=auto 计算新布局及折线，format=svg 额外导出 SVG 文本。自动布局使用固定卡片尺寸，最多 200 节点/1000 关系，不保存坐标；保存用批次 changes.layouts。', inputSchema: pathGraphQuerySchema }, async input => json(await readPathGraph(input, actor)));
  registerTool('get_diagram_layouts',{description:'读取已保存的团队画布位置与布局版本；scope 为 features、feature:特性ID（或 ungrouped）、global 或 requirement:需求ID，direction 为 right/down。保存通过 preview_dependency_changes/apply_dependency_changes 的 changes.layouts，expectedVersion 使用本结果 version；不存在的布局为 0。',inputSchema:z.object({projectId:idSchema})},async({projectId})=>json(readDiagramLayouts(projectId,actor)));
  registerTool('milestone_command',{description:'人工确认或重新打开独立里程碑，记录操作者和时间',inputSchema:z.object({id:idSchema,action:z.enum(['achieve','reopen']),expectedVersion:z.number().int().positive()})},async({id,action,...input})=>json(milestoneCommand(id,action,input,actor)));
  registerTool('get_path_analysis', { description: '查询完整项目执行网络 nodes/edges、依赖、关键性、余量、交付预测、日期偏差和影响来源；target 可为 project、acceptance:需求ID、工作项ID或里程碑ID。始终返回全图，局部或需求汇总图使用 get_path_graph；revision 用于批次 expectedRevision。', inputSchema: pathQuery.extend({ projectId: idSchema }) }, async ({ projectId, target }) => json(readPathAnalysis(projectId, target, actor)));
  registerTool('preview_dependency_changes', { description: '预览原子批次，不保存：changes.add/remove 为依赖，estimates 为工作项估算，entities 支持需求/工作项/里程碑的 create/update/delete，layouts 为共享坐标。实体创建 id 和连线 clientId 使用客户端临时唯一 ID，可在同批次互相引用；修改实体需 expectedVersion。布局 scope=features、feature:特性ID（或 ungrouped）、global 或 requirement:需求ID，expectedVersion 为已存布局版本或 0。返回 analysis、differences、previewToken；确认后原样提交本输入和凭据。', inputSchema: dependencyChangesInput.extend({ projectId: idSchema }) }, async ({ projectId, ...input }) => json(previewDependencyChanges(projectId, input, actor)));
  registerTool('apply_dependency_changes', { description: '原子提交已预览的依赖、估算、实体和布局。原样传入预览输入和 previewToken，另生成 batchId UUID；同一批次重试复用 batchId。回执 addedIds 将临时实体/关系 ID 映射为正式 ID。版本或跨日失效时重新预览；结果不确定先查询 get_dependency_change_receipt。', inputSchema: applyDependencyChangesInput.extend({ projectId: idSchema }) }, async ({ projectId, ...input }) => json(applyDependencyChanges(projectId, input, actor)));
  registerTool('get_dependency_change_receipt', { description: '查询本次依赖批次的提交回执', inputSchema: z.object({ projectId: idSchema, batchId: z.string().uuid() }) }, async ({ projectId, batchId }) => json(getDependencyChangeReceipt(projectId, batchId, actor)));
  registerTool('add_dependency', { description: '增加完成后开始的依赖，必须提供最新项目分析版本', inputSchema: dependencyInput.extend({ projectId: idSchema }) }, async ({ projectId, ...input }) => json(addDependency(projectId, input, actor)));
  registerTool('remove_dependency', { description: '移除依赖', inputSchema: pathVersion.extend({ id: idSchema }) }, async ({ id, ...input }) => json(removeDependency(id, input, actor)));
  registerTool('update_path_estimate', { description: '设置工作项工期、最早开始、人工预测日期', inputSchema: pathEstimateInput.extend({ id: idSchema }) }, async ({ id, ...input }) => json(updatePathEstimate(id, input, actor)));
  registerTool('preview_dependency_plan', { description: '按依赖预览需求及下游未开始工作的计划差异', inputSchema: dependencyPlanInput.extend({ id: idSchema }) }, async ({ id, ...input }) => json(previewDependencyPlan(id, input, actor)));
  registerTool('apply_dependency_plan', { description: '应用已核对的依赖排期预览', inputSchema: applyDependencyPlanInput.extend({ id: idSchema }) }, async ({ id, ...input }) => json(applyDependencyPlan(id, input, actor)));
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

  registerTool('list_requirements', { description: '按项目、状态及延期/高风险筛选需求；返回数组，每项包含 workItems。精确筛选和分页使用 query_requirements；完整进展历史使用 get_requirement 或 list_progress_updates。', inputSchema: requirementListInputSchema }, async (input) => {
    if (input.includeDeleted) assertProjectManager(actor, input.projectId); else assertProjectReadable(actor, input.projectId);
    return json(listRequirements(input));
  });
  registerTool('get_requirement', { description: '获取需求、自动指标、工作项和进展。排期不完整时 plannedProgress 为 null，不能计算领先/落后或将部分工作项的结束日作为需求截止日；实际进度仍有效。', inputSchema: projectListInputSchema.safeExtend({ id: idSchema }) }, async ({ id, includeDeleted }) => {
    const projectId = projectIdForRequirement(id);
    if (includeDeleted) assertProjectResourceManager(actor, projectId, '需求不存在'); else assertProjectResourceReadable(actor, projectId, '需求不存在');
    return json(getRequirement(id, includeDeleted));
  });
  for(const action of ['start','complete'] as const)registerTool(action.replace('-','_')+'_requirement',{description:'推进直接执行需求；不修改依赖或自动开始其他工作',inputSchema:directRequirementCommandSchema.extend({id:idSchema})},async({id,...input})=>json(executeDirectRequirement(id,action,input,actor)));
  registerTool('return_requirement',{description:'需求负责人或经理返工；有工作项时指定需要返工的工作项',inputSchema:directRequirementCommandSchema.extend({id:idSchema,workItemIds:z.array(idSchema).optional()})},async({id,...input})=>json(returnRequirement(id,input,actor)));
  registerTool('create_requirement', { description: '创建需求，标题必填，描述、负责人和计划可稍后补齐；指定 templateId 时套用模板', inputSchema: createRequirementInputSchema }, async (input) => {
    assertProjectManager(actor, input.projectId); return json(createRequirement(input, actor));
  });
  registerTool('update_requirement', { description: '修改非终态需求的标题、负责人和说明；状态通过开始、完成或返工操作更新', inputSchema: updateRequirementInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    if(isCoordinationEdit(input))assertCoordinationAccess('requirement',id,input,actor);else assertProjectResourceManager(actor, projectIdForRequirement(id), '需求不存在'); return json(updateRequirement(id, input, actor));
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
  registerTool('complete_requirement_as_planned', { description: '经理历史补录：未执行工作项按过去计划日期完成，全部有效工作完成后需求自动完成；保留已完成或取消记录', inputSchema: completeAsPlannedInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
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
    if(isCoordinationEdit(input))assertCoordinationAccess('work',id,input,actor);else assertWorkItemRequirementOwnerOrManager(actor, id); return json(updateWorkItem(id, input, actor));
  });
  registerTool('start_work_item', { description: '开始工作项并自动记录实际开始；依赖作为排期提示，无额外确认步骤', inputSchema: startWorkItemInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertWorkItemParticipantOrManager(actor, id); return json(startWorkItem(id, input, actor));
  });
  registerTool('complete_work_item', { description: '完成工作项；完成说明可选', inputSchema: optionalContentCommandSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertWorkItemParticipantOrManager(actor, id); return json(completeWorkItem(id, input, actor));
  });
  registerTool('cancel_work_item', { description: '取消工作项', inputSchema: reasonCommandSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertWorkItemRequirementOwnerOrManager(actor, id); return json(cancelWorkItem(id, input, actor));
  });
  registerTool('reopen_work_item', { description: '需求负责人或项目经理重开已完成或已取消工作项，并使已完成需求恢复执行', inputSchema: reopenWorkItemInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
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
    method: ['GET', 'POST', 'DELETE'], url: '/mcp',bodyLimit:10*1024*1024,
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
