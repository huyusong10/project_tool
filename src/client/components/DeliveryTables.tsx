import { Button } from './Button';
import { useProjectWorkspace } from '../project-workspace-context';
import { Select } from './Select';
import { useRef, useState } from 'react';
import type { PathAnalysis } from '../../shared/paths';
import type { FeatureOverview } from '../../shared/feature-overview';
import type { PhaseSummary } from '../../shared/feature-phases';
import { phaseStatusLabels } from '../../shared/feature-phases';
import type { GraphCard } from '../path-projection';
import { PhaseStatusBadge } from './PhasePlanning';

import { SearchInput } from './SearchInput';
import { matchesSearch } from '../../shared/search';
import '../delivery-workspace.css';
import { AnchoredPopover } from './inline-edit/popover';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { workStageLabels } from '../../shared/execution-stage';

export function matchesDeliveryFeature(f:FeatureOverview,p:URLSearchParams){
  return (p.get('state')==='archived'?!!f.archivedAt:!f.archivedAt)&&matchesSearch([{text:f.name,weight:100},{text:f.description}],p.get('q')||'')&&(!(p.get('phaseStatus')||p.get('from')||p.get('through'))||f.phases?.some(phase=>(!p.get('phaseStatus')||phase.status===p.get('phaseStatus'))&&(!p.get('from')||!!phase.targetDate&&phase.targetDate>=p.get('from')!)&&(!p.get('through')||!!phase.targetDate&&phase.targetDate<=p.get('through')!)));
}
export function matchesDeliveryCard(c:GraphCard,data:PathAnalysis,p:URLSearchParams){
  const r=data.requirements.find(r=>r.id===c.requirementId),phase=p.get('phaseId'),stage=p.get('stage'),workStage=p.get('workStage');
  return matchesSearch([{text:c.title,weight:100},{text:r?.title||''}],p.get('q')||'')&&(!phase||p.get('view')==='requirement'||(r?.phaseId||'unassigned')===phase)&&(!workStage||c.workStage===workStage||workStage==='unclassified'&&!c.workStage)&&(!stage||p.get('view')==='requirement'||c.executionStage?.key===stage||r?.executionStage?.key===stage);
}
export function DeliveryFilters({params,setParam,feature,features=false,workItems=false,children}:{params:URLSearchParams;setParam:(key:string,value:string)=>void;feature?:FeatureOverview;features?:boolean;workItems?:boolean;children?:React.ReactNode}){
  const workspace=useProjectWorkspace();
  const dateAnchor=useRef<HTMLButtonElement>(null),[datesOpen,setDatesOpen]=useState(false);
  return <div className="delivery-filters" aria-label="范围筛选" data-workspace-zone="tools" data-preserve-edit>
    <SearchInput value={params.get('q')||''} onChange={v=>setParam('q',v)} placeholder={features?'搜索特性与目标':workItems?'搜索工作项与里程碑':'搜索需求'}/>
    {features?<>
      <Select aria-label="特性状态" value={params.get('state')||'active'} onChange={e=>setParam('state',e.target.value)}><option value="active">当前特性</option><option value="archived">已归档</option></Select>
      <Select aria-label="Phase 状态筛选" value={params.get('phaseStatus')||''} onChange={e=>setParam('phaseStatus',e.target.value)}><option value="">全部交付状态</option>{Object.entries(phaseStatusLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</Select>
      <Button variant="field" width="filter" ref={dateAnchor} type="button" className="ghost-button delivery-date-filter" aria-expanded={datesOpen} onClick={()=>setDatesOpen(v=>!v)}><CalendarDays size={15}/><span title={(params.get("from")||"不限")+" — "+(params.get("through")||"不限")}>{params.get('from')||params.get('through')?(params.get('from')||'不限')+' — '+(params.get('through')||'不限'):'目标交付日期'}</span><ChevronDown size={14}/></Button>
      <AnchoredPopover anchorRef={dateAnchor} open={datesOpen} onOutside={()=>setDatesOpen(false)} onEscape={()=>setDatesOpen(false)} width={300} className="delivery-date-popover">
        <label className="field"><span>开始日期</span><input type="date" aria-label="目标日期从" value={params.get('from')||''} onChange={e=>setParam('from',e.target.value)}/></label>
        <label className="field"><span>结束日期</span><input type="date" aria-label="目标日期至" value={params.get('through')||''} onChange={e=>setParam('through',e.target.value)}/></label>
        <Button variant="secondary" type="button" className="ghost-button" onClick={()=>{setParam('from','');setParam('through','');setDatesOpen(false);}}>清除日期</Button>
      </AnchoredPopover>
    </>:workItems?<Select aria-label="工作阶段筛选" value={params.get('workStage')||''} onChange={e=>setParam('workStage',e.target.value)}><option value="">全部工作阶段</option>{Object.entries(workStageLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}<option value="unclassified">未分类</option></Select>:<Select aria-label="需求阶段筛选" value={params.get('stage')||''} onChange={e=>setParam('stage',e.target.value)}><option value="">全部阶段</option>{Object.entries({not_started:'未开始',analysis:'分析／设计',development:'开发',integration:'联调',test_submitted:'已提测',test_ready:'提测就绪',testing:'测试',parallel:'并行推进',completed:'已完成',cancelled:'已取消'}).map(([id,label])=><option key={id} value={id}>{label}</option>)}</Select>}
    {feature&&!workspace&&<Select aria-label="Phase 筛选" value={params.get('phaseId')||''} onChange={e=>setParam('phaseId',e.target.value)}><option value="">全部 Phase</option>{feature.phases?.map(phase=><option key={phase.id} value={phase.id}>{phase.name}</option>)}<option value="unassigned">未分派阶段</option></Select>}
    <div className="delivery-filter-actions">{children}</div>
  </div>;
}
export function PhaseChip({phase,selected,onClick}:{phase:PhaseSummary;selected?:boolean;onClick:()=>void}){return <button className="delivery-phase-chip nodrag nopan" aria-pressed={!!selected} onClick={e=>{e.stopPropagation();onClick();}} title={phase.scope||'交付范围待明确'}><span className="delivery-phase-name">{phase.name}</span><PhaseStatusBadge phase={phase}/>{phase.overdue&&<span className="danger-text">逾期</span>}</button>;}
