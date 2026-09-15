import {useQueryClient} from '@tanstack/react-query';
import {useSession} from '../app-context';
import {useResourceQuery} from '../use-resource-query';
import {keys,invalidateRequirementViews} from '../query-keys';
import {canManageProject} from '../permissions';
import type {Requirement,Person} from '../types';
import {WorkItemSettingsDialog} from './WorkItemSettingsDialog';
import {Modal} from './Modal';
import {persistWorkItemSettingsRecheck,readWorkItemSettingsRechecks} from '../work-item-write-rechecks';
import {useState} from 'react';

export function CreateWorkItemDialog({requirementId,projectId,onClose,onDetails}:{requirementId:string;projectId:string;onClose:()=>void;onDetails:()=>void}){
  const {session}=useSession(),client=useQueryClient();
  const account=session.accountId||session.username||'guest';
  const [needsCheck]=useState(()=>readWorkItemSettingsRechecks(account).has(requirementId));
  const requirement=useResourceQuery<Requirement>([...keys.requirement(requirementId),session.accountId],'/api/requirements/'+requirementId);
  const people=useResourceQuery<Person[]>([...keys.people,projectId],'/api/people?projectId='+projectId);
  if(!requirement.data||!people.data||requirement.unavailable||people.unavailable)return <Modal title="新建工作项" onClose={onClose}><p>{requirement.error?.message||people.error?.message||'正在读取需求与人员…'}</p><button className="ghost-button" onClick={()=>{void requirement.refetch();void people.refetch();}}>重新读取</button></Modal>;
  if(needsCheck)return <Modal title="工作项提交待核对" onClose={onClose}><p>上次工作项提交的结果尚未核对，请打开需求资料，读取正式结果后再操作。</p><button className="primary-button" onClick={onDetails}>打开需求资料</button></Modal>;
  return <WorkItemSettingsDialog initialCreate requirement={requirement.data} people={people.data} canManageRequirement={canManageProject(session,projectId)} onClose={onClose} onOpenPlan={onDetails} onOpenDependencies={onDetails} onReload={async()=>{const result=await requirement.refetch({throwOnError:true});if(!result.data)throw new Error('需求无法打开');return result.data;}} onWriteNeedsRecheck={()=>{persistWorkItemSettingsRecheck(account,requirementId,true);invalidateRequirementViews(client);}}/>;
}
