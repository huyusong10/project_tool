import * as projectsApi from '../features/projects/api';
import * as reportingApi from '../features/reporting/api';
import * as planningApi from '../features/planning/api';
import { TreeExpansionActions } from './TreeExpansionActions';
import { Button } from './Button';
import { PageHeader } from './PageHeader';
import type { PageChrome } from '../page-chrome';
import { WorkspaceObjectMark } from './WorkspaceObjectMark';
import { setNativeDragPreview } from './DragPreview';
import { TopbarMenu } from './TopbarMenu';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, GripVertical, ArrowUpRight, ArrowUp, ArrowDown, ListChecks, X } from 'lucide-react';
import { ApiError, isWriteOutcomeUnknown, jsonBody } from '../api';
import { useProjectWorkspace } from '../project-workspace-context';
import { useSession } from '../app-context';
import { canManageProject } from '../permissions';
import { invalidateRequirementViews } from '../query-keys';
import { outlineRows, scopeOutline, flattenOutline, reorderSelection, type OutlineRow } from '../outline-model';
import { scopeFromObject } from '../workspace-location';
import { assertCleanProjectDraft } from '../use-graph-draft';
import type { Dashboard } from '../types';
import type { OutlineKind, OutlineUndo } from '../../shared/outline';
import type { PathAnalysis } from '../../shared/paths';
import { matchesSearch, normalizeSearchText } from '../../shared/search';
import { ExecutionStageBadge, WorkProgressBadge } from './ExecutionStageBadge';
import { PhaseDialog, PhaseStatusBadge } from './PhasePlanning';
import { type PhaseEdit } from '../features/planning/phase-model';
import { FeatureEditor, type FeatureEdit } from './FeaturePlanning';
import { Modal } from './Modal';
import { OrganizationFields } from './RequirementIntake';

