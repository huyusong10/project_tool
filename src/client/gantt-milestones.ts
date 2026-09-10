import { format } from 'date-fns';
import { isOverdueByWorkday } from '../shared/domain';
import type { PathEdge, PathMilestone, PathNode } from '../shared/paths';
import type { WorkItem } from './types';
import { businessDateIndex, toGanttDate } from './gantt-geometry';

export type GanttMilestone = {
  id: string; title: string; requirementId?: string | null;
  targetDate?: string | null; forecastDate?: string | null; actualDate?: string | null;
  cancelled?: boolean; manual?: boolean; relatedIds: string[];
  offset?: number; timingLabel?: string;
};
export function milestoneDay(value?: string | null) {
  if (!value) return null;
  const date = toGanttDate(value);
  if (date) return format(date, 'yyyy-MM-dd');
  // Achieved records may contain an instant; display its local business date.
  const instant = new Date(value);
  return value.includes('T') && Number.isFinite(instant.getTime()) ? format(instant, 'yyyy-MM-dd') : null;
}
export function milestoneDate(m: GanttMilestone) {
  return milestoneDay(m.targetDate) || milestoneDay(m.actualDate) || milestoneDay(m.forecastDate);
}
export function milestoneState(m: GanttMilestone, asOfDate: string) {
  return m.cancelled ? 'cancelled' : m.actualDate ? 'reached'
    : m.targetDate && isOverdueByWorkday(m.targetDate, asOfDate) ? 'overdue' : 'planned';
}
export function milestonePosition(m: GanttMilestone, dates: Date[], cellWidth: number, actual = false) {
  if (!actual && m.offset !== undefined) return m.offset * cellWidth;
  const day = actual ? milestoneDay(m.actualDate) : milestoneDate(m), date = toGanttDate(day);
  if (!date || !dates.length || date < dates[0] || date > dates.at(-1)!) return null;
  return (businessDateIndex(date, dates, 'end') + 1) * cellWidth;
}
export function milestoneTiming(m: GanttMilestone) {
  if (m.timingLabel) return m.timingLabel;
  const day = milestoneDate(m);
  return day ? `${m.targetDate ? '目标' : m.actualDate ? '实际' : '预计'} ${day}` : '日期待确认';
}
export function milestoneAncestors(id: string, edges: Pick<PathEdge, 'source' | 'target'>[]) {
  const incoming = new Map<string, string[]>();
  for (const e of edges) incoming.set(e.target, [...incoming.get(e.target) || [], e.source]);
  const seen = new Set<string>(), queue = [...incoming.get(id) || []];
  while (queue.length) { const key = queue.pop()!; if (key === id || seen.has(key)) continue; seen.add(key); queue.push(...incoming.get(key) || []); }
  return [...seen];
}
export function requirementMilestones(milestones: PathMilestone[] | undefined, workItems: WorkItem[], edges: PathEdge[] = []): GanttMilestone[] {
  if (milestones !== undefined) return milestones.map(m => ({
    id: m.id, title: m.title, requirementId: m.requirementId, targetDate: milestoneDay(m.targetDate),
    actualDate: milestoneDay(m.achievedAt), forecastDate: milestoneDay(m.forecastEnd), cancelled: m.cancelled,
    manual: m.confirmationMode === 'manual', relatedIds: milestoneAncestors(m.id, edges),
  }));
  return workItems.filter(w => w.milestoneLabel).map(w => ({
    id: `legacy:${w.id}`, title: w.milestoneLabel!, requirementId: w.requirementId, targetDate: milestoneDay(w.plannedEnd),
    actualDate: w.status === 'completed' ? milestoneDay(w.actualEnd) : null, forecastDate: milestoneDay(w.forecastEnd),
    cancelled: w.status === 'cancelled', relatedIds: [w.id],
  }));
}
export function pathMilestones(nodes: PathNode[], edges: PathEdge[] = [], milestones: PathMilestone[] = []): GanttMilestone[] {
  return nodes.filter(n => n.kind === 'milestone' || n.kind === 'acceptance').map(n => {
    const m = milestones.find(m => m.id === n.id);
    return { id: n.id, title: n.title, requirementId: n.requirementId,
      targetDate: milestoneDay(m?.targetDate || n.plannedEnd), forecastDate: milestoneDay(n.forecastEnd),
      actualDate: milestoneDay(m ? m.achievedAt : n.complete ? n.forecastEnd : null),
      cancelled: m?.cancelled || n.status === 'cancelled', manual: m?.confirmationMode === 'manual',
      relatedIds: milestoneAncestors(n.id, edges) };
  });
}
export function groupMilestones(items: GanttMilestone[], dates: Date[], cellWidth: number, width: number) {
  const points = items.map(item => ({ item, left: milestonePosition(item, dates, cellWidth) }))
    .filter((p): p is { item: GanttMilestone; left: number } => p.left !== null).sort((a, b) => a.left - b.left || a.item.id.localeCompare(b.item.id));
  const groups: Array<{ items: GanttMilestone[]; left: number; labelLeft: number; width: number }> = [];
  const labelWidth = (group: GanttMilestone[]) => group.length > 1 ? 64 : Math.min(150, Array.from(group[0].title).reduce((n, c) => n + (/[^\u0000-\u00ff]/.test(c) ? 11 : 7), 12));
  for (const point of points) {
    const last = groups.at(-1);
    if (last && point.left - last.left < Math.max(44, labelWidth(last.items) + 12)) { last.items.push(point.item); continue; }
    groups.push({ items: [point.item], left: point.left, labelLeft: 0, width: 0 });
  }
  // One fixed-height rail. Close dates share a label, but retain their own cuts and dates.
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i], right = i === groups.length - 1 ? width - 4 : groups[i + 1].labelLeft - 6;
    g.width = Math.max(24, Math.min(labelWidth(g.items), i ? right - groups[i - 1].left - 6 : right - 4));
    g.labelLeft = Math.max(4, Math.min(g.left + 8, right - g.width));
  }
  return groups;
}
