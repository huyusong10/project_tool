

import { getDatabaseContext } from '../database-context';

import type { Actor } from '../auth';

import { deleteOrReleaseSamplePeople, isSampleProjectId } from '../sample-project';

import { canonicalizeLabel } from '../../shared/search';

import { fail, notFound } from '../errors';

import { recordAudit as audit } from './audit';

import { nowIso, requireLabel, row, rows, type JsonObject } from './support';

import { assertCurrentAdmin } from './admin-guard';

import { assertArchiveGeneration, lockArchiveGeneration } from './archive-guards';

export function listArchives(projectId?: string) {
  return {
    projects: projectId ? [] : rows(`SELECT p.id, p.name AS title, p.deleted_at AS deletedAt,
      (SELECT COUNT(*) FROM requirements r WHERE r.project_id=p.id) AS requirementCount,
      (SELECT COUNT(*) FROM work_items w JOIN requirements r ON r.id=w.requirement_id WHERE r.project_id=p.id) AS workItemCount,
      (SELECT COUNT(*) FROM issues i WHERE i.project_id=p.id) AS issueCount,
      (SELECT COUNT(*) FROM work_item_templates t WHERE t.project_id=p.id) AS templateCount
      FROM projects p WHERE p.deleted_at IS NOT NULL ORDER BY p.deleted_at DESC`),
    requirements: rows(`SELECT r.id, r.title, p.name AS projectName, r.deleted_at AS deletedAt,
      (SELECT COUNT(*) FROM work_items w WHERE w.requirement_id=r.id) AS workItemCount,
      (SELECT COUNT(*) FROM progress_updates u WHERE u.requirement_id=r.id) AS progressCount,
      (SELECT COUNT(*) FROM issues i WHERE i.requirement_id=r.id) AS linkedIssueCount
      FROM requirements r LEFT JOIN projects p ON p.id=r.project_id WHERE r.deleted_at IS NOT NULL ${projectId ? 'AND r.project_id=?' : ''} ORDER BY r.deleted_at DESC`, ...(projectId ? [projectId] : [])),
    people: projectId ? [] : rows(`SELECT id, name AS title, job_title AS jobTitle, deleted_at AS deletedAt FROM people WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`),
    templates: rows(`SELECT t.id, t.name AS title, p.name AS projectName, t.deleted_at AS deletedAt FROM work_item_templates t LEFT JOIN projects p ON p.id=t.project_id WHERE t.deleted_at IS NOT NULL ${projectId ? 'AND t.project_id=?' : ''} ORDER BY t.deleted_at DESC`, ...(projectId ? [projectId] : [])),
  };
}

export type ArchiveEntity = 'projects' | 'requirements' | 'people' | 'templates';

