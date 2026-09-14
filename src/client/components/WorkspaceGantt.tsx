import {useEffect,useMemo,useRef,useState} from 'react';
import type {CSSProperties} from 'react';
import {ChevronDown,ChevronRight} from 'lucide-react';
import {workStageLabels} from '../../shared/execution-stage';
import {phaseStatusLabels} from '../../shared/feature-phases';
import {flattenWorkspaceRows,type WorkspaceRow} from '../workspace-rows';
import {useGanttNavigation} from '../use-gantt-navigation';
import {GanttNavigation,GanttScrollbar} from './GanttNavigation';
import {GanttPlanActualBars,GanttScale,ganttTodayPosition,ganttTrackStyle,businessDateIndex,toGanttDate} from './GanttTimeline';
import {requirementActualRange,workItemActualRange} from '../gantt-actual';
import {ganttForecast} from '../gantt-forecast';
import {executionStageOf} from './ExecutionStageBadge';
import '../workspace-gantt.css';

export function WorkspaceGantt({rows,storageKey,asOfDate,selected,onSelect,filtered=false}:{rows:WorkspaceRow[];storageKey:string;asOfDate:string;selected:string;onSelect:(row:WorkspaceRow)=>void;filtered?:boolean}) {
  const key='pm-workspace-rows:'+storageKey;
  const [expanded,setExpanded]=useState<Record<string,boolean>>(()=>{try{return JSON.parse(sessionStorage.getItem(key)||'{}');}catch{return {};}});
  const all=useMemo(()=>flattenWorkspaceRows(rows,{},true),[rows]);
  const selectedPath=useMemo(()=>{
    const path=(items:WorkspaceRow[],parents:string[]):string[]|null=>{for(const row of items){if(row.id===selected)return parents;const found=path(row.children,[...parents,row.id]);if(found)return found;}return null;};
    return path(rows,[])||[];
  },[rows,selected]);
  useEffect(()=>{if(selectedPath.length)setExpanded(old=>selectedPath.every(id=>old[id])?old:{...old,...Object.fromEntries(selectedPath.map(id=>[id,true]))});},[selectedPath]);
  useEffect(()=>{try{sessionStorage.setItem(key,JSON.stringify(expanded));}catch{/* View remains usable. */}},[expanded,key]);
  const visible=flattenWorkspaceRows(rows,expanded,filtered);
  const dates=all.flatMap(({row:r})=>r.phase?[r.phase.targetDate,r.phase.deliveredAt]:r.work?[r.work.plannedStart,r.work.plannedEnd,r.work.actualStart,r.work.actualEnd,r.work.forecastEnd]:r.requirement?[r.requirement.plannedStart,r.requirement.plannedEnd,r.requirement.actualStart,r.requirement.actualEnd,r.requirement.executionForecastEnd]:[]);
  const nav=useGanttNavigation({values:dates,asOfDate,storageKey}),today=ganttTodayPosition(nav.dates,asOfDate),track=ganttTrackStyle(nav.dates,nav.cellWidth);
  const vertical=useRef(0);
  useEffect(()=>{const element=nav.scrollRef.current;if(!element)return;try{element.scrollTop=Number(sessionStorage.getItem(key+':scroll'))||0;}catch{/* View remains usable. */}const remember=()=>{vertical.current=element.scrollTop;try{sessionStorage.setItem(key+':scroll',String(vertical.current));}catch{/* View remains usable. */}};element.addEventListener('scroll',remember);return()=>element.removeEventListener('scroll',remember);},[key,nav.scrollRef]);
  const lastSelection=useRef('');
  useEffect(()=>{const root=nav.scrollRef.current;if(!root)return;if(selected&&lastSelection.current!==selected){const element=[...root.querySelectorAll<HTMLElement>('[data-row-id]')].find(e=>e.dataset.rowId===selected);if(element){root.scrollTop=Math.max(0,element.offsetTop-root.clientHeight/3);lastSelection.current=selected;}}},[selected,visible.length,nav.scrollRef]);
  const datePoint=(date:string|null,label:string,actual=false)=>{
    const parsed=toGanttDate(date);if(!parsed)return null;
    const left=(businessDateIndex(parsed,nav.dates,'start')+.5)*nav.cellWidth;
    return <button className={'workspace-delivery-point'+(actual?' is-delivered':'')} style={{left}} title={label+' '+date} aria-label={label+' '+date}><i/>{label} {date?.slice(5)}</button>;
  };
  return <section className="workspace-gantt" aria-label="特性与 Phase 计划甘特">
    <div className="workspace-time-tools" data-workspace-zone="tools"><GanttNavigation navigation={nav}/><button className="ghost-button" onClick={()=>setExpanded({})}>收起需求</button><span className="workspace-plan-legend">虚线：计划 · 实线：实际 · 菱形：交付</span></div>
    <div className="workspace-gantt-scroll" ref={nav.attach} role="treegrid" aria-label="项目计划与进展">
      <div className="workspace-gantt-grid" style={{'--timeline-width':nav.timelineWidth+'px'} as CSSProperties}>
        <div className="workspace-gantt-heading"><div className="workspace-row-label" data-gantt-fixed>特性 / Phase / 需求 / 工作项</div><GanttScale dates={nav.dates} cellWidth={nav.cellWidth} zoom={nav.zoom} todayOffset={today.offset} todayVisible={today.visible}/></div>
        {visible.map(({row,depth})=>{
          const r=row.requirement,w=row.work,item=w||r,stage=r?executionStageOf(r):null;
          const actual=w?workItemActualRange(w,asOfDate):r&&!row.archived?requirementActualRange(r,asOfDate):null;
          const summary=row.kind==='feature'?(row.feature?.phases||[]).map(p=>p.name+' '+phaseStatusLabels[p.status]).join(' · ')||'尚未规划 Phase':row.kind==='phase'?row.phase?phaseStatusLabels[row.phase.status]+' · '+row.phase.requirements.length+' 条需求 · '+(row.phase.scope||'范围待明确')+(row.attentionCount?' · 关注 '+row.attentionCount:''):row.children.length+' 条需求':w?(w.workStage?workStageLabels[w.workStage]:'未分类')+' · '+(w.ownerName||'待分派')+' · '+(w.status==='completed'?'已完成':w.status==='cancelled'?'已取消':w.progress+'%'):stage?.label+(stage?.stages.length?' · '+stage.stages.map(s=>(stage.stages.length>1?s.label+' ':'')+s.progress+'%').join(' · '):'');
          return <div className={'workspace-gantt-row kind-'+row.kind} key={row.id} role="row" data-row-id={row.id} aria-level={depth+1} aria-selected={selected===row.id} onClick={()=>onSelect(row)}>
            <div className="workspace-row-label" role="rowheader" style={{paddingLeft:12+depth*16}}>
              <span className="workspace-disclosure">{!!row.children.length&&<button aria-label={'展开 '+row.title} aria-expanded={expanded[row.id]??row.kind==='feature'} onClick={e=>{e.stopPropagation();setExpanded(old=>({...old,[row.id]:!(old[row.id]??row.kind==='feature')}));}}>{(expanded[row.id]??row.kind==='feature')?<ChevronDown size={15}/>:<ChevronRight size={15}/>}</button>}</span>
              <button className="workspace-row-title" title={row.title+" · "+summary}><strong>{row.title}</strong><small>{summary}{row.archived?' · 已归档':''}{row.temporary?' · 未保存':''}{r?.delayed?' · 延期':''}</small></button>
            </div>
            <div className={'workspace-row-track gantt-track gantt-status-'+(item?.status||'not_started').replaceAll('_','-')} style={track}>
              {row.phase?<>{datePoint(row.phase.targetDate,'目标')}{datePoint(row.phase.deliveredAt,'交付',true)}{!row.phase.targetDate&&!row.phase.deliveredAt&&<span className="workspace-date-empty">交付日期待定</span>}</>:item&&!row.archived?<GanttPlanActualBars plannedStart={item.plannedStart} plannedEnd={item.plannedEnd} actualStart={actual?.start} actualEnd={actual?.end} status={item.status} progress={item.progress||0} dates={nav.dates} cellWidth={nav.cellWidth} showUnscheduled stageLabel={w?undefined:summary} forecast={ganttForecast(item.deliveryForecast,item.status,asOfDate)}/>:row.archived?<span className="workspace-date-empty">已归档 · 保留交付贡献</span>:null}
              {today.visible&&<i className="gantt-today-line" style={{left:(today.offset+1)*nav.cellWidth}}/>}
            </div>
          </div>;
        })}
        {!visible.length&&<p className="feature-empty">没有符合条件的范围</p>}
      </div>
    </div><GanttScrollbar navigation={nav}/>
  </section>;
}
