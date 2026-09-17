

import { projectChangeVersion } from "../services/project-change-version";

import { assertAdmin, assertProjectManager, type AuthorizationActor } from "../authorization";

import { archiveProject, createProject, listProjects, restoreProject, updateProject } from "../services/projects";

import { archiveRestoreInputSchema, createProjectInputSchema, idSchema, projectArchiveInputSchema, projectInputSchema, projectListInputSchema, projectScopeInputSchema } from "../../shared/contracts";
import { json, type ToolRegistrar } from './registry';

export function registerProjectsTools(registerTool: ToolRegistrar, actor: AuthorizationActor) {
  registerTool('get_project_change_version', { description: '轻量读取项目变更版本，用于比较是否需要刷新；包括业务日期、分析版本及共享布局等，不执行路径分析。返回 version。', inputSchema: projectScopeInputSchema }, async ({ projectId }) => json(projectChangeVersion(projectId, actor)));

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
}
