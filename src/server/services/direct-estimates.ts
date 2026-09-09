import type {DependencyChanges} from '../../shared/path-contracts';
import type {PathInput} from '../../shared/paths';
import {analysePaths,topologicalOrder} from '../../shared/paths';
import {addBusinessDays,businessDaysInclusive} from '../../shared/domain';
import {fail} from '../errors';
import {sqlite} from '../database';

/** Compute manual direct-execution estimates against the final batch network. */
export function normalizeDirectEstimates(snapshot:PathInput,ids:string[],changes:NonNullable<DependencyChanges['entities']>=[],workPatches:DependencyChanges['estimates']=[]){
  const selected=snapshot.requirements.filter(r=>ids.includes(r.id)&&r.executionMode==='direct');
  const intents=[...selected.map(r=>({nodeId:'execute:'+r.id,value:r,end:r.forecastEnd,review:changes.find(c=>c.id===r.id)?.data.reviewForecast})),
    ...workPatches.filter(p=>p.forecastEnd!==undefined||p.reviewForecast).map(p=>({nodeId:p.workItemId,value:snapshot.workItems.find(w=>w.id===p.workItemId)!,end:p.forecastEnd,review:p.reviewForecast}))];
  for(const {value} of intents){value.forecastEnd=null;value.forecastDuration=null;value.forecastReadyAt=null;value.forecastReview=null;}
  if(!intents.some(i=>i.end||i.review))return;
  const graph=analysePaths(snapshot),order=new Map(topologicalOrder(graph.nodes.map(n=>n.id),graph.edges).map((id,i)=>[id,i]));
  for(const {nodeId,value:r,end:requested,review} of intents.sort((a,b)=>order.get(a.nodeId)!-order.get(b.nodeId)!)){
    let end=review?.forecastEnd||requested;if(!end&&!review)continue;
    if(end&&end<snapshot.asOfDate)fail('预计日期不能早于今天');
    const node=analysePaths(snapshot).nodes.find(n=>n.id===nodeId)!;
    const ready=addBusinessDays(snapshot.asOfDate,node.earliestStart);
    if(review?.remainingDays)end=addBusinessDays(ready,review.remainingDays-1);
    const duration=businessDaysInclusive(ready,end!);
    if(!duration)fail('预测完成不能早于可开工日期');
    r.forecastEnd=end;r.forecastDuration=duration;r.forecastReadyAt=ready;
  }
}
export function persistDirectEstimates(snapshot:PathInput,ids:string[],mapping:Record<string,string>={}){
  const update=sqlite.prepare('UPDATE requirements SET forecast_end=?,forecast_duration=?,forecast_ready_at=?,forecast_review=? WHERE id=?');
  for(const r of snapshot.requirements)if(ids.includes(r.id)&&r.executionMode==='direct')update.run(r.forecastEnd??null,r.forecastDuration??null,r.forecastReadyAt??null,r.forecastReview?JSON.stringify(r.forecastReview):null,mapping[r.id]||r.id);
}
