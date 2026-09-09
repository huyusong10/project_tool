import { topologicalOrder } from './paths';
import {arrangeLate,type Arrangement} from './late-schedule';
export type TemplateDependencyItem = { id?: string; clientKey?: string; predecessorKeys?: string[]; title: string; startOffsetDays: number; durationDays: number;kind?:'work'|'milestone';arrangement?:Arrangement;arrangementAnchor?:string|null;confirmationMode?:'auto'|'manual' };
/** Offsets are derived output for compatibility with existing date generation and template Gantt. */
export function resolveTemplateOffsets<T extends TemplateDependencyItem>(items: T[]): T[] {
  const keyed = items.map((item, index) => ({ item, key: item.clientKey || item.id || String(index) }));
  if (new Set(keyed.map(x => x.key)).size !== keyed.length) throw new Error('流程工作项标识重复');
  const edges = keyed.flatMap(({ item, key }) => (item.predecessorKeys || []).map(source => ({ source, target: key })));
  const order = topologicalOrder(keyed.map(x => x.key), edges), byKey = new Map(keyed.map(x => [x.key, x.item]));
  const end = new Map<string, number>();
  for (const key of order) { const item = byKey.get(key)!;if(item.kind==='milestone')item.durationDays=0;else if(item.durationDays<1)throw new Error('工作项工期至少一个工作日'); item.startOffsetDays = Math.max(0, ...(item.predecessorKeys || []).map(id => end.get(id)!)); end.set(key, item.startOffsetDays + item.durationDays); }
  const finish='__template_finish__',targets=new Set(edges.map(e=>e.source));
  const arranged=arrangeLate([...order,finish],[...keyed.map(({key,item})=>({id:key,start:item.startOffsetDays,finish:end.get(key)!,duration:item.durationDays,arrangement:item.arrangement,anchor:item.arrangementAnchor,movable:item.kind!=='milestone',reliable:true})),{id:finish,start:Math.max(0,...end.values()),finish:Math.max(0,...end.values()),duration:0,movable:false,reliable:true}],[...edges,...order.filter(id=>!targets.has(id)).map(source=>({source,target:finish}))]);
  for(const {key,item} of keyed)item.startOffsetDays=arranged.get(key)!.start;
  return items;
}
export function suggestTemplatePredecessors<T extends TemplateDependencyItem>(items: T[]): T[] {
  return items.map((item, index) => {
    const candidates = items.map((p,i) => ({p,i})).filter(({p,i}) => i !== index && (p.durationDays>0||p.startOffsetDays<item.startOffsetDays) && p.startOffsetDays+p.durationDays<=item.startOffsetDays);
    const closest = Math.max(-1, ...candidates.map(({p}) => p.startOffsetDays+p.durationDays));
    return { ...item, predecessorKeys: candidates.filter(({p})=>p.startOffsetDays+p.durationDays===closest).map(({p,i})=>p.clientKey||p.id||String(i)) };
  });
}
