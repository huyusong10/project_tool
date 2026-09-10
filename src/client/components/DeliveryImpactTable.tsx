import type {DeliveryImpact,DeliveryTargetChange} from '../../shared/delivery-impact';
export function DeliveryImpactTable({entries,target}:{entries:DeliveryImpact[];target?:DeliveryTargetChange}){
  const goal=target&&<p className="field-help">{target.after.label} · 目标 {target.before.date||'待确认'} → {target.after.date||'待确认'} · 预计 {target.before.complete?target.before.forecast||'待确认':'待确认'} → {target.after.complete?target.after.forecast||'待确认':'待确认'}</p>;
  if(!entries.length)return <>{goal}<p className="field-help">预计完成日期和依赖影响没有变化。</p></>;
  return <div className="delivery-impact-list">{goal}{entries.map(e=><div className="graph-list-row" key={e.requirementId}><strong>{e.title}</strong><small>预计 {e.beforeForecast||'待确认'} → {e.afterForecast||'待确认'}</small><small>缓冲 {e.beforeBuffer??'待确认'} → {e.afterBuffer??'待确认'}</small>{e.forecastSources?.map(s=><small key={s.id}>{s.title} · 预测依据：{s.before||'待确认'} → {s.after||'待确认'}</small>)}<small>{e.ownerName||'项目经理'} · {e.reasons.join('；')}</small>{(!!e.beforeSources?.length||!!e.afterSources?.length)&&<small>影响来源：{e.beforeSources?.map(s=>s.title).join('、')||'无'} → {e.afterSources?.map(s=>s.title).join('、')||'无'}</small>}</div>)}</div>;
}
