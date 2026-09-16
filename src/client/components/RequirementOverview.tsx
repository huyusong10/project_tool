import { Button } from './Button';
import { useRef, useState } from 'react';
import { Info } from 'lucide-react';
import type { Requirement } from '../types';
import { formatDateTime } from '../format';
import { requirementRiskDisplay, requirementVarianceDisplay, requirementDeliveryDate, requirementScheduleSummary } from '../requirement-presentation';
import { useProjectWorkspace } from '../project-workspace-context';
import { DeliveryControls } from './DeliveryControls';
import { ExecutionStageBadge } from './ExecutionStageBadge';
import { TestSubmissionButton } from './TestSubmissionButton';
import { AnchoredPopover } from './InlineEdit';
import { OverviewIntroduction } from './OverviewIntroduction';

export function RequirementOverview({ requirement: r, compact=false }: { requirement: Requirement; compact?:boolean }) {
  const workspace = useProjectWorkspace();
  const [details, setDetails] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const closeDetails = () => { setDetails(false); anchor.current?.focus(); };
  const risk = requirementRiskDisplay(r), variance = requirementVarianceDisplay(r);
  const deliveryDate=requirementDeliveryDate(r);
  const direct = r.executionMode === 'direct';
  const schedule = requirementScheduleSummary(r);
  const plannedLabel = r.scheduleComplete === false || r.plannedProgress === null ? schedule.label : `计划 ${r.plannedProgress}%`;
  const progressHint = `${plannedLabel} · ${direct ? '直接记录完成度' : '自动按工期加权'}`;
  return <section className={"requirement-overview"+(compact?" is-compact":"")} aria-label="需求概览">
    <OverviewIntroduction links={r.referenceLinks} legacy={r.referenceUrl} title="需求说明" text={r.background} empty="尚未填写需求说明，可在资料中补充。" secondary={{title:'完成标准',text:r.acceptanceCriteria}}/>
    <h3 className="overview-section-heading">执行进展</h3>
    <div className="requirement-overview-top">
      <div className="requirement-overview-meta">
        <ExecutionStageBadge requirement={r} />
        {!compact&&<span className="requirement-overview-owner" title={`需求负责人：${r.ownerName || '待指定'}`}>负责人 <strong>{r.ownerName || '待指定'}</strong></span>}
      </div>
      <div className="requirement-overview-actions">
        <DeliveryControls requirement={r} /><TestSubmissionButton requirement={r} />
        {!compact&&<Button variant="ghost" iconOnly ref={anchor} className="icon-button" title="进度计算说明" aria-label="需求资料与计算说明" aria-expanded={details} onClick={() => setDetails(v => !v)}><Info size={15} /></Button>}
      </div>
    </div>
    {compact?<dl className="object-facts">
      <div><dt>负责人</dt><dd>{r.ownerName||'待指定'}</dd></div>
      <div><dt>交付安排</dt><dd>{r.featureName||'未关联特性'} / {r.phaseName||'未分派阶段'}</dd></div>
      <div><dt>{r.splitAt?'计划基线':'计划日期'}</dt><dd title={r.splitAt?'保留拆分前的需求计划；各工作项的日期在“工作项”中安排':undefined}>{r.plannedStart||'待定'} ～ {r.plannedEnd||'待定'}</dd></div>
      <div><dt>{deliveryDate.label}</dt><dd title={deliveryDate.help}>{deliveryDate.value}</dd></div>
      <div><dt>偏差</dt><dd title={variance.title}>{variance.label}</dd></div>
      <div><dt>风险</dt><dd title={r.riskReason}>{risk.label}</dd></div>
    </dl>:<div className="detail-kpis">
      <article><span>交付安排</span><strong style={{fontSize:16}}>{r.phaseName || "未分派阶段"}</strong><small>{r.featureName || "未关联特性"}</small></article>
      <article title={deliveryDate.help+"；当前计划："+(r.plannedStart||"待排期")+" → "+(r.plannedEnd||"待排期")}><span>{deliveryDate.label}</span><strong>{deliveryDate.value}</strong></article>
      <article title={variance.title}><span>偏差</span><strong className={variance.className}>{variance.label}</strong></article>
      <article title={r.riskReason}><span>风险</span><span className={`risk-badge ${risk.className}`}>{risk.label}</span></article>
    </div>}
    {!!schedule.gaps.length&&<section className="schedule-gaps" aria-label="待补全的排期">
      <header><strong>{schedule.label}</strong>{workspace&&<Button size="compact" variant="secondary" aria-label={r.status==='completed'?'查看缺失的计划日期':'安排缺失的计划日期'} onClick={()=>workspace.inspect(r.id,direct?'basic':'work')}>{r.status==='completed'?'查看':'排期'}</Button>}</header>
      <p>{r.status==='completed'?'历史计划日期缺失，无法计算完整的计划偏差。':'补齐以下日期后，才能估算整体完成时间与计划偏差。'}</p>
      <ul>{schedule.gaps.map(item=><li key={item.id}>{item.title}：缺少{item.missing.join('、')}</li>)}</ul>
    </section>}
    <AnchoredPopover anchorRef={anchor} open={details} onOutside={() => setDetails(false)} onEscape={closeDetails} width={420} className="requirement-overview-details">
      <header><strong>需求资料与计算说明</strong><Button variant="secondary" className="ghost-button" onClick={closeDetails}>关闭</Button></header>
      <dl>
        <div><dt>需求负责人</dt><dd>{r.ownerName || '待指定'}</dd></div>
        {!!r.readinessIssues?.length && <div><dt>资料提示</dt><dd>{r.readinessIssues.join('；')}</dd></div>}
        <div><dt>需求说明</dt><dd>{r.background || '尚未填写'}</dd></div>
        <div><dt>完成标准</dt><dd>{r.acceptanceCriteria || '尚未填写'}</dd></div>

        <div><dt>当前计划</dt><dd>{r.plannedStart||"待排期"} → {r.plannedEnd||"待排期"}</dd></div><div><dt>预计完成</dt><dd>{r.executionForecastEnd||"待确定"}</dd></div><div><dt>进度</dt><dd>{progressHint}</dd></div>
        {r.sourceNotes&&<div><dt>原始需求资料</dt><dd style={{whiteSpace:"pre-wrap"}}>{r.sourceNotes}</dd></div>}
        <div><dt>计划偏差</dt><dd>{variance.title}</dd></div>
        <div><dt>风险</dt><dd>{r.riskReason || risk.label}</dd></div>
        <div><dt>最近更新</dt><dd>{formatDateTime(r.updatedAt)}{!direct && ` · ${r.workItems.length} 个工作项`}</dd></div>
      </dl>
    </AnchoredPopover>
  </section>;
}
