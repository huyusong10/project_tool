import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from '../api';
import { invalidateTemplateViews, keys } from '../query-keys';
import type { WorkItemTemplate } from '../types';
import { Modal } from './Modal';
import { canonicalizeContent, canonicalizeLabel } from '../../shared/search';
import { resolveTemplateOffsets, suggestTemplatePredecessors } from '../../shared/path-template';
import { DependencyCycleError } from '../../shared/paths';
import { useGraphHistory } from '../use-graph-draft';
import { GraphWorkspace } from './GraphWorkspace';
import { PredecessorPicker } from './PredecessorPicker';
import { useSession } from '../app-context';
import type { GraphCard } from '../path-projection';
import { canManageProject } from '../permissions';
import {useToast} from './Toast';
type TemplateFormInput = {
  dependencyMode?: 'legacy' | 'dependencies';
  projectId?: string;
  name: string;
  description: string;
  expectedUpdatedAt?: string;
  items: Array<{ id?: string; clientKey?: string; predecessorKeys?: string[]; title: string; startOffsetDays: number; durationDays: number; milestoneLabel: string | null; sortOrder: number }>;
};

function matchesTemplateDraft(template: WorkItemTemplate, input: TemplateFormInput) {
  return template.name === canonicalizeLabel(input.name)
    && (template.dependencyMode || 'legacy') === (input.dependencyMode || 'legacy')
    && template.description === canonicalizeContent(input.description)
    && template.items.length === input.items.length
    && input.items.every((item, index) => {
      const latest = template.items[index];
      return latest?.sortOrder === index
        && (!item.id || latest.id === item.id)
        && latest.title === canonicalizeLabel(item.title)
        && latest.startOffsetDays === item.startOffsetDays
        && latest.durationDays === item.durationDays
        && (input.dependencyMode !== 'dependencies' || JSON.stringify([...(latest.predecessorIds || [])].sort()) === JSON.stringify((item.predecessorKeys || []).map(k => template.items[input.items.findIndex(i => (i.clientKey || i.id) === k)]?.id).sort()))
        && latest.milestoneLabel === (canonicalizeLabel(item.milestoneLabel) || null);
    });
}


