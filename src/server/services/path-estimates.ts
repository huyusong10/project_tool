import type {Actor} from '../auth';
import {sqlite} from '../database';
import {assertRequirementOwnerOrManager,assertWorkItemParticipantOrManager,requireAuthorizationActor} from '../authorization';
import {fail,notFound} from '../errors';
import {analysePaths,DependencyCycleError,topologicalOrder,type PathInput} from '../../shared/paths';
import {addBusinessDays,businessDaysInclusive} from '../../shared/domain';
import type {DependencyChanges} from '../../shared/path-contracts';
type Patches=DependencyChanges['estimates'];
export function analyseChecked(input:PathInput,target='project') {
  try{return analysePaths(input,target);}
  catch(error){fail((error as Error).message,'DEPENDENCY_CONFLICT',409,error instanceof DependencyCycleError?{nodeIds:error.nodeIds,edgeIds:error.edgeIds}:undefined);}
}
/** Normalize in memory against the complete final network before any database writes. */
export function normalizePathEstimates(snapshot:PathInput,patches:Patches,actor:Actor) {
  const current=requireAuthorizationActor(actor);
  for(const patch of patches){
    const work=snapshot.workItems.find(w=>w.id===patch.workItemId);
    if(!work||snapshot.requirements.find(r=>r.id===work.requirementId)?.deletedAt)notFound('工作项不存在');
    if(patch.durationDays!==undefined||patch.earliestStart!==undefined)assertRequirementOwnerOrManager(current,work.requirementId);
    else assertWorkItemParticipantOrManager(current,work.id);
    if(['completed','cancelled'].includes(work.status))fail('已结束工作项不能修改当前预测','TERMINAL_LOCKED');
    if(patch.unblockEstimate&&patch.unblockEstimate<snapshot.asOfDate||patch.forecastEnd&&patch.forecastEnd<snapshot.asOfDate)fail('预计日期不能早于今天');
    for(const key of ['durationDays','earliestStart','unblockEstimate'] as const)if(patch[key]!==undefined)Object.assign(work,{[key]:patch[key]});
    if(patch.forecastEnd!==undefined){work.forecastEnd=null;work.forecastDuration=null;work.forecastReadyAt=null;}
  }
  if(!patches.some(p=>p.forecastEnd))return;
  const network=analyseChecked(snapshot),order=new Map(topologicalOrder(network.nodes.map(n=>n.id),network.edges).map((id,i)=>[id,i]));
  for(const patch of [...patches].sort((a,b)=>order.get(a.workItemId)!-order.get(b.workItemId)!)){
    if(!patch.forecastEnd)continue;
    const work=snapshot.workItems.find(w=>w.id===patch.workItemId)!;
    const node=analyseChecked(snapshot,work.id).nodes.find(n=>n.id===work.id)!;
    const ready=addBusinessDays(snapshot.asOfDate,node.earliestStart),duration=businessDaysInclusive(ready,patch.forecastEnd);
    if(!duration)fail('预测完成不能早于可开工日期');
    work.forecastEnd=patch.forecastEnd;work.forecastDuration=duration;work.forecastReadyAt=ready;
  }
}
/** Caller owns the transaction for estimates, relations, audit, and revision updates. */
export function persistPathEstimates(snapshot:PathInput,patches:Patches) {
  const update=sqlite.prepare('UPDATE work_items SET duration_days=?,earliest_start=?,unblock_estimate=?,forecast_end=?,forecast_duration=?,forecast_ready_at=?,version=version+1,updated_at=? WHERE id=?');
  const now=new Date().toISOString();
  for(const patch of patches){const w=snapshot.workItems.find(w=>w.id===patch.workItemId)!;update.run(w.durationDays,w.earliestStart,w.unblockEstimate,w.forecastEnd,w.forecastDuration,w.forecastReadyAt,now,w.id);}
}
