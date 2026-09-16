import {Button} from './Button';
import {PencilLine} from 'lucide-react';
import type {ReactNode} from 'react';
import {useSession} from '../app-context';
import {useProjectWorkspace} from '../project-workspace-context';
import {useAppNavigate} from '../use-app-navigation';
import {workExecutionAccess} from '../permissions';
import type {Person,Requirement} from '../types';
import {DeliveryControls} from './DeliveryControls';
import type {ExecutionControls} from './WorkItemExecution';
import './requirement-work-execution.css';

export function RequirementWorkExecution({requirement,people,progress,children}:{requirement:Requirement;people:Person[];progress:ReactNode;children:(controls:ExecutionControls)=>ReactNode}){
  const {session}=useSession(),workspace=useProjectWorkspace(),go=useAppNavigate();
  const open=()=>workspace?workspace.inspect(requirement.id,requirement.executionMode==='direct'?'overview':'work'):go('/requirements/'+requirement.id+'?detailTab=work');
  const canOperate=requirement.workItems.some(item=>workExecutionAccess(session,requirement,item,people).operate);
  const canUpdate=canOperate&&!['completed','cancelled'].includes(requirement.status);
  const actions=requirement.status==='completed'&&canOperate
    ?<DeliveryControls requirement={requirement}>{({actions})=>actions}</DeliveryControls>
    :canUpdate?<Button variant="soft" tone="primary" size="compact" width="wide" className="primary-button execution-action" data-action="progress" onClick={open}><PencilLine size={14}/>更新进展</Button>:null;
  return <>
    {children({actions,progress:canUpdate?<button className="workspace-requirement-progress" aria-label={'更新 '+requirement.title+' 进展'} onClick={open}>{progress}</button>:progress})}

  </>;
}
