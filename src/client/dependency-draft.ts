import { acceptanceId, startId, topologicalOrder, DependencyCycleError, type PathAnalysis } from '../shared/paths';
import type { DependencyChanges } from '../shared/path-contracts';
export function draftNetwork(data: PathAnalysis, changes: DependencyChanges): PathAnalysis {
  if (!changes.add.length && !changes.remove.length && !changes.estimates.length) return data;
  const dependencies = [...data.dependencies.filter(d => !changes.remove.includes(d.id)), ...changes.add.map(({ clientId, ...d }) => ({ ...d, id: clientId, projectId: data.projectId, origin: 'manual' }))];
  const nodes = data.nodes.map(n => {
    const patch = changes.estimates.find(e => e.workItemId === n.id);
    return patch ? { ...n, estimate: { ...n.estimate, ...patch } } : n;
  });
  const edges = data.edges.filter(e => !e.dependencyId && !e.source.startsWith('start:'));
  const internalTargets=new Set(dependencies.filter(d=>d.sourceRequirementId===d.targetRequirementId&&d.sourceWorkItemId&&d.targetWorkItemId).map(d=>d.targetWorkItemId));
  for (const n of nodes.filter(n => n.kind === 'start')) {
    const works = nodes.filter(w => w.kind === 'work' && w.requirementId === n.requirementId);
    if (!works.some(w => w.status !== 'cancelled')) edges.push({ id: n.id + '>' + acceptanceId(n.requirementId!), source: n.id, target: acceptanceId(n.requirementId!), dependencyId: null, critical: false });
    for (const w of works) if (!internalTargets.has(w.id))
      edges.push({ id: n.id + '>' + w.id, source: n.id, target: w.id, dependencyId: null, critical: false });
  }
  dependencies.forEach(d => edges.push({ id: d.id, source: d.sourceWorkItemId || acceptanceId(d.sourceRequirementId), target: d.targetWorkItemId || startId(d.targetRequirementId), dependencyId: d.id, critical: false }));
  return { ...data, nodes, dependencies, edges };
}
export function dependencyIssue(data: PathAnalysis, changes: DependencyChanges) {
  const network = draftNetwork(data, changes);
  try { topologicalOrder(network.nodes.map(n => n.id), network.edges); return null; }
  catch (error) { return { message: (error as Error).message, nodeIds: error instanceof DependencyCycleError ? error.nodeIds : [], edgeIds: error instanceof DependencyCycleError ? error.edgeIds : [] }; }
}
