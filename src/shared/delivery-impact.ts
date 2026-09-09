import type {PathAnalysis} from './paths';
export type DeliveryTargetChange = {before:{label:string;date:string|null;forecast:string|null;complete:boolean};after:{label:string;date:string|null;forecast:string|null;complete:boolean}};
export function deliveryTargetChange(before:PathAnalysis,after:PathAnalysis):DeliveryTargetChange{
  const value=(a:PathAnalysis)=>({label:a.targetLabel,date:a.targetDate,forecast:a.forecastEnd,complete:a.complete});
  return {before:value(before),after:value(after)};
}
export type DeliveryImpact = {
  requirementId:string;title:string;ownerId:string|null;ownerName:string|null;
  beforeSources:Array<{id:string;title:string;ownerName:string|null}>;afterSources:Array<{id:string;title:string;ownerName:string|null}>;outsideExecuting:boolean;
  beforeScope:string;afterScope:string;beforeForecast:string|null;afterForecast:string|null;
  beforeRisk:string;afterRisk:string;beforePriority:string|null;afterPriority:string|null;
  beforeBuffer:number|null;afterBuffer:number|null;reasons:string[];
};
export function deliveryImpact(before:PathAnalysis,after:PathAnalysis):DeliveryImpact[]{
  const ids=new Set([...before.requirements.map(r=>r.id),...after.requirements.map(r=>r.id)]),result:DeliveryImpact[]=[];
  for(const id of ids){
    const a=before.requirements.find(r=>r.id===id),b=after.requirements.find(r=>r.id===id),r=b||a!;
    const an=before.nodes.find(n=>n.id==='acceptance:'+id),bn=after.nodes.find(n=>n.id==='acceptance:'+id),ar=before.risks[id],br=after.risks[id];
    const sources=(graph:PathAnalysis)=>graph.blockers.filter(b=>b.requirementId===id||b.affectedRequirementIds.includes(id)).map(b=>({id:b.nodeId,title:b.title,ownerName:b.ownerName}));
    const value:DeliveryImpact={beforeSources:sources(before),afterSources:sources(after),outsideExecuting:r.deliveryScope==='candidate'&&['in_progress','blocked','pending_acceptance'].includes(r.status),requirementId:id,title:r.title,ownerId:r.status==='pending_acceptance'?r.acceptanceOwnerId||null:r.ownerId||null,ownerName:r.status==='pending_acceptance'?r.acceptanceOwnerName||'项目经理':r.ownerName,beforeScope:a?.deletedAt||!a?'absent':a.deliveryScope||'committed',afterScope:b?.deletedAt||!b?'absent':b.deliveryScope||'committed',beforeForecast:an?.forecastEnd||null,afterForecast:bn?.forecastEnd||null,beforeRisk:ar?.riskEvaluated?ar.riskLevel:'unknown',afterRisk:br?.riskEvaluated?br.riskLevel:'unknown',beforePriority:ar?.processingPriority||null,afterPriority:br?.processingPriority||null,beforeBuffer:ar?.minFloat??null,afterBuffer:br?.minFloat??null,reasons:[...new Set([...(bn?.unknownReasons||[]),...(br?.priorityReasons||[]),...(br?.riskReason?[br.riskReason]:[])])]};
    const changed=JSON.stringify(value.beforeSources)!==JSON.stringify(value.afterSources)||value.beforeScope!==value.afterScope||value.beforeForecast!==value.afterForecast||value.beforeRisk!==value.afterRisk||value.beforePriority!==value.afterPriority||value.beforeBuffer!==value.afterBuffer||a?.executionMode!==b?.executionMode||JSON.stringify(an?.unknownReasons)!==JSON.stringify(bn?.unknownReasons)||a?.ownerId!==b?.ownerId||a?.acceptanceOwnerId!==b?.acceptanceOwnerId;
    if(changed)result.push(value);
  }
  return result;
}
