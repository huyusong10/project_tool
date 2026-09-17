import { useWorkspaceNavigation } from './use-workspace-navigation';

import { StatusBadge } from "../../components/Badge";
import { PhaseStatusBadge } from '../../components/PhasePlanning';
import { Button } from "../../components/Button";
import { ArrowLeft } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { useSession } from "../../app-context";

import { invalidateRequirementViews } from "../../query-keys";

import type { Dashboard } from "../../types";
import type { PathAnalysis } from "../../../shared/paths";

import { ProjectWorkspaceContext } from "../../project-workspace-context";

import { workspaceParams, scopeFromObject, scopeRequirementIds, type WorkspaceView } from "../../workspace-location";
import { WorkspaceRuntime, WorkspaceRuntimeContext } from "../../workspace-runtime";
import { draftNetwork } from "../../dependency-draft";
import { useDependencyDraft } from "../../use-graph-draft";
import { ToolbarStatus } from "../../components/ToolbarStatus";
import { PageHeader } from "../../components/PageHeader";
import { ViewTabs } from "../../components/ViewTabs";
import { WorkspaceOverview } from "../../components/WorkspaceOverview";
import { useWorkspaceActions } from "../../components/WorkspaceActions";
import { WorkspaceOutline } from "../../components/WorkspaceOutline";
import { ObjectInspector } from "../../components/ObjectInspector";
import { DeliveryFeatureDetails } from "../../components/DeliveryFeatureDetails";
import { WorkItemObjectDetails } from "../../components/WorkItemObjectDetails";
import { RequirementObjectDetails } from '../requirements/RequirementDetails';
import { ProgressWorkspace } from './ProgressWorkspace';
import { FeaturePathPanel } from "../../components/FeaturePathPanel";
import { PathAnalysisPanel } from "../../components/PathAnalysisPanel";
import { CanvasDraftDetails } from "../../components/CanvasDraftDetails";
import { Modal } from "../../components/Modal";
import { RequirementImport } from "../../components/RequirementImport";
import "../../project-workspace.css";

