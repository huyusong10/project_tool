import {ToolbarStatus} from './ToolbarStatus';
import {Select} from './Select';
import {useAppNavigate} from '../use-app-navigation';
import {flushSync} from 'react-dom';
import { PageHeader } from './PageHeader';
import {randomUUID} from '../random-uuid';
import {DeliveryImpactTable} from './DeliveryImpactTable';
import {useWorkspaceParams} from '../use-workspace-view';
import {editorAdapter} from '../editor-adapter';
import {EditorField} from './EditorField';
import {fieldObjectId} from '../editor-fields';
import {useEditorInteraction} from '../use-editor-interaction';
import type {GraphConnectionIssue} from './DependencyGraph';
import { useCallback,useEffect,useMemo,useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { api, ApiError,jsonBody, requiresWriteRecheck } from '../api';
import {Link2,Copy,Trash2,LocateFixed,GitBranch,Maximize2,Minimize2} from 'lucide-react';
import {EditorToolbar,EditorPalette,EditorInfo} from './EditorToolbar';
import {EditorRequirementCreate,EditorObjectProperties} from './EditorObjectForm';
import {changeEntity,copyEntities,deleteEntities} from '../editor-commands';
import type {Point} from '../path-layout';
import {vacantGroup} from '../fixed-routing';
import type {EditorEntityChange} from '../../shared/path-contracts';
import { useSession } from '../app-context';
import { useResourceQuery } from '../use-resource-query';
import { invalidateRequirementViews, keys } from '../query-keys';
import { canManageProject } from '../permissions';
import type { Requirement } from '../types';
import { acceptanceId, startId,dependencySource,dependencyTarget, type PathAnalysis, type PathNode } from '../../shared/paths';
import { addBusinessDays, riskLabels, todayIso } from '../../shared/domain';
import { hasWorkdayCalendarFallback } from '../../shared/workday';
import { projectPathGraph } from '../path-projection';
import {relationCaption,relationDescription,replaceDeliveryCondition} from '../path-relations';
import {DeliveryCondition} from './DeliveryCondition';
import {PathGantt,hasPathGanttDates} from './PathGantt';
import { Modal, useSynchronousPendingLock } from './Modal';
import { EmptyState, LoadingState } from './Feedback';
import { FormError } from './Form';
import '../paths.css';
import {emptyRequirementFilters,unfinishedStatuses,matchesRequirementFilters,compareRiskRequirements} from '../../shared/requirement-view';
import {matchesSearch} from '../../shared/search';
import {readPathFilters,writePathFilters,graphBranch,graphContext,cardFilterItem,cardSearch,remapEditorUrl,remapEditorViews,remapSavedEditorUrl} from '../path-view';
import {PathFilters} from './PathFilters';
import { GraphWorkspace } from './GraphWorkspace';
import { PredecessorPicker } from './PredecessorPicker';
import { clearProjectGraphDrafts,useDependencyDraft } from '../use-graph-draft';
import { draftNetwork, dependencyIssue } from '../dependency-draft';
import type { DependencyChanges } from '../../shared/path-contracts';
import type { GraphCard } from '../path-projection';
import {featurePathGraph} from '../../shared/feature-projection';
import {canvasView,canvasScope,requirementCanvasUrl,useCanvasNavigation} from '../canvas-navigation';
import {canvasNavigation} from './CanvasNavigation';
import {featurePhaseLayout,phaseLayoutChanges,constrainPhasePosition,type PhaseRegion} from '../phase-layout';
import {DeliveryFilters,ScopeTable,matchesDeliveryCard} from './DeliveryTables';
import {RequirementObjectDetails} from '../pages/RequirementPage';
import {DeliveryFeatureDetails} from './DeliveryFeatureDetails';
import {PhaseDialog,readPendingPhase,type PhaseEdit} from './PhasePlanning';
import {CanvasDraftDetails} from './CanvasDraftDetails';
export type PathRequirementContext=Pick<Requirement,'id'|'projectId'|'title'|'ownerId'|'status'>&{workItems:Array<Pick<Requirement['workItems'][number],'id'|'status'|'assigneeIds'>>};
type PlanPreview={impact:import('../../shared/delivery-impact').DeliveryImpact[];requirementId:string;projectId:string;baseStart:string;expectedRevision:number;previewToken:string;applicable:boolean;entries:Array<{workItemId:string;requirementId:string;title:string;currentStart:string|null;currentEnd:string|null;proposedStart:string|null;proposedEnd:string|null;reasons:string[]}>};
type DependencyPlanRecheck={baseStart:string;expectedRevision:number;previewToken:string;entries:Array<{id:string;start:string|null;end:string|null}>};
type MilestoneRecheck={id:string;action:'achieve'|'reopen'};
type Editor = {kind:'relation'}|{kind:'estimate';node:PathNode}|{kind:'plan';baseStart?:string};

const dependencyPlanRecheckKey=(accountId:string,requirementId:string)=>`pm-dependency-plan-recheck:${accountId}:${requirementId}`;
function readDependencyPlanRecheck(accountId:string,requirementId:string):DependencyPlanRecheck|null{
  try{
    const value=JSON.parse(sessionStorage.getItem(dependencyPlanRecheckKey(accountId,requirementId))||'null') as Partial<DependencyPlanRecheck>|null;
    if(!value||typeof value.baseStart!=='string'||!Number.isSafeInteger(value.expectedRevision)||typeof value.previewToken!=='string'||!Array.isArray(value.entries))return null;
    if(!value.entries.every(entry=>entry&&typeof entry.id==='string'&&(entry.start===null||typeof entry.start==='string')&&(entry.end===null||typeof entry.end==='string')))return null;
    return value as DependencyPlanRecheck;
  }catch{return null;}
}
function writeDependencyPlanRecheck(accountId:string,requirementId:string,value:DependencyPlanRecheck|null){
  try{const key=dependencyPlanRecheckKey(accountId,requirementId);if(value)sessionStorage.setItem(key,JSON.stringify(value));else sessionStorage.removeItem(key);}catch{/* 当前页面仍保留核对锁。 */}
}
const milestoneRecheckKey=(accountId:string,projectId:string)=>`pm-milestone-recheck:${accountId}:${projectId}`;
function readMilestoneRecheck(accountId:string,projectId:string):MilestoneRecheck|null{
  try{const value=JSON.parse(sessionStorage.getItem(milestoneRecheckKey(accountId,projectId))||'null') as Partial<MilestoneRecheck>|null;return value&&typeof value.id==='string'&&(value.action==='achieve'||value.action==='reopen')?value as MilestoneRecheck:null;}catch{return null;}
}
function writeMilestoneRecheck(accountId:string,projectId:string,value:MilestoneRecheck|null){
  try{const key=milestoneRecheckKey(accountId,projectId);if(value)sessionStorage.setItem(key,JSON.stringify(value));else sessionStorage.removeItem(key);}catch{/* 当前页面仍保留核对锁。 */}
}

function PathEditor({editor,data,requirement,manager,onClose,onReload,onPlanRecheckChange,onRecheckPlan}:{editor:Editor;data:PathAnalysis;requirement?:PathRequirementContext;manager:boolean;onClose:()=>void;onReload:()=>Promise<PathAnalysis>;onPlanRecheckChange:(value:DependencyPlanRecheck|null)=>void;onRecheckPlan:()=>Promise<{latest:PathAnalysis;applied:boolean}>}) {
  const client=useQueryClient(), [baseline,setBaseline]=useState(data.revision),[needsCheck,setNeedsCheck]=useState(false),[reloadError,setReloadError]=useState(''),[preview,setPreview]=useState<PlanPreview|null>(null);
  const [sourceReq,setSourceReq]=useState(requirement?.id||data.requirements[0]?.id||''),[targetReq,setTargetReq]=useState(requirement?.id||data.requirements[1]?.id||data.requirements[0]?.id||'');
  const [sourceWork,setSourceWork]=useState(''),[targetWork,setTargetWork]=useState('');
  const estimate=editor.kind==='estimate'?editor.node.estimate:null;
  const [duration,setDuration]=useState(String(estimate?.durationDays??(editor.kind==='estimate'?Math.max(1,editor.node.remainingDays):1))),[earliest,setEarliest]=useState(estimate?.earliestStart||'');
  const [forecast,setForecast]=useState(estimate?.forecastEnd||'');
  const [baseStart,setBaseStart]=useState(editor.kind==='plan'&&editor.baseStart?editor.baseStart:addBusinessDays(todayIso(),0));
  const stale=baseline!==data.revision||needsCheck;
  const {session}=useSession();
  const canEditStructure=manager||!!requirement&&requirement.ownerId===session.personId;
  const mutation=useMutation({mutationFn:async ({url,body,method='POST'}:{url:string;body:unknown;method?:string})=>api(url,{method,body:jsonBody(body)}),onSuccess:()=>{if(editor.kind==='plan')onPlanRecheckChange(null);invalidateRequirementViews(client,requirement?.id);onClose();},onError:(error)=>{if(requiresWriteRecheck(error))setNeedsCheck(true);else if(editor.kind==='plan')onPlanRecheckChange(null);}});
  const planning=useMutation({mutationFn:()=>api<PlanPreview>(`/api/requirements/${requirement!.id}/dependency-plan/preview`,{method:'POST',body:jsonBody({baseStart,expectedRevision:baseline}),readOnly:true}),onSuccess:setPreview});
  const saveLock=useSynchronousPendingLock(mutation.isPending),planningLock=useSynchronousPendingLock(planning.isPending);
  const close=()=>{if(saveLock.canClose())onClose();};
  const options=data.requirements.filter(r=>manager||r.id===requirement?.id);
  const submit=()=>{
    if(stale)return;
    const version={expectedRevision:baseline};
    saveLock.run(()=>{
      if(editor.kind==='relation') mutation.mutate({url:`/api/projects/${data.projectId}/dependencies`,body:{...version,sourceRequirementId:sourceReq,sourceWorkItemId:sourceWork||null,targetRequirementId:targetReq,targetWorkItemId:targetWork||null}});
      if(editor.kind==='estimate') mutation.mutate({url:`/api/work-items/${editor.node.id}/path-estimate`,method:'PATCH',body:{...version,...canEditStructure?{durationDays:Number(duration),earliestStart:earliest||null}:{},forecastEnd:forecast||null}});
      if(editor.kind==='plan'&&preview){onPlanRecheckChange({baseStart,expectedRevision:baseline,previewToken:preview.previewToken,entries:preview.entries.map(entry=>({id:entry.workItemId,start:entry.proposedStart,end:entry.proposedEnd}))});mutation.mutate({url:`/api/requirements/${requirement!.id}/dependency-plan/apply`,body:{baseStart,expectedRevision:baseline,previewToken:preview.previewToken}});}
    });
  };
  const labels={relation:'配置交付前置',estimate:'工期与交付预测',review:'核对需求依赖',plan:'按依赖预览排期',acceptance:'预计验收日期'};
  return <Modal title={labels[editor.kind]} width={editor.kind==='plan'?880:660} closable={!saveLock.busy} onClose={close}>
    <form className="path-editor" onSubmit={e=>{e.preventDefault();submit();}}><fieldset disabled={saveLock.busy}>
      {stale&&<div className="warning-banner">数据或操作结果需要重新核对，已填内容保留。<button type="button" className="ghost-button" onClick={()=>void (editor.kind==='plan'?onRecheckPlan():onReload().then(latest=>({latest,applied:false}))).then(({latest,applied})=>{if(applied)return;setBaseline(latest.revision);setNeedsCheck(false);setPreview(null);setReloadError('');}).catch(error=>setReloadError(error.message))}>重新读取并核对</button></div>}
      {editor.kind==='relation'&&<><p>前置完成后，后续工作才具备开始条件。多个前置必须全部满足。</p>
        <div className="path-form-grid">{(['source','target'] as const).map(side=>{
          const source=side==='source',reqId=source?sourceReq:targetReq;
          return <div key={side}><label className="field"><span>{source?'前置需求':'后续需求'}</span><Select aria-label={source?'前置需求':'后续需求'} value={reqId} onChange={e=>{if(source){setSourceReq(e.target.value);setSourceWork('');}else{setTargetReq(e.target.value);setTargetWork('');}}}>{options.map(r=><option value={r.id} key={r.id}>{r.title}</option>)}</Select></label>
            <label className="field"><span>{source?'交付点':'开始条件'}</span><Select aria-label={source?'前置交付点':'后续工作'} value={source?sourceWork:targetWork} onChange={e=>source?setSourceWork(e.target.value):setTargetWork(e.target.value)}><option value="">{source?'整需求验收完成':'整个需求开始'}</option>{data.nodes.filter(n=>n.requirementId===reqId&&n.kind==='work').map(n=><option key={n.id} value={n.id}>{n.title}</option>)}</Select></label></div>;
        })}</div></>}
      {editor.kind==='estimate'&&<><p>{editor.node.title}</p><div className="path-form-grid">{canEditStructure&&<><label className="field"><span>预计工期（工作日）</span><input type="number" min={1} max={3660} value={duration} onChange={e=>setDuration(e.target.value)} required/></label><label className="field"><span>最早开始（可选约束）</span><input type="date" value={earliest} onChange={e=>setEarliest(e.target.value)}/></label></>}
        <label className="field"><span>人工预测完成</span><input type="date" min={data.asOfDate} value={forecast} onChange={e=>setForecast(e.target.value)}/></label></div><p className="field-help">日期可留空，修改预测不自动改写计划。</p></>}
      {editor.kind==='plan'&&<><label className="field"><span>需求开始锚点</span><input type="date" min={data.asOfDate} value={baseStart} onChange={e=>{setBaseStart(e.target.value);setPreview(null);}} required/></label><button type="button" className="ghost-button" disabled={stale||planningLock.busy} onClick={()=>planningLock.run(()=>planning.mutate())}>生成差异预览</button>
        {preview&&<div className="path-table-scroll">{requirement&&<></>}<table><thead><tr><th>工作项</th><th>当前计划</th><th>建议计划</th></tr></thead><tbody>{preview.entries.map(e=><tr key={e.workItemId}><td>{e.title}</td><td>{e.currentStart||'—'} ～ {e.currentEnd||'—'}</td><td>{e.proposedStart&&e.proposedEnd?`${e.proposedStart} ～ ${e.proposedEnd}`:e.reasons.join('；')}</td></tr>)}</tbody></table><DeliveryImpactTable entries={preview.impact||[]}/><p>涉及 {new Set(preview.entries.map(e=>e.requirementId)).size} 个需求，只调整未开始工作。</p></div>}</>}
      <FormError>{mutation.error?.message||planning.error?.message||reloadError}</FormError>
      <div className="button-row"><button type="button" className="ghost-button" onClick={close}>取消</button><button className="primary-button" disabled={stale||saveLock.busy||(editor.kind==='plan'&&!preview?.applicable)}>{saveLock.busy?'保存中…':false?'确认已核对':editor.kind==='plan'?'应用以上计划':'保存'}</button></div>
    </fieldset></form>
  </Modal>;
}


export function PathAnalysisPanel({projectId,requirement,onExit}:{projectId:string;requirement?:PathRequirementContext;onExit?:()=>void}) {
  const [params]=useWorkspaceParams();
  const {session}=useSession();
  const location=useLocation(),navigate=useAppNavigate(),url=location.pathname+location.search;
  const savedUrl=remapSavedEditorUrl(url,(session.accountId||'guest')+':'+projectId);
  useEffect(()=>{if(savedUrl!==url)navigate(savedUrl,{replace:true,state:location.state});},[savedUrl,url,navigate,location.state]);
  const target=params.get('target')||(requirement?acceptanceId(requirement.id):'project');
  const requirementId=params.get('view')==='requirement'?params.get('requirementId')||'':requirement?.id||'';
  const actualTarget=params.get('target')||(requirementId&&!params.has('draftProject')?acceptanceId(requirementId):'project');
  const query=useResourceQuery<{analysis:PathAnalysis}>([...keys.paths,projectId,requirementId||'all',actualTarget,'canvas',session.accountId],
    '/api/projects/'+projectId+'/path-graph?'+new URLSearchParams({view:'project',target:actualTarget}),!!projectId);
  useEffect(()=>{if(query.error instanceof ApiError&&[401,403].includes(query.error.status))clearProjectGraphDrafts(session.accountId||'guest',projectId);},[query.error,session.accountId,projectId]);
  if(query.isLoading||query.unavailable||!query.data)return <><PageHeader title="项目工作区" titlePending={query.isLoading} actions={<span/>}/><div className="path-analysis immersive-path graph-loading-shell"><section className="graph-workspace">
    {query.isLoading?<LoadingState label="正在分析交付依赖…"/>:<EmptyState title="路径分析数据不可用" detail={query.error?.message||'请选择项目'} action={<button className="ghost-button" onClick={()=>void query.refetch()}>重新加载</button>}/>}
  </section></div></>;
  const data=query.data.analysis,r=data.requirements.find(r=>r.id===requirementId);
  const context:PathRequirementContext|undefined=requirement|| (requirementId?{id:requirementId,projectId,title:r?.title||'需求草稿',ownerId:r?.ownerId||null,status:(r?.status||'not_started') as Requirement['status'],workItems:data.nodes.filter(n=>n.requirementId===requirementId&&n.kind==='work').map(n=>({id:n.id,status:n.status as Requirement['status'],assigneeIds:n.assigneeIds||[]}))}:undefined);
  return <PathWorkspace key={projectId+':'+canvasScope(params)} data={data} requirement={context} target={params.has('draftProject')?'project':requirementId?params.get('target')||acceptanceId(requirementId):target} onExit={onExit}
    onReload={async()=>{const result=await query.refetch({throwOnError:true});return result.data!.analysis;}}/>;
}
function EstimateFields({node,structure,onChange}:{node:PathNode;structure:boolean;onChange:(patch:DependencyChanges['estimates'][number])=>void}) {
  return <div className="graph-fields">{(['durationDays','earliestStart','forecastEnd'] as const).filter(k=>k!=='durationDays'&&(structure||k!=='earliestStart')).map(key=>
    <label className="field" key={key}><span>{{durationDays:'预计工期（工作日）',earliestStart:'最早开始',unblockEstimate:'预计解阻',forecastEnd:'人工预测完成'}[key]}</span>
      <EditorField fieldKey={node.id+':'+key} aria-label={{durationDays:'预计工期',earliestStart:'最早开始',unblockEstimate:'预计解阻',forecastEnd:'人工预测完成'}[key]} type={key==='durationDays'?'number':'date'} min={key==='durationDays'?1:undefined} max={key==='durationDays'?3660:undefined} value={String(node.estimate[key]??'')} onCommit={value=>onChange({workItemId:node.id,[key]:value?(key==='durationDays'?Number(value):value):null})}/></label>)}
    <small>字段修改加入草稿。保存预测后，计划日期仍需单独预览并应用。</small></div>;
}
function PathWorkspace({data:formal,requirement,target,onReload}:{data:PathAnalysis;requirement?:PathRequirementContext;target:string;onExit?:()=>void;onReload:()=>Promise<PathAnalysis>}) {
  const [params,setParams]=useWorkspaceParams(),location=useLocation(),navigate=useAppNavigate(),client=useQueryClient(),{session}=useSession();
  const mounted=useRef(true);
  const planAccountId=session.accountId||'guest',planRequirementId=requirement?.id||'',milestoneProjectId=formal.projectId;
  const [planRecheck,setPlanRecheckState]=useState<DependencyPlanRecheck|null>(()=>planRequirementId?readDependencyPlanRecheck(planAccountId,planRequirementId):null),[planRechecking,setPlanRechecking]=useState(false);
  const setPlanRecheck=(value:DependencyPlanRecheck|null)=>{if(planRequirementId)writeDependencyPlanRecheck(planAccountId,planRequirementId,value);setPlanRecheckState(value);};
  const [milestoneRecheck,setMilestoneRecheckState]=useState<MilestoneRecheck|null>(()=>readMilestoneRecheck(planAccountId,milestoneProjectId)),[milestoneRechecking,setMilestoneRechecking]=useState(false),[milestoneBusy,setMilestoneBusy]=useState('');
  const setMilestoneRecheck=(value:MilestoneRecheck|null)=>{writeMilestoneRecheck(planAccountId,milestoneProjectId,value);if(mounted.current)setMilestoneRecheckState(value);};
  const milestoneSubmitting=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>setPlanRecheckState(planRequirementId?readDependencyPlanRecheck(planAccountId,planRequirementId):null),[planAccountId,planRequirementId]);
  useEffect(()=>setMilestoneRecheckState(readMilestoneRecheck(planAccountId,milestoneProjectId)),[planAccountId,milestoneProjectId]);
  const focus=requirement?.id,manager=canManageProject(session,formal.projectId),canEdit=!(params.get('view')==='feature'&&formal.featureContext?.overview.features.find(g=>g.id===params.get('featureId'))?.archivedAt)&&(manager||!!requirement&&requirement.ownerId===session.personId);
  const draft=useDependencyDraft(session.accountId||'guest',formal,target,receipt=>{
    invalidateRequirementViews(client,focus);
    if(receipt){const scope=(session.accountId||'guest')+':'+formal.projectId,ids=receipt.addedIds;
      remapEditorViews(scope,ids);
      // A save can finish while another route is opening. Remap only the live URL,
      // and never replay the page/search captured when saving began.
      const currentUrl=window.location.pathname+window.location.search,nextUrl=remapEditorUrl(currentUrl,ids);
      if(mounted.current&&nextUrl!==currentUrl)navigate(nextUrl,{replace:true,state:window.history.state?.usr});
    }
    void onReload().catch(()=>{});
  });
  const navigation=useCanvasNavigation(session.accountId||'guest',formal.projectId,async()=>{flushSync(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});await draft.flush();return true;});
  const featureScope=canvasView(params)==='feature'?params.get('featureId')||'unassigned':undefined;
  const data=useMemo(()=>draft.preview?.analysis||draftNetwork(formal,draft.changes,draft.templateInstances),[draft.preview,formal,draft.changes,draft.templateInstances]);
  const editing=draft.active&&!draft.busy&&!draft.pending&&!draft.loading&&!draft.readOnly,search=params.get('pathSearch')||'';
  const viewStorage='pm-path-view:'+(session.accountId||'guest')+':'+formal.projectId+':'+(focus||(featureScope?'feature:'+featureScope:'all'));
  const historyViewStorage=viewStorage+':history:'+(window.history.state?.idx??0);
  const viewLoaded=useRef(false);
  useEffect(()=>{
    try{if(!viewLoaded.current){viewLoaded.current=true;const saved=sessionStorage.getItem(historyViewStorage)??localStorage.getItem(viewStorage);if(saved&&![...params.keys()].some(k=>k.startsWith('path'))){const next=new URLSearchParams(params);for(const [k,v] of new URLSearchParams(saved))if(k.startsWith('path'))next.set(k,v);setParams(next,{replace:true,state:location.state});return;}}
      localStorage.setItem(viewStorage,params.toString());
      sessionStorage.setItem(historyViewStorage,params.toString());
    }catch{/* Explicit URL navigation remains available. */}
  },[viewStorage,historyViewStorage,params,setParams,location.state]);
  const panel=params.get('pathPanel')||'',setPanel=(value:string)=>{setParam('pathPanel',value);if(panel==='connectionIssue'&&value!==panel)setIssue(undefined);};
  const [phaseEdit,setPhaseEdit]=useState<PhaseEdit|null>(()=>readPendingPhase(planAccountId,formal.projectId)?.edit||null);
  const activeFeature=data.featureContext?.overview.features.find(f=>f.id===featureScope);
  const [placing,setPlacing]=useState(''),[creatingRequirement,setCreatingRequirement]=useState<Point|null>(null);
  const livePositions=useRef<Record<string,Point>>({}),liveRegions=useRef<PhaseRegion[]>([]);
  const layoutScope=focus?'requirement:'+focus:featureScope?'feature:'+featureScope:'global',layoutValue=data.layouts?.find(l=>l.scope===layoutScope&&l.direction==='right'),formalLayout=formal.layouts?.find(l=>l.scope===layoutScope&&l.direction==='right');
  const withLayout=(changes:DependencyChanges,positions:Record<string,Point>):DependencyChanges=>phaseLayout?phaseLayoutChanges(changes,formal.layouts||[],liveRegions.current.length?liveRegions.current:phaseLayout.regions,positions):({...changes,layouts:[...(changes.layouts||[]).filter(l=>l.scope!==layoutScope||l.direction!=='right'),{scope:layoutScope,direction:'right',expectedVersion:formalLayout?.version||0,positions}]});
  const [relationId,updateRelationId]=useState(params.get('pathRelation')||'');
  const setRelationId=(id:string)=>{updateRelationId(id);setParam('pathRelation',id);};
  const {interaction,selected,edgeId,setEdgeId,select}=useEditorInteraction(params.get('pathNode')||params.get('workItemId')||'',selection=>{setParam('pathNode',selection.kind==='nodes'?selection.primary:'');setParam('pathEdge',selection.kind==='edge'?selection.id:'');setRelationId('');setInspector(selection.kind!=='none');if(narrow())setPanel('');},params.get('pathEdge')||'');
  const inspector=(params.get('pathInspector')||(matchMedia('(max-width:800px)').matches?'closed':'open'))==='open'&&(!!selected||!!edgeId||!!relationId),setInspector=(value:boolean)=>setParam('pathInspector',value?'open':'closed');
  const [locate,setLocate]=useState<{id:string;sequence:number}>();
  const [imported,setImported]=useState<string[]>(()=>selected?[selected]:[]),[issue,setIssue]=useState<GraphConnectionIssue>(),[confirmDiscard,setConfirmDiscard]=useState(false);
  const [guard,setGuard]=useState<null|(()=>void)>(null),[editor,setEditor]=useState<Editor|null>(null);
  const recheckPlan=async()=>{
    if(!planRecheck)throw new Error('没有待核对的排期操作');
    if(planRechecking)throw new Error('正在读取排期结果');
    const pending=planRecheck;setPlanRechecking(true);
    try{
      const latest=await onReload(),targetRequirement=latest.requirements.find(item=>item.id===planRequirementId);
      const applied=targetRequirement?.scheduleAnchor===pending.baseStart&&pending.entries.every(entry=>{const node=latest.nodes.find(item=>item.id===entry.id);return node?.plannedStart===entry.start&&node?.plannedEnd===entry.end;});
      if(mounted.current){setPlanRecheck(null);setIssue(undefined);if(applied)setEditor(null);else if(!editor)setEditor({kind:'plan',baseStart:pending.baseStart});}
      return {latest,applied};
    }catch(error){if(mounted.current)setIssue({message:'依赖排期结果仍无法读取，请稍后重试。'});throw error;}
    finally{if(mounted.current)setPlanRechecking(false);}
  };
  useEffect(()=>{const media=matchMedia('(max-width: 800px)'),changed=()=>{if(media.matches&&inspector){const next=new URLSearchParams(params);next.delete('pathPanel');next.set('pathInspector','open');setParams(next,{replace:true,state:location.state});}};media.addEventListener('change',changed);return()=>media.removeEventListener('change',changed);},[params,setParams,location.state,inspector]);
  useEffect(()=>setIssue(undefined),[draft.changes]);
  const branch=params.get('pathBranch')||'';
  const setParam=(name:string,value:string)=>{const next=params;if(value)next.set(name,value);else next.delete(name);setParams(new URLSearchParams(next),{replace:true,state:location.state});};
  const narrow=()=>matchMedia('(max-width: 800px)').matches;

  const openPanel=(name:string)=>{setPanel(panel===name?'':name);if(narrow())setInspector(false);};
  const navigatePath=(url:string)=>{void navigation.go(url);};
  const directTo=(requirementId:string,workItemId?:string|null,revealInvalid=false)=>{
    const url=new URL(requirementCanvasUrl(requirementId,params,data,workItemId),window.location.origin);if(draft.changes.entities?.some(c=>c.id===requirementId&&c.op==='create'))url.searchParams.set('draftProject',formal.projectId);
    void navigation.go(url.pathname+url.search,true,revealInvalid);
  };
  const guarded=(action:()=>void)=>{if(draft.count||draft.pending)setGuard(()=>action);else action();};
  const milestoneApplied=(latest:PathAnalysis,value:MilestoneRecheck)=>{const current=latest.milestones?.find(item=>item.id===value.id);return !!current&&(value.action==='achieve'?!!current.achievedAt:!current.achievedAt);};
  const recheckMilestone=async()=>{
    const pending=milestoneRecheck;if(!pending||milestoneRechecking)return;setMilestoneRechecking(true);
    try{const latest=await onReload();setMilestoneRecheck(null);invalidateRequirementViews(client,focus);if(mounted.current)setIssue(milestoneApplied(latest,pending)?undefined:{message:'已核对最新状态：里程碑操作未生效，可以重新操作。'});}
    catch(error){if(mounted.current)setIssue({message:error instanceof Error?error.message:'里程碑状态读取失败'});}
    finally{if(mounted.current)setMilestoneRechecking(false);}
  };
  const commandMilestone=async(value:NonNullable<PathAnalysis['milestones']>[number])=>{
    if(milestoneSubmitting.current||milestoneRecheck)return;
    milestoneSubmitting.current=true;setMilestoneBusy(value.id);
    const action=value.achievedAt?'reopen':'achieve',pending:MilestoneRecheck={id:value.id,action};setMilestoneRecheck(pending);
    try{
      await api('/api/milestones/'+value.id+'/'+action,{method:'POST',body:jsonBody({expectedVersion:value.version})});
      invalidateRequirementViews(client,focus);
      try{await onReload();setMilestoneRecheck(null);if(mounted.current)setIssue(undefined);}catch{if(mounted.current)setIssue({message:'里程碑操作已提交，但最新状态读取失败。请重新读取里程碑结果，本窗口不会重复提交。'});}
    }catch(error){
      if(requiresWriteRecheck(error)){
        try{const latest=await onReload();setMilestoneRecheck(null);if(milestoneApplied(latest,pending)){invalidateRequirementViews(client,focus);if(mounted.current)setIssue(undefined);return;}}
        catch{if(mounted.current)setIssue({message:'里程碑操作结果待核对。请重新读取里程碑结果，本窗口不会重复提交。'});return;}
      }
      setMilestoneRecheck(null);
      if(mounted.current)setIssue({message:error instanceof Error?error.message:'里程碑操作失败'});
    }finally{milestoneSubmitting.current=false;if(mounted.current)setMilestoneBusy('');}
  };
  const graph=useMemo(()=>{
    const value=featureScope&&data.featureContext?featurePathGraph(data,data.featureContext.overview,data.featureContext.relations,data.featureContext.requirements,featureScope):projectPathGraph(data,focus,false);
    if(focus)for(const id of new Set([...imported,...Object.keys(layoutValue?.positions||{}),...panel==='connectionIssue'?issue?.nodeIds||[]:[]])) {
      if(value.cards.some(c=>c.id===id))continue;
      const r=data.requirements.find(r=>r.id===id);if(r){value.cards.push({id:r.id,requirementId:r.id,workItemId:null,kind:'requirement',title:r.title,subtitle:'本项目需求',status:r.status,risk:data.risks[r.id]?.riskLevel||'pending',forecast:null,floatDays:null,critical:false,unknown:true,external:true,hiddenCount:0});continue;}const n=data.nodes.find(n=>n.id===id&&n.kind!=='project');if(!n)continue;
      value.cards.push({id:n.id,requirementId:n.requirementId!,workItemId:n.id,kind:n.kind,progress:n.progress,workStage:n.workStage,plannedEnd:n.plannedEnd,title:n.title,subtitle:'外部 · '+data.requirements.find(r=>r.id===n.requirementId)?.title,status:n.status,risk:data.risks[n.requirementId!]?.riskLevel||'pending',forecast:n.forecastEnd,floatDays:n.floatDays,critical:n.critical,unknown:!!n.unknownReasons.length,external:true,hiddenCount:0});
    }
    if(focus)for(const c of draft.changes.entities||[])if(c.entity==='requirement'&&c.op==='create'&&c.id!==focus&&!value.cards.some(n=>n.id===c.id))value.cards.push({id:c.id,requirementId:c.id,workItemId:null,kind:'requirement',title:c.data.title||'新需求',subtitle:'本项目 · 未保存需求',status:'not_started',risk:'pending',forecast:null,floatDays:null,critical:false,unknown:true,external:true,hiddenCount:0});
    if(focus&&panel==='connectionIssue')for(const edge of data.edges.filter(e=>issue?.edgeIds?.includes(e.id)))if(!value.links.some(e=>e.id===edge.id)&&value.cards.some(c=>c.id===edge.source)&&value.cards.some(c=>c.id===edge.target))value.links.push({...edge,dependencyIds:edge.dependencyId?[edge.dependencyId]:[],label:'交付前置'});
    if(draft.count&&!draft.preview)value.cards=value.cards.map(c=>({...c,forecast:null,floatDays:null,critical:false,unknown:true}));
    return value;
  },[data,focus,featureScope,imported,draft.count,draft.preview,draft.changes.entities,layoutValue?.positions,panel,issue]);
  const phaseLayout=useMemo(()=>featureScope?featurePhaseLayout(data,activeFeature,featureScope,graph.cards.map(c=>c.id)):undefined,[data,activeFeature,featureScope,graph.cards]);
  // Focus, selection and navigation do not change the filter projection.
  const filterValues=JSON.stringify(readPathFilters(params,!!focus||!!featureScope));
  const filters=useMemo(()=>params.get('mode')==='table'?emptyRequirementFilters():JSON.parse(filterValues) as ReturnType<typeof readPathFilters>,[filterValues,params]);
  const applyFilters=(value:ReturnType<typeof readPathFilters>)=>{setParams(writePathFilters(params,value),{replace:true,state:location.state});};
  const sorted=useMemo(()=>[...graph.cards].sort((a,b)=>compareRiskRequirements(cardFilterItem(a,data),cardFilterItem(b,data))),[graph.cards,data]);
  const matching=useMemo(()=>sorted.filter(c=>draft.changes.entities?.some(e=>e.op==='create'&&e.id===c.id)||matchesRequirementFilters(cardFilterItem(c,data),filters)).filter(c=>matchesDeliveryCard(c,data,params)),[sorted,data,filters,draft.changes.entities,params]);
  const ids=useMemo(()=>graphContext(new Set(matching.map(c=>c.id)),graph.links),[matching,graph.links]);
  const visibleIds=useMemo(()=>[...new Set([...ids,...panel==='connectionIssue'?(issue?.nodeIds||[]).map(id=>focus?id:data.nodes.find(n=>n.id===id)?.requirementId||id):[]])],[ids,panel,issue,focus,data.nodes]),contextIds=useMemo(()=>visibleIds.filter(id=>!matching.some(c=>c.id===id)),[visibleIds,matching]);
  const emphasized=useMemo(()=>branch?graphBranch(branch,focus?data.edges:graph.links):ids,[branch,focus,data.edges,graph.links,ids]);
  const emphasizedIds=useMemo(()=>visibleIds.filter(id=>emphasized.has(id)),[visibleIds,emphasized]);
  const invalidEdges=useMemo(()=>graph.links.filter(e=>(issue?.edgeIds||[]).some(id=>id===e.id||e.dependencyIds.includes(id))).map(e=>e.id),[graph.links,issue?.edgeIds]);
  const invalidNodes=useMemo(()=>(issue?.nodeIds||draft.issue?.nodeIds||[]).map(id=>focus?id:formal.nodes.find(n=>n.id===id)?.requirementId||id),[issue?.nodeIds,draft.issue?.nodeIds,focus,formal.nodes]);
  const floatScope=params.get('pathFloat');
  const floatMatch=useCallback((c:GraphCard)=>!floatScope||(floatScope==='unknown'?c.floatDays===null:floatScope==='critical'?c.floatDays===0:floatScope==='near'?c.floatDays!==null&&c.floatDays>0&&c.floatDays<=2:c.floatDays!==null&&c.floatDays>2),[floatScope]);
  const searchCards=useMemo(()=>{
    if(!focus)return graph.cards;const known=new Set(graph.cards.map(c=>c.id));
    const others:GraphCard[]=data.nodes.filter(n=>n.kind==='work'&&!known.has(n.id)).map(n=>({id:n.id,requirementId:n.requirementId!,workItemId:n.id,kind:n.kind,title:n.title,subtitle:'外部 · '+data.requirements.find(r=>r.id===n.requirementId)?.title,status:n.status,risk:data.risks[n.requirementId!]?.riskEvaluated?n.riskLevel:'pending',forecast:n.forecastEnd,floatDays:n.floatDays,critical:n.critical,unknown:!!n.unknownReasons.length,external:true,hiddenCount:0}));
    return [...graph.cards,...others];
  },[graph.cards,data,focus]);
  const results=useMemo(()=>search?searchCards.filter(c=>cardSearch(c,data,search)&&floatMatch(c)).sort((a,b)=>compareRiskRequirements(cardFilterItem(a,data),cardFilterItem(b,data))):sorted.filter(floatMatch),[search,searchCards,sorted,data,floatMatch]);
  const highlighted=useMemo(()=>search||floatScope?results.map(c=>c.id):[],[search,floatScope,results]);
  const listed=useMemo(()=>search?results:matching.filter(floatMatch),[search,results,matching,floatMatch]);
  const locateNode=(id:string)=>{
    if(focus&&!graph.cards.some(c=>c.id===id))setImported(current=>[...new Set([...current,id])]);
    if(!ids.has(id)){const next=writePathFilters(params,emptyRequirementFilters());next.delete('pathBranch');setParams(next,{replace:true,state:location.state});}
    else if(branch&&!emphasized.has(id))setParam('pathBranch','');
    setLocate({id,sequence:Date.now()});
  };
  const people=new Map<string,string>(),owners=new Map<string,string>();
  for(const r of data.requirements){if(r.ownerId)owners.set(r.ownerId,r.ownerName||'未命名人员');(r.assigneeIds||[]).forEach((id,i)=>people.set(id,r.assigneeNames?.[i]||id));}
  if(focus)for(const n of data.nodes)if(n.ownerId)owners.set(n.ownerId,n.ownerName||'未命名人员');
  const filterCount=Object.values(filters).reduce<number>((sum,v)=>sum+(Array.isArray(v)?v.length:Number(v)),0);
  const selectedCard=searchCards.find(c=>c.id===selected),node=data.nodes.find(n=>n.id===selected);
  const selectedEdge=graph.links.find(e=>e.id===edgeId),selectedRelation=data.dependencies.find(d=>d.id===(relationId|| (selectedEdge?.dependencyIds.length===1?selectedEdge.dependencyIds[0]:'')))
    ||(selectedEdge?.dependencyIds.length===1?data.dependencies.find(d=>d.id===selectedEdge.dependencyIds[0]):undefined);
  const editableRelation=(d:PathAnalysis['dependencies'][number])=>manager||canEdit&&d.sourceRequirementId===focus&&d.targetRequirementId===focus;
  const replaceRelation=(id:string,source:string,destination:string)=>{
    const original=data.dependencies.find(d=>d.id===id);
    if(!editing||!original||!editableRelation(original)){setIssue({message:'当前无权修改这条交付关系'});return;}
    const result=replaceDeliveryCondition(data,draft.changes,id,source,destination,randomUUID());
    if('issue' in result){setIssue(result.issue);return;}
    if(result.changes!==draft.changes)draft.change(result.changes);
    setRelationId(result.relationId);setInspector(true);setIssue(undefined);
  };
  const remove=(id:string,changes=draft.changes):DependencyChanges=>({...changes,add:changes.add.filter(e=>e.clientId!==id),remove:formal.dependencies.some(e=>e.id===id)?[...new Set([...changes.remove,id])]:changes.remove});
  const proposal=(source:string,destination:string):DependencyChanges['add'][number]|null=>{
    const a=graph.cards.find(c=>c.id===source),b=graph.cards.find(c=>c.id===destination);if(!a||!b)return null;
    return {clientId:randomUUID(),sourceRequirementId:a.requirementId,sourceWorkItemId:a.kind==='work'?a.id:null,sourceMilestoneId:a.kind==='milestone'?a.id:null,targetRequirementId:b.requirementId,targetWorkItemId:b.kind==='work'?b.id:null,targetMilestoneId:b.kind==='milestone'?b.id:null};
  };
  const validate=(source:string,destination:string):GraphConnectionIssue|null=>{
    if(source===destination)return {message:'不能依赖自身',nodeIds:[source]};
    const edge=proposal(source,destination);if(!edge)return {message:'交付端点已失效'};
    if(['completed','cancelled'].includes(data.requirements.find(r=>r.id===edge.targetRequirementId)?.status||'')||['completed','cancelled'].includes(data.nodes.find(n=>n.id===destination)?.status||''))return {message:'已结束的交付不能增加前置关系',nodeIds:[destination]};
    if(!manager&&(!canEdit||edge.sourceRequirementId!==focus||edge.targetRequirementId!==focus))return {message:'跨需求关系由项目经理维护'};
    const duplicate=data.dependencies.find(d=>d.sourceRequirementId===edge.sourceRequirementId&&d.targetRequirementId===edge.targetRequirementId&&d.sourceWorkItemId===edge.sourceWorkItemId&&d.targetWorkItemId===edge.targetWorkItemId&&(d.sourceMilestoneId||null)===(edge.sourceMilestoneId||null)&&(d.targetMilestoneId||null)===(edge.targetMilestoneId||null));
    if(duplicate)return {kind:'duplicate',message:'这条依赖已经存在',nodeIds:[source,destination],edgeIds:[duplicate.id],attempt:{source,target:destination}};
    const problem=dependencyIssue(formal,{...draft.changes,add:[...draft.changes.add,edge]},draft.templateInstances);return problem?{...problem,attempt:{source,target:destination}}:null;
  };
  const connect=(source:string,destination:string)=>{
    const error=validate(source,destination);if(error){setIssue(error);return;}
    draft.change({...draft.changes,add:[...draft.changes.add,proposal(source,destination)!]});setIssue(undefined);
  };
  const reconnectRelation=selectedRelation||(selectedEdge?.dependencyIds.length===1?data.dependencies.find(d=>d.id===selectedEdge.dependencyIds[0]):undefined);
  const canReconnect=editing&&reconnectRelation&&editableRelation(reconnectRelation)&&(!!focus||!reconnectRelation.sourceWorkItemId&&!reconnectRelation.targetWorkItemId);
  const reconnectChanges=(source:string,destination:string)=>{const next=remove(reconnectRelation!.id);return {...next,add:[...next.add,proposal(source,destination)!]};};
  const validateReconnect=(source:string,destination:string):GraphConnectionIssue|null=>{
    const edge=proposal(source,destination);if(!edge||!canReconnect)return {message:'不能改接该关系'};
    if(['completed','cancelled'].includes(data.requirements.find(r=>r.id===edge.targetRequirementId)?.status||'')||['completed','cancelled'].includes(data.nodes.find(n=>n.id===destination)?.status||''))return {message:'已结束的交付不能增加前置关系'};
    if(!manager&&(edge.sourceRequirementId!==focus||edge.targetRequirementId!==focus))return {message:'跨需求关系由项目经理维护'};
    const duplicate=data.dependencies.find(d=>d.id!==reconnectRelation!.id&&d.sourceRequirementId===edge.sourceRequirementId&&d.targetRequirementId===edge.targetRequirementId&&d.sourceWorkItemId===edge.sourceWorkItemId&&d.targetWorkItemId===edge.targetWorkItemId&&(d.sourceMilestoneId||null)===(edge.sourceMilestoneId||null)&&(d.targetMilestoneId||null)===(edge.targetMilestoneId||null));
    if(duplicate)return {kind:'duplicate',message:'这条依赖已经存在',nodeIds:[source,destination],edgeIds:[duplicate.id]};
    const problem=dependencyIssue(formal,reconnectChanges(source,destination),draft.templateInstances);return problem?{...problem,attempt:{source,target:destination}}:null;
  };
  const label=(id:string)=>{const n=data.nodes.find(n=>n.id===id),r=data.requirements.find(r=>r.id===(n?.requirementId||id));return n?(['work','milestone'].includes(n.kind)&&r?r.title+' · '+n.title:n.title):r?.title||'失效端点';};
  const issueCard=(id:string)=>focus?id:data.nodes.find(n=>n.id===id)?.requirementId||id;
  const nodeRelations=data.dependencies.filter(d=>focus?dependencySource(d)===selected||dependencyTarget(d)===selected:d.sourceRequirementId===selected||d.targetRequirementId===selected||d.sourceMilestoneId===selected||d.targetMilestoneId===selected);
  const issueRelations=data.dependencies.filter(d=>issue?.edgeIds?.includes(d.id));
  const relationLabel=(d:PathAnalysis['dependencies'][number])=>relationDescription(data,d);
  const locateEndpoint=(id:string)=>{
    const n=data.nodes.find(n=>n.id===id);
    if(n?.requirementId&&n.requirementId!==focus)directTo(n.requirementId,id);
    else{select(id);locateNode(id);}
  };
  const relationCard=(d:PathAnalysis['dependencies'][number],source:boolean)=>{
    const exact=source?d.sourceMilestoneId||d.sourceWorkItemId:d.targetMilestoneId||d.targetWorkItemId;
    if(exact)return exact;const id=source?d.sourceRequirementId:d.targetRequirementId;
    return graph.cards.some(c=>c.id===id)?id:source?acceptanceId(id):startId(id);
  };
  const incoming=data.dependencies.filter(d=>relationCard(d,false)===selected&&(focus||!d.sourceWorkItemId&&!d.targetWorkItemId));

  const scopeRelations=data.dependencies.filter(d=>focus?(d.sourceRequirementId===focus||d.targetRequirementId===focus):d.sourceRequirementId!==d.targetRequirementId||!d.sourceRequirementId&&!!d.sourceMilestoneId);
  const displayRelations=selectedEdge?data.dependencies.filter(d=>selectedEdge.dependencyIds.includes(d.id)):scopeRelations;
  const relationList=(relations:typeof data.dependencies)=><div className="graph-relation-list">{relations.length?relations.map(d=><div key={d.id}>
    <button className={selectedRelation?.id===d.id?'selected':''} onClick={()=>{setIssue(undefined);const edge=graph.links.find(e=>e.dependencyIds.includes(d.id));if(edge)setEdgeId(edge.id);else select('');setRelationId(d.id);setInspector(true);if(narrow())setPanel('');}}>{relationLabel(d)}<small>{relationCaption(data,d)} · {d.origin==='template'?'模板关系':'自定义关系'} · {formal.dependencies.some(e=>e.id===d.id)?'已保存':'未保存'}</small></button>
    {editing&&editableRelation(d)&&selectedRelation?.id===d.id&&<button className="ghost-button" onClick={()=>{draft.change(remove(d.id));setRelationId('');}}>移除选中关系</button>}
  </div>):<p>当前没有关系。</p>}</div>;
  const work=requirement?.workItems.find(w=>w.id===selected),canEstimate=!!work&&!['completed','cancelled'].includes(work.status)&&(canEdit||!!session.personId&&work.assigneeIds.includes(session.personId));
  const nodesPanel=<>
    {panel==='filters'&&<PathFilters value={filters} onChange={applyFilters} owners={[...owners].map(([id,title])=>({id,title}))} people={[...people].map(([id,title])=>({id,title}))} personId={session.personId} internal={!!focus}/>}
    <p className="graph-result-count">匹配 {matching.length} 项 · 关联上下文 {contextIds.length} 项</p>
    {!listed.length&&<p>没有匹配项。<button className="ghost-button" onClick={()=>{setParam('pathSearch','');applyFilters({...emptyRequirementFilters(),statuses:focus?[]:[...unfinishedStatuses]});}}>清空条件</button></p>}
    <div className="path-node-list">{listed.map(c=><div className="graph-list-row" key={c.id}><button className={selected===c.id?'selected':''} onClick={()=>select(c.id)}>{c.title}{focus&&<small>{c.external?'外部 · ':''}{data.requirements.find(r=>r.id===c.requirementId)?.title||'项目里程碑'}</small>}<small>{!ids.has(c.id)?'范围外 · ':branch&&!emphasized.has(c.id)?'分支外 · ':''}{c.forecast||'待确认'} · {riskLabels[c.risk as keyof typeof riskLabels]||'待评估'}</small>{search&&c.kind==='requirement'&&<small>{data.nodes.filter(n=>n.requirementId===c.id&&n.kind==='work'&&matchesSearch([{text:n.title,weight:1}],search)).map(n=>n.title).join('、')}</small>}</button><button className="ghost-button" onClick={()=>locateNode(c.id)}>{ids.has(c.id)?'定位':'查看全部并定位'}</button></div>)}</div></>;
  const finder=<><input aria-label="筛选图中节点" value={search} placeholder={focus?'搜索工作项／拼音':'搜索需求、工作项／拼音'} onChange={e=>{setParam('pathSearch',e.target.value);setPanel('nodes');}}/><button className="ghost-button" onClick={()=>openPanel('filters')}>筛选 · {filterCount}</button><button className="ghost-button" onClick={()=>openPanel('nodes')}>节点 {matching.length}</button><button className="ghost-button" onClick={()=>{setParam('pathSearch','');setParam('pathFloat','');applyFilters({...emptyRequirementFilters(),statuses:focus?[]:[...unfinishedStatuses]});}}>清空</button></>;
  const entityFor=(id:string):EditorEntityChange|null=>{
    const existing=draft.changes.entities?.find(c=>c.id===id);if(existing)return existing;
    const r=formal.requirements.find(r=>r.id===id),n=formal.nodes.find(n=>n.id===id)||data.nodes.find(n=>n.id===id),m=formal.milestones?.find(m=>m.id===id)||data.milestones?.find(m=>m.id===id);
    if(n?.kind==='execution'){const pending=draft.changes.entities?.find(c=>c.entity==='requirement'&&c.id===n.requirementId);if(pending)return pending;const r=formal.requirements.find(r=>r.id===n.requirementId);return r?{id:r.id,entity:'requirement',op:'update',expectedVersion:r.version,data:{}}:null;}
    if(r)return {id,entity:'requirement',op:'update',expectedVersion:r.version,data:{}};
    if(n&&['work','milestone'].includes(n.kind))return {id,entity:n.kind==='milestone'?'milestone':'work',op:'update',requirementId:n.requirementId,expectedVersion:m?.version||n.version,data:{}};
    return null;
  };
  const patchEntity=(id:string,patch:EditorEntityChange['data'])=>{const c=entityFor(id);if(!c||!canEdit||!manager&&(c.entity==='requirement'?c.id:c.requirementId)!==focus)return;draft.change(changeEntity(draft.changes,{...c,data:patch}));};
  const createEntity=(kind:string,position:Point,attributes?:EditorEntityChange['data'])=>{
    if(!editing||!canEdit)return;if(kind==='requirement'&&!attributes){setCreatingRequirement(position);setPlacing('');return;}
    const direct=kind==='work'&&data.requirements.find(r=>r.id===focus&&r.executionMode==='direct');
    const initial=draft.changes;
    const id=randomUUID(),entity=kind as EditorEntityChange['entity'],entry:EditorEntityChange={id,entity,op:'create',requirementId:entity==='requirement'?undefined:focus||null,data:attributes||(entity==='milestone'?{title:'新里程碑',confirmationMode:'auto'}:{title:'新工作项',durationDays:1,reason:requirement&&requirement.status!=='planning'&&requirement.status!=='not_started'?'在画布新增工作项':undefined})};
    if(entity==='requirement')entry.data.featureId=featureScope&&featureScope!=='unassigned'?featureScope:data.requirements.find(r=>r.id===focus)?.featureId||data.featureContext?.overview.features.find(f=>f.name==='其他特性'&&!f.archivedAt)?.id;
    const positions={...livePositions.current,...layoutValue?.positions,[id]:position};if(direct)delete positions['execute:'+direct.id];
    draft.change(withLayout({...initial,entities:[...initial.entities||[],entry]},positions));setPlacing('');setCreatingRequirement(null);select(id);
  };
  const duplicate=(selectedIds:string[],positions:Record<string,Point>,snapshot?:unknown)=>{if(!editing||!canEdit)return;positions=vacantGroup(graph.cards.map(c=>({id:c.id,...livePositions.current[c.id],width:244,height:154})),positions,true);const copied=copyEntities((snapshot as PathAnalysis)||data,draft.changes,selectedIds,focus);draft.change(withLayout(copied.changes,{...livePositions.current,...layoutValue?.positions,...Object.fromEntries(Object.entries(positions).filter(([id])=>copied.mapping[id]).map(([id,p])=>[copied.mapping[id],p]))}));if(copied.mapping[selectedIds[0]])select(copied.mapping[selectedIds[0]]);};
  const currentEntity=selectedCard?entityFor(selectedCard.id):null,milestone=data.milestones?.find(m=>m.id===selected);
  const selectedRequirementSaved=!!selectedCard&&formal.requirements.some(r=>r.id===selectedCard.requirementId);
  const objectValue=currentEntity?.entity==='requirement'?{...data.requirements.find(r=>r.id===currentEntity.id),...currentEntity.data}:currentEntity?.entity==='milestone'?{...milestone,...currentEntity.data}:{workStage:node?.workStage,title:node?.title,ownerId:node?.ownerId,assigneeIds:node?.assigneeIds,...node?.estimate,arrangement:node?.arrangement,arrangementAnchor:node?.arrangementAnchor,...currentEntity?.data};
  const analysisContext=<>{focus?<Select aria-label="分析目标" value={target} onChange={e=>setParam('target',e.target.value)}><option value={acceptanceId(focus)}>本需求完成</option><option value="project">项目交付</option>{data.nodes.filter(n=>n.requirementId===focus&&n.kind==='milestone').map(n=><option key={n.id} value={n.id}>{n.title}</option>)}{!data.nodes.some(n=>n.id===target&&n.requirementId===focus)&&target!=='project'&&<option value={target}>{data.targetLabel}</option>}</Select>:<Select aria-label="分析目标" value={target} onChange={e=>setParam('target',e.target.value)}><option value="project">项目交付</option>{data.nodes.filter(n=>n.kind==='milestone'&&!n.requirementId).map(n=><option key={n.id} value={n.id}>{n.title}</option>)}</Select>}<span title={'目标 '+(data.targetDate||'未设置')}>预计 {data.forecastEnd||'待确认'} · {data.deadlineSlack===null?'余量待确认':data.deadlineSlack+' 天余量'}</span></>;
  const toolbar=<EditorToolbar pageNavigation={canvasNavigation({params,data,onGo:navigatePath,onBack:navigation.back})} secondaryActions={<><button className="ghost-button" onClick={()=>navigatePath('/requirements'+(activeFeature?'?feature='+activeFeature.id:''))}>录入与导入</button>{activeFeature&&<button className="ghost-button" onClick={()=>{select('');setInspector(false);setParam('phaseDetails','1');}}>Phase 资料</button>}</>} title="项目工作区" editing={draft.active} begin={draft.begin} canEdit={canEdit||canEstimate} undo={()=>commands.dispatch({type:'undo'})} redo={()=>commands.dispatch({type:'redo'})} canUndo={draft.canUndo&&!draft.readOnly&&!draft.loading&&!draft.pending} canRedo={draft.canRedo&&!draft.readOnly&&!draft.loading&&!draft.pending} save={()=>void draft.save()} canSave={!draft.loading&&!draft.readOnly&&!!(draft.pending||!draft.conflict&&(draft.count||Object.keys(draft.fields).length))} busy={draft.busy||draft.loading} discard={()=>draft.count?setConfirmDiscard(true):draft.cancel()}

    status={<ToolbarStatus aria-label="草稿状态" disabled={milestoneRechecking||planRechecking} onClick={()=>{if(milestoneRecheck)void recheckMilestone();else if(planRecheck)void recheckPlan();else openPanel('changes');}} data-draft-stored={draft.stored} title={milestoneRecheck?'重新读取里程碑结果':planRecheck?'重新读取排期结果':draft.storageError||issue?.message||draft.error?.message||(draft.stored?'草稿已保留在本机':'正在保留本机草稿')}>{milestoneRechecking||planRechecking?'读取中…':milestoneRecheck?'里程碑待核对':planRecheck?'排期待核对':draft.loading?'恢复草稿…':draft.pending?'提交结果待核对':draft.storageError?'本机保存失败':draft.conflict?'版本冲突':draft.readOnly?'其他页面编辑中':draft.count?(draft.restored?'已恢复草稿 · ':'')+draft.count+' 项未保存':draft.active?'编辑中':location.state?.pathNotice||'已保存'}</ToolbarStatus>}
    extra={<>{branch&&<button className="ghost-button" onClick={()=>setParam('pathBranch','')}>退出聚焦</button>}{milestoneRecheck&&<button className="ghost-button danger-text" disabled={milestoneRechecking} onClick={()=>void recheckMilestone()}>{milestoneRechecking?'读取中…':'重新读取里程碑结果'}</button>}{planRecheck&&<button className="ghost-button danger-text" disabled={planRechecking} onClick={()=>void recheckPlan()}>{planRechecking?'读取中…':'重新读取排期结果'}</button>}{(draft.error||draft.conflict||issue)&&<button className="ghost-button danger-text" aria-label={draft.conflict?'版本冲突 · 查看修改':'查看草稿错误'} title="查看草稿修改与错误" onClick={()=>openPanel(issue?.kind?'connectionIssue':'changes')}>!</button>}<EditorInfo onClick={()=>openPanel('summary')}/><button className="ghost-button" aria-label="关系明细" title="关系明细" onClick={()=>openPanel('relations')}><Link2 size={17}/></button></>}/>;
  const embeddedId=selectedCard?.requirementId||(focus&&!selected?focus:undefined),savedEmbedded=embeddedId&&formal.requirements.some(r=>r.id===embeddedId);
  const phaseDetail=!inspector&&activeFeature&&params.get('phaseDetails')==='1'?<><DeliveryFeatureDetails feature={activeFeature} phaseId={params.get('phaseId')} onEnter={stage=>{setParam('stage',stage||'');setParam('pathInspector','closed');setParam('phaseDetails','');}} onPhase={()=>setParam('phaseId','')}/></>:undefined;
  const detail=inspector?<>
    {selectedEdge||selectedRelation?<>
      {!selectedRelation&&<p className="field-help">这条线汇总了 {displayRelations.length} 条关系，请选择一条查看或调整交付条件。</p>}
      {selectedEdge&&selectedEdge.dependencyIds.length>1&&selectedRelation&&<button className="ghost-button" onClick={()=>setRelationId('')}>返回全部 {selectedEdge.dependencyIds.length} 条关系</button>}
      {relationList(selectedRelation?[selectedRelation]:displayRelations)}
      {selectedRelation&&<DeliveryCondition data={data} relation={selectedRelation} editable={editing&&editableRelation(selectedRelation)} disabledReason={!editableRelation(selectedRelation)?'跨需求关系由项目经理维护':!editing?'开启编辑后可调整交付条件':undefined} issue={issue} onInspectIssue={()=>openPanel('connectionIssue')} onChange={(source,destination)=>commands.dispatch({type:'replaceRelation',id:selectedRelation.id,source,target:destination})} onLocate={locateEndpoint}/>}
    </>:selectedCard&&<>{!savedEmbedded&&<p>{selectedCard.subtitle}</p>}{!savedEmbedded&&data.risks[selectedCard.requirementId]?.riskReason&&<p>{data.risks[selectedCard.requirementId]?.riskReason}</p>}{node?.unknownReasons.length?<p className="danger-text">{node.unknownReasons.join('；')}</p>:null}
      {branch&&!emphasized.has(selected)&&<p className="graph-outside-notice">此节点在分支外，定位后返回全图。</p>}
      <div className="editor-selection-tools"><button title="定位" aria-label="定位" onClick={()=>locateNode(selected)}><LocateFixed size={16}/></button><button title={branch===selected?'退出聚焦':'聚焦分支'} aria-label={branch===selected?'退出聚焦':branch?'聚焦此分支':'聚焦分支'} onClick={()=>setParam('pathBranch',branch===selected?'':selected)}><GitBranch size={16}/></button>{editing&&canEdit&&currentEntity&&selectedCard.kind!=='execution'&&<><button title="复制（Alt 拖动 / Ctrl+C、V）" aria-label="复制元素" onClick={()=>commands.dispatch({type:'duplicate',ids:[selected],positions:{[selected]:{x:(livePositions.current[selected]?.x||0)+32,y:(livePositions.current[selected]?.y||0)+32}}})}><Copy size={16}/></button><button title="删除（Delete）" aria-label="删除元素" onClick={()=>commands.dispatch({type:'delete',ids:[selected]})}><Trash2 size={16}/></button></>}</div><div className="button-row">
        {selectedCard.requirementId&&(!focus||selectedCard.external)&&<>
          
          <button className={selectedRequirementSaved?'ghost-button':'primary-button'} onClick={()=>directTo(selectedCard.requirementId,selectedCard.workItemId)}>进入工作项</button>
        </>}
        
      </div>
      {!!nodeRelations.length&&<button className="ghost-button graph-node-relations" onClick={()=>openPanel('nodeRelations')}>已有关联 {nodeRelations.length} 条{nodeRelations.some(d=>d.sourceWorkItemId||d.targetWorkItemId)?' · 含指定环节':''}</button>}
      {editing&&canEdit&&currentEntity&&(!selectedCard.external||manager)&&<EditorObjectProperties objectId={selected} projectId={data.projectId} entity={currentEntity.entity} canManageDelivery={manager} value={{...objectValue,priority:objectValue.priority as EditorEntityChange['data']['priority']}} onChange={fields=>commands.dispatch({type:'properties',id:selected,fields})} anchors={data.nodes.filter(n=>n.kind==='milestone'&&n.id!==selected).map(n=>({id:n.id,title:n.title}))}/>}
      {milestone&&!editing&&canEdit&&<>{milestoneRecheck?.id===milestone.id&&<p role="alert" className="form-error">里程碑操作结果待核对，请重新读取里程碑结果。</p>}<button className="ghost-button" disabled={milestoneBusy===milestone.id||Boolean(milestoneRecheck)} onClick={()=>guarded(()=>void commandMilestone(milestone))}>{milestoneBusy===milestone.id?'处理中…':milestone.achievedAt?'重新打开里程碑':'确认里程碑达成'}</button></>}
      {editing&&canEstimate&&node?.kind==='work'&&!draft.changes.entities?.some(c=>c.id===node.id&&c.op==='create')&&<EstimateFields key={node.id} node={node} structure={canEdit} onChange={patch=>{
        if(draft.changes.entities?.some(c=>c.id===node.id&&c.op==='create')){const {workItemId:_id,...fields}=patch;patchEntity(node.id,fields);return;}const existing=draft.changes.estimates.find(p=>p.workItemId===patch.workItemId);
        draft.change({...draft.changes,estimates:[...draft.changes.estimates.filter(p=>p.workItemId!==patch.workItemId),{...existing,...patch}]});
      }}/>}
      {editing&&canEdit&&!['acceptance'].includes(selectedCard.kind)&&<details className="graph-more-relations"><summary>更多关系操作</summary><PredecessorPicker label={focus?'前置工作项':'前置需求'} value={incoming.map(d=>relationCard(d,true))}
        options={graph.cards.filter(c=>c.id!==selected&&c.kind!=='start'&&(manager||c.requirementId===focus)).map(c=>({id:c.id,title:c.title}))}
        onChange={ids=>{
          const current=incoming;
          let next=draft.changes;
          for(const d of current)if(!ids.includes(relationCard(d,true))&&editableRelation(d))next=remove(d.id,next);
          const existing=current.map(d=>relationCard(d,true));
          next={...next,add:[...next.add,...ids.filter(id=>!existing.includes(id)).map(id=>proposal(id,selected)!)]};
          const problem=dependencyIssue(formal,next,draft.templateInstances);if(problem)setIssue(problem);else{draft.change(next);setIssue(undefined);}
        }}/></details>}
      {savedEmbedded&&<details className="delivery-execution-detail" open={!editing}><summary>{editing?'正式执行资料与操作':node?.kind==='work'?'工作项资料与执行':'需求资料与执行'}</summary><RequirementObjectDetails id={embeddedId!} workItemId={node?.kind==='work'?node.id:undefined} onOpenDependencies={()=>{if(focus){draft.begin();setParam('mode','graph');}else directTo(embeddedId!);}}/></details>}{node?.source&&<details><summary>预测依据</summary><p>{node.source}</p></details>}{embeddedId&&!savedEmbedded&&<p className="field-help">未保存对象：保存草稿后才能执行、提测和交付。</p>}
    </>}
  </>:undefined;
  const scheduleNodes=focus?data.nodes.filter(n=>n.requirementId===focus&&n.kind!=='start'):data.nodes.filter(n=>n.kind==='acceptance'||n.kind==='milestone'&&!n.requirementId),datedSchedule=hasPathGanttDates(scheduleNodes,data.milestones),expandedSchedule=params.get('pathScheduleExpanded')==='1';
  const auxiliary=panel?<><div className="graph-panel-heading"><h3>{{filters:'筛选条件',nodes:'节点列表',blockers:'影响来源',float:'余量分布',relations:'关系明细',import:'添加已有对象',summary:'分析说明',schedule:'交付排期预览',changes:'修改与冲突',connectionIssue:'连线检查',nodeRelations:'节点关联'}[panel]}</h3><div className="graph-panel-heading-actions">{panel==='schedule'&&datedSchedule&&<button className="ghost-button" aria-label={expandedSchedule?'收起排期图':'展开排期图'} title={expandedSchedule?'收起排期图':'展开排期图'} onClick={()=>setParam('pathScheduleExpanded',expandedSchedule?'':'1')}>{expandedSchedule?<Minimize2 size={15}/>:<Maximize2 size={15}/>}</button>}<button className="ghost-button" onClick={()=>setPanel('')}>关闭</button></div></div>
    {(panel==='nodes'||panel==='filters')&&nodesPanel}
    {panel==='relations'&&relationList(scopeRelations)}
    {panel==='blockers'&&<>{!data.blockers.length&&<p>当前没有影响项。</p>}{data.blockers.map(b=><div className="graph-list-row" key={b.nodeId}><button onClick={()=>{if(!focus)select(b.requirementId||b.nodeId);else if(graph.cards.some(c=>c.id===b.nodeId))select(b.nodeId);else directTo(b.requirementId,b.workItemId);}}><strong>{b.title}</strong><small>{b.reasons.join('；')} · {b.ownerName||'未分派'}</small><small>{b.affectedRequirementIds.length} 个下游需求{b.critical?' · 影响关键路径':''}</small><span className="path-impact-bar"><i style={{width:Math.min(100,b.affectedRequirementIds.length/Math.max(1,data.coverage.total)*100)+'%'}}/></span></button></div>)}</>}
    {panel==='float'&&<><div className="path-float-distribution">{[{id:'critical',label:'0 天'},{id:'near',label:'1—2 天'},{id:'other',label:'大于 2 天'},{id:'unknown',label:'待确认'}].map(b=><button key={b.id} aria-pressed={params.get('pathFloat')===b.id} onClick={()=>setParam('pathFloat',params.get('pathFloat')===b.id?'':b.id)} className={params.get('pathFloat')===b.id?'selected':''}>{b.label}<strong>{matching.filter(c=>b.id==='critical'?c.floatDays===0:b.id==='near'?c.floatDays!==null&&c.floatDays>0&&c.floatDays<=2:b.id==='other'?c.floatDays!==null&&c.floatDays>2:c.floatDays===null).length}</strong></button>)}</div><small>当前匹配 {matching.length} 项；选择余量区间查看对应节点。</small>{params.get('pathFloat')&&<div className="path-float-results">{matching.filter(floatMatch).map(c=><div className="graph-list-row" key={c.id}><button onClick={()=>select(c.id)}>{c.title}<small>{c.forecast||'交付待确认'} · {riskLabels[c.risk as keyof typeof riskLabels]}</small></button><button className="ghost-button" onClick={()=>locateNode(c.id)}>定位</button></div>)}{!matching.some(floatMatch)&&<p>此区间没有匹配节点。</p>}</div>}</>}
    {panel==='nodeRelations'&&relationList(nodeRelations)}
    {panel==='connectionIssue'&&issue&&<><p className="form-error">{issue.message}</p>{issue.attempt&&<p>本次尝试：{label(issue.attempt.source)} → {label(issue.attempt.target)}（未加入草稿）</p>}{issue.kind==='cycle'&&<ol className="graph-cycle-path">{[...issue.nodeIds||[],...(issue.nodeIds?.length?[issue.nodeIds[0]]:[])].map((id,i)=><li key={i}><span>{label(id)}</span>{graph.cards.some(c=>c.id===issueCard(id))&&<button className="ghost-button" onClick={()=>setLocate({id:issueCard(id),sequence:Date.now()})}>定位</button>}</li>)}</ol>}{relationList(issueRelations)}<small>红色线条标出已存在的关联；临时显示范围外的路径节点，关闭后恢复原筛选范围。关系明细包含部分交付。</small></>}
    {panel==='schedule'&&<>{planRecheck&&<div className="warning-banner" role="alert">依赖排期应用结果待核对。重新读取路径分析前不会再次生成或应用排期。</div>}{draft.count>0&&<DeliveryImpactTable target={draft.preview?.differences.target} entries={draft.preview?.differences.impact||[]}/>}<p>{draft.count?'未保存预览':'已保存'} · {datedSchedule?'灰色为已确认计划，蓝色为当前预测。保存后仍需核对日期差异。':'当前没有可展示的日期，先确认工期和交付条件。'}</p>{datedSchedule&&<PathGantt key={focus||data.projectId} storageKey={`${data.projectId}:${focus||"global"}:path-schedule`} nodes={scheduleNodes} edges={data.edges} milestones={data.milestones} project={!focus} requirements={data.requirements} allNodes={data.nodes} asOfDate={data.asOfDate} onSelect={n=>focus?select(n.id):select(n.requirementId||n.id)}/>}{focus&&canEdit&&!draft.count&&<button className="ghost-button" disabled={Boolean(planRecheck)} onClick={()=>{if(!planRecheck)setEditor({kind:'plan'});}}>预览并应用计划日期</button>}</>}
    {panel==='import'&&<><input aria-label="搜索已有对象" placeholder="搜索需求、工作项或里程碑／拼音" value={search} onChange={e=>setParam('pathSearch',e.target.value)}/>{[...data.requirements.map(r=>({id:r.id,title:r.title,subtitle:'需求'})),...data.nodes.filter(n=>focus?['work','milestone'].includes(n.kind):n.kind==='milestone'&&!n.requirementId).map(n=>({id:n.id,title:n.title,subtitle:data.requirements.find(r=>r.id===n.requirementId)?.title||'项目里程碑'}))].filter(n=>matchesSearch([{text:n.title,weight:1},{text:n.subtitle,weight:1}],search)).map(n=><div className="graph-list-row" key={n.id}><button onClick={()=>{if(livePositions.current[n.id]){select(n.id);locateNode(n.id);return;}setImported(ids=>[...new Set([...ids,n.id])]);const p={x:Math.max(0,...Object.values(livePositions.current).map(p=>p.x))+320,y:80};draft.change(withLayout(draft.changes,{...livePositions.current,[n.id]:p}));select(n.id);setLocate({id:n.id,sequence:Date.now()});}}>{n.title}<small>{n.subtitle}</small></button></div>)}<small>放入画布仍指向原对象。布局在保存后共享。</small></>}
    {panel==='summary'&&<><div className="delivery-analysis-target">{analysisContext}</div><p>目标：{data.targetLabel}</p><p>业务日期：{data.asOfDate} · 版本 {formal.revision}</p><p>共 {data.coverage.total} 个需求；{data.coverage.unplanned} 个未排期。</p><p>{data.complete?'预测覆盖当前目标。':'仍有待确认条件，交付日期与余量不完整。'}</p><p>图中关键路径按当前目标计算；风险标签采用项目目标。草稿仅用于预览，保存后才刷新正式风险和甘特。</p>{hasWorkdayCalendarFallback([data.forecastEnd,data.targetDate])&&<p>部分日期超出法定工作日日历覆盖范围，按周一至周五计算。</p>}<button className="ghost-button" onClick={()=>void onReload()}>刷新分析</button></>}
    {panel==='changes'&&<CanvasDraftDetails draft={draft} data={data} onGo={url=>void navigation.go(url,true,true)}/>}
  </>:undefined;
  const commands=editorAdapter({properties:patchEntity,move:positions=>draft.change(withLayout(draft.changes,positions)),rename:(id,title)=>patchEntity(id,{title}),create:createEntity,duplicate:duplicate,replaceRelation,delete:(ids,edgeId)=>{const e=graph.links.find(e=>e.id===edgeId);if(e?.dependencyIds.length===1)draft.change(remove(e.dependencyIds[0]));else if(edgeId){setEdgeId(edgeId);setInspector(true);}else {draft.change(deleteEntities(data,draft.changes,ids));select('');}},connect:connect,reconnect:(source,destination)=>{const problem=validateReconnect(source,destination);if(problem)setIssue(problem);else{draft.change(reconnectChanges(source,destination));setRelationId('');setEdgeId('');}},undo:editing?draft.undo:undefined,redo:editing?draft.redo:undefined,save:()=>void draft.save(),copy:()=>structuredClone(data)},editing&&canEdit);
  return <div className="path-analysis immersive-path">{phaseEdit&&<PhaseDialog key={(phaseEdit.phase?.id||phaseEdit.feature.id)+phaseEdit.mode} edit={phaseEdit} onClose={()=>setPhaseEdit(null)}/>}<GraphWorkspace navigation={<DeliveryFilters workItems={!!focus} params={params} setParam={setParam} feature={activeFeature}/>} table={<ScopeTable params={params} onSort={v=>setParam('tableSort',v)} cards={matching.filter(c=>focus?c.kind!=='start'&&c.kind!=='acceptance'&&!c.external:c.kind==='requirement'&&!c.external)} data={data} selected={selected} onSelect={select} onEnter={id=>directTo(id)} focus={focus} onArrange={!focus&&manager&&!!data.featureContext?.overview.features.length?ids=>setPhaseEdit({feature:activeFeature||data.featureContext!.overview.features.find(f=>!f.archivedAt)!,mode:'placement',requirementIds:ids}):undefined}/> } onOpenNode={card=>{if(card.kind==='requirement'&&!card.archived)directTo(card.requirementId);else select(card.id);}} onRevealField={key=>{const id=fieldObjectId(key),card=graph.cards.find(c=>c.id===id);if(card){select(card.id);return;}const node=data.nodes.find(n=>n.id===id);if(node?.requirementId){directTo(node.requirementId,node.id,true);return;}if(id&&(data.requirements.some(r=>r.id===id)||data.milestones?.some(m=>m.id===id)))void navigation.go('/paths?'+new URLSearchParams({view:'project',pathScope:'all',target:'project',pathNode:id,pathInspector:'open'}),true,true);else setIssue({message:'无法定位待修正字段，请查看草稿所属对象是否仍可编辑。'});}} auxiliaryKey={panel} commands={commands} interaction={interaction} document={draft} cards={graph.cards} links={graph.links} visibleIds={visibleIds} contextIds={contextIds} emphasizedIds={emphasizedIds} onExitFocus={()=>{if(placing)setPlacing('');else setParam('pathBranch','');}} auxiliarySize={panel==='schedule'&&datedSchedule?expandedSchedule?'expanded':'timeline':'compact'}
    reconnect={canReconnect?{id:reconnectRelation!.id,source:focus?dependencySource(reconnectRelation!):reconnectRelation!.sourceRequirementId||reconnectRelation!.sourceMilestoneId!,target:focus?dependencyTarget(reconnectRelation!):reconnectRelation!.targetRequirementId||reconnectRelation!.targetMilestoneId!}:undefined}
    validateReconnect={validateReconnect}
    focusRegionId={params.get('phaseId')||undefined} regions={phaseLayout?.regions} constrainPosition={phaseLayout?(id,p)=>constrainPhasePosition(liveRegions.current.length?liveRegions.current:phaseLayout.regions,id,p):undefined} onSelectPhase={(_f,id)=>{select('');setInspector(false);setParam('phaseId',id==='external'?'':id);setParam('phaseDetails','1');}} positions={phaseLayout?.positions||layoutValue?.positions} onLayoutReady={(positions,regions)=>{livePositions.current=positions;if(regions)liveRegions.current=regions;}} placing={placing} onSearch={()=>openPanel('nodes')}
    palette={<EditorPalette types={focus?manager?['work','milestone','requirement','existing']:['work','milestone','existing']:['requirement','milestone','existing']} placing={placing} onPlace={kind=>{if(!draft.active)draft.begin();if(kind==='existing'){openPanel('import');setPlacing('');}else setPlacing(kind);}} disabled={!canEdit||draft.loading||draft.readOnly||!!draft.pending}/>} analysis={['schedule','blockers','float'].includes(panel)}
    onDismissDetail={()=>{setInspector(false);setParam('phaseDetails','');}} onDismissAuxiliary={()=>setPanel('')}
    viewKey={(session.accountId||'guest')+':'+formal.projectId+':'+(focus||(featureScope?'feature:'+featureScope:'all'))} historyIndex={window.history.state?.idx} toolbar={toolbar} finder={finder} detailTitle={inspector?(selectedRelation?'关系详情':selectedEdge?'交付关系':selectedCard?.title||'选择节点或连线'):'交付资料'} detail={detail||phaseDetail} auxiliary={auxiliary}
    editing={editing&&canEdit} validateConnection={validate} onInvalid={setIssue} onInspectIssue={value=>{setIssue(value);openPanel('connectionIssue');}} onClearIssue={()=>{setIssue(undefined);if(panel==='connectionIssue')setPanel('');}} invalidEdges={invalidEdges}
    highlighted={highlighted} invalidNodes={invalidNodes} locate={locate} focusId={branch||''}
    footer={<><button className="ghost-button" onClick={()=>openPanel('blockers')}>影响 {data.blockers.length}</button><button className="ghost-button" onClick={()=>openPanel('float')}>余量</button>

      <button className="ghost-button" onClick={()=>openPanel('schedule')}>排期预览</button>

    </>}/>
    {creatingRequirement&&<EditorRequirementCreate projectId={data.projectId} onClose={()=>setCreatingRequirement(null)} onCreate={value=>createEntity('requirement',creatingRequirement,value)}/>}
    {editor&&<PathEditor editor={editor} data={formal} requirement={requirement} manager={manager} onClose={()=>setEditor(null)} onReload={onReload} onPlanRecheckChange={setPlanRecheck} onRecheckPlan={recheckPlan}/>}
    {(confirmDiscard||guard)&&<Modal title="处理未保存修改" width={460} onClose={()=>{setConfirmDiscard(false);setGuard(null);}}><p>当前草稿尚未保存。</p><div className="button-row">
      <button className="ghost-button" onClick={()=>{setConfirmDiscard(false);setGuard(null);}}>继续编辑</button><button className="ghost-button" disabled={!!draft.pending||draft.busy} onClick={()=>{draft.cancel();setConfirmDiscard(false);const action=guard;setGuard(null);action?.();}}>放弃草稿</button>
      {guard&&<button className="primary-button" disabled={draft.busy||!draft.pending&&!draft.preview} onClick={()=>void draft.save().then(saved=>{if(saved){const action=guard;setGuard(null);action?.();}})}>保存后继续</button>}
    </div></Modal>}
  </div>;
}
