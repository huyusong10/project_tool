import { deliveryForecast } from '../../shared/forecast-basis';
import type { PathAnalysis, PathMilestone, PathNode } from '../../shared/path-model';

/** One lookup per read snapshot, never cached across requests or writes. */
export function requirementForecastLookup(analysis: PathAnalysis) {
  const nodes = new Map(analysis.nodes.map(node => [node.id, node]));
  const facts = new Map(analysis.requirements.map(requirement => [requirement.id, requirement]));
  const executions = new Map<string, PathNode[]>(), milestones = new Map<string, PathMilestone[]>();
  for (const node of analysis.nodes) if (node.requirementId && ['work','execution'].includes(node.kind) && !['completed','cancelled'].includes(node.status)) {
    const group=executions.get(node.requirementId)||[];group.push(node);executions.set(node.requirementId,group);
  }
  for (const milestone of analysis.milestones||[]) if (milestone.requirementId) {
    const group=milestones.get(milestone.requirementId)||[];group.push(milestone);milestones.set(milestone.requirementId,group);
  }
  return { nodes, facts, milestones,
    delivery(id: string) {
      const result=deliveryForecast(nodes.get('acceptance:'+id),analysis),starts=(executions.get(id)||[]).map(node=>node.forecastStart);
      result.start=starts.length&&starts.every(Boolean)?(starts as string[]).sort()[0]:result.start;
      return result;
    },
    basis(id: string) { return nodes.get('execute:'+id)?.forecastBasis||nodes.get('acceptance:'+id)?.forecastBasis; },
  };
}