export function ProjectWorkspace({report,data}:{report:Dashboard;data:PathAnalysis}){
  const {session}=useSession(),account=session.accountId||'guest',projectId=data.projectId,client=useQueryClient();
  const [runtime]=useState(()=>new WorkspaceRuntime());
  const draft=useDependencyDraft(account,data,'project',()=>invalidateRequirementViews(client));runtime.document=draft;

  const [changes,setChanges]=useState(false),[discard,setDiscard]=useState(false);
  const navigationData=useMemo(()=>draftNetwork(data,draft.changes,draft.templateInstances),[data,draft.changes,draft.templateInstances]);
  const { params, setParams, go, location, detailTrail, trail, last, enter, inspect, detailBack, switchView, selected, features, selectedPhase, selectedFeature, selectedRequirement, title } = useWorkspaceNavigation(data,navigationData);
  const navigation={breadcrumbs:trail.map((t,i)=>({label:t.label,onClick:i<trail.length-1?()=>enter(t.scope):undefined})),navigationLabel:'项目层级',backLabel:'上一级',onBack:trail.length>1?()=>enter(trail[trail.length-2].scope):undefined,
    views:<ViewTabs ariaLabel="项目视角" value={location.view} options={[{value:'list',label:'清单'},{value:'graph',label:'关系图'},{value:'progress',label:'进展表'}]} onChange={v=>switchView(v as WorkspaceView)}/>};
  const status=draft.pending?'提交结果待核对':draft.conflict?'版本冲突':draft.count?draft.count+' 项未保存':Object.keys(draft.fields).length?'输入未保存':'已保存';
  const valid=last.scope.kind===location.scope.kind&&last.scope.id===location.scope.id;
  const draftControls=<><Button variant="secondary" onClick={()=>setChanges(true)}>草稿预览与冲突</Button><Button variant="secondary" disabled={draft.busy||draft.readOnly||(!draft.count&&!draft.pending)} onClick={()=>void draft.save()}>{draft.pending?'核对原提交':'保存项目草稿'}</Button><Button variant="secondary" disabled={!draft.count||draft.busy||draft.readOnly} onClick={()=>setDiscard(true)}>放弃项目草稿</Button></>;
  const headerProps={title:"项目空间",status:<ToolbarStatus onClick={()=>setChanges(true)}>{status}</ToolbarStatus>,moreActions:<Button variant="secondary" onClick={()=>go('/analytics')}>统计分析 · 全项目</Button>};
  const objectActions=useWorkspaceActions({data,location,inspect,onImport:()=>{const next=new URLSearchParams(params);next.set('intake','1');setParams(next);}});
  const actions=params.get('intake')==='1'?null:objectActions.createMenu;
  const importFeature=features.find(f=>f.id===trail.find(t=>t.scope.kind==='feature')?.scope.id);
  const importPhase=importFeature?.phases?.find(p=>p.id===location.scope.id);
  const header=<PageHeader {...headerProps}/>;
  return <ProjectWorkspaceContext.Provider value={{location,data,enter,inspect,switchView,navigation,draftControls,actions,moreActions:params.get('intake')==='1'?null:objectActions.moreActions,emptyActions:objectActions.emptyActions}}><WorkspaceRuntimeContext.Provider value={runtime}>
    <div className="unified-workspace" data-scope={location.scope.kind} data-view={location.view}>
      <WorkspaceOverview/>
      <div className="unified-workspace-body">
        {!valid?<>{header}<div className="page-content"><p role="alert">此范围不存在或已无法访问，网址和资料输入已保留。</p><Button variant="primary" className="primary-button" onClick={()=>enter({kind:'project',id:projectId})}>进入项目</Button></div></>:params.get('intake')==='1'?<><PageHeader {...headerProps} actions={<div className="page-editor-actions"><div className="page-editor-history"/><div className="page-editor-primary"><Button variant="secondary" className="ghost-button" aria-label="返回工作区" title="返回工作区" onClick={()=>{const next=new URLSearchParams(params);next.delete('intake');next.delete('intakeView');setParams(next);}}><ArrowLeft size={16}/><span>返回</span></Button></div></div>}/><div className="workspace-import"><RequirementImport projectId={projectId} defaultFeature={importFeature?.name} defaultPhase={importPhase?.name}/></div></>:location.view==='list'?null:location.view==='progress'?<ProgressWorkspace report={report} formal={data}/>:location.scope.kind==='project'?<FeaturePathPanel projectId={projectId}/>:<PathAnalysisPanel projectId={projectId}/>}
        <div className="workspace-list-container" hidden={!valid||location.view!=='list'||params.get('intake')==='1'}><WorkspaceOutline report={report} header={valid&&location.view==='list'&&params.get('intake')!=='1'?headerProps:undefined}/></div>
        {valid&&location.view==='graph'&&params.get('intake')!=='1'&&location.scope.kind!=='project'&&!scopeRequirementIds(location.scope,data).size&&<div className="workspace-empty workspace-graph-empty"><p>{location.scope.kind==='phase'?'本 Phase 暂无需求':location.scope.kind==='requirement'?'暂无工作项':'尚未安排交付'}</p>{objectActions.emptyActions}</div>}
        {selected&&<ObjectInspector status={selectedPhase?<PhaseStatusBadge phase={selectedPhase}/>:selectedRequirement?<StatusBadge kind={selected===selectedRequirement.id?'requirement':'workItem'} value={selected===selectedRequirement.id?selectedRequirement.status:data.nodes.find(n=>n.id===selected)?.status||'not_started'}/>:selectedFeature?.archivedAt?<span className="object-detail-kind">已归档</span>:undefined} kind={selectedPhase?'Phase':selectedFeature?selectedFeature.kind==='other'?'归类':'特性':selectedRequirement?selected===selectedRequirement.id?'需求':'工作项':undefined} projectId={projectId} tab={location.detailTab} onTabChange={tab=>setParams(workspaceParams({...location,detailTab:tab},navigationData,params),{replace:true})} onBack={detailTrail.length?detailBack:undefined} backLabel={detailTrail.at(-1)?.title} title={title||'对象详情'} identity={selected} onClose={()=>inspect()} onEnter={()=>{const scope=scopeFromObject(selectedRequirement?.id||selected,data);if(scope)enter(scope);}}>
          {selectedFeature?<DeliveryFeatureDetails key={selected} feature={selectedFeature} phaseId={selectedPhase?.id} onEnter={()=>enter({kind:selectedPhase?'phase':'feature',id:selectedPhase?.id||selectedFeature.id})} onPhase={()=>inspect('feature:'+selectedFeature.id)}/>:selectedRequirement&&selected!==selectedRequirement.id?<WorkItemObjectDetails key={selected} requirementId={selectedRequirement.id} workItemId={selected} onOpenDependencies={()=>switchView('graph',selected)}/>:selectedRequirement?<RequirementObjectDetails key={selectedRequirement.id} id={selectedRequirement.id} requestedAction={objectActions.requirementAction?.id===selectedRequirement.id?objectActions.requirementAction.action:undefined} onActionHandled={objectActions.clearRequirementAction} onOpenDependencies={()=>switchView('graph',selected)}/>:<p role="alert">对象不存在或已无法访问，未提交输入已保留。</p>}
        </ObjectInspector>}
      </div>
      {objectActions.dialogs}
      {changes&&<Modal title="修改与冲突" onClose={()=>setChanges(false)}><CanvasDraftDetails draft={draft} data={data} onGo={go}/><div className="form-actions"><Button variant="secondary" className="ghost-button" disabled={!draft.count||draft.busy||draft.readOnly} onClick={()=>setDiscard(true)}>放弃草稿</Button><Button variant="primary" className="primary-button" disabled={draft.busy||draft.readOnly||(!draft.count&&!draft.pending)} onClick={()=>void draft.save()}>{draft.pending?'核对原批次':'保存草稿'}</Button></div></Modal>}
      {discard&&<Modal title="放弃草稿" onClose={()=>setDiscard(false)}><p>放弃当前项目所有层级的图形和业务草稿。</p><div className="form-actions"><Button variant="secondary" className="ghost-button" onClick={()=>setDiscard(false)}>继续编辑</Button><Button variant="primary" className="primary-button" onClick={()=>{draft.cancel();setDiscard(false);}}>放弃</Button></div></Modal>}
    </div>
  </WorkspaceRuntimeContext.Provider></ProjectWorkspaceContext.Provider>;
}
