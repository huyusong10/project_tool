import { projectPathGraph, type GraphCard, type GraphLink } from './path-projection';
import type { PathAnalysis, PathRequirement } from './paths';
import type { GroupOverviewReport } from './group-overview';
import type { FeatureRelation } from './features';

export function featurePathGraph(analysis:PathAnalysis,report:GroupOverviewReport,relations:FeatureRelation[],requirements:PathRequirement[],featureId?:string,planning=true,actual=true) {
  const allRequirements=new Map(requirements.map(r=>[r.id,r]));
  // Include historical endpoint requirements in the existing requirement projection.
  const base=projectPathGraph({...analysis,requirements:requirements.filter(r=>analysis.nodes.some(n=>n.id==='acceptance:'+r.id))});
  if(featureId) {
    const internal=new Set(requirements.filter(r=>(r.groupId||'ungrouped')===featureId&&!r.deletedAt&&r.status!=='cancelled').map(r=>r.id));
    const links=base.links.filter(e=>internal.has(e.source)||internal.has(e.target));
    const visible=new Set(internal);links.forEach(e=>{visible.add(e.source);visible.add(e.target);});
    return {cards:base.cards.filter(c=>visible.has(c.id)).map(c=>({...c,external:!internal.has(c.id),archived:!!allRequirements.get(c.requirementId)?.deletedAt})),links};
  }
  const key=(requirementId:string,milestoneId?:string|null)=>requirementId?'feature:'+(allRequirements.get(requirementId)?.groupId||'ungrouped'):milestoneId!;
  const groups=new Map(report.groups.map(g=>[g.id,g]));
  const active=new Set(report.groups.filter(g=>!g.archivedAt).map(g=>'feature:'+g.id));
  if(report.ungroupedCount)active.add('feature:ungrouped');
  for(const c of base.cards)if(c.kind==='milestone')active.add(c.id);
  const grouped=new Map<string,GraphLink>();
  const add=(source:string,target:string,dependencyId?:string,relation?:FeatureRelation,critical=false)=>{
    if(source===target)return;
    const id=source+'>'+target;
    let edge=grouped.get(id);if(!edge){edge={id,source,target,critical:false,dependencyIds:[],planningRelationIds:[]};grouped.set(id,edge);}
    if(dependencyId)edge.dependencyIds.push(dependencyId);
    if(relation)edge.planningRelationIds!.push(relation.id);
    edge.critical||=critical;
  };
  // Keep the complete connected historical context, including chains across archived features.
  const connected=new Set(active),neighbors=new Map<string,string[]>();
  if(actual)for(const d of analysis.dependencies){
    const source=key(d.sourceRequirementId,d.sourceMilestoneId),target=key(d.targetRequirementId,d.targetMilestoneId);
    neighbors.set(source,[...(neighbors.get(source)||[]),target]);
    neighbors.set(target,[...(neighbors.get(target)||[]),source]);
  }
  const queue=[...active];
  for(let i=0;i<queue.length;i++)for(const next of neighbors.get(queue[i])||[])if(!connected.has(next)){connected.add(next);queue.push(next);}
  if(actual)for(const d of analysis.dependencies) {
    const source=key(d.sourceRequirementId,d.sourceMilestoneId),target=key(d.targetRequirementId,d.targetMilestoneId);
    if(!connected.has(source)||!connected.has(target))continue;
    add(source,target,d.id,undefined,analysis.edges.some(e=>e.dependencyId===d.id&&e.critical));
  }
  if(planning)for(const relation of relations)if(active.has('feature:'+relation.sourceFeatureId)&&active.has('feature:'+relation.targetFeatureId))add('feature:'+relation.sourceFeatureId,'feature:'+relation.targetFeatureId,undefined,relation);
  const visible=new Set(active);for(const edge of grouped.values()){visible.add(edge.source);visible.add(edge.target);edge.planningOnly=!edge.dependencyIds.length;edge.label=[edge.planningRelationIds?.length?'规划':'',edge.dependencyIds.length?edge.dependencyIds.length+' 条实际依赖':''].filter(Boolean).join(' · ');edge.description=edge.label;}
  const cards:GraphCard[]=[];
  for(const id of visible) {
    if(!id.startsWith('feature:')){const card=base.cards.find(c=>c.id===id);if(card)cards.push(card);continue;}
    const featureId=id.slice(8),group=groups.get(featureId);
    if(!group&&featureId!=='ungrouped')continue;
    cards.push({id,featureId,kind:'feature',requirementId:'',workItemId:null,title:group?.name||'未归属需求',subtitle:group?.description|| (group?'尚未填写长期目标':'整理需求的特性归属'),
      status:'',risk:'pending',forecast:null,floatDays:null,critical:false,unknown:false,external:!!group?.archivedAt,hiddenCount:0,archived:!!group?.archivedAt,
      assessment:group?.overview.assessment,expectation:group?group.overview.expectation:'查看并整理需求',
      facts:group?group.archivedAt?'已归档 · 保留交付依赖':group.counts.total?`进行中 ${group.counts.inProgress} · 延期 ${group.counts.delayed} · 近七天完成 ${group.counts.recentCompleted}`:'尚未关联有效需求':`${report.ungroupedCount} 个需求`});
  }
  const ids=new Set(cards.map(c=>c.id));
  return {cards,links:[...grouped.values()].filter(e=>ids.has(e.source)&&ids.has(e.target))};
}
