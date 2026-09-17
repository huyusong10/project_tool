

import { todayIso } from "../../shared/domain";

import { assertProjectReadable, canManageProject, type AuthorizationActor } from "../authorization";

import { getDashboard, getPeopleConcurrency } from "../services/reporting";

import { listActionItems } from "../services/actions";

import { getMyWork } from "../accounts";

import { getAnalyticsCatalog, queryAnalytics } from "../analytics";

import { actionItemsInputSchema, analyticsQueryInputSchema, emptyCommandInputSchema, projectPeopleConcurrencyInputSchema, projectScopeInputSchema } from "../../shared/contracts";
import { json, type ToolRegistrar } from './registry';

export function registerReportingTools(registerTool: ToolRegistrar, actor: AuthorizationActor) {
  registerTool('dashboard_summary', { description: '查询全项目进展数据，featureOverview 包含特性与 Phase 状态、交付日期及历史；与 requirements 使用同一 asOfDate。需求读取 executionStage，工作项读取自身进度，特性与 Phase 的 completion 按当前明确范围的工作量加权，空 Phase 不计入，尚未排期的需求参与计算。浏览器未保存草稿不进入结果。', inputSchema: projectScopeInputSchema }, async ({ projectId }) => {
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
}
