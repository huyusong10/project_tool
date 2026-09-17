
import { createWorkItemInputSchema, updateWorkItemInputSchema, startWorkItemInputSchema, reasonCommandSchema } from "../../shared/workflow-contracts";

import { isCoordinationEdit, assertCoordinationAccess } from "../services/blocker-coordination";

import { queryWorkItems, readWorkItem } from "../services/queries";

import { workItemQuerySchema } from "../../shared/query-contracts";

import { assertProjectResourceManager, assertRequirementOwnerOrManager, assertWorkItemParticipantOrManager, assertWorkItemRequirementOwnerOrManager, projectIdForWorkItem, type AuthorizationActor } from "../authorization";

import { cancelWorkItem, completeWorkItem, correctWorkItem, createWorkItem, deleteWorkItem, reorderWorkItems, reopenWorkItem, startWorkItem, updateWorkItem } from "../services/work-items";

import { completeWorkItemAsPlanned } from "../services/planned-completion";

import { optionalContentCommandSchema, completeAsPlannedInputSchema, expectedVersionInputSchema, idParamsSchema, idSchema, reopenWorkItemInputSchema, reorderWorkItemsInputSchema, workItemCorrectionSchema } from "../../shared/contracts";
import { json, type ToolRegistrar } from './registry';

export function registerWorkItemsTools(registerTool: ToolRegistrar, actor: AuthorizationActor) {
  registerTool('list_work_items', { description: '分页查询工作项及其特性、Phase、所属需求、版本和预测。支持 requirementId、featureId、phaseId（unassigned 表示未安排）、workStage（unclassified 表示未分类）、ownerId、participantId、q、日期、status 或 statuses、excludeStatuses。active 排除完成和取消，overdue 查询逾期，unassigned 查询未分派。sort=workflow 默认按需求编号及流程顺序，另可选 name/updated/planned_end；先筛选排序再分页。', inputSchema: workItemQuerySchema }, async input => json(queryWorkItems(input, actor)));

  registerTool('get_work_item', { description: '按工作项 ID 读取执行详情、负责人和协作者、计划与实际日期、进度及预测依据、未满足前置和版本。进展历史使用 list_progress_updates。', inputSchema: idParamsSchema }, async ({ id }) => json(readWorkItem(id, actor)));

  registerTool('complete_work_item_as_planned', { description: '经理历史补录：仅无执行记录且计划已结束的工作项可按计划日期完成', inputSchema: completeAsPlannedInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForWorkItem(id), '工作项不存在'); return json(completeWorkItemAsPlanned(id, input, actor));
  });

  registerTool('create_work_item', { description: '新增工作项', inputSchema: createWorkItemInputSchema.safeExtend({ requirementId: idSchema }) }, async ({ requirementId, ...input }) => {
    assertRequirementOwnerOrManager(actor, requirementId); return json(createWorkItem(requirementId, input, actor));
  });

  registerTool('update_work_item', { description: '修改工作项元数据、负责人、计划日期和 referenceLinks；管理员可更正终态资料，执行数据使用状态或更正命令', inputSchema: updateWorkItemInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
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

  registerTool('correct_work_item', { description: '项目经理修正工作项标题、完成度、实际日期或关联链接；保持状态并追加不可变纠错记录', inputSchema: workItemCorrectionSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForWorkItem(id), '工作项不存在'); return json(correctWorkItem(id, input, actor));
  });

  registerTool('delete_work_item', { description: '删除未开始且无历史的工作项，并自动清理其所有前后依赖', inputSchema: expectedVersionInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertWorkItemRequirementOwnerOrManager(actor, id); return json(deleteWorkItem(id, input, actor));
  });

  registerTool('reorder_work_items', { description: '调整工作项顺序', inputSchema: reorderWorkItemsInputSchema.safeExtend({ requirementId: idSchema }) }, async ({ requirementId, ids, ...input }) => {
    assertRequirementOwnerOrManager(actor, requirementId); return json(reorderWorkItems(requirementId, ids, actor, input));
  });
}
