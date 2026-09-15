import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { groupMilestones, milestoneDate, milestoneGroupLabel, milestonePosition, milestoneState, milestoneTiming, type GanttMilestone } from '../gantt-milestones';
import { useGanttTooltip } from './GanttTooltip';
import './gantt-milestones.css';

const stateLabels = { planned: '未达成', reached: '已达成', overdue: '已逾期', cancelled: '已取消' };
function MilestoneSummary({ items, asOfDate }: { items: GanttMilestone[]; asOfDate: string }) {
  return <>{items.map(m => <section key={m.id} className="gantt-milestone-summary">
    <strong>{m.title}</strong><small>{stateLabels[milestoneState(m, asOfDate)]}{m.manual && !m.actualDate ? ' · 人工确认' : ''}</small>
    <dl className="gantt-popover-metrics">
      {m.dateBasis !== 'actual' && m.targetDate && <div><dt>目标日期</dt><dd>{m.targetDate}</dd></div>}
      {m.actualDate && <div><dt>实际达成</dt><dd>{m.actualDate}</dd></div>}
      {!m.actualDate && m.forecastDate && <div><dt>预计达成</dt><dd>{m.forecastDate}</dd></div>}
      {!m.targetDate && !m.actualDate && <div><dt>排期</dt><dd>{m.timingLabel || '未排期'}</dd></div>}
    </dl>
    {m.dateBasis !== 'actual' && m.actualDate && m.targetDate && m.actualDate !== m.targetDate && <small>{m.actualDate < m.targetDate ? '提前达成，目标日期保留' : '延期达成，目标日期保留'}</small>}
  </section>)}</>;
}
export function useMilestoneSelection(items: GanttMilestone[], asOfDate: string, onLocate?: (id: string) => void) {
  const [open, setOpen] = useState<{ ids: string[]; x: number; y: number; trigger: HTMLElement } | null>(null);
  const panel = useRef<HTMLDivElement>(null), hover = useGanttTooltip();
  const close = () => { setOpen(null); hover.close(); };
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => { if (e.target instanceof Node && (panel.current?.contains(e.target) || open.trigger.contains(e.target))) return; setOpen(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(null); open.trigger.isConnected && open.trigger.focus({ preventScroll: true }); } };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', outside, true); window.addEventListener('resize', outside);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key, true); window.removeEventListener('scroll', outside, true); window.removeEventListener('resize', outside); };
  }, [open]);
  const selected = items.filter(m => open?.ids.includes(m.id));
  const bind = (group: GanttMilestone[]) => ({
    ...(!open ? hover.bind(<MilestoneSummary items={group} asOfDate={asOfDate} />) : {}),
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      e.stopPropagation(); hover.close();
      if (open?.trigger === e.currentTarget) { setOpen(null); return; }
      const rect = e.currentTarget.getBoundingClientRect(), width = Math.min(320, window.innerWidth - 24), height = Math.min(340, window.innerHeight - 24);
      setOpen({ ids: group.map(m => m.id), trigger: e.currentTarget, x: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), y: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - height - 12)) });
    },
  });
  return { selected, bind, close, related: (id: string) => selected.some(m => m.relatedIds.includes(id)),
    details: <>{hover.tooltip}{open && selected.length > 0 && createPortal(<div ref={panel} className="gantt-milestone-details" role="dialog" aria-label="里程碑详情" style={{ left: open.x, top: open.y }}>
      <header><strong>里程碑{selected.length > 1 ? ` · ${selected.length} 项` : ''}</strong><button type="button" className="ghost-button" aria-label="关闭里程碑详情" onClick={() => { close(); open.trigger.isConnected && open.trigger.focus({ preventScroll: true }); }}><X size={16} /></button></header>
      <MilestoneSummary items={selected} asOfDate={asOfDate} />
      {onLocate && selected.map(m => <button type="button" className="ghost-button" key={m.id} onClick={() => { close(); onLocate(m.id); }}>查看{selected.length > 1 ? ` ${m.title}` : '关联工作'}</button>)}
    </div>, document.body)}</> };
}
export type MilestoneSelection = ReturnType<typeof useMilestoneSelection>;
type Props = { items: GanttMilestone[]; dates: Date[]; cellWidth: number; asOfDate: string; selection: MilestoneSelection; width?: number; showForecast?: boolean };

