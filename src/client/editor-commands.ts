import {randomUUID} from './random-uuid';
import type {DependencyChanges,EditorEntityChange} from '../shared/path-contracts';
import {dependencySource,dependencyTarget,type PathAnalysis} from '../shared/paths';
import {isDraftTemplateId} from '../shared/template-instance';
export function changeEntity(changes:DependencyChanges,change:EditorEntityChange):DependencyChanges{
  const old=changes.entities?.find(c=>c.id===change.id);
  return {...changes,entities:[...(changes.entities||[]).filter(c=>c.id!==change.id),{...old,...change,op:old?.op==='create'?'create':change.op,data:{...old?.data,...change.data}}]};
}
export function deleteEntities(data:PathAnalysis,changes:DependencyChanges,ids:string[]):DependencyChanges{
  const removed=new Set(ids);for(const n of data.nodes)if(n.requirementId&&removed.has(n.requirementId))removed.add(n.id);
  for(const c of changes.entities||[])if(c.requirementId&&removed.has(c.requirementId))removed.add(c.id);
  const edges=data.dependencies.filter(d=>removed.has(dependencySource(d))||removed.has(dependencyTarget(d))||removed.has(d.sourceRequirementId)||removed.has(d.targetRequirementId));
  const creates=new Set(changes.entities?.filter(c=>c.op==='create').map(c=>c.id));
  const entities=(changes.entities||[]).filter(c=>!removed.has(c.id));
  const removedTemplates=(changes.entities||[]).filter(c=>removed.has(c.id));
  for(const id of ids){if(creates.has(id))continue;const r=data.requirements.find(r=>r.id===id),n=data.nodes.find(n=>n.id===id),m=data.milestones?.find(m=>m.id===id);if(!r&&!n)continue;if(n&&['start','acceptance','project','execution'].includes(n.kind))continue;entities.push({entity:r?'requirement':m?'milestone':'work',op:'delete',id,requirementId:n?.requirementId,expectedVersion:r?.version||m?.version||n?.version,data:{}});}
  return {...changes,entities,add:changes.add.filter(d=>!edges.some(e=>e.id===d.clientId)),remove:[...new Set([...changes.remove,...edges.filter(d=>!changes.add.some(e=>e.clientId===d.id)).map(d=>d.id)])].filter(id=>!isDraftTemplateId(id,removedTemplates)),estimates:changes.estimates.filter(e=>!removed.has(e.workItemId)),layouts:changes.layouts?.filter(l=>!l.scope.startsWith('requirement:')||!removed.has(l.scope.slice(12))).map(l=>({...l,positions:Object.fromEntries(Object.entries(l.positions).filter(([id])=>!removed.has(id)))}))};
}
export function copyEntities(data:PathAnalysis,changes:DependencyChanges,selected:string[],requirementId?:string){
  const mapping:Record<string,string>={},entities:EditorEntityChange[]=[],requirements=data.requirements.filter(r=>selected.includes(r.id));
  for(const r of requirements){const id=randomUUID();mapping[r.id]=id;entities.push({entity:'requirement',op:'create',id,data:{title:r.title+' 副本',executionMode:r.executionMode||'work_items',deliveryScope:r.deliveryScope||'committed',durationDays:r.durationDays,priority:r.priority as 'P2',ownerId:r.ownerId,background:r.background,acceptanceCriteria:r.acceptanceCriteria,referenceUrl:r.referenceUrl}});}
  for(const n of data.nodes.filter(n=>['work','milestone'].includes(n.kind)&&n.status!=='cancelled'&&(selected.includes(n.id)||!!n.requirementId&&!!mapping[n.requirementId]))){
    const id=randomUUID();mapping[n.id]=id;const req=n.requirementId&&mapping[n.requirementId]||requirementId||n.requirementId;
    entities.push({entity:n.kind==='milestone'?'milestone':'work',op:'create',id,requirementId:req,data:n.kind==='milestone'?{title:n.title+(selected.includes(n.id)?' 副本':''),confirmationMode:data.milestones?.find(m=>m.id===n.id)?.confirmationMode||'auto'}:{title:n.title+(selected.includes(n.id)?' 副本':''),ownerId:n.ownerId,assigneeIds:n.assigneeIds,durationDays:n.estimate.durationDays,arrangement:n.arrangement||'early',arrangementAnchor:n.arrangementAnchor,reason:'复制工作项'}});
  }
  for(const c of entities)if(c.data.arrangementAnchor)c.data.arrangementAnchor=mapping[c.data.arrangementAnchor]||null;
  const add=data.dependencies.filter(d=>(mapping[d.sourceMilestoneId||d.sourceWorkItemId||d.sourceRequirementId])&&(mapping[d.targetMilestoneId||d.targetWorkItemId||d.targetRequirementId])).map(d=>({clientId:randomUUID(),sourceRequirementId:mapping[d.sourceRequirementId]||requirementId||d.sourceRequirementId,targetRequirementId:mapping[d.targetRequirementId]||requirementId||d.targetRequirementId,sourceWorkItemId:mapping[d.sourceWorkItemId||'']||null,targetWorkItemId:mapping[d.targetWorkItemId||'']||null,sourceMilestoneId:mapping[d.sourceMilestoneId||'']||null,targetMilestoneId:mapping[d.targetMilestoneId||'']||null}));
  return {mapping,changes:{...changes,entities:[...(changes.entities||[]),...entities],add:[...changes.add,...add]}};
}
