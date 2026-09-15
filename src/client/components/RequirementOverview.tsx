import { useRef, useState } from 'react';
import { Info, ExternalLink } from 'lucide-react';
import type { Requirement } from '../types';
import { formatDateTime } from '../format';
import { requirementRiskDisplay, requirementVarianceDisplay, requirementDeliveryDate, requirementScheduleLabel } from '../requirement-presentation';
import { DeliveryControls } from './DeliveryControls';
import { ExecutionStageBadge } from './ExecutionStageBadge';
import { TestSubmissionButton } from './TestSubmissionButton';
import { AnchoredPopover } from './InlineEdit';

export function RequirementOverview({ requirement: r, compact=false }: { requirement: Requirement; compact?:boolean }) {
  const [details, setDetails] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const closeDetails = () => { setDetails(false); anchor.current?.focus(); };
  const risk = requirementRiskDisplay(r), variance = requirementVarianceDisplay(r);
  const deliveryDate=requirementDeliveryDate(r);
  const direct = r.executionMode === 'direct';
  const plannedLabel = r.scheduleComplete === false || r.plannedProgress === null ? requirementScheduleLabel(r) : `计划 ${r.plannedProgress}%`;
  const progressHint = `${plannedLabel} · ${direct ? '直接记录完成度' : '自动按工期加权'}`;
  return <section className={"requirement-overview"+(compact?" is-compact":"")} aria-label="需求概览">
    <div className="requirement-overview-top">
      <div className="requirement-overview-meta">
        <ExecutionStageBadge requirement={r} />
        {!compact&&<span className="requirement-overview-owner" title={`需求负责人：${r.ownerName || '待指定'}`}>负责人 <strong>{r.ownerName || '待指定'}</strong></span>}
      </div>
      <div className="requirement-overview-actions">
        <DeliveryControls requirement={r} /><TestSubmissionButton requirement={r} />
        <button ref={anchor} className="icon-button" title="进度计算说明" aria-label="需求资料与计算说明" aria-expanded={details} onClick={() => setDetails(v => !v)}><Info size={15} /></button>
      </div>
    </div>
    {compact?<dl className="object-facts">
      <div><dt>负责人</dt><dd>{r.ownerName||'待指定'}</dd></div>
      <div><dt>交付安排</dt><dd>{r.featureName||'未关联特性'} / {r.phaseName||'未安排 Phase'}</dd></div>
      <div><dt>计划日期</dt><dd>{r.plannedStart||'待定'} ～ {r.plannedEnd||'待定'}</dd></div>
      <div><dt>{deliveryDate.label}</dt><dd title={deliveryDate.help}>{deliveryDate.value}</dd></div>
      <div><dt>偏差</dt><dd title={variance.title}>{variance.label}</dd></div>
      <div><dt>风险</dt><dd title={r.riskReason}>{risk.label}</dd></div>
    </dl>:<div className="detail-kpis">
      <article><span>交付安排</span><strong style={{fontSize:16}}>{r.phaseName || "未安排 Phase"}</strong><small>{r.featureName || "未关联特性"}</small></article>
      <article title={deliveryDate.help+"；当前计划："+(r.plannedStart||"待排期")+" → "+(r.plannedEnd||"待排期")}><span>{deliveryDate.label}</span><strong>{deliveryDate.value}</strong></article>
      <article title={variance.title}><span>偏差</span><strong className={variance.className}>{variance.label}</strong></article>
      <article title={r.riskReason}><span>风险</span><span className={`risk-badge ${risk.className}`}>{risk.label}</span></article>
    </div>}
    <AnchoredPopover anchorRef={anchor} open={details} onOutside={() => setDetails(false)} onEscape={closeDetails} width={420} className="requirement-overview-details">
      <header><strong>需求资料与计算说明</strong><button className="ghost-button" onClick={closeDetails}>关闭</button></header>
      <dl>
        <div><dt>需求负责人</dt><dd>{r.ownerName || '待指定'}</dd></div>
        {!!r.readinessIssues?.length && <div><dt>资料提示</dt><dd>{r.readinessIssues.join('；')}</dd></div>}
        <div><dt>需求说明</dt><dd>{r.background || '尚未填写'}</dd></div>
        <div><dt>完成标准</dt><dd>{r.acceptanceCriteria || '尚未填写'}</dd></div>
        {r.referenceUrl && <div><dt>参考链接</dt><dd><a href={r.referenceUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />打开辅助资料</a></dd></div>}
        <div><dt>当前计划</dt><dd>{r.plannedStart||"待排期"} → {r.plannedEnd||"待排期"}</dd></div><div><dt>预计完成</dt><dd>{r.executionForecastEnd||"待确定"}</dd></div><div><dt>进度</dt><dd>{progressHint}</dd></div>
        {r.sourceNotes&&<div><dt>原始需求资料</dt><dd style={{whiteSpace:"pre-wrap"}}>{r.sourceNotes}</dd></div>}
        <div><dt>计划偏差</dt><dd>{variance.title}</dd></div>
        <div><dt>风险</dt><dd>{r.riskReason || risk.label}</dd></div>
        <div><dt>最近更新</dt><dd>{formatDateTime(r.updatedAt)}{!direct && ` · ${r.workItems.length} 个工作项`}</dd></div>
      </dl>
    </AnchoredPopover>
  </section>;
}
