import {useEffect,useState} from 'react';
import {Navigate,useLocation,useSearchParams} from 'react-router-dom';
import {useQueryClient} from '@tanstack/react-query';
import {useProjects,useSession} from '../app-context';
import {useResourceQuery} from '../use-resource-query';
import {keys,invalidateRequirementViews} from '../query-keys';
import {ApiError} from '../api';
import type {Dashboard} from '../types';
import type {PathAnalysis} from '../../shared/paths';
import {useAppNavigate} from '../use-app-navigation';
import {ProjectWorkspaceContext} from '../project-workspace-context';
import {progressEntryParams} from '../project-workspace-navigation';
import {readWorkspaceLocation,workspaceAncestors,workspaceParams,workspacePreferenceKey,scopeFromObject,type WorkspaceScope,type WorkspaceView,type WorkspaceLocation} from '../workspace-location';
import {WorkspaceRuntime,WorkspaceRuntimeContext} from '../workspace-runtime';
import {draftNetwork} from '../dependency-draft';
import {useDependencyDraft,clearProjectGraphDrafts} from '../use-graph-draft';
import {ToolbarStatus} from '../components/ToolbarStatus';
import {PageHeader} from '../components/PageHeader';
import {ViewTabs} from '../components/ViewTabs';
import {WorkspaceOverview} from '../components/WorkspaceOverview';
import {WorkspaceOutline} from '../components/WorkspaceOutline';
import {ObjectInspector} from '../components/ObjectInspector';
import {DeliveryFeatureDetails} from '../components/DeliveryFeatureDetails';
import {RequirementObjectDetails} from './RequirementPage';
import {ProgressWorkspace} from './ProgressWorkspacePage';
import {FeaturePathPanel} from '../components/FeaturePathPanel';
import {PathAnalysisPanel} from '../components/PathAnalysisPanel';
import {CanvasDraftDetails} from '../components/CanvasDraftDetails';
import {Modal} from '../components/Modal';
import {RequirementImport} from '../components/RequirementImport';
import '../project-workspace.css';

