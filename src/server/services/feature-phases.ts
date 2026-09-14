import { randomUUID } from 'node:crypto';
import { sqlite } from '../database';
import type { Actor } from '../auth';
import { assertProjectManager, assertProjectReadable, requireAuthorizationActor } from '../authorization';
import { fail, notFound } from '../errors';
import { requireActiveProject } from './support';
import { recordAudit } from './audit';
import { deriveRequirementMetrics, todayIso } from '../../shared/domain';
import { deriveExecutionStage, type StageWork, type StageMilestone } from '../../shared/execution-stage';
import { phaseInput, phaseCommand, phaseStatus, phaseDistribution, type FeaturePhase, type PhaseDelivery, type PhaseRequirement } from '../../shared/feature-phases';

export function phaseRequirementFacts(projectId: string): PhaseRequirement[] {
  const requirements = sqlite.prepare(`SELECT id,title,status,version,feature_id AS featureId,phase_id AS phaseId,stage_reset_at AS stageResetAt,actual_end AS actualEnd,deleted_at AS deletedAt,acceptance_criteria AS acceptanceCriteria,execution_mode AS executionMode,progress,split_base_progress AS splitBaseProgress FROM requirements WHERE project_id=?`).all(projectId) as Array<PhaseRequirement & { stageResetAt: string | null; executionMode: 'direct' | 'work_items'; progress: number }>;
  const work = sqlite.prepare(`SELECT w.requirement_id AS requirementId,w.title,w.status,w.progress,w.progress_weight AS progressWeight,w.duration_days AS durationDays,w.work_stage AS workStage,w.actual_end AS actualEnd FROM work_items w JOIN requirements r ON r.id=w.requirement_id WHERE r.project_id=?`).all(projectId) as Array<StageWork & { requirementId: string }>;
  const milestones = sqlite.prepare('SELECT requirement_id AS requirementId,title,milestone_kind AS milestoneKind,achieved_at AS achievedAt,achieved_recorded_at AS achievedRecordedAt,cancelled FROM milestones WHERE project_id=?').all(projectId) as Array<StageMilestone & { requirementId: string }>;
  const byWork = new Map<string, StageWork[]>(), byMilestone = new Map<string, StageMilestone[]>();
  for (const w of work) { const items = byWork.get(w.requirementId) || []; items.push(w); byWork.set(w.requirementId, items); }
  for (const m of milestones) { const items = byMilestone.get(m.requirementId) || []; items.push(m); byMilestone.set(m.requirementId, items); }
  return requirements.map(r => {
    const items = byWork.get(r.id) || [], status = deriveRequirementMetrics(r, items).status;
    const ends = items.filter(w => w.status === 'completed').flatMap(w => w.actualEnd ? [w.actualEnd] : []);
    return { ...r, status, actualEnd: r.executionMode === 'direct' ? r.actualEnd : ends.sort().at(-1) || null, executionStage: deriveExecutionStage({ ...r, status }, items, byMilestone.get(r.id)) };
  });
}
export function readFeaturePhases(projectId: string, asOfDate = todayIso()): FeaturePhase[] {
  const phases = sqlite.prepare('SELECT id,project_id AS projectId,feature_id AS featureId,name,scope,started_at AS startedAt,target_date AS targetDate,note,sort_order AS sortOrder,version,delivered_at AS deliveredAt FROM feature_phases WHERE project_id=? ORDER BY sort_order,created_at,id').all(projectId) as FeaturePhase[];
  const facts = phaseRequirementFacts(projectId);
  const deliveries = sqlite.prepare(`SELECT d.id,d.phase_id AS phaseId,d.delivered_at AS deliveredAt,a.username AS deliveredByName,d.created_at AS createdAt,d.reopened_at AS reopenedAt,d.reopen_reason AS reopenReason,d.snapshot FROM phase_deliveries d JOIN feature_phases p ON p.id=d.phase_id LEFT JOIN accounts a ON a.id=d.delivered_by WHERE p.project_id=? ORDER BY d.created_at DESC,d.rowid DESC`).all(projectId) as Array<Omit<PhaseDelivery, 'snapshot'> & { phaseId: string; snapshot: string }>;
  return phases.map(p => {
    const requirements = facts.filter(r => r.phaseId === p.id), status = phaseStatus(requirements, p.deliveredAt);
    return { ...p, status, requirements, overdue: status !== 'delivered' && !!p.targetDate && p.targetDate < asOfDate, distribution: phaseDistribution(requirements), deliveries: deliveries.filter(d => d.phaseId === p.id).map(d => ({ ...d, snapshot: JSON.parse(d.snapshot) })) };
  });
}
export function listFeaturePhases(projectId: string, featureId: string | undefined, actor: Actor) {
  assertProjectReadable(requireAuthorizationActor(actor), projectId);
  return sqlite.transaction(() => readFeaturePhases(projectId).filter(p => !featureId || p.featureId === featureId))();
}
function manager(projectId: string, actor: Actor) { assertProjectManager(requireAuthorizationActor(actor), projectId); requireActiveProject(projectId); }
function feature(projectId: string, featureId: string) {
  const value = sqlite.prepare('SELECT archived_at AS archivedAt FROM features WHERE id=? AND project_id=?').get(featureId, projectId) as { archivedAt: string | null } | undefined;
  if (!value) notFound('特性不存在');
  if (value.archivedAt) fail('请先恢复归档特性');
}
function current(projectId: string, id: string, expectedVersion: number) {
  const value = readFeaturePhases(projectId).find(p => p.id === id);
  if (!value) notFound('Phase 不存在');
  if (value.version !== expectedVersion) fail('Phase 已变化，请读取最新资料并核对', 'STALE_WRITE', 409);
  feature(projectId, value.featureId); return value;
}
export function saveFeaturePhase(projectId: string, featureId: string, raw: unknown, actor: Actor) {
  const input = phaseInput.parse(raw);
  return sqlite.transaction(() => {
    manager(projectId, actor); feature(projectId, featureId);
    const before = input.id ? current(projectId, input.id, input.expectedVersion || 0) : null;
    if (before && before.featureId !== featureId) fail('Phase 不属于该特性');
    if (before?.deliveredAt) fail('请先重新打开已交付 Phase');
    if (before && (before.startedAt || before.status !== 'planning') && (before.scope !== input.scope || before.targetDate !== input.targetDate) && !input.reason) fail('推进后的范围或目标日期调整需要填写原因');
    const duplicate = sqlite.prepare('SELECT id FROM feature_phases WHERE feature_id=? AND name=? AND id<>?').get(featureId, input.name, input.id || '');
    if (duplicate) fail('该特性内已存在同名 Phase');
    const id = input.id || randomUUID(), now = new Date().toISOString();
    if (before) sqlite.prepare('UPDATE feature_phases SET name=?,scope=?,target_date=?,note=?,sort_order=?,version=version+1,updated_at=? WHERE id=?').run(input.name, input.scope, input.targetDate, input.note, input.sortOrder ?? before.sortOrder, now, id);
    else sqlite.prepare('INSERT INTO feature_phases(id,project_id,feature_id,name,scope,target_date,note,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, projectId, featureId, input.name, input.scope, input.targetDate, input.note, input.sortOrder ?? readFeaturePhases(projectId).filter(p => p.featureId === featureId).length, now, now);
    const after = readFeaturePhases(projectId).find(p => p.id === id)!;
    recordAudit(actor, before ? 'update' : 'create', 'feature_phase', id, JSON.stringify({ before, after, reason: input.reason }), projectId); return after;
  }).immediate();
}
export function commandFeaturePhase(projectId: string, id: string, action: 'deliver' | 'reopen' | 'delete', raw: unknown, actor: Actor) {
  const input = phaseCommand.parse(raw);
  return sqlite.transaction(() => {
    manager(projectId, actor); const phase = current(projectId, id, input.expectedVersion), now = new Date().toISOString();
    if (action === 'delete') {
      if (phase.requirements.length || phase.deliveries.length) fail('仅能删除没有需求及交付历史的空 Phase');
      sqlite.prepare('DELETE FROM feature_phases WHERE id=?').run(id);
    } else if (action === 'deliver') {
      if (phase.status !== 'ready') fail('至少一个有效需求且全部完成后才能确认交付');
      const deliveredAt = input.deliveredAt || todayIso(), ends = phase.requirements.filter(r => r.status !== 'cancelled').flatMap(r => r.actualEnd ? [r.actualEnd] : []);
      if (deliveredAt > todayIso() || ends.some(end => end > deliveredAt)) fail('交付日期不能晚于今天或早于有效需求完成日期');
      const snapshot: PhaseDelivery['snapshot'] = { name: phase.name, scope: phase.scope, targetDate: phase.targetDate, requirements: phase.requirements.filter(r => r.status !== 'cancelled').map(({ id, title, actualEnd, acceptanceCriteria }) => ({ id, title, actualEnd, acceptanceCriteria })) };
      sqlite.prepare('INSERT INTO phase_deliveries(id,phase_id,delivered_at,delivered_by,snapshot,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(), id, deliveredAt, actor.accountId, JSON.stringify(snapshot), now);
      sqlite.prepare('UPDATE feature_phases SET delivered_at=?,version=version+1,updated_at=? WHERE id=?').run(deliveredAt, now, id);
    } else {
      if (!phase.deliveredAt) fail('只有已交付 Phase 可以重新打开');
      if (!input.reason) fail('重新打开 Phase 需要填写原因');
      sqlite.prepare('UPDATE phase_deliveries SET reopened_at=?,reopen_reason=? WHERE phase_id=? AND reopened_at IS NULL').run(now, input.reason, id);
      sqlite.prepare('UPDATE feature_phases SET delivered_at=NULL,version=version+1,updated_at=? WHERE id=?').run(now, id);
    }
    recordAudit(actor, action, 'feature_phase', id, JSON.stringify({ phase: phase.name, reason: input.reason, deliveredAt: input.deliveredAt }), projectId);
    return action === 'delete' ? { id, deleted: true } : readFeaturePhases(projectId).find(p => p.id === id)!;
  }).immediate();
}
