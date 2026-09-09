import { acceptanceId, startId, dependencySource, dependencyTarget, type Dependency, type PathAnalysis } from '../shared/paths';
import type { DependencyChanges } from '../shared/path-contracts';
import { dependencyIssue } from './dependency-draft';

export type RelationSide = 'source' | 'target';
export function endpointName(data: PathAnalysis, id: string, qualified = true): string {
  const node = data.nodes.find(n => n.id === id);
  if (!node) return '已失效交付点';
  const name = node.kind === 'acceptance' ? '整需求验收' : node.kind === 'start' ? '整个需求开始' : node.title;
  const requirement = data.requirements.find(r => r.id === node.requirementId);
  return qualified && requirement ? `${requirement.title} · ${name}` : name;
}
export function relationDescription(data: PathAnalysis, relation: Dependency): string {
  return `${endpointName(data, dependencySource(relation))} → ${endpointName(data, dependencyTarget(relation))}`;
}
export function relationCaption(data: PathAnalysis, relation: Dependency): string {
  const specificSource = relation.sourceWorkItemId || relation.sourceMilestoneId;
  const specificTarget = relation.targetWorkItemId || relation.targetMilestoneId;
  if (!specificSource && !specificTarget) return '验收后开始';
  const source = specificSource ? endpointName(data, specificSource, false) : '验收';
  return specificTarget ? `${source} → ${endpointName(data, specificTarget, false)}` : `${source}后开始`;
}
export function compactRelationCaption(label: string): string {
  const letters = Array.from(label);
  return letters.length > 22 ? letters.slice(0, 21).join('') + '…' : label;
}
export function relationEndpoints(data: PathAnalysis, relation: Dependency, side: RelationSide) {
  const requirementId = side === 'source' ? relation.sourceRequirementId : relation.targetRequirementId;
  const current = side === 'source' ? dependencySource(relation) : dependencyTarget(relation);
  const gate = side === 'source' ? acceptanceId(requirementId) : startId(requirementId);
  return data.nodes.filter(n => requirementId ? n.requirementId === requirementId && (n.id === gate || n.kind === 'work' || n.kind === 'milestone') : n.id === current)
    .sort((a,b) => Number(b.id === gate) - Number(a.id === gate))
    .map(n => ({id:n.id, title:endpointName(data,n.id,false), kind:n.kind, disabled:side === 'target' && ['completed','cancelled'].includes(n.status)}));
}

/** One replacement removes the old condition before validating the final execution network. */
export function replaceDeliveryCondition(data: PathAnalysis, changes: DependencyChanges, id: string, source: string, target: string, newId: string) {
  const original = data.dependencies.find(d => d.id === id);
  const fail = (message: string, edgeIds: string[] = []) => ({issue:{message,nodeIds:[source,target],edgeIds}});
  if (!original) return fail('这条关系已失效，请重新选择');
  const a = data.nodes.find(n => n.id === source), b = data.nodes.find(n => n.id === target);
  if (!a || !b || !relationEndpoints(data,original,'source').some(n => n.id === source) || !relationEndpoints(data,original,'target').some(n => n.id === target)) return fail('交付点已失效或不属于当前关系的需求');
  if (source === dependencySource(original) && target === dependencyTarget(original)) return {changes,relationId:id};
  if (source === target) return fail('不能依赖自身');
  if (['completed','cancelled'].includes(b.status) || data.requirements.some(r => r.id === b.requirementId && ['completed','cancelled'].includes(r.status))) return fail('已结束的交付不能调整前置关系');
  const duplicate = data.dependencies.find(d => d.id !== id && dependencySource(d) === source && dependencyTarget(d) === target);
  if (duplicate) return fail('已存在相同交付条件，当前关系未修改', [duplicate.id]);
  const clientId = changes.add.some(d => d.clientId === id) ? id : newId;
  const next = {clientId,sourceRequirementId:a.requirementId||'',sourceWorkItemId:a.kind==='work'?a.id:null,sourceMilestoneId:a.kind==='milestone'?a.id:null,
    targetRequirementId:b.requirementId||'',targetWorkItemId:b.kind==='work'?b.id:null,targetMilestoneId:b.kind==='milestone'?b.id:null};
  const issue = dependencyIssue(data, {add:[next],remove:[id],estimates:[]});
  if (issue) return {issue};
  return {relationId:clientId,changes:{...changes,add:[...changes.add.filter(d => d.clientId !== id),next],
    remove:changes.add.some(d => d.clientId === id) ? changes.remove : [...new Set([...changes.remove,id])]}};
}
