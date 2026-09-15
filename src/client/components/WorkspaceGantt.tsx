import {useEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import {ChevronDown,ChevronRight} from 'lucide-react';
import {workStageLabels} from '../../shared/execution-stage';
import {phaseStatusLabels} from '../../shared/feature-phases';
import {flattenWorkspaceRows,type WorkspaceRow} from '../workspace-rows';
import type {Person} from '../types';
import {useGanttNavigation} from '../use-gantt-navigation';
import {GanttNavigation,GanttScrollbar} from './GanttNavigation';
import {GanttDateTracks} from './GanttDateTracks';
import {GanttScale,ganttTodayPosition,ganttTrackStyle,businessDateIndex,toGanttDate} from './GanttTimeline';
import {requirementActualRange,workItemActualRange} from '../gantt-actual';
import {ganttForecast} from '../gantt-forecast';
import {executionStageOf} from './ExecutionStageBadge';
import {WorkItemExecution,type ExecutionControls} from './WorkItemExecution';
import {DeliveryControls} from './DeliveryControls';
import {Select} from './Select';
import '../workspace-gantt.css';

type Props={rows:WorkspaceRow[];people:Person[];storageKey:string;asOfDate:string;selected:string;onSelect:(row:WorkspaceRow)=>void;filtered?:boolean};
const expands=(row:WorkspaceRow,expanded:Record<string,boolean>)=>expanded[row.id]??['feature','phase'].includes(row.kind);
export function WorkspaceGantt({rows,people,storageKey,asOfDate,selected,onSelect,filtered=false}:Props){
  const key='pm-workspace-rows:'+storageKey;
  const [expanded,setExpanded]=useState<Record<string,boolean>>(()=>{try{return JSON.parse(sessionStorage.getItem(key)||'{}');}catch{return {};}});
  const all=useMemo(()=>flattenWorkspaceRows(rows,{},true),[rows]);
  const selectedPath=useMemo(()=>{
    const path=(items:WorkspaceRow[],parents:string[]):string[]|null=>{for(const row of items){if(row.id===selected)return parents;const found=path(row.children,[...parents,row.id]);if(found)return found;}return null;};
    return path(rows,[])||[];
  },[rows,selected]);
  useEffect(()=>{if(selectedPath.length)setExpanded(old=>selectedPath.every(id=>expands(all.find(r=>r.row.id===id)!.row,old))?old:{...old,...Object.fromEntries(selectedPath.map(id=>[id,true]))});},[selectedPath,all]);
  useEffect(()=>{try{sessionStorage.setItem(key,JSON.stringify(expanded));}catch{/* View remains usable. */}},[expanded,key]);
  const visible=flattenWorkspaceRows(rows,expanded,filtered);
  const dates=all.flatMap(({row:r})=>r.phase?[r.phase.targetDate,r.phase.deliveredAt]:r.work?[r.work.plannedStart,r.work.plannedEnd,r.work.actualStart,r.work.actualEnd,r.work.forecastEnd]:r.requirement?[r.requirement.plannedStart,r.requirement.plannedEnd,r.requirement.actualStart,r.requirement.actualEnd,r.requirement.executionForecastEnd]:[]);
  const nav=useGanttNavigation({values:dates,asOfDate,storageKey}),today=ganttTodayPosition(nav.dates,asOfDate),track=ganttTrackStyle(nav.dates,nav.cellWidth,nav.zoom);
  useEffect(()=>{const element=nav.scrollRef.current;if(!element)return;try{element.scrollTop=Number(sessionStorage.getItem(key+':scroll'))||0;}catch{/* View remains usable. */}const remember=()=>{try{sessionStorage.setItem(key+':scroll',String(element.scrollTop));}catch{/* View remains usable. */}};element.addEventListener('scroll',remember);return()=>element.removeEventListener('scroll',remember);},[key,nav.scrollRef]);
  const lastSelection=useRef('');
  useEffect(()=>{const root=nav.scrollRef.current;if(!root)return;if(selected&&lastSelection.current!==selected){const element=[...root.querySelectorAll<HTMLElement>('[data-row-id]')].find(e=>e.dataset.rowId===selected);if(element){root.scrollTop=Math.max(0,element.offsetTop-root.clientHeight/3);lastSelection.current=selected;}}},[selected,visible.length,nav.scrollRef]);
  const depthValue=['phases','requirements','work'].find(level=>all.filter(({row})=>row.children.length).every(({row})=>expands(row,expanded)===(row.kind==='feature'||level!=='phases'&&row.kind==='phase'||level==='work')))||'custom';
  const datePoint=(row:WorkspaceRow,date:string|null,label:string,actual=false)=>{
    const parsed=toGanttDate(date);if(!parsed)return null;
    const left=(businessDateIndex(parsed,nav.dates,'start')+.5)*nav.cellWidth;
    return <button className={'workspace-delivery-point'+(actual?' is-delivered':'')} style={{left}} title={label+' '+date} aria-label={label+' '+date} onClick={()=>onSelect(row)}><i/>{label} {date?.slice(5)}</button>;
  };
  return <section className="workspace-gantt" aria-label="特性与 Phase 计划甘特">
    <div className="workspace-time-tools" data-workspace-zone="tools"><GanttNavigation navigation={nav}/><Select aria-label="展开层级" value={filtered?'custom':depthValue} onChange={e=>setExpanded(Object.fromEntries(all.map(({row})=>[row.id,row.kind==='feature'||e.target.value!=='phases'&&row.kind==='phase'||e.target.value==='work'])))}><option value="phases">展开到 Phase</option><option value="requirements">展开到需求</option><option value="work">展开到工作项</option><option value="custom" disabled>{filtered?'显示匹配项':'手动展开'}</option></Select><span className="workspace-plan-legend"><span><i/>计划</span><span className="actual"><i/>实际</span><span>◇ 交付</span></span></div>
    <div className="workspace-gantt-scroll" ref={nav.attach} role="treegrid" aria-label="项目进展表">
      <div className="workspace-gantt-grid" style={{'--timeline-width':nav.timelineWidth+'px'} as CSSProperties}>
        <div className="workspace-gantt-heading"><div className="workspace-row-label" data-gantt-fixed>名称</div><div className="workspace-row-owner" data-gantt-fixed>负责人</div><GanttScale dates={nav.dates} cellWidth={nav.cellWidth} zoom={nav.zoom} todayOffset={today.offset} todayVisible={today.visible}/><div className="workspace-row-progress" data-gantt-fixed>阶段 / 进度</div><div className="workspace-row-actions" data-gantt-fixed>操作</div></div>
        {visible.map(({row,depth})=>{
          const r=row.requirement,w=row.work,item=w||r,stage=r?executionStageOf(r):null;
          const actual=w?workItemActualRange(w,asOfDate):r&&!row.archived?requirementActualRange(r,asOfDate):null;
          const stageLabel=stage?stage.label+(stage.stages.length===1?' · '+stage.stages[0].progress+'%':''):'';
          const stageTitle=stage&&stage.stages.length>1?stageLabel+'；'+stage.stages.map(s=>s.label+' '+s.progress+'%').join(' · '):stageLabel;
          const trackLabel=stage&&stage.stages.length>1?stage.stages.map(s=>s.label+' '+s.progress+'%').join(' · '):stageLabel;
          const summary=row.kind==='feature'?row.feature?.description:row.kind==='phase'?row.phase?.scope||'范围待明确':w?(w.workStage?workStageLabels[w.workStage]:'未分类'):stageLabel;
          const defaultProgress=row.phase?phaseStatusLabels[row.phase.status]:w?(({not_started:'未开始',completed:'已完成',cancelled:'已取消'} as Record<string,string>)[w.status]??w.progress+'%'):stageLabel;
          const render=({progress,actions}:ExecutionControls)=><div className={'workspace-gantt-row kind-'+row.kind+(row.archived?' is-archived':'')+(r?.executionMode==='direct'?' is-direct':'')} role="row" data-row-id={row.id} aria-level={depth+1} aria-selected={selected===row.id}>
            <div className="workspace-row-label" role="rowheader" style={{paddingLeft:8+Math.min(depth,2)*10}}>
              <span className="workspace-disclosure">{!!row.children.length&&<button aria-label={'展开 '+row.title} aria-expanded={filtered||expands(row,expanded)} onClick={()=>setExpanded(old=>({...old,[row.id]:!expands(row,old)}))}>{filtered||expands(row,expanded)?<ChevronDown size={14}/>:<ChevronRight size={14}/>}</button>}</span>
              <div className="workspace-name-content"><button className="workspace-row-title" title={row.title+(summary?' · '+summary:'')} onClick={()=>onSelect(row)}><strong>{row.title}</strong>{w&&summary!==row.title&&<small>{summary}</small>}{row.archived&&<small>已归档</small>}{row.temporary&&<small>未保存</small>}{r?.delayed&&<small className="danger-text">延期</small>}</button></div>
            </div>
            <div className="workspace-row-owner" role="cell" title={item?.ownerName||''}>{item?(item.ownerName||'待分派'):row.phase?row.phase.requirements.length+' 项':''}</div>
            <div className={'workspace-row-track gantt-track gantt-split-track gantt-status-'+(item?.status||'not_started').replaceAll('_','-')} style={track} title={item?'计划 '+(item.plannedStart||'待定')+' ～ '+(item.plannedEnd||'待定')+'；实际 '+(actual?.start||'未开始')+' ～ '+(actual?.end||'—')+(actual&&'ongoing' in actual&&actual.ongoing?'（截至统计日）':''):undefined}>
              {row.phase?<>{datePoint(row,row.phase.targetDate,'目标')}{datePoint(row,row.phase.deliveredAt,'交付',true)}{!row.phase.targetDate&&!row.phase.deliveredAt&&<span className="workspace-date-empty">交付日期待定</span>}</>:item&&!row.archived?<GanttDateTracks plannedStart={item.plannedStart} plannedEnd={item.plannedEnd} actualStart={actual?.start} actualEnd={actual?.end} status={item.status} progress={item.progress||0} dates={nav.dates} cellWidth={nav.cellWidth} scheduleComplete={w?!!w.plannedStart&&!!w.plannedEnd:r?.scheduleComplete!==false} showProgress={!!actual?.start} stageLabel={w||r?.executionMode==='direct'?undefined:trackLabel} forecast={ganttForecast(item.deliveryForecast,item.status,asOfDate)}/>:row.archived?<span className="workspace-date-empty">保留交付贡献</span>:null}
              {today.visible&&<i className="gantt-today-line" style={{left:(today.offset+1)*nav.cellWidth}}/>}
            </div>
            <div className="workspace-row-progress" role="cell" title={stageTitle||String(defaultProgress||'')} data-workspace-zone="tools">{progress}</div><div className="workspace-row-actions" role="cell" data-workspace-zone="tools">{actions}</div>
          </div>;
          return row.formalWork&&row.formalRequirement&&!row.temporary?<WorkItemExecution key={row.id} item={row.formalWork} requirement={row.formalRequirement} people={people}>{render}</WorkItemExecution>:row.formalRequirement?.executionMode==='direct'&&!row.temporary&&!row.archived?<DeliveryControls key={row.id} requirement={row.formalRequirement}>{render}</DeliveryControls>:<div className="workspace-row-wrapper" key={row.id}>{render({progress:defaultProgress?<span>{defaultProgress}</span>:null,actions:null})}</div>;
        })}
        {!visible.length&&<p className="feature-empty">没有符合条件的内容</p>}
      </div>
    </div><GanttScrollbar navigation={nav}/>
  </section>;
}
