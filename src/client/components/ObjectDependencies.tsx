import {ArrowRight} from 'lucide-react';
import type {Dependency} from '../../shared/paths';
import {useProjectWorkspace} from '../project-workspace-context';
import {Button} from './Button';

/** Keep requirement relationships separate from links between its own work items. */
export function ObjectDependencies({requirementId,workItemId,onOpenGraph}:{requirementId:string;workItemId?:string;onOpenGraph:()=>void}) {
  const workspace=useProjectWorkspace();
  const data=workspace?.data;
  const dependencies=[...data?.dependencies||[]];
  // Legacy workflows express order as graph edges rather than saved dependency rows.
  for(const edge of data?.edges||[]){
    if(edge.dependencyId)continue;
    const source=data?.nodes.find(node=>node.id===edge.source),target=data?.nodes.find(node=>node.id===edge.target);
    if(source?.kind!=='work'||target?.kind!=='work'||!source.requirementId||source.requirementId!==target.requirementId)continue;
    if(dependencies.some(item=>item.sourceWorkItemId===source.id&&item.targetWorkItemId===target.id))continue;
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
      :workId?data?.nodes.find(item=>item.id===workId)?.title
      :data?.requirements.find(item=>item.id===parentId)?.title;
    const label=<><small>{milestoneId?'里程碑':workId?'工作项':'需求'}</small><span>{title||id}</span></>;
    const current=id===(workItemId||requirementId);
    return current?<span className="detail-dependency-object is-current">{label}</span>:<Button variant="link" className="detail-dependency-object" title={milestoneId?'在关系图中查看里程碑':undefined} onClick={()=>milestoneId?onOpenGraph():workspace?.inspect(id)}>{label}</Button>;
  };
  return <div className="detail-dependencies">
    {[...groups].map(([key,group])=><section className="detail-dependency-group" key={key} aria-label={group.title+(group.id?'需求':'')}>
      <header><strong>{group.title}</strong>{group.id&&<Button variant="link" onClick={()=>workspace?.inspect(group.id!)}>{data?.requirements.find(item=>item.id===group.id)?.title||group.id}</Button>}<small>{group.edges.length} 条关系</small></header>
      {group.edges.map(edge=><div className="detail-dependency-pair" key={edge.id}>{endpoint(edge,'source')}<ArrowRight size={14} aria-label="先于"/>{endpoint(edge,'target')}</div>)}
    </section>)}
    {!edges.length&&<p className="muted-text">{workItemId?'暂无工作项依赖。':'当前没有需求间或内部工作项依赖。'}</p>}
  </div>;
}
