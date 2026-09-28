import * as requirementsApi from '../features/requirements/api';
import * as peopleApi from '../features/people/api';
import * as planningApi from '../features/planning/api';
import { ReferenceLinksEditor } from './ReferenceLinks';
import { readReferenceLinks } from '../../shared/reference-links';
import { Button } from './Button';
import { FormField } from './Form';
import { WorkStageSelect } from "./ExecutionStageBadge";
import { migrateImportDraft } from "../feature-storage-migration";
import { randomUUID } from '../random-uuid';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RequirementImportResult } from './RequirementImportResult';
import { ApiError, isWriteOutcomeUnknown, jsonBody } from '../api';
import { useSession } from '../app-context';
import { invalidateRequirementViews, keys } from '../query-keys';
import { intakeExample, intakePackageSchema, type IntakePackage, type ImportPreview, type ImportReceipt } from '../../shared/intake';
import { mergeIntakeRequirements, splitIntakeRequirement } from '../intake-edit';
import { deriveRequirementScheduleRange } from '../../shared/domain';
import { DeliveryImpactTable } from './DeliveryImpactTable';
import type { Requirement, Person } from '../types';
import { ZodError } from 'zod';

const importFieldLabels:Record<string,string>={requirements:'需求',workItems:'工作项',dependencies:'依赖',key:'标识',title:'标题',background:'原文说明',acceptanceCriteria:'验收标准',plannedStart:'计划开始',plannedEnd:'计划结束',durationDays:'工期',referenceUrl:'来源地址',referenceLinks:'关联链接',ownerId:'负责人',feature:'特性',phase:'Phase'};
function importReadError(error:unknown,fallback:string){
  if(error instanceof SyntaxError)return 'JSON格式不正确，请检查括号、引号和逗号。';
  if(!(error instanceof ZodError))return error instanceof Error?error.message:fallback;
  return error.issues.map(issue=>{
    const field=issue.path.map(part=>typeof part==='number'?`第${part+1}项`:importFieldLabels[String(part)]||String(part)).join(' · ')||'导入内容';
    const message=issue.code==='too_big'?`不能超过${issue.maximum}${issue.origin==='string'?'个字符':issue.origin==='array'?'项':''}`
      :issue.code==='too_small'?`不能少于${issue.minimum}${issue.origin==='string'?'个字符':issue.origin==='array'?'项':''}`
      :issue.code==='invalid_type'?'必填内容缺失或类型不正确'
      :issue.code==='invalid_format'?'格式不正确'
      :issue.code==='invalid_value'?`必须是${issue.values.map(String).join('、')}`
      :issue.code==='unrecognized_keys'?`不支持这些字段：${issue.keys.join('、')}`:issue.message;
    return `${field}：${message}`;
  }).join('；');
}

