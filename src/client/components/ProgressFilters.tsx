import { Button } from './Button';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { requirementStatuses, requirementStatusLabels, riskLabels } from '../../shared/domain';
import { dashboardScopeLabels } from '../../shared/dashboard';
import type { FeatureOverview } from '../../shared/feature-overview';
import type { Person } from '../types';
import type { RowFilters } from '../workspace-rows';
import { progressStatePresets, selectedProgressStates, progressStatesValue, progressStatesLabel } from '../progress-filters';
import { AnchoredPopover } from './inline-edit/popover';
import { SearchInput } from './SearchInput';
import { Select } from './Select';

type Props={filters:RowFilters;sort:string;features:FeatureOverview[];people:Person[];result:string;contextFeatureId?:string;phaseLocked?:boolean;onChange:(values:Record<string,string>)=>void;onReset:()=>void};
const stages:Record<string,string>={not_started:'未开始',analysis:'分析／设计',development:'开发',integration:'联调',test_submitted:'已提测',testing:'测试',parallel:'并行推进',completed:'已完成',cancelled:'已取消'};
const schedules:Record<string,string>={delayed:'已延期',unplanned:'未排期或日期不完整',planned:'已排期'};
export function ProgressFilters({filters,sort,features,people,result,contextFeatureId,phaseLocked,onChange,onReset}:Props){
  const [open,setOpen]=useState<'status'|'more'|null>(null),statusRef=useRef<HTMLButtonElement>(null),moreRef=useRef<HTMLButtonElement>(null);
  const panelRef=useRef<HTMLElement>(null);
  useEffect(()=>{
    if(!open)return;
    const frame=requestAnimationFrame(()=>{
      const panel=panelRef.current;
      if(panel&&!panel.contains(document.activeElement))panel.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
    });
    return()=>cancelAnimationFrame(frame);
  },[open]);
  const states=selectedProgressStates(filters.status||''),feature=features.find(f=>f.id===(contextFeatureId||filters.featureId));
  const moreCount=[filters.phaseId,filters.stage,filters.state==='archived'&&!contextFeatureId,filters.schedule,filters.risk,filters.scope].filter(Boolean).length;
  const dirty=!!(filters.query||filters.featureId||filters.status||filters.person||moreCount);
  const set=(name:string,value:string)=>onChange({[name]:value});
  const close=()=>setOpen(null);
  const closeAndFocus=()=>{close();(open==='status'?statusRef:moreRef).current?.focus({preventScroll:true});};
  const panelKeyDown=(event:KeyboardEvent)=>{
    if(event.key!=='Escape'||event.defaultPrevented||event.nativeEvent.isComposing||event.nativeEvent.keyCode===229)return;
    event.preventDefault();event.stopPropagation();closeAndFocus();
  };
  const moreTitle=[filters.phaseId==='unassigned'?'未分派阶段':features.flatMap(f=>f.phases||[]).find(p=>p.id===filters.phaseId)?.name,stages[filters.stage],filters.state==='archived'?'已归档特性':'',schedules[filters.schedule||''],({...riskLabels,pending:'待评估'} as Record<string,string>)[filters.risk||''],(dashboardScopeLabels as Record<string,string>)[filters.scope||'']].filter(Boolean).join(' · ');
  return <div className="workspace-progress-tools" data-workspace-zone="tools" aria-label="进展筛选" onFocusCapture={event=>{
    if(event.currentTarget.contains(event.target))event.target.scrollIntoView({block:'nearest',inline:'nearest'});
  }}>
    <SearchInput value={filters.query} onChange={v=>set('q',v)} placeholder="搜索名称或编号"/>
    <Button variant="field" width="filter" ref={statusRef} className="ghost-button progress-status-filter" aria-label="筛选执行状态" aria-haspopup="dialog" aria-expanded={open==='status'} title={states.map(s=>requirementStatusLabels[s]).join('、')||'不显示任何执行状态'} onClick={()=>setOpen(open==='status'?null:'status')}><span>{progressStatesLabel(filters.status||'')}</span><ChevronDown size={15}/></Button>
    <Select aria-label="进展人员" value={filters.person||''} onChange={e=>set('progressPerson',e.target.value)}><option value="">全部人员</option><option value="unassigned">未分派负责人</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select>
    {!contextFeatureId&&<Select aria-label="进展特性" value={filters.featureId} onChange={e=>onChange({featureId:e.target.value,phaseId:''})}><option value="">全部特性</option>{features.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</Select>}
    <Button variant="secondary" ref={moreRef} className="ghost-button progress-more-filter" aria-haspopup="dialog" aria-expanded={open==='more'} title={moreTitle||'Phase、阶段、计划与排序'} onClick={()=>setOpen(open==='more'?null:'more')}><SlidersHorizontal size={15}/>更多筛选{moreCount>0&&<span>{moreCount}</span>}</Button>
    <Button variant="secondary" className="ghost-button progress-reset" disabled={!dirty} onClick={onReset}>重置</Button>
    <span className="progress-filter-result" aria-live="polite">{result}</span>
    <AnchoredPopover anchorRef={statusRef} open={open==='status'} onOutside={close} onEscape={closeAndFocus} width={300} className="progress-filter-popover">
      <section ref={panelRef} onKeyDown={panelKeyDown} aria-label="执行状态筛选" data-workspace-zone="tools" data-preserve-edit>
        <header><strong>查看哪些工作</strong><Button variant="secondary" className="ghost-button" onClick={closeAndFocus}>关闭</Button></header>
        <div className="progress-filter-presets">{progressStatePresets.map(p=><Button variant="secondary" key={p.label} type="button" aria-pressed={progressStatesValue(states)===p.value} onClick={()=>{set('progressStatus',p.value);closeAndFocus();}}><span>{p.label}</span><small>{p.description}</small></Button>)}</div>
        <fieldset><legend>自选状态（可多选）</legend><div className="progress-state-options">{requirementStatuses.map(state=><label key={state}><input type="checkbox" checked={states.includes(state)} onChange={e=>set('progressStatus',progressStatesValue(e.target.checked?[...states,state]:states.filter(s=>s!==state)))}/>{requirementStatusLabels[state]}</label>)}</div></fieldset>
        <p>按需求和工作项各自的状态筛选，保留所属层级。</p>
      </section>
    </AnchoredPopover>
    <AnchoredPopover anchorRef={moreRef} open={open==='more'} onOutside={close} onEscape={closeAndFocus} width={360} className="progress-filter-popover">
      <section ref={panelRef} onKeyDown={panelKeyDown} aria-label="更多进展筛选" data-workspace-zone="tools" data-preserve-edit>
        <header><strong>更多筛选</strong><Button variant="secondary" className="ghost-button" onClick={closeAndFocus}>关闭</Button></header>
        <div className="progress-extra-fields">
          {!phaseLocked&&<label><span>交付 Phase</span><Select disabled={!feature&&!filters.phaseId} aria-label="进展 Phase" value={filters.phaseId} onChange={e=>set('phaseId',e.target.value)}><option value="">全部 Phase</option>{(feature?.phases||features.flatMap(f=>f.phases||[])).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}<option value="unassigned">未分派 Phase</option></Select>{!feature&&<small>先选择特性</small>}</label>}
          <label><span>工作阶段</span><Select aria-label="进展阶段" value={filters.stage} onChange={e=>set('progressStage',e.target.value)}><option value="">全部工作阶段</option>{Object.entries(stages).map(([id,label])=><option key={id} value={id}>{label}</option>)}</Select></label>
          <label><span>计划</span><Select aria-label="进展计划" value={filters.schedule||''} onChange={e=>set('progressSchedule',e.target.value)}><option value="">全部计划</option><option value="delayed">已延期</option><option value="unplanned">未排期或日期不完整</option><option value="planned">已排期</option></Select></label>
          {!contextFeatureId&&<label><span>特性</span><Select aria-label="进展特性状态" value={filters.state} onChange={e=>set('progressState',e.target.value)}><option value="active">当前特性</option><option value="archived">已归档特性</option></Select></label>}
          <label><span>排列</span><Select aria-label="进展排序" value={sort} onChange={e=>set('progressSort',e.target.value)}><option value="manual">人工顺序</option><option value="name">需求名称／编号顺序</option><option value="feature">特性名称顺序</option></Select></label>
          <label><span>风险</span><Select aria-label="进展风险" value={filters.risk||''} onChange={e=>set('progressRisk',e.target.value)}><option value="">全部风险</option>{Object.entries({...riskLabels,pending:'待评估'}).map(([id,label])=><option key={id} value={id}>{label}</option>)}</Select></label>
          <label><span>时间</span><Select aria-label="进展时间范围" value={filters.scope||''} onChange={e=>set('progressScope',e.target.value)}><option value="">不限时间</option>{Object.entries(dashboardScopeLabels).filter(([id])=>['due_soon','recent_completed','recent_created'].includes(id)||filters.scope===id).map(([id,label])=><option key={id} value={id}>{label}</option>)}</Select></label>
        </div>
        <p>状态、人员按每条工作匹配。排序不会改动 Phase 批次和工作项的流程顺序。</p>
      </section>
    </AnchoredPopover>
  </div>;
}
