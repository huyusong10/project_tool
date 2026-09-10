import {useSearchParams,useLocation} from 'react-router-dom';
import {useQueryClient} from '@tanstack/react-query';
import {useSession} from '../app-context';
import {canManageProject} from '../permissions';
import type {Requirement} from '../types';
import {keys} from '../query-keys';
import {readResourceFresh} from '../use-resource-query';
import {ExecutionReviewDialog} from './ExecutionReview';
import {DeliveryDraftDialog} from './DeliveryControls';
import {RequirementCommandDialog} from './RequirementCommandDialog';
import {Modal} from './Modal';

/** Action links open the existing command form; visiting a URL never executes a command. */
export function RequirementActionEntry({requirement:r}:{requirement:Requirement}){
  const [params,setParams]=useSearchParams(),location=useLocation(),{session}=useSession(),client=useQueryClient();
  const action=params.get('action'),workItemId=params.get('workItemId')||undefined;
  const close=()=>{const next=new URLSearchParams(params);next.delete('action');setParams(next,{replace:true,state:location.state});};
  const manager=canManageProject(session,r.projectId);
  if(action==='forecast'||action==='follow-up')return <ExecutionReviewDialog key={r.id+':'+(workItemId||'')+':'+action} requirementId={r.id} workItemId={workItemId} intent={action} onClose={close}/>;
  if(action==='accept')return manager||r.acceptanceOwnerValid&&r.acceptanceOwnerId===session.personId?<RequirementCommandDialog action="accept" requirement={r} onClose={close} onArchived={()=>{}} onReload={()=>readResourceFresh<Requirement>(client,keys.requirement(r.id),'/api/requirements/'+r.id,()=>true)}/>:<Modal title="验收处理" onClose={close}><p>请由 {r.acceptanceOwnerName||'项目经理'} 验收此需求。</p></Modal>;
  if(action==='delivery-settings')return manager?<DeliveryDraftDialog requirements={[r]} mode="settings" onClose={close}/>:<Modal title="交付设置" onClose={close}><p>请项目经理调整交付设置。</p></Modal>;
  return null;
}
