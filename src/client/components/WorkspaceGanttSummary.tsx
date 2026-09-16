import type {WorkspaceRow} from '../workspace-rows';
import {requirementActualRange,workItemActualRange} from '../gantt-actual';
import {ganttForecast} from '../gantt-forecast';
import {progressUpdateDisplayValue} from '../progress-trend';
import {executionStageOf} from './ExecutionStageBadge';
import {requirementScheduleSummary} from '../requirement-presentation';

/** Read from the report already loaded by the workspace; never fetch one detail per row. */
export function WorkspaceGanttSummary({row,asOfDate}:{row:WorkspaceRow;asOfDate:string}) {
  const r=row.formalRequirement||row.requirement,w=row.formalWork||row.work,item=w||r;
  if(!item)return null;
  const plan=row.work||row.requirement||item;
  const actual=w?workItemActualRange(w,asOfDate):r?requirementActualRange(r,asOfDate):null;
  const forecast=ganttForecast(item.deliveryForecast,item.status,asOfDate);
  const stage=r?executionStageOf(r):null;
  const label=w||r?.executionMode==='direct'
    ? ({completed:'已完成',cancelled:'已取消',not_started:'未开始',blocked:'受阻'}[item.status]||'进行中')+(!['completed','cancelled'].includes(item.status)?` · ${item.progress}%`:'')
    : stage?.label+(stage?.stages.length===1?` · ${stage.stages[0].progress}%`:'');
  const updates=(r?.recentProgressUpdates||r?.progressUpdates||[]).filter(u=>!w||u.workItemId===w.id).slice(0,3);
  const draftPlan=plan.plannedStart!==item.plannedStart||plan.plannedEnd!==item.plannedEnd;
  const schedule=!w&&row.formalRequirement?requirementScheduleSummary(row.formalRequirement):null;
  return <div className="workspace-gantt-summary">
    <header><strong>{row.title}</strong><span>{label}{row.temporary?' · 未保存':''}</span></header>
    {stage && !w && stage.stages.length>1 && <p className="workspace-summary-parallel">{stage.stages.map(s=>`${s.label} ${s.progress}%`).join(' · ')}</p>}
    <dl>
      <div><dt>负责人</dt><dd>{plan.ownerName||'待分派'}</dd></div>
      <div><dt>计划日期{draftPlan?' · 草稿':''}</dt><dd>{plan.plannedStart||'待定'} ～ {plan.plannedEnd||'待定'}</dd></div>
      {!!schedule?.gaps.length&&<div><dt>{schedule.label}</dt><dd>{schedule.gaps.map(g=><small key={g.id}>{g.title}：缺少{g.missing.join('、')}</small>)}</dd></div>}
      <div><dt>实际日期</dt><dd>{actual?.start||'未开始'}{actual?.start&&<> ～ {actual.end||'日期未记录'}{!['completed','cancelled'].includes(item.status)&&<small>截至 {asOfDate}，含等待和间断</small>}</>}</dd></div>
      {forecast&&<div><dt>预计完成</dt><dd>{forecast.end||'待确认'}<small>{forecast.details}</small></dd></div>}
      {r?.delayed&&!w&&<div><dt>延期</dt><dd className="danger-text">{Math.max(1,r.finishVariance)} 个工作日</dd></div>}
      {r?.riskEvaluated&&!w&&r.riskReason&&<div><dt>排期说明</dt><dd>{r.riskReason}</dd></div>}
      {w?.blockedReason&&<div><dt>受阻原因</dt><dd className="danger-text">{w.blockedReason}</dd></div>}
      {!!w?.unmetPredecessors?.length&&<div><dt>等待前置</dt><dd>{w.unmetPredecessors.map(p=>p.title).join('、')}</dd></div>}
    </dl>
    <section><h4>最近进展</h4>{updates.length?updates.map(u=><article key={u.id}><time>{new Date(u.createdAt).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'})}</time><p>{u.content}</p>{progressUpdateDisplayValue(u)!=null&&<b>{progressUpdateDisplayValue(u)}%</b>}</article>):<p className="workspace-summary-empty">{w?'近期记录中没有这项工作的更新':'暂无近期进展记录'}</p>}</section>
  </div>;
}
