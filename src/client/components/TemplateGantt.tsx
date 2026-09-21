import './gantt-timeline.css';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { TemplateDependencyItem } from '../../shared/path-template';
import { milestoneAncestors, type GanttMilestone } from '../gantt-milestones';
import { GanttMilestoneRail, GanttMilestoneCuts } from './GanttMilestones';

export function TemplateGantt({ items, onSelect, selected = '' }: { items: TemplateDependencyItem[]; onSelect: (id: string) => void; selected?: string }) {
  const track = useRef<HTMLDivElement>(null), [width, setWidth] = useState(400);
  useEffect(() => { const node = track.current; if (!node) return; const observer = new ResizeObserver(() => setWidth(node.clientWidth)); observer.observe(node); return () => observer.disconnect(); }, []);
  const days = Math.max(1, ...items.map(i => i.startOffsetDays + i.durationDays)), cellWidth = width / days;
  const milestones = useMemo<GanttMilestone[]>(() => {
    const edges = items.flatMap(i => (i.predecessorKeys || []).map(source => ({ source, target: i.clientKey || i.id! })));
    return items.filter(i => i.kind === 'milestone').map(i => ({ id: i.clientKey || i.id!, title: i.title, relatedIds: milestoneAncestors(i.clientKey || i.id!, edges),
      offset: i.startOffsetDays, timingLabel: i.startOffsetDays ? `第 ${i.startOffsetDays} 工作日结束` : '流程开始时', manual: i.confirmationMode === 'manual' }));
  }, [items]);
  const step = Math.max(1, Math.ceil(days / 8));
  const selection = {
    selected: milestones.filter(m => m.id === selected),
    related: (id: string) => milestones.some(m => m.id === selected && m.relatedIds.includes(id)),
    close: () => {}, details: <></>,
    bind: (group: GanttMilestone[]) => ({
      title: group.map(m => m.title).join('、') + (group.length > 1 ? '（点击切换）' : ''),
      onClick: () => onSelect(group[(group.findIndex(m => m.id === selected) + 1) % group.length].id),
    }),
  };
  return <div className="template-milestone-plan"><div className="template-milestone-grid" style={{ minWidth: Math.max(390, 130 + days * 10) }}>
    <div className="template-plan-name">工作项</div><div ref={track}>
      <div className="template-plan-scale"><strong>相对工作日</strong><div>{Array.from({ length: Math.ceil(days / step) }, (_, i) => <span style={{ flex: Math.min(step, days - i * step) }} key={i}>第 {i * step + 1} 日</span>)}</div></div>
      {milestones.length > 0 && <GanttMilestoneRail items={milestones} dates={[]} cellWidth={cellWidth} width={width} asOfDate="" selection={selection} />}
    </div>
    {items.filter(i => i.kind !== 'milestone').map(i => <div className="template-plan-row" style={{ display: 'contents' }} key={i.clientKey || i.id}>
      <button type="button" data-template-work={i.clientKey || i.id} title={`${i.title} · 第 ${i.startOffsetDays + 1}—${i.startOffsetDays + i.durationDays} 工作日`} aria-pressed={selected === (i.clientKey || i.id)} className={`template-plan-name${selection.related(i.clientKey || i.id!) ? ' is-milestone-related' : ''}${selected === (i.clientKey || i.id) ? ' is-selected' : ''}`} onClick={() => onSelect(i.clientKey || i.id!)}>{i.title}<small>第 {i.startOffsetDays + 1}—{i.startOffsetDays + i.durationDays} 工作日</small></button>
      <button type="button" aria-label={'工期：' + i.title} aria-pressed={selected === (i.clientKey || i.id)} onClick={() => onSelect(i.clientKey || i.id!)} style={{"--gantt-cell":cellWidth+"px"} as CSSProperties} className={`template-name-button template-plan-track${selection.related(i.clientKey || i.id!) ? ' is-milestone-related' : ''}${selected === (i.clientKey || i.id) ? ' is-selected' : ''}`}>
        <GanttMilestoneCuts items={milestones} dates={[]} cellWidth={cellWidth} asOfDate="" selection={selection} />
        <span className="template-plan-bar gantt-date-plan" style={{ left: i.startOffsetDays * cellWidth, width: i.durationDays * cellWidth }} />
      </button>
    </div>)}
  </div></div>;
}
