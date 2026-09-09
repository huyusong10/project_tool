import type {DeliveryImpact,DeliveryTargetChange} from '../../shared/delivery-impact';
export function DeliveryImpactTable({entries,target}:{entries:DeliveryImpact[];target?:DeliveryTargetChange}){
  const goal=target&&<p className="field-help">{target.after.label} · 目标 {target.before.date||'待确认'} → {target.after.date||'待确认'} · 预计 {target.before.complete?target.before.forecast||'待确认':'待确认'} → {target.after.complete?target.after.forecast||'待确认':'待确认'}</p>;
  if(!entries.length)return <>{goal}<p className="field-help">交付预测、范围和风险没有变化。</p></>;
  const risk:Record<string,string>={high:'高',medium:'中',low:'低',unknown:'待评估'};
  const scope:Record<string,string>={committed:'纳入交付',candidate:'候选',absent:'不在范围'};
  return <div className="delivery-impact-list">{goal}{entries.map(e=><div className="graph-list-row" key={e.requirementId}><strong>{e.title}</strong><small>{scope[e.beforeScope]} → {scope[e.afterScope]} · 预计 {e.beforeForecast||'待确认'} → {e.afterForecast||'待确认'}</small><small>优先级 {e.beforePriority||'—'} → {e.afterPriority||'—'} · 风险 {risk[e.beforeRisk]} → {risk[e.afterRisk]} · 缓冲 {e.beforeBuffer??'待确认'} → {e.afterBuffer??'待确认'}</small>{e.forecastSources?.map(s=><small key={s.id}>{s.title} · 预测依据：{s.before||'待确认'} → {s.after||'待确认'}</small>)}<small>{e.ownerName||'项目经理'} · {e.reasons.join('；')}</small>{e.outsideExecuting&&<small className="warning-text">范围外仍在执行，工作与关系保留</small>}{(!!e.beforeSources?.length||!!e.afterSources?.length)&&<small>阻塞来源：{e.beforeSources?.map(s=>s.title).join('、')||'无'} → {e.afterSources?.map(s=>s.title).join('、')||'无'}</small>}</div>)}</div>;
}
