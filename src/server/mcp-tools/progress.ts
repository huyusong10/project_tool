

import { queryProgressUpdates } from "../services/queries";

import { progressQuerySchema } from "../../shared/query-contracts";

import { assertCanAddProgress, type AuthorizationActor } from "../authorization";
import { addProgress } from "../services/progress";

import { idSchema, progressInputSchema } from "../../shared/contracts";
import { json, type ToolRegistrar } from './registry';

export function registerProgressTools(registerTool: ToolRegistrar, actor: AuthorizationActor) {
  registerTool('list_progress_updates', { description: '分页读取项目进展历史，可按需求、工作项、发布账号、事件类型和正文关键词筛选。from/to 为北京时间自然日，含首尾日；按发布时间及写入顺序倒序。翻页原样传入首次返回的 snapshot，避免新记录挤动分页。', inputSchema: progressQuerySchema }, async input => json(queryProgressUpdates(input, actor)));

  registerTool('add_progress', { description: '追加工作项进展；完成度不能达到100%', inputSchema: progressInputSchema.safeExtend({ requirementId: idSchema }) }, async ({ requirementId, ...input }) => {
    assertCanAddProgress(actor, requirementId, input.workItemId || null); return json(addProgress(requirementId, input, actor));
  });
}
