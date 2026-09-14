import type {DependencyChanges} from './path-contracts';
import type {PathAnalysis} from './paths';
export type ExecutionCommand = {requirementId:string;workItemId?:string;action?:string;phaseId?:string};
const descriptive=new Set(['featureId','title','background','referenceUrl','reason','priority']);
/** Execution only waits for edits to facts or conditions it actually consumes. */
export function executionDraftConflicts(changes:DependencyChanges,graph:PathAnalysis|undefined,command:ExecutionCommand):string[] {
  const own=new Set([command.requirementId,...(command.workItemId?[command.workItemId]:graph?.nodes.filter(n=>n.requirementId===command.requirementId).map(n=>n.id)||[])]);
  if(command.phaseId){for(const r of graph?.requirements||[])if(r.phaseId===command.phaseId)own.add(r.id);for(const c of changes.entities||[])if(c.entity==='requirement'&&c.data.phaseId===command.phaseId)own.add(c.id);for(const n of graph?.nodes||[])if(n.requirementId&&own.has(n.requirementId))own.add(n.id);}
  const ids=new Set(own),conditionActions=new Set(['start','accept','submit-acceptance','complete','rework','reopen','cancel','archive','structure','phase']);
  if(conditionActions.has(command.action||'structure')&&graph){
    const start=command.workItemId||'acceptance:'+command.requirementId;
    ids.add(start);ids.add('start:'+command.requirementId);
    const incoming=new Map<string,string[]>();for(const e of graph.edges){const a=incoming.get(e.target)||[];a.push(e.source);incoming.set(e.target,a);}
    const queue=[...ids];for(let i=0;i<queue.length;i++)for(const source of incoming.get(queue[i])||[])if(!ids.has(source)){ids.add(source);queue.push(source);}
    for(const id of [...ids]){const n=graph.nodes.find(n=>n.id===id);if(n?.requirementId)ids.add(n.requirementId);}
  }
  const conflicts:string[]=[];
  for(const c of changes.entities||[]){
    const touches=ids.has(c.id)||c.entity!=='requirement'&&!command.workItemId&&own.has(c.requirementId||'');
    if(!touches)continue;
    if(c.op!=='update'||Object.keys(c.data).some(k=>!descriptive.has(k)||command.action==='phase'))conflicts.push(c.data.title||graph?.requirements.find(r=>r.id===c.id)?.title||graph?.nodes.find(n=>n.id===c.id)?.title||'当前对象');
  }
  for(const e of changes.estimates)if(ids.has(e.workItemId))conflicts.push(graph?.nodes.find(n=>n.id===e.workItemId)?.title||'工作项估算');
  if(conditionActions.has(command.action||'structure')){
    const edges=[...changes.add,...(graph?.dependencies.filter(d=>changes.remove.includes(d.id))||[])];
    if(changes.remove.length&&!graph)conflicts.push('前置关系');
    for(const e of edges){const target=e.targetMilestoneId||e.targetWorkItemId||e.targetRequirementId;if(ids.has(target))conflicts.push('影响本次操作的交付关系');}
  }
  return [...new Set(conflicts)];
}