type Write={path:string;input:Record<string,unknown>;label:string;ids:string[]};
type Pending=Write&{unknown:boolean};
const labels:Record<OutlineKind,string>={feature:'特性',phase:'Phase',requirement:'需求',work:'工作项'};
export function WorkspaceOutline({report,projection,header}:{report:Dashboard;projection?:PathAnalysis;header?:Omit<PageChrome,'runtime'>}){
  const workspace=useProjectWorkspace()!,{data,location}=workspace,{session}=useSession(),account=session.accountId||'guest',projectId=data.projectId,manage=canManageProject(session,projectId),client=useQueryClient();
  const [params,setParams]=useSearchParams(),baseKey='pm-outline:'+account+':'+projectId;
  const tree=useMemo(()=>outlineRows(report,projection||data),[report,projection,data]),all=useMemo(()=>flattenOutline(tree),[tree]);
  const [expanded,setExpanded]=useState<Record<string,boolean>>(()=>{try{return JSON.parse(localStorage.getItem(baseKey+':expanded')||'{}');}catch{return {};}});
  const [selected,setSelected]=useState<string[]>([]),[drag,setDrag]=useState<string[]>([]),[drop,setDrop]=useState<{row:OutlineRow;placement:boolean;after:boolean}|null>(null);
  const [featureEdit,setFeatureEdit]=useState<FeatureEdit|null>(null),[phaseEdit,setPhaseEdit]=useState<PhaseEdit|null>(null);
  const [moving,setMoving]=useState<OutlineRow[]|null>(null),[destination,setDestination]=useState(''),[reason,setReason]=useState('');
  const [pending,setPendingState]=useState<Pending|null>(()=>{try{return manage?JSON.parse(sessionStorage.getItem(baseKey+':pending')||'null'):null;}catch{return null;}});
  const [retry,setRetry]=useState<Write|null>(null);
  const [review,setReview]=useState<OutlineRow[]|null>(null),[busy,setBusy]=useState(false),busyRef=useRef(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[undo,setUndo]=useState<OutlineUndo|null>(null),[undoReason,setUndoReason]=useState(false);
  const query=params.get('q')||'',sort=params.get('outlineSort')||'manual',filtered=!!normalizeSearchText(query),sortEnabled=sort==='manual'&&!filtered;
  const scopeKey=location.scope.kind+':'+location.scope.id,filterKey=scopeKey+':'+query;
  const [filterExpansion,setFilterExpansion]=useState<{key:string;rows:Record<string,boolean>}>({key:'',rows:{}});
  const currentExpanded=filtered?{...Object.fromEntries(all.map(row=>[row.id,true])),...(filterExpansion.key===filterKey?filterExpansion.rows:{})}:expanded;
  const changeExpanded=(value:Record<string,boolean>)=>filtered?setFilterExpansion({key:filterKey,rows:value}):setExpanded(value);
  const matches=(row:OutlineRow):boolean=>matchesSearch([row.title],query)||row.children.some(matches);
  const scopedTree=scopeOutline(tree,location.scope),branches=flattenOutline(scopedTree).filter(row=>row.children.length&&(!filtered||matches(row)));
  const expandAll=(open:boolean)=>changeExpanded({...currentExpanded,...Object.fromEntries(branches.map(row=>[row.id,open]))});
  useEffect(()=>setSelected([]),[scopeKey,query,sort]);
  useEffect(()=>{try{localStorage.setItem(baseKey+':expanded',JSON.stringify(expanded));}catch{/* Keep expansion in this page. */}},[baseKey,expanded]);
  const setPending=(v:Pending|null)=>{setPendingState(v);try{if(v)sessionStorage.setItem(baseKey+':pending',JSON.stringify(v));else sessionStorage.removeItem(baseKey+':pending');}catch{/* Keep the pending write in memory. */}};
  const picked=all.filter(r=>selected.includes(r.id)&&!r.system&&!r.archived),homogeneous=picked.length>0&&picked.every(r=>r.kind===picked[0].kind),sameParent=homogeneous&&picked.every(r=>r.parentId===picked[0].parentId);
  const features=data.featureContext?.overview.features||[];
  const targets=all.filter(r=>(r.kind==='feature'||r.kind==='phase')&&!r.archived);
  const save=async(write:Write)=>{
    if(busyRef.current||pending)return;busyRef.current=true;setBusy(true);setError('');setReview(null);
    try{
      for(const id of write.ids){const row=all.find(r=>r.objectId===id&&!r.virtual);if(row?.kind==='requirement'||row?.kind==='work')await assertCleanProjectDraft(account,projectId,{requirementId:row.requirementId||id,workItemId:row.kind==='work'?id:undefined,action:'edit'});else await assertCleanProjectDraft(account,projectId);}
      setPending({...write,unknown:true});
      const result=await projectsApi.projectsResourceById<{undo?:OutlineUndo}>(projectId, write.path, {method:'POST',body:jsonBody(write.input)});
      setPending(null);setRetry(null);setUndo(result.undo||null);setMessage(write.label+'已保存');setSelected([]);setMoving(null);setUndoReason(false);invalidateRequirementViews(client);
    }catch(e){setError((e as Error).message);if(isWriteOutcomeUnknown(e)||e instanceof ApiError&&(e.status===409||e.status>=500))setPending({...write,unknown:isWriteOutcomeUnknown(e)||e instanceof ApiError&&e.status>=500});else setPending(null);}
    finally{busyRef.current=false;setBusy(false);}
  };
  const order=(items:OutlineRow[],target:OutlineRow,after=false)=>{
    if(!sortEnabled||!items.length||items.some(r=>r.kind!==target.kind||r.parentId!==target.parentId||r.system||r.archived)||target.system)return;
    const siblings=all.filter(r=>r.kind===target.kind&&r.parentId===target.parentId&&!r.system&&!r.archived),ids=reorderSelection(siblings.map(r=>r.objectId),items.map(r=>r.objectId),target.objectId,after);
    if(ids.every((id,i)=>id===siblings[i].objectId))return;
    void save({path:'/outline-order',input:{kind:target.kind,parentId:target.parentId,items:ids.map(id=>({id,expectedVersion:siblings.find(r=>r.objectId===id)!.version}))},label:'调整顺序',ids});
  };
  const move=(items:OutlineRow[],target?:OutlineRow)=>{if(!items.length||items.some(r=>r.kind!=='requirement'||r.archived))return;setMoving(items);setDestination(target?.id||'');setReason('');};
  const target=targets.find(t=>t.id===destination),targetFeature=destination==='other'?null:target?.kind==='feature'?target.objectId:target?.featureId,targetPhase=target?.kind==='phase'&&!target.virtual?target.objectId:null;
  const needsReason=(moving||[]).some(r=>features.some(f=>f.phases?.some(p=>(p.id===r.phaseId||p.id===targetPhase)&&!!p.startedAt)))||!!target?.phase?.startedAt;
  const submitMove=()=>{if(!moving||!target&&destination!=='other')return;void save({path:'/requirement-placement',input:{requirements:moving.map(r=>({id:r.objectId,expectedVersion:r.version})),featureId:targetFeature,phaseId:targetPhase,reason:reason||undefined},label:'移动需求',ids:moving.map(r=>r.objectId)});};
  const check=async()=>{setBusy(true);setError('');try{const [latestReport,latestGraph]=await Promise.all([reportingApi.dashboardQuery<Dashboard>(projectId),planningApi.projectsPathGraphQuery<{analysis:PathAnalysis}>(projectId)]);setReview(flattenOutline(outlineRows(latestReport,latestGraph.analysis)));invalidateRequirementViews(client);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const continueReview=(resume:boolean)=>{
    if(!pending||!review)return;
    if(resume&&pending.path!=='/outline-restore'){
      const field=pending.path==='/requirement-placement'?'requirements':'items',original=pending.input[field] as Array<{id:string;expectedVersion:number}>;
      const latest=original.map(item=>review.find(r=>r.objectId===item.id&&!r.virtual&&!r.archived&&!r.system));
      if(latest.some(r=>!r)){setError('部分对象已移出、归档或无法访问。原请求保留，请先核对这些对象。');return;}
      if(pending.path==='/outline-order'){
        const siblings=review.filter(r=>r.kind===pending.input.kind&&r.parentId===pending.input.parentId&&!r.system&&!r.archived);
        if(siblings.length!==original.length||siblings.some(r=>!original.some(i=>i.id===r.objectId))){setError('同级成员已变化，原排序不能直接套用；请结束核对后重新排列。');return;}
      }
      const next={...pending,input:{...pending.input,[field]:original.map((item,i)=>({...item,expectedVersion:latest[i]!.version}))}};
      setRetry(next);setMessage('原输入已保留，请再次确认');
      if(pending.path==='/requirement-placement'){setMoving(latest as OutlineRow[]);setDestination(next.input.phaseId?'phase:'+next.input.phaseId:next.input.featureId?'feature:'+next.input.featureId:'other');setReason(String(next.input.reason||''));}
    }else{setRetry(null);setMoving(null);setMessage('已核对正式结果');}
    setPending(null);setReview(null);setError('');setUndo(null);setUndoReason(false);
  };
  const counts=Object.entries(labels).map(([kind,label])=>{const count=picked.filter(r=>r.kind===kind).length;return count?count+' 个'+label:'';}).filter(Boolean).join('、');
  const visible=(rows:OutlineRow[],depth=1):Array<{row:OutlineRow;depth:number}>=>{
    const ordered=[...rows].sort((a,b)=>Number(!!a.system)-Number(!!b.system)||(sort==='name'?a.title.localeCompare(b.title,'zh-CN',{numeric:true}):sort==='date'?(a.phase?.targetDate||a.work?.plannedEnd||a.requirement?.plannedEnd||'9999').localeCompare(b.phase?.targetDate||b.work?.plannedEnd||b.requirement?.plannedEnd||'9999'):0));
    return ordered.filter(r=>!filtered||matches(r)).flatMap(row=>[{row,depth},...(currentExpanded[row.id]?visible(row.children,depth+1):[])]);
  };
  const rows=visible(scopedTree);
  const enter=(row:OutlineRow)=>{const scope=scopeFromObject(row.id,data);if(scope)workspace.enter(scope);else workspace.inspect(row.id);};
  const toggle=(row:OutlineRow)=>setSelected(ids=>ids.includes(row.id)?ids.filter(id=>id!==row.id):[...ids,row.id]);
  const shift=(items:OutlineRow[],direction:-1|1)=>{const first=items[0];if(!first)return;const siblings=all.filter(r=>r.kind===first.kind&&r.parentId===first.parentId&&!r.system&&!r.archived),indexes=items.map(r=>siblings.findIndex(s=>s.id===r.id)),index=direction<0?Math.min(...indexes)-1:Math.max(...indexes)+1;if(siblings[index])order(items,siblings[index],direction>0);};
  const selectable=rows.map(({row})=>row).filter(row=>!row.system&&!row.archived),checked=selectable.filter(row=>selected.includes(row.id)).length;
  const inspect=(row:OutlineRow)=>row.virtual?enter(row):workspace.inspect(row.id);
  return <div className="workspace-outline" aria-label="清单">
    {header&&<PageHeader {...header}/>}
    <div className="outline-actions" data-workspace-zone="tools">
      <TreeExpansionActions canExpand={branches.some(row=>!currentExpanded[row.id])} canCollapse={branches.some(row=>!!currentExpanded[row.id])} onChange={expandAll}/>
      <input type="search" aria-label="筛选清单" placeholder="查找名称、编号或拼音" value={query} onChange={e=>{const next=new URLSearchParams(params);next.set('q',e.target.value);setParams(next,{replace:true});}}/>
      <select aria-label="清单排序" title={sortEnabled?'可拖动手柄调整人工顺序':'当前只能移动归属；清除筛选并选择人工顺序后可排列同级'} value={sort} onChange={e=>{const next=new URLSearchParams(params);next.set('outlineSort',e.target.value);setParams(next,{replace:true});}}><option value="manual">人工顺序</option><option value="name">按名称</option><option value="date">按日期</option></select>

    </div>
    <div className="outline-caption"><span>{rows.length} 个可见对象</span><span className="outline-help">{sortEnabled?'单击名称查看资料 · ↗ 进入下一级':'筛选或自动排序中，行间排序拖拽已停用；仍可移动归属'}</span></div>
    {picked.length>0&&<div className="outline-selection" role="region" aria-label="批量操作" data-workspace-zone="tools"><span title={counts}>已选 {counts}</span>{manage&&<>
      <Button variant="secondary" className="ghost-button" disabled={!homogeneous||picked[0]?.kind!=='requirement'||busy||!!pending} onClick={()=>move(picked)}>调整归属…</Button>
      <Button variant="ghost" iconOnly size="small" className="workspace-icon-button" title="上移" aria-label="上移" disabled={!sameParent||!sortEnabled||busy||!!pending} onClick={()=>shift(picked,-1)}><ArrowUp size={16}/></Button><Button variant="ghost" iconOnly size="small" className="workspace-icon-button" title="下移" aria-label="下移" disabled={!sameParent||!sortEnabled||busy||!!pending} onClick={()=>shift(picked,1)}><ArrowDown size={16}/></Button>
      <TopbarMenu label="更多批量操作"><Button variant="menu" disabled={!homogeneous||picked[0]?.kind!=='feature'||busy||!!pending} onClick={()=>void save({path:'/features/archive-batch',input:{items:picked.map(r=>({id:r.objectId,expectedVersion:r.version}))},label:'归档特性',ids:picked.map(r=>r.objectId)})}>批量归档</Button></TopbarMenu>
    </>}<Button variant="ghost" iconOnly size="small" className="workspace-icon-button" aria-label="清空选择" title="清空选择" onClick={()=>setSelected([])}><X size={16}/></Button></div>}
    {(message||error||pending)&&<div className="outline-notice" data-workspace-zone="notice"><span role={error?'alert':'status'}>{error||message}{pending?' · '+(pending.unknown?'提交结果待核对':'版本或业务条件已变化'):''}</span>{retry&&!pending&&retry.path!=='/requirement-placement'&&<Button variant="secondary" className="ghost-button" disabled={busy} onClick={()=>void save(retry)}>确认原操作</Button>}{undo&&!pending&&<Button variant="secondary" className="ghost-button" disabled={busy} onClick={()=>{setReason('');setUndoReason(true);}}>撤销本次操作</Button>}{pending?<Button variant="secondary" className="ghost-button" disabled={busy} onClick={()=>void check()}>读取正式结果并核对</Button>:<Button variant="ghost" iconOnly size="small" className="workspace-icon-button" aria-label="关闭提示" onClick={()=>{setMessage('');setError('');}}><X size={16}/></Button>}</div>}
    <div className="outline-scroll"><table className="outline-table" role="treegrid" aria-label="范围树表"><colgroup><col className="outline-select-column"/><col className="outline-drag-column"/><col/><col className="outline-status-column"/><col className="outline-date-column"/><col className="outline-menu-column"/></colgroup><thead><tr><th>{manage&&<input type="checkbox" aria-label="选择当前可见对象" title="只选择当前可见对象，不隐式选择后代" checked={!!selectable.length&&checked===selectable.length} disabled={!selectable.length} ref={element=>{if(element)element.indeterminate=checked>0&&checked<selectable.length;}} onChange={e=>setSelected(e.target.checked?[...new Set([...selected,...selectable.map(row=>row.id)])]:selected.filter(id=>!selectable.some(row=>row.id===id)))}/>}</th><th aria-label="拖动"/><th>名称</th><th>执行情况</th><th>计划完成</th><th aria-label="对象操作"/></tr></thead><tbody>{rows.map(({row,depth})=>{
      const dropping=drop?.row.id===row.id,chosen=selected.includes(row.id),canDrag=manage&&!row.system&&!row.archived&&!busy&&!pending;
      return <tr key={row.id} aria-level={depth} aria-selected={!row.system?chosen:undefined} aria-expanded={row.children.length?!!currentExpanded[row.id]:undefined} data-object-id={row.id} data-object-kind={row.system?'group':row.kind} className={(chosen?'is-selected ':'')+(drag.includes(row.id)?'is-dragging ':'')+(dropping?(drop.placement?'drop-placement':drop.after?'drop-after':'drop-before'):'')}
        onClick={e=>{if(!(e.target as Element).closest('button,input,a,select'))inspect(row);}}
        onDragOver={e=>{const items=all.filter(r=>drag.includes(r.id));if(!items.length||busy||pending)return;const rect=e.currentTarget.getBoundingClientRect(),fraction=(e.clientY-rect.top)/rect.height,placement=items.every(r=>r.kind==='requirement')&&targets.includes(row)&&(row.kind!==items[0].kind||fraction>.25&&fraction<.75);const ordering=sortEnabled&&!row.system&&!row.archived&&items.every(r=>r.kind===row.kind&&r.parentId===row.parentId)&&!drag.includes(row.id);if(placement||ordering){e.preventDefault();e.dataTransfer.dropEffect='move';setDrop({row,placement,after:fraction>.5});}else setDrop(null);}}
        onDrop={e=>{e.preventDefault();const items=all.filter(r=>drag.includes(r.id));if(drop?.row.id===row.id){if(drop.placement)move(items,row);else order(items,row,drop.after);}setDrop(null);setDrag([]);}}>
        <td>{manage&&(row.system?<TopbarMenu label={'选择'+row.title} icon={<ListChecks size={15}/>}><Button variant="menu" onClick={()=>setSelected(flattenOutline(row.children).filter(r=>r.kind==='requirement'&&!r.archived).map(r=>r.id))}>选择本组全部需求</Button><Button variant="menu" onClick={()=>setSelected(ids=>ids.filter(id=>!flattenOutline(row.children).some(r=>r.id===id)))}>取消本组选择</Button></TopbarMenu>:<input type="checkbox" aria-label={'选择'+row.title} checked={chosen} disabled={row.archived} onChange={()=>toggle(row)}/>)}</td>
        <td>{!row.system&&<Button variant="ghost" iconOnly size="mini" className="outline-drag workspace-icon-button" draggable={canDrag} disabled={!canDrag} aria-label={'拖动'+row.title} title="拖动排序 · Alt + 上下方向键" onDragStart={e=>{const items=chosen?picked:[row],ids=items.map(r=>r.id);setNativeDragPreview(e,{title:row.title,kind:row.kind,count:ids.length,detail:ids.length>1?'按原有顺序移动所选对象':'拖到同级间隙排序，或移入归属'});setDrag(ids);e.dataTransfer.setData('text/plain',JSON.stringify(ids));e.dataTransfer.effectAllowed='move';}} onDragEnd={()=>{setDrag([]);setDrop(null);}} onKeyDown={e=>{if(e.altKey&&['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();shift(chosen?picked:[row],e.key==='ArrowUp'?-1:1);}}}><GripVertical size={15}/></Button>}</td>
        <td><div className="outline-name" style={{paddingInlineStart:(depth-1)*22}}><Button variant="ghost" iconOnly size="mini" className="outline-expand workspace-icon-button" disabled={!row.children.length} aria-label={(currentExpanded[row.id]?'收起':'展开')+row.title} onClick={()=>changeExpanded({...currentExpanded,[row.id]:!currentExpanded[row.id]})}>{row.children.length?(currentExpanded[row.id]?<ChevronDown size={15}/>:<ChevronRight size={15}/>):null}</Button><WorkspaceObjectMark kind={row.system?'group':row.kind}/><button className="outline-title" title={row.title} onClick={()=>inspect(row)}>{row.title}</button>{row.kind!=='work'&&!(row.archived&&row.kind==='requirement')&&<Button variant="ghost" iconOnly size="small" className="workspace-enter workspace-icon-button" aria-label={'进入'+row.title} title={'进入'+labels[row.kind]} onClick={()=>enter(row)}><ArrowUpRight size={15}/></Button>}{row.archived&&<small>已归档</small>}</div></td>
        <td>{row.virtual?<span className="outline-count">{row.children.length} 条需求</span>:row.kind==='phase'&&row.phase?<PhaseStatusBadge phase={row.phase}/>:row.kind==='requirement'&&row.requirement?<ExecutionStageBadge requirement={row.requirement}/>:row.kind==='work'&&row.work?<WorkProgressBadge work={row.work}/>:<span className="outline-count">{row.feature?.counts.total??row.children.length} 条需求</span>}</td><td className="outline-date">{row.phase?.targetDate||row.work?.plannedEnd||row.requirement?.plannedEnd||'—'}</td>
        <td><div className="outline-row-actions">{manage&&!row.system&&!row.archived&&<TopbarMenu label={row.title+'操作'}><Button variant="menu" disabled={!sameParent&&chosen||!sortEnabled||busy||!!pending} onClick={()=>shift(chosen?picked:[row],-1)}>上移</Button><Button variant="menu" disabled={!sameParent&&chosen||!sortEnabled||busy||!!pending} onClick={()=>shift(chosen?picked:[row],1)}>下移</Button>{row.kind==='requirement'&&<Button variant="menu" disabled={busy||!!pending} onClick={()=>move([row])}>调整归属…</Button>}{row.kind==='feature'&&<Button variant="menu" onClick={()=>setFeatureEdit({feature:row.feature,mode:'basic'})}>编辑特性</Button>}{row.kind==='phase'&&row.phase&&<Button variant="menu" onClick={()=>setPhaseEdit({feature:features.find(f=>f.id===row.featureId)!,phase:row.phase,mode:'edit'})}>编辑 Phase</Button>}</TopbarMenu>}</div></td>
      </tr>;
    })}</tbody></table>{!rows.length&&<div className="workspace-empty"><p>{filtered?'没有符合筛选条件的内容':location.scope.kind==='phase'?'本 Phase 暂无需求':location.scope.kind==='requirement'?'暂无工作项':'尚未安排交付'}</p>{filtered?<Button variant="secondary" onClick={()=>{const next=new URLSearchParams(params);next.delete('q');setParams(next,{replace:true});}}>清除筛选</Button>:workspace.emptyActions}</div>}</div>
    {featureEdit&&<FeatureEditor projectId={projectId} edit={featureEdit} onClose={()=>setFeatureEdit(null)}/>}
    {phaseEdit&&<PhaseDialog edit={phaseEdit} onClose={()=>setPhaseEdit(null)}/>}
    {moving&&<Modal title={'调整 '+moving.length+' 条需求归属'} closable={!busy} onClose={()=>setMoving(null)}><p>按当前顺序追加到目标末尾。</p><OrganizationFields projectId={projectId} featureId={targetFeature||''} phaseId={targetPhase||''} onChange={(key,value)=>setDestination(key==='featureId'?(value?'feature:'+value:'other'):value?'phase:'+value:targetFeature?'feature:'+targetFeature:'other')}/><label className="field"><span>变更原因{needsReason?'（必填）':'（可选）'}</span><textarea aria-label="变更原因" value={reason} onChange={e=>setReason(e.target.value)}/></label>{error&&<p role="alert">{error}</p>}{pending&&<Button variant="secondary" className="ghost-button" disabled={busy} onClick={()=>void check()}>读取正式结果并核对</Button>}<div className="form-actions"><Button variant="secondary" className="ghost-button" disabled={busy} onClick={()=>setMoving(null)}>取消</Button><Button variant="primary" className="primary-button" disabled={busy||!!pending||!destination||needsReason&&!reason.trim()} onClick={submitMove}>确认移动</Button></div></Modal>}
    {undoReason&&undo&&<Modal title="撤销本次操作" closable={!busy} onClose={()=>setUndoReason(false)}><p>系统将检查本次操作涉及的对象及同级顺序。内容已经变化时整批保留现状。</p><label className="field"><span>变更原因（涉及已推进 Phase 时必填）</span><textarea value={reason} onChange={e=>setReason(e.target.value)}/></label>{error&&<p role="alert">{error}</p>}{pending&&<Button variant="secondary" className="ghost-button" disabled={busy} onClick={()=>void check()}>读取正式结果并核对</Button>}<Button variant="primary" className="primary-button" disabled={busy||!!pending} onClick={()=>void save({path:'/outline-restore',input:{...undo,reason:reason||undefined},label:'撤销操作',ids:undo.expected.flatMap(g=>g.items.map(i=>i.id))})}>确认撤销</Button></Modal>}
    {pending&&review&&<Modal title="核对正式结果" onClose={()=>setReview(null)}><p>{pending.unknown?'原提交结果未知。请对照原请求和正式资料确认；系统不会自动重复提交。':'原操作未保存。原输入保留；请核对变化后重新选择操作。'}</p><details><summary>原提交内容 · {pending.label}</summary><pre>{JSON.stringify(pending.input,null,2)}</pre></details><table><thead><tr><th>对象</th><th>当前归属</th><th>版本</th><th>顺序</th></tr></thead><tbody>{review.filter(r=>pending.ids.includes(r.objectId)&&!r.virtual).map(r=><tr key={r.id}><td>{r.title}</td><td>{review.find(p=>p.objectId===r.parentId&&!p.virtual)?.title||'项目'}</td><td>{r.version}</td><td>{r.requirement?.sortOrder??r.work?.sortOrder??r.phase?.sortOrder??r.feature?.sortOrder}</td></tr>)}</tbody></table>{error&&<p role="alert">{error}</p>}<div className="form-actions"><Button variant="secondary" className="ghost-button" onClick={()=>continueReview(false)}>{pending.unknown?'确认已生效，结束核对':'结束核对，重新选择'}</Button>{pending.path!=='/outline-restore'&&<Button variant="primary" className="primary-button" onClick={()=>continueReview(true)}>{pending.unknown?'确认未生效，保留输入':'保留输入，按最新资料继续'}</Button>}</div></Modal>}
  </div>;
}
