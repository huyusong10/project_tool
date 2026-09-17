import { dependencyChangesInput, applyDependencyChangesInput, pathEstimateInput } from "../../shared/workflow-contracts";

import { readPathGraph } from "../services/path-graph";

import { pathGraphQuerySchema } from "../../shared/query-contracts";

import { z } from 'zod';

import { pathQuery, dependencyInput, pathVersion, dependencyPlanInput, applyDependencyPlanInput } from "../../shared/path-contracts";
import { applyDependencyChanges, getDependencyChangeReceipt, previewDependencyChanges } from "../services/path-changes";
import { milestoneCommand, readDiagramLayouts } from "../services/milestones";
import { readPathAnalysis, addDependency, removeDependency, updatePathEstimate, previewDependencyPlan, applyDependencyPlan } from "../services/paths";
import { type AuthorizationActor } from "../authorization";

import { idSchema } from "../../shared/contracts";
import { json, type ToolRegistrar } from './registry';

export function registerPathsTools(registerTool: ToolRegistrar, actor: AuthorizationActor) {
  registerTool('get_path_graph', { description: '读取正式关系图 cards/links；view=features 是项目特性，view=feature 加 featureId 是特性内需求，view=requirement 加 requirementId 是工作分解。默认 project 保留旧需求汇总语义。特性节点含 phases；特性内返回 phaseRegions，phaseId 筛选保留直接跨范围依赖，analysis 保持完整。planning/actual 区分人工规划与执行依赖；rootNodeId/traversal/depth 查询上下游。layout=auto 或 format=svg 自动布局，Phase 外框按内部拓扑撑开，返回 layout.regions/nodeSizes；direction 控制内部拓扑方向。最多 200 节点/1000 关系，不保存坐标。修改前用 get_diagram_layouts 读取完整布局，使用批次 changes.layouts 保存并保留隐藏位置。', inputSchema: pathGraphQuerySchema }, async input => json(await readPathGraph(input, actor)));

  registerTool('get_diagram_layouts',{description:'读取全部已保存的团队位置与版本。scope 支持 features、feature:ID、feature-phase:<featureId>:<phaseId|unassigned>、global、requirement:ID；Phase 坐标相对区域原点。通过 preview_dependency_changes/apply_dependency_changes 的 changes.layouts 保存完整位置集合，expectedVersion 使用此处 version，不存在时为 0；不要用筛选后的位置覆盖完整布局。',inputSchema:z.object({projectId:idSchema})},async({projectId})=>json(readDiagramLayouts(projectId,actor)));

  registerTool('milestone_command',{description:'人工确认或重新打开独立里程碑，记录操作者和时间',inputSchema:z.object({id:idSchema,action:z.enum(['achieve','reopen']),expectedVersion:z.number().int().positive()})},async({id,action,...input})=>json(milestoneCommand(id,action,input,actor)));

  registerTool('get_path_analysis', { description: '查询完整项目执行网络 nodes/edges、依赖、关键性、余量、交付预测、日期偏差和影响来源；target 可为 project、acceptance:需求ID、工作项ID或里程碑ID。始终返回全图，局部或需求汇总图使用 get_path_graph；revision 用于批次 expectedRevision。', inputSchema: pathQuery.extend({ projectId: idSchema }) }, async ({ projectId, target }) => json(readPathAnalysis(projectId, target, actor)));

  registerTool('preview_dependency_changes', { description: '预览原子批次，不保存：changes.add/remove 为依赖，estimates 为工作项估算，entities 支持需求/工作项/里程碑的 create/update/delete，layouts 为共享坐标；featureRelations 为独立规划关系变更，op=create 使用临时 id、sourceFeatureId、targetFeatureId、note，op=update 使用 id、expectedVersion、note，op=delete 使用 id、expectedVersion。规划关系不参与执行分析。实体创建 id 和连线 clientId 使用客户端临时唯一 ID，可在同批次互相引用；修改实体需 expectedVersion。布局 scope=features、feature:特性ID、feature-phase:<featureId>:<phaseId|unassigned>、global 或 requirement:需求ID；Phase 使用区域内相对坐标，expectedVersion 为已存布局版本或 0。返回 analysis、differences、previewToken；确认后原样提交本输入和凭据。', inputSchema: dependencyChangesInput.extend({ projectId: idSchema }) }, async ({ projectId, ...input }) => json(previewDependencyChanges(projectId, input, actor)));

  registerTool('apply_dependency_changes', { description: '原子提交已预览的规划关系、执行依赖、估算、实体和各层布局。原样传入预览输入和 previewToken，另生成 batchId UUID；同一批次重试复用 batchId。回执 addedIds 将临时实体/关系 ID 映射为正式 ID。版本或跨日失效时重新预览；结果不确定先查询 get_dependency_change_receipt。', inputSchema: applyDependencyChangesInput.extend({ projectId: idSchema }) }, async ({ projectId, ...input }) => json(applyDependencyChanges(projectId, input, actor)));

  registerTool('get_dependency_change_receipt', { description: '查询本次依赖批次的提交回执', inputSchema: z.object({ projectId: idSchema, batchId: z.string().uuid() }) }, async ({ projectId, batchId }) => json(getDependencyChangeReceipt(projectId, batchId, actor)));

  registerTool('add_dependency', { description: '增加完成后开始的依赖，必须提供最新项目分析版本', inputSchema: dependencyInput.extend({ projectId: idSchema }) }, async ({ projectId, ...input }) => json(addDependency(projectId, input, actor)));

  registerTool('remove_dependency', { description: '移除依赖', inputSchema: pathVersion.extend({ id: idSchema }) }, async ({ id, ...input }) => json(removeDependency(id, input, actor)));

  registerTool('update_path_estimate', { description: '设置工作项工期、最早开始、人工预测日期', inputSchema: pathEstimateInput.extend({ id: idSchema }) }, async ({ id, ...input }) => json(updatePathEstimate(id, input, actor)));

  registerTool('preview_dependency_plan', { description: '按依赖预览需求及下游未开始工作的计划差异', inputSchema: dependencyPlanInput.extend({ id: idSchema }) }, async ({ id, ...input }) => json(previewDependencyPlan(id, input, actor)));

  registerTool('apply_dependency_plan', { description: '应用已核对的依赖排期预览', inputSchema: applyDependencyPlanInput.extend({ id: idSchema }) }, async ({ id, ...input }) => json(applyDependencyPlan(id, input, actor)));
}
