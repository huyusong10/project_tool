

import { z } from 'zod';

import { assertAdmin, assertProjectManager, type AuthorizationActor } from "../authorization";

import { listArchives, permanentlyDeleteArchive } from "../services/archives";

import { archiveDeleteInputSchema, archiveListInputSchema, idSchema } from "../../shared/contracts";
import { json, type ToolRegistrar } from './registry';

export function registerArchivesTools(registerTool: ToolRegistrar, actor: AuthorizationActor) {
  registerTool('list_archives', { description: '查询有权限的归档；项目经理需指定项目', inputSchema: archiveListInputSchema }, async ({ projectId }) => {
    if (!projectId) { assertAdmin(actor); return json(listArchives()); }
    assertProjectManager(actor, projectId); return json(listArchives(projectId));
  });

  registerTool('permanently_delete_archive', {
    description: '永久删除已归档的项目、需求、人员或模板；必须传入list_archives返回的deletedAt作为expectedDeletedAt，该操作不可恢复',
    inputSchema: archiveDeleteInputSchema.safeExtend({ entity: z.enum(['projects', 'requirements', 'people', 'templates']), id: idSchema }),
  }, async ({ entity, id, ...input }) => { assertAdmin(actor); return json(permanentlyDeleteArchive(entity, id, actor, input)); });
}
