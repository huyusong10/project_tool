import { randomUUID } from 'node:crypto';
import { getDatabaseContext } from '../database-context';
import type { Actor } from '../auth';
import { assertRequirementOwnerOrManager, requireAuthorizationActor } from '../authorization';
import { fail, notFound } from '../errors';
import { phaseDate } from '../../shared/feature-phases';
import { todayIso } from '../../shared/domain';
import { recordAudit } from './audit';
import { requireActiveProject } from './support';
import { getRequirement } from './requirements';

export function recordTestSubmission(input: { projectId: string; requirementId: string; expectedVersion: number; actualDate: string; content?: string }, actor: Actor) {
  return getDatabaseContext().sqlite.transaction(() => {
    assertRequirementOwnerOrManager(requireAuthorizationActor(actor), input.requirementId); requireActiveProject(input.projectId);
    const r = getRequirement(input.requirementId);
    if (r.projectId !== input.projectId) notFound('需求不存在');
    if (r.version !== input.expectedVersion) fail('需求已变化，请读取最新记录', 'STALE_WRITE', 409);
    if (r.status !== 'in_progress') fail('只有进行中的需求可以记录提测');
    const day = phaseDate.parse(input.actualDate), now = new Date().toISOString();
    if (day > todayIso() || r.actualStart && day < r.actualStart || r.stageResetAt && day < r.stageResetAt.slice(0, 10)) fail('提测日期不能晚于今天或早于本轮工作开始');
    const existing = getDatabaseContext().sqlite.prepare("SELECT id FROM milestones WHERE requirement_id=? AND milestone_kind='test_submitted' AND achieved_at IS NOT NULL AND cancelled=0 AND (? IS NULL OR achieved_recorded_at>?)").get(r.id, r.stageResetAt || null, r.stageResetAt || null);
    if (existing) fail('本轮已经记录提测，请刷新核对');
    getDatabaseContext().sqlite.prepare("INSERT INTO milestones(id,project_id,requirement_id,title,confirmation_mode,milestone_kind,achieved_at,achieved_recorded_at,achieved_by,created_at,updated_at) VALUES(?,?,?,'已提测','manual','test_submitted',?,?,?,?,?)").run(randomUUID(), r.projectId, r.id, day, now, actor.accountId, now, now);
    getDatabaseContext().sqlite.prepare('UPDATE requirements SET version=version+1,updated_at=? WHERE id=?').run(now, r.id);
    recordAudit(actor, 'test_submission', 'requirement', r.id, '实际提测日期：' + day + (input.content ? '；' + input.content : ''), r.projectId);
    return getRequirement(r.id);
  }).immediate();
}
