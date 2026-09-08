import type {PathNode} from '../../shared/paths';
import {businessDaysInclusive} from '../../shared/domain';
export function PathGantt({nodes,onSelect}:{nodes:PathNode[];onSelect:(n:PathNode)=>void}){
 const dates=nodes.flatMap(n=>[n.forecastStart,n.forecastEnd,n.plannedStart,n.plannedEnd]).filter((d):d is string=>!!d).sort(),first=dates[0],last=dates.at(-1),days=first&&last?Math.max(1,businessDaysInclusive(first,last)):1;
 const pos=(day:string)=>first?Math.max(0,businessDaysInclusive(first,day)-1)/days*100:0;
 return <div className="path-draft-gantt">{nodes.map(n=><div className="path-draft-gantt-row" key={n.id}><button onClick={()=>onSelect(n)} title={n.title}>{n.kind==='milestone'||n.kind==='acceptance'?'◇ ':''}{n.title}<small>{n.forecastEnd||'交付待确认'}{n.arrangement==='late'?' · 靠近交付':''}</small></button><div className="path-draft-gantt-track">{n.plannedStart&&n.plannedEnd&&<i className="plan" style={{left:pos(n.plannedStart)+'%',width:Math.max(1,businessDaysInclusive(n.plannedStart,n.plannedEnd))/days*100+'%'}}/>}{n.forecastEnd&&n.forecastStart?<i className={n.kind==='milestone'||n.kind==='acceptance'?'milestone':''} style={{left:pos(n.forecastStart)+'%',width:n.kind==='milestone'||n.kind==='acceptance'?9:Math.max(1,businessDaysInclusive(n.forecastStart,n.forecastEnd))/days*100+'%'}} title={n.forecastStart+' ～ '+n.forecastEnd}/>:<em>待确认</em>}</div></div>)}</div>;
}
