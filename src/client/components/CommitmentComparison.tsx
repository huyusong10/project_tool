import {businessDayDelta} from '../../shared/domain';
import type {DeliveryFields} from '../../shared/delivery';
export function CommitmentComparison({value,plannedEnd,forecastEnd}:{value:DeliveryFields;plannedEnd?:string|null;forecastEnd?:string|null}){
 const first=value.commitment?.first?.targetDate,latest=value.commitment?.latest?.targetDate;
 const compare=(date:string|null|undefined,end:string|null|undefined)=>{if(!date||!end)return '待确认';const days=businessDayDelta(date,end);return days>0?'晚 '+days+' 个工作日':days<0?'早 '+(-days)+' 个工作日':'同日';};
 return <div className="commitment-comparison field-full"><span>首次承诺 {first||'未确认日期'} · 最近确认 {latest||'未确认日期'}</span>{plannedEnd!==undefined&&<span>当前安排 {plannedEnd||'待确认'} · 相比首次承诺 {compare(first,plannedEnd)}</span>}{forecastEnd!==undefined&&<span>交付预测 {forecastEnd||'待确认'} · 相比首次承诺 {compare(first,forecastEnd)}</span>}</div>;
}
