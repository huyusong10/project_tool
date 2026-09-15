import {useState,type ReactNode} from 'react';
import {useSession} from '../app-context';
import {workExecutionAccess} from '../permissions';
import {keys} from '../query-keys';
import {useResourceQuery} from '../use-resource-query';
import type {Person,Requirement} from '../types';
import {Modal} from './Modal';
import {DeliveryControls} from './DeliveryControls';
import {WorkspaceObjectMark} from './WorkspaceObjectMark';
import {WorkItemExecution,type ExecutionControls} from './WorkItemExecution';
import './requirement-work-execution.css';

/** Collapsed requirements expose the same execution controls as their work rows. */
export function RequirementWorkExecution({requirement,people,progress,children}:{requirement:Requirement;people:Person[];progress:ReactNode;children:(controls:ExecutionControls)=>ReactNode}){
  const {session}=useSession(),[open,setOpen]=useState(false);
  const canOperate=requirement.workItems.some(item=>workExecutionAccess(session,requirement,item,people).operate);
  const canUpdate=canOperate&&!['completed','cancelled'].includes(requirement.status);
  const actions=requirement.status==='completed'&&canOperate
    ?<DeliveryControls requirement={requirement}>{({actions})=>actions}</DeliveryControls>
    :canUpdate?<button className="primary-button" onClick={()=>setOpen(true)}>更新进展</button>:null;
  return <>
    {children({actions,progress:canUpdate?<button className="workspace-requirement-progress" aria-label={'更新 '+requirement.title+' 进展'} onClick={()=>setOpen(true)}>{progress}</button>:progress})}
    {open&&<Modal title={'更新进展 · '+requirement.title} width={720} onClose={()=>setOpen(false)}><RequirementExecutionItems id={requirement.id} people={people}/></Modal>}
  </>;
}

function RequirementExecutionItems({id,people}:{id:string;people:Person[]}){
  const {session}=useSession(),[hasFreshRead,setHasFreshRead]=useState(false);
  const query=useResourceQuery<Requirement>([...keys.requirement(id),'execution',session.accountId||'guest'],'/api/requirements/'+id,true,()=>setHasFreshRead(true));
  if(query.unavailable||!hasFreshRead)return <div role="status">{query.error?<><p className="form-error">{query.error.message}</p><button className="ghost-button" onClick={()=>void query.refetch()}>重新读取</button></>:<p>正在读取最新工作项…</p>}</div>;
  const requirement=query.data!;
  const items=requirement.workItems.filter(item=>workExecutionAccess(session,requirement,item,people).operate);
  return <div className="requirement-execution-items">
    {query.error&&<p className="form-error" role="status">{query.error.message}<button className="ghost-button" onClick={()=>void query.refetch()}>重新读取</button></p>}
    {!items.length&&<p className="muted">当前没有可操作的工作项。</p>}
    {items.map(item=><WorkItemExecution key={item.id} requirement={requirement} item={item} people={people}>
      {({progress,actions})=><div className="requirement-execution-item" data-work-id={item.id}>
        <WorkspaceObjectMark kind="work" status={item.status}/>
        <div className="requirement-execution-name"><strong>{item.title}</strong><small>{item.ownerName||'未分派'}</small></div>
        <div className="requirement-execution-progress">{progress}</div>
        <div className="requirement-execution-actions">{actions}</div>
      </div>}
    </WorkItemExecution>)}
  </div>;
}
