import type {PathEdge,PathMilestone} from '../../shared/paths';
import {requirementMilestones} from '../gantt-milestones';
import {GanttMilestoneRail,GanttMilestoneUndated,useMilestoneSelection} from './GanttMilestones';
import {useEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import {ChevronDown,ChevronRight} from 'lucide-react';
import {workStageLabels} from '../../shared/execution-stage';
import {phaseStatusLabels} from '../../shared/feature-phases';
import {flattenWorkspaceRows,type WorkspaceRow} from '../workspace-rows';
import type {Person} from '../types';
import {useGanttNavigation} from '../use-gantt-navigation';
import {GanttNavigation} from './GanttNavigation';
import {GanttDateTracks} from './GanttDateTracks';
import {GanttScale,ganttTodayPosition,ganttTrackStyle,businessDateIndex,toGanttDate} from './GanttTimeline';
import {requirementActualRange,workItemActualRange} from '../gantt-actual';
import {ganttForecast} from '../gantt-forecast';
import {executionStageOf} from './ExecutionStageBadge';
import {WorkItemExecution,type ExecutionControls} from './WorkItemExecution';
import {DeliveryControls} from './DeliveryControls';
import {Select} from './Select';
import {useGanttTooltip} from './GanttTooltip';
import {WorkspaceGanttSummary} from './WorkspaceGanttSummary';
import '../workspace-gantt.css';

type Props={milestones?:PathMilestone[];edges?:PathEdge[];rows:WorkspaceRow[];people:Person[];storageKey:string;asOfDate:string;selected:string;onSelect:(row:WorkspaceRow)=>void;filterKey?:string;filtered?:boolean};
const expands=(row:WorkspaceRow,expanded:Record<string,boolean>)=>expanded[row.id]??['feature','phase'].includes(row.kind);
export function WorkspaceGantt({rows,people,storageKey,asOfDate,selected,onSelect,filtered=false,filterKey="",milestones,edges}:Props){
  const summaryTooltip=useGanttTooltip();
  const key='pm-workspace-rows:'+storageKey;
  const [expanded,setExpanded]=useState<Record<string,boolean>>(()=>{try{return JSON.parse(sessionStorage.getItem(key)||'{}');}catch{return {};}});
  const all=useMemo(()=>flattenWorkspaceRows(rows,{},true),[rows]);
  const milestoneRows=useMemo(()=>new Map(all.filter(({row})=>row.kind==='requirement').map(({row})=>[row.id,requirementMilestones(milestones?.filter(m=>m.requirementId===row.id)||row.requirement?.milestones,row.requirement?.workItems||[],edges)])),[all,milestones,edges]);
  const projectMilestones=useMemo(()=>requirementMilestones(milestones?.filter(m=>!m.requirementId),[],edges),[milestones,edges]);
  const projectMilestoneSelection=useMilestoneSelection(projectMilestones,asOfDate);
  const milestoneItems=useMemo(()=>[...milestoneRows.values()].flat(),[milestoneRows]);
  const milestoneSelection=useMilestoneSelection(milestoneItems,asOfDate,id=>{const item=milestoneItems.find(m=>m.id===id),row=all.find(({row})=>item?.relatedIds.includes(row.id))?.row||all.find(({row})=>row.id===item?.requirementId)?.row;if(row)onSelect(row);});
  const selectedPath=useMemo(()=>{
    const path=(items:WorkspaceRow[],parents:string[]):string[]|null=>{for(const row of items){if(row.id===selected)return parents;const found=path(row.children,[...parents,row.id]);if(found)return found;}return null;};
    return path(rows,[])||[];
  },[rows,selected]);
  useEffect(()=>{if(selectedPath.length)setExpanded(old=>selectedPath.every(id=>expands(all.find(r=>r.row.id===id)!.row,old))?old:{...old,...Object.fromEntries(selectedPath.map(id=>[id,true]))});},[selectedPath,all]);
  useEffect(()=>{try{sessionStorage.setItem(key,JSON.stringify(expanded));}catch{/* View remains usable. */}},[expanded,key]);
  const [filterExpansion,setFilterExpansion]=useState<{key:string;rows:Record<string,boolean>}>({key:'',rows:{}});
  const currentExpanded=filtered?{...Object.fromEntries(all.map(({row})=>[row.id,true])),...(filterExpansion.key===filterKey?filterExpansion.rows:{})}:expanded;
  const changeExpanded=(value:Record<string,boolean>)=>filtered?setFilterExpansion({key:filterKey,rows:value}):setExpanded(value);
  const visible=flattenWorkspaceRows(rows,currentExpanded);
  const dates=[...projectMilestones.flatMap(m=>[m.targetDate,m.actualDate]),...milestoneItems.flatMap(m=>[m.targetDate,m.actualDate]),...all.flatMap(({row:r})=>r.phase?[r.phase.targetDate,r.phase.deliveredAt]:r.work?[r.work.plannedStart,r.work.plannedEnd,r.work.actualStart,r.work.actualEnd,r.work.forecastEnd]:r.requirement?[r.requirement.plannedStart,r.requirement.plannedEnd,r.requirement.actualStart,r.requirement.actualEnd,r.requirement.executionForecastEnd]:[])];
  const nav=useGanttNavigation({values:dates,asOfDate,storageKey,onPan:summaryTooltip.close}),today=ganttTodayPosition(nav.dates,asOfDate),track=ganttTrackStyle(nav.dates,nav.cellWidth,nav.zoom);
  useEffect(()=>{const element=nav.scrollRef.current;if(!element)return;try{element.scrollTop=Number(sessionStorage.getItem(key+':scroll'))||0;}catch{/* View remains usable. */}const remember=()=>{try{sessionStorage.setItem(key+':scroll',String(element.scrollTop));}catch{/* View remains usable. */}};element.addEventListener('scroll',remember);return()=>element.removeEventListener('scroll',remember);},[key,nav.scrollRef]);
  const lastSelection=useRef('');
  useEffect(()=>{const root=nav.scrollRef.current;if(!root)return;if(selected&&lastSelection.current!==selected){const element=[...root.querySelectorAll<HTMLElement>('[data-row-id]')].find(e=>e.dataset.rowId===selected);if(element){root.scrollTop=Math.max(0,element.offsetTop-root.clientHeight/3);lastSelection.current=selected;}}},[selected,visible.length,nav.scrollRef]);
  const hasPhases=all.some(({row})=>row.kind==='phase');
  const depthValue=(hasPhases?['phases','requirements','work']:['requirements','work']).find(level=>all.filter(({row})=>row.children.length).every(({row})=>expands(row,currentExpanded)===(row.kind==='feature'||level!=='phases'&&row.kind==='phase'||level==='work')))||'custom';
  const datePoint=(row:WorkspaceRow,date:string|null,label:string,actual=false)=>{
    const parsed=toGanttDate(date);if(!parsed)return null;
    const left=(businessDateIndex(parsed,nav.dates,'start')+.5)*nav.cellWidth;
    return <button className={'workspace-delivery-point'+(actual?' is-delivered':'')} style={{left}} title={label+' '+date} aria-label={label+' '+date} onClick={()=>onSelect(row)}><i/>{label} {date?.slice(5)}</button>;
  };
  return <section className="workspace-gantt" aria-label="特性与 Phase 计划甘特">
    <div className="workspace-time-tools" data-workspace-zone="tools"><GanttNavigation navigation={nav}/><Select aria-label="展开层级" value={depthValue} onChange={e=>changeExpanded(Object.fromEntries(all.map(({row})=>[row.id,row.kind==='feature'||e.target.value!=='phases'&&row.kind==='phase'||e.target.value==='work'])))}>{hasPhases&&<option value="phases">展开到 Phase</option>}<option value="requirements">展开到需求</option><option value="work">展开到工作项</option><option value="custom" disabled>{filtered?'显示匹配项':'手动展开'}</option></Select><span className="workspace-plan-legend"><span><i/>计划</span><span className="actual"><i/>实际</span><span className="forecast"><i/>预计延期</span><span>◇ 交付 / 里程碑</span></span></div>
    <div className="workspace-gantt-scroll" ref={nav.attach} role="treegrid" tabIndex={0} aria-label="项目进展表">
      <div className="workspace-gantt-grid" style={{'--timeline-width':nav.timelineWidth+'px'} as CSSProperties}>
        <div className={"workspace-gantt-heading"+(projectMilestones.some(m=>m.targetDate||m.actualDate)?" has-project-milestones":"")}><div className="workspace-row-label" data-gantt-fixed><span>名称 / 负责人</span><GanttMilestoneUndated compact items={projectMilestones} selection={projectMilestoneSelection}/></div><div className="workspace-date-heading"><GanttScale groupedDays dates={nav.dates} cellWidth={nav.cellWidth} zoom={nav.zoom} todayOffset={today.offset} todayVisible={today.visible}/>{projectMilestones.some(m=>m.targetDate||m.actualDate)&&<GanttMilestoneRail items={projectMilestones} dates={nav.dates} cellWidth={nav.cellWidth} asOfDate={asOfDate} selection={projectMilestoneSelection}/>}</div><div className="workspace-row-actions" data-gantt-fixed>进展 / 操作</div></div>
        {visible.map(({row,depth})=>{
          const rowMilestones=milestoneRows.get(row.id)||[];
          const r=row.requirement,w=row.work,item=w||r,stage=r?executionStageOf(r):null;
          const actual=w?workItemActualRange(w,asOfDate):r&&!row.archived?requirementActualRange(r,asOfDate):null;
          const stageLabel=stage?stage.label+(stage.stages.length===1?' · '+stage.stages[0].progress+'%':''):'';
          const stageTitle=stage&&stage.stages.length>1?stageLabel+'；'+stage.stages.map(s=>s.label+' '+s.progress+'%').join(' · '):stageLabel;
          const trackLabel=stage?.stages.length===1?stage.stages[0].progress+'%':undefined;
          const summary=row.kind==='feature'?row.feature?.description:row.kind==='phase'?row.phase?.scope||'范围待明确':w?(w.workStage?workStageLabels[w.workStage]:'未分类'):stageLabel;
          const defaultProgress=row.phase?phaseStatusLabels[row.phase.status]:w?(({not_started:'未开始',completed:'已完成',cancelled:'已取消'} as Record<string,string>)[w.status]??w.progress+'%'):stageLabel;
          const defaultContent=stage&&!w?<span className="workspace-stage-summary">{stage.stages.length>1?<>并行 · {stage.stages.map((s,index)=><span key={s.stage}>{index>0?' · ':''}{s.label} <strong>{s.progress}%</strong></span>)}</>:<>{stage.label}{stage.stages.length===1&&<> · <strong>{stage.stages[0].progress}%</strong></>}</>}</span>:<span className="workspace-stage-summary">{defaultProgress}</span>;
          const rowOpen=expands(row,currentExpanded);
          const toggleRow=()=>changeExpanded({...currentExpanded,[row.id]:!rowOpen});
          const rowActions=row.kind==='requirement'&&row.children.length?<button className="ghost-button workspace-open-work" aria-label={(rowOpen?'收起':'查看')+' '+row.title+' 的工作项'} aria-expanded={rowOpen} onClick={toggleRow}>{rowOpen?'收起':'工作项'} <span>{row.children.length}</span></button>:row.kind==='feature'?null:<button className="ghost-button" onClick={()=>onSelect(row)}>{row.phase?'交付详情':'详情'}</button>;
          const render=({progress,actions}:ExecutionControls)=><div className={'workspace-gantt-row kind-'+row.kind+(rowMilestones.some(m=>m.targetDate||m.actualDate)?' has-milestones':'')+(row.filterContext?' is-filter-context':'')+(row.archived?' is-archived':'')+(r?.executionMode==='direct'?' is-direct':'')} role="row" data-row-id={row.id} data-status={row.phase?.status||item?.status} aria-level={depth+1} aria-selected={selected===row.id}>
            <div className="workspace-row-label" role="rowheader" style={{paddingLeft:8+Math.min(depth,2)*10}}>
              <span className="workspace-disclosure">{!!row.children.length&&<button aria-label={'展开 '+row.title} aria-expanded={rowOpen} onClick={toggleRow}>{rowOpen?<ChevronDown size={14}/>:<ChevronRight size={14}/>}</button>}</span>
              <div className="workspace-name-content"><button className="workspace-row-title" title={item?undefined:row.title+(summary?' · '+summary:'')} {...(item?summaryTooltip.bind(<WorkspaceGanttSummary row={row} asOfDate={asOfDate}/>):{})} onClick={()=>{summaryTooltip.close();onSelect(row);}}><strong>{row.title}</strong>{row.archived&&<small>已归档</small>}{row.temporary&&<small>未保存</small>}</button>{item&&<div className="workspace-row-meta"><span className="workspace-row-owner" title={item.ownerName||'未分派负责人'}>{item.ownerName||'未分派'}</span></div>}{row.phase&&<div className="workspace-row-meta">{row.phase.requirements.length} 项需求</div>}</div>
            </div>
            <div className={'workspace-row-track gantt-track gantt-split-track gantt-status-'+(item?.status||'not_started').replaceAll('_','-')} style={track}>
              {row.phase?<>{datePoint(row,row.phase.targetDate,'目标')}{datePoint(row,row.phase.deliveredAt,'交付',true)}{!row.phase.targetDate&&!row.phase.deliveredAt&&<span className="workspace-date-empty">交付日期待定</span>}</>:item&&!row.archived?<GanttDateTracks plannedStart={item.plannedStart} plannedEnd={item.plannedEnd} actualStart={actual?.start} actualEnd={actual?.end} status={item.status} progress={item.progress||0} dates={nav.dates} cellWidth={nav.cellWidth} scheduleComplete={w?!!w.plannedStart&&!!w.plannedEnd:r?.scheduleComplete!==false} progressPlacement="inside" showProgress={!!actual?.start&&(!stage||!!w||stage.stages.length<=1)} stageLabel={w||r?.executionMode==='direct'?undefined:trackLabel||stageLabel} forecast={ganttForecast(item.deliveryForecast,item.status,asOfDate)} interactionProps={summaryTooltip.bind(<WorkspaceGanttSummary row={row} asOfDate={asOfDate}/>)}/>:row.archived?<span className="workspace-date-empty">保留交付贡献</span>:null}
              {!!rowMilestones.length&&<GanttMilestoneRail items={rowMilestones} dates={nav.dates} cellWidth={nav.cellWidth} asOfDate={asOfDate} selection={milestoneSelection} inline/>}
              {today.visible&&<i className="gantt-today-line" style={{left:(today.offset+1)*nav.cellWidth}}/>}
            </div>
            <div className={'workspace-row-actions'+(row.kind==='work'||r?.executionMode==='direct'?' has-execution':'')} role="cell" data-workspace-zone="tools"><div className="workspace-row-progress" title={stageTitle||String(defaultProgress||'')}>{progress}{r?.delayed&&!w&&<small className="danger-text">延期</small>}</div><div className="workspace-row-tools">{actions??rowActions}<GanttMilestoneUndated compact items={rowMilestones} selection={milestoneSelection}/></div></div>
          </div>;
          return row.formalWork&&row.formalRequirement&&!row.temporary?<WorkItemExecution key={row.id} item={row.formalWork} requirement={row.formalRequirement} people={people}>{render}</WorkItemExecution>:row.formalRequirement?.executionMode==='direct'&&!row.temporary&&!row.archived?<DeliveryControls key={row.id} requirement={row.formalRequirement}>{render}</DeliveryControls>:<div className="workspace-row-wrapper" key={row.id}>{render({progress:defaultProgress?defaultContent:null,actions:null})}</div>;
        })}
        {!visible.length&&<p className="feature-empty">没有符合条件的内容</p>}
      </div>
    </div>{milestoneSelection.details}{projectMilestoneSelection.details}{summaryTooltip.tooltip}
  </section>;
}
