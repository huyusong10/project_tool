import { predecessorBasis, type ForecastReview } from '../../shared/forecast-basis';
import type { DependencyChanges } from '../../shared/path-contracts';
import type { PathAnalysis, PathInput } from '../../shared/paths';
import type { Actor } from '../auth';
import { getDatabaseContext } from '../database-context';
export function invalidateForecastReview(kind:'requirement'|'work',id:string){
  const table=kind==='requirement'?'requirements':'work_items';
  getDatabaseContext().sqlite.prepare(`UPDATE ${table} SET forecast_review=json_set(forecast_review,'$.invalidatedAt',?) WHERE id=? AND forecast_review IS NOT NULL`).run(new Date().toISOString(),id);
}
export function recordForecastReviews(snapshot:PathInput,analysis:PathAnalysis,changes:DependencyChanges,actor:Actor) {
  const now=new Date().toISOString();
  for(const [id,isWork,review] of [
    ...changes.estimates.filter(p=>p.reviewForecast).map(p=>[p.workItemId,true,p.reviewForecast] as const),
    ...(changes.entities||[]).filter(p=>p.entity==='requirement'&&p.data.reviewForecast).map(p=>[p.id,false,p.data.reviewForecast] as const),
  ]){
    const value=isWork?snapshot.workItems.find(w=>w.id===id):snapshot.requirements.find(r=>r.id===id);
    if(!value||!review)continue;
    value.forecastReview={confirmedAt:now,confirmedBy:actor.accountId||actor.id,confirmedName:actor.label,remainingDays:review.remainingDays??null,forecastEnd:value.forecastEnd||null,
      progress:value.progress||0,actualStart:value.actualStart||null,predecessorBasis:predecessorBasis(isWork?id:'execute:'+id,analysis)} satisfies ForecastReview;
  }
}
export function persistForecastReviews(snapshot:PathInput,changes:DependencyChanges,mapping:Record<string,string>={}) {
  for(const p of changes.estimates)if(p.reviewForecast){const w=snapshot.workItems.find(w=>w.id===p.workItemId)!;getDatabaseContext().sqlite.prepare('UPDATE work_items SET forecast_review=? WHERE id=?').run(JSON.stringify(w.forecastReview),mapping[w.id]||w.id);}
  for(const p of changes.entities||[])if(p.entity==='requirement'&&p.data.reviewForecast){const r=snapshot.requirements.find(r=>r.id===p.id)!;getDatabaseContext().sqlite.prepare('UPDATE requirements SET forecast_end=?,forecast_duration=?,forecast_ready_at=?,forecast_review=? WHERE id=?').run(r.forecastEnd??null,r.forecastDuration??null,r.forecastReadyAt??null,JSON.stringify(r.forecastReview),mapping[r.id]||r.id);}
}