type Attempt={batchId:string;previewToken:string;expectedRevision:string;package:IntakePackage};
type AppliedReceipt=Extract<ImportReceipt,{status:'applied'}>;
type SavedDraft={advanced:boolean;raw:string;pkg:IntakePackage|null;attempt:Attempt|null;closedBatchId:string|null;result?:AppliedReceipt|null};
function loadDraft(key:string):SavedDraft {
  try{const value=JSON.parse(localStorage.getItem(key)||'null');if(value){if(!value.attempt){value.pkg=migrateImportDraft(value.pkg);try{const parsed=JSON.parse(value.raw);if(parsed.formatVersion===2)value.raw=JSON.stringify(migrateImportDraft(parsed),null,2);}catch{/* Free text remains intact. */}}
    const receipt=value.result,result=!value.attempt&&receipt?.status==='applied'&&typeof receipt.batchId==='string'&&receipt.batchId===value.closedBatchId&&receipt.requirementIds&&typeof receipt.requirementIds==='object'&&!Array.isArray(receipt.requirementIds)&&Object.values(receipt.requirementIds).every(id=>typeof id==='string')?receipt:null;
    return {advanced:value.advanced===true,raw:typeof value.raw==='string'?value.raw:'',pkg:value.pkg?(intakePackageSchema.safeParse(value.pkg).data??null):null,attempt:value.attempt||null,closedBatchId:typeof value.closedBatchId==='string'?value.closedBatchId:null,result};}}catch{/* Corrupt personal draft must not prevent opening the importer. */}
  return {advanced:false,raw:'',pkg:null,attempt:null,closedBatchId:null};
}
export function RequirementImport({projectId,defaultFeature,defaultPhase}:{projectId:string;defaultFeature?:string;defaultPhase?:string}) {
  const {session}=useSession(),client=useQueryClient(),storageKey=`pm-intake:${session.accountId}:${projectId}`;
  const [initial]=useState(()=>loadDraft(storageKey));
  const [raw,setRaw]=useState(initial.raw),[pkg,setPackage]=useState<IntakePackage|null>(initial.pkg),[attempt,setAttempt]=useState<Attempt|null>(initial.attempt),[closedBatchId,setClosedBatchId]=useState<string|null>(initial.closedBatchId);
  const [preview,setPreview]=useState<ImportPreview|null>(null),[result,setResult]=useState<AppliedReceipt|null>(initial.result||null),[error,setError]=useState(''),[storageError,setStorageError]=useState(''),[busy,setBusy]=useState(false),[advanced,setAdvanced]=useState(initial.advanced);
  const [expandedWork,setExpandedWork]=useState<ReadonlySet<string>>(()=>new Set());
  const [mergeSource,setMergeSource]=useState<string|null>(null);
  const mergeCandidates=pkg?.requirements.filter(r=>r.action==='create')||[];
  const toggleWork=(key:string,open:boolean)=>setExpandedWork(current=>{
    if(current.has(key)===open)return current;
    const next=new Set(current);if(open)next.add(key);else next.delete(key);return next;
  });
  const requestLock=useRef(false),attemptRef=useRef(initial.attempt),mounted=useRef(true),fileRead=useRef(0);
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
  const persist=(next:SavedDraft)=>{try{localStorage.setItem(storageKey,JSON.stringify(next));setStorageError('');return true;}catch{setStorageError('无法保存本机草稿。请导出草稿备份；恢复浏览器存储后再提交。');return false;}};
  useEffect(()=>{try{localStorage.setItem(storageKey,JSON.stringify({raw,pkg,advanced,attempt,closedBatchId,result}));setStorageError('');}catch{setStorageError('本机草稿保存失败，请导出草稿备份。');}},[raw,pkg,advanced,attempt,closedBatchId,result,storageKey]);
  useEffect(()=>{const receive=(event:StorageEvent)=>{
    if(event.key!==storageKey||!event.newValue)return;
    const saved=loadDraft(storageKey),current=attemptRef.current;
    if(saved.attempt){if(current)return;fileRead.current++;attemptRef.current=saved.attempt;setRaw(saved.raw);setPackage(saved.pkg);setAdvanced(saved.advanced);setAttempt(saved.attempt);setClosedBatchId(saved.closedBatchId);setPreview(null);setResult(null);setError('');return;}
    if(saved.result&&(!current||saved.closedBatchId===current.batchId)){
      fileRead.current++;attemptRef.current=null;setRaw(saved.raw);setPackage(saved.pkg);setAdvanced(saved.advanced);setAttempt(null);setClosedBatchId(saved.closedBatchId);setPreview(null);setResult(saved.result);setError('');return;
    }
    if(!current||saved.closedBatchId!==current.batchId)return;
    fileRead.current++;attemptRef.current=null;setRaw(saved.raw);setPackage(saved.pkg);setAdvanced(saved.advanced);setAttempt(null);setClosedBatchId(saved.closedBatchId);setPreview(null);setResult(null);setError('原待核对批次已在其他页面处理。请核对需求列表；继续导入前请重新预览。');
  };window.addEventListener('storage',receive);return()=>window.removeEventListener('storage',receive);},[storageKey]);
  const requirements=useQuery({queryKey:[...keys.requirements,projectId],queryFn:({signal})=>requirementsApi.requirementsQuery<Requirement[]>(projectId, {signal})});
  const change=(next:IntakePackage)=>{if(attempt||requestLock.current)return;fileRead.current++;setPackage(next);setRaw(JSON.stringify(next,null,2));setPreview(null);setResult(null);setError('');};
  const editRequirement=(key:string,value:Partial<IntakePackage['requirements'][number]>)=>{if(pkg)change({...pkg,requirements:pkg.requirements.map(r=>r.key===key?{...r,...value}:r)});};
  const changeAction=(key:string,action:IntakePackage['requirements'][number]['action'])=>{
    if(!pkg)return;change({...pkg,requirements:pkg.requirements.map(r=>r.key===key?{...r,action,existingId:undefined,expectedVersion:undefined,...(action==='update'?{workItems:[]}: {})}:r)});
  };
  const people=useQuery({queryKey:[...keys.people,projectId],queryFn:()=>peopleApi.peopleQuery<Person[]>(projectId)});
  const parseText=(value:string):IntakePackage=>intakePackageSchema.parse({formatVersion: 3,requirements:value.trim().split(/\n\s*\n/).filter(v=>v.trim()).map(block=>({key:randomUUID(),title:block.trim().split('\n')[0].slice(0,200).replace(/[\uD800-\uDBFF]$/, ''),background:block.trim()}))});
  const withDefaults=(pkg:IntakePackage):IntakePackage=>({...pkg,requirements:pkg.requirements.map(r=>r.action==='create'?{...r,...(r.feature===undefined&&defaultFeature?{feature:defaultFeature}:{}),...(r.phase===undefined&&defaultPhase&&(r.feature===undefined||r.feature===defaultFeature)?{phase:defaultPhase}:{})}:r)});
  const parseInput=(value:string)=>withDefaults(value.trim().startsWith('{')?intakePackageSchema.parse(JSON.parse(value)):parseText(value));
  const download=(value:unknown,name:string)=>{const blob=new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)],{type:typeof value==='string'?'text/plain;charset=utf-8':'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);};
  const parse=()=>{fileRead.current++;try{change(parseInput(raw));setAdvanced(false);}catch(e){setError(importReadError(e,'内容读取失败'));}};
  const readFile=async(file:File|undefined)=>{
    const revision=++fileRead.current;
    if(!file)return;
    if(file.size>10*1024*1024){setError('导入文件不能超过 10MB');return;}
    const current=()=>mounted.current&&revision===fileRead.current&&!requestLock.current&&!attemptRef.current;
    try{const value=await file.text();if(!current())return;setRaw(value);change(parseInput(value));}
    catch(e){if(current())setError(importReadError(e,'文件读取失败'));}
  };
  const inspect=async()=>{
    if(!pkg||requestLock.current||attemptRef.current)return;requestLock.current=true;setBusy(true);setError('');
    try{const value=await planningApi.projectsRequirementImportPreview<ImportPreview>(projectId, {method:'POST',body:jsonBody({package:pkg})});if(!value||!Array.isArray(value.errors)||!Array.isArray(value.warnings)||!Array.isArray(value.existingMatches)||!value.counts||!value.previewToken)throw new Error('预览响应不完整，草稿已保留');if(mounted.current&&!attemptRef.current){setPreview(value);setPackage(intakePackageSchema.parse(value.package));}}
    catch(e){if(mounted.current)setError(e instanceof Error?e.message:'预览失败，草稿已保留');}finally{requestLock.current=false;if(mounted.current)setBusy(false);}
  };
  const finish=(receipt:AppliedReceipt)=>{fileRead.current++;attemptRef.current=null;setResult(receipt);setAttempt(null);setClosedBatchId(receipt.batchId);setPreview(null);persist({raw,pkg,advanced,attempt:null,closedBatchId:receipt.batchId,result:receipt});invalidateRequirementViews(client);};
  const submit=async()=>{
    if(requestLock.current||attemptRef.current||result)return;const shared=loadDraft(storageKey);if(shared.attempt){attemptRef.current=shared.attempt;setRaw(shared.raw);setPackage(shared.pkg);setAdvanced(shared.advanced);setAttempt(shared.attempt);setClosedBatchId(shared.closedBatchId);setPreview(null);setResult(null);setError('');return;}
    if(shared.result){fileRead.current++;setRaw(shared.raw);setPackage(shared.pkg);setAdvanced(shared.advanced);setClosedBatchId(shared.closedBatchId);setPreview(null);setResult(shared.result);setError('');return;}
    if(!preview||preview.errors.length)return;
    const next:Attempt={batchId:randomUUID(),package:preview.package,previewToken:preview.previewToken,expectedRevision:preview.expectedRevision};
    if(!persist({raw,pkg,advanced,attempt:next,closedBatchId:null}))return;
    requestLock.current=true;attemptRef.current=next;setAttempt(next);setClosedBatchId(null);setBusy(true);setError('');
    try{const receipt=await planningApi.projectsRequirementImportApply<ImportReceipt>(projectId, {method:'POST',body:jsonBody(next)});if(receipt.status!=='applied'||!receipt.requirementIds||typeof receipt.requirementIds!=='object')throw new Error('提交结果无法确认');if(mounted.current)finish(receipt);}
    catch(e){if(mounted.current){setError(e instanceof Error?e.message:'提交结果待核对');if(!isWriteOutcomeUnknown(e)&&e instanceof ApiError){attemptRef.current=null;setAttempt(null);setClosedBatchId(next.batchId);setPreview(null);persist({raw,pkg,advanced,attempt:null,closedBatchId:next.batchId});}}}
    finally{requestLock.current=false;if(mounted.current)setBusy(false);}
  };
  const checkReceipt=async()=>{
    if(!attempt||requestLock.current)return;requestLock.current=true;setBusy(true);setError('');
    try{const receipt=await planningApi.projectsRequirementImportReceiptsById<ImportReceipt>(projectId, attempt.batchId);if(mounted.current){if(receipt.status==='applied'&&receipt.requirementIds&&typeof receipt.requirementIds==='object')finish(receipt);else setError('尚未找到回执。可以按原批次重试；系统不会重复创建。');}}
    catch(e){if(mounted.current)setError(e instanceof Error?e.message:'回执查询失败');}finally{requestLock.current=false;if(mounted.current)setBusy(false);}
  };
  const retryOriginal=async()=>{
    if(!attempt||requestLock.current)return;requestLock.current=true;setBusy(true);setError('');
    try{const receipt=await planningApi.projectsRequirementImportApply<ImportReceipt>(projectId, {method:'POST',body:jsonBody(attempt)});if(receipt.status!=='applied'||!receipt.requirementIds||typeof receipt.requirementIds!=='object')throw new Error('提交结果无法确认');if(mounted.current)finish(receipt);}
    catch(e){if(mounted.current){setError(e instanceof Error?e.message:'提交结果待核对');if(!isWriteOutcomeUnknown(e)&&e instanceof ApiError){attemptRef.current=null;setAttempt(null);setClosedBatchId(attempt.batchId);setPreview(null);persist({raw,pkg,advanced,attempt:null,closedBatchId:attempt.batchId});}}}finally{requestLock.current=false;if(mounted.current)setBusy(false);}
  };
  return <div className="intake-stack">
    {!result&&<><div className="intake-section-head"><div><h2>导入需求</h2><p className="field-help">粘贴原始需求，每段一条：第一行是标题，其余内容保留为说明。核对后保存。</p></div><div className="button-row"><Button variant="secondary" className="ghost-button" onClick={()=>download(intakeExample,'requirement-import-example.json')}>下载工具示例</Button>{(pkg||raw.trim())&&<Button variant="secondary" className="ghost-button" onClick={()=>download(!pkg||advanced?raw:pkg,!pkg||advanced?'requirement-import-draft.txt':'requirement-import-draft.json')}>导出草稿</Button>}</div></div>
    {defaultFeature&&<p className="field-help">新需求默认归属：{defaultFeature}{defaultPhase?' / '+defaultPhase:''}。可在导入预览中调整。</p>}</>}
    {storageError&&<div className="warning-banner">{storageError}{result&&<Button variant="secondary" onClick={()=>download(pkg||raw,'requirement-import-draft.json')}>导出草稿</Button>}</div>}{error&&<div className="form-error" role="alert">{error}</div>}
    {attempt&&<div className="warning-banner"><p>上次提交结果待核对，原批次已保留。</p><Button variant="primary" className="primary-button" disabled={busy} onClick={()=>void checkReceipt()}>查询提交回执</Button><Button variant="secondary" className="ghost-button" disabled={busy} onClick={()=>void retryOriginal()}>按原批次重试</Button></div>}
    {result?<RequirementImportResult result={result} pkg={pkg} projectId={projectId} onContinue={()=>{fileRead.current++;setPackage(null);setRaw('');setResult(null);setClosedBatchId(null);setAdvanced(false);setMergeSource(null);setExpandedWork(new Set());persist({raw:'',pkg:null,advanced:false,attempt:null,closedBatchId:null,result:null});}}/>:
    <fieldset className="form-fieldset intake-stack" disabled={busy||!!attempt}>
    {(!pkg||advanced)&&<div className="intake-import-empty"><label className="field"><span>上传文本、Markdown 或工具 JSON</span><input type="file" accept=".txt,.md,.json,text/plain,text/markdown,application/json" onChange={e=>void readFile(e.target.files?.[0])}/></label><label className="field"><span>原始需求</span><textarea className="intake-import-json" aria-label="原始需求" value={raw} onChange={e=>{fileRead.current++;setRaw(e.target.value);setPreview(null);}} placeholder={'用户登录认证\n用户输入账号和密码后可以登录。\n\n日志查询\n支持按时间和用户筛选日志。'}/></label><Button variant="primary" className="primary-button" disabled={!raw.trim()} onClick={parse}>整理需求</Button></div>}
    {pkg&&<><div className="intake-toolbar"><strong>{pkg.requirements.filter(r=>r.action!=='skip').length} 个需求</strong><Button variant="secondary" className="ghost-button" onClick={()=>{fileRead.current++;setAdvanced(v=>!v);setRaw(JSON.stringify(pkg,null,2));}}>编辑导入文件</Button><Button variant="secondary" className="ghost-button" onClick={()=>change({...pkg,requirements:[...pkg.requirements,{key:randomUUID(),title:'新需求',action:'create',confirmAdditional:false,workItems:[],feature:defaultFeature,phase:defaultPhase}]})}>增加需求</Button></div>
    <div className="intake-stack">{pkg.requirements.map(r=>{
      const workSchedule=r.action==='create'&&r.workItems.length?deriveRequirementScheduleRange({},r.workItems.map(w=>({...w,status:'not_started'}))):null;
      return <section className="intake-import-card" key={r.key}>
      <label className="field"><span>需求标题</span><input aria-label="导入需求标题" value={r.title} onChange={e=>editRequirement(r.key,{title:e.target.value})}/></label>
      <label className="field"><span>处理方式</span><select aria-label="导入处理方式" value={r.action} onChange={e=>changeAction(r.key,e.target.value as typeof r.action)}><option value="create">新建需求</option><option value="update">更新已有需求</option><option value="skip">跳过</option></select></label>
      {r.action==='update'&&<label className="field"><span>已有需求</span><select aria-label="已有需求" value={r.existingId||''} onChange={e=>{const old=requirements.data?.find(x=>x.id===e.target.value);editRequirement(r.key,{existingId:old?.id,expectedVersion:old?.version});}}><option value="">请选择</option>{requirements.data?.filter(x=>!['completed','cancelled'].includes(x.status)).map(old=><option value={old.id} key={old.id}>{old.title}</option>)}</select></label>}
      {r.action!=='skip'&&<><label className="field"><span>需求说明 / 原文</span><textarea aria-label="导入需求原文" value={r.background||''} rows={4} onChange={e=>editRequirement(r.key,{background:e.target.value})}/></label><ReferenceLinksEditor value={readReferenceLinks(r.referenceLinks,r.referenceUrl)} onChange={referenceLinks=>editRequirement(r.key,{referenceLinks})}/>
      <div className="intake-doc-meta"><label className="field"><span>负责人</span><select aria-label="导入需求负责人" value={r.ownerId||''} onChange={e=>editRequirement(r.key,{ownerId:e.target.value||null})}><option value="">未分配</option>{people.data?.filter(p=>p.active&&p.accountStatus==='active'&&p.projectRole!=='viewer').map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="field"><span>特性</span><input value={r.feature||''} onChange={e=>editRequirement(r.key,{feature:e.target.value||null})}/></label><label className="field"><span>Phase（可选）</span><input value={r.phase||''} onChange={e=>editRequirement(r.key,{phase:e.target.value||null})}/></label><label className="field"><span>归属调整原因</span><input maxLength={2000} value={r.reason||''} onChange={e=>editRequirement(r.key,{reason:e.target.value})}/></label>{workSchedule?<div className="intake-work-plan"><strong>计划日期（工作项汇总）：{workSchedule.plannedStart||'待定'} ～ {workSchedule.plannedEnd||'待定'}</strong><p className="field-help">需求计划由工作项汇总，请在下方工作项中设置日期。{!workSchedule.scheduleComplete&&'部分工作项尚未排期。'}</p>{(r.plannedStart||r.plannedEnd)&&<p className="field-help">原填写计划：{r.plannedStart||'待定'} ～ {r.plannedEnd||'待定'}，仅作参考。</p>}</div>:<><label className="field"><span>计划开始</span><input aria-label="导入计划开始" type="date" value={r.plannedStart||''} onChange={e=>editRequirement(r.key,{plannedStart:e.target.value||null})}/></label><label className="field"><span>计划完成</span><input aria-label="导入计划完成" type="date" value={r.plannedEnd||''} onChange={e=>editRequirement(r.key,{plannedEnd:e.target.value||null})}/></label></>}</div>
      <label className="field"><span>完成标准（可选）</span><textarea value={r.acceptanceCriteria||''} onChange={e=>editRequirement(r.key,{acceptanceCriteria:e.target.value})}/></label>
      {r.action==='create'&&<><details open={expandedWork.has(r.key)} onToggle={event=>toggleWork(r.key,event.currentTarget.open)}><summary>{r.workItems.length?r.workItems.length+' 个工作项':'按需添加工作项'}</summary>{expandedWork.has(r.key)&&r.workItems.map((w,i)=><div className="intake-feature-row" key={w.key}><FormField label="工作项标题"><input aria-label="导入工作项标题" value={w.title} onChange={e=>editRequirement(r.key,{workItems:r.workItems.map((x,j)=>i===j?{...x,title:e.target.value}:x)})}/></FormField><WorkStageSelect value={w.workStage} onChange={workStage=>editRequirement(r.key,{workItems:r.workItems.map((x,j)=>i===j?{...x,workStage}:x)})}/><Button variant="secondary" className="ghost-button" onClick={()=>{const next=structuredClone(pkg);next.requirements.find(x=>x.key===r.key)!.workItems.splice(i,1);next.dependencies=next.dependencies.filter(d=>!(d.source.requirement===r.key&&d.source.workItem===w.key)&&!(d.target.requirement===r.key&&d.target.workItem===w.key));change(next);}}>移除</Button><div className="intake-doc-meta intake-work-plan"><FormField label="计划开始"><input aria-label="导入工作项计划开始" type="date" value={w.plannedStart||''} onChange={e=>editRequirement(r.key,{workItems:r.workItems.map((x,j)=>i===j?{...x,plannedStart:e.target.value||null}:x)})}/></FormField><FormField label="计划完成"><input aria-label="导入工作项计划完成" type="date" value={w.plannedEnd||''} onChange={e=>editRequirement(r.key,{workItems:r.workItems.map((x,j)=>i===j?{...x,plannedEnd:e.target.value||null}:x)})}/></FormField></div></div>)}<Button variant="secondary" className="ghost-button" onClick={()=>editRequirement(r.key,{workItems:[...r.workItems,{key:randomUUID(),title:'新工作项'}]})}>添加工作项</Button></details>
      <div className="button-row"><Button variant="secondary" className="ghost-button" onClick={()=>change(splitIntakeRequirement(pkg,r.key,randomUUID()))}>拆分需求</Button><Button variant="secondary" className="ghost-button" disabled={mergeCandidates.length<2} aria-expanded={mergeSource===r.key} onClick={()=>setMergeSource(current=>current===r.key?null:r.key)}>合并需求</Button>{mergeSource===r.key&&<select aria-label="合并需求到" value="" onChange={e=>{if(e.target.value){change(mergeIntakeRequirements(pkg,r.key,e.target.value));setMergeSource(null);}}}><option value="">合并到…</option>{mergeCandidates.filter(x=>x.key!==r.key).map(x=><option key={x.key} value={x.key}>{x.title}</option>)}</select>}</div>
      {preview?.existingMatches.some(x=>x.requirement===r.key)&&<label className="warning-banner"><input type="checkbox" checked={r.confirmAdditional} onChange={e=>editRequirement(r.key,{confirmAdditional:e.target.checked})}/>已有同名需求，确认另建</label>}</>}
      </>}
    </section>;})}</div></>}
    {preview&&<div className="intake-preview-result"><strong>新增 {preview.counts.requirements} 个需求，更新 {preview.counts.updated} 个需求，新增 {preview.counts.workItems} 个工作项</strong>{preview.errors.length>0&&<ul>{preview.errors.map(e=><li key={e}>{e}</li>)}</ul>}{preview.warnings.length>0&&<details open><summary>资料提示</summary><ul>{preview.warnings.map(w=><li key={w}>{w}</li>)}</ul></details>}{!!preview.differences&&<DeliveryImpactTable entries={(preview.differences as {impact?:Parameters<typeof DeliveryImpactTable>[0]['entries']}).impact||[]} target={(preview.differences as {target?:Parameters<typeof DeliveryImpactTable>[0]['target']}).target}/>}</div>}
    <div className="intake-import-actions"><span>{busy?'正在处理…':preview?'修改内容后需重新预览':'草稿保存在本机'}</span><Button variant="secondary" className="ghost-button" disabled={!pkg||busy||advanced} onClick={()=>void inspect()}>预览导入</Button><Button variant="primary" className="primary-button" disabled={!preview||!!preview.errors.length||busy||!!storageError} onClick={()=>void submit()}>保存需求</Button></div>
    </fieldset>}
  </div>;
}
