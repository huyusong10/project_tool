import type {CSSProperties,HTMLAttributes,ReactNode} from 'react';
import {businessDateIndex,toGanttDate} from '../gantt-geometry';
import type {ProgressPart} from '../workspace-gantt-presentation';
import './workspace-gantt-progress.css';

/** One capsule follows the recorded endpoint; visible timeline space controls its detail. */
export function GanttProgressEnd({start,end,asOfDate,dates,cellWidth,children,...interaction}: {
  start?:string|null;end?:string|null;asOfDate:string;dates:Date[];cellWidth:number;children:ReactNode;
}&HTMLAttributes<HTMLDivElement>) {
  const date=toGanttDate(end||start||asOfDate);
  if(!date||!dates.length||date<dates[0]||date>dates.at(-1)!)return null;
  const atEnd=!!end||!start;
  const endpoint=(businessDateIndex(date,dates,atEnd?'end':'start')+(atEnd?1:0))*cellWidth;
  return <div {...interaction} className="gantt-progress-end"
    data-anchor-date={end||start||asOfDate} style={{left:endpoint,'--gantt-progress-x':endpoint+'px'} as CSSProperties}>{children}</div>;
}
export function GanttProgressText({parts,extra=0}:{parts:ProgressPart[];extra?:number}) {
  return <span className="gantt-progress-text">{parts.slice(0,2).map((part,index)=><span className={'gantt-progress-part'+(index?' is-secondary':'')} key={index}>
    {part.label&&<span className={'gantt-progress-caption'+(part.percent===undefined?' is-fact':'')}>{part.label}</span>}
    {part.percent!==undefined&&<b className="gantt-progress-value">{part.percent}%</b>}
  </span>)}{parts.length+extra>1&&<small className={'gantt-progress-more'+(parts.length===2&&!extra?' only-compact':'')}><span className="full-count">+{Math.max(0,parts.length-2)+extra}</span><span className="compact-count">+{parts.length-1+extra}</span></small>}</span>;
}
