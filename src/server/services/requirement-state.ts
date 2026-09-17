

import { getDatabaseContext } from '../database-context';

import { config } from '../config';

import { deriveRequirementMetrics, todayIso } from '../../shared/domain';

import { notFound } from '../errors';

import { getWorkItems, requirementSelect, type RequirementRecord } from './requirements';

import { assertVersionedWrite, nowIso, row } from './support';

export function syncStoredRequirementState(requirementId: string, updatedAt = nowIso(), incrementVersion = true, expectedVersion?: number) {
  const requirement = row<RequirementRecord>(`${requirementSelect} WHERE r.id=?`, requirementId);
  if (!requirement) notFound('需求不存在');
  const workItems = getWorkItems(requirementId);
  const nextMode=workItems.length?'work_items':'direct';
  if(requirement.executionMode!==nextMode){
    const base=nextMode==='work_items'?Math.min(99,requirement.progress):0;
    const splitAt=nextMode==='work_items'&&requirement.actualStart?updatedAt:null;
    getDatabaseContext().sqlite.prepare('UPDATE requirements SET execution_mode=?,split_base_progress=?,split_at=? WHERE id=?').run(nextMode,base,splitAt,requirementId);
    Object.assign(requirement,{executionMode:nextMode,splitBaseProgress:base,splitAt});
  }
  const metrics = deriveRequirementMetrics(requirement, workItems, todayIso(), config.highRiskDelayDays);
  const acceptedAt = metrics.status === 'completed' ? requirement.acceptedAt : null;
  const changed = getDatabaseContext().sqlite.prepare(`UPDATE requirements SET status=?, progress=?, planned_start=?, planned_end=?, risk_level=?, accepted_at=?,
    accepted_by_account_id=CASE WHEN ? IS NULL THEN NULL ELSE accepted_by_account_id END,
    version=version+?, updated_at=? WHERE id=? AND deleted_at IS NULL${expectedVersion === undefined ? '' : ' AND version=?'}`).run(
    metrics.status, metrics.progress, metrics.plannedStart, metrics.plannedEnd, metrics.riskLevel, acceptedAt, acceptedAt,
    incrementVersion ? 1 : 0, updatedAt, requirementId, ...(expectedVersion === undefined ? [] : [expectedVersion]),
  );
  assertVersionedWrite(changed, '需求');
  return metrics;
}

export function updateStoredRequirementSchedule(requirementId: string) {
  return syncStoredRequirementState(requirementId);
}
