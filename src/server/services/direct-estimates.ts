import type {PathInput} from '../../shared/paths';
import {analysePaths,topologicalOrder} from '../../shared/paths';
import {addBusinessDays,businessDaysInclusive} from '../../shared/domain';
import {fail} from '../errors';
import {sqlite} from '../database';

/** Compute manual direct-execution estimates against the final batch network. */
export function normalizeDirectEstimates(snapshot:PathInput,ids:string[]){
  const selected=snapshot.requirements.filter(r=>ids.includes(r.id)&&r.executionMode==='direct');
  const forecasts=new Map(selected.map(r=>[r.id,r.forecastEnd]));
  for(const r of selected){r.forecastEnd=null;r.forecastDuration=null;r.forecastReadyAt=null;}
  if(!selected.some(r=>forecasts.get(r.id)))return;
  const graph=analysePaths(snapshot),order=new Map(topologicalOrder(graph.nodes.map(n=>n.id),graph.edges).map((id,i)=>[id,i]));
  for(const r of selected.sort((a,b)=>order.get('execute:'+a.id)!-order.get('execute:'+b.id)!)){
    const end=forecasts.get(r.id);if(!end)continue;
    if(end<snapshot.asOfDate)fail('预计日期不能早于今天');
    const node=analysePaths(snapshot).nodes.find(n=>n.id==='execute:'+r.id)!;
    const ready=addBusinessDays(snapshot.asOfDate,node.earliestStart),duration=businessDaysInclusive(ready,end);
    if(!duration)fail('预测完成不能早于可开工日期');
    r.forecastEnd=end;r.forecastDuration=duration;r.forecastReadyAt=ready;
  }
}
export function persistDirectEstimates(snapshot:PathInput,ids:string[],mapping:Record<string,string>={}){
  const update=sqlite.prepare('UPDATE requirements SET forecast_duration=?,forecast_ready_at=? WHERE id=?');
  for(const r of snapshot.requirements)if(ids.includes(r.id)&&r.executionMode==='direct')update.run(r.forecastDuration??null,r.forecastReadyAt??null,mapping[r.id]||r.id);
}
