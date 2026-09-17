import {phaseCompletion,phaseStatusLabels} from '../../shared/feature-phases';
import type {WorkspaceRow} from '../workspace-rows';
import type {SummaryTimeline} from '../phase-gantt';
import {GanttProgressEnd,GanttProgressText} from './GanttProgressEnd';
import {GanttDateTracks} from './GanttDateTracks';
import type {useGanttTooltip} from './GanttTooltip';
import './workspace-phase-progress.css';

export function WorkspacePhaseProgress({row,summary,dates,cellWidth,onSelect,tooltip}: {
  row:WorkspaceRow; summary:SummaryTimeline; dates:Date[]; cellWidth:number; onSelect:(row:WorkspaceRow)=>void; tooltip:Pick<ReturnType<typeof useGanttTooltip>,'bind'|'close'>;
}) {
  const actualDates=summary.status==='planning'||summary.status==='not_started'?'尚未开始':`${summary.actualStart||'开始未记录'} ～ ${summary.actualEnd||'结束未记录'}${summary.status==='in_progress'&&summary.actualEnd===summary.asOfDate?'（截至统计日）':''}`;
  const title=[row.title,`实际 ${actualDates}`,
    `统计日期 ${summary.asOfDate}`,row.phase?.targetDate&&`目标日期 ${row.phase.targetDate}`,
    summary.completion?.total&&`完成 ${summary.completion.completed}/${summary.completion.total} 项需求`,
    `${row.phase?'Phase':'特性'}完成度 ${summary.percent===null?'待细化':summary.percent+'%'}；按当前已明确范围的工作量加权，包含未排期需求`,
    ...(!row.phase?summary.phases.map(p=>`${p.name}：${phaseCompletion(p.requirements).percent===null?'待细化':phaseStatusLabels[p.status]+' · '+phaseCompletion(p.requirements).percent+'%'}`):[]),
  ].filter(Boolean).join('\n');
  const details=<div className="workspace-gantt-summary"><header><strong>{row.title}</strong>{row.phase&&<span>{summary.completion?.percent===null?'待细化':phaseStatusLabels[row.phase.status]}</span>}</header>
    <dl><div><dt>实际日期</dt><dd>{actualDates}</dd></div>
    {row.phase?.targetDate&&<div><dt>目标日期</dt><dd>{row.phase.targetDate}</dd></div>}
    <div><dt>{row.phase?'Phase 完成度':'特性完成度'}</dt><dd>{summary.percent===null?'待细化':`${summary.percent}%`}<small>按当前已明确范围的工作量加权，包含未排期需求</small></dd></div>
    <div><dt>已完成需求</dt><dd>{summary.completion.completed} / {summary.completion.total}</dd></div>
    {row.phase?.scope&&<div><dt>交付范围</dt><dd>{row.phase.scope}</dd></div>}</dl>
    {!row.phase&&!!summary.phases.length&&<section><h4>Phase 进展</h4>{summary.phases.map(p=><article className="workspace-summary-phase-detail" key={p.id}><div><p>{p.name}</p><small>{[p.targetDate&&`目标 ${p.targetDate}`,p.completedAt&&`完成 ${p.completedAt}`].filter(Boolean).join(" · ")}</small></div><span>{phaseCompletion(p.requirements).percent===null?'待细化':`${phaseStatusLabels[p.status]} · ${phaseCompletion(p.requirements).percent}%`}</span></article>)}<small>条尾编号表示当前 Phase，百分比表示特性整体完成度。各 Phase 按所含需求的工作量加权，未安排 Phase 的需求也计入。</small>{summary.phases.some(p=>!phaseCompletion(p.requirements).total)&&<p>{summary.phases.filter(p=>!phaseCompletion(p.requirements).total).length} 个 Phase 尚未细化，不计入当前比例。</p>}<small>100% 表示当前已明确范围完成；新增范围后重新计算。</small></section>}
  </div>;
  return <div className="workspace-summary-timeline" aria-label="实际执行情况">
    <GanttDateTracks actualStart={summary.actualStart} actualEnd={summary.actualEnd}
      status={summary.status} progress={summary.completion?.percent??0} fillProgress={summary.completion?.percent??undefined}
      stageLabel={summary.label||row.title} interactionProps={{...tooltip.bind(details),'aria-label':title}} progressAriaLabel="需求完成比例" dates={dates} cellWidth={cellWidth} showProgress={false} showScheduleHint={false}/>
    {summary.label&&<GanttProgressEnd start={summary.actualStart} end={summary.actualEnd} asOfDate={summary.asOfDate} dates={dates} cellWidth={cellWidth} {...tooltip.bind(details)}>
      <button type="button" className="gantt-date-progress workspace-summary-label" onClick={()=>{tooltip.close();onSelect(row);}} aria-label={title}>
        <GanttProgressText parts={[{label:summary.caption,percent:summary.percent??undefined}]} extra={summary.parallelCount}/>
      </button>
    </GanttProgressEnd>}
  </div>;
}
