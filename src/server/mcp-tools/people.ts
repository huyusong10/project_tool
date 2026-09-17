

import { assertAdmin, assertProjectManager, assertProjectReadable, type AuthorizationActor } from "../authorization";

import { addProjectPerson, archivePerson, createPerson, listPeople, listPeopleCandidates, removeProjectPerson, restorePerson, updatePerson } from "../services/people";

import { archiveRestoreInputSchema, createPersonInputSchema, idSchema, peopleListInputSchema, personCandidatesInputSchema, personCommandSchema, updatePersonInputSchema, projectMemberMutationCommandSchema, projectMemberMutationInputSchema, projectParamsSchema } from "../../shared/contracts";
import { json, type ToolRegistrar } from './registry';

export function registerPeopleTools(registerTool: ToolRegistrar, actor: AuthorizationActor) {
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
}
