import { useMemo } from 'react';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { calculateWorkItemGap, todayIso } from '../../shared/domain';
import type { WorkItem } from '../types';
import { EmptyState } from './Modal';

function percentPosition(value: string, start: Date, span: number) {
  return Math.max(0, Math.min(100, (differenceInCalendarDays(parseISO(value), start) / span) * 100));
}

function width(left: number, right: number) {
  return `${Math.max(1.5, right - left)}%`;
}

export function GapTimeline({ items }: { items: WorkItem[] }) {
  const range = useMemo(() => {
    const today = todayIso();
    const values = items.flatMap((item) => [
      item.plannedStart, item.plannedEnd, item.actualStart,
      item.actualEnd || (item.actualStart ? today : null),
    ]).filter(Boolean) as string[];
    if (!values.length) return null;
    values.sort();
    const start = parseISO(values[0]);
    const end = parseISO(values.at(-1)!);
    return { start, end, span: Math.max(1, differenceInCalendarDays(end, start)) };
  }, [items]);
  if (!range) return <EmptyState title="尚无可绘制的计划" detail="工作项生成计划后，这里会并排展示计划与实际Gap。" />;
  return (
    <div className="gap-chart">
      <div className="timeline-header"><span /><div><b>{format(range.start, 'MM/dd')}</b><b>{format(range.end, 'MM/dd')}</b></div><span>偏差</span></div>
      {items.map((item) => {
        const gap = calculateWorkItemGap(item);
        const planLeft = item.plannedStart ? percentPosition(item.plannedStart, range.start, range.span) : 0;
        const planRight = item.plannedEnd ? percentPosition(item.plannedEnd, range.start, range.span) : planLeft;
        const actualDate = item.actualEnd || (item.actualStart ? todayIso() : null);
        const actualLeft = item.actualStart ? percentPosition(item.actualStart, range.start, range.span) : 0;
        const actualRight = actualDate ? percentPosition(actualDate, range.start, range.span) : actualLeft;
        return (
          <div className="timeline-row" key={item.id}>
            <div className="timeline-label"><strong>{item.title}</strong><small>{item.assigneeNames?.join('、') || item.ownerName || '未分配'}</small></div>
            <div className="timeline-lanes">
              <div className="timeline-track"><span className="lane-name">计划</span>{item.plannedStart && item.plannedEnd && <span className="timebar plan-bar" style={{ left: `${planLeft}%`, width: width(planLeft, planRight) }} title={`计划 ${item.plannedStart} 至 ${item.plannedEnd}，${gap.planDuration}个工作日`} />}</div>
              <div className="timeline-track"><span className="lane-name">实际</span>{item.actualStart && actualDate && <span className="timebar actual-bar" style={{ left: `${actualLeft}%`, width: width(actualLeft, actualRight) }} title={`实际 ${item.actualStart} 至 ${actualDate}，${gap.actualDuration}个工作日`} />}</div>
            </div>
            <div className="gap-values">
              <span className={gap.finishVariance > 0 ? 'gap-late' : gap.finishVariance < 0 ? 'gap-early' : ''}>完成 {gap.finishVariance > 0 ? '+' : ''}{gap.finishVariance}天</span>
              <span className={gap.durationVariance > 0 ? 'gap-late' : gap.durationVariance < 0 ? 'gap-early' : ''}>耗时 {gap.durationVariance > 0 ? '+' : ''}{gap.durationVariance}天</span>
            </div>
          </div>
        );
      })}
      <footer><span><i className="legend-plan" />计划</span><span><i className="legend-actual" />实际</span><em>未完成的实际时间延伸至今天</em></footer>
    </div>
  );
}
