import { topologicalOrder } from '../shared/paths';
import type { TemplateItem, WorkItemTemplate } from './types';

export function templateOverview(template: Pick<WorkItemTemplate, 'items' | 'dependencyMode'>) {
  const items = template.items.filter(item => !item.deletedAt);
  const migrated = new Set(items.filter(item => item.kind === 'milestone').map(item => item.id));
  const explicit = new Set(items.filter(item => item.kind === 'milestone').flatMap(item => (item.predecessorIds || []).map(id => id + '\0' + item.title)));
  const nodes: TemplateItem[] = items.flatMap(item => {
    const legacy = item.kind !== 'milestone' && item.milestoneLabel && !migrated.has('milestone:' + item.id) && !explicit.has(item.id + '\0' + item.milestoneLabel);
    return legacy ? [item, { ...item, id: 'legacy-milestone:' + item.id, kind: 'milestone', title: item.milestoneLabel!, startOffsetDays: item.startOffsetDays + item.durationDays, durationDays: 0, predecessorIds: [item.id], milestoneLabel: null }] : [item];
  });
  const dependencies = template.dependencyMode === 'dependencies' || items.some(item => item.predecessorIds?.length);
  const edges = nodes.flatMap(item => (item.predecessorIds || []).map(source => ({ source, target: item.id })));
  const ranks = new Map<string, number>();
  let invalidDependencies = false;
  try {
    for (const id of topologicalOrder(nodes.map(item => item.id), edges)) {
      const predecessors = edges.filter(edge => edge.target === id);
      ranks.set(id, predecessors.length ? Math.max(...predecessors.map(edge => ranks.get(edge.source)! + 1)) : 0);
    }
  } catch { invalidDependencies = true; }
  const groups = new Map<number, TemplateItem[]>();
  for (const item of nodes) {
    const rank = dependencies && !invalidDependencies ? ranks.get(item.id)! : item.startOffsetDays;
    groups.set(rank, [...(groups.get(rank) || []), item]);
  }
  return {
    nodes, edges: dependencies && !invalidDependencies ? edges : [], dependencies, invalidDependencies,
    levels: [...groups.entries()].sort(([a], [b]) => a - b).map(([rank, items]) => ({ rank, items })),
    workCount: nodes.filter(item => item.kind !== 'milestone').length,
    milestoneCount: nodes.filter(item => item.kind === 'milestone').length,
    // 并行工作不能累加工期；里程碑位于偏移边界，不额外占用一天。
    span: Math.max(0, ...nodes.map(item => item.startOffsetDays + (item.kind === 'milestone' ? 0 : item.durationDays))),
  };
}

export type TemplateOverview = ReturnType<typeof templateOverview>;
