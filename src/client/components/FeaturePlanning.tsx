import { Button, ButtonLink } from './Button';
import {assertCleanProjectDraft} from '../use-graph-draft';
import {Select} from './Select';
import {useDeliveryForm} from '../use-delivery-form';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link,useSearchParams } from 'react-router-dom';
import { api, ApiError, InvalidResponseError, isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from '../api';
import { useSession } from '../app-context';
import { canManageProject } from '../permissions';
import { useResourceQuery } from '../use-resource-query';
import { keys, invalidateRequirementViews } from '../query-keys';
import { emptyFeatureOverview, featureAssessmentLabels, featureOverviewInput, type Feature, type IntakeCatalog } from '../../shared/intake';
import type { FeatureOverview } from '../../shared/feature-overview';
import type { FeatureRequirements } from '../../shared/features';
import { Modal } from './Modal';
import { Pagination } from './Pagination';
import {PhaseRows,type PhaseEdit} from './PhasePlanning';
import { ExecutionStageBadge } from './ExecutionStageBadge';
import { formatDateTime } from '../format';
import './feature-planning.css';
import {ViewTabs} from './ViewTabs';
import {TopbarMenu} from './TopbarMenu';

export type FeatureEdit = { mode:'basic'|'assessment'|'archive'|'restore'|'delete'; feature?:Feature };
function normalized(value:PendingFeature['value']){return {...value,name:value.name.trim(),description:value.description.trim(),overview:featureOverviewInput.parse(value.overview)};}
type PendingFeature = FeatureEdit & { value: { name:string;description:string;referenceLinks?:Array<{title:string;url:string}>;overview:Feature['overview'] } };
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
    setBusy(true);try{const features=await api<Feature[]>('/api/projects/'+projectId+'/features?state=all');if(!Array.isArray(features)||!features.every(g=>g&&g.projectId===projectId&&typeof g.id==='string'&&typeof g.name==='string'&&typeof g.description==='string'&&Number.isInteger(g.version)&&featureOverviewInput.safeParse(g.overview).success))throw new InvalidResponseError(200,false,'特性列表不完整');if(active.current){setLatest(features.find(g=>baseline?g.id===baseline.id:g.name===value.name.trim())||null);}}catch(e){if(active.current)setError((e as Error).message);}finally{if(active.current)setBusy(false);}
  };
  const resolved=latest!==undefined&&(edit.mode==='delete'?!latest:!!latest&&(edit.mode==='archive'?!!latest.archivedAt:edit.mode==='restore'?!latest.archivedAt:edit.mode==='basic'?latest.name===value.name.trim()&&latest.description===value.description.trim()&&JSON.stringify(latest.referenceLinks||[])===JSON.stringify(value.referenceLinks||[]):JSON.stringify(latest.overview)===JSON.stringify(normalized(value).overview)&&latest.version>(baseline?.version||0)));
  const save=async()=>{
    if(lock.current||blocked)return;lock.current=true;setBusy(true);setError('');
    const inputValue=normalized(value),pending={...edit,feature:baseline,value:inputValue};persist(pending);
    try{
      await assertCleanProjectDraft(account,projectId);
      const suffix=edit.mode==='archive'||edit.mode==='restore'?'/'+baseline!.id+'/'+edit.mode:edit.mode==='delete'?'/'+baseline!.id:'';
      const payload=suffix?{expectedVersion:baseline!.version}:{...(baseline?{id:baseline.id,expectedVersion:baseline.version}:{}),name:edit.mode==='assessment'?baseline!.name:inputValue.name,sortOrder:baseline?.sortOrder??2147483647,...(edit.mode==='assessment'?{overview:inputValue.overview}:{description:inputValue.description,referenceLinks:inputValue.referenceLinks||[]})};
      const response=await api<IntakeCatalog|Feature>('/api/projects/'+projectId+'/features'+suffix,{method:edit.mode==='delete'?'DELETE':'POST',body:jsonBody(payload)});
      const saved=response&&'features' in response&&Array.isArray(response.features)?response.features.find(g=>baseline?g.id===baseline.id:g.name===inputValue.name):response&&'id' in response?response:undefined;
      const valid=edit.mode==='delete'?response&&'features' in response&&Array.isArray(response.features)&&!saved:saved&&Number.isInteger(saved.version)&&saved.version>(baseline?.version||0)&&(edit.mode==='archive'?!!saved.archivedAt:edit.mode==='restore'?!saved.archivedAt:edit.mode==='assessment'?featureOverviewInput.safeParse(saved.overview).success&&JSON.stringify(saved.overview)===JSON.stringify(inputValue.overview):saved.name===inputValue.name&&saved.description===inputValue.description&&JSON.stringify(saved.referenceLinks||[])===JSON.stringify(inputValue.referenceLinks||[]));
      if(!valid)throw new InvalidResponseError(200,true,'保存结果不完整');
      persist(null);clearLocal();if(active.current){invalidateRequirementViews(client);onClose();if(saved)onSaved?.(saved.id);}
    }catch(e){if(!active.current)return;setError((e as Error).message);const uncertain=isWriteOutcomeUnknown(e)||e instanceof ApiError&&e.status>=500;setUnknown(uncertain);if(!uncertain)persist(null);if(uncertain||requiresWriteRecheck(e)&&(!(e instanceof ApiError)||e.status!==409||e.code==='STALE_WRITE')){setBlocked(true);if(!uncertain)await read();}}
    finally{lock.current=false;if(active.current)setBusy(false);}
  };
  const title={basic:baseline?'编辑特性':'新建特性',assessment:'评估特性',archive:'归档特性',restore:'恢复特性',delete:'删除空特性'}[edit.mode];
  const form=<form className={'feature-form'+(embedded?' feature-form-embedded':'')} onSubmit={e=>{e.preventDefault();void save();}}>
    <fieldset disabled={busy||unknown}>
      {edit.mode==='basic'&&<><label className="field"><span>特性名称</span><input required maxLength={200} value={value.name} onChange={e=>setValue({...value,name:e.target.value})}/></label><label className="field"><span>长期目标与范围</span><textarea aria-label="长期目标与范围" rows={5} maxLength={10000} value={value.description} onChange={e=>setValue({...value,description:e.target.value})}/></label><div className="field"><span>文档链接（MPS／MDS 等）</span>{(value.referenceLinks||[]).map((link,index)=><div className="feature-link-editor" key={index}><input required aria-label="文档名称" placeholder="文档名称" value={link.title} onChange={e=>setValue({...value,referenceLinks:value.referenceLinks!.map((l,i)=>i===index?{...l,title:e.target.value}:l)})}/><input type="url" required aria-label="文档地址" placeholder="https://…" value={link.url} onChange={e=>setValue({...value,referenceLinks:value.referenceLinks!.map((l,i)=>i===index?{...l,url:e.target.value}:l)})}/><Button variant="secondary" type="button" className="ghost-button" onClick={()=>setValue({...value,referenceLinks:value.referenceLinks!.filter((_,i)=>i!==index)})}>移除</Button></div>)}<Button variant="secondary" type="button" className="ghost-button" disabled={(value.referenceLinks?.length||0)>=20} onClick={()=>setValue({...value,referenceLinks:[...value.referenceLinks||[],{title:"",url:""}]})}>添加文档链接</Button></div></>}
      {edit.mode==='assessment'&&<>{(['expectation','progressSummary','note'] as const).map(field=><label className="field" key={field}><span>{{expectation:'大致预期',progressSummary:'进展简述',note:'原因或变化说明'}[field]}</span><textarea aria-label={{expectation:'大致预期',progressSummary:'进展简述',note:'原因或变化说明'}[field]} rows={3} maxLength={2000} value={value.overview[field]} onChange={e=>setValue({...value,overview:{...value.overview,[field]:e.target.value}})}/></label>)}<label className="field"><span>判断</span><Select aria-label="判断" value={value.overview.assessment} onChange={e=>setValue({...value,overview:{...value.overview,assessment:e.target.value as Feature['overview']['assessment']}})}>{Object.entries(featureAssessmentLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</Select></label></>}
      {['archive','restore','delete'].includes(edit.mode)&&<p>{value.name}：{edit.mode==='archive'?'归档保留需求与规划关系；请先处理未完成需求。':edit.mode==='restore'?'恢复后可继续维护目标、评估和需求归属。':'仅能删除没有关联需求及规划关系的空特性。'}</p>}
    </fieldset>
    {error&&<p role="alert" className="warning-banner">{error}</p>}
    {blocked&&<div className="warning-banner">{unknown?'提交结果待核对。':'资料已变化。'}输入已保留。<Button variant="secondary" type="button" className="ghost-button" disabled={busy} onClick={()=>void read()}>读取最新资料</Button></div>}
    {latest!==undefined&&<div className="feature-recheck"><h3>服务器上的最新资料</h3>{latest?<><p>{latest.name}{latest.archivedAt?'（已归档）':''}</p><p>{latest.description}</p><p>{latest.overview.expectation}</p><p>{latest.overview.progressSummary}</p><p>{featureAssessmentLabels[latest.overview.assessment]}</p><p>{latest.overview.note}</p></>:<p>未找到该特性。</p>}<Button variant="secondary" type="button" className="ghost-button" onClick={()=>{persist(null);if(unknown&&resolved||baseline&&!latest){invalidateRequirementViews(client);onClose();return;}setBaseline(latest||undefined);setLatest(undefined);setBlocked(false);setUnknown(false);}}>{unknown&&resolved?'已核对，操作已生效':baseline&&!latest?'完成核对并关闭':'保留输入，按最新资料继续'}</Button></div>}
    <div className="form-actions"><Button variant="secondary" type="button" className="ghost-button" onClick={()=>{clearLocal();onClose();}} disabled={busy}>{embedded?'取消编辑':'关闭'}</Button><Button busy={(busy)} aria-label={busy?'处理中…':edit.mode==='assessment'?'保存评估':title} variant="primary" type="submit" className="primary-button" disabled={busy||blocked}>{edit.mode==='assessment'?'保存评估':title}</Button></div>
  </form>;
  return embedded?<><h3 className="feature-edit-heading">{title}</h3>{form}</>:<Modal title={title} onClose={()=>{clearLocal();onClose();}} closable={!busy}>{form}</Modal>;
}
export function FeatureDetails({projectId,feature,edit,onEdit,onBusy,returnTo,onPhaseEdit,onEnter}:{onEnter?:()=>void;onPhaseEdit:(edit:PhaseEdit)=>void;returnTo?:string;projectId:string;feature:FeatureOverview;edit?:FeatureEdit|null;onEdit:(edit:FeatureEdit|null)=>void;onBusy?:(busy:boolean)=>void}) {
  const {session}=useSession(),manage=canManageProject(session,projectId),[params]=useSearchParams();
  const [tab,setTab]=useState<'phases'|'basic'|'assessment'|'requirements'>(edit?.mode==='assessment'?'assessment':'phases');
  const activeTab=edit?.mode==='assessment'?'assessment':tab;
  return <div className="feature-detail-panel">
    <div className="feature-detail-toolbar">
      {onEnter&&<Button variant="primary" className="primary-button" disabled={!!edit} onClick={onEnter}>进入需求</Button>}
      {manage&&<TopbarMenu label="特性更多操作" disabled={!!edit}><Button variant="menu" className="ghost-button" onClick={()=>onEdit({mode:feature.archivedAt?'restore':'archive',feature})}>{feature.archivedAt?'恢复特性':'归档特性'}</Button><Button variant="menu" tone="danger" className="ghost-button danger-text" onClick={()=>onEdit({mode:'delete',feature})}>删除空特性</Button></TopbarMenu>}
    </div>
    <div className="feature-detail-navigation"><ViewTabs ariaLabel="特性详情" value={activeTab} disabled={!!edit} onChange={setTab} options={[{value:'phases',label:'Phase 交付'},{value:'basic',label:'目标与范围'},{value:'assessment',label:'进展评估'},{value:'requirements',label:'关联需求'}]}/>
    </div>
    {edit?<FeatureEditor key={feature.id+edit.mode} projectId={projectId} edit={edit} embedded onBusy={onBusy} onClose={()=>onEdit(null)}/>:<>
      <div className="feature-detail-body">
        {activeTab==='phases'&&<PhaseRows feature={feature} manage={manage} onEdit={onPhaseEdit}/>}
        {activeTab==='basic'&&<><h3>长期目标与范围</h3><p className="feature-full-text">{feature.description||'尚未填写长期目标与范围'}</p>{feature.referenceLinks?.map(link=><p key={link.url}><a href={link.url} target="_blank" rel="noreferrer">{link.title}</a></p>)}{feature.archivedAt&&<p className="field-help">已归档，保留目标、需求关联及规划关系。</p>}</>}
        {activeTab==='assessment'&&<>
          <div className="canvas-assessment"><FeatureAssessment feature={feature}/><small>{feature.assessedAt?formatDateTime(feature.assessedAt)+' · '+(feature.assessedByName||'原评估人'):'尚未评估'}</small></div>
          <dl className="feature-description">{([['大致预期',feature.overview.expectation],['进展简述',feature.overview.progressSummary],['原因或变化说明',feature.overview.note]] as const).filter(([,value])=>value).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          <h3>执行事实</h3><div className="feature-stat-grid">{Object.entries({completed:'已完成',inProgress:'进行中',delayed:'延期',unscheduled:'排期不完整',recentCompleted:'近七天完成'}).map(([key,label])=><div key={key}><strong>{feature.counts[key as keyof FeatureOverview['counts']]}</strong><span>{label}</span></div>)}</div>
          <h3>最近进展</h3>{feature.recentUpdates.length?<ul className="feature-updates">{feature.recentUpdates.map(u=><li key={u.id}><Link to={'/requirements/'+u.requirementId}>{u.requirementTitle}</Link><p>{u.content}</p><small>{formatDateTime(u.createdAt)}</small></li>)}</ul>:<p className="field-help">暂无需求进展</p>}
        </>}
        {activeTab==='requirements'&&<FeatureRequirementList key={feature.id} projectId={projectId} featureId={feature.id}/>}
      </div>
      <footer className="feature-detail-footer">
        {activeTab==='phases'&&<>{manage&&!feature.archivedAt&&<><Button variant="primary" className="primary-button" onClick={()=>onPhaseEdit({feature,mode:'edit'})}>新增 Phase</Button><Button variant="secondary" className="ghost-button" onClick={()=>onPhaseEdit({feature,mode:'placement'})}>安排需求</Button></>}{!onEnter&&<ButtonLink variant="secondary" className="ghost-button" to={'/?'+new URLSearchParams({view:'feature',featureId:feature.id,mode:params.get('mode')||'table'})}>查看需求</ButtonLink>}</>}
        {activeTab==='basic'&&<>{manage&&!feature.archivedAt&&<Button variant="primary" className="primary-button" onClick={()=>onEdit({mode:'basic',feature})}>编辑资料</Button>}{!returnTo&&!onEnter&&<ButtonLink variant="secondary" className="ghost-button" to={'/paths?'+new URLSearchParams({view:'features',pathNode:'feature:'+feature.id,pathInspector:'open'})}>查看关系图</ButtonLink>}</>}
        {activeTab==='assessment'&&manage&&!feature.archivedAt&&<Button variant="primary" className="primary-button" onClick={()=>onEdit({mode:'assessment',feature})}>更新评估</Button>}
        {activeTab==='requirements'&&<ButtonLink variant="primary" className="primary-button" to={'/?'+new URLSearchParams({view:'feature',featureId:feature.id,mode:params.get('mode')||'table'})}>{manage&&!feature.archivedAt?'整理需求':'查看需求'}</ButtonLink>}
        {returnTo&&<ButtonLink variant="secondary" className="ghost-button" to={returnTo}>返回路径分析</ButtonLink>}
      </footer>
    </>}
  </div>;
}
export function FeatureAssessment({feature}:{feature:Feature}) {return <span className={'feature-assessment assessment-'+feature.overview.assessment}>{featureAssessmentLabels[feature.overview.assessment]}</span>;}
export function FeatureRequirementList({projectId,featureId}:{projectId:string;featureId:string}) {
  const [params]=useSearchParams();
  const {session}=useSession(),[state,setState]=useState('current'),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(20);
  const query=useResourceQuery<FeatureRequirements>([...keys.featureRequirements,projectId,session.accountId,featureId,state,page,pageSize],'/api/projects/'+projectId+'/features/'+encodeURIComponent(featureId)+'/requirements?'+new URLSearchParams({state,page:String(page),pageSize:String(pageSize)}),!!projectId);
  return <section className="feature-requirements"><div className="feature-detail-actions"><Button variant="secondary" className="ghost-button" aria-pressed={state==='current'} onClick={()=>{setState('current');setPage(1);}}>关联需求</Button><Button variant="secondary" className="ghost-button" aria-pressed={state==='archived'} onClick={()=>{setState('archived');setPage(1);}}>已归档需求</Button></div>{query.error&&<p role="alert">{query.error.message}</p>}{query.unavailable?<p>正在读取需求…</p>:<><ul>{query.data?.items.map(r=><li key={r.id}>{state==='current'?<Link to={'/?'+new URLSearchParams({view:'feature',featureId,mode:params.get('mode')||'table',pathNode:r.id,pathInspector:'open'})}>{r.title}</Link>:<span>{r.title}</span>}<ExecutionStageBadge requirement={r}/>{r.deletedAt&&<small>归档于 {formatDateTime(r.deletedAt)}</small>}</li>)}</ul>{!query.data?.total&&<p>{state==='archived'?'暂无归档需求':'尚未关联需求'}</p>}<Pagination page={page} pageSize={pageSize} total={query.data?.total||0} onPageChange={setPage} onPageSizeChange={size=>{setPageSize(size);setPage(1);}} loading={query.isFetching}/></>}</section>;
}