const viewFields=['state','phaseStatus','from','through','workStage','pathBranch','progressFeatureId','progressPhaseId','q','status','stage','pathSearch','pathScope','pathRelation','planning','actual','tableSort','progressSort','progressState','progressStage','progressStatus','progressRisk','progressPerson','progressSchedule','progressScope','pathEdge','pathPanel','outlineSort','outlineState'];
export function ProjectWorkspacePage(){
  const {selectedProjectId}=useProjects(),{session}=useSession(),[params]=useSearchParams(),url=useLocation(),account=session.accountId||'guest';
  const report=useResourceQuery<Dashboard>([...keys.dashboard,selectedProjectId],'/api/dashboard?projectId='+selectedProjectId,!!selectedProjectId);
  const graph=useResourceQuery<{analysis:PathAnalysis}>([...keys.featureGraph,selectedProjectId,session.accountId,'features'],'/api/projects/'+selectedProjectId+'/path-graph?view=features',!!selectedProjectId);
  useEffect(()=>{if([report.error,graph.error].some(e=>e instanceof ApiError&&[401,403].includes(e.status)))clearProjectGraphDrafts(account,selectedProjectId);},[report.error,graph.error,account,selectedProjectId]);
  if(!report.data||!graph.data||report.unavailable||graph.unavailable)return <><PageHeader title="项目工作区"/><div className="page-content"><p>{report.error?.message||graph.error?.message||(!selectedProjectId?'请选择项目':'正在读取项目工作区…')}</p>{(report.error||graph.error)&&<button className="ghost-button" onClick={()=>{void report.refetch();void graph.refetch();}}>重新读取</button>}</div></>;
  if(url.pathname!=='/'||!params.has('workspaceView')||params.get('projectId')!==selectedProjectId){
    const entryParams=url.pathname==='/execution'?progressEntryParams(account,selectedProjectId,params):new URLSearchParams(params);let location=readWorkspaceLocation(entryParams,selectedProjectId,url.pathname);
    if(url.pathname==='/'&&(!params.size||params.size===1&&params.has('projectId')||params.get('projectId')&&params.get('projectId')!==selectedProjectId)){
      location={projectId:selectedProjectId,scope:{kind:'project',id:selectedProjectId},view:'list'};
      try{const saved=JSON.parse(localStorage.getItem(workspacePreferenceKey(account,selectedProjectId))||'null') as WorkspaceLocation|null;if(saved?.projectId===selectedProjectId&&['list','graph','progress'].includes(saved.view)&&saved.scope){location=saved;const filters=new URLSearchParams(sessionStorage.getItem(workspacePreferenceKey(account,selectedProjectId)+':'+saved.view)||'');for(const [k,v] of filters)if(viewFields.includes(k))entryParams.set(k,v);}}catch{/* Use the project list on first entry. */}
    }
    return <Navigate replace to={'/?'+workspaceParams(location,graph.data.analysis,entryParams)} state={url.state}/>;
  }
  return <ProjectWorkspace key={account+':'+selectedProjectId} report={report.data} data={graph.data.analysis}/>;
}
function ProjectWorkspace({report,data}:{report:Dashboard;data:PathAnalysis}){
  const {session}=useSession(),account=session.accountId||'guest',projectId=data.projectId,client=useQueryClient();
  const [params,setParams]=useSearchParams(),go=useAppNavigate(),location=readWorkspaceLocation(params,projectId),[runtime]=useState(()=>new WorkspaceRuntime());
  const draft=useDependencyDraft(account,data,'project',()=>invalidateRequirementViews(client));runtime.document=draft;
  const [changes,setChanges]=useState(false),[discard,setDiscard]=useState(false);
  const navigationData=draftNetwork(data,draft.changes,draft.templateInstances);
  const memoryKey=workspacePreferenceKey(account,projectId),trail=workspaceAncestors(location,navigationData),last=trail.at(-1)!;
  const viewKey=memoryKey+':'+location.view;
  useEffect(()=>{const canonical=workspaceParams(location,navigationData,params);if([...canonical].some(([k,v])=>params.get(k)!==v)||[...params.keys()].some(k=>!canonical.has(k)))setParams(canonical,{replace:true});},[location,navigationData,params,setParams]);
  useEffect(()=>{try{localStorage.setItem(memoryKey,JSON.stringify({...location,inspector:undefined}));const stored=new URLSearchParams();for(const key of viewFields)if(params.has(key))stored.set(key,params.get(key)!);sessionStorage.setItem(viewKey,stored.toString());}catch{/* The URL remains shareable if storage is unavailable. */}},[memoryKey,viewKey,params,location]);
  const enter=(scope:WorkspaceScope)=>{const next=workspaceParams({...location,scope},navigationData,params);next.delete('intake');for(const key of ['pathRelation','pathEdge','workspaceLocate','intakeView'])next.delete(key);go('/?'+next);};
  const inspect=(id?:string)=>setParams(workspaceParams({...location,inspector:id},navigationData,params),{replace:true});
  const switchView=(view:WorkspaceView,locateId?:string)=>{
    const next=workspaceParams({...location,view,inspector:locateId||location.inspector},navigationData,params);
    for(const field of viewFields)next.delete(field);next.delete('intake');next.delete('intakeView');next.delete('workspaceLocate');
    try{const saved=new URLSearchParams(sessionStorage.getItem(memoryKey+':'+view)||'');for(const [k,v] of saved)if(viewFields.includes(k))next.set(k,v);}catch{/* No saved filters. */}
    if(locateId){next.set('pathScope','all');next.set('pathSearch','');next.delete('q');const r=data.requirements.find(r=>r.id===locateId)||data.requirements.find(r=>r.id===data.nodes.find(n=>n.id===locateId)?.requirementId);next.set('workspaceLocate',location.scope.kind==='project'&&r?.featureId?'feature:'+r.featureId:location.scope.kind!=='requirement'&&r?r.id:locateId);}
    go('/?'+next);
  };
  const navigation={breadcrumbs:trail.map((t,i)=>({label:t.label,onClick:i<trail.length-1?()=>enter(t.scope):undefined})),navigationLabel:'项目层级',backLabel:'上一级',onBack:trail.length>1?()=>enter(trail[trail.length-2].scope):undefined,
    views:<ViewTabs ariaLabel="项目视角" value={location.view} options={[{value:'list',label:'特性清单'},{value:'graph',label:'关系图'},{value:'progress',label:'进展表'}]} onChange={v=>switchView(v as WorkspaceView)}/>};
  const selected=location.inspector,features=data.featureContext?.overview.features||[];
  const selectedPhase=selected?.startsWith('phase:')?features.flatMap(f=>f.phases||[]).find(p=>p.id===selected.slice(6)):undefined;
  const selectedFeature=features.find(f=>f.id===(selectedPhase?.featureId||(selected?.startsWith('feature:')?selected.slice(8):'')));
  const selectedRequirement=data.requirements.find(r=>r.id===selected)||data.requirements.find(r=>r.id===data.nodes.find(n=>n.id===selected)?.requirementId);
  const title=selectedPhase?.name||selectedFeature?.name||data.nodes.find(n=>n.id===selected)?.title||selectedRequirement?.title;
  const status=draft.pending?'提交结果待核对':draft.conflict?'版本冲突':draft.count?draft.count+' 项未保存':Object.keys(draft.fields).length?'输入未保存':'已保存';
  const valid=last.scope.kind===location.scope.kind&&last.scope.id===location.scope.id;
  const draftControls=<><button onClick={()=>setChanges(true)}>草稿预览与冲突</button><button disabled={draft.busy||draft.readOnly||(!draft.count&&!draft.pending)} onClick={()=>void draft.save()}>{draft.pending?'核对原提交':'保存项目草稿'}</button><button disabled={!draft.count||draft.busy||draft.readOnly} onClick={()=>setDiscard(true)}>放弃项目草稿</button></>;
  const header=<PageHeader title="项目工作区" status={<ToolbarStatus onClick={()=>setChanges(true)}>{status}</ToolbarStatus>} actions={<div className="page-editor-actions"><div className="page-editor-history"/><div className="page-editor-primary"/></div>} moreActions={<button onClick={()=>go('/analytics')}>统计分析 · 全项目</button>}/>;
  return <ProjectWorkspaceContext.Provider value={{location,data,enter,inspect,switchView,navigation,draftControls}}><WorkspaceRuntimeContext.Provider value={runtime}>
    <div className="unified-workspace" data-scope={location.scope.kind} data-view={location.view}>
      <WorkspaceOverview/>
      <div className="unified-workspace-body">
        {!valid?<>{header}<div className="page-content"><p role="alert">此范围不存在或已无法访问，网址和资料输入已保留。</p><button className="primary-button" onClick={()=>enter({kind:'project',id:projectId})}>进入项目</button></div></>:params.get('intake')==='1'?<>{header}<div className="workspace-import"><button className="ghost-button" onClick={()=>{const next=new URLSearchParams(params);next.delete('intake');next.delete('intakeView');setParams(next);}}>返回特性清单</button><RequirementImport projectId={projectId}/></div></>:location.view==='list'?header:location.view==='progress'?<ProgressWorkspace report={report} formal={data}/>:location.scope.kind==='project'?<FeaturePathPanel projectId={projectId}/>:<PathAnalysisPanel projectId={projectId}/>}
        <div className="workspace-list-container" hidden={!valid||location.view!=='list'||params.get('intake')==='1'}><WorkspaceOutline report={report}/></div>
        {selected&&title&&(selectedFeature||selectedRequirement)&&<ObjectInspector hidden={location.view==='graph'&&draft.active} title={title} identity={selected} onClose={()=>inspect()}>
          <button className="ghost-button" onClick={()=>{const scope=scopeFromObject(selectedRequirement?.id||selected,data);if(scope)enter(scope);}}>进入来源</button>
          {selectedFeature?<DeliveryFeatureDetails key={selectedFeature.id} feature={selectedFeature} phaseId={selectedPhase?.id} onEnter={()=>enter({kind:selectedPhase?'phase':'feature',id:selectedPhase?.id||selectedFeature.id})} onPhase={()=>inspect('feature:'+selectedFeature.id)}/>:selectedRequirement?<RequirementObjectDetails key={selectedRequirement.id} id={selectedRequirement.id} workItemId={selected!==selectedRequirement.id?selected:undefined} onOpenDependencies={()=>switchView('graph',selected)}/>:null}
        </ObjectInspector>}
      </div>
      {changes&&<Modal title="修改与冲突" onClose={()=>setChanges(false)}><CanvasDraftDetails draft={draft} data={data} onGo={go}/><div className="form-actions"><button className="ghost-button" disabled={!draft.count||draft.busy||draft.readOnly} onClick={()=>setDiscard(true)}>放弃草稿</button><button className="primary-button" disabled={draft.busy||draft.readOnly||(!draft.count&&!draft.pending)} onClick={()=>void draft.save()}>{draft.pending?'核对原批次':'保存草稿'}</button></div></Modal>}
      {discard&&<Modal title="放弃草稿" onClose={()=>setDiscard(false)}><p>放弃当前项目所有层级的图形和业务草稿。</p><div className="form-actions"><button className="ghost-button" onClick={()=>setDiscard(false)}>继续编辑</button><button className="primary-button" onClick={()=>{draft.cancel();setDiscard(false);}}>放弃</button></div></Modal>}
    </div>
  </WorkspaceRuntimeContext.Provider></ProjectWorkspaceContext.Provider>;
}
