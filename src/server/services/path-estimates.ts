import type {Actor} from '../auth';
import {sqlite} from '../database';
import {assertProjectManager,assertRequirementOwnerOrManager,assertWorkItemParticipantOrManager,requireAuthorizationActor} from '../authorization';
import {fail,notFound} from '../errors';
import {analysePaths,DependencyCycleError,type PathInput} from '../../shared/paths';
import {normalizeDirectEstimates} from './direct-estimates';
import type {DependencyChanges} from '../../shared/path-contracts';
type Patches=DependencyChanges['estimates'];
export function analyseChecked(input:PathInput,target='project') {
  try{return analysePaths(input,target);}
  catch(error){fail((error as Error).message,'DEPENDENCY_CONFLICT',409,error instanceof DependencyCycleError?{nodeIds:error.nodeIds,edgeIds:error.edgeIds}:undefined);}
}
/** Normalize in memory against the complete final network before any database writes. */
export function normalizePathEstimates(snapshot:PathInput,patches:Patches,actor:Actor,entities:NonNullable<DependencyChanges['entities']>=[]) {
  const current=requireAuthorizationActor(actor);
  for(const patch of patches){
    const work=snapshot.workItems.find(w=>w.id===patch.workItemId);
    if(!work||snapshot.requirements.find(r=>r.id===work.requirementId)?.deletedAt)notFound('工作项不存在');
    if(!sqlite.prepare('SELECT 1 FROM requirements WHERE id=?').get(work.requirementId))assertProjectManager(current,snapshot.projectId);
    else if(patch.durationDays!==undefined||patch.earliestStart!==undefined||patch.arrangement!==undefined||patch.arrangementAnchor!==undefined)assertRequirementOwnerOrManager(current,work.requirementId);
    else assertWorkItemParticipantOrManager(current,work.id);
    if(['completed','cancelled'].includes(work.status))fail('已结束工作项不能修改当前预测','TERMINAL_LOCKED');
    if(patch.unblockEstimate&&patch.unblockEstimate<snapshot.asOfDate||patch.forecastEnd&&patch.forecastEnd<snapshot.asOfDate)fail('预计日期不能早于今天');
    for(const key of ['durationDays','earliestStart','unblockEstimate','arrangement','arrangementAnchor'] as const)if(patch[key]!==undefined)Object.assign(work,{[key]:patch[key]});
    if(patch.forecastEnd!==undefined||patch.reviewForecast){work.forecastEnd=null;work.forecastDuration=null;work.forecastReadyAt=null;}
  }
  const ids=entities.filter(c=>c.entity==='requirement'&&c.op!=='delete'&&(c.data.forecastEnd!==undefined||c.data.reviewForecast)).map(c=>c.id);
  analyseChecked(snapshot);
  normalizeDirectEstimates(snapshot,ids,entities,patches);
}
/** Caller owns the transaction for estimates, relations, audit, and revision updates. */
export function persistPathEstimates(snapshot:PathInput,patches:Patches) {
  const update=sqlite.prepare('UPDATE work_items SET duration_days=?,earliest_start=?,unblock_estimate=?,forecast_end=?,forecast_duration=?,forecast_ready_at=?,arrangement=?,arrangement_anchor=?,forecast_review=?,version=version+1,updated_at=? WHERE id=?');
  const now=new Date().toISOString();
  for(const patch of patches){const w=snapshot.workItems.find(w=>w.id===patch.workItemId)!;update.run(w.durationDays,w.earliestStart,w.unblockEstimate,w.forecastEnd,w.forecastDuration,w.forecastReadyAt,w.arrangement||'early',w.arrangementAnchor||null,w.forecastReview?JSON.stringify(w.forecastReview):null,now,w.id);}
}
