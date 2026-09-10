import { useEffect, useMemo, useRef, useState } from 'react';
import type { TemplateDependencyItem } from '../../shared/path-template';
import { milestoneAncestors, type GanttMilestone } from '../gantt-milestones';
import { GanttMilestoneRail, GanttMilestoneCuts, useMilestoneSelection } from './GanttMilestones';

export function TemplateGantt({ items, onSelect }: { items: TemplateDependencyItem[]; onSelect: (id: string) => void }) {
  const track = useRef<HTMLDivElement>(null), [width, setWidth] = useState(400);
  useEffect(() => { const node = track.current; if (!node) return; const observer = new ResizeObserver(() => setWidth(node.clientWidth)); observer.observe(node); return () => observer.disconnect(); }, []);
  const days = Math.max(1, ...items.map(i => i.startOffsetDays + i.durationDays)), cellWidth = width / days;
  const milestones = useMemo<GanttMilestone[]>(() => {
    const edges = items.flatMap(i => (i.predecessorKeys || []).map(source => ({ source, target: i.clientKey || i.id! })));
    return items.filter(i => i.kind === 'milestone').map(i => ({ id: i.clientKey || i.id!, title: i.title, relatedIds: milestoneAncestors(i.clientKey || i.id!, edges),
      offset: i.startOffsetDays, timingLabel: i.startOffsetDays ? `第 ${i.startOffsetDays} 工作日结束` : '流程开始时', manual: i.confirmationMode === 'manual' }));
  }, [items]);
  const selection = useMilestoneSelection(milestones, '', onSelect), step = Math.max(1, Math.ceil(days / 12));
  return <div className="template-milestone-plan"><div className="template-milestone-grid">
    <div className="template-plan-name">工作项</div><div ref={track}>
      <div className="template-plan-scale">{Array.from({ length: Math.ceil(days / step) }, (_, i) => <span style={{ flex: Math.min(step, days - i * step) }} key={i}>第 {i * step + 1} 日</span>)}</div>
      {milestones.length > 0 && <GanttMilestoneRail items={milestones} dates={[]} cellWidth={cellWidth} width={width} asOfDate="" selection={selection} />}
    </div>
    {items.filter(i => i.kind !== 'milestone').map(i => <div className="template-plan-row" style={{ display: 'contents' }} key={i.clientKey || i.id}>
      <button type="button" className={`template-plan-name${selection.related(i.clientKey || i.id!) ? ' is-milestone-related' : ''}`} onClick={() => onSelect(i.clientKey || i.id!)}>{i.title}<small>第 {i.startOffsetDays + 1}—{i.startOffsetDays + i.durationDays} 工作日</small></button>
      <div className={`template-plan-track${selection.related(i.clientKey || i.id!) ? ' is-milestone-related' : ''}`}>
        <GanttMilestoneCuts items={milestones} dates={[]} cellWidth={cellWidth} asOfDate="" selection={selection} />
        <span className="template-plan-bar" style={{ left: i.startOffsetDays * cellWidth, width: i.durationDays * cellWidth }} />
      </div>
    </div>)}
  </div>{selection.details}</div>;
}
