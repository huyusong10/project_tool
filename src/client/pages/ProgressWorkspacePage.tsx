import {useProjectWorkspace} from '../project-workspace-context';
import {scopeRequirementIds,scopeFromObject} from '../workspace-location';
import {ToolbarStatus} from '../components/ToolbarStatus';
import {ApiError} from '../api';
import {ObjectInspector} from '../components/ObjectInspector';
import {progressEntryParams,rememberProjectTask} from '../project-workspace-navigation';
import {useMemo,useState,useRef,useEffect} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {Navigate,useSearchParams} from 'react-router-dom';
import {useProjects,useSession} from '../app-context';
import {useResourceQuery} from '../use-resource-query';
import {keys,invalidateRequirementViews} from '../query-keys';
import type {Dashboard,Person} from '../types';
import type {PathAnalysis} from '../../shared/paths';
import {useDependencyDraft,clearProjectGraphDrafts} from '../use-graph-draft';
import {draftNetwork} from '../dependency-draft';
import {WorkspaceRuntime,WorkspaceRuntimeContext,useWorkspaceEvents} from '../workspace-runtime';
import {workspaceRows,filterWorkspaceRows,flattenWorkspaceRows,type WorkspaceRow} from '../workspace-rows';
import {WorkspaceGantt} from '../components/WorkspaceGantt';
import {PageHeader} from '../components/PageHeader';
import {DeliveryFeatureDetails} from '../components/DeliveryFeatureDetails';
import {RequirementObjectDetails} from './RequirementPage';
import {ProgressFilters} from '../components/ProgressFilters';
import {progressFilterFields} from '../progress-filters';
import {useAppNavigate} from '../use-app-navigation';
import {Modal} from '../components/Modal';
import {CanvasDraftDetails} from '../components/CanvasDraftDetails';

