import {useState} from 'react';
import {useSession} from '../app-context';
import {canManageProject} from '../permissions';
import type {FeatureOverview} from '../../shared/feature-overview';
import {FeatureDetails,FeatureEditor,readFeaturePending,type FeatureEdit} from './FeaturePlanning';
import {PhaseDialog,PhaseRows,PhaseStatusBadge,readPendingPhase,type PhaseEdit} from './PhasePlanning';
import {ExecutionStageBadge} from './ExecutionStageBadge';

export function DeliveryFeatureDetails({feature,phaseId,onEnter,onPhase}:{feature:FeatureOverview;phaseId?:string|null;onEnter:(stage?:string)=>void;onPhase:()=>void}){
  const {session}=useSession(),account=session.accountId||'guest',manage=canManageProject(session,feature.projectId);
  const [edit,setEdit]=useState<FeatureEdit|null>(()=>readFeaturePending(account,feature.projectId)),[phaseEdit,setPhaseEdit]=useState<PhaseEdit|null>(()=>readPendingPhase(account,feature.projectId)?.edit||null);
  const phase=feature.phases?.find(p=>p.id===phaseId),beginPhase=(e:PhaseEdit)=>setPhaseEdit(readPendingPhase(account,feature.projectId)?.edit||e);
  return <div className="delivery-object-details">
    {phase?<>
      <div className="delivery-phase-heading"><h3>{phase.name}</h3><PhaseStatusBadge phase={phase}/><button className="ghost-button" onClick={onPhase}>特性资料</button></div>
      <section className="object-section">
        <dl className="object-facts">
          <div className="object-fact-wide"><dt>交付范围</dt><dd>{phase.scope||'交付范围待明确'}</dd></div>
          <div><dt>目标交付</dt><dd>{phase.targetDate||'待定'}</dd></div>
          <div><dt>实际交付</dt><dd>{phase.deliveredAt||'尚未交付'}</dd></div>
          <div><dt>关联需求</dt><dd>{phase.requirements.length} 项</dd></div>
        </dl>
        {(phase.note||phase.overdue)&&<p className="object-info-note">{phase.overdue?'已超过目标日期。':''}{phase.note}</p>}
        {!!phase.distribution.length&&<div className="button-row">{phase.distribution.map(s=><button key={s.key} className="ghost-button" onClick={()=>onEnter(s.key)}>{s.label} {s.count}</button>)}</div>}
      </section>
      <div className="button-row">
        <button className="primary-button" onClick={()=>onEnter()}>进入需求</button>
        {manage&&!feature.archivedAt&&<>
          <button className="ghost-button" onClick={()=>beginPhase({feature,phase,mode:phase.deliveredAt?'reopen':'edit'})}>{phase.deliveredAt?'重新打开':'编辑 Phase'}</button>
          {!phase.deliveredAt&&<button className="ghost-button" onClick={()=>beginPhase({feature,phase,mode:'placement'})}>安排需求</button>}
          {phase.status==='ready'&&<button className="primary-button" onClick={()=>beginPhase({feature,phase,mode:'deliver'})}>确认交付</button>}
          {!phase.requirements.length&&!phase.deliveries.length&&<button className="ghost-button danger-text" onClick={()=>beginPhase({feature,phase,mode:'delete'})}>删除空 Phase</button>}
        </>}
      </div>
      <details className="object-section"><summary>关联需求 · {phase.requirements.length}</summary>
        {phase.requirements.map(r=><div className="object-related-row" key={r.id}><span>{r.title}{r.deletedAt&&<small> · 已归档</small>}</span><ExecutionStageBadge requirement={r}/></div>)}
        {!phase.requirements.length&&<p>尚未安排需求。</p>}
      </details>
      <details className="object-section"><summary>交付历史 · {phase.deliveries.length}</summary>
        {phase.deliveries.map(d=><article className="object-history-entry" key={d.id}>
          <h4>{d.deliveredAt} · {d.deliveredByName||'原交付人'}</h4><p>{d.snapshot.scope||d.snapshot.name}</p>
          <ul>{d.snapshot.requirements.map(r=><li key={r.id}>{r.title}</li>)}</ul>{d.reopenedAt&&<p>重新打开：{d.reopenReason}</p>}
        </article>)}
        {!phase.deliveries.length&&<p>尚无交付记录。</p>}
      </details>
    </>:feature.kind==='other'?<><p>临时和补充需求的系统归类，固定显示在最后。</p>{!!feature.phases?.length&&<PhaseRows feature={feature} manage={manage} onEdit={beginPhase}/>}</>:<FeatureDetails onEnter={()=>onEnter()} feature={feature} projectId={feature.projectId} edit={edit?.feature?.id===feature.id?edit:null} onEdit={setEdit} onPhaseEdit={beginPhase}/>}
    {edit&&!edit.feature&&<FeatureEditor projectId={feature.projectId} edit={edit} onClose={()=>setEdit(null)}/>}
    {phaseEdit&&<PhaseDialog key={(phaseEdit.phase?.id||phaseEdit.feature.id)+phaseEdit.mode} edit={phaseEdit} onClose={()=>setPhaseEdit(null)}/>}
  </div>;
}
