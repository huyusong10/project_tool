import { acceptanceId, type PathAnalysis } from '../shared/paths';
import type { LayoutEdge } from './path-layout';
import {compactRelationCaption,relationCaption,relationDescription} from './path-relations';
export type GraphCard = { id:string; requirementId:string; workItemId:string|null; kind:string; title:string; subtitle:string; status:string; risk:string;
  forecast:string|null; floatDays:number|null; critical:boolean; unknown:boolean; external:boolean; hiddenCount:number };
export type GraphLink = LayoutEdge & {critical:boolean; dependencyIds:string[];description?:string};
export function projectPathGraph(a:PathAnalysis, focus?:string, attention=false):{cards:GraphCard[];links:GraphLink[]} {
  const nodeMap=new Map(a.nodes.map(n=>[n.id,n]));
  if(!focus) {
    const cards:GraphCard[]=a.requirements.map(r=>{
      const risk=a.risks[r.id], n=nodeMap.get(acceptanceId(r.id))!;
      return {id:r.id,requirementId:r.id,workItemId:null,kind:'requirement',title:r.title,subtitle:`${r.executionMode==='direct'?'直接执行':risk.criticalCount+' 项关键工作'} · ${r.ownerName||'未分派'}`,status:r.status,risk:risk.riskEvaluated?risk.riskLevel:'pending',forecast:n.forecastEnd,floatDays:risk.minFloat,critical:risk.critical,unknown:!risk.complete||['completed','cancelled'].includes(r.status)&&a.blockers.some(b=>b.requirementId===r.id),external:false,hiddenCount:0};
    });
    for(const n of a.nodes.filter(n=>n.kind==='milestone'&&!n.requirementId))cards.push({id:n.id,requirementId:'',workItemId:null,kind:'milestone',title:n.title,subtitle:'项目里程碑',status:n.status,risk:n.riskLevel,forecast:n.forecastEnd,floatDays:n.floatDays,critical:n.critical,unknown:!!n.unknownReasons.length,external:false,hiddenCount:0});
    const ids=new Set(cards.map(n=>n.id)), grouped=new Map<string,GraphLink>();
    for(const d of a.dependencies) {
      const source=d.sourceRequirementId||d.sourceMilestoneId!,target=d.targetRequirementId||d.targetMilestoneId!;
      if(source===target||!ids.has(source)||!ids.has(target)) continue;
      const id=`${source}>${target}`, edge=a.edges.find(e=>e.dependencyId===d.id), existing=grouped.get(id);
      const label=compactRelationCaption(relationCaption(a,d)),description=relationDescription(a,d);
      if(existing) {existing.dependencyIds.push(d.id);existing.critical ||= !!edge?.critical;existing.description+='\n'+description;}
      else grouped.set(id,{id,source,target,label,description,critical:!!edge?.critical,dependencyIds:[d.id]});
    }
    const links=[...grouped.values()]; links.forEach(e=>{if(e.dependencyIds.length>1)e.label=`${e.dependencyIds.length} 条交付关系`;});
    const keep=attention?new Set(cards.filter(c=>c.critical||c.risk==='high'||c.unknown).map(c=>c.id)):ids;
    // Preserve one-hop context and explicitly count everything omitted.
    const selected=new Set(keep); links.forEach(e=>{if(selected.has(e.source)||selected.has(e.target)){keep.add(e.source);keep.add(e.target);}});
    if(!keep.size) cards.forEach(c=>keep.add(c.id));
    return {cards:cards.filter(c=>keep.has(c.id)).map(c=>({...c,hiddenCount:links.filter(e=>(e.source===c.id&&!keep.has(e.target))||(e.target===c.id&&!keep.has(e.source))).length})),links:links.filter(e=>keep.has(e.source)&&keep.has(e.target))};
  }
  const internal=new Set(a.nodes.filter(n=>n.requirementId===focus&&n.kind!=='project').map(n=>n.id));
  const keep=new Set(internal), links=a.edges.filter(e=>internal.has(e.source)||internal.has(e.target)).filter(e=>nodeMap.get(e.source)?.kind!=='project'&&nodeMap.get(e.target)?.kind!=='project');
  links.forEach(e=>{keep.add(e.source);keep.add(e.target);});
  return {cards:[...keep].map(id=>{
    const n=nodeMap.get(id)!, req=a.requirements.find(r=>r.id===n.requirementId), external=!internal.has(id);
    return {id,requirementId:n.requirementId||'',workItemId:n.workItemId,kind:n.kind,title:n.kind==='start'?'需求开始条件':n.kind==='acceptance'?'需求验收':n.title,subtitle:external?`外部 · ${req?.title||'历史交付'}`:n.kind==='work'?n.ownerName||'未分派':req?.title||'历史交付',status:n.status,risk:a.risks[n.requirementId!]?.riskEvaluated?n.riskLevel:'pending',
      forecast:n.forecastEnd,floatDays:n.floatDays,critical:n.critical,unknown:n.unknownReasons.length>0,external,hiddenCount:external?a.edges.filter(e=>(e.source===id||e.target===id)&&!links.includes(e)).length:0};
  }), links:links.map(e=>{const d=a.dependencies.find(d=>d.id===e.dependencyId);return {...e,label:e.dependencyId ? '交付前置' : undefined,description:d?relationDescription(a,d):undefined,dependencyIds:e.dependencyId?[e.dependencyId]:[]};})};
}
