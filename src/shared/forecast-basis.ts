import type {PathAnalysis,PathInput,PathNode} from './paths';
export type ForecastReview = {
  confirmedAt:string; confirmedBy:string; confirmedName?:string; remainingDays:number|null; forecastEnd:string|null;
  progress:number; actualStart:string|null; predecessorBasis:string;
};
export type ForecastBasis = {
  source:string; review:ForecastReview|null; needsReview:boolean; reasons:string[];
  concurrentWorkCount:number;
};
export type ExecutionMetadata = {
  blockerCoordination?:import('./blocker-coordination').BlockerCoordination;
  forecastReview?:ForecastReview|null; forecastBasis?:ForecastBasis;
  blockedCoordinatorId?:string|null; blockedNextReviewAt?:string|null; blockedIssueId?:string|null;
};
/** Only incoming conditions matter; unrelated project edits cannot invalidate a review. */
const predecessorCache=new WeakMap<PathAnalysis,Map<string,string>>();
export function predecessorBasis(nodeId:string,analysis:PathAnalysis) {
  let cache=predecessorCache.get(analysis);
  if(!cache){
    const nodes=new Map(analysis.nodes.map(n=>[n.id,n])),incoming=new Map<string,unknown[][]>();
    const startEdges=new Map<string,typeof analysis.edges>();for(const e of analysis.edges)if(nodes.get(e.target)?.kind==='start'){const a=startEdges.get(e.target)||[];a.push(e);startEdges.set(e.target,a);}
    for(const edge of analysis.edges){for(const e of nodes.get(edge.source)?.kind==='start'?startEdges.get(edge.source)||[]:[edge]){const n=nodes.get(e.source),items=incoming.get(edge.target)||[];items.push([e.id,e.source,n?.status,n?.forecastEnd,n?.complete,n?.unknownReasons]);incoming.set(edge.target,items);}}
    cache=new Map([...incoming].map(([id,items])=>[id,JSON.stringify(items.sort((a,b)=>String(a[0]).localeCompare(String(b[0]))))]));predecessorCache.set(analysis,cache);
  }
  return cache.get(nodeId)||'[]';
}
export function decorateForecastBasis(input:PathInput,analysis:PathAnalysis):PathAnalysis {
  const work=new Map(input.workItems.map(w=>[w.id,w])),requirements=new Map(input.requirements.map(r=>[r.id,r]));
  const activeByPerson=new Map<string,Set<string>>();
  for(const n of analysis.nodes){if(!['work','execution'].includes(n.kind)||!['in_progress','blocked'].includes(n.status))continue;
    for(const id of new Set([n.ownerId,...n.assigneeIds||[]].filter((v):v is string=>!!v))){const set=activeByPerson.get(id)||new Set<string>();set.add(n.id);activeByPerson.set(id,set);}
  }
  for(const n of analysis.nodes){
    const value=n.workItemId?work.get(n.workItemId):n.kind==='execution'?requirements.get(n.requirementId!):undefined;
    n.blockerCoordination=value?.blockerCoordination;
    const review=value?.forecastReview||null,reasons=[...n.unknownReasons];
    if(review&&value){
      if((value.progress||0)<review.progress||(value.actualStart||null)!==review.actualStart)reasons.push('执行基线已变化，请重新核对');
      if(review.predecessorBasis!==predecessorBasis(n.id,analysis))reasons.push('前置交付条件已变化，请重新核对');
      if(review.forecastEnd&&review.forecastEnd<input.asOfDate&&!['completed','cancelled'].includes(n.status))reasons.push('上次确认的预计日期已过期');
    }
    const ended=['completed','cancelled'].includes(n.status);
    n.forecastBasis={source:ended?'实际执行记录':n.kind==='acceptance'?'验收安排':review?'负责人确认；'+n.source:n.source,
      review,reasons:[...new Set(reasons)],needsReview:!ended&&['work','execution'].includes(n.kind)&&(n.critical||n.riskLevel==='high')&&reasons.some(r=>/过期|变化|解除|工期|预测/.test(r)),
      concurrentWorkCount:Math.max(0,...[n.ownerId,...n.assigneeIds||[]].filter((id):id is string=>!!id).map(id=>(activeByPerson.get(id)?.size||0)-Number(activeByPerson.get(id)?.has(n.id))))};
  }
  return analysis;
}
export function nodeForecastBasis(nodes:PathNode[],requirementId:string) {
  return nodes.find(n=>n.id==='execute:'+requirementId)?.forecastBasis||nodes.find(n=>n.id==='acceptance:'+requirementId)?.forecastBasis;
}
