import * as planningApi from '../features/planning/api';
import { ReferenceLinksEditor } from './ReferenceLinks';
import { readReferenceLinks, referenceLinksEqual, type ReferenceLink } from '../../shared/reference-links';
import { Button } from './Button';
import { assertCleanProjectDraft } from '../use-graph-draft';
import { Select } from './Select';
import { useDeliveryForm } from '../use-delivery-form';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, InvalidResponseError, isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from '../api';
import { useSession } from '../app-context';
import { invalidateRequirementViews } from '../query-keys';
import { emptyFeatureOverview, featureAssessmentLabels, featureOverviewInput, type Feature, type IntakeCatalog } from '../../shared/intake';
import { Modal } from './Modal';
import './feature-planning.css';

export type FeatureEdit = { mode:'basic'|'assessment'|'archive'|'restore'|'delete'; feature?:Feature };
function normalized(value:PendingFeature['value']){return {...value,name:value.name.trim(),description:value.description.trim(),referenceLinks:readReferenceLinks(value.referenceLinks),overview:featureOverviewInput.parse(value.overview)};}
type PendingFeature = FeatureEdit & { value: { name:string;description:string;referenceLinks?:ReferenceLink[];overview:Feature['overview'] } };
function rebaseFeatureValue(draft:PendingFeature['value'],previous:Feature,latest:Feature):PendingFeature['value'] {
  const merged={...draft,overview:{...draft.overview}};
  for(const field of ['name','description'] as const)if(draft[field].trim()===previous[field])merged[field]=latest[field];
  if(JSON.stringify(readReferenceLinks(draft.referenceLinks))===JSON.stringify(readReferenceLinks(previous.referenceLinks)))merged.referenceLinks=latest.referenceLinks||[];
  for(const field of ['expectation','progressSummary','assessment','note'] as const){
    if(draft.overview[field].trim()===previous.overview[field])Object.assign(merged.overview,{[field]:latest.overview[field]});
  }
  return merged;
}
const pendingKey=(account:string,project:string)=>'pm-feature-write:'+account+':'+project;
export function readFeaturePending(account:string,project:string):PendingFeature|null {try{const value=JSON.parse(sessionStorage.getItem(pendingKey(account,project))||'null') as PendingFeature|null;return value&&['basic','assessment','archive','restore','delete'].includes(value.mode)&&typeof value.value?.name==='string'&&typeof value.value.description==='string'&&featureOverviewInput.safeParse(value.value.overview).success&&(!value.feature||value.feature.projectId===project)?value:null;}catch{return null;}}
export function FeatureEditor({projectId,edit:requestedEdit,onClose,embedded=false,onBusy,onSaved}:{projectId:string;edit:FeatureEdit;onClose:()=>void;embedded?:boolean;onBusy?:(busy:boolean)=>void;onSaved?:(id:string)=>void}) {
  const {session}=useSession(),account=session.accountId||session.username||'guest',client=useQueryClient();
  const [stored]=useState(()=>readFeaturePending(account,projectId));
  const edit=stored||requestedEdit;
  const [local,setLocal,clearLocal]=useDeliveryForm(projectId,(edit.feature?.id||'new')+':feature:'+edit.mode,()=>({baseline:edit.feature,value:stored?.value||{name:edit.feature?.name||'',description:edit.feature?.description||'',referenceLinks:edit.feature?.referenceLinks||[],overview:edit.feature?.overview||{...emptyFeatureOverview}}}),!!stored);
  const [baseline,setBaseline]=useState(local.baseline),[value,setValue]=useState(local.value);
  useEffect(()=>setLocal({baseline,value}),[baseline,value,setLocal]);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[blocked,setBlocked]=useState(!!stored),[latest,setLatest]=useState<Feature|null|undefined>();
  const [unknown,setUnknown]=useState(!!stored),active=useRef(true),lock=useRef(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  useEffect(()=>{onBusy?.(busy);return()=>onBusy?.(false);},[busy,onBusy]);
  const persist=(pending:PendingFeature|null)=>{try{if(pending)sessionStorage.setItem(pendingKey(account,projectId),JSON.stringify(pending));else sessionStorage.removeItem(pendingKey(account,projectId));}catch{/* The current dialog keeps its pending state. */}};
  const read=async()=>{
    setBusy(true);try{const features=await planningApi.projectsFeaturesQuery<Feature[]>(projectId);if(!Array.isArray(features)||!features.every(g=>g&&g.projectId===projectId&&typeof g.id==='string'&&typeof g.name==='string'&&typeof g.description==='string'&&Number.isInteger(g.version)&&featureOverviewInput.safeParse(g.overview).success))throw new InvalidResponseError(200,false,'特性列表不完整');if(active.current){setLatest(features.find(g=>baseline?g.id===baseline.id:g.name===value.name.trim())||null);}}catch(e){if(active.current)setError((e as Error).message);}finally{if(active.current)setBusy(false);}
  };
  const resolved=latest!==undefined&&(edit.mode==='delete'?!latest:!!latest&&(edit.mode==='archive'?!!latest.archivedAt:edit.mode==='restore'?!latest.archivedAt:edit.mode==='basic'?latest.name===value.name.trim()&&latest.description===value.description.trim()&&referenceLinksEqual(latest.referenceLinks,value.referenceLinks):JSON.stringify(latest.overview)===JSON.stringify(normalized(value).overview)&&latest.version>(baseline?.version||0)));
  const save=async()=>{
    if(lock.current||blocked)return;lock.current=true;setBusy(true);setError('');
    const inputValue=normalized(value),pending={...edit,feature:baseline,value:inputValue};persist(pending);
    try{
      await assertCleanProjectDraft(account,projectId);
      const suffix=edit.mode==='archive'||edit.mode==='restore'?'/'+baseline!.id+'/'+edit.mode:edit.mode==='delete'?'/'+baseline!.id:'';
      const payload=suffix?{expectedVersion:baseline!.version}:{...(baseline?{id:baseline.id,expectedVersion:baseline.version}:{}),name:edit.mode==='assessment'?baseline!.name:inputValue.name,sortOrder:baseline?.sortOrder??2147483647,...(edit.mode==='assessment'?{overview:inputValue.overview}:{description:inputValue.description,referenceLinks:inputValue.referenceLinks||[]})};
      const response=await planningApi.projectsFeaturesResourceById<IntakeCatalog|Feature>(projectId, suffix, {method:edit.mode==='delete'?'DELETE':'POST',body:jsonBody(payload)});
      const saved=response&&'features' in response&&Array.isArray(response.features)?response.features.find(g=>baseline?g.id===baseline.id:g.name===inputValue.name):response&&'id' in response?response:undefined;
      const valid=edit.mode==='delete'?response&&'features' in response&&Array.isArray(response.features)&&!saved:saved&&Number.isInteger(saved.version)&&saved.version>(baseline?.version||0)&&(edit.mode==='archive'?!!saved.archivedAt:edit.mode==='restore'?!saved.archivedAt:edit.mode==='assessment'?featureOverviewInput.safeParse(saved.overview).success&&JSON.stringify(saved.overview)===JSON.stringify(inputValue.overview):saved.name===inputValue.name&&saved.description===inputValue.description&&referenceLinksEqual(saved.referenceLinks,inputValue.referenceLinks));
      if(!valid)throw new InvalidResponseError(200,true,'保存结果不完整');
      persist(null);clearLocal();if(active.current){invalidateRequirementViews(client);onClose();if(saved)onSaved?.(saved.id);}
    }catch(e){if(!active.current)return;setError((e as Error).message);const uncertain=isWriteOutcomeUnknown(e)||e instanceof ApiError&&e.status>=500;setUnknown(uncertain);if(!uncertain)persist(null);if(uncertain||requiresWriteRecheck(e)&&(!(e instanceof ApiError)||e.status!==409||e.code==='STALE_WRITE')){setBlocked(true);if(!uncertain)await read();}}
    finally{lock.current=false;if(active.current)setBusy(false);}
  };
  const title={basic:baseline?'编辑特性':'新建特性',assessment:'评估特性',archive:'归档特性',restore:'恢复特性',delete:'删除空特性'}[edit.mode];
  const form=<form className={'feature-form'+(embedded?' feature-form-embedded':'')} onSubmit={e=>{e.preventDefault();void save();}}>
    <fieldset disabled={busy||unknown}>
      {edit.mode==='basic'&&<><label className="field"><span>特性名称</span><input required maxLength={200} value={value.name} onChange={e=>setValue({...value,name:e.target.value})}/></label><label className="field"><span>长期目标与范围</span><textarea aria-label="长期目标与范围" rows={5} maxLength={10000} value={value.description} onChange={e=>setValue({...value,description:e.target.value})}/></label><ReferenceLinksEditor value={value.referenceLinks||[]} onChange={referenceLinks=>setValue({...value,referenceLinks})}/></>}
      {edit.mode==='assessment'&&<>{(['expectation','progressSummary','note'] as const).map(field=><label className="field" key={field}><span>{{expectation:'大致预期',progressSummary:'进展简述',note:'原因或变化说明'}[field]}</span><textarea aria-label={{expectation:'大致预期',progressSummary:'进展简述',note:'原因或变化说明'}[field]} rows={3} maxLength={2000} value={value.overview[field]} onChange={e=>setValue({...value,overview:{...value.overview,[field]:e.target.value}})}/></label>)}<label className="field"><span>判断</span><Select aria-label="判断" value={value.overview.assessment} onChange={e=>setValue({...value,overview:{...value.overview,assessment:e.target.value as Feature['overview']['assessment']}})}>{Object.entries(featureAssessmentLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</Select></label></>}
      {['archive','restore','delete'].includes(edit.mode)&&<p>{value.name}：{edit.mode==='archive'?'归档保留需求与规划关系；请先处理未完成需求。':edit.mode==='restore'?'恢复后可继续维护目标、评估和需求归属。':'仅能删除没有关联需求及规划关系的空特性。'}</p>}
    </fieldset>
    {error&&<p role="alert" className="warning-banner">{error}</p>}
    {blocked&&<div className="warning-banner">{unknown?'提交结果待核对。':'资料已变化。'}输入已保留。<Button variant="secondary" type="button" className="ghost-button" disabled={busy} onClick={()=>void read()}>读取最新资料</Button></div>}
    {latest!==undefined&&<div className="feature-recheck"><h3>服务器上的最新资料</h3>{latest?<><p>{latest.name}{latest.archivedAt?'（已归档）':''}</p><p>{latest.description}</p><p>{latest.overview.expectation}</p><p>{latest.overview.progressSummary}</p><p>{featureAssessmentLabels[latest.overview.assessment]}</p><p>{latest.overview.note}</p></>:<p>未找到该特性。</p>}<Button variant="secondary" type="button" className="ghost-button" onClick={()=>{persist(null);if(unknown&&resolved||baseline&&!latest){clearLocal();invalidateRequirementViews(client);onClose();return;}if(baseline&&latest)setValue(draft=>rebaseFeatureValue(draft,baseline,latest));setBaseline(latest||undefined);setLatest(undefined);setBlocked(false);setUnknown(false);}}>{unknown&&resolved?'已核对，操作已生效':baseline&&!latest?'完成核对并关闭':'保留输入，按最新资料继续'}</Button></div>}
    <div className="form-actions"><Button variant="secondary" type="button" className="ghost-button" onClick={()=>{clearLocal();onClose();}} disabled={busy}>{embedded?'取消编辑':'关闭'}</Button><Button busy={(busy)} aria-label={busy?'处理中…':edit.mode==='assessment'?'保存评估':title} variant="primary" type="submit" className="primary-button" disabled={busy||blocked}>{edit.mode==='assessment'?'保存评估':title}</Button></div>
  </form>;
  return embedded?<><h3 className="feature-edit-heading">{title}</h3>{form}</>:<Modal title={title} onClose={onClose} closable={!busy}>{form}</Modal>;
}
export function FeatureAssessment({feature}:{feature:Feature}) {return <span className={'feature-assessment assessment-'+feature.overview.assessment}>{featureAssessmentLabels[feature.overview.assessment]}</span>;}
