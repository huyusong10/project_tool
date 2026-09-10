import type {PathAnalysis,PathInput,PathNode} from './paths';
export type ForecastReview = {
  confirmedAt:string; confirmedBy:string; confirmedName?:string; remainingDays:number|null; forecastEnd:string|null;
  progress:number; actualStart:string|null; predecessorBasis:string;
  invalidatedAt?:string;
};
export type ForecastBasis = {
  source:string; review:ForecastReview|null; needsReview:boolean; reasons:string[];
  concurrentWorkCount:number;
  concurrentWork?:Array<{id:string;requirementId:string|null;title:string;requirementTitle:string;forecastEnd:string|null;critical:boolean}>;
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
  const nodesById=new Map(analysis.nodes.map(n=>[n.id,n]));
  const concurrencyGroups=new Map<string,{ids:Set<string>;sample:PathNode[]}>();
  for(const n of analysis.nodes){
    const value=n.workItemId?work.get(n.workItemId):n.kind==='execution'?requirements.get(n.requirementId!):undefined;
    n.blockerCoordination=value?.blockerCoordination;
    const reasons=[...n.unknownReasons];
    const ended=['completed','cancelled'].includes(n.status);
    const people=[...new Set([n.ownerId,...n.assigneeIds||[]].filter((id):id is string=>!!id))].sort(),groupKey=JSON.stringify(people);
    let group=concurrencyGroups.get(groupKey);
    if(!group){const ids=new Set(people.flatMap(id=>[...activeByPerson.get(id)||[]]));group={ids,sample:[...ids].slice(0,11).map(id=>nodesById.get(id)!)};concurrencyGroups.set(groupKey,group);}
    n.forecastBasis={source:ended?'实际执行记录':n.source,
      review:null,reasons:[...new Set(reasons)],needsReview:false,
      concurrentWorkCount:group.ids.size-Number(group.ids.has(n.id)),concurrentWork:group.sample.filter(item=>item.id!==n.id).slice(0,10).map(item=>({id:item.id,requirementId:item.requirementId,title:item.title,requirementTitle:requirements.get(item.requirementId||'')?.title||'',forecastEnd:item.forecastEnd,critical:item.critical}))};
  }
  const executions=new Map<string,PathNode[]>();
  for(const n of analysis.nodes)if(n.requirementId&&['work','execution'].includes(n.kind)&&n.status!=='cancelled'){const group=executions.get(n.requirementId)||[];group.push(n);executions.set(n.requirementId,group);}
  for(const r of analysis.requirements){const work=executions.get(r.id)||[],acceptance=nodesById.get('acceptance:'+r.id);Object.assign(r,{executionForecastEnd:work.length&&work.every(n=>n.forecastEnd)?work.map(n=>n.forecastEnd!).sort().at(-1):null,acceptanceForecastEnd:acceptance?.forecastEnd||null,acceptanceAssumed:acceptance?.source==='假设工作完成后当日验收'});}
  return analysis;
}
export function nodeForecastBasis(nodes:PathNode[],requirementId:string) {
  return nodes.find(n=>n.id==='execute:'+requirementId)?.forecastBasis||nodes.find(n=>n.id==='acceptance:'+requirementId)?.forecastBasis;
}
