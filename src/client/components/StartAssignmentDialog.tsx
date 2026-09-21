import * as peopleApi from '../features/people/api';
import { Button } from './Button';
import { Select } from './Select';
import { type ReactNode } from 'react';
import { useDeliveryForm } from '../use-delivery-form';
import { useQuery } from '@tanstack/react-query';

import { isAssignablePerson } from '../assignable-people';
import { keys } from '../query-keys';
import type { Person, Requirement, WorkItem } from '../types';
import { Modal } from './Modal';

export type StartAssignment={ownerId?:string;requirementOwnerId?:string;expectedRequirementVersion?:number};
export function StartAssignmentDialog({requirement,workItem,pending,blocked=false,recovery,error,onStart,onClose}:{requirement:Requirement;workItem?:WorkItem;pending:boolean;blocked?:boolean;recovery?:ReactNode;error?:string;onStart:(value:StartAssignment)=>Promise<boolean>;onClose:()=>void}){
  const people=useQuery({queryKey:[...keys.people,requirement.projectId],queryFn:()=>peopleApi.peopleQuery<Person[]>(requirement.projectId)});
  const needRequirement=!requirement.ownerId||requirement.ownerValid===false,needWork=!!workItem&&!workItem.ownerId;
  const [requirementOwner,setRequirementOwner,clearRequirementOwner]=useDeliveryForm(requirement.projectId,(workItem?.id||requirement.id)+':start-requirement-owner',()=>''),[workOwner,setWorkOwner,clearWorkOwner]=useDeliveryForm(requirement.projectId,(workItem?.id||requirement.id)+':start-work-owner',()=>'');
  const options=people.data?.filter(isAssignablePerson)||[];
  const valid=(id:string)=>options.some(p=>p.id===id);
  return <Modal title="选择负责人并开始" onClose={onClose} closable={!pending}><form onSubmit={async e=>{e.preventDefault();if(pending||blocked||needRequirement&&!valid(requirementOwner)||needWork&&!valid(workOwner))return;const saved=await onStart(workItem?{...(needRequirement?{requirementOwnerId:requirementOwner}:{}),...(needWork?{ownerId:workOwner}:{}),expectedRequirementVersion:requirement.version} :needRequirement?{ownerId:requirementOwner}:{});if(saved){clearRequirementOwner();clearWorkOwner();}}}>
    <p>{workItem?.title||requirement.title}</p>
    {!workItem&&!needRequirement&&<p>当前需求负责人：{requirement.ownerName}</p>}
    {needRequirement&&<label className="field"><span>需求负责人</span><Select aria-label="需求负责人" required disabled={pending} value={requirementOwner} onChange={e=>setRequirementOwner(e.target.value)}><option value="">请选择负责人</option>{options.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>}
    {needWork&&<label className="field"><span>工作项负责人</span><Select aria-label="工作项负责人" required disabled={pending} value={workOwner} onChange={e=>setWorkOwner(e.target.value)}><option value="">请选择负责人</option>{options.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>}
    {(error||people.error)&&<p className="form-error">{error||people.error?.message}</p>}
    {recovery}
    {!people.isLoading&&!people.error&&!options.length&&<p>当前没有可分配的有效项目成员。</p>}
    <div className="form-actions"><Button variant="secondary" type="button" className="ghost-button" disabled={pending} onClick={()=>{clearRequirementOwner();clearWorkOwner();onClose();}}>取消</Button><Button variant="primary" type="submit" className="primary-button" disabled={pending||blocked||people.isFetching||needRequirement&&!valid(requirementOwner)||needWork&&!valid(workOwner)}>{pending?'正在开始…':'开始'}</Button></div>
  </form></Modal>;
}
