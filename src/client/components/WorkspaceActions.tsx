import {useState} from 'react';
import {Plus} from 'lucide-react';
import type {PathAnalysis} from '../../shared/paths';
import {useSession} from '../app-context';
import {canManageProject} from '../permissions';
import {workspaceAncestors,type WorkspaceLocation} from '../workspace-location';
import {Button} from './Button';
import {TopbarMenu} from './TopbarMenu';
import {FeatureEditor,readFeaturePending,type FeatureEdit} from './FeaturePlanning';
import {PhaseDialog,readPendingPhase,type PhaseEdit} from './PhasePlanning';
import {RequirementForm,readRequirementCreateRecheck,persistRequirementCreateRecheck} from './ManagementForms';
import {CreateWorkItemDialog} from './CreateWorkItemDialog';

/** Object actions stay available when only the workspace view changes. */
export function useWorkspaceActions({data,location,inspect,onImport}:{data:PathAnalysis;location:WorkspaceLocation;inspect:(id?:string,tab?:string)=>void;onImport:()=>void}) {
  const {session}=useSession(),account=session.accountId||'guest',projectId=data.projectId;
  const manage=canManageProject(session,projectId),scope=location.scope;
  const trail=workspaceAncestors(location,data),features=data.featureContext?.overview.features||[];
  const feature=features.find(f=>f.id===trail.find(t=>t.scope.kind==='feature')?.scope.id);
  const phase=feature?.phases?.find(p=>p.id===scope.id),requirement=data.requirements.find(r=>r.id===scope.id);
  const valid=trail.at(-1)?.scope.kind===scope.kind&&trail.at(-1)?.scope.id===scope.id;
  const editable=manage&&valid&&!feature?.archivedAt;
  const canCreate=editable&&!(scope.kind==='requirement'&&(!requirement||requirement.deletedAt||['pending_acceptance','completed','cancelled'].includes(requirement.status)));
  const detailRestores=location.inspector?.startsWith('feature:')||location.inspector?.startsWith('phase:');
  const [featureEdit,setFeatureEdit]=useState<FeatureEdit|null>(()=>detailRestores?null:readFeaturePending(account,projectId));
  const [phaseEdit,setPhaseEdit]=useState<PhaseEdit|null>(()=>detailRestores?null:readPendingPhase(account,projectId)?.edit||null);
  const [requirementAction,setRequirementAction]=useState<{id:string;action:'info'|'schedule'}|null>(null);
  const openRequirement=(action:'info'|'schedule')=>{if(!requirement)return;setRequirementAction({id:requirement.id,action});inspect(requirement.id,'basic');};
  const [creating,setCreating]=useState(false),[workId,setWorkId]=useState('');
  const [recheck,setRecheck]=useState(()=>detailRestores?null:readRequirementCreateRecheck(account,projectId));
  const newPhase=()=>{if(editable&&feature&&feature.kind!=='other')setPhaseEdit(readPendingPhase(account,projectId)?.edit||{feature,mode:'edit'});};
  const newRequirement=()=>{if(canCreate)setCreating(true);};
  const createMenu=canCreate?<TopbarMenu variant="primary" label="新建对象" text={<span>新建</span>} icon={<Plus size={16}/>}>
    {scope.kind==='project'&&<Button variant="menu" onClick={()=>setFeatureEdit({mode:'basic'})}>新建特性</Button>}
    {scope.kind==='feature'&&feature?.kind!=='other'&&<Button variant="menu" onClick={newPhase}>新建 Phase</Button>}
    {scope.kind==='requirement'?<Button variant="menu" onClick={()=>setWorkId(scope.id)}>新建工作项</Button>:<Button variant="menu" onClick={newRequirement}>新建需求</Button>}
  </TopbarMenu>:null;
  const moreActions=<>
    {editable&&feature&&scope.kind==='feature'&&feature.kind!=='other'&&<><Button variant="secondary" onClick={()=>setFeatureEdit({feature,mode:'basic'})}>编辑特性</Button><Button variant="secondary" onClick={()=>setPhaseEdit({feature,mode:'placement'})}>移入需求</Button></>}
    {editable&&phase&&feature&&<>
      {<Button variant="secondary" onClick={()=>setPhaseEdit({feature,phase,mode:'placement'})}>移入需求</Button>}
      <Button variant="secondary" onClick={()=>setPhaseEdit({feature,phase,mode:'edit'})}>编辑 Phase</Button>
    </>}
    {editable&&scope.kind==='requirement'&&requirement&&<>
      {!['completed','cancelled'].includes(requirement.status)&&<Button variant="secondary" onClick={()=>openRequirement('info')}>编辑需求</Button>}
      {feature&&<Button variant="secondary" onClick={()=>setPhaseEdit({feature,requirementIds:[requirement.id],mode:'placement'})}>调整归属</Button>}
      {!['pending_acceptance','completed','cancelled'].includes(requirement.status)&&<Button variant="secondary" onClick={()=>openRequirement('schedule')}>安排计划</Button>}
    </>}
    {editable&&scope.kind!=='requirement'&&<Button variant="secondary" onClick={onImport}>导入需求</Button>}
  </>;
  const emptyActions=canCreate?<div className="button-row">
    {scope.kind==='project'&&<Button variant="primary" onClick={()=>setFeatureEdit({mode:'basic'})}>新建特性</Button>}
    {scope.kind==='feature'&&feature?.kind!=='other'&&<Button variant="primary" onClick={newPhase}>新建 Phase</Button>}
    {scope.kind==='requirement'?<Button variant="secondary" onClick={()=>setWorkId(scope.id)}>新建工作项</Button>:<Button variant="secondary" onClick={newRequirement}>新建需求</Button>}
    {feature&&feature.kind!=='other'&&scope.kind!=='requirement'&&<Button variant="secondary" onClick={()=>setPhaseEdit({feature,phase,mode:'placement'})}>移入需求</Button>}
  </div>:null;
  const dialogs=manage?<>
    {featureEdit&&<FeatureEditor projectId={projectId} edit={featureEdit} onClose={()=>setFeatureEdit(null)}/>}
    {phaseEdit&&<PhaseDialog key={(phaseEdit.phase?.id||phaseEdit.feature.id)+phaseEdit.mode} edit={phaseEdit} onClose={()=>setPhaseEdit(null)}/>}
    {(creating||recheck)&&<RequirementForm projectId={projectId} defaultFeatureId={feature?.id} defaultPhaseId={phase?.id} initialRequirementIds={data.requirements.map(r=>r.id)} recheck={recheck} onRecheckChange={value=>{setRecheck(value);persistRequirementCreateRecheck(account,projectId,value);}} onClose={()=>setCreating(false)}/>}
    {workId&&<CreateWorkItemDialog requirementId={workId} projectId={projectId} onClose={()=>setWorkId('')} onDetails={()=>{setWorkId('');inspect(workId);}} onInspect={id=>{setWorkId('');inspect(id);}}/>}
  </>:null;
  return {createMenu,moreActions,emptyActions,dialogs,requirementAction,clearRequirementAction:()=>setRequirementAction(null)};
}
