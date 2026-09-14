import {Select} from './Select';
import {useState,type ReactNode} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api} from '../api';
import {isAssignablePerson} from '../assignable-people';
import {keys} from '../query-keys';
import type {Person,Requirement,WorkItem} from '../types';
import {Modal} from './Modal';

export type StartAssignment={ownerId?:string;requirementOwnerId?:string;expectedRequirementVersion?:number};
export function StartAssignmentDialog({requirement,workItem,pending,blocked=false,recovery,error,onStart,onClose}:{requirement:Requirement;workItem?:WorkItem;pending:boolean;blocked?:boolean;recovery?:ReactNode;error?:string;onStart:(value:StartAssignment)=>void;onClose:()=>void}){
  const people=useQuery({queryKey:[...keys.people,requirement.projectId],queryFn:()=>api<Person[]>('/api/people?projectId='+requirement.projectId)});
  const needRequirement=!requirement.ownerId||requirement.ownerValid===false,needWork=!!workItem&&!workItem.ownerId;
  const [requirementOwner,setRequirementOwner]=useState(''),[workOwner,setWorkOwner]=useState('');
  const options=people.data?.filter(isAssignablePerson)||[];
  const valid=(id:string)=>options.some(p=>p.id===id);
  return <Modal title="选择负责人并开始" onClose={onClose} closable={!pending}><form onSubmit={e=>{e.preventDefault();if(pending||blocked||needRequirement&&!valid(requirementOwner)||needWork&&!valid(workOwner))return;onStart(workItem?{...(needRequirement?{requirementOwnerId:requirementOwner}:{}),...(needWork?{ownerId:workOwner}:{}),expectedRequirementVersion:requirement.version}:{ownerId:requirementOwner});}}>
    <p>{workItem?.title||requirement.title}</p>
    {needRequirement&&<label className="field"><span>需求负责人</span><Select aria-label="需求负责人" required disabled={pending} value={requirementOwner} onChange={e=>setRequirementOwner(e.target.value)}><option value="">请选择负责人</option>{options.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>}
    {needWork&&<label className="field"><span>工作项负责人</span><Select aria-label="工作项负责人" required disabled={pending} value={workOwner} onChange={e=>setWorkOwner(e.target.value)}><option value="">请选择负责人</option>{options.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>}
    {(error||people.error)&&<p className="form-error">{error||people.error?.message}</p>}
    {recovery}
    {!people.isLoading&&!people.error&&!options.length&&<p>当前没有可分配的有效项目成员。</p>}
    <div className="form-actions"><button type="button" className="ghost-button" disabled={pending} onClick={onClose}>取消</button><button className="primary-button" disabled={pending||blocked||people.isFetching||needRequirement&&!valid(requirementOwner)||needWork&&!valid(workOwner)}>{pending?'正在开始…':'开始'}</button></div>
  </form></Modal>;
}
