import { topologicalOrder } from './paths';
export type TemplateDependencyItem = { id?: string; clientKey?: string; predecessorKeys?: string[]; title: string; startOffsetDays: number; durationDays: number };
/** Offsets are derived output for compatibility with existing date generation and template Gantt. */
export function resolveTemplateOffsets<T extends TemplateDependencyItem>(items: T[]): T[] {
  const keyed = items.map((item, index) => ({ item, key: item.clientKey || item.id || String(index) }));
  if (new Set(keyed.map(x => x.key)).size !== keyed.length) throw new Error('流程工作项标识重复');
  const edges = keyed.flatMap(({ item, key }) => (item.predecessorKeys || []).map(source => ({ source, target: key })));
  const order = topologicalOrder(keyed.map(x => x.key), edges), byKey = new Map(keyed.map(x => [x.key, x.item]));
  const end = new Map<string, number>();
  for (const key of order) { const item = byKey.get(key)!; item.startOffsetDays = Math.max(0, ...(item.predecessorKeys || []).map(id => end.get(id)!)); end.set(key, item.startOffsetDays + item.durationDays); }
  return items;
}
export function suggestTemplatePredecessors<T extends TemplateDependencyItem>(items: T[]): T[] {
  return items.map((item, index) => {
    const candidates = items.map((p,i) => ({p,i})).filter(({p,i}) => i !== index && p.startOffsetDays+p.durationDays<=item.startOffsetDays);
    const closest = Math.max(-1, ...candidates.map(({p}) => p.startOffsetDays+p.durationDays));
    return { ...item, predecessorKeys: candidates.filter(({p})=>p.startOffsetDays+p.durationDays===closest).map(({p,i})=>p.clientKey||p.id||String(i)) };
  });
}
