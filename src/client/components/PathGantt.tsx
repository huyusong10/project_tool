import { useMemo } from 'react';
import type { PathEdge, PathMilestone, PathNode, PathRequirement } from '../../shared/paths';
import { useGanttNavigation } from '../use-gantt-navigation';
import { ganttInterval } from '../gantt-geometry';
import { pathMilestones } from '../gantt-milestones';
import { GanttScale, ganttTodayPosition, ganttTrackStyle } from './GanttTimeline';
import { GanttNavigation, GanttScrollbar } from './GanttNavigation';
import { GanttMilestoneRail, GanttMilestoneCuts, GanttMilestoneUndated, useMilestoneSelection } from './GanttMilestones';

export const hasPathGanttDates = (nodes: PathNode[]) => nodes.some(n => n.plannedEnd || n.forecastEnd);
type Props = { nodes: PathNode[]; onSelect: (node: PathNode) => void; storageKey: string; asOfDate: string;
  edges?: PathEdge[]; milestones?: PathMilestone[]; project?: boolean; requirements?: PathRequirement[]; allNodes?: PathNode[] };
export function PathGantt({ nodes, onSelect, storageKey, asOfDate, edges = [], milestones = [], project = false, requirements = [], allNodes = nodes }: Props) {
  const milestoneItems = useMemo(() => pathMilestones(nodes.filter(n => !project || n.kind !== 'acceptance'), edges, milestones), [nodes, project, edges, milestones]);
  const selection = useMilestoneSelection(milestoneItems, asOfDate, id => { const n = nodes.find(n => n.id === id); if (n) onSelect(n); });
  const rows = useMemo(() => nodes.filter(n => ['work', 'execution'].includes(n.kind) || project && n.kind === 'acceptance').map(n => {
    if (!project) return n;
    const r = requirements.find(r => r.id === n.requirementId), start = allNodes.find(p => p.kind === 'start' && p.requirementId === n.requirementId);
    return { ...n, title: r?.title || n.title, plannedStart: r?.plannedStart || n.plannedStart, forecastStart: start?.forecastStart || n.forecastStart };
  }), [nodes, project, requirements, allNodes]);
  const values = useMemo(() => [...rows.flatMap(n => [n.forecastStart, n.forecastEnd, n.plannedStart, n.plannedEnd]), ...milestoneItems.flatMap(m => [m.targetDate, m.actualDate, m.forecastDate])], [rows, milestoneItems]);
  const navigation = useGanttNavigation({ values, asOfDate, storageKey, onPan: selection.close });
  const { dates, cellWidth, timelineWidth, zoom } = navigation;
  const { offset, visible } = ganttTodayPosition(dates, asOfDate);
  const track = useMemo(() => ganttTrackStyle(dates, cellWidth), [dates, cellWidth]);
  return <div className="path-draft-gantt is-dated">
    <GanttNavigation navigation={navigation} />
    <div className="path-gantt-scroll gantt-navigation-surface" ref={navigation.attach} tabIndex={0} aria-label="排期预览时间轴，可左右拖动浏览">
      <div className={`path-gantt-grid${milestoneItems.length ? ' has-milestone-rail' : ''}`} style={{ width: 150 + timelineWidth, gridTemplateColumns: `150px ${timelineWidth}px` }}>
        <div className="path-gantt-corner" data-gantt-fixed><span>{project ? '需求' : '工作项'}</span><GanttMilestoneUndated items={milestoneItems} selection={selection} /></div>
        <div className="gantt-axis-header"><GanttScale dates={dates} zoom={zoom} cellWidth={cellWidth} todayOffset={offset} todayVisible={visible} />
          {milestoneItems.length > 0 && <GanttMilestoneRail items={milestoneItems} dates={dates} cellWidth={cellWidth} asOfDate={asOfDate} selection={selection} />}
        </div>
        {rows.map(n => {
          const plan = ganttInterval(n.plannedStart, n.plannedEnd, dates, cellWidth), forecast = ganttInterval(n.forecastStart, n.forecastEnd, dates, cellWidth);
          const related = selection.related(n.id) || project && selection.selected.some(m => m.relatedIds.some(id => allNodes.find(p => p.id === id)?.requirementId === n.requirementId));
          return <div className={`path-draft-gantt-row${related ? ' is-milestone-related' : ''}`} key={n.id}>
            <button className="path-gantt-name" onClick={() => onSelect(n)} title={n.title}>{n.title}<small>{n.forecastEnd || '交付待确认'}{n.arrangement === 'late' ? ' · 靠近交付' : ''}</small></button>
            <div className="path-draft-gantt-track" style={track}>
              <GanttMilestoneCuts items={milestoneItems} dates={dates} cellWidth={cellWidth} asOfDate={asOfDate} selection={selection} />
              {plan && <i className="plan" style={{ left: plan.left, width: plan.width }} />}
              {forecast ? <i style={{ left: forecast.left, width: forecast.width }} title={`${n.forecastStart} ～ ${n.forecastEnd}`} /> : <em>待确认</em>}
            </div>
          </div>;
        })}
      </div>
    </div>
    <GanttScrollbar navigation={navigation} />{selection.details}
  </div>;
}
