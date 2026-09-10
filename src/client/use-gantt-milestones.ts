import type { PathAnalysis } from '../shared/paths';
import { useMemo } from 'react';
import { keys } from './query-keys';
import { useResourceQuery } from './use-resource-query';

/** One existing project snapshot supplies milestone dates and real predecessor links. */
export function useGanttMilestoneData(projectId?: string) {
  const data = useResourceQuery<PathAnalysis>([...keys.paths, projectId, 'all', 'project'],
    `/api/projects/${projectId}/path-analysis?target=project`, !!projectId).data;
  return useMemo(() => {
    if (!data) return data;
    const nodes = new Map(data.nodes?.map(n => [n.id, n]));
    return { ...data, milestones: data.milestones?.map(m => ({ ...m, forecastEnd: nodes.has(m.id) ? nodes.get(m.id)!.forecastEnd : m.forecastEnd })) };
  }, [data]);
}
