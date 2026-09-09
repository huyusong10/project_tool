import { useMemo } from 'react';
import type { PathNode } from '../../shared/paths';
import { useGanttNavigation } from '../use-gantt-navigation';
import { ganttInterval } from '../gantt-geometry';
import { GanttScale, ganttTodayPosition, ganttTrackStyle } from './GanttTimeline';
import { GanttNavigation, GanttScrollbar } from './GanttNavigation';

export const hasPathGanttDates = (nodes: PathNode[]) => nodes.some(n => n.plannedStart && n.plannedEnd || n.forecastStart && n.forecastEnd);
type Props = { nodes: PathNode[]; onSelect: (node: PathNode) => void; storageKey: string; asOfDate: string };
export function PathGantt(props: Props) {
  if (hasPathGanttDates(props.nodes)) return <DatedPathGantt {...props} />;
  return <div className="path-draft-gantt is-undated">{props.nodes.map(n => <div className="path-draft-gantt-row" key={n.id}><button onClick={() => props.onSelect(n)}>{n.kind === 'milestone' || n.kind === 'acceptance' ? '◇ ' : ''}{n.title}<small>交付日期待确认{n.arrangement === 'late' ? ' · 靠近交付' : ''}</small></button></div>)}{!props.nodes.length && <p>当前没有排期元素。</p>}</div>;
}
function DatedPathGantt({ nodes, onSelect, storageKey, asOfDate }: Props) {
  const values = useMemo(() => nodes.flatMap(n => [n.forecastStart, n.forecastEnd, n.plannedStart, n.plannedEnd]), [nodes]);
  const navigation = useGanttNavigation({ values, asOfDate, storageKey });
  const { dates, cellWidth, timelineWidth, zoom } = navigation;
  const { offset, visible } = ganttTodayPosition(dates, asOfDate);
  const track = useMemo(() => ganttTrackStyle(dates, cellWidth), [dates, cellWidth]);
  return <div className="path-draft-gantt is-dated">
    <GanttNavigation navigation={navigation} />
    <div className="path-gantt-scroll gantt-navigation-surface" ref={navigation.attach} tabIndex={0} aria-label="排期预览时间轴，可左右拖动浏览">
      <div className="path-gantt-grid" style={{ width: 150 + timelineWidth, gridTemplateColumns: `150px ${timelineWidth}px` }}>
        <div className="path-gantt-corner" data-gantt-fixed>交付元素</div>
        <GanttScale dates={dates} zoom={zoom} cellWidth={cellWidth} todayOffset={offset} todayVisible={visible} />
        {nodes.map(n => {
          const plan = ganttInterval(n.plannedStart, n.plannedEnd, dates, cellWidth), forecast = ganttInterval(n.forecastStart, n.forecastEnd, dates, cellWidth);
          const milestone = n.kind === 'milestone' || n.kind === 'acceptance';
          return <div className="path-draft-gantt-row" key={n.id}>
            <button className="path-gantt-name" onClick={() => onSelect(n)} title={n.title}>{milestone ? '◇ ' : ''}{n.title}<small>{n.forecastEnd || '交付待确认'}{n.arrangement === 'late' ? ' · 靠近交付' : ''}</small></button>
            <div className="path-draft-gantt-track" style={track}>
              {plan && <i className={milestone ? 'plan milestone' : 'plan'} style={{ left: plan.left, width: milestone ? 9 : plan.width }} />}
              {forecast ? <i className={milestone ? 'milestone' : ''} style={{ left: forecast.left, width: milestone ? 9 : forecast.width }} title={`${n.forecastStart} ～ ${n.forecastEnd}`} /> : <em>待确认</em>}
            </div>
          </div>;
        })}
      </div>
    </div>
    <GanttScrollbar navigation={navigation} />
  </div>;
}
