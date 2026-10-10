import type {WorkItem} from '../types';
import {workStageLabels} from '../../shared/execution-stage';

export function WorkItemFacts({item}:{item:WorkItem}){
  const terminal=['completed','cancelled'].includes(item.status);
  return <>
    <dl className="object-facts">
      <div><dt>工作阶段</dt><dd>{item.workStage?workStageLabels[item.workStage]:'未分类'}</dd></div>
      <div><dt>负责人</dt><dd>{item.ownerName||'待分派'}</dd></div>
      <div><dt>协作人</dt><dd>{item.collaborators?.map(p=>p.name).join('、')||'未安排'}</dd></div>
      <div><dt>计划日期</dt><dd>{item.plannedStart||'待定'} ～ {item.plannedEnd||'待定'}</dd></div>
      <div><dt>实际日期</dt><dd>{item.actualStart||'尚未开始'}{item.actualStart?' ～ '+(item.status==='cancelled'?item.cancelledAt||'已取消（日期待核对）':item.actualEnd||(item.status==='completed'?'完成日期待核对':'进行中')):''}</dd></div>
      {!terminal&&<div><dt>预计完成</dt><dd>{item.deliveryForecast?.end||item.forecastEnd||'待确认'}</dd></div>}
      {item.durationDays!=null&&<div><dt>计划工期</dt><dd>{item.durationDays} 个工作日</dd></div>}
      {item.milestoneLabel&&<div><dt>里程碑</dt><dd>{item.milestoneLabel}</dd></div>}
      {!!item.unmetPredecessors?.length&&<div className="object-fact-wide"><dt>等待前置</dt><dd>{item.unmetPredecessors.map(p=>p.title).join('、')}</dd></div>}
    </dl>
    {item.status==='not_started'&&!item.forecastEnd&&item.deliveryForecast?.start&&item.plannedStart&&item.deliveryForecast.start<item.plannedStart&&<p className="object-info-note">自动预计从最早可开工日 {item.deliveryForecast.start} 按 {item.deliveryForecast.remainingDays} 个工作日推算，可能早于计划开始。</p>}
    {item.blockedReason&&<p className="object-info-note">阻塞说明：{item.blockedReason}</p>}
  </>;
}