export function permanentlyDeleteArchive(entity: ArchiveEntity, id: string, actor: Actor, input: JsonObject = {}) {
  if (Object.keys(input).some((key) => key !== 'confirmName' && key !== 'expectedDeletedAt')) {
    fail('永久删除不能提交未声明字段');
  }
  const tx = getDatabaseContext().sqlite.transaction(() => {
    if (entity === 'projects') {
      const project = row<{ name: string; deletedAt: string }>('SELECT name, deleted_at AS deletedAt FROM projects WHERE id=? AND deleted_at IS NOT NULL', id);
      if (!project) {
        if (row('SELECT id FROM projects WHERE id=?', id)) fail('只能永久删除已归档项目');
        notFound('归档项目不存在');
      }
      assertArchiveGeneration(input, project.deletedAt);
      if (requireLabel(input.confirmName, '确认名称') !== canonicalizeLabel(project.name)) fail('确认名称与项目名称不一致');
      lockArchiveGeneration('projects', id, project.deletedAt);
      const requirementCount = row<{ count: number }>('SELECT COUNT(*) AS count FROM requirements WHERE project_id=?', id)?.count || 0;
      getDatabaseContext().sqlite.prepare('DELETE FROM requirements WHERE project_id=?').run(id);
      const deleted = getDatabaseContext().sqlite.prepare('DELETE FROM projects WHERE id=? AND deleted_at=?').run(id, project.deletedAt);
      if (!deleted.changes) fail('归档项目已变化，请刷新后重试', 'STALE_WRITE', 409);
      if (isSampleProjectId(id)) deleteOrReleaseSamplePeople(getDatabaseContext().sqlite, nowIso());
      assertCurrentAdmin(actor);
      audit(actor, 'permanent_delete', 'project', id, `永久删除归档项目：${project.name}（含${requirementCount}条需求）`, null);
      return { ok: true };
    }
    if (entity === 'requirements') {
      const requirement = row<{ title: string; projectId: string; deletedAt: string }>('SELECT title, project_id AS projectId, deleted_at AS deletedAt FROM requirements WHERE id=? AND deleted_at IS NOT NULL', id);
      if (!requirement) {
        if (row('SELECT id FROM requirements WHERE id=?', id)) fail('只能永久删除已归档需求');
        notFound('归档需求不存在');
      }
      assertArchiveGeneration(input, requirement.deletedAt);
      if (requireLabel(input.confirmName, '确认名称') !== canonicalizeLabel(requirement.title)) fail('确认名称与需求名称不一致');
      lockArchiveGeneration('requirements', id, requirement.deletedAt);
      const deleted = getDatabaseContext().sqlite.prepare('DELETE FROM requirements WHERE id=? AND deleted_at=?').run(id, requirement.deletedAt);
      if (!deleted.changes) fail('归档需求已变化，请刷新后重试', 'STALE_WRITE', 409);
      assertCurrentAdmin(actor);
      audit(actor, 'permanent_delete', 'requirement', id, `永久删除归档需求：${requirement.title}`, requirement.projectId);
      return { ok: true };
    }
    if (entity === 'people') {
      const person = row<{ name: string; deletedAt: string }>('SELECT name, deleted_at AS deletedAt FROM people WHERE id=? AND deleted_at IS NOT NULL', id);
      if (!person) {
        if (row('SELECT id FROM people WHERE id=?', id)) fail('只能永久删除已归档人员');
        notFound('归档人员不存在');
      }
      assertArchiveGeneration(input, person.deletedAt);
      lockArchiveGeneration('people', id, person.deletedAt);
      const references = row<{ count: number }>(`SELECT
        (SELECT COUNT(*) FROM requirements WHERE owner_id=?) +
        (SELECT COUNT(*) FROM work_items WHERE owner_id=?) +
        (SELECT COUNT(*) FROM work_item_collaborators WHERE person_id=?) +
        (SELECT COUNT(*) FROM issues WHERE owner_id=?) AS count`, id, id, id, id)?.count || 0;
      if (references) fail(`该人员仍被${references}条历史业务记录引用，只能保留归档`, 'DEPENDENCY_CONFLICT', 409, { references });
      getDatabaseContext().sqlite.prepare('DELETE FROM accounts WHERE person_id=? AND is_builtin=0').run(id);
      const deleted = getDatabaseContext().sqlite.prepare('DELETE FROM people WHERE id=? AND deleted_at=?').run(id, person.deletedAt);
      if (!deleted.changes) fail('归档人员已变化，请刷新后重试', 'STALE_WRITE', 409);
      assertCurrentAdmin(actor);
      audit(actor, 'permanent_delete', 'person', id, `永久删除归档人员：${person.name}`);
      return { ok: true };
    }
    if (entity === 'templates') {
      const template = row<{ name: string; projectId: string; deletedAt: string }>('SELECT name, project_id AS projectId, deleted_at AS deletedAt FROM work_item_templates WHERE id=? AND deleted_at IS NOT NULL', id);
      if (!template) {
        if (row('SELECT id FROM work_item_templates WHERE id=?', id)) fail('只能永久删除已归档流程');
        notFound('归档模板不存在');
      }
      assertArchiveGeneration(input, template.deletedAt);
      lockArchiveGeneration('work_item_templates', id, template.deletedAt);
      const references = row<{ count: number }>(`SELECT
        (SELECT COUNT(*) FROM requirements WHERE template_id=?) +
        (SELECT COUNT(*) FROM work_items WHERE template_item_id IN (SELECT id FROM template_items WHERE template_id=?)) AS count`, id, id)?.count || 0;
      if (references) fail(`该流程仍被${references}条历史业务记录引用，只能保留归档快照`, 'DEPENDENCY_CONFLICT', 409, { references });
      const deleted = getDatabaseContext().sqlite.prepare('DELETE FROM work_item_templates WHERE id=? AND deleted_at=?').run(id, template.deletedAt);
      if (!deleted.changes) fail('归档流程已变化，请刷新后重试', 'STALE_WRITE', 409);
      assertCurrentAdmin(actor);
      audit(actor, 'permanent_delete', 'template', id, `永久删除归档模板：${template.name}`, template.projectId);
      return { ok: true };
    }
    fail('归档类型不合法');
  });
  return tx();
}
