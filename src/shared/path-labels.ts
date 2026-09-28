import { dependencySource, dependencyTarget, type Dependency, type PathAnalysis } from './paths';
export function endpointName(data: PathAnalysis, id: string, qualified = true): string {
  const node = data.nodes.find(n => n.id === id);
  if (!node) return '已失效交付点';
  const name = node.kind === 'acceptance' ? '整个需求完成' : node.kind === 'start' ? '整个需求开始' : node.title;
  const requirement = data.requirements.find(r => r.id === node.requirementId);
  return qualified && requirement ? `${requirement.title} · ${name}` : name;
}
export function relationDescription(data: PathAnalysis, relation: Dependency): string {
  return `${endpointName(data, dependencySource(relation))} → ${endpointName(data, dependencyTarget(relation))}`;
}
export function relationCaption(data: PathAnalysis, relation: Dependency): string {
  const specificSource = relation.sourceWorkItemId || relation.sourceMilestoneId;
  const specificTarget = relation.targetWorkItemId || relation.targetMilestoneId;
  if (!specificSource && !specificTarget) return '需求完成后开始';
  const source = specificSource ? endpointName(data, specificSource, false) : '需求完成';
  return specificTarget ? `${source} → ${endpointName(data, specificTarget, false)}` : `${source}后开始`;
}
export function compactRelationCaption(label: string): string {
  const letters = Array.from(label);
  return letters.length > 22 ? letters.slice(0, 21).join('') + '…' : label;
}
