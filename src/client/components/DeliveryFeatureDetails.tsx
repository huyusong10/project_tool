import { DetailCard } from './DetailCard';
import { ReferenceLinks } from './ReferenceLinks';
import { Button } from './Button';
import { useDeliveryForm } from '../use-delivery-form';
import { useSession } from '../app-context';
import { useProjectWorkspace } from '../project-workspace-context';
import { canManageProject } from '../permissions';
import type { FeatureOverview } from '../../shared/feature-overview';
import { FeatureAssessment, FeatureEditor, readFeaturePending, type FeatureEdit } from './FeaturePlanning';
import { PhaseDialog, PhaseStatusBadge } from './PhasePlanning';
import { readPendingPhase, type PhaseEdit } from '../features/planning/phase-model';
import { ExecutionStageBadge } from './ExecutionStageBadge';
import { DetailWorkspace } from './DetailWorkspace';
import { TopbarMenu } from './TopbarMenu';
import { RequirementForm, readRequirementCreateRecheck, persistRequirementCreateRecheck } from './ManagementForms';
import { useState } from 'react';
import { formatDateTime } from '../format';
import { OverviewIntroduction } from './OverviewIntroduction';

export function DeliveryFeatureDetails({feature,phaseId,onEnter,onPhase}:{feature:FeatureOverview;phaseId?:string|null;onEnter:(stage?:string)=>void;onPhase:()=>void}){
  const {session}=useSession(),account=session.accountId||'guest',workspace=useProjectWorkspace(),manage=canManageProject(session,feature.projectId),system=feature.kind==='other';
  const [edit,setEdit]=useDeliveryForm<FeatureEdit|null>(feature.projectId,(phaseId||feature.id)+':feature-action',()=>manage?readFeaturePending(account,feature.projectId):null);
  const [phaseEdit,setPhaseEdit]=useDeliveryForm<PhaseEdit|null>(feature.projectId,(phaseId||feature.id)+':phase-action',()=>manage?readPendingPhase(account,feature.projectId)?.edit||null:null);
  const [creating,setCreating]=useDeliveryForm(feature.projectId,(phaseId||feature.id)+':create-requirement',()=>false);
  const [recheck,setRecheck]=useState(()=>readRequirementCreateRecheck(account,feature.projectId));
  const phase=feature.phases?.find(p=>p.id===phaseId),phases=phase?[phase]:feature.phases||[];
  const beginPhase=(next:PhaseEdit)=>setPhaseEdit(readPendingPhase(account,feature.projectId)?.edit||next);
  const requirements=phase?phase.requirements:workspace?.data.requirements.filter(r=>r.featureId===feature.id)||[];
  const ids=new Set(requirements.map(r=>r.id));
  const relations=workspace?.data.featureContext?.relations.filter(r=>r.sourceFeatureId===feature.id||r.targetFeatureId===feature.id)||[];
  const external=workspace?.data.dependencies.filter(d=>ids.has(d.targetRequirementId)&&!ids.has(d.sourceRequirementId))||[];
  const editable=manage&&!feature.archivedAt;
  const phaseActions=phase&&editable?<><Button aria-label="编辑 Phase" title="编辑 Phase" variant="secondary" onClick={()=>beginPhase({feature,phase,mode:'edit'})}>编辑 Phase</Button>{!phase.requirements.length&&!phase.deliveries.length&&<TopbarMenu label="Phase 更多操作"><Button variant="menu" tone="danger" onClick={()=>beginPhase({feature,phase,mode:'delete'})}>删除空 Phase</Button></TopbarMenu>}</>:null;
  const childActions=editable?<>{!phase&&!system&&<Button aria-label="新建 Phase" title="新建 Phase" variant="primary" onClick={()=>beginPhase({feature,mode:'edit'})}>新建 Phase</Button>}<Button aria-label="新建需求" title="新建需求" variant="secondary" onClick={()=>setCreating(true)}>新建需求</Button>{!system&&<Button aria-label="移入需求" title="移入需求" variant="secondary" onClick={()=>beginPhase({feature,phase,mode:'placement'})}>移入需求</Button>}</>:null;
  const history=<DetailCard title="交付记录">
    {phases.flatMap(p=>p.deliveries.map(d=><article className="object-history-entry" key={d.id}><h4>{p.name} · {d.deliveredAt} · {d.deliveredByName||'原交付人'}</h4><p>{d.snapshot.scope||d.snapshot.name}</p><ul>{d.snapshot.requirements.map(r=><li key={r.id}>{r.title}</li>)}</ul>{d.reopenedAt&&<p>重新打开：{d.reopenReason}</p>}</article>))}
    {!phases.some(p=>p.deliveries.length)&&<p className="detail-card-empty">尚无交付记录。</p>}
  </DetailCard>;
  const requirementRows=(rows:Array<(typeof requirements)[number]>,empty='尚未安排需求。')=><div className="detail-related-list">{rows.map(r=><article className="object-related-row" key={r.id}><Button variant="link" wrap onClick={()=>workspace?.inspect(r.id)}>{r.title}</Button><ExecutionStageBadge requirement={r}/></article>)}{!rows.length&&<p className="detail-card-empty">{empty}</p>}</div>;
  const phaseRows=<div className="detail-card-list">{phases.map(p=><article className="detail-card-row" key={p.id}>
    <div className="detail-card-row-main"><Button variant="link" wrap onClick={()=>workspace?.inspect('phase:'+p.id)}>{p.name}</Button><span className="detail-card-row-meta">{p.targetDate||'日期待定'} · {p.requirements.length} 项需求</span></div><PhaseStatusBadge phase={p}/>
  </article>)}{!phases.length&&<p className="detail-card-empty">尚未安排 Phase。</p>}</div>;
  const overview=phase?<>
    <OverviewIntroduction links={phase.referenceLinks} title="本阶段做什么" text={phase.scope} empty="尚未填写本阶段范围，可在资料中补充。" secondary={{title:'补充说明',text:phase.note}}/>
    <DetailCard title="交付进展" actions={<PhaseStatusBadge phase={phase}/>}>
      <dl className="object-facts"><div><dt>目标交付</dt><dd>{phase.targetDate||'待定'}</dd></div><div><dt>实际完成</dt><dd>{phase.completedAt||'尚未完成'}</dd></div></dl>
      <div className="phase-distribution">{phase.distribution.map(s=><span key={s.key}>{s.label} {s.count}　</span>)}</div>
      {phase.overdue&&<p className="warning-banner">已超过目标交付日期</p>}
      <p>{phase.requirements.filter(r=>r.status==='completed').length} / {phase.requirements.filter(r=>r.status!=='cancelled').length} 条需求完成</p>
    </DetailCard>
    <DetailCard title="未完成需求">{requirementRows(phase.requirements.filter(r=>!['completed','cancelled'].includes(r.status)),'当前没有未完成需求。')}</DetailCard>
  </>:<>
    <OverviewIntroduction links={feature.referenceLinks} title={system?'归类说明':'目标与范围'} text={system?'临时和补充需求放在这里，明确所属特性后可以移入对应范围。':feature.description} empty="尚未填写特性目标与范围，可在资料中补充。"/>
    <DetailCard title="交付进展" actions={<FeatureAssessment feature={feature}/>} description={feature.assessedAt?'最近评估：'+formatDateTime(feature.assessedAt):undefined}>
      {(feature.overview.expectation||feature.overview.progressSummary||feature.overview.note)&&<dl className="object-facts">
        {feature.overview.expectation&&<div className="object-fact-wide"><dt>当前预期</dt><dd>{feature.overview.expectation}</dd></div>}
        {feature.overview.progressSummary&&<div className="object-fact-wide"><dt>进展简述</dt><dd>{feature.overview.progressSummary}</dd></div>}
        {feature.overview.note&&<div className="object-fact-wide"><dt>评估说明</dt><dd>{feature.overview.note}</dd></div>}
      </dl>}
      <div className="detail-card-stats">{Object.entries({completed:'已完成',inProgress:'进行中',delayed:'延期',unscheduled:'排期不完整'}).map(([key,label])=><div key={key}><strong>{feature.counts[key as keyof FeatureOverview['counts']]}</strong><span>{label}</span></div>)}</div>
    </DetailCard>
    <DetailCard title="交付安排">{phaseRows}</DetailCard>
    <DetailCard title="最近进展"><div className="detail-card-list">{feature.recentUpdates.map(u=><article className="detail-card-update" key={u.id}><header><Button variant="link" wrap onClick={()=>workspace?.inspect(u.requirementId)}>{u.requirementTitle}</Button><time>{formatDateTime(u.createdAt)}</time></header><p>{u.content}</p></article>)}{!feature.recentUpdates.length&&<p className="detail-card-empty">暂无需求进展记录。</p>}</div></DetailCard>
  </>;
  const basic=phase?<>
    <DetailCard title="阶段资料"><dl className="object-facts"><div className="object-fact-wide"><dt>交付范围</dt><dd>{phase.scope||'待明确'}</dd></div><div><dt>目标日期</dt><dd>{phase.targetDate||'待定'}</dd></div><div><dt>所属特性</dt><dd><Button variant="link" wrap onClick={onPhase}>{feature.name}</Button></dd></div><div className="object-fact-wide"><dt>说明</dt><dd>{phase.note||'尚未填写'}</dd></div></dl></DetailCard>
    {!!phase.referenceLinks?.length&&<DetailCard title="参考资料"><ReferenceLinks links={phase.referenceLinks}/></DetailCard>}
  </>:<>
    <DetailCard title={system?'归类说明':'目标与范围'}><p className="feature-full-text">{system?'临时和补充需求的系统归类，固定置底。':feature.description||'尚未填写目标与范围'}</p></DetailCard>
    {!!feature.referenceLinks?.length&&<DetailCard title="参考资料"><ReferenceLinks links={feature.referenceLinks}/></DetailCard>}
  </>;
  const dependencies=<DetailCard title={phase?'外部前置':'特性规划关系'}><div className="detail-card-list">{phase?<>
    {external.map(d=><p key={d.id}><Button variant="link" wrap onClick={()=>workspace?.inspect(d.sourceRequirementId)}>{workspace?.data.requirements.find(r=>r.id===d.sourceRequirementId)?.title||d.sourceRequirementId}</Button> → {requirements.find(r=>r.id===d.targetRequirementId)?.title}</p>)}{!external.length&&<p className="detail-card-empty">当前没有外部前置。</p>}
  </>:<>
    {relations.map(r=>{const id=r.sourceFeatureId===feature.id?r.targetFeatureId:r.sourceFeatureId;return <article className="detail-card-row" key={r.id}><div className="detail-card-row-main"><span className="detail-card-row-meta">{r.targetFeatureId===feature.id?'前置':'后续'}</span><Button variant="link" wrap onClick={()=>workspace?.inspect('feature:'+id)}>{workspace?.data.featureContext?.overview.features.find(f=>f.id===id)?.name||id}</Button>{r.note&&<span className="detail-card-row-meta">{r.note}</span>}</div></article>;})}{!relations.length&&<p className="detail-card-empty">当前没有特性规划关系。</p>}
  </>}</div></DetailCard>;
  return <DetailWorkspace label={phase?'Phase 详情':'特性详情'} initialTab="overview" actions={<>{childActions}{phase?phaseActions:editable&&!system?<Button variant="secondary" onClick={()=>setEdit({mode:"basic",feature})}>编辑特性</Button>:null}</>} tabs={[
    {id:'overview',label:'概况',description:phase?'阶段范围与交付进展':'目标范围与交付安排',actions:!phase&&manage&&!system?<><Button aria-label="更新评估" title="更新评估" variant="secondary" disabled={!!feature.archivedAt} onClick={()=>setEdit({mode:'assessment',feature})}>评估</Button><TopbarMenu label="特性更多操作"><Button variant="menu" onClick={()=>setEdit({mode:feature.archivedAt?'restore':'archive',feature})}>{feature.archivedAt?'恢复特性':'归档特性'}</Button><Button variant="menu" tone="danger" onClick={()=>setEdit({mode:'delete',feature})}>删除空特性</Button></TopbarMenu></>:null,content:overview},
    {id:'children',label:phase?'需求清单':'交付范围',description:phase?`${requirements.length} 项需求`:'Phase 与需求安排',content:phase?<DetailCard title="需求清单">{requirementRows(requirements)}</DetailCard>:<><DetailCard title="Phase 安排">{phaseRows}</DetailCard>{!!requirements.filter(r=>!r.phaseId).length&&<DetailCard title="未分派阶段">{requirementRows(requirements.filter(r=>!r.phaseId))}</DetailCard>}</>},
    {id:'basic',label:'资料',content:basic},
    {id:'dependencies',label:'依赖',actions:<Button aria-label="在关系图中查看" title="在关系图中查看" variant="secondary" onClick={()=>workspace?workspace.switchView('graph',phase?'phase:'+phase.id:'feature:'+feature.id):onEnter()}>查看依赖</Button>,content:dependencies},
    {id:'history',label:'记录',content:history},
  ]}>
    {edit&&<FeatureEditor projectId={feature.projectId} edit={edit} onClose={()=>setEdit(null)}/>}
    {phaseEdit&&<PhaseDialog key={(phaseEdit.phase?.id||phaseEdit.feature.id)+phaseEdit.mode} edit={phaseEdit} onClose={()=>setPhaseEdit(null)}/>}
    {(creating||recheck)&&<RequirementForm projectId={feature.projectId} defaultFeatureId={feature.id} defaultPhaseId={phase?.id} initialRequirementIds={workspace?.data.requirements.map(r=>r.id)||[]} recheck={recheck} onRecheckChange={value=>{setRecheck(value);persistRequirementCreateRecheck(account,feature.projectId,value);}} onClose={()=>setCreating(false)}/>}
  </DetailWorkspace>;
}
