import {requirementStatusLabels,riskLabels} from '../../shared/domain';
import {dashboardScopeLabels} from '../../shared/dashboard';
import {ApiError} from '../api';
import {ObjectInspector} from '../components/ObjectInspector';
import {progressEntryParams} from '../project-workspace-navigation';
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
import {SearchInput} from '../components/SearchInput';
import {Select} from '../components/Select';
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
  if(!report.data||!graph.data||report.unavailable||graph.unavailable)return <><PageHeader title="项目工作区"/><div className="page-content"><p>{report.error?.message||graph.error?.message||(!selectedProjectId?'请选择项目':'正在读取计划与进展…')}</p>{(report.error||graph.error)&&<button className="ghost-button" onClick={()=>{void report.refetch();void graph.refetch();}}>重新读取</button>}</div></>;
  return <ProgressWorkspace key={(session.accountId||'guest')+selectedProjectId} report={report.data} formal={graph.data.analysis}/>;
}
function ProgressWorkspace({report,formal}:{report:Dashboard;formal:PathAnalysis}){
  const {session}=useSession(),account=session.accountId||'guest',projectId=formal.projectId,client=useQueryClient(),go=useAppNavigate();
  const [params,setParams]=useSearchParams(),[runtime]=useState(()=>new WorkspaceRuntime());
  const people=useResourceQuery<Person[]>([...keys.people,projectId],'/api/people?projectId='+projectId);
  const root=useRef<HTMLDivElement>(null);useWorkspaceEvents(runtime,root);
  const draft=useDependencyDraft(account,formal,'project',()=>invalidateRequirementViews(client));runtime.document=draft;
  const projection=useMemo(()=>draft.preview?.analysis||draftNetwork(formal,draft.changes,draft.templateInstances),[formal,draft.changes,draft.preview,draft.templateInstances]);
  const tree=useMemo(()=>workspaceRows(report,projection),[report,projection]),all=useMemo(()=>flattenWorkspaceRows(tree,{},true).map(r=>r.row),[tree]);
  const patch=(values:Record<string,string>)=>setParams(old=>{const next=new URLSearchParams(old);for(const [name,value] of Object.entries(values)){if(value)next.set(name,value);else next.delete(name);}return next;},{replace:true});
  const set=(name:string,value:string)=>patch({[name]:value});
  const filters={query:params.get('q')||'',featureId:params.get('featureId')||'',phaseId:params.get('phaseId')||'',state:params.get('progressState')||'active',stage:params.get('progressStage')||'',status:params.get('progressStatus')||'',risk:params.get('progressRisk')||'',person:params.get('progressPerson')||'',schedule:params.get('progressSchedule')||'',scope:params.get('progressScope')||'',asOfDate:report.asOfDate};
  const filteredRows=filterWorkspaceRows(tree,filters),feature=report.featureOverview?.features.find(f=>f.id===filters.featureId);
  const rows=feature?filteredRows.flatMap(row=>row.children):filteredRows;
  const selected=params.get('pathNode')||params.get('requirementId')||'',phase=params.get('phaseId');
  const chosen=all.find(r=>r.id===selected&&(!selected.startsWith('feature:')||!phase))||(selected.startsWith('feature:')?all.find(r=>r.kind==='phase'&&r.phaseId===phase&&r.featureId===(params.get('featureId')||selected.slice(8))):undefined)||all.find(r=>r.id===selected);
  const close=()=>set('pathInspector','closed');
  const select=(row:WorkspaceRow)=>setParams(old=>{const next=new URLSearchParams(old);next.set('pathNode',row.id);next.delete('pathEdge');next.set('pathInspector','open');if(row.requirementId)next.set('requirementId',row.requirementId);else next.delete('requirementId');return next;},{replace:true});
  const scopeUrl=()=>{const next=new URLSearchParams(params);next.set('mode','graph');next.set('view',chosen?.requirementId?'requirement':chosen?.featureId?'feature':'features');if(chosen?.featureId)next.set('featureId',chosen.featureId);if(chosen?.phaseId)next.set('phaseId',chosen.phaseId);return '/?'+next;};
  const restoredLabel=(key:string,value:string)=>key==='Status'?({...requirementStatusLabels,unfinished:'未结束'} as Record<string,string>)[value]||value:key==='Risk'?({...riskLabels,pending:'待评估'} as Record<string,string>)[value]||value:key==='Scope'?(dashboardScopeLabels as Record<string,string>)[value]||value:key==='Schedule'?({delayed:'延期',unplanned:'未排期',planned:'已排期'} as Record<string,string>)[value]||value:report.requirements.find(r=>r.ownerId===value)?.ownerName||report.requirements.flatMap(r=>r.workItems).find(w=>w.ownerId===value)?.ownerName||'历史人员';
  const status=draft.loading?'恢复草稿…':draft.pending?'提交结果待核对':draft.conflict?'版本冲突':draft.count?draft.count+' 项未保存':draft.readOnly?'其他页面编辑中':Object.keys(draft.fields).length?'输入未保存':null;
  const toolbar=<PageHeader title="项目工作区" breadcrumbs={[{label:'项目计划',onClick:filters.featureId?()=>patch({featureId:'',phaseId:''}):undefined},...(feature?[{label:feature.name}]:[])]}
    onBack={feature?()=>patch({featureId:'',phaseId:''}):undefined}
    actions={<div className="page-editor-actions" aria-hidden="true"><div className="page-editor-history"/><div className="page-editor-primary"/></div>}
    status={status?<button className="ghost-button canvas-draft-status" onClick={()=>set('pathPanel','changes')}>{status}</button>:null}
    moreActions={<><button onClick={()=>go('/analytics')}>统计分析 · 全项目</button><button onClick={()=>go('/actions')}>待处理事项 · 全项目</button><button onClick={()=>go(scopeUrl())}>维护范围与依赖</button></>}/>;
  return <WorkspaceRuntimeContext.Provider value={runtime}>{toolbar}<div ref={root} className="project-progress-workspace" onKeyDown={e=>{if(e.key==='Escape'&&!e.defaultPrevented)runtime.dismiss(e.target as Element);}}>
    <div className="workspace-progress-tools" data-workspace-zone="tools" aria-label="进展筛选">
      <SearchInput value={filters.query} onChange={v=>set('q',v)} placeholder="搜索当前范围"/>
      <Select aria-label="进展特性" value={filters.featureId} onChange={e=>patch({featureId:e.target.value,phaseId:''})}><option value="">全部特性</option>{report.featureOverview?.features.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</Select>
      {feature&&<Select aria-label="进展 Phase" value={filters.phaseId} onChange={e=>set('phaseId',e.target.value)}><option value="">全部 Phase</option>{feature.phases?.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}<option value="unassigned">未安排 Phase</option></Select>}
      <Select aria-label="进展特性状态" value={filters.state} onChange={e=>set('progressState',e.target.value)}><option value="active">当前特性</option><option value="archived">已归档特性</option></Select>
      <Select aria-label="进展阶段" value={filters.stage} onChange={e=>set('progressStage',e.target.value)}><option value="">全部阶段</option>{Object.entries({not_started:'未开始',analysis:'分析／设计',development:'开发',integration:'联调',test_submitted:'已提测',testing:'测试',parallel:'并行推进',completed:'已完成',cancelled:'已取消'}).map(([id,label])=><option key={id} value={id}>{label}</option>)}</Select>
      {filters.phaseId&&!feature&&<span>Phase：{all.find(r=>r.phase?.id===filters.phaseId)?.title||filters.phaseId}<button className="ghost-button" onClick={()=>set('phaseId','')}>清除</button></span>}
    </div>
    {(['Status','Risk','Person','Schedule','Scope'] as const).some(key=>params.get('progress'+key))&&<div className="workspace-legacy-filters" aria-label="已恢复的进展条件">{Object.entries({Status:'执行状态',Risk:'风险',Person:'人员',Schedule:'计划',Scope:'统计范围'}).filter(([key])=>params.get('progress'+key)).map(([key,label])=><span key={key}>{label}：{restoredLabel(key,params.get('progress'+key)!)}<button className="ghost-button" onClick={()=>set('progress'+key,'')}>清除</button></span>)}</div>}
    <WorkspaceGantt rows={rows} people={people.data||[]} storageKey={account+':'+projectId} asOfDate={report.asOfDate} selected={chosen?.id||selected} onSelect={select} filtered={!!(filters.query||filters.stage||filters.status||filters.risk||filters.person||filters.schedule||filters.scope)}/>
    {chosen&&params.get('pathInspector')!=='closed'&&<ObjectInspector title={chosen.title} identity={chosen.id} onClose={close}>{chosen.temporary?<p>未保存对象。保存结构修改后可以记录执行事实。</p>:chosen.archived&&chosen.requirement?<><p>已归档 · {chosen.requirement.executionStage?.label||chosen.requirement.status}</p><p>{chosen.requirement.acceptanceCriteria||'完成标准未填写'}</p><p>交付记录中保留此需求。</p></>:chosen.requirementId?<RequirementObjectDetails id={chosen.requirementId} workItemId={chosen.kind==='work'?chosen.id:undefined} onOpenDependencies={()=>go(scopeUrl())}/>:chosen.feature?<DeliveryFeatureDetails feature={chosen.feature} phaseId={chosen.phase?.id} onEnter={stage=>patch({featureId:chosen.featureId,phaseId:chosen.phaseId||'',progressStage:stage||'',pathInspector:'closed'})} onPhase={()=>select(all.find(r=>r.id==='feature:'+chosen.featureId)!)}/>:null}</ObjectInspector>}
    {params.get('pathPanel')==='changes'&&<Modal title="未保存修改" onClose={()=>set('pathPanel','')}><CanvasDraftDetails draft={draft} data={projection} onGo={go}/><button className="ghost-button" onClick={()=>go(scopeUrl())}>在关系图中处理修改</button></Modal>}
  </div></WorkspaceRuntimeContext.Provider>;
}