export function ProgressWorkspacePage(){
  const {selectedProjectId}=useProjects(),{session}=useSession(),[params]=useSearchParams();
  const [entry]=useState(()=>progressEntryParams(session.accountId||'guest',selectedProjectId,params)),migrated=useRef(false);
  const report=useResourceQuery<Dashboard>([...keys.dashboard,selectedProjectId],'/api/dashboard?projectId='+selectedProjectId,!!selectedProjectId);
  const graph=useResourceQuery<{analysis:PathAnalysis}>([...keys.featureGraph,selectedProjectId,session.accountId,'features'],'/api/projects/'+selectedProjectId+'/path-graph?view=features',!!selectedProjectId);
  useEffect(()=>{if([report.error,graph.error].some(e=>e instanceof ApiError&&[401,403].includes(e.status)))clearProjectGraphDrafts(session.accountId||'guest',selectedProjectId);},[report.error,graph.error,session.accountId,selectedProjectId]);
  if(!migrated.current){migrated.current=true;if(entry.toString()!==params.toString())return <Navigate to={'/execution?'+entry} replace/>;}
  if(!report.data||!graph.data||report.unavailable||graph.unavailable)return <><PageHeader title="项目空间"/><div className="page-content"><p>{report.error?.message||graph.error?.message||(!selectedProjectId?'请选择项目':'正在读取进展表…')}</p>{(report.error||graph.error)&&<button className="ghost-button" onClick={()=>{void report.refetch();void graph.refetch();}}>重新读取</button>}</div></>;
  return <ProgressWorkspace key={(session.accountId||'guest')+selectedProjectId} report={report.data} formal={graph.data.analysis}/>;
}
export function ProgressWorkspace({report,formal}:{report:Dashboard;formal:PathAnalysis}){
  const workspace=useProjectWorkspace();
  const {session}=useSession(),account=session.accountId||'guest',projectId=formal.projectId,client=useQueryClient(),go=useAppNavigate();
  const [params,setParams]=useSearchParams(),[runtime]=useState(()=>new WorkspaceRuntime());
  const people=useResourceQuery<Person[]>([...keys.people,projectId],'/api/people?projectId='+projectId);
  const root=useRef<HTMLDivElement>(null);useWorkspaceEvents(runtime,root);
  const draft=useDependencyDraft(account,formal,'project',()=>invalidateRequirementViews(client));runtime.document=draft;
  const projection=useMemo(()=>draft.preview?.analysis||draftNetwork(formal,draft.changes,draft.templateInstances),[formal,draft.changes,draft.preview,draft.templateInstances]);
  const tree=useMemo(()=>workspaceRows(report,projection,params.get('progressSort')||(workspace?'manual':'name')),[report,projection,params,workspace]),all=useMemo(()=>flattenWorkspaceRows(tree,{},true).map(r=>r.row),[tree]);
  const patch=(values:Record<string,string>)=>{
    const next=new URLSearchParams(params);
    for(const [name,value] of Object.entries(values)){const key=workspace&&['featureId','phaseId'].includes(name)?'progress'+name[0].toUpperCase()+name.slice(1):name;if(value)next.set(key,value);else next.delete(key);}
    // Changing feature scope remounts the page; remember an explicit reset before entry restoration.
    rememberProjectTask(account,projectId,'/execution',next.size?'?'+next:'');
    setParams(next,{replace:true});
  };
  const set=(name:string,value:string)=>patch({[name]:value});
  const filters={query:params.get('q')||'',featureId:params.get(workspace?'progressFeatureId':'featureId')||'',phaseId:params.get(workspace?'progressPhaseId':'phaseId')||'',state:params.get('progressState')||'active',stage:params.get('progressStage')||'',status:params.get('progressStatus')||'',risk:params.get('progressRisk')||'',person:params.get('progressPerson')||'',schedule:params.get('progressSchedule')||'',scope:params.get('progressScope')||'',asOfDate:report.asOfDate};
  const filteredRows=filterWorkspaceRows(tree,filters),feature=report.featureOverview?.features.find(f=>f.id===filters.featureId);
  const scopedIds=workspace?scopeRequirementIds(workspace.location.scope,formal):null;
  const scoped=(items:WorkspaceRow[]):WorkspaceRow[]=>items.flatMap(row=>{if(row.requirementId)return !scopedIds||scopedIds.has(row.requirementId)?[row]:[];const children=scoped(row.children);return children.length?[{...row,children}]:[];});
  let rows=feature?filteredRows.flatMap(row=>row.children):filteredRows;
  if(workspace){const scope=workspace.location.scope,flat=flattenWorkspaceRows(filteredRows,{},true).map(r=>r.row);if(scope.kind==='requirement')rows=flat.filter(row=>row.kind==='requirement'&&row.requirementId===scope.id);else if(scope.kind==='phase')rows=flat.find(row=>row.kind==='phase'&&row.phaseId===scope.id)?.children||[];else if(scope.kind==='unphased')rows=scoped(flat.find(row=>row.id==='unphased:'+scope.id)?.children||[]);else if(scope.kind==='feature')rows=scoped(filteredRows.find(row=>row.featureId===scope.id)?.children||[]);else rows=scoped(filteredRows);}
  const selected=params.get('pathNode')||params.get('requirementId')||'',phase=params.get('phaseId');
  const chosen=all.find(r=>r.id===selected&&(!selected.startsWith('feature:')||!phase))||(selected.startsWith('feature:')?all.find(r=>r.kind==='phase'&&r.phaseId===phase&&r.featureId===(params.get('featureId')||selected.slice(8))):undefined)||all.find(r=>r.id===selected);
  const close=()=>set('pathInspector','closed');
  const select=(row:WorkspaceRow)=>workspace?(row.virtual?workspace.enter({kind:'unphased',id:row.featureId}):workspace.inspect(row.id)):setParams(old=>{const next=new URLSearchParams(old);next.set('pathNode',row.id);next.delete('pathEdge');next.set('pathInspector','open');if(row.requirementId)next.set('requirementId',row.requirementId);else next.delete('requirementId');return next;},{replace:true});
  const scopeUrl=()=>{const next=new URLSearchParams(params);next.set('mode','graph');next.set('view',chosen?.requirementId?'requirement':chosen?.featureId?'feature':'features');if(chosen?.featureId)next.set('featureId',chosen.featureId);if(chosen?.phaseId)next.set('phaseId',chosen.phaseId);return '/?'+next;};
  const status=draft.loading?'恢复草稿…':draft.pending?'提交结果待核对':draft.conflict?'版本冲突':draft.count?draft.count+' 项未保存':draft.readOnly?'其他页面编辑中':Object.keys(draft.fields).length?'输入未保存':'已保存';
  const toolbar=<PageHeader title="项目空间" breadcrumbs={[{label:'进展表',onClick:filters.featureId?()=>patch({featureId:'',phaseId:''}):undefined},...(feature?[{label:feature.name}]:[])]}
    onBack={feature?()=>patch({featureId:'',phaseId:''}):undefined}
    actions={<div className="page-editor-actions" aria-hidden="true"><div className="page-editor-history"/><div className="page-editor-primary"/></div>}
    status={status?<ToolbarStatus onClick={()=>set('pathPanel','changes')}>{status}</ToolbarStatus>:null}
    moreActions={<><button onClick={()=>go('/analytics')}>统计分析 · 全项目</button><button onClick={()=>go('/actions')}>待处理事项 · 全项目</button><button onClick={()=>go(scopeUrl())}>维护范围与依赖</button></>}/>;
  return <WorkspaceRuntimeContext.Provider value={runtime}>{toolbar}<div ref={root} className="project-progress-workspace" onKeyDown={e=>{if(e.key==='Escape'&&!e.defaultPrevented)runtime.dismiss(e.target as Element);}}>
    <ProgressFilters filters={filters} sort={params.get('progressSort')||(workspace?'manual':'name')} features={tree.map(row=>row.feature!)} people={people.data||[]} result={flattenWorkspaceRows(rows,{},true).filter(({row})=>row.kind==='requirement').length+' 项需求 · '+flattenWorkspaceRows(rows,{},true).filter(({row})=>row.kind==='work').length+' 项工作'} onChange={patch} onReset={()=>patch(Object.fromEntries(progressFilterFields.map(field=>[field,''])))}/>
    <WorkspaceGantt milestones={projection.milestones?.map(m=>({...m,achievedAt:formal.milestones?.find(f=>f.id===m.id)?.achievedAt||null}))} edges={projection.edges} rows={rows} people={people.data||[]} storageKey={account+':'+projectId+(workspace?':'+workspace.location.scope.kind+':'+workspace.location.scope.id:'')} asOfDate={report.asOfDate} selected={chosen?.id||selected} onSelect={select} onEnter={workspace?row=>{const scope=scopeFromObject(row.id,formal);if(scope)workspace.enter(scope);else select(row);}:undefined} filterKey={JSON.stringify(filters)} filtered={!!(filters.query||filters.stage||filters.status||filters.risk||filters.person||filters.schedule||filters.scope)}/>
    {!workspace&&chosen&&params.get('pathInspector')!=='closed'&&<ObjectInspector title={chosen.title} identity={chosen.id} onClose={close}>{chosen.temporary?<p>未保存对象。保存结构修改后可以记录执行事实。</p>:chosen.archived&&chosen.requirement?<><p>已归档 · {chosen.requirement.executionStage?.label||chosen.requirement.status}</p><p>{chosen.requirement.acceptanceCriteria||'完成标准未填写'}</p><p>交付记录中保留此需求。</p></>:chosen.requirementId?<RequirementObjectDetails id={chosen.requirementId} workItemId={chosen.kind==='work'?chosen.id:undefined} onOpenDependencies={()=>go(scopeUrl())}/>:chosen.feature?<DeliveryFeatureDetails feature={chosen.feature} phaseId={chosen.phase?.id} onEnter={stage=>patch({featureId:chosen.featureId,phaseId:chosen.phaseId||'',progressStage:stage||'',pathInspector:'closed'})} onPhase={()=>select(all.find(r=>r.id==='feature:'+chosen.featureId)!)}/>:null}</ObjectInspector>}
    {params.get('pathPanel')==='changes'&&<Modal title="未保存修改" onClose={()=>set('pathPanel','')}><CanvasDraftDetails draft={draft} data={projection} onGo={go}/><button className="ghost-button" onClick={()=>go(scopeUrl())}>在关系图中处理修改</button></Modal>}
  </div></WorkspaceRuntimeContext.Provider>;
}
