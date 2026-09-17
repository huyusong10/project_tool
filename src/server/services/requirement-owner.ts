

import { fail } from '../errors';

import { nullableText, row } from './support';

export function requirementOwner(projectId: string, value: unknown, conflict = false) {
  const ownerId = nullableText(value);
  if (ownerId && !row(`SELECT p.id FROM people p JOIN project_people pp ON pp.person_id=p.id
    WHERE p.id=? AND pp.project_id=? AND pp.project_role IN ('member','manager')
      AND p.deleted_at IS NULL AND p.active=1`, ownerId, projectId)) {
    fail('需求负责人必须是当前项目中已启用的成员或项目经理', conflict ? 'DEPENDENCY_CONFLICT' : 'VALIDATION_ERROR', conflict ? 409 : 400);
  }
  return ownerId;
}
