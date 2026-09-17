import {TreeExpansionActions} from './TreeExpansionActions';
import { Button } from './Button';
import {WorkspaceObjectMark} from './WorkspaceObjectMark';
import type {PathEdge,PathMilestone} from '../../shared/paths';
import {requirementMilestones,latestAchievedMilestone} from '../gantt-milestones';
import {GanttMilestoneRail,GanttMilestoneUndated,useMilestoneSelection,LatestGanttMilestone} from './GanttMilestones';
import {useEffect,useMemo,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import {ChevronDown,ChevronRight,ArrowUpRight} from 'lucide-react';
import {workStageLabels} from '../../shared/execution-stage';
import {WorkspacePhaseProgress} from './WorkspacePhaseProgress';
import {summaryTimeline} from '../phase-gantt';
import {progressParts} from '../workspace-gantt-presentation';
import {GanttProgressEnd,GanttProgressText} from './GanttProgressEnd';
import {flattenWorkspaceRows,type WorkspaceRow} from '../workspace-rows';
import type {Person} from '../types';
import {useGanttNavigation} from '../use-gantt-navigation';
import {GanttNavigation} from './GanttNavigation';
import {GanttDateTracks} from './GanttDateTracks';
import {GanttScale,ganttTodayPosition,ganttTrackStyle} from './GanttTimeline';
import {requirementActualRange,workItemActualRange} from '../gantt-actual';
import {ganttForecast} from '../gantt-forecast';
import {executionStageOf} from './ExecutionStageBadge';
import {WorkItemExecution,type ExecutionControls} from './WorkItemExecution';
import {DeliveryControls} from './DeliveryControls';
import {RequirementWorkExecution} from './RequirementWorkExecution';
import {Select} from './Select';
import {useGanttTooltip} from './GanttTooltip';
import {WorkspaceGanttSummary} from './WorkspaceGanttSummary';
import '../workspace-gantt.css';

type Props={empty?:ReactNode;milestones?:PathMilestone[];edges?:PathEdge[];rows:WorkspaceRow[];people:Person[];storageKey:string;asOfDate:string;selected:string;onSelect:(row:WorkspaceRow)=>void;onEnter?:(row:WorkspaceRow)=>void;filterKey?:string;filtered?:boolean};
const expands=(row:WorkspaceRow,expanded:Record<string,boolean>)=>expanded[row.id]??(!row.virtual&&['feature','phase'].includes(row.kind));
export function WorkspaceGantt({rows,people,storageKey,asOfDate,selected,onSelect,onEnter,filtered=false,filterKey="",milestones,edges,empty}:Props){
  const summaryTooltip=useGanttTooltip();
  const key='pm-workspace-rows:'+storageKey;
  const [expanded,setExpanded]=useState<Record<string,boolean>>(()=>{try{return JSON.parse(sessionStorage.getItem(key)||'{}');}catch{return {};}});
  const all=useMemo(()=>flattenWorkspaceRows(rows,{},true),[rows]);
  const milestoneRows=useMemo(()=>new Map(all.filter(({row})=>row.kind==='requirement').map(({row})=>[row.id,requirementMilestones(milestones?.filter(m=>m.requirementId===row.id)||row.requirement?.milestones,row.requirement?.workItems||[],edges)])),[all,milestones,edges]);
  const projectMilestones=useMemo(()=>requirementMilestones(milestones?.filter(m=>!m.requirementId),[],edges),[milestones,edges]);
  const projectMilestoneSelection=useMilestoneSelection(projectMilestones,asOfDate);
  const latestMilestones=useMemo(()=>new Map(all.map(({row})=>[row.id,latestAchievedMilestone(milestoneRows.get(row.id)||[],row.requirement?.stageResetAt,asOfDate)])),[all,milestoneRows,asOfDate]);
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
  const summaries=useMemo(()=>new Map(all.filter(({row})=>(row.kind==='feature'||row.kind==='phase')&&!row.virtual&&row.feature?.kind!=='other').map(({row})=>[row.id,summaryTimeline(row,asOfDate)])),[all,asOfDate]);
  const dates=[...[...summaries.values()].flatMap(s=>[s.actualStart,s.actualEnd]),...projectMilestones.flatMap(m=>[m.targetDate,m.actualDate]),...[...latestMilestones.values()].flatMap(m=>m?.actualDate?[m.actualDate]:[]),...all.flatMap(({row:r})=>r.phase?[r.phase.actualStart,r.phase.observationEnd,r.phase.completedAt]:r.kind==='feature'?(r.feature?.phases||[]).flatMap(p=>[p.actualStart,p.observationEnd,p.completedAt]):r.work?[r.work.plannedStart,r.work.plannedEnd,r.work.actualStart,r.work.actualEnd,r.work.forecastEnd]:r.requirement?[r.requirement.plannedStart,r.requirement.plannedEnd,r.requirement.actualStart,r.requirement.actualEnd,r.requirement.executionForecastEnd]:[])];
  const nav=useGanttNavigation({values:dates,asOfDate,storageKey,onPan:summaryTooltip.close}),today=ganttTodayPosition(nav.dates,asOfDate),track=ganttTrackStyle(nav.dates,nav.cellWidth,nav.zoom);
  useEffect(()=>{const element=nav.scrollRef.current;if(!element)return;try{element.scrollTop=Number(sessionStorage.getItem(key+':scroll'))||0;}catch{/* View remains usable. */}const remember=()=>{try{sessionStorage.setItem(key+':scroll',String(element.scrollTop));}catch{/* View remains usable. */}};element.addEventListener('scroll',remember);return()=>element.removeEventListener('scroll',remember);},[key,nav.scrollRef]);
  const lastSelection=useRef('');
  useEffect(()=>{const root=nav.scrollRef.current;if(!root)return;if(selected&&lastSelection.current!==selected){const element=[...root.querySelectorAll<HTMLElement>('[data-row-id]')].find(e=>e.dataset.rowId===selected);if(element){root.scrollTop=Math.max(0,element.offsetTop-root.clientHeight/3);lastSelection.current=selected;}}},[selected,visible.length,nav.scrollRef]);
  const hasPhases=all.some(({row})=>row.kind==='phase');
  const branches=all.filter(({row})=>row.children.length);
  const expandAll=(open:boolean)=>changeExpanded({...currentExpanded,...Object.fromEntries(branches.map(({row})=>[row.id,open]))});
  const expandsTo=(row:WorkspaceRow,level:string)=>level!=='collapsed'&&(row.kind==='feature'||level!=='phases'&&row.kind==='phase'||level==='work');
  const depthValue=(hasPhases?['collapsed','phases','requirements','work']:['collapsed','requirements','work']).find(level=>branches.every(({row})=>expands(row,currentExpanded)===expandsTo(row,level)))||'custom';
  return <section className="workspace-gantt" aria-label="特性与 Phase 计划甘特">
    <div className="workspace-time-tools" data-workspace-zone="tools"><TreeExpansionActions canExpand={branches.some(({row})=>!expands(row,currentExpanded))} canCollapse={branches.some(({row})=>expands(row,currentExpanded))} onChange={expandAll}/><GanttNavigation navigation={nav}/><Select aria-label="展开层级" value={depthValue} onChange={e=>changeExpanded({...currentExpanded,...Object.fromEntries(all.map(({row})=>[row.id,expandsTo(row,e.target.value)]))})}><option value="collapsed">收起全部</option>{hasPhases&&<option value="phases">展开到 Phase</option>}<option value="requirements">展开到需求</option><option value="work">展开到工作项</option><option value="custom" disabled>{filtered?'显示匹配项':'手动展开'}</option></Select><span className="workspace-plan-legend"><span><i/>计划</span><span className="actual"><i/>实际</span><span className="forecast"><i/>预计延期</span><span>◇ 交付 / 里程碑</span></span></div>
    <div className="workspace-gantt-scroll gantt-navigation-surface" ref={nav.attach} role="treegrid" tabIndex={0} aria-label="项目进展表">
      <div className="workspace-gantt-grid" style={{'--timeline-width':nav.timelineWidth+'px'} as CSSProperties}>
        <div className={"workspace-gantt-heading"+(projectMilestones.some(m=>m.targetDate||m.actualDate)?" has-project-milestones":"")}><div className="workspace-row-label" data-gantt-fixed><span>名称 / 负责人</span><GanttMilestoneUndated compact items={projectMilestones} selection={projectMilestoneSelection}/></div><div className="workspace-date-heading"><GanttScale groupedDays dates={nav.dates} cellWidth={nav.cellWidth} zoom={nav.zoom} todayOffset={today.offset} todayVisible={today.visible}/>{projectMilestones.some(m=>m.targetDate||m.actualDate)&&<GanttMilestoneRail items={projectMilestones} dates={nav.dates} cellWidth={nav.cellWidth} asOfDate={asOfDate} selection={projectMilestoneSelection}/>}</div><div className="workspace-row-actions" data-gantt-fixed>操作</div></div>
        {visible.map(({row,depth})=>{
          const rowMilestones=milestoneRows.get(row.id)||[];
          const r=row.requirement,w=row.work,item=w||r,stage=r?executionStageOf(r):null;
          const actual=w?workItemActualRange(w,asOfDate):r?requirementActualRange(r,asOfDate):null;
          const stageLabel=stage?stage.label+(stage.stages.length===1?' · '+stage.stages[0].progress+'%':''):'';
          const stageTitle=stage&&stage.stages.length>1?stageLabel+'；'+stage.stages.map(s=>s.label+' '+s.progress+'%').join(' · '):stageLabel;
          const summary=row.kind==='feature'&&!row.children.length?'暂无需求':row.kind==='phase'&&!row.children.length?'本 Phase 暂无需求':row.kind==='feature'?row.feature?.description:row.kind==='phase'?(row.virtual?'尚未分派到交付阶段':row.phase?.scope||'范围待明确'):w?(w.workStage?workStageLabels[w.workStage]:'未分类'):stageLabel;
          const parts=progressParts(row),defaultContent=<GanttProgressText parts={parts}/>;
          const latestMilestone=latestMilestones.get(row.id);
          const details=<WorkspaceGanttSummary row={row} asOfDate={asOfDate} milestones={rowMilestones}/>;
          const rowOpen=expands(row,currentExpanded);
          const toggleRow=()=>changeExpanded({...currentExpanded,[row.id]:!rowOpen});
          const render=({progress,actions}:ExecutionControls)=><div className={'workspace-gantt-row kind-'+row.kind+(row.filterContext?' is-filter-context':'')+(row.archived?' is-archived':'')+(r?.executionMode==='direct'?' is-direct':'')} role="row" data-object-kind={row.virtual||row.feature?.kind==='other'?'group':row.kind} onClick={e=>{if(!(e.target as Element).closest('button,input,a,select'))onSelect(row);}} data-row-id={row.id} data-status={row.phase?.status||item?.status} aria-level={depth+1} aria-selected={selected===row.id}>
            <div className="workspace-row-label" role="rowheader" style={{paddingLeft:8+Math.min(depth,2)*10}}>
              <span className="workspace-disclosure">{!!row.children.length&&<button aria-label={'展开 '+row.title} aria-expanded={rowOpen} onClick={toggleRow}>{rowOpen?<ChevronDown size={14}/>:<ChevronRight size={14}/>}</button>}</span>
              <WorkspaceObjectMark kind={row.virtual||row.feature?.kind==='other'?'group':row.kind} status={w?.status}/><div className="workspace-name-content"><div className="workspace-name-heading"><button className="workspace-row-title" title={item?undefined:row.title+(summary?' · '+summary:'')} {...(item?summaryTooltip.bind(details):{})} onClick={()=>{summaryTooltip.close();onSelect(row);}}><strong>{row.title}</strong>{row.phase?.status==='planning'&&<small>待细化</small>}{row.archived&&<small>已归档</small>}{row.temporary&&<small>未保存</small>}</button>{onEnter&&row.kind!=='work'&&!(row.archived&&row.kind==='requirement')&&<Button variant="ghost" iconOnly size="small" className="workspace-enter workspace-icon-button" title="进入下一级" aria-label={'进入'+row.title} onClick={()=>onEnter(row)}><ArrowUpRight size={14}/></Button>}</div>{item&&<div className="workspace-row-meta"><span className="workspace-row-owner" title={item.ownerName||'未分派负责人'}>{item.ownerName||'未分派'}</span></div>}{row.kind==='feature'&&!row.children.length&&<div className="workspace-row-meta">暂无需求</div>}{row.virtual&&<div className="workspace-row-meta">{row.children.length} 项需求 · 尚未分派阶段</div>}</div>
            </div>
            <div className={'workspace-row-track gantt-track gantt-split-track gantt-status-'+(item?.status||'not_started').replaceAll('_','-')} style={track} role="cell">
              {summaries.has(row.id)?<WorkspacePhaseProgress row={row} summary={summaries.get(row.id)!} tooltip={summaryTooltip} dates={nav.dates} cellWidth={nav.cellWidth} onSelect={onSelect}/>:item&&!row.archived?<GanttDateTracks plannedStart={item.plannedStart} plannedEnd={item.plannedEnd} actualStart={actual?.start} actualEnd={actual?.end} status={item.status} progress={item.progress||0} dates={nav.dates} cellWidth={nav.cellWidth} scheduleComplete={w?!!w.plannedStart&&!!w.plannedEnd:r?.scheduleComplete!==false} progressPlacement="end" fillProgress={item.status==='cancelled'?undefined:w?w.progress:item.status==='completed'?100:stage?.stages.length===1?stage.stages[0].progress:undefined} showProgress={false} showScheduleHint={false} stageLabel={w?undefined:stageTitle} forecast={ganttForecast(item.deliveryForecast,item.status,asOfDate)} interactionProps={summaryTooltip.bind(details)}/>:null}
              {!!parts.length&&progress&&<GanttProgressEnd start={actual?.start} end={actual?.end} asOfDate={asOfDate} dates={nav.dates} cellWidth={nav.cellWidth} {...summaryTooltip.bind(details)} onClickCapture={summaryTooltip.close}><div className="workspace-row-progress">{progress}</div></GanttProgressEnd>}
              {latestMilestone&&<LatestGanttMilestone item={latestMilestone} history={rowMilestones} dates={nav.dates} cellWidth={nav.cellWidth} selection={milestoneSelection}/>}
              {today.visible&&<i className="gantt-today-line" style={{left:(today.offset+1)*nav.cellWidth}}/>}
            </div>
            <div className={'workspace-row-actions'+(row.kind==='work'||row.kind==='requirement'?' has-execution':'')} role="cell" data-workspace-zone="tools"><div className="workspace-row-tools">{actions}</div></div>
          </div>;
          if(row.formalWork&&row.formalRequirement&&!row.temporary)return <WorkItemExecution key={row.id} item={row.formalWork} requirement={row.formalRequirement} people={people} progressContent={defaultContent}>{controls=>render({...controls,progress:w?.status==='not_started'?null:controls.progress})}</WorkItemExecution>;
          if(row.formalRequirement&&!row.temporary&&!row.archived)return row.formalRequirement.executionMode==='direct'
            ?<DeliveryControls key={row.id} requirement={row.formalRequirement} progressContent={defaultContent}>{render}</DeliveryControls>
            :<RequirementWorkExecution key={row.id} requirement={row.formalRequirement} people={people} progress={defaultContent}>{render}</RequirementWorkExecution>;
          return <div className="workspace-row-wrapper" key={row.id}>{render({progress:parts.length?defaultContent:null,actions:null})}</div>;
        })}
        {!visible.length&&(empty||<p className="feature-empty">没有符合条件的内容</p>)}
      </div>
    </div>{milestoneSelection.details}{projectMilestoneSelection.details}{summaryTooltip.tooltip}
  </section>;
}