type Item = { id?: string; clientKey: string; title: string; predecessorKeys: string[]; startOffsetDays: number; durationDays: number; milestoneLabel: string | null; sortOrder: number };
type Draft = { name: string; description: string; dependencyMode: 'legacy'|'dependencies'; items: Item[] };
function initialDraft(template?: WorkItemTemplate): Draft {
  const items: Item[] = template ? template.items.map(i=>({id:i.id,clientKey:i.id,title:i.title,startOffsetDays:i.startOffsetDays,durationDays:i.durationDays,milestoneLabel:i.milestoneLabel,sortOrder:i.sortOrder,predecessorKeys:i.predecessorIds||[]})):
    ['设计','开发','测试','发布'].map((title,index)=>({clientKey:crypto.randomUUID(),title,predecessorKeys:[],startOffsetDays:[0,2,7,10][index],durationDays:[2,5,3,1][index],milestoneLabel:index===3?'发布基线':null,sortOrder:index}));
  if(!template)items.forEach((item,i)=>{if(i)item.predecessorKeys=[items[i-1].clientKey];});
  return {name:template?.name||'',description:template?.description||'',dependencyMode:template?.dependencyMode||(template?'legacy':'dependencies'),items};
}
export function TemplateForm({template,templateUnavailable=false,projectId,onClose}:{
  template?:WorkItemTemplate;templateUnavailable?:boolean;projectId:string;onClose:()=>void;
}) {
  const client=useQueryClient(),{session}=useSession(),[params,setParams]=useSearchParams();
  const toast=useToast();
  const initial=useRef(initialDraft(template)).current;
  const draft=useGraphHistory((session.accountId||'guest')+':'+projectId+':template:'+(template?.id||'new'),initial,template?.updatedAt||'new');
  const value=draft.value,selected=params.get('templateNode')||value.items[0]?.clientKey||'',item=value.items.find(i=>i.clientKey===selected);
  const [panel,setPanel]=useState('settings'),[inspector,setInspector]=useState(!matchMedia('(max-width:800px)').matches);
  const [locate,setLocate]=useState<{id:string;sequence:number}>(),[selectedEdge,setSelectedEdge]=useState('');
  const [error,setError]=useState(''),[invalidNodes,setInvalidNodes]=useState<string[]>([]);
  const [creating,setCreating]=useState<{predecessors:string[]}|null>(null),[createTitle,setCreateTitle]=useState(''),[createDuration,setCreateDuration]=useState(1);
  const [deleteId,setDeleteId]=useState(''),[discard,setDiscard]=useState(false),[suggestion,setSuggestion]=useState<Item[]|null>(null);
  const [needsCheck,setNeedsCheck]=useState(false),[checking,setChecking]=useState(false);
  const submitting=useRef(false),mounted=useRef(true);
  const initialIds=useRef(new Set((client.getQueryData<WorkItemTemplate[]>([...keys.templates,projectId])||[]).map(t=>t.id)));
  const lastInput=useRef<TemplateFormInput|null>(null);
  useEffect(()=>{mounted.current=true;draft.begin();return()=>{mounted.current=false;};
    // Persist this mounted editor; background refresh must not replace its baseline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const changed=!!template&&draft.version!==template.updatedAt;
  const locked=templateUnavailable||!canManageProject(session,projectId);
  const layout=useMemo(()=>{
    try {return {items:value.dependencyMode==='dependencies'?resolveTemplateOffsets(value.items.map(i=>({...i}))):value.items,error:''};}
    catch(caught){return {items:value.items,error:(caught as Error).message};}
  },[value]);
  const dirty=draft.dirty;
  const finish=()=>{draft.reset();invalidateTemplateViews(client);onClose();};
  const checkSaved=async(input:TemplateFormInput)=>{
    const latest=await api<WorkItemTemplate[]>('/api/templates?projectId='+encodeURIComponent(projectId),{readOnly:true});
    client.setQueryData([...keys.templates,projectId],latest);
    const matches=latest.filter(t=>template?t.id===template.id&&matchesTemplateDraft(t,input):!initialIds.current.has(t.id)&&matchesTemplateDraft(t,input));
    if(matches.length===1){if(mounted.current){toast.success(template?'已核对最新状态：流程设计已保存':'已核对最新状态：流程已创建');finish();}return true;}return false;
  };
  const mutation=useMutation({mutationFn:(input:TemplateFormInput)=>api(template?'/api/templates/'+template.id:'/api/templates',{method:template?'PATCH':'POST',body:jsonBody(input)}),
    onSuccess:finish,onError:async(caught,input)=>{
      if(isWriteOutcomeUnknown(caught)){try{if(await checkSaved(input))return;}catch{/* Preserve the draft while the result is unknown. */}}
      if(requiresWriteRecheck(caught))setNeedsCheck(true);
    },onSettled:()=>{submitting.current=false;}});
  const update=(next:Draft,group?:string)=>{
    if(mutation.isPending||locked||needsCheck)return;
    try { if(next.dependencyMode==='dependencies')resolveTemplateOffsets(next.items.map(i=>({...i})));setError('');setInvalidNodes([]);draft.change(next,group); }
    catch(caught){setError((caught as Error).message);setInvalidNodes(caught instanceof DependencyCycleError?caught.nodeIds:[]);}
  };
  const updateItem=(patch:Partial<Item>,group?:string)=>update({...value,items:value.items.map(i=>i.clientKey===selected?{...i,...patch}:i)},group?selected+':'+group:undefined);
  const select=(id:string)=>{
    const next=new URLSearchParams(params);next.set('templateNode',id);setParams(next,{replace:true});setSelectedEdge('');setInspector(true);if(matchMedia('(max-width:800px)').matches)setPanel('');
  };
  const openPanel=(name:string)=>{setPanel(panel===name?'':name);if(matchMedia('(max-width:800px)').matches)setInspector(false);};
  const validate=(source:string,target:string)=>{
    if(source===target)return {message:'不能依赖自身',nodeIds:[source]};
    if(value.items.find(i=>i.clientKey===target)?.predecessorKeys.includes(source))return {message:'这条依赖已经存在',nodeIds:[source,target]};
    try{resolveTemplateOffsets(value.items.map(i=>({...i,predecessorKeys:i.clientKey===target?[...i.predecessorKeys,source]:i.predecessorKeys})));return null;}
    catch(caught){return {message:(caught as Error).message,nodeIds:caught instanceof DependencyCycleError?caught.nodeIds:[]};}
  };
  const connect=(source:string,target:string)=>update({...value,items:value.items.map(i=>i.clientKey===target?{...i,predecessorKeys:[...i.predecessorKeys,source]}:i)});
  const beginCreate=(predecessors:string[])=>{setCreating({predecessors});setCreateTitle('');setCreateDuration(1);};
  const cards:GraphCard[]=layout.items.map(i=>({id:i.clientKey,requirementId:projectId,workItemId:i.clientKey,kind:'template',title:i.title||'未命名工作项',subtitle:i.milestoneLabel?'里程碑 · '+i.milestoneLabel:i.durationDays+' 个工作日',status:'planning',risk:'low',forecast:'第 '+(i.startOffsetDays+1)+'—'+(i.startOffsetDays+i.durationDays)+' 工作日',floatDays:null,critical:false,unknown:false,external:false,hiddenCount:0}));
  const links=value.dependencyMode==='dependencies'?value.items.flatMap(i=>i.predecessorKeys.map(source=>({id:source+'>'+i.clientKey,source,target:i.clientKey,critical:false,dependencyIds:[source+'>'+i.clientKey]}))):[];
  const edge=links.find(e=>e.id===selectedEdge);
  const affected=links.filter(e=>e.source===deleteId||e.target===deleteId);
  const names=(id:string)=>value.items.find(i=>i.clientKey===id)?.title||'失效工作项';
  const save=()=>{
    if(submitting.current||changed||needsCheck||locked||layout.error)return;
    if(!value.name.trim()){setError('请填写流程名称');setPanel('settings');return;}
    if(value.items.some(i=>!i.title.trim())){setError('工作项标题不能为空');return;}
    const input:TemplateFormInput={...value,...template?{expectedUpdatedAt:draft.version}:{projectId},items:layout.items.map((i,index)=>({...i,sortOrder:index}))};
    lastInput.current=input;submitting.current=true;mutation.mutate(input);
  };
  return <div className="path-analysis immersive-path template-flow-workspace"><GraphWorkspace cards={cards} links={links} selected={selected} onSelect={select}
    viewKey={(session.accountId||'guest')+':'+projectId+':template:'+(template?.id||'new')} editing={value.dependencyMode==='dependencies'&&!locked&&!needsCheck&&!mutation.isPending}
    onConnect={connect} validateConnection={validate} onInvalid={i=>{setError(i.message);setInvalidNodes(i.nodeIds||[]);}} invalidNodes={invalidNodes}
    onDropEmpty={source=>beginCreate([source])} selectedEdge={selectedEdge} onEdgeSelect={id=>{setSelectedEdge(id);setInspector(true);if(matchMedia('(max-width:800px)').matches)setPanel('');}} locate={locate} onUndo={!mutation.isPending&&!needsCheck?draft.undo:undefined} onRedo={!mutation.isPending&&!needsCheck?draft.redo:undefined}
    toolbar={<><div className="graph-toolbar-row"><strong>{template?'编辑流程':'新建流程'} · {value.name||'未命名'}</strong><div className="button-row">
      <span className="draft-badge">{dirty?'未保存修改':'编辑草稿'}</span><button className="ghost-button" disabled={!draft.canUndo||mutation.isPending||needsCheck} onClick={draft.undo}>撤销</button><button className="ghost-button" disabled={!draft.canRedo||mutation.isPending||needsCheck} onClick={draft.redo}>重做</button>
      <button className="primary-button" disabled={mutation.isPending||changed||needsCheck||locked||!!layout.error} onClick={save}>{mutation.isPending?'保存中…':'保存流程'}</button>
      <button className="ghost-button" disabled={mutation.isPending} onClick={()=>dirty?setDiscard(true):(draft.reset(),onClose())}>退出编辑</button></div></div>
      <div className="graph-delivery-summary">{value.dependencyMode==='dependencies'?'依赖排期':'历史偏移排期'} · {value.items.length} 个工作项 · 共 {Math.max(...layout.items.map(i=>i.startOffsetDays+i.durationDays),1)} 个工作日<span>修改流程用于新需求。</span></div>
      {(error||layout.error||mutation.error)&&<div className="form-error" role="alert">{error||layout.error||mutation.error?.message}</div>}
      {(changed||needsCheck)&&<div className="warning-banner">流程版本或提交结果需要核对，草稿已保留。<button className="ghost-button" onClick={()=>openPanel('conflict')}>查看并核对</button></div>}
      {locked&&<div className="warning-banner">流程不可编辑或权限已变化。</div>}
    </>}
    detail={inspector?<><div className="graph-panel-heading"><h3>{edge?'前置关系':item?.title||'选择工作项'}</h3><button className="ghost-button" onClick={()=>setInspector(false)}>关闭</button></div>
      {edge?<><p>{names(edge.source)} 完成后，{names(edge.target)} 开始。</p><button className="ghost-button" disabled={mutation.isPending||needsCheck} onClick={()=>{update({...value,items:value.items.map(i=>i.clientKey===edge.target?{...i,predecessorKeys:i.predecessorKeys.filter(k=>k!==edge.source)}:i)});setSelectedEdge('');}}>移除选中关系</button>
        <PredecessorPicker label="改接前置（选择后替换）" value={[]} options={value.items.filter(i=>i.clientKey!==edge.target&&i.clientKey!==edge.source).map(i=>({id:i.clientKey,title:i.title}))} onChange={ids=>{const source=ids.at(-1);if(source)update({...value,items:value.items.map(i=>i.clientKey===edge.target?{...i,predecessorKeys:[...new Set([...i.predecessorKeys.filter(k=>k!==edge.source),source])]}:i)});}}/></>:item&&<fieldset className="graph-form-fieldset" disabled={mutation.isPending||locked||needsCheck}><div className="graph-fields" key={item.clientKey}>
        <label className="field"><span>工作项名称</span><input aria-label="工作项名称" value={item.title} required onChange={e=>updateItem({title:e.target.value},'title')} onBlur={draft.endGroup}/></label>
        <label className="field"><span>预计工期（工作日）</span><input aria-label="预计工期" key={item.durationDays} type="number" min={1} max={3660} defaultValue={item.durationDays} onBlur={e=>updateItem({durationDays:Math.max(1,Math.min(3660,Number(e.target.value)||1))})}/></label>
        <label className="field"><span>里程碑（可选）</span><input aria-label="里程碑名称" value={item.milestoneLabel||''} maxLength={80} onChange={e=>updateItem({milestoneLabel:e.target.value||null},'milestone')} onBlur={draft.endGroup}/></label>
        {value.dependencyMode==='legacy'&&<label className="field"><span>开始偏移（工作日）</span><input aria-label="开始偏移" key={item.startOffsetDays} type="number" min={0} defaultValue={item.startOffsetDays} onBlur={e=>updateItem({startOffsetDays:Math.max(0,Number(e.target.value)||0)})}/></label>}
      </div>
      {value.dependencyMode==='dependencies'&&<PredecessorPicker label="前置工作项" value={item.predecessorKeys} options={value.items.filter(i=>i.clientKey!==selected).map(i=>({id:i.clientKey,title:i.title}))} onChange={ids=>updateItem({predecessorKeys:ids})}/>}
      <div className="button-row graph-item-actions"><button className="ghost-button" onClick={()=>setLocate({id:selected,sequence:Date.now()})}>定位</button>
        <button className="ghost-button" onClick={()=>beginCreate(value.dependencyMode==='dependencies'?[selected]:[])}>接在后面</button><button className="ghost-button" onClick={()=>beginCreate(value.dependencyMode==='dependencies'?item.predecessorKeys:[])}>添加并行工作</button>
        <button className="ghost-button danger-text" disabled={value.items.length===1} onClick={()=>setDeleteId(selected)}>删除工作项</button></div>
      </fieldset>}
    </>:undefined}
    auxiliary={panel?<><div className="graph-panel-heading"><h3>{{settings:'流程属性',nodes:'节点列表',schedule:'排期预览',conflict:'版本与提交核对'}[panel]}</h3><button className="ghost-button" onClick={()=>setPanel('')}>关闭</button></div>
      {panel==='settings'&&<fieldset className="graph-form-fieldset" disabled={mutation.isPending||locked||needsCheck}><div className="graph-fields"><label className="field"><span>流程名称</span><input name="name" aria-label="流程名称" value={value.name} required onChange={e=>update({...value,name:e.target.value},'name')} onBlur={draft.endGroup}/></label>
        <label className="field"><span>设计说明</span><textarea name="description" aria-label="设计说明" value={value.description} rows={5} maxLength={2000} onChange={e=>update({...value,description:e.target.value},'description')} onBlur={draft.endGroup}/></label></div>
        {value.dependencyMode==='legacy'&&<><p>原偏移值仍然保留。依赖建议只有核对并确认后才启用。</p><button className="ghost-button" onClick={()=>setSuggestion(suggestTemplatePredecessors(value.items.map(i=>({...i}))))}>生成依赖建议</button></>}
      </fieldset>}
      {panel==='nodes'&&<div className="path-node-list">{cards.map(c=><div className="graph-list-row" key={c.id}><button className={selected===c.id?'selected':''} onClick={()=>select(c.id)}>{c.title}<small>{c.subtitle}</small></button><button className="ghost-button" onClick={()=>setLocate({id:c.id,sequence:Date.now()})}>定位</button></div>)}</div>}
      {panel==='schedule'&&<><p>相对工作日按全部前置完成计算。</p><div className="template-relative-plan">{layout.items.map(i=><div key={i.clientKey}><strong>{i.title}</strong><small>第 {i.startOffsetDays+1}—{i.startOffsetDays+i.durationDays} 工作日</small>
        <span><i style={{marginLeft:(i.startOffsetDays/Math.max(...layout.items.map(p=>p.startOffsetDays+p.durationDays),1)*100)+'%',width:(i.durationDays/Math.max(...layout.items.map(p=>p.startOffsetDays+p.durationDays),1)*100)+'%'}}/></span>{i.milestoneLabel&&<small>里程碑：{i.milestoneLabel}</small>}</div>)}</div></>}
      {panel==='conflict'&&<><p>草稿版本：{draft.version}</p><p>最新版本：{template?.updatedAt||'新流程'}</p>
        {needsCheck&&<button className="ghost-button" disabled={checking} onClick={()=>{setChecking(true);void (async()=>{try{if(lastInput.current&&await checkSaved(lastInput.current))return;setNeedsCheck(false);mutation.reset();setError('已重新读取，未确认原提交成功。请核对最新流程后再保存。');}catch(caught){setError((caught as Error).message);}finally{setChecking(false);}})();}}>重新读取并核对提交</button>}
        {changed&&template&&<><p>最新名称：{template.name}</p>{template.items.map(i=><p key={i.id}>{i.title} · {i.durationDays} 工日 · {i.predecessorIds?.length||0} 个前置</p>)}
          <button className="primary-button" disabled={needsCheck} onClick={()=>draft.rebase(template.updatedAt)}>已核对，保留草稿并使用最新版本</button>
          <button className="ghost-button" onClick={()=>{draft.reset(initialDraft(template),template.updatedAt);draft.begin();setNeedsCheck(false);mutation.reset();}}>使用最新流程</button></>}
      </>}
    </>:undefined}
    footer={<><button className="ghost-button" onClick={()=>openPanel('settings')}>流程属性</button><button className="ghost-button" onClick={()=>openPanel('nodes')}>节点 {cards.length}</button><button className="ghost-button" onClick={()=>openPanel('schedule')}>排期预览</button>
      <button className="ghost-button" disabled={mutation.isPending||locked||needsCheck} onClick={()=>beginCreate([])}>添加独立工作</button></>}/>
    {creating&&<Modal title="创建工作项" width={420} onClose={()=>setCreating(null)}><form onSubmit={e=>{e.preventDefault();const id=crypto.randomUUID();update({...value,items:[...value.items,{clientKey:id,title:createTitle.trim(),durationDays:createDuration,startOffsetDays:value.dependencyMode==='legacy'?Math.max(...value.items.map(i=>i.startOffsetDays+i.durationDays),0):0,predecessorKeys:creating.predecessors,milestoneLabel:null,sortOrder:value.items.length}]});setCreating(null);select(id);}}>
      <label className="field"><span>标题</span><input aria-label="新工作项标题" value={createTitle} onChange={e=>setCreateTitle(e.target.value)} required pattern=".*\S.*"/></label><label className="field"><span>工期（工作日）</span><input aria-label="新工作项工期" type="number" min={1} max={3660} value={createDuration} onChange={e=>setCreateDuration(Number(e.target.value))} required/></label>
      <p>{creating.predecessors.length?'前置：'+creating.predecessors.map(names).join('、'):'独立工作，无前置'}</p><div className="button-row"><button type="button" className="ghost-button" onClick={()=>setCreating(null)}>取消</button><button className="primary-button">加入流程</button></div></form></Modal>}
    {deleteId&&<Modal title="删除工作项" width={470} onClose={()=>setDeleteId('')}><p>删除「{names(deleteId)}」及以下 {affected.length} 条关系。前后工作不会自动串接。</p>{affected.map(e=><p key={e.id}>{names(e.source)} → {names(e.target)}</p>)}<div className="button-row"><button className="ghost-button" onClick={()=>setDeleteId('')}>取消</button><button className="primary-button" onClick={()=>{update({...value,items:value.items.filter(i=>i.clientKey!==deleteId).map((i,index)=>({...i,sortOrder:index,predecessorKeys:i.predecessorKeys.filter(k=>k!==deleteId)}))});setDeleteId('');setInspector(false);}}>确认删除</button></div></Modal>}
    {suggestion&&<Modal title="核对依赖建议" width={560} onClose={()=>setSuggestion(null)}><p>确认后切换依赖模式，日期按关系和工期重新计算。</p>{suggestion.map(i=><p key={i.clientKey}>{i.title}：{i.predecessorKeys.map(names).join('、')||'独立开始'}</p>)}<div className="button-row"><button className="ghost-button" onClick={()=>setSuggestion(null)}>保留原偏移</button><button className="primary-button" onClick={()=>{update({...value,dependencyMode:'dependencies',items:suggestion});setSuggestion(null);}}>已核对，启用依赖</button></div></Modal>}
    {discard&&<Modal title="放弃流程草稿" width={430} onClose={()=>setDiscard(false)}><p>尚未保存的修改将被丢弃。</p><div className="button-row"><button className="ghost-button" onClick={()=>setDiscard(false)}>继续编辑</button><button className="primary-button" onClick={()=>{draft.reset();onClose();}}>放弃草稿</button></div></Modal>}
  </div>;
}
