import { acceptanceId, startId, topologicalOrder, DependencyCycleError,dependencySource,dependencyTarget, type PathAnalysis,type PathNode,type PathRequirement } from '../shared/paths';
import type { DependencyChanges } from '../shared/path-contracts';
import {applyFeatureRelationDraft} from '../shared/features';
import {templateInstanceKey,type DraftTemplateInstance} from '../shared/template-instance';
export function draftNetwork(data: PathAnalysis, changes: DependencyChanges, instances:DraftTemplateInstance[]=[]): PathAnalysis {
  if (!changes.add.length && !changes.remove.length && !changes.estimates.length&&!changes.entities?.length&&!changes.layouts?.length&&!changes.featureRelations?.length) return data;
  const templates=instances.filter(t=>changes.entities?.some(c=>c.entity==='requirement'&&c.op==='create'&&t.key===templateInstanceKey(c)));
  const dependencies = [...data.dependencies,...templates.flatMap(t=>t.dependencies)].filter(d=>!changes.remove.includes(d.id)).concat(changes.add.map(({ clientId, ...d }) => ({ ...d, id: clientId, projectId: data.projectId, origin: 'manual' })));
  let nodes = data.nodes.map(n => ({...n}));
  let requirements=data.requirements.map(r=>({...r})),milestones=[...(data.milestones||[])];const risks={...data.risks};
  const addNode=(id:string,requirementId:string|null,kind:PathNode['kind'],title:string):PathNode=>({id,requirementId,kind,title,workItemId:kind==='work'?id:null,status:'not_started',ownerName:null,milestoneLabel:null,plannedStart:null,plannedEnd:null,forecastStart:null,forecastEnd:null,remainingDays:kind==='work'?1:0,earliestStart:0,earliestFinish:0,floatDays:null,critical:false,planCritical:false,nearCritical:false,inScope:false,unknownReasons:['未保存预览'],ownReasons:[],source:'草稿',riskLevel:'low',complete:false,estimate:{durationDays:kind==='work'?1:null,earliestStart:null,unblockEstimate:null,forecastEnd:null}});
  for(const c of [...(changes.entities||[]).filter(c=>c.entity==='requirement'),...templates.flatMap(t=>t.entities),...(changes.entities||[]).filter(c=>c.entity!=='requirement')]){
    if(c.entity==='requirement'){
      if(c.op==='create'){
        requirements.push({id:c.id,projectId:data.projectId,title:c.data.title||'未命名需求',status:'not_started',priority:c.data.priority||'P2',ownerName:null,plannedStart:null,plannedEnd:null,acceptedAt:null,dependenciesReviewedAt:null,scheduleAnchor:null,forecastAcceptance:null,deletedAt:null,...c.data} as PathRequirement);
        nodes.push(addNode(startId(c.id),c.id,'start','开始条件'),addNode(acceptanceId(c.id),c.id,'acceptance','工作完成'));
        risks[c.id]={riskLevel:'low',riskEvaluated:false,riskReason:'未保存需求',highRisk:false,critical:false,criticalCount:0,minFloat:null,blockedCritical:false,complete:false};
      }else if(c.op==='update')requirements=requirements.map(r=>r.id===c.id?{...r,...c.data}:r);
      else {requirements=requirements.filter(r=>r.id!==c.id);nodes=nodes.filter(n=>n.requirementId!==c.id);}
    }else {
      if(c.op==='create'){const n=addNode(c.id,c.requirementId||null,c.entity==='milestone'?'milestone':'work',c.data.title||'未命名');Object.assign(n,c.data);n.estimate.durationDays=c.entity==='work'?(c.data.durationDays===undefined?1:c.data.durationDays):null;nodes.push(n);if(c.entity==='milestone')milestones.push({id:c.id,projectId:data.projectId,requirementId:c.requirementId||null,milestoneKind:c.data.milestoneKind||'ordinary',title:n.title,targetDate:c.data.targetDate||null,confirmationMode:c.data.confirmationMode||'auto',achievedAt:null,version:1});}
      else if(c.op==='update'){nodes=nodes.map(n=>n.id===c.id?{...n,...c.data,estimate:{...n.estimate,...c.data.durationDays!==undefined?{durationDays:c.data.durationDays}:{}}}:n);milestones=milestones.map(m=>m.id===c.id?{...m,...c.data}:m);}
      else {nodes=nodes.filter(n=>n.id!==c.id);milestones=milestones.filter(m=>m.id!==c.id);}
    }
  }
  for(const r of requirements)r.executionMode=nodes.some(n=>n.requirementId===r.id&&n.kind==='work')?'work_items':'direct';
  nodes=nodes.filter(n=>n.kind!=='execution'||requirements.some(r=>r.id===n.requirementId&&r.executionMode==='direct'));
  for(const r of requirements)if(r.executionMode==='direct'){
    const old=nodes.find(n=>n.id==='execute:'+r.id),n=old||addNode('execute:'+r.id,r.id,'execution',r.title);
    Object.assign(n,{title:r.title,status:r.status,ownerId:r.ownerId,ownerName:r.ownerName,estimate:{...n.estimate,durationDays:r.durationDays??null,forecastEnd:r.forecastEnd??null,unblockEstimate:r.unblockEstimate??null}});
    if(!old)nodes.push(n);
  }
  // Estimates apply after entity edits, matching the server's final snapshot, including new nodes.
  const estimates=new Map(changes.estimates.map(p=>[p.workItemId,p]));
  nodes=nodes.map(n=>{
    const patch=estimates.get(n.id);if(!patch)return n;
    const {workItemId:_workItemId,reviewForecast:_reviewForecast,arrangement,arrangementAnchor,...estimate}=patch;
    return {...n,estimate:{...n.estimate,...estimate},...arrangement!==undefined?{arrangement}:{},...arrangementAnchor!==undefined?{arrangementAnchor}:{}};
  });
  const nodeIds=new Set(nodes.map(n=>n.id)),edges = data.edges.filter(e => !e.dependencyId && !e.source.startsWith('start:')&&nodeIds.has(e.source)&&nodeIds.has(e.target));
  for(const n of nodes)if(n.requirementId&&['work','execution'].includes(n.kind)&&!edges.some(e=>e.source===n.id&&e.target===acceptanceId(n.requirementId!)))edges.push({id:n.id+'>'+acceptanceId(n.requirementId),source:n.id,target:acceptanceId(n.requirementId),dependencyId:null,critical:false});
  const internalTargets=new Set(dependencies.filter(d=>d.sourceRequirementId===d.targetRequirementId&&(d.sourceWorkItemId||d.sourceMilestoneId)&&d.targetWorkItemId).map(d=>d.targetWorkItemId));
  for (const n of nodes.filter(n => n.kind === 'start')) {
    const works = nodes.filter(w => ['work','execution'].includes(w.kind) && w.requirementId === n.requirementId);
    if (!works.some(w => w.status !== 'cancelled')) edges.push({ id: n.id + '>' + acceptanceId(n.requirementId!), source: n.id, target: acceptanceId(n.requirementId!), dependencyId: null, critical: false });
    for (const w of works) if (!internalTargets.has(w.id))
      edges.push({ id: n.id + '>' + w.id, source: n.id, target: w.id, dependencyId: null, critical: false });
  }
  dependencies.forEach(d => edges.push({ id: d.id, source:dependencySource(d), target:dependencyTarget(d), dependencyId: d.id, critical: false }));
  const featureContext=data.featureContext?{...data.featureContext,relations:applyFeatureRelationDraft(data.featureContext.relations,changes.featureRelations||[],data.projectId),requirements:[...data.featureContext.requirements.filter(r=>r.deletedAt),...requirements]}:undefined;
  return { ...data,featureContext, nodes, dependencies, edges,requirements,risks,milestones,layouts:[...(data.layouts||[]).filter(l=>!changes.layouts?.some(c=>c.scope===l.scope&&c.direction===l.direction)),...(changes.layouts||[]).map(l=>({...l,version:l.expectedVersion}))] };
}
export function dependencyIssue(data: PathAnalysis, changes: DependencyChanges,instances:DraftTemplateInstance[]=[]) {
  const network = draftNetwork(data, changes,instances);
  try { topologicalOrder(network.nodes.map(n => n.id), network.edges); return null; }
  catch (error) { return { kind:error instanceof DependencyCycleError?'cycle' as const:undefined, message: (error as Error).message, nodeIds: error instanceof DependencyCycleError ? error.nodeIds : [], edgeIds: error instanceof DependencyCycleError ? error.edgeIds : [] }; }
}
