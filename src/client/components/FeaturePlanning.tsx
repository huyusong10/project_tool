import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, ApiError, InvalidResponseError, isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from '../api';
import { useSession } from '../app-context';
import { canManageProject } from '../permissions';
import { useResourceQuery } from '../use-resource-query';
import { keys, invalidateRequirementViews } from '../query-keys';
import { emptyGroupOverview, groupAssessmentLabels, groupOverviewInput, type RequirementGroup, type IntakeCatalog } from '../../shared/intake';
import type { GroupOverview } from '../../shared/group-overview';
import type { FeatureRequirements } from '../../shared/features';
import { Modal } from './Modal';
import { Pagination } from './Pagination';
import { StatusBadge } from './Badge';
import { formatDateTime } from '../format';
import './feature-planning.css';

export type FeatureEdit = { mode:'basic'|'assessment'|'archive'|'restore'|'delete'; group?:RequirementGroup };
function normalized(value:PendingFeature['value']){return {...value,name:value.name.trim(),description:value.description.trim(),overview:groupOverviewInput.parse(value.overview)};}
type PendingFeature = FeatureEdit & { value: { name:string;description:string;overview:RequirementGroup['overview'] } };
const pendingKey=(account:string,project:string)=>'pm-feature-write:'+account+':'+project;
export function readFeaturePending(account:string,project:string):PendingFeature|null {try{const value=JSON.parse(sessionStorage.getItem(pendingKey(account,project))||'null') as PendingFeature|null;return value&&['basic','assessment','archive','restore','delete'].includes(value.mode)&&typeof value.value?.name==='string'&&typeof value.value.description==='string'&&groupOverviewInput.safeParse(value.value.overview).success&&(!value.group||value.group.projectId===project)?value:null;}catch{return null;}}
export function FeatureEditor({projectId,edit:requestedEdit,onClose}:{projectId:string;edit:FeatureEdit;onClose:()=>void}) {
  const {session}=useSession(),account=session.accountId||session.username||'guest',client=useQueryClient();
  const [stored]=useState(()=>readFeaturePending(account,projectId));
  const edit=stored||requestedEdit;
  const [baseline,setBaseline]=useState(edit.group);
  const [value,setValue]=useState(()=>stored?.value||{name:edit.group?.name||'',description:edit.group?.description||'',overview:edit.group?.overview||{...emptyGroupOverview}});
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[blocked,setBlocked]=useState(!!stored),[latest,setLatest]=useState<RequirementGroup|null|undefined>();
  const [unknown,setUnknown]=useState(!!stored),active=useRef(true),lock=useRef(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const persist=(pending:PendingFeature|null)=>{try{if(pending)sessionStorage.setItem(pendingKey(account,projectId),JSON.stringify(pending));else sessionStorage.removeItem(pendingKey(account,projectId));}catch{/* The current dialog keeps its pending state. */}};
  const read=async()=>{
    setBusy(true);try{const groups=await api<RequirementGroup[]>('/api/projects/'+projectId+'/requirement-groups?state=all');if(!Array.isArray(groups)||!groups.every(g=>g&&g.projectId===projectId&&typeof g.id==='string'&&typeof g.name==='string'&&typeof g.description==='string'&&Number.isInteger(g.version)&&groupOverviewInput.safeParse(g.overview).success))throw new InvalidResponseError(200,false,'特性列表不完整');if(active.current){setLatest(groups.find(g=>baseline?g.id===baseline.id:g.name===value.name.trim())||null);}}catch(e){if(active.current)setError((e as Error).message);}finally{if(active.current)setBusy(false);}
  };
  const resolved=latest!==undefined&&(edit.mode==='delete'?!latest:!!latest&&(edit.mode==='archive'?!!latest.archivedAt:edit.mode==='restore'?!latest.archivedAt:edit.mode==='basic'?latest.name===value.name.trim()&&latest.description===value.description.trim():JSON.stringify(latest.overview)===JSON.stringify(normalized(value).overview)&&latest.version>(baseline?.version||0)));
  const save=async()=>{
    if(lock.current||blocked)return;lock.current=true;setBusy(true);setError('');
    const inputValue=normalized(value),pending={...edit,group:baseline,value:inputValue};persist(pending);
    try{
      const suffix=edit.mode==='archive'||edit.mode==='restore'?'/'+baseline!.id+'/'+edit.mode:edit.mode==='delete'?'/'+baseline!.id:'';
      const payload=suffix?{expectedVersion:baseline!.version}:{...(baseline?{id:baseline.id,expectedVersion:baseline.version}:{}),name:edit.mode==='assessment'?baseline!.name:inputValue.name,sortOrder:baseline?.sortOrder??2147483647,...(edit.mode==='assessment'?{overview:inputValue.overview}:{description:inputValue.description})};
      const response=await api<IntakeCatalog|RequirementGroup>('/api/projects/'+projectId+'/requirement-groups'+suffix,{method:edit.mode==='delete'?'DELETE':'POST',body:jsonBody(payload)});
      const saved=response&&'groups' in response&&Array.isArray(response.groups)?response.groups.find(g=>baseline?g.id===baseline.id:g.name===inputValue.name):response&&'id' in response?response:undefined;
      const valid=edit.mode==='delete'?response&&'groups' in response&&Array.isArray(response.groups)&&!saved:saved&&Number.isInteger(saved.version)&&saved.version>(baseline?.version||0)&&(edit.mode==='archive'?!!saved.archivedAt:edit.mode==='restore'?!saved.archivedAt:edit.mode==='assessment'?groupOverviewInput.safeParse(saved.overview).success&&JSON.stringify(saved.overview)===JSON.stringify(inputValue.overview):saved.name===inputValue.name&&saved.description===inputValue.description);
      if(!valid)throw new InvalidResponseError(200,true,'保存结果不完整');
      persist(null);if(active.current){invalidateRequirementViews(client);onClose();}
    }catch(e){if(!active.current)return;setError((e as Error).message);const uncertain=isWriteOutcomeUnknown(e)||e instanceof ApiError&&e.status>=500;setUnknown(uncertain);if(!uncertain)persist(null);if(uncertain||requiresWriteRecheck(e)&&(!(e instanceof ApiError)||e.status!==409||e.code==='STALE_WRITE')){setBlocked(true);if(!uncertain)await read();}}
    finally{lock.current=false;if(active.current)setBusy(false);}
  };
  const title={basic:baseline?'编辑特性':'新建特性',assessment:'评估特性',archive:'归档特性',restore:'恢复特性',delete:'删除空特性'}[edit.mode];
  return <Modal title={title} onClose={onClose} closable={!busy}><form className="feature-form" onSubmit={e=>{e.preventDefault();void save();}}>
    <fieldset disabled={busy||unknown}>
      {edit.mode==='basic'&&<><label className="field"><span>特性名称</span><input required maxLength={200} value={value.name} onChange={e=>setValue({...value,name:e.target.value})}/></label><label className="field"><span>长期目标与范围</span><textarea aria-label="长期目标与范围" rows={5} maxLength={10000} value={value.description} onChange={e=>setValue({...value,description:e.target.value})}/></label></>}
      {edit.mode==='assessment'&&<>{(['expectation','progressSummary','note'] as const).map(field=><label className="field" key={field}><span>{{expectation:'大致预期',progressSummary:'进展简述',note:'原因或变化说明'}[field]}</span><textarea aria-label={{expectation:'大致预期',progressSummary:'进展简述',note:'原因或变化说明'}[field]} rows={3} maxLength={2000} value={value.overview[field]} onChange={e=>setValue({...value,overview:{...value.overview,[field]:e.target.value}})}/></label>)}<label className="field"><span>判断</span><select aria-label="判断" value={value.overview.assessment} onChange={e=>setValue({...value,overview:{...value.overview,assessment:e.target.value as RequirementGroup['overview']['assessment']}})}>{Object.entries(groupAssessmentLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label></>}
      {['archive','restore','delete'].includes(edit.mode)&&<p>{value.name}：{edit.mode==='archive'?'归档保留需求与规划关系；请先处理未完成需求。':edit.mode==='restore'?'恢复后可继续维护目标、评估和需求归属。':'仅能删除没有关联需求及规划关系的空特性。'}</p>}
    </fieldset>
    {error&&<p role="alert" className="warning-banner">{error}</p>}
    {blocked&&<div className="warning-banner">{unknown?'提交结果待核对。':'资料已变化。'}输入已保留。<button type="button" className="ghost-button" disabled={busy} onClick={()=>void read()}>读取最新资料</button></div>}
    {latest!==undefined&&<div className="feature-recheck"><h3>服务器上的最新资料</h3>{latest?<><p>{latest.name}{latest.archivedAt?'（已归档）':''}</p><p>{latest.description}</p><p>{latest.overview.expectation}</p><p>{latest.overview.progressSummary}</p><p>{groupAssessmentLabels[latest.overview.assessment]}</p><p>{latest.overview.note}</p></>:<p>未找到该特性。</p>}<button type="button" className="ghost-button" onClick={()=>{persist(null);if(unknown&&resolved||baseline&&!latest){invalidateRequirementViews(client);onClose();return;}setBaseline(latest||undefined);setLatest(undefined);setBlocked(false);setUnknown(false);}}>{unknown&&resolved?'已核对，操作已生效':baseline&&!latest?'完成核对并关闭':'保留输入，按最新资料继续'}</button></div>}
    <div className="form-actions"><button type="button" className="ghost-button" onClick={onClose} disabled={busy}>关闭</button><button className="primary-button" disabled={busy||blocked}>{busy?'处理中…':edit.mode==='assessment'?'保存评估':title}</button></div>
  </form></Modal>;
}
export function FeatureDetails({projectId,group,onEdit}:{projectId:string;group:GroupOverview;onEdit:(edit:FeatureEdit)=>void}) {
  const {session}=useSession(),manage=canManageProject(session,projectId);
  return <div className="feature-details"><div className="feature-detail-actions">{manage&&<>{!group.archivedAt&&<><button className="ghost-button" onClick={()=>onEdit({mode:'basic',group})}>编辑资料</button><button className="primary-button" onClick={()=>onEdit({mode:'assessment',group})}>更新评估</button></>}<button className="ghost-button" onClick={()=>onEdit({mode:group.archivedAt?'restore':'archive',group})}>{group.archivedAt?'恢复特性':'归档特性'}</button><button className="ghost-button danger-text" onClick={()=>onEdit({mode:'delete',group})}>删除空特性</button></>}</div>
    <dl className="feature-description"><dt>长期目标与范围</dt><dd>{group.description||'尚未填写'}</dd><dt>大致预期</dt><dd>{group.overview.expectation||'尚未填写'}</dd><dt>进展简述</dt><dd>{group.overview.progressSummary||'尚未填写'}</dd><dt>人工判断</dt><dd><FeatureAssessment group={group}/></dd><dt>原因或变化说明</dt><dd>{group.overview.note||'尚未填写'}</dd></dl>
    <small>{group.assessedAt?formatDateTime(group.assessedAt)+' · '+(group.assessedByName||'原评估人'):'尚未评估'}</small>
    <h3>当前执行事实</h3><div className="feature-facts">{Object.entries({completed:'已完成',inProgress:'进行中',delayed:'延期',unscheduled:'排期不完整',recentCompleted:'近七天完成'}).map(([key,label])=><span key={key}>{label} <strong>{group.counts[key as keyof GroupOverview['counts']]}</strong></span>)}</div>
    <h3>最近进展</h3>{group.recentUpdates.length?<ul className="feature-updates">{group.recentUpdates.map(u=><li key={u.id}><Link to={'/requirements/'+u.requirementId}>{u.requirementTitle}</Link><p>{u.content}</p><small>{formatDateTime(u.createdAt)}</small></li>)}</ul>:<p>暂无需求进展</p>}
    <div className="feature-detail-actions"><Link className="ghost-button" to={'/paths?view=feature&featureId='+encodeURIComponent(group.id)}>进入需求关系图</Link><Link className="ghost-button" to={'/requirements?group='+encodeURIComponent(group.id)}>{manage?'查看并整理需求':'查看需求'}</Link></div>
    <FeatureRequirementList key={group.id} projectId={projectId} featureId={group.id}/>
  </div>;
}
export function FeatureAssessment({group}:{group:RequirementGroup}) {return <span className={'feature-assessment assessment-'+group.overview.assessment}>{groupAssessmentLabels[group.overview.assessment]}</span>;}
export function FeatureRequirementList({projectId,featureId}:{projectId:string;featureId:string}) {
  const {session}=useSession(),[state,setState]=useState('current'),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(20);
  const query=useResourceQuery<FeatureRequirements>([...keys.featureRequirements,projectId,session.accountId,featureId,state,page,pageSize],'/api/projects/'+projectId+'/requirement-groups/'+encodeURIComponent(featureId)+'/requirements?'+new URLSearchParams({state,page:String(page),pageSize:String(pageSize)}),!!projectId);
  return <section className="feature-requirements"><div className="feature-detail-actions"><button className="ghost-button" aria-pressed={state==='current'} onClick={()=>{setState('current');setPage(1);}}>关联需求</button><button className="ghost-button" aria-pressed={state==='archived'} onClick={()=>{setState('archived');setPage(1);}}>已归档需求</button></div>{query.error&&<p role="alert">{query.error.message}</p>}{query.unavailable?<p>正在读取需求…</p>:<><ul>{query.data?.items.map(r=><li key={r.id}>{state==='current'?<Link to={'/requirements/'+r.id}>{r.title}</Link>:<span>{r.title}</span>}<StatusBadge kind="requirement" value={r.status}/>{r.deletedAt&&<small>归档于 {formatDateTime(r.deletedAt)}</small>}</li>)}</ul>{!query.data?.total&&<p>{state==='archived'?'暂无归档需求':'尚未关联需求'}</p>}<Pagination page={page} pageSize={pageSize} total={query.data?.total||0} onPageChange={setPage} onPageSizeChange={size=>{setPageSize(size);setPage(1);}} loading={query.isFetching}/></>}</section>;
}
