import * as requirementsApi from '../features/requirements/api';
import * as peopleApi from '../features/people/api';
import { DetailCard } from './DetailCard';
import { ReferenceLinks } from './ReferenceLinks';
import { WorkItemLinks } from './WorkItemLinks';
import { ObjectDependencies } from './ObjectDependencies';
import { useState } from 'react';
import { Button } from './Button';
import { useGuestWorkspace, useSession } from '../app-context';
import { useResourceQuery } from '../use-resource-query';
import { keys } from '../query-keys';
import { canManageProject } from '../permissions';
import type { Person, Requirement } from '../types';
import { DetailWorkspace } from './DetailWorkspace';
import { WorkItemExecution } from './WorkItemExecution';
import { WorkItemFacts } from './WorkItemFacts';
import { WorkItemHistory } from './WorkItemHistory';
import { WorkItemSettingsDialog } from './WorkItemSettingsDialog';
import { persistWorkItemSettingsRecheck, readWorkItemSettingsRechecks } from '../work-item-write-rechecks';
import { useProjectWorkspace } from '../project-workspace-context';

export function WorkItemObjectDetails({requirementId,workItemId,onOpenDependencies}:{requirementId:string;workItemId:string;onOpenDependencies:()=>void}){
  const guest=useGuestWorkspace();
  const {session}=useSession(),[fresh,setFresh]=useState(false);
  const workspace=useProjectWorkspace(),accountKey=session.accountId||'guest';
  const [settingsNeedsReview,setSettingsNeedsReview]=useState(()=>readWorkItemSettingsRechecks(accountKey).has(requirementId));
  const query=useResourceQuery<Requirement>([...keys.requirement(requirementId),session.accountId],signal => requirementsApi.requirementsById<Requirement>(requirementId, { signal }),true,()=>setFresh(true),true);
  const people=useResourceQuery<Person[]>([...keys.people,query.data?.projectId||''],signal => peopleApi.peopleQuery<Person[]>(query.data?.projectId || '', { signal }),!!query.data);
  if(!fresh||!query.data||query.unavailable)return <div role="status">{query.error?.message||'正在读取工作项…'}{query.error&&<Button variant="secondary" disabled={query.isFetching} onClick={()=>void query.refetch()}>重新读取</Button>}</div>;
  const requirement=query.data,item=requirement.workItems.find(item=>item.id===workItemId);
  if(!item)return <p role="alert">工作项不存在或已无法访问，未提交输入已保留。</p>;
  const manage=canManageProject(session,requirement.projectId),owner=people.data?.some(p=>p.id===session.personId&&p.projectRole!=='viewer')&&requirement.ownerId===session.personId;
  const canEdit=!settingsNeedsReview&&!!people.data&&(manage||!!owner&&!['pending_acceptance','completed','cancelled'].includes(requirement.status));
  return <DetailWorkspace label="工作项详情" initialTab="overview" tabs={[
    {id:'overview',label:'概况',description:'工作项进展与执行',actions:<WorkItemExecution requirement={requirement} item={item} people={people.data||[]} progressLabel="更新" presentation="detail">{({actions,progress})=><>{progress}{actions}</>}</WorkItemExecution>,content:<><DetailCard title="执行资料"><WorkItemFacts item={item}/></DetailCard>{!!item.referenceLinks?.length&&<DetailCard title="参考资料"><ReferenceLinks links={item.referenceLinks} compact/></DetailCard>}</>},
    {id:'basic',label:'资料',description:settingsNeedsReview?'请先核对刚才的修改':canEdit?'点击字段编辑，逐项保存':manage?'执行资料已锁定，关联链接可补充':'当前工作项资料只读',content:<>{settingsNeedsReview&&<p role="alert" className="warning-banner">工作项设置结果待核对，暂不能继续修改。<Button variant="secondary" onClick={()=>workspace?.inspect(requirementId)}>核对需求修改</Button></p>}<DetailCard title="工作项资料"><WorkItemSettingsDialog embedded itemId={item.id} canEdit={canEdit} requirement={requirement} people={people.data||[]} canManageRequirement={manage} onClose={()=>{}} onOpenPlan={onOpenDependencies} onReload={async()=>{const result=await query.refetch({throwOnError:true});if(!result.data)throw Error('工作项无法读取');return result.data;}} onWriteNeedsRecheck={()=>{persistWorkItemSettingsRecheck(accountKey,requirement.id,true);setSettingsNeedsReview(true);}}/></DetailCard><WorkItemLinks key={item.id} requirement={requirement} item={item} editable={canEdit&&(manage||!['completed','cancelled'].includes(item.status))} manager={manage&&!settingsNeedsReview}/></>},
    {id:'dependencies',label:'依赖',actions:<Button variant="secondary" aria-label={guest?"在关系图中查看依赖":"在关系图中维护依赖"} title={guest?"在关系图中查看依赖":"在关系图中维护依赖"} onClick={onOpenDependencies}>{guest?"查看依赖":"编辑依赖"}</Button>,content:<ObjectDependencies requirementId={requirementId} workItemId={item.id} onOpenGraph={onOpenDependencies}/>},
    {id:'history',label:'记录',content:<WorkItemHistory requirement={requirement} workItemId={item.id}/>},
  ]}/>;
}
