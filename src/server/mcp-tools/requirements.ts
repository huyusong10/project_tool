
import { createRequirementInputSchema, updateRequirementInputSchema, requirementCorrectionInputSchema, reasonCommandSchema, rescheduleRequirementInputSchema } from "../../shared/workflow-contracts";

import { isCoordinationEdit, assertCoordinationAccess } from "../services/blocker-coordination";
import { executeDirectRequirement, returnRequirement } from "../services/delivery-execution";
import { queryRequirements } from "../services/queries";

import { requirementQuerySchema } from "../../shared/query-contracts";
import { directRequirementCommandSchema } from "../../shared/contracts";

import { z } from 'zod';

import { assertProjectManager, assertProjectReadable, assertProjectResourceManager, assertProjectResourceReadable, projectIdForRequirement, type AuthorizationActor } from "../authorization";

import { applyRequirementPlan, archiveRequirement, cancelRequirement, correctRequirement, createRequirement, previewRequirementPlan, reselectRequirementTemplate, rescheduleRequirement, restoreRequirement, updateRequirement } from "../services/requirement-commands";

import { getRequirement, listRequirements } from "../services/requirements";

import { completeRequirementAsPlanned } from "../services/planned-completion";

import { archiveRestoreInputSchema, applyRequirementPlanInputSchema, completeAsPlannedInputSchema, expectedVersionInputSchema, idSchema, previewRequirementPlanInputSchema, projectListInputSchema, reselectRequirementTemplateInputSchema, requirementListInputSchema } from "../../shared/contracts";
import { json, type ToolRegistrar } from './registry';

export function registerRequirementsTools(registerTool: ToolRegistrar, actor: AuthorizationActor) {
  registerTool('query_requirements', { description: '分页查询需求，返回 executionStage；阶段百分比只表示该阶段。支持 featureId/phaseId、人员、日期、stage、status 或 statuses、excludeStatuses。多状态传数组或逗号分隔字符串；statuses=[] 返回空集，排除条件与其他条件取交集。sort=name 默认按名称编号自然排序，updated 按最近修改，manual 按人工顺序；includeWorkItems=true 附带工作项。', inputSchema: requirementQuerySchema }, async input => json(queryRequirements(input, actor)));

  registerTool('list_requirements', { description: '按项目、状态及延期/高风险筛选需求；返回数组，每项包含 workItems。精确筛选和分页使用 query_requirements；完整进展历史使用 get_requirement 或 list_progress_updates。', inputSchema: requirementListInputSchema }, async (input) => {
    if (input.includeDeleted) assertProjectManager(actor, input.projectId); else assertProjectReadable(actor, input.projectId);
    return json(listRequirements(input));
  });

  registerTool('get_requirement', { description: '获取需求资料、特性与 Phase、executionStage、工作项、里程碑及进展历史。阶段内百分比不能当作需求总百分比；测试就绪不等于已提测。排期不完整时 plannedProgress 为 null，不能把部分工作项的结束日作为需求截止日。', inputSchema: projectListInputSchema.safeExtend({ id: idSchema }) }, async ({ id, includeDeleted }) => {
    const projectId = projectIdForRequirement(id);
    if (includeDeleted) assertProjectResourceManager(actor, projectId, '需求不存在'); else assertProjectResourceReadable(actor, projectId, '需求不存在');
    return json(getRequirement(id, includeDeleted));
  });

  for(const action of ['start','complete'] as const)registerTool(action.replace('-','_')+'_requirement',{description:'推进直接执行需求；不修改依赖或自动开始其他工作',inputSchema:directRequirementCommandSchema.extend({id:idSchema})},async({id,...input})=>json(executeDirectRequirement(id,action,input,actor)));

  registerTool('return_requirement',{description:'需求负责人或经理返工；有工作项时指定需要返工的工作项',inputSchema:directRequirementCommandSchema.extend({id:idSchema,workItemIds:z.array(idSchema).optional()})},async({id,...input})=>json(returnRequirement(id,input,actor)));

  registerTool('create_requirement', { description: '创建需求，标题必填，描述、负责人和计划可稍后补齐；指定 templateId 时套用模板', inputSchema: createRequirementInputSchema }, async (input) => {
    assertProjectManager(actor, input.projectId); return json(createRequirement(input, actor));
  });

  registerTool('update_requirement', { description: '修改需求标题、负责人和说明，支持 referenceLinks；管理员可更正终态资料，状态通过执行或返工操作更新', inputSchema: updateRequirementInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
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
}
