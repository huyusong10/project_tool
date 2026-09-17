import {ArrowRight} from 'lucide-react';
import type {Dependency} from '../../shared/paths';
import {useProjectWorkspace} from '../project-workspace-context';
import {Button} from './Button';
import {DetailCard} from './DetailCard';

/** Keep requirement relationships separate from links between its own work items. */
export function ObjectDependencies({requirementId,workItemId,onOpenGraph}:{requirementId:string;workItemId?:string;onOpenGraph:()=>void}) {
  const workspace=useProjectWorkspace();
  const data=workspace?.data;
  const dependencies=[...data?.dependencies||[]];
  const nodesById=new Map(data?.nodes.map(node=>[node.id,node]));
  const workPairs=new Set(dependencies.filter(edge=>edge.sourceWorkItemId&&edge.targetWorkItemId).map(edge=>JSON.stringify([edge.sourceWorkItemId,edge.targetWorkItemId])));
  // Legacy workflows express order as graph edges rather than saved dependency rows.
  for(const edge of data?.edges||[]){
    if(edge.dependencyId)continue;
    const source=nodesById.get(edge.source),target=nodesById.get(edge.target);
    if(source?.kind!=='work'||target?.kind!=='work'||!source.requirementId||source.requirementId!==target.requirementId)continue;
    const pair=JSON.stringify([source.id,target.id]);
    if(workPairs.has(pair))continue;
    workPairs.add(pair);
    dependencies.push({id:edge.id,projectId:data!.projectId,sourceRequirementId:source.requirementId,sourceWorkItemId:source.id,targetRequirementId:target.requirementId,targetWorkItemId:target.id,origin:'workflow'});
  }
  const edges=dependencies.filter(edge=>workItemId
    ? edge.sourceWorkItemId===workItemId||edge.targetWorkItemId===workItemId
    : edge.sourceRequirementId===requirementId||edge.targetRequirementId===requirementId);
  const groups=new Map<string,{title:string;id?:string;edges:Dependency[]}>();
  for(const edge of edges){
    const internal=edge.sourceRequirementId===requirementId&&edge.targetRequirementId===requirementId;
    const incoming=workItemId?edge.targetWorkItemId===workItemId:edge.targetRequirementId===requirementId;
    const otherId=incoming?edge.sourceRequirementId:edge.targetRequirementId;
    const key=internal&&!workItemId?'internal':(incoming?'incoming:':'outgoing:')+otherId;
    if(!groups.has(key))groups.set(key,{title:internal&&!workItemId?'内部工作项':incoming?'前置':'后续',id:internal?undefined:otherId,edges:[]});
    groups.get(key)!.edges.push(edge);
  }
  const endpoint=(edge:Dependency,side:'source'|'target')=>{
    const parentId=side==='source'?edge.sourceRequirementId:edge.targetRequirementId;
    const workId=side==='source'?edge.sourceWorkItemId:edge.targetWorkItemId;
    const milestoneId=side==='source'?edge.sourceMilestoneId:edge.targetMilestoneId;
    const id=milestoneId||workId||parentId;
    const title=milestoneId?data?.milestones?.find(item=>item.id===milestoneId)?.title
      :workId?nodesById.get(workId)?.title
      :data?.requirements.find(item=>item.id===parentId)?.title;
    const label=<><small>{milestoneId?'里程碑':workId?'工作项':'需求'}</small><span>{title||id}</span></>;
    const current=id===(workItemId||requirementId);
    return current?<span className="detail-dependency-object is-current">{label}</span>:<Button variant="link" className="detail-dependency-object" title={milestoneId?'在关系图中查看里程碑':undefined} onClick={()=>milestoneId?onOpenGraph():workspace?.inspect(id)}>{label}</Button>;
  };
  return <div className="detail-dependencies">
    {[...groups].map(([key,group])=><DetailCard title={group.title} className="detail-dependency-group" key={key} label={group.title+(group.id?'需求':'')} actions={<>{group.id&&<Button variant="link" onClick={()=>workspace?.inspect(group.id!)}>{data?.requirements.find(item=>item.id===group.id)?.title||group.id}</Button>}<small>{group.edges.length} 条关系</small></>}>
      {group.edges.map(edge=><div className="detail-dependency-pair" key={edge.id}>{endpoint(edge,'source')}<ArrowRight size={14} aria-label="先于"/>{endpoint(edge,'target')}</div>)}
    </DetailCard>)}
    {!edges.length&&<DetailCard title="依赖关系"><p className="detail-card-empty">{workItemId?'暂无工作项依赖。':'当前没有需求间或内部工作项依赖。'}</p></DetailCard>}
  </div>;
}
