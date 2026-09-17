

import { getDatabaseContext } from '../database-context';

import { fail, notFound } from '../errors';

import { chunkValues, row, type JsonObject } from './support';

export function collaboratorIdsFromInput(input: JsonObject, ownerId: string | null, validateActive = true) {
  if (Object.prototype.hasOwnProperty.call(input, 'collaboratorIds') && Object.prototype.hasOwnProperty.call(input, 'assigneeIds')) {
    fail('协作人员与参与人员字段不能同时提交');
  }
  const value = input.collaboratorIds === undefined ? input.assigneeIds : input.collaboratorIds;
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail('协作人员格式不合法');
  const ids = [...new Set(value.map((id) => String(id).trim()).filter((id) => id && id !== ownerId))];
  if (!validateActive) return ids;
  let activeCount = 0;
  for (const batch of chunkValues(ids)) {
    const placeholders = batch.map(() => '?').join(',');
    activeCount += row<{ count: number }>(`SELECT COUNT(*) AS count FROM people WHERE id IN (${placeholders}) AND deleted_at IS NULL AND active=1`, ...batch)?.count || 0;
  }
  if (activeCount !== ids.length) fail('协作人员不存在或已停用');
  return ids;
}

export function assertProjectAssignees(requirementId: string, ids: Array<string | null>, conflict = false) {
  const assigneeIds = [...new Set(ids.filter(Boolean) as string[])];
  if (!assigneeIds.length) return;
  const requirement = row<{ projectId: string }>('SELECT project_id AS projectId FROM requirements WHERE id=?', requirementId);
  if (!requirement) notFound('需求不存在');
  let count = 0;
  for (const batch of chunkValues(assigneeIds, 899)) {
    const placeholders = batch.map(() => '?').join(',');
    count += row<{ count: number }>(`SELECT COUNT(*) AS count FROM project_people pp
      JOIN people p ON p.id=pp.person_id
      WHERE pp.project_id=? AND pp.person_id IN (${placeholders}) AND pp.project_role IN ('member','manager')
        AND p.deleted_at IS NULL AND p.active=1
        AND EXISTS (SELECT 1 FROM accounts a WHERE a.person_id=p.id AND a.status='active' AND a.deleted_at IS NULL)`, requirement.projectId, ...batch)?.count || 0;
  }
  if (count !== assigneeIds.length) fail('负责人必须是当前项目中账号有效的成员或项目经理', conflict ? 'DEPENDENCY_CONFLICT' : 'VALIDATION_ERROR', conflict ? 409 : 400);
}

export function syncWorkItemCollaborators(workItemId: string, collaboratorIds: string[]) {
  getDatabaseContext().sqlite.prepare('DELETE FROM work_item_collaborators WHERE work_item_id=?').run(workItemId);
  const insert = getDatabaseContext().sqlite.prepare('INSERT INTO work_item_collaborators (work_item_id, person_id) VALUES (?, ?)');
  collaboratorIds.forEach((personId) => insert.run(workItemId, personId));
}
