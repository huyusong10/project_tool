
import { reasonCommandSchema } from "../../shared/workflow-contracts";

import { assertProjectMember, assertProjectReadable, assertProjectResourceManager, assertProjectResourceReadable, canManageProject, canUpdateIssueProgress, projectIdForIssue, type AuthorizationActor } from "../authorization";

import { addIssueUpdate, correctIssue, createIssue, getIssue, listIssues, deferIssue, reopenIssue, resolveIssue, resumeIssue, updateIssue } from "../services/issues";

import { contentCommandSchema, createIssueInputSchema, idParamsSchema, idSchema, issueCorrectionInputSchema, issueListInputSchema, issueUpdateInputSchema, reopenIssueInputSchema, updateIssueInputSchema } from "../../shared/contracts";
import { json, type ToolRegistrar } from './registry';

export function registerIssuesTools(registerTool: ToolRegistrar, actor: AuthorizationActor) {
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

  registerTool('update_issue', { description: '项目经理维护问题资料，含已解决问题的负责人、解决日期；保留状态、进度和原历史', inputSchema: updateIssueInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
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

  registerTool('correct_issue', { description: '项目经理修正问题标题、影响、完成度或解决日期；保持状态并追加不可变纠错记录', inputSchema: issueCorrectionInputSchema.safeExtend({ id: idSchema }) }, async ({ id, ...input }) => {
    assertProjectResourceManager(actor, projectIdForIssue(id), '问题不存在'); return json(correctIssue(id, input, actor));
  });
}
