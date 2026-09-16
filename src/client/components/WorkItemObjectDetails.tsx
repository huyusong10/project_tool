import {useState} from 'react';
import {Button} from './Button';
import {useSession} from '../app-context';
import {useResourceQuery} from '../use-resource-query';
import {keys} from '../query-keys';
import {canManageProject} from '../permissions';
import type {Person,Requirement} from '../types';
import {useProjectWorkspace} from '../project-workspace-context';
import {DetailWorkspace} from './DetailWorkspace';
import {WorkItemExecution} from './WorkItemExecution';
import {WorkItemFacts} from './WorkItemFacts';
import {WorkItemHistory} from './WorkItemHistory';
import {WorkItemSettingsDialog} from './WorkItemSettingsDialog';
import {persistWorkItemSettingsRecheck} from '../work-item-write-rechecks';

export function WorkItemObjectDetails({requirementId,workItemId,onOpenDependencies}:{requirementId:string;workItemId:string;onOpenDependencies:()=>void}){
  const {session}=useSession(),workspace=useProjectWorkspace(),[fresh,setFresh]=useState(false);
  const query=useResourceQuery<Requirement>([...keys.requirement(requirementId),session.accountId],'/api/requirements/'+requirementId,true,()=>setFresh(true),true);
  const people=useResourceQuery<Person[]>([...keys.people,query.data?.projectId||''],'/api/people?projectId='+query.data?.projectId,!!query.data);
  if(!fresh||!query.data||query.unavailable)return <div role="status">{query.error?.message||'正在读取工作项…'}{query.error&&<Button variant="secondary" disabled={query.isFetching} onClick={()=>void query.refetch()}>重新读取</Button>}</div>;
  const requirement=query.data,item=requirement.workItems.find(item=>item.id===workItemId);
  if(!item)return <p role="alert">工作项不存在或已无法访问，未提交输入已保留。</p>;
  const manage=canManageProject(session,requirement.projectId),owner=people.data?.some(p=>p.id===session.personId&&p.projectRole!=='viewer')&&requirement.ownerId===session.personId;
  const canEdit=!!people.data&&(manage||!!owner)&&!['pending_acceptance','completed','cancelled'].includes(requirement.status);
  const dependencies=workspace?.data.dependencies.filter(edge=>edge.sourceWorkItemId===item.id||edge.targetWorkItemId===item.id)||[];
  return <DetailWorkspace label="工作项详情" initialTab="overview" tabs={[
    {id:'overview',label:'概况',description:'工作项进展与执行',actions:<WorkItemExecution requirement={requirement} item={item} people={people.data||[]} progressLabel="更新进度">{({actions,progress})=><>{progress}{actions}</>}</WorkItemExecution>,content:<WorkItemFacts item={item}/>},
    {id:'basic',label:'资料',description:'名称、阶段、人员与计划',content:<WorkItemSettingsDialog embedded itemId={item.id} canEdit={canEdit} requirement={requirement} people={people.data||[]} canManageRequirement={manage} onClose={()=>{}} onOpenPlan={onOpenDependencies} onReload={async()=>{const result=await query.refetch({throwOnError:true});if(!result.data)throw Error('工作项无法读取');return result.data;}} onWriteNeedsRecheck={()=>persistWorkItemSettingsRecheck(session.accountId||'guest',requirement.id,true)}/>},
    {id:'dependencies',label:'依赖',actions:<Button variant="secondary" onClick={onOpenDependencies}>在关系图中维护依赖</Button>,content:<>{dependencies.map(edge=>{const incoming=edge.targetWorkItemId===item.id,id=incoming?edge.sourceWorkItemId||edge.sourceRequirementId:edge.targetWorkItemId||edge.targetRequirementId;return <p key={edge.id}>{incoming?'前置':'后续'} · <Button variant="link" onClick={()=>workspace?.inspect(id)}>{workspace?.data.nodes.find(n=>n.id===id)?.title||workspace?.data.requirements.find(r=>r.id===id)?.title||id}</Button></p>;})}{!dependencies.length&&<p>暂无工作项依赖。</p>}</>},
    {id:'history',label:'记录',content:<WorkItemHistory requirement={requirement} workItemId={item.id}/>},
  ]}/>;
}
