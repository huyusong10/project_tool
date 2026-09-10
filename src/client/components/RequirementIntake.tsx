import {useResourceQuery} from '../use-resource-query';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, InvalidResponseError, jsonBody } from '../api';
import { keys, invalidateRequirementViews } from '../query-keys';
import { useSession } from '../app-context';
import { Modal } from './Modal';
import { FormField, FormError } from './Form';
import type { Requirement } from '../types';
import type { IntakeCatalog, RequirementGroup } from '../../shared/intake';
import './requirement-intake.css';

export function useIntake(projectId:string) {
  const {session}=useSession();
  return useResourceQuery<IntakeCatalog>([...keys.intake,projectId,session.accountId],`/api/projects/${projectId}/requirement-intake`,!!projectId,value=>{if(!value||!Array.isArray(value.groups))throw new InvalidResponseError(200,false,'需求分组响应不完整');});
}
export function OrganizationFields({projectId,groupId,onChange}:{projectId:string;groupId?:string;onChange?:(key:'groupId',value:string)=>void}) {
  const query=useIntake(projectId);
  return <><FormField label="分组（可选）"><select aria-label="需求分组" name="groupId" value={groupId} onChange={e=>onChange?.('groupId',e.target.value)}><option value="">未分组</option>{groupId&&!query.data?.groups.some(g=>g.id===groupId)&&<option value={groupId}>原分组（待核对）</option>}{query.data?.groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></FormField>
    {query.error&&<p className="field-full warning-banner">分组读取失败，输入保留。<button type="button" className="ghost-button" onClick={()=>void query.refetch()}>重试</button></p>}</>;
}
export function OrganizationFilters({items,group,onGroup}:{items:Array<{groupId?:string|null;groupName?:string|null}>;group:string;onGroup:(v:string)=>void}) {
  const groups=[...new Map(items.filter(r=>r.groupId).map(r=>[r.groupId!,r.groupName||r.groupId!])).entries()];
  return <><select aria-label="分组筛选" value={group} onChange={e=>onGroup(e.target.value)}><option value="">全部分组</option><option value="ungrouped">未分组</option>{group&&group!=='ungrouped'&&!groups.some(([id])=>id===group)&&<option value={group}>原分组（已不可用）</option>}{groups.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></>;
}
export function matchesOrganization(item:{groupId?:string|null},group:string) {
  return (!group||(group==='ungrouped'?!item.groupId:item.groupId===group));
}
export function GroupManager({projectId,onClose}:{projectId:string;onClose:()=>void}) {
  const query=useIntake(projectId),client=useQueryClient();
  const [editing,setEditing]=useState<RequirementGroup|null>(null),[name,setName]=useState('');
  const mutation=useMutation({mutationFn:async(v:{group?:RequirementGroup;remove?:boolean;order?:number})=>{
    if(v.remove)return api(`/api/projects/${projectId}/requirement-groups/${v.group!.id}`,{method:'DELETE',body:jsonBody({expectedVersion:v.group!.version})});
    return api(`/api/projects/${projectId}/requirement-groups`,{method:'POST',body:jsonBody({id:v.group?.id,name:v.order!==undefined?v.group!.name:name,sortOrder:v.order??v.group?.sortOrder??query.data?.groups.length??0,expectedVersion:v.group?.version})});
  },onSuccess:()=>{setEditing(null);setName('');invalidateRequirementViews(client);}});
  return <Modal title="管理需求分组" onClose={onClose} closable={!mutation.isPending}><div className="intake-stack"><p>分组只整理需求。删除分组后，其需求进入未分组。</p>
    {query.data?.groups.map((g,i)=><div className="intake-group-row" key={g.id}><strong>{g.name}</strong><span>顺序 {g.sortOrder}</span><button className="ghost-button" disabled={mutation.isPending||i===0} onClick={()=>mutation.mutate({group:g,order:Math.max(0,g.sortOrder-1)})}>上移</button><button className="ghost-button" disabled={mutation.isPending} onClick={()=>mutation.mutate({group:g,order:g.sortOrder+1})}>下移</button><button className="ghost-button" onClick={()=>{setEditing(g);setName(g.name);}}>重命名</button><button className="ghost-button danger-text" disabled={mutation.isPending} onClick={()=>mutation.mutate({group:g,remove:true})}>删除分组</button></div>)}
    <form onSubmit={e=>{e.preventDefault();mutation.mutate({group:editing||undefined});}}><label className="field"><span>{editing?'分组名称':'新分组名称'}</span><input value={name} maxLength={200} required onChange={e=>setName(e.target.value)}/></label><div className="form-actions">{editing&&<button type="button" className="ghost-button" onClick={()=>{setEditing(null);setName('');}}>取消重命名</button>}<button className="primary-button" disabled={mutation.isPending}>{editing?'保存名称':'新建分组'}</button></div></form>
    {(mutation.error||query.error)&&<div className="warning-banner">{mutation.error?.message||query.error?.message}<button className="ghost-button" onClick={()=>void query.refetch().then(result=>{if(editing){const current=result.data?.groups.find(g=>g.id===editing.id);if(current)setEditing(current);else setEditing(null);}})}>刷新分组</button></div>}</div></Modal>;
}
export function OrganizationBatchDialog({projectId,requirements,onClose}:{projectId:string;requirements:Requirement[];onClose:()=>void}) {
  const client=useQueryClient(),query=useIntake(projectId);
  const [baseline,setBaseline]=useState(requirements),[reading,setReading]=useState(false),[readError,setReadError]=useState('');
  const refresh=async()=>{setReading(true);try{const latest=await Promise.all(baseline.map(r=>api<Requirement>('/api/requirements/'+r.id)));setBaseline(latest);setReadError('');await query.refetch();}catch(e){setReadError(e instanceof Error?e.message:'读取失败');}finally{setReading(false);}};
  const [groupId,setGroupId]=useState('keep');
  const mutation=useMutation({mutationFn:()=>api(`/api/projects/${projectId}/requirement-organization`,{method:'POST',body:jsonBody({requirements:baseline.map(r=>({id:r.id,expectedVersion:r.version})),...(groupId==='keep'?{}:{groupId:groupId||null})})}),onSuccess:()=>{invalidateRequirementViews(client);onClose();}});
  return <Modal title={`整理 ${requirements.length} 个需求`} onClose={onClose} closable={!mutation.isPending}><form onSubmit={e=>{e.preventDefault();mutation.mutate();}} className="intake-stack"><label className="field"><span>分组</span><select value={groupId} onChange={e=>setGroupId(e.target.value)}><option value="keep">保持原分组</option><option value="">移入未分组</option>{query.data?.groups.map(g=><option value={g.id} key={g.id}>{g.name}</option>)}</select></label><FormError>{mutation.error?.message||readError}</FormError>{mutation.error&&<button type="button" className="ghost-button" disabled={reading} onClick={()=>void refresh()}>读取最新需求并保留输入</button>}<button className="primary-button" disabled={reading||mutation.isPending||groupId==='keep'}>保存整理</button></form></Modal>;
}