export function GanttMilestoneRail({ items, dates, cellWidth, asOfDate, selection, width = dates.length * cellWidth, showForecast = false, inline = false }: Props & { inline?: boolean }) {
  const groups = groupMilestones(items, dates, cellWidth, width, showForecast);
  return <div className={`gantt-milestone-rail${inline ? ' is-inline' : ''}`} aria-label="里程碑时间标记" style={{ width }}>
    {inline && <GanttMilestoneCuts items={items} dates={dates} cellWidth={cellWidth} asOfDate={asOfDate} selection={selection} showForecast={showForecast} />}
    {groups.map(group => {
      const sameDate = new Set(group.items.map(m => milestoneDate(m, showForecast) || m.offset)).size === 1;
      const label = milestoneGroupLabel(group.items, sameDate);
      const states = group.items.map(m => milestoneState(m, asOfDate));
      const groupState = states.every(s => s === 'reached') ? 'reached' : states.every(s => s === 'cancelled') ? 'cancelled' : states.includes('overdue') ? 'overdue' : 'planned';
      return <div key={group.items.map(m => m.id).join('|')} className="gantt-milestone-group">
        {group.items.map(m => <span key={m.id} className={`gantt-milestone-pin milestone-${milestoneState(m, asOfDate)}`} data-milestone-id={m.id} data-milestone-date={milestoneDate(m, showForecast) || undefined} data-actual-separated={m.dateBasis !== 'actual' && !!m.targetDate && !!m.actualDate && m.targetDate !== m.actualDate} style={{ left: milestonePosition(m, dates, cellWidth, false, showForecast)! }} aria-hidden="true" />)}
        <button type="button" className={`gantt-milestone-label milestone-${groupState}`} style={{ left: group.labelLeft, width: group.width }} aria-pressed={group.items.some(m => selection.selected.some(s => s.id === m.id))} aria-label={group.items.map(m => `${m.title}，${milestoneTiming(m, showForecast)}，${stateLabels[milestoneState(m, asOfDate)]}`).join('；')} {...selection.bind(group.items)}>{label}</button>
      </div>;
    })}
    {items.filter(m => m.dateBasis !== 'actual' && m.targetDate && m.actualDate && m.actualDate !== m.targetDate).map(m => {
      const left = milestonePosition(m, dates, cellWidth, true);
      return left === null ? null : <button key={m.id} type="button" className="gantt-milestone-actual" data-milestone-actual={m.id} style={{ left }} aria-label={`${m.title}，实际达成 ${m.actualDate}`} {...selection.bind([m])}><i /></button>;
    })}
  </div>;
}
export function GanttMilestoneCuts({ items, dates, cellWidth, asOfDate, selection, showForecast = false }: Props) {
  return <>{items.map(m => {
    const left = milestonePosition(m, dates, cellWidth, false, showForecast);
    return left === null ? null : <span key={m.id} className={`gantt-milestone-cut milestone-${milestoneState(m, asOfDate)}${selection.selected.some(s => s.id === m.id) ? ' is-selected' : ''}`} data-milestone-cut={m.id} aria-hidden="true" style={{ left }} />;
  })}</>;
}
export function GanttMilestoneUndated({ items, selection, showForecast = false, compact = false }: Pick<Props, 'items' | 'selection' | 'showForecast'> & { compact?: boolean }) {
  const unknown = items.filter(m => !milestoneDate(m, showForecast) && m.offset === undefined);
  return unknown.length ? <button type="button" className={'gantt-milestone-undated'+(compact?' is-compact':'')} aria-label={'待定日期 '+unknown.length+' 项'} title={compact?'未定日期的里程碑：'+unknown.map(m=>m.title).join('、'):undefined} {...selection.bind(unknown)}>{compact?<>◇ {unknown.length}</>:<>待定日期 {unknown.length} 项</>}</button> : null;
}
