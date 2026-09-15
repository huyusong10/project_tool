import {WorkspaceObjectMark} from './WorkspaceObjectMark';
import type {PathEdge,PathMilestone} from '../../shared/paths';
import {requirementMilestones} from '../gantt-milestones';
import {GanttMilestoneRail,GanttMilestoneUndated,useMilestoneSelection} from './GanttMilestones';
import {useEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import {ChevronDown,ChevronRight,ArrowUpRight} from 'lucide-react';
import {workStageLabels} from '../../shared/execution-stage';
import {phaseStatusLabels} from '../../shared/feature-phases';
import {flattenWorkspaceRows,type WorkspaceRow} from '../workspace-rows';
import type {Person} from '../types';
import {useGanttNavigation} from '../use-gantt-navigation';
import {GanttNavigation} from './GanttNavigation';
import {GanttDateTracks} from './GanttDateTracks';
import {GanttScale,ganttTodayPosition,ganttTrackStyle,ganttInterval,businessDateIndex,toGanttDate} from './GanttTimeline';
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

type Props={milestones?:PathMilestone[];edges?:PathEdge[];rows:WorkspaceRow[];people:Person[];storageKey:string;asOfDate:string;selected:string;onSelect:(row:WorkspaceRow)=>void;onEnter?:(row:WorkspaceRow)=>void;filterKey?:string;filtered?:boolean};
const expands=(row:WorkspaceRow,expanded:Record<string,boolean>)=>expanded[row.id]??['feature','phase'].includes(row.kind);
export function WorkspaceGantt({rows,people,storageKey,asOfDate,selected,onSelect,onEnter,filtered=false,filterKey="",milestones,edges}:Props){
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
        <div className={"workspace-gantt-heading"+(projectMilestones.some(m=>m.targetDate||m.actualDate)?" has-project-milestones":"")}><div className="workspace-row-label" data-gantt-fixed><span>名称 / 负责人</span><GanttMilestoneUndated compact items={projectMilestones} selection={projectMilestoneSelection}/></div><div className="workspace-date-heading"><GanttScale groupedDays dates={nav.dates} cellWidth={nav.cellWidth} zoom={nav.zoom} todayOffset={today.offset} todayVisible={today.visible}/>{projectMilestones.some(m=>m.targetDate||m.actualDate)&&<GanttMilestoneRail items={projectMilestones} dates={nav.dates} cellWidth={nav.cellWidth} asOfDate={asOfDate} selection={projectMilestoneSelection}/>}</div><div className="workspace-row-actions" data-gantt-fixed>操作</div></div>
        {visible.map(({row,depth})=>{
          const rowMilestones=milestoneRows.get(row.id)||[];
          const r=row.requirement,w=row.work,item=w||r,stage=r?executionStageOf(r):null;
          const actual=w?workItemActualRange(w,asOfDate):r&&!row.archived?requirementActualRange(r,asOfDate):null;
          const stageLabel=stage?stage.label+(stage.stages.length===1?' · '+stage.stages[0].progress+'%':''):'';
          const stageTitle=stage&&stage.stages.length>1?stageLabel+'；'+stage.stages.map(s=>s.label+' '+s.progress+'%').join(' · '):stageLabel;
          const actualTrack=ganttInterval(actual?.start,actual?.end,nav.dates,nav.cellWidth);
          const planTrack=ganttInterval(item?.plannedStart,item?.plannedEnd,nav.dates,nav.cellWidth);
          const progressAnchor=actualTrack?.right??planTrack?.left??0;
          const scheduleNote=item&&!row.archived?(!item.plannedStart&&!item.plannedEnd?(['completed','cancelled'].includes(item.status)?'未记录计划':'待排期'):!item.plannedStart||!item.plannedEnd||!w&&r?.scheduleComplete===false?'排期不完整':''):row.archived?'保留交付贡献':row.phase&&!row.phase.targetDate&&!row.phase.deliveredAt?'交付日期待定':'';
          const summary=row.kind==='feature'?row.feature?.description:row.kind==='phase'?row.phase?.scope||'范围待明确':w?(w.workStage?workStageLabels[w.workStage]:'未分类'):stageLabel;
          const defaultProgress=row.phase?'':w?(({not_started:'未开始',completed:'已完成',cancelled:'已取消'} as Record<string,string>)[w.status]??w.progress+'%'):stageLabel;
          const defaultContent=stage&&!w?<span className={"workspace-stage-summary"+(stage.stages.length>1?" is-parallel":"")}>{stage.stages.length>1?<><span className="workspace-parallel-caption">并行</span>{stage.stages.map(s=><span key={s.stage}>{s.label} <strong>{s.progress}%</strong></span>)}</>:<>{stage.label}{stage.stages.length===1&&<> · <strong>{stage.stages[0].progress}%</strong></>}</>}</span>:<span className="workspace-stage-summary">{defaultProgress}</span>;
          const rowOpen=expands(row,currentExpanded);
          const toggleRow=()=>changeExpanded({...currentExpanded,[row.id]:!rowOpen});
          const render=({progress,actions}:ExecutionControls)=><div className={'workspace-gantt-row kind-'+row.kind+(rowMilestones.some(m=>m.targetDate||m.actualDate)?' has-milestones':'')+(row.filterContext?' is-filter-context':'')+(row.archived?' is-archived':'')+(r?.executionMode==='direct'?' is-direct':'')} role="row" data-object-kind={row.feature?.kind==='other'?'group':row.kind} onClick={e=>{if(!(e.target as Element).closest('button,input,a,select'))onSelect(row);}} data-row-id={row.id} data-status={row.phase?.status||item?.status} aria-level={depth+1} aria-selected={selected===row.id}>
            <div className="workspace-row-label" role="rowheader" style={{paddingLeft:8+Math.min(depth,2)*10}}>
              <span className="workspace-disclosure">{!!row.children.length&&<button aria-label={'展开 '+row.title} aria-expanded={rowOpen} onClick={toggleRow}>{rowOpen?<ChevronDown size={14}/>:<ChevronRight size={14}/>}</button>}</span>
              <WorkspaceObjectMark kind={row.feature?.kind==='other'?'group':row.kind} status={w?.status}/><div className="workspace-name-content"><div className="workspace-name-heading"><button className="workspace-row-title" title={item?undefined:row.title+(summary?' · '+summary:'')} {...(item?summaryTooltip.bind(<WorkspaceGanttSummary row={row} asOfDate={asOfDate}/>):{})} onClick={()=>{summaryTooltip.close();onSelect(row);}}><strong>{row.title}</strong>{row.archived&&<small>已归档</small>}{row.temporary&&<small>未保存</small>}</button>{onEnter&&row.kind!=='work'&&<button className="workspace-enter workspace-icon-button" title="进入下一级" aria-label={'进入'+row.title} onClick={()=>onEnter(row)}><ArrowUpRight size={14}/></button>}</div>{item&&<div className="workspace-row-meta"><span className="workspace-row-owner" title={item.ownerName||'未分派负责人'}>{item.ownerName||'未分派'}</span><GanttMilestoneUndated compact items={rowMilestones} selection={milestoneSelection}/></div>}{row.phase&&<div className="workspace-row-meta" title={phaseStatusLabels[row.phase.status]+' · '+row.phase.requirements.length+' 项需求'}>{phaseStatusLabels[row.phase.status]} · {row.phase.requirements.length} 项需求</div>}</div>
            </div>
            <div className={'workspace-row-track gantt-track gantt-split-track gantt-status-'+(item?.status||'not_started').replaceAll('_','-')} style={track} role="cell">
              {row.phase?<>{datePoint(row,row.phase.targetDate,'目标')}{datePoint(row,row.phase.deliveredAt,'交付',true)}</>:item&&!row.archived?<GanttDateTracks plannedStart={item.plannedStart} plannedEnd={item.plannedEnd} actualStart={actual?.start} actualEnd={actual?.end} status={item.status} progress={item.progress||0} dates={nav.dates} cellWidth={nav.cellWidth} scheduleComplete={w?!!w.plannedStart&&!!w.plannedEnd:r?.scheduleComplete!==false} progressPlacement="inside" showProgress={false} stageLabel={w?undefined:stageTitle} forecast={ganttForecast(item.deliveryForecast,item.status,asOfDate)} interactionProps={summaryTooltip.bind(<WorkspaceGanttSummary row={row} asOfDate={asOfDate}/>)}/>:null}
              {(progress||scheduleNote)&&<div className="workspace-progress-window" style={{'--progress-anchor':progressAnchor+'px'} as CSSProperties}><span className="workspace-progress-spacer"/><div className="workspace-row-progress" title={[w?defaultProgress:stageTitle||defaultProgress,scheduleNote,r?.delayed&&!w?'延期':''].filter(Boolean).join(' · ')}>{progress}{scheduleNote&&<small>{scheduleNote}</small>}{r?.delayed&&!w&&<small className="danger-text">延期</small>}</div></div>}
              {!!rowMilestones.length&&<GanttMilestoneRail items={rowMilestones} dates={nav.dates} cellWidth={nav.cellWidth} asOfDate={asOfDate} selection={milestoneSelection} inline/>}
              {today.visible&&<i className="gantt-today-line" style={{left:(today.offset+1)*nav.cellWidth}}/>}
            </div>
            <div className={'workspace-row-actions'+(row.kind==='work'||row.kind==='requirement'?' has-execution':'')} role="cell" data-workspace-zone="tools"><div className="workspace-row-tools">{actions}</div></div>
          </div>;
          if(row.formalWork&&row.formalRequirement&&!row.temporary)return <WorkItemExecution key={row.id} item={row.formalWork} requirement={row.formalRequirement} people={people}>{render}</WorkItemExecution>;
          if(row.formalRequirement&&!row.temporary&&!row.archived)return row.formalRequirement.executionMode==='direct'
            ?<DeliveryControls key={row.id} requirement={row.formalRequirement}>{render}</DeliveryControls>
            :<RequirementWorkExecution key={row.id} requirement={row.formalRequirement} people={people} progress={defaultContent}>{render}</RequirementWorkExecution>;
          return <div className="workspace-row-wrapper" key={row.id}>{render({progress:defaultProgress?defaultContent:null,actions:null})}</div>;
        })}
        {!visible.length&&<p className="feature-empty">没有符合条件的内容</p>}
      </div>
    </div>{milestoneSelection.details}{projectMilestoneSelection.details}{summaryTooltip.tooltip}
  </section>;
}
