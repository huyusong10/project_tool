import { WorkStageSelect } from "./ExecutionStageBadge";
import { migrateImportDraft } from "../feature-storage-migration";
import { randomUUID } from '../random-uuid';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, ApiError, isWriteOutcomeUnknown, jsonBody } from '../api';
import { useSession } from '../app-context';
import { invalidateRequirementViews, keys } from '../query-keys';
import { intakeExample, intakePackageSchema, type IntakePackage, type ImportPreview, type ImportReceipt } from '../../shared/intake';
import { mergeIntakeRequirements, splitIntakeRequirement } from '../intake-edit';
import { DeliveryImpactTable } from './DeliveryImpactTable';
import type { Requirement, Person } from '../types';

type Attempt={batchId:string;previewToken:string;expectedRevision:string;package:IntakePackage};
type SavedDraft={raw:string;pkg:IntakePackage|null;attempt:Attempt|null;closedBatchId:string|null};
function loadDraft(key:string):SavedDraft {
  try{const value=JSON.parse(localStorage.getItem(key)||'null');if(value){if(!value.attempt){value.pkg=migrateImportDraft(value.pkg);try{const parsed=JSON.parse(value.raw);if(parsed.formatVersion===2)value.raw=JSON.stringify(migrateImportDraft(parsed),null,2);}catch{/* Free text remains intact. */}}return {raw:typeof value.raw==='string'?value.raw:'',pkg:value.pkg?(intakePackageSchema.safeParse(value.pkg).data??null):null,attempt:value.attempt||null,closedBatchId:typeof value.closedBatchId==='string'?value.closedBatchId:null};}}catch{/* Corrupt personal draft must not prevent opening the importer. */}
  return {raw:'',pkg:null,attempt:null,closedBatchId:null};
}
export function RequirementImport({projectId}:{projectId:string}) {
  const {session}=useSession(),client=useQueryClient(),storageKey=`pm-intake:${session.accountId}:${projectId}`;
  const [initial]=useState(()=>loadDraft(storageKey));
  const [raw,setRaw]=useState(initial.raw),[pkg,setPackage]=useState<IntakePackage|null>(initial.pkg),[attempt,setAttempt]=useState<Attempt|null>(initial.attempt),[closedBatchId,setClosedBatchId]=useState<string|null>(initial.closedBatchId);
  const [preview,setPreview]=useState<ImportPreview|null>(null),[result,setResult]=useState<Extract<ImportReceipt,{status:'applied'}>|null>(null),[error,setError]=useState(''),[storageError,setStorageError]=useState(''),[busy,setBusy]=useState(false),[advanced,setAdvanced]=useState(false);
  const requestLock=useRef(false),attemptRef=useRef(initial.attempt),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
  const persist=(next:SavedDraft)=>{try{localStorage.setItem(storageKey,JSON.stringify(next));setStorageError('');return true;}catch{setStorageError('无法保存本机草稿。请导出 JSON 备份；恢复浏览器存储后再提交。');return false;}};
  useEffect(()=>{try{localStorage.setItem(storageKey,JSON.stringify({raw,pkg,attempt,closedBatchId}));setStorageError('');}catch{setStorageError('本机草稿保存失败，请导出 JSON 备份。');}},[raw,pkg,attempt,closedBatchId,storageKey]);
  useEffect(()=>{const receive=(event:StorageEvent)=>{if(event.key!==storageKey||!event.newValue)return;const saved=loadDraft(storageKey),current=attemptRef.current;if(saved.attempt){if(current)return;attemptRef.current=saved.attempt;setRaw(saved.raw);setPackage(saved.pkg);setAttempt(saved.attempt);setClosedBatchId(saved.closedBatchId);setPreview(null);setResult(null);setError('');return;}if(!current||saved.closedBatchId!==current.batchId)return;attemptRef.current=null;setRaw(saved.raw);setPackage(saved.pkg);setAttempt(null);setClosedBatchId(saved.closedBatchId);setPreview(null);setResult(null);setError('原待核对批次已在其他页面处理。请核对需求列表；继续导入前请重新预览。');};window.addEventListener('storage',receive);return()=>window.removeEventListener('storage',receive);},[storageKey]);
  const requirements=useQuery({queryKey:[...keys.requirements,projectId],queryFn:({signal})=>api<Requirement[]>('/api/requirements?projectId='+projectId,{signal})});
  const change=(next:IntakePackage)=>{if(attempt||requestLock.current)return;setPackage(next);setRaw(JSON.stringify(next,null,2));setPreview(null);setResult(null);setError('');};
  const editRequirement=(key:string,value:Partial<IntakePackage['requirements'][number]>)=>{if(pkg)change({...pkg,requirements:pkg.requirements.map(r=>r.key===key?{...r,...value}:r)});};
  const changeAction=(key:string,action:IntakePackage['requirements'][number]['action'])=>{
    if(!pkg)return;change({...pkg,requirements:pkg.requirements.map(r=>r.key===key?{...r,action,existingId:undefined,expectedVersion:undefined,...(action==='update'?{workItems:[]}: {})}:r)});
  };
  const people=useQuery({queryKey:[...keys.people,projectId],queryFn:()=>api<Person[]>('/api/people?projectId='+projectId)});
  const parseText=(value:string):IntakePackage=>intakePackageSchema.parse({formatVersion: 3,requirements:value.trim().split(/\n\s*\n/).filter(v=>v.trim()).map(block=>({key:randomUUID(),title:block.trim().split('\n')[0].slice(0,200),background:block.trim()}))});
  const parseInput=(value:string)=>value.trim().startsWith('{')?intakePackageSchema.parse(JSON.parse(value)):parseText(value);
  const download=(value:unknown,name:string)=>{const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);};
  const parse=()=>{try{change(parseInput(raw));setAdvanced(false);}catch(e){setError(e instanceof Error?e.message:'内容读取失败');}};
  const readFile=async(file:File|undefined)=>{if(!file)return;if(file.size>10*1024*1024){setError('导入文件不能超过 10MB');return;}try{const value=await file.text();setRaw(value);change(parseInput(value));}catch(e){setError(e instanceof Error?e.message:'文件读取失败');}};
  const inspect=async()=>{
    if(!pkg||requestLock.current||attemptRef.current)return;requestLock.current=true;setBusy(true);setError('');
    try{const value=await api<ImportPreview>(`/api/projects/${projectId}/requirement-import/preview`,{method:'POST',body:jsonBody({package:pkg})});if(!value||!Array.isArray(value.errors)||!Array.isArray(value.warnings)||!Array.isArray(value.existingMatches)||!value.counts||!value.previewToken)throw new Error('预览响应不完整，草稿已保留');if(mounted.current&&!attemptRef.current){setPreview(value);setPackage(intakePackageSchema.parse(value.package));}}
    catch(e){if(mounted.current)setError(e instanceof Error?e.message:'预览失败，草稿已保留');}finally{requestLock.current=false;if(mounted.current)setBusy(false);}
  };
  const finish=(receipt:Extract<ImportReceipt,{status:'applied'}>)=>{attemptRef.current=null;setResult(receipt);setAttempt(null);setClosedBatchId(receipt.batchId);setPreview(null);persist({raw,pkg,attempt:null,closedBatchId:receipt.batchId});invalidateRequirementViews(client);};
  const submit=async()=>{
    if(requestLock.current||attemptRef.current)return;const shared=loadDraft(storageKey);if(shared.attempt){attemptRef.current=shared.attempt;setRaw(shared.raw);setPackage(shared.pkg);setAttempt(shared.attempt);setClosedBatchId(shared.closedBatchId);setPreview(null);setResult(null);setError('');return;}
    if(!preview||preview.errors.length)return;
    const next:Attempt={batchId:randomUUID(),package:preview.package,previewToken:preview.previewToken,expectedRevision:preview.expectedRevision};
    if(!persist({raw,pkg,attempt:next,closedBatchId:null}))return;
    requestLock.current=true;attemptRef.current=next;setAttempt(next);setClosedBatchId(null);setBusy(true);setError('');
    try{const receipt=await api<ImportReceipt>(`/api/projects/${projectId}/requirement-import/apply`,{method:'POST',body:jsonBody(next)});if(receipt.status!=='applied'||!receipt.requirementIds||typeof receipt.requirementIds!=='object')throw new Error('提交结果无法确认');if(mounted.current)finish(receipt);}
    catch(e){if(mounted.current){setError(e instanceof Error?e.message:'提交结果待核对');if(!isWriteOutcomeUnknown(e)&&e instanceof ApiError){attemptRef.current=null;setAttempt(null);setClosedBatchId(next.batchId);setPreview(null);persist({raw,pkg,attempt:null,closedBatchId:next.batchId});}}}
    finally{requestLock.current=false;if(mounted.current)setBusy(false);}
  };
  const checkReceipt=async()=>{
    if(!attempt||requestLock.current)return;requestLock.current=true;setBusy(true);setError('');
    try{const receipt=await api<ImportReceipt>(`/api/projects/${projectId}/requirement-import/receipts/${attempt.batchId}`);if(mounted.current){if(receipt.status==='applied'&&receipt.requirementIds&&typeof receipt.requirementIds==='object')finish(receipt);else setError('尚未找到回执。可以按原批次重试；系统不会重复创建。');}}
    catch(e){if(mounted.current)setError(e instanceof Error?e.message:'回执查询失败');}finally{requestLock.current=false;if(mounted.current)setBusy(false);}
  };
  const retryOriginal=async()=>{
    if(!attempt||requestLock.current)return;requestLock.current=true;setBusy(true);setError('');
    try{const receipt=await api<ImportReceipt>(`/api/projects/${projectId}/requirement-import/apply`,{method:'POST',body:jsonBody(attempt)});if(receipt.status!=='applied'||!receipt.requirementIds||typeof receipt.requirementIds!=='object')throw new Error('提交结果无法确认');if(mounted.current)finish(receipt);}
    catch(e){if(mounted.current){setError(e instanceof Error?e.message:'提交结果待核对');if(!isWriteOutcomeUnknown(e)&&e instanceof ApiError){attemptRef.current=null;setAttempt(null);setClosedBatchId(attempt.batchId);setPreview(null);persist({raw,pkg,attempt:null,closedBatchId:attempt.batchId});}}}finally{requestLock.current=false;if(mounted.current)setBusy(false);}
  };
  return <div className="intake-stack">
    <div className="intake-section-head"><div><h2>导入需求</h2><p className="field-help">粘贴原始需求，每段一条：第一行是标题，其余内容保留为说明。核对后保存。</p></div><div className="button-row"><button className="ghost-button" onClick={()=>download(intakeExample,'requirement-import-example.json')}>下载工具示例</button>{pkg&&<button className="ghost-button" onClick={()=>download(pkg,'requirement-import-draft.json')}>导出草稿</button>}</div></div>
    {storageError&&<div className="warning-banner">{storageError}</div>}{error&&<div className="form-error" role="alert">{error}</div>}
    {attempt&&<div className="warning-banner"><p>上次提交结果待核对，原批次已保留。</p><button className="primary-button" disabled={busy} onClick={()=>void checkReceipt()}>查询提交回执</button><button className="ghost-button" disabled={busy} onClick={()=>void retryOriginal()}>按原批次重试</button></div>}
    {result&&<div className="intake-preview-result"><strong>已保存 {Object.keys(result.requirementIds).length} 个需求</strong><div className="button-row">{Object.entries(result.requirementIds).map(([key,id])=><Link key={key} to={'/requirements/'+id}>{pkg?.requirements.find(r=>r.key===key)?.title||key}</Link>)}</div><button className="ghost-button" onClick={()=>{setPackage(null);setRaw('');setResult(null);}}>继续导入</button></div>}
    <fieldset className="form-fieldset intake-stack" disabled={busy||!!attempt||!!result}>
    {(!pkg||advanced)&&<div className="intake-import-empty"><label className="field"><span>上传文本、Markdown 或工具 JSON</span><input type="file" accept=".txt,.md,.json,text/plain,text/markdown,application/json" onChange={e=>void readFile(e.target.files?.[0])}/></label><label className="field"><span>原始需求</span><textarea className="intake-import-json" aria-label="原始需求" value={raw} onChange={e=>{setRaw(e.target.value);setPreview(null);}} placeholder={'用户登录认证\n用户输入账号和密码后可以登录。\n\n日志查询\n支持按时间和用户筛选日志。'}/></label><button className="primary-button" disabled={!raw.trim()} onClick={parse}>整理需求</button></div>}
    {pkg&&<><div className="intake-toolbar"><strong>{pkg.requirements.filter(r=>r.action!=='skip').length} 个需求</strong><button className="ghost-button" onClick={()=>{setAdvanced(v=>!v);setRaw(JSON.stringify(pkg,null,2));}}>编辑导入文件</button><button className="ghost-button" onClick={()=>change({...pkg,requirements:[...pkg.requirements,{key:randomUUID(),title:'新需求',action:'create',confirmAdditional:false,workItems:[]}]})}>增加需求</button></div>
    <div className="intake-stack">{pkg.requirements.map(r=><section className="intake-import-card" key={r.key}>
      <label className="field"><span>需求标题</span><input aria-label="导入需求标题" value={r.title} onChange={e=>editRequirement(r.key,{title:e.target.value})}/></label>
      <label className="field"><span>处理方式</span><select aria-label="导入处理方式" value={r.action} onChange={e=>changeAction(r.key,e.target.value as typeof r.action)}><option value="create">新建需求</option><option value="update">更新已有需求</option><option value="skip">跳过</option></select></label>
      {r.action==='update'&&<label className="field"><span>已有需求</span><select aria-label="已有需求" value={r.existingId||''} onChange={e=>{const old=requirements.data?.find(x=>x.id===e.target.value);editRequirement(r.key,{existingId:old?.id,expectedVersion:old?.version});}}><option value="">请选择</option>{requirements.data?.filter(x=>!['completed','cancelled'].includes(x.status)).map(old=><option value={old.id} key={old.id}>{old.title}</option>)}</select></label>}
      {r.action!=='skip'&&<><label className="field"><span>需求说明 / 原文</span><textarea aria-label="导入需求原文" value={r.background||''} rows={4} onChange={e=>editRequirement(r.key,{background:e.target.value})}/></label><label className="field"><span>来源链接（可选）</span><input aria-label="导入来源链接" type="url" value={r.referenceUrl||''} onChange={e=>editRequirement(r.key,{referenceUrl:e.target.value||null})}/></label>
      <div className="intake-doc-meta"><label className="field"><span>负责人</span><select aria-label="导入需求负责人" value={r.ownerId||''} onChange={e=>editRequirement(r.key,{ownerId:e.target.value||null})}><option value="">未分配</option>{people.data?.filter(p=>p.active&&p.accountStatus==='active'&&p.projectRole!=='viewer').map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="field"><span>特性</span><input value={r.feature||''} onChange={e=>editRequirement(r.key,{feature:e.target.value||null})}/></label><label className="field"><span>Phase（可选）</span><input value={r.phase||''} onChange={e=>editRequirement(r.key,{phase:e.target.value||null})}/></label><label className="field"><span>归属调整原因</span><input maxLength={2000} value={r.reason||''} onChange={e=>editRequirement(r.key,{reason:e.target.value})}/></label><label className="field"><span>计划开始</span><input aria-label="导入计划开始" type="date" value={r.plannedStart||''} onChange={e=>editRequirement(r.key,{plannedStart:e.target.value||null})}/></label><label className="field"><span>计划完成</span><input aria-label="导入计划完成" type="date" value={r.plannedEnd||''} onChange={e=>editRequirement(r.key,{plannedEnd:e.target.value||null})}/></label></div>
      <label className="field"><span>完成标准（可选）</span><textarea value={r.acceptanceCriteria||''} onChange={e=>editRequirement(r.key,{acceptanceCriteria:e.target.value})}/></label>
      {r.action==='create'&&<><details><summary>{r.workItems.length?r.workItems.length+' 个工作项':'按需添加工作项'}</summary>{r.workItems.map((w,i)=><div className="intake-feature-row" key={w.key}><input aria-label="导入工作项标题" value={w.title} onChange={e=>editRequirement(r.key,{workItems:r.workItems.map((x,j)=>i===j?{...x,title:e.target.value}:x)})}/><WorkStageSelect value={w.workStage} onChange={workStage=>editRequirement(r.key,{workItems:r.workItems.map((x,j)=>i===j?{...x,workStage}:x)})}/><button className="ghost-button" onClick={()=>{const next=structuredClone(pkg);next.requirements.find(x=>x.key===r.key)!.workItems.splice(i,1);next.dependencies=next.dependencies.filter(d=>!(d.source.requirement===r.key&&d.source.workItem===w.key)&&!(d.target.requirement===r.key&&d.target.workItem===w.key));change(next);}}>移除</button></div>)}<button className="ghost-button" onClick={()=>editRequirement(r.key,{workItems:[...r.workItems,{key:randomUUID(),title:'新工作项'}]})}>添加工作项</button></details>
      <div className="button-row"><button className="ghost-button" onClick={()=>change(splitIntakeRequirement(pkg,r.key,randomUUID()))}>拆分需求</button><select aria-label="合并需求到" value="" onChange={e=>{if(e.target.value)change(mergeIntakeRequirements(pkg,r.key,e.target.value));}}><option value="">合并到…</option>{pkg.requirements.filter(x=>x.key!==r.key&&x.action==='create').map(x=><option key={x.key} value={x.key}>{x.title}</option>)}</select></div>
      {preview?.existingMatches.some(x=>x.requirement===r.key)&&<label className="warning-banner"><input type="checkbox" checked={r.confirmAdditional} onChange={e=>editRequirement(r.key,{confirmAdditional:e.target.checked})}/>已有同名需求，确认另建</label>}</>}
      </>}
    </section>)}</div></>}
    {preview&&<div className="intake-preview-result"><strong>新增 {preview.counts.requirements} 个需求，更新 {preview.counts.updated} 个需求，新增 {preview.counts.workItems} 个工作项</strong>{preview.errors.length>0&&<ul>{preview.errors.map(e=><li key={e}>{e}</li>)}</ul>}{preview.warnings.length>0&&<details open><summary>资料提示</summary><ul>{preview.warnings.map(w=><li key={w}>{w}</li>)}</ul></details>}{!!preview.differences&&<DeliveryImpactTable entries={(preview.differences as {impact?:Parameters<typeof DeliveryImpactTable>[0]['entries']}).impact||[]} target={(preview.differences as {target?:Parameters<typeof DeliveryImpactTable>[0]['target']}).target}/>}</div>}
    <div className="intake-import-actions"><span>{busy?'正在处理…':preview?'修改内容后需重新预览':'草稿保存在本机'}</span><button className="ghost-button" disabled={!pkg||busy||advanced} onClick={()=>void inspect()}>预览导入</button><button className="primary-button" disabled={!preview||!!preview.errors.length||busy||!!storageError} onClick={()=>void submit()}>保存需求</button></div>
    </fieldset>
  </div>;
}
