import {CommitmentComparison} from './CommitmentComparison';
import {ForecastFacts} from './ExecutionReview';
import { useRef, useState } from 'react';
import { Info, ExternalLink } from 'lucide-react';
import type { Requirement } from '../types';
import { formatDateTime } from '../format';
import { requirementRiskDisplay, requirementVarianceDisplay, requirementDeliveryDate } from '../requirement-presentation';
import { DeliveryControls } from './DeliveryControls';
import { ProcessingPriorityBadge, StatusBadge } from './Badge';
import { AnchoredPopover } from './InlineEdit';

export function RequirementOverview({ requirement: r }: { requirement: Requirement }) {
  const [details, setDetails] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const closeDetails = () => { setDetails(false); anchor.current?.focus(); };
  const risk = requirementRiskDisplay(r), variance = requirementVarianceDisplay(r);
  const deliveryDate=requirementDeliveryDate(r);
  const direct = r.executionMode === 'direct';
  const delivery = `${r.deliveryScope === 'candidate' ? '候选' : '纳入交付'} · ${direct ? '直接执行' : '工作项分解'} · 验收：${r.acceptanceOwnerName || '项目经理'}`;
  const progressHint = `计划进度 ${r.plannedProgress}% · ${direct ? '直接记录完成度' : '自动按工期加权'}`;
  return <section className="requirement-overview" aria-label="需求概览">
    <div className="requirement-overview-top">
      <div className="requirement-overview-meta">
        <StatusBadge kind="requirement" value={r.status} />
        <ProcessingPriorityBadge requirement={r} />
        <span className="requirement-overview-owner" title={`需求负责人：${r.ownerName || '待指定'}`}>负责人 <strong>{r.ownerName || '待指定'}</strong></span>
        <span className="requirement-overview-delivery" title={delivery}>{delivery}</span>
      </div>
      <div className="requirement-overview-actions">
        <DeliveryControls requirement={r} />
        <button ref={anchor} className={`ghost-button${r.readinessIssues?.length ? ' has-notice' : ''}`} aria-label="需求资料与计算说明" aria-expanded={details} onClick={() => setDetails(v => !v)}><Info size={15} /><span>资料{r.readinessIssues?.length ? ` ${r.readinessIssues.length}` : ''}</span></button>
      </div>
    </div>
    <div className="detail-kpis">
      <article title={progressHint}><span>进度</span><strong>{r.progress}%</strong><div className="progress-row" aria-hidden="true"><i style={{ width: `${r.progress}%` }} /></div><small>计划 {r.plannedProgress}%</small></article>
      <article title={deliveryDate.help+"；确认计划："+(r.plannedStart||"待排期")+" → "+(r.plannedEnd||"待排期")}><span>{deliveryDate.label}</span><strong>{deliveryDate.value}</strong></article>
      <article title={variance.title}><span>偏差</span><strong className={variance.className}>{variance.label}</strong></article>
      <article title={r.riskReason}><span>风险</span><span className={`risk-badge ${risk.className}`}>{risk.label}</span></article>
    </div>
    <AnchoredPopover anchorRef={anchor} open={details} onOutside={() => setDetails(false)} onEscape={closeDetails} width={420} className="requirement-overview-details">
      <header><strong>需求资料与计算说明</strong><button className="ghost-button" onClick={closeDetails}>关闭</button></header>
      <dl>
        <div><dt>交付安排</dt><dd>{delivery}</dd></div>
        <div><dt>需求负责人</dt><dd>{r.ownerName || '待指定'}</dd></div>
        {r.status === 'pending_acceptance' && <div><dt>验收状态</dt><dd>执行工作已完成，等待验收；验收后才计入交付完成。</dd></div>}
        {!!r.readinessIssues?.length && <div><dt>资料提示</dt><dd>{r.readinessIssues.join('；')}</dd></div>}
        <div><dt>需求背景</dt><dd>{r.background || '尚未填写'}</dd></div>
        <div><dt>验收标准</dt><dd>{r.acceptanceCriteria || '尚未填写'}</dd></div>
        {r.referenceUrl && <div><dt>参考链接</dt><dd><a href={r.referenceUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />打开辅助资料</a></dd></div>}
        <div><dt>确认计划</dt><dd>{r.plannedStart||"待排期"} → {r.plannedEnd||"待排期"}</dd></div><div><dt>交付预测</dt><dd>{r.acceptanceForecastEnd||"待确认"}{r.acceptanceAssumed?" · 假设工作完成后当日验收":""}</dd></div><div><dt>进度</dt><dd>{progressHint}</dd></div>
<div><dt>首次交付承诺</dt><dd>{r.commitment?.first?.targetDate||"未确认日期"}</dd></div><div><dt>最近交付承诺</dt><dd>{r.commitment?.latest?.targetDate||"未确认日期"}</dd></div><div><dt>执行完成／验收</dt><dd>{r.executionCompletedAt||"未完成"} ／ {r.acceptedAt||"未验收"}</dd></div>
        <div><dt>计划偏差</dt><dd>{variance.title}</dd></div>
        <div><dt>风险</dt><dd>{r.riskReason || risk.label}</dd></div>
        <div><dt>处理优先级</dt><dd>{r.priorityReasons?.join('；') || '暂无计算原因'}</dd></div>
        <div><dt>最近更新</dt><dd>{formatDateTime(r.updatedAt)}{!direct && ` · ${r.workItems.length} 个工作项`}</dd></div>
      </dl><CommitmentComparison value={r} plannedEnd={r.plannedEnd}/><ForecastFacts basis={r.forecastBasis} coordination={r.blockerCoordination}/>
    </AnchoredPopover>
  </section>;
}
