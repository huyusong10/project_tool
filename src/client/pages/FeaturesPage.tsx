import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useProjects, useSession } from '../app-context';
import { useResourceQuery } from '../use-resource-query';
import { keys, invalidateRequirementViews } from '../query-keys';
import { canManageProject } from '../permissions';
import { api, ApiError, InvalidResponseError, isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from '../api';
import type { GroupOverviewReport } from '../../shared/group-overview';
import { matchesSearch } from '../../shared/search';
import { FeatureDetails,FeatureAssessment,FeatureEditor,readFeaturePending,type FeatureEdit } from '../components/FeaturePlanning';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { useListPagination } from '../use-list-pagination';
import { SearchInput } from '../components/SearchInput';

export function FeaturesPage(){const {session}=useSession(),{selectedProjectId}=useProjects();return <FeaturePageContent key={(session.accountId||session.username)+selectedProjectId}/>;}
function FeaturePageContent() {
  const {selectedProjectId:projectId}=useProjects(),{session}=useSession(),client=useQueryClient(),[params,setParams]=useSearchParams();
  const account=session.accountId||session.username||'guest',manage=canManageProject(session,projectId),state=params.get('state')==='archived'?'archived':'active';
  const orderKey='pm-feature-order-write:'+account+':'+projectId;
  const [orderPending,setOrderPending]=useState(()=>{try{return sessionStorage.getItem(orderKey)||'';}catch{return '';}}),orderLock=useRef(false);
  const [edit,setEdit]=useState<FeatureEdit|null>(()=>readFeaturePending(account,projectId)),[error,setError]=useState(''),[busy,setBusy]=useState(false),[orderBlocked,setOrderBlocked]=useState(!!orderPending);
  useEffect(()=>{setEdit(manage?readFeaturePending(account,projectId):null);setError('');},[account,projectId,manage]);
  const query=useResourceQuery<GroupOverviewReport>([...keys.groupOverview,projectId,account,state],'/api/projects/'+projectId+'/group-overview?state='+state,!!projectId);
  useEffect(()=>{if(query.error instanceof ApiError&&[401,403,404].includes(query.error.status)){setEdit(null);setError('');}},[query.error]);
  const keyword=params.get('q')||'',groups=query.unavailable?[]:query.data?.groups||[],filtered=groups.filter(g=>matchesSearch([{text:g.name,weight:100},{text:g.description},{text:g.overview.expectation}],keyword));
  const pagination=useListPagination({items:filtered,id:'features',filterKey:state+keyword,ready:!query.unavailable,loading:query.isFetching});
  const selected=groups.find(g=>g.id===params.get('feature'));
  const setParam=(key:string,value:string)=>setParams(old=>{const next=new URLSearchParams(old);if(value)next.set(key,value);else next.delete(key);return next;});
  const reorder=async(id:string,direction:number)=>{
    if(orderLock.current||orderBlocked)return;orderLock.current=true;const group=groups.find(g=>g.id===id)!;setBusy(true);setError('');const intent=group.name+' → 顺序 '+(group.sortOrder+direction+1);setOrderPending(intent);try{sessionStorage.setItem(orderKey,intent);}catch{/* Current page retains the pending operation. */}
    try{const result=await api<{groups:unknown[]}>('/api/projects/'+projectId+'/requirement-groups',{method:'POST',body:jsonBody({id,name:group.name,sortOrder:Math.max(0,group.sortOrder+direction),expectedVersion:group.version})});if(!Array.isArray(result?.groups))throw new InvalidResponseError(200,true,'排序响应不完整');setOrderPending('');sessionStorage.removeItem(orderKey);invalidateRequirementViews(client);}catch(e){setError((e as Error).message);if(requiresWriteRecheck(e)||e instanceof ApiError&&e.status>=500)setOrderBlocked(true);if(!isWriteOutcomeUnknown(e)&&!(e instanceof ApiError&&e.status>=500)){setOrderPending('');sessionStorage.removeItem(orderKey);}}finally{orderLock.current=false;setBusy(false);}
  };
  return <><PageHeader title="特性规划"/><div className="page-content feature-page"><section className="panel paged-panel"><header className="feature-page-header"><p>长期目标、当前预期与人工判断</p><div className="feature-detail-actions"><button className="ghost-button" aria-label="刷新特性" disabled={query.isFetching} onClick={()=>void query.refetch()}>刷新</button><Link className="ghost-button" to="/paths">查看关系图</Link>{manage&&<button className="primary-button" onClick={()=>setEdit({mode:'basic'})}>新建特性</button>}</div></header>
    <div className="feature-toolbar"><SearchInput value={keyword} onChange={v=>setParam('q',v)} placeholder="搜索特性与目标"/><select aria-label="特性状态" value={state} onChange={e=>setParams(old=>{const next=new URLSearchParams(old);next.set('state',e.target.value);next.delete('feature');return next;})}><option value="active">当前特性</option><option value="archived">已归档</option></select><Link to="/requirements?group=ungrouped">未归属需求 {query.data?.ungroupedCount||0}</Link></div>
    {(query.error||error||orderPending)&&<div role="alert" className="warning-banner">{error||query.error?.message||'排序结果待核对：'+orderPending}<button className="ghost-button" disabled={query.isFetching} onClick={()=>void query.refetch().then(r=>{if(!r.error){setOrderBlocked(false);setOrderPending('');sessionStorage.removeItem(orderKey);setError('');}})}>读取最新资料并核对顺序</button></div>}
    {query.unavailable?<p>正在读取特性…</p>:<><div className="feature-grid" ref={pagination.scrollRef}>{pagination.items.map((g,index)=><article className="feature-card" key={g.id}><button className="feature-card-title" onClick={()=>setParam('feature',g.id)}>{g.name}</button><FeatureAssessment group={g}/><p className="feature-card-description">{g.description||'尚未填写长期目标与范围'}</p><div className="feature-card-expectation"><small>大致预期</small><p>{g.overview.expectation||'尚未填写'}</p></div><div className="feature-facts"><span>进行中 {g.counts.inProgress}</span><span>延期 {g.counts.delayed}</span><span>近七天完成 {g.counts.recentCompleted}</span></div>{!g.counts.total&&<small>尚未关联有效需求</small>}<footer><button className="ghost-button" onClick={()=>setParam('feature',g.id)}>查看详情</button>{manage&&state==='active'&&<div><button className="ghost-button" aria-label={'上移 '+g.name} disabled={busy||orderBlocked||index===0&&pagination.props.page===1||!!keyword} onClick={()=>void reorder(g.id,-1)}>↑</button><button className="ghost-button" aria-label={'下移 '+g.name} disabled={busy||orderBlocked||g.id===groups.at(-1)?.id||!!keyword} onClick={()=>void reorder(g.id,1)}>↓</button></div>}</footer></article>)}</div>{!filtered.length&&<p className="feature-empty">{keyword?'没有匹配的特性':state==='archived'?'暂无归档特性':'暂无特性。创建特性后，可以先记录目标，再逐步拆分需求。'}</p>}<Pagination {...pagination.props} label="特性分页"/></>}
  </section>{selected&&!edit&&<Modal title={selected.name} onClose={()=>setParam('feature','')}><FeatureDetails projectId={projectId} group={selected} onEdit={setEdit}/></Modal>}{edit&&manage&&!query.unavailable&&<FeatureEditor key={account+projectId+edit.mode+(edit.group?.id||'new')} projectId={projectId} edit={edit} onClose={()=>setEdit(null)}/>}</div></>;
}
