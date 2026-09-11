import type Database from 'better-sqlite3';
import { businessDaysInclusive, deriveRequirementMetrics, initialWorkEstimates, type WorkItemLike } from '../shared/domain';

type LegacyWork = WorkItemLike & { id: string; requirementId: string; createdAt: string };
type DateEdit = { content: string; createdAt: string };

/** Reverse only verifiable date edits after execution began. Never change the schedule or history. */
export function legacyProgressWeight(work: LegacyWork, edits: DateEdit[], executionAt?: string | null) {
  if (!executionAt) return initialWorkEstimates(work).progressWeight;
  const boundary = executionAt > work.createdAt ? executionAt : work.createdAt;
  const dates = { plannedStart: work.plannedStart, plannedEnd: work.plannedEnd };
  for (const edit of edits) {
    if (edit.createdAt < boundary) continue;
    for (const [key, label] of [['plannedStart', '计划开始'], ['plannedEnd', '计划完成']] as const) {
      const match = new RegExp(`${label}：(\\d{4}-\\d{2}-\\d{2}|未设置) → (\\d{4}-\\d{2}-\\d{2}|未设置)`).exec(edit.content);
      if (!match) continue;
      const before = match[1] === '未设置' ? null : match[1], after = match[2] === '未设置' ? null : match[2];
      if ((dates[key] || null) !== after) return initialWorkEstimates(work).progressWeight;
      dates[key] = before;
    }
  }
  return businessDaysInclusive(dates.plannedStart, dates.plannedEnd) || work.durationDays || 1;
}

export function initializeLegacyWorkEstimates(sqlite: Database.Database) {
  return sqlite.transaction(() => {
    const works = sqlite.prepare(`SELECT id,requirement_id AS requirementId,status,progress,planned_start AS plannedStart,planned_end AS plannedEnd,
      duration_days AS durationDays,progress_weight AS progressWeight,created_at AS createdAt FROM work_items WHERE progress_weight IS NULL`).all() as LegacyWork[];
    if (!works.length) return [];
    const firstExecution = sqlite.prepare("SELECT min(created_at) AS at FROM progress_updates WHERE requirement_id=? AND event_type IN ('start','progress','complete')");
    const edits = sqlite.prepare("SELECT summary AS content,created_at AS createdAt FROM audit_logs WHERE entity_type='work_item' AND entity_id=? AND action='update' ORDER BY created_at DESC,rowid DESC");
    const update = sqlite.prepare('UPDATE work_items SET progress_weight=?,duration_days=?,version=version+1 WHERE id=?');
    const repaired = works.map(work => {
      const at = (firstExecution.get(work.requirementId) as { at: string | null }).at;
      const weight = legacyProgressWeight(work, edits.all(work.id) as DateEdit[], at);
      const duration = initialWorkEstimates(work).durationDays;
      update.run(weight, duration, work.id);
      return { id: work.id, requirementId: work.requirementId, progressWeight: weight, durationDays: duration };
    });
    for (const id of new Set(works.map(w => w.requirementId))) {
      const r = sqlite.prepare('SELECT status,execution_mode AS executionMode,progress,split_base_progress AS splitBaseProgress FROM requirements WHERE id=?').get(id) as Parameters<typeof deriveRequirementMetrics>[0];
      if (r.executionMode === 'direct') continue;
      const items = sqlite.prepare('SELECT status,progress,progress_weight AS progressWeight FROM work_items WHERE requirement_id=?').all(id) as WorkItemLike[];
      const progress = deriveRequirementMetrics(r, items).progress;
      sqlite.prepare('UPDATE requirements SET progress=?,version=version+1 WHERE id=? AND progress<>?').run(progress, id, progress);
    }
    return repaired;
  }).immediate();
}
