import { randomUUID } from 'node:crypto';
import { deriveRequirementMetrics, requirementProgressWeight, todayIso } from '../../shared/domain';
import { deriveExecutionStage, type StageMilestone, type StageWork } from '../../shared/execution-stage';
import { phaseCommand, phaseDistribution, phaseInput, phaseProgress, type FeaturePhase, type PhaseDelivery, type PhaseRequirement } from '../../shared/feature-phases';
import { normalizeReferenceLinks, readReferenceLinks } from '../../shared/reference-links';
import type { Actor } from '../auth';
import { assertProjectManager, assertProjectReadable, requireAuthorizationActor } from '../authorization';
import { getDatabaseContext } from '../database-context';
import { fail, notFound } from '../errors';
import { recordAudit } from './audit';
import { requireActiveProject } from './support';

export function phaseRequirementFacts(projectId: string, asOfDate = todayIso(), requirementIds?: readonly string[]): PhaseRequirement[] {
  if (requirementIds?.length === 0) return [];
  const scope = requirementIds ? ` IN (${requirementIds.map(() => '?').join(',')})` : '';
  const params = [projectId, ...(requirementIds ?? [])];
  const requirements = getDatabaseContext().sqlite.prepare(`SELECT id,title,status,version,feature_id AS featureId,phase_id AS phaseId,stage_reset_at AS stageResetAt,actual_start AS actualStart,actual_end AS actualEnd,deleted_at AS deletedAt,acceptance_criteria AS acceptanceCriteria,execution_mode AS executionMode,progress,duration_days AS durationDays,split_base_progress AS splitBaseProgress FROM requirements WHERE project_id=?${scope ? ' AND id' + scope : ''}`).all(...params) as Array<PhaseRequirement & { stageResetAt: string | null; executionMode: 'direct' | 'work_items'; progress: number; durationDays:number|null }>;
  const work = getDatabaseContext().sqlite.prepare(`SELECT w.requirement_id AS requirementId,w.title,w.status,w.progress,w.progress_weight AS progressWeight,w.duration_days AS durationDays,w.planned_start AS plannedStart,w.planned_end AS plannedEnd,w.work_stage AS workStage,w.actual_start AS actualStart,w.actual_end AS actualEnd FROM work_items w JOIN requirements r ON r.id=w.requirement_id WHERE r.project_id=?${scope ? ' AND w.requirement_id' + scope : ''}`).all(...params) as Array<StageWork & { requirementId: string }>;
  const milestones = getDatabaseContext().sqlite.prepare(`SELECT requirement_id AS requirementId,title,milestone_kind AS milestoneKind,achieved_at AS achievedAt,achieved_recorded_at AS achievedRecordedAt,cancelled FROM milestones WHERE project_id=?${scope ? ' AND requirement_id' + scope : ''}`).all(...params) as Array<StageMilestone & { requirementId: string }>;
  const byWork = new Map<string, StageWork[]>(), byMilestone = new Map<string, StageMilestone[]>();
  for (const w of work) { const items = byWork.get(w.requirementId) || []; items.push(w); byWork.set(w.requirementId, items); }
  for (const m of milestones) { const items = byMilestone.get(m.requirementId) || []; items.push(m); byMilestone.set(m.requirementId, items); }
  return requirements.map(r => {
    const items = byWork.get(r.id) || [], metrics = deriveRequirementMetrics(r, items, asOfDate), status = metrics.status;
    const starts = items.filter(w => w.status !== 'cancelled').flatMap(w => w.actualStart ? [w.actualStart] : []);
    return { ...r, status, progress:metrics.progress, progressWeight:requirementProgressWeight(r,items), actualStart: r.executionMode === 'direct' ? r.actualStart : starts.sort()[0] || null,
      actualEnd: r.executionMode === 'direct' ? r.actualEnd : status === 'completed' ? metrics.effectiveEnd : null,
      executionStage: deriveExecutionStage({ ...r, status }, items, byMilestone.get(r.id)) };
  });
}
export function readFeaturePhases(projectId: string, asOfDate = todayIso(), facts = phaseRequirementFacts(projectId,asOfDate)): FeaturePhase[] {
  const phases = getDatabaseContext().sqlite.prepare('SELECT reference_links AS referenceLinks,id,project_id AS projectId,feature_id AS featureId,name,scope,started_at AS startedAt,target_date AS targetDate,note,sort_order AS sortOrder,version,delivered_at AS deliveredAt FROM feature_phases WHERE project_id=? ORDER BY sort_order,created_at,id').all(projectId) as FeaturePhase[];
  const deliveries = getDatabaseContext().sqlite.prepare(`SELECT d.id,d.phase_id AS phaseId,d.delivered_at AS deliveredAt,a.username AS deliveredByName,d.created_at AS createdAt,d.reopened_at AS reopenedAt,d.reopen_reason AS reopenReason,d.snapshot FROM phase_deliveries d JOIN feature_phases p ON p.id=d.phase_id LEFT JOIN accounts a ON a.id=d.delivered_by WHERE p.project_id=? ORDER BY d.created_at DESC,d.rowid DESC`).all(projectId) as Array<Omit<PhaseDelivery, 'snapshot'> & { phaseId: string; snapshot: string }>;
  const requirementsByPhase = new Map<string, PhaseRequirement[]>(), deliveriesByPhase = new Map<string, typeof deliveries>();
  for (const fact of facts) {
    if (!fact.phaseId) continue;
    const items = requirementsByPhase.get(fact.phaseId) || []; items.push(fact); requirementsByPhase.set(fact.phaseId, items);
  }
  for (const delivery of deliveries) {
    const items = deliveriesByPhase.get(delivery.phaseId) || []; items.push(delivery); deliveriesByPhase.set(delivery.phaseId, items);
  }
  return phases.map(p => {
    const requirements = requirementsByPhase.get(p.id) || [];
    return { ...p, referenceLinks:readReferenceLinks(p.referenceLinks),...phaseProgress(requirements, p.targetDate, asOfDate), requirements, distribution: phaseDistribution(requirements), deliveries: (deliveriesByPhase.get(p.id) || []).map(d => ({ ...d, snapshot: JSON.parse(d.snapshot) })) };
  });
}
export function listFeaturePhases(projectId: string, featureId: string | undefined, actor: Actor) {
  assertProjectReadable(requireAuthorizationActor(actor), projectId);
  return getDatabaseContext().sqlite.transaction(() => readFeaturePhases(projectId).filter(p => !featureId || p.featureId === featureId))();
}
function manager(projectId: string, actor: Actor) { assertProjectManager(requireAuthorizationActor(actor), projectId); requireActiveProject(projectId); }
function feature(projectId: string, featureId: string) {
  const value = getDatabaseContext().sqlite.prepare('SELECT archived_at AS archivedAt FROM features WHERE id=? AND project_id=?').get(featureId, projectId) as { archivedAt: string | null } | undefined;
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
  return getDatabaseContext().sqlite.transaction(() => {
    manager(projectId, actor); feature(projectId, featureId);
    if(!input.id&&getDatabaseContext().sqlite.prepare("SELECT 1 FROM features WHERE id=? AND kind='other'").get(featureId))fail('其他需求不创建 Phase，请先归入特性');
    const before = input.id ? current(projectId, input.id, input.expectedVersion || 0) : null;
    if (before && before.featureId !== featureId) fail('Phase 不属于该特性');
    const scope = input.scope ?? before?.scope ?? '', note = input.note ?? before?.note ?? '';
    const targetDate = input.targetDate === undefined ? before?.targetDate ?? null : input.targetDate;
    if (before && (before.startedAt || !['planning','not_started'].includes(before.status)) && (before.scope !== scope || before.targetDate !== targetDate) && !input.reason) fail('推进后的范围或目标日期调整需要填写原因');
    const duplicate = getDatabaseContext().sqlite.prepare('SELECT id FROM feature_phases WHERE feature_id=? AND name=? AND id<>?').get(featureId, input.name, input.id || '');
    if (duplicate) fail('该特性内已存在同名 Phase');
    const id = input.id || randomUUID(), now = new Date().toISOString();
    if (before) getDatabaseContext().sqlite.prepare('UPDATE feature_phases SET name=?,scope=?,target_date=?,note=?,sort_order=?,version=version+1,updated_at=? WHERE id=?').run(input.name, scope, targetDate, note, input.sortOrder ?? before.sortOrder, now, id);
    else getDatabaseContext().sqlite.prepare('INSERT INTO feature_phases(id,project_id,feature_id,name,scope,target_date,note,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, projectId, featureId, input.name, scope, targetDate, note, input.sortOrder ?? readFeaturePhases(projectId).filter(p => p.featureId === featureId).length, now, now);
    if(input.referenceLinks!==undefined)getDatabaseContext().sqlite.prepare('UPDATE feature_phases SET reference_links=? WHERE id=?').run(JSON.stringify(normalizeReferenceLinks(input.referenceLinks)),id);
    const after = readFeaturePhases(projectId).find(p => p.id === id)!;
    recordAudit(actor, before ? 'update' : 'create', 'feature_phase', id, JSON.stringify({ before, after, reason: input.reason }), projectId); return after;
  }).immediate();
}
export function commandFeaturePhase(projectId: string, id: string, action: 'delete', raw: unknown, actor: Actor) {
  const input = phaseCommand.parse(raw);
  return getDatabaseContext().sqlite.transaction(() => {
    manager(projectId, actor);
    const phase = current(projectId, id, input.expectedVersion);
    if (action !== 'delete') fail('Phase 状态由下属需求自动计算');
    if (phase.requirements.length || phase.deliveries.length) fail('仅能删除没有需求及交付历史的空 Phase');
    getDatabaseContext().sqlite.prepare('DELETE FROM feature_phases WHERE id=?').run(id);
    recordAudit(actor, action, 'feature_phase', id, JSON.stringify({ phase: phase.name, reason: input.reason }), projectId);
    return { id, deleted: true };
  }).immediate();
}
