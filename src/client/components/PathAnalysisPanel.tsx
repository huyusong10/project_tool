import { lazy, Suspense, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, jsonBody, requiresWriteRecheck } from '../api';
import { useSession } from '../app-context';
import { useResourceQuery } from '../use-resource-query';
import { invalidateRequirementViews, keys } from '../query-keys';
import { canManageProject } from '../permissions';
import type { Requirement } from '../types';
import { acceptanceId, type PathAnalysis, type PathNode } from '../../shared/paths';
import { addBusinessDays, riskLabels, todayIso } from '../../shared/domain';
import { hasWorkdayCalendarFallback } from '../../shared/workday';
import { projectPathGraph } from '../path-projection';
import { Modal } from './Modal';
import { EmptyState, LoadingState } from './Feedback';
import { FormError } from './Form';
import '../paths.css';
const DependencyGraph=lazy(()=>import('./DependencyGraph').then(m=>({default:m.DependencyGraph})));
type PlanPreview={requirementId:string;projectId:string;baseStart:string;expectedRevision:number;previewToken:string;applicable:boolean;entries:Array<{workItemId:string;requirementId:string;title:string;currentStart:string|null;currentEnd:string|null;proposedStart:string|null;proposedEnd:string|null;reasons:string[]}>};
type Editor = {kind:'relation'}|{kind:'estimate';node:PathNode}|{kind:'review'}|{kind:'plan'}|{kind:'acceptance'};

function PathEditor({editor,data,requirement,manager,onClose,onReload}:{editor:Editor;data:PathAnalysis;requirement?:Requirement;manager:boolean;onClose:()=>void;onReload:()=>Promise<PathAnalysis>}) {
  const client=useQueryClient(), [baseline,setBaseline]=useState(data.revision),[needsCheck,setNeedsCheck]=useState(false),[reloadError,setReloadError]=useState(''),[preview,setPreview]=useState<PlanPreview|null>(null);
  const [sourceReq,setSourceReq]=useState(requirement?.id||data.requirements[0]?.id||''),[targetReq,setTargetReq]=useState(requirement?.id||data.requirements[1]?.id||data.requirements[0]?.id||'');
  const [sourceWork,setSourceWork]=useState(''),[targetWork,setTargetWork]=useState('');
  const estimate=editor.kind==='estimate'?editor.node.estimate:null;
  const [duration,setDuration]=useState(String(estimate?.durationDays??(editor.kind==='estimate'?Math.max(1,editor.node.remainingDays):1))),[earliest,setEarliest]=useState(estimate?.earliestStart||'');
  const [unblock,setUnblock]=useState(estimate?.unblockEstimate||''),[forecast,setForecast]=useState(estimate?.forecastEnd||'');
  const [acceptance,setAcceptance]=useState(data.requirements.find(r=>r.id===requirement?.id)?.forecastAcceptance||'');
  const [baseStart,setBaseStart]=useState(addBusinessDays(todayIso(),0));
  const stale=baseline!==data.revision||needsCheck;
  const {session}=useSession();
  const canEditStructure=manager||!!requirement&&requirement.ownerId===session.personId;
  const mutation=useMutation({mutationFn:async ({url,body,method='POST'}:{url:string;body:unknown;method?:string})=>api(url,{method,body:jsonBody(body)}),onSuccess:()=>{invalidateRequirementViews(client,requirement?.id);onClose();},onError:(error)=>{if(requiresWriteRecheck(error))setNeedsCheck(true);}});
  const planning=useMutation({mutationFn:()=>api<PlanPreview>(`/api/requirements/${requirement!.id}/dependency-plan/preview`,{method:'POST',body:jsonBody({baseStart,expectedRevision:baseline})}),onSuccess:setPreview});
  const options=data.requirements.filter(r=>manager||r.id===requirement?.id);
  const submit=()=>{
    if(stale)return;
    const version={expectedRevision:baseline};
    if(editor.kind==='relation') mutation.mutate({url:`/api/projects/${data.projectId}/dependencies`,body:{...version,sourceRequirementId:sourceReq,sourceWorkItemId:sourceWork||null,targetRequirementId:targetReq,targetWorkItemId:targetWork||null}});
    if(editor.kind==='estimate') mutation.mutate({url:`/api/work-items/${editor.node.id}/path-estimate`,method:'PATCH',body:{...version,...canEditStructure?{durationDays:Number(duration),earliestStart:earliest||null}:{},unblockEstimate:unblock||null,forecastEnd:forecast||null}});
    if(editor.kind==='review') mutation.mutate({url:`/api/requirements/${requirement!.id}/dependency-review`,body:{...version,reviewed:true}});
    if(editor.kind==='acceptance') mutation.mutate({url:`/api/requirements/${requirement!.id}/dependency-review`,body:{...version,forecastAcceptance:acceptance||null}});
    if(editor.kind==='plan'&&preview) mutation.mutate({url:`/api/requirements/${requirement!.id}/dependency-plan/apply`,body:{baseStart,expectedRevision:baseline,previewToken:preview.previewToken}});
  };
  const labels={relation:'配置交付前置',estimate:'工期与交付预测',review:'核对需求依赖',plan:'按依赖预览排期',acceptance:'预计验收日期'};
  return <Modal title={labels[editor.kind]} width={editor.kind==='plan'?880:660} closable={!mutation.isPending} onClose={onClose}>
    <form className="path-editor" onSubmit={e=>{e.preventDefault();submit();}}><fieldset disabled={mutation.isPending}>
      {stale&&<div className="warning-banner">数据或操作结果需要重新核对，已填内容保留。<button type="button" className="ghost-button" onClick={()=>void onReload().then(latest=>{setBaseline(latest.revision);setNeedsCheck(false);setPreview(null);setReloadError('');}).catch(error=>setReloadError(error.message))}>重新读取并核对</button></div>}
      {editor.kind==='relation'&&<><p>前置完成后，后续工作才具备开始条件。多个前置必须全部满足。</p>
        <div className="path-form-grid">{(['source','target'] as const).map(side=>{
          const source=side==='source',reqId=source?sourceReq:targetReq;
          return <div key={side}><label className="field"><span>{source?'前置需求':'后续需求'}</span><select aria-label={source?'前置需求':'后续需求'} value={reqId} onChange={e=>{if(source){setSourceReq(e.target.value);setSourceWork('');}else{setTargetReq(e.target.value);setTargetWork('');}}}>{options.map(r=><option value={r.id} key={r.id}>{r.title}</option>)}</select></label>
            <label className="field"><span>{source?'交付点':'开始条件'}</span><select aria-label={source?'前置交付点':'后续工作'} value={source?sourceWork:targetWork} onChange={e=>source?setSourceWork(e.target.value):setTargetWork(e.target.value)}><option value="">{source?'整需求验收完成':'整个需求开始'}</option>{data.nodes.filter(n=>n.requirementId===reqId&&n.kind==='work').map(n=><option key={n.id} value={n.id}>{n.title}</option>)}</select></label></div>;
        })}</div></>}
      {editor.kind==='estimate'&&<><p>{editor.node.title}</p><div className="path-form-grid">{canEditStructure&&<><label className="field"><span>预计工期（工作日）</span><input type="number" min={1} max={3660} value={duration} onChange={e=>setDuration(e.target.value)} required/></label><label className="field"><span>最早开始（可选约束）</span><input type="date" value={earliest} onChange={e=>setEarliest(e.target.value)}/></label></>}
        <label className="field"><span>预计解除阻塞</span><input type="date" min={data.asOfDate} value={unblock} onChange={e=>setUnblock(e.target.value)}/></label><label className="field"><span>人工预测完成</span><input type="date" min={data.asOfDate} value={forecast} onChange={e=>setForecast(e.target.value)}/></label></div><p className="field-help">日期可留空。缺少解阻时间时，受影响交付保持待确认。修改预测不自动改写计划。</p></>}
      {editor.kind==='review'&&<><p>请核对本需求全部工作项，以及下方关系明细。确认后，没有前置关系的工作项按独立工作处理。</p><ul>{data.dependencies.filter(d=>d.targetRequirementId===requirement!.id).map(d=><li key={d.id}>{data.nodes.find(n=>n.id===(d.sourceWorkItemId||acceptanceId(d.sourceRequirementId)))?.title} → {d.targetWorkItemId?data.nodes.find(n=>n.id===d.targetWorkItemId)?.title:'整个需求开始'}</li>)}</ul><p>本次确认不改动已保存的计划日期。</p></>}
      {editor.kind==='acceptance'&&<label className="field"><span>预计验收日期</span><input type="date" min={data.asOfDate} value={acceptance} onChange={e=>setAcceptance(e.target.value)}/><small>留空表示日期待确认；不代替真正的验收操作。</small></label>}
      {editor.kind==='plan'&&<><label className="field"><span>需求开始锚点</span><input type="date" min={data.asOfDate} value={baseStart} onChange={e=>{setBaseStart(e.target.value);setPreview(null);}} required/></label><button type="button" className="ghost-button" disabled={stale||planning.isPending} onClick={()=>planning.mutate()}>生成差异预览</button>
        {preview&&<div className="path-table-scroll"><table><thead><tr><th>工作项</th><th>当前计划</th><th>建议计划</th></tr></thead><tbody>{preview.entries.map(e=><tr key={e.workItemId}><td>{e.title}</td><td>{e.currentStart||'—'} ～ {e.currentEnd||'—'}</td><td>{e.proposedStart&&e.proposedEnd?`${e.proposedStart} ～ ${e.proposedEnd}`:e.reasons.join('；')}</td></tr>)}</tbody></table><p>涉及 {new Set(preview.entries.map(e=>e.requirementId)).size} 个需求，只调整未开始工作。</p></div>}</>}
      <FormError>{mutation.error?.message||planning.error?.message||reloadError}</FormError>
      <div className="button-row"><button type="button" className="ghost-button" onClick={onClose}>取消</button><button className="primary-button" disabled={stale||mutation.isPending||(editor.kind==='plan'&&!preview?.applicable)}>{mutation.isPending?'保存中…':editor.kind==='review'?'确认已核对':editor.kind==='plan'?'应用以上计划':'保存'}</button></div>
    </fieldset></form>
  </Modal>;
}

export function PathAnalysisPanel({projectId,requirement}:{projectId:string;requirement?:Requirement}) {
  const [params,setParams]=useSearchParams(),navigate=useNavigate(),location=useLocation(),client=useQueryClient(),{session}=useSession();
  const focus=requirement?.id, target=focus?(params.get('target')||acceptanceId(focus)):'project';
  const selected=params.get('pathNode')||params.get('workItemId')||'',attention=params.get('pathScope')!=='all',search=params.get('pathSearch')||'',floatFilter=params.get('pathFloat')||'';
  const [editor,setEditor]=useState<Editor|null>(null),[removeId,setRemoveId]=useState<{id:string;revision:number}|null>(null);
  const query=useResourceQuery<PathAnalysis>([...keys.paths,projectId,focus||'all',target],focus?`/api/requirements/${focus}/path-analysis?target=${encodeURIComponent(target)}`:`/api/projects/${projectId}/path-analysis`,!!projectId);
  const data=query.data,manager=canManageProject(session,projectId),canEdit=manager||!!requirement&&requirement.ownerId===session.personId;
  const setParam=(name:string,value:string)=>{const next=new URLSearchParams(params);if(value)next.set(name,value);else next.delete(name);setParams(next,{replace:true,state:location.state});};
  const graph=useMemo(()=>data?projectPathGraph(data,focus,!focus&&attention):{cards:[],links:[]},[data,focus,attention]);
  const filtered=useMemo(()=>{
    if(!search&&!floatFilter)return graph;
    const keep=new Set(graph.cards.filter(c=>(!search||`${c.title} ${c.subtitle}`.toLowerCase().includes(search.toLowerCase()))&&(!floatFilter||(floatFilter==='unknown'?c.floatDays===null:floatFilter==='critical'?c.floatDays===0:floatFilter==='near'?c.floatDays!==null&&c.floatDays>0&&c.floatDays<=2:c.floatDays!==null&&c.floatDays>2))).map(c=>c.id));
    return {cards:graph.cards.filter(c=>keep.has(c.id)).map(c=>({...c,hiddenCount:c.hiddenCount+graph.links.filter(e=>(e.source===c.id&&!keep.has(e.target))||(e.target===c.id&&!keep.has(e.source))).length})),links:graph.links.filter(e=>keep.has(e.source)&&keep.has(e.target))};
  },[graph,search,floatFilter]);
  const mutation=useMutation({mutationFn:({id,revision}:{id:string;revision:number})=>api(`/api/dependencies/${id}`,{method:'DELETE',body:jsonBody({expectedRevision:revision})}),onSuccess:()=>{setRemoveId(null);invalidateRequirementViews(client,focus);},onError:()=>void query.refetch()});
  if(query.isLoading)return <LoadingState label="正在分析交付依赖…"/>;
  if(query.unavailable||!data)return <EmptyState title="路径分析暂不可用" detail={query.error?.message||'请选择项目'} action={<button className="ghost-button" onClick={()=>void query.refetch()}>重新加载</button>}/>;
  const selectedCard=graph.cards.find(c=>c.id===selected),selectedNode=data.nodes.find(n=>n.id===selected),risk=selectedCard?data.risks[selectedCard.requirementId]:null;
  const eligible=data.requirements.filter(r=>!['completed','cancelled','planning'].includes(r.status));
  const directTo=(requirementId:string,workItemId?:string|null)=>{
    const queryParams=new URLSearchParams({view:'path',target});if(workItemId)queryParams.set('workItemId',workItemId);
    navigate(`/requirements/${requirementId}?${queryParams}`,{state:{pathReturn:focus?(location.state as {pathReturn?:string}|null)?.pathReturn||'/paths':`${location.pathname}${location.search}`}});
  };
  const returnPath=(location.state as {pathReturn?:string}|null)?.pathReturn;
  const req=data.requirements.find(r=>r.id===focus);
  const visibleLinks=data.dependencies.filter(d=>focus?(d.sourceRequirementId===focus||d.targetRequirementId===focus):d.sourceRequirementId!==d.targetRequirementId);
  const workSelection=selectedNode&&requirement?.workItems.find(w=>w.id===selectedNode.id);
  const canEstimate=!!workSelection&&!['completed','cancelled'].includes(workSelection.status)&&(canEdit||!!session.personId&&workSelection.assigneeIds.includes(session.personId));
  return <div className={`path-analysis${focus?' requirement-path-analysis':''}`}>
    {query.error&&<div className="warning-banner">刷新失败，当前展示 {data.asOfDate} 的已读取结果。<button className="ghost-button" onClick={()=>void query.refetch()}>重试</button></div>}
    <div className="path-toolbar"><div>{focus?<label>分析目标 <select aria-label="分析目标" value={target} onChange={e=>setParam('target',e.target.value)}><option value={acceptanceId(focus)}>本需求验收</option><option value="project">项目交付</option>{target!=="project"&&target!==acceptanceId(focus)&&!data.nodes.some(n=>n.id===target&&n.requirementId===focus&&n.milestoneLabel)&&<option value={target}>来源目标：{data.targetLabel}</option>}{data.nodes.filter(n=>n.requirementId===focus&&n.milestoneLabel).map(n=><option key={n.id} value={n.id}>{n.milestoneLabel}</option>)}</select></label>:<strong>当前项目 · 全部需求的交付依赖</strong>}</div>
      <div className="button-row">{focus&&<Link className="ghost-button" to={returnPath?.startsWith('/paths')?returnPath:'/paths'}>返回全局分析</Link>}{canEdit&&<button className="ghost-button" onClick={()=>setEditor({kind:'relation'})}>配置前置</button>}{focus&&canEdit&&!req?.dependenciesReviewedAt&&<button className="primary-button" onClick={()=>setEditor({kind:'review'})}>核对依赖</button>}{focus&&manager&&<button className="ghost-button" onClick={()=>setEditor({kind:'plan'})}>预览排期</button>}<button className="ghost-button" disabled={query.isFetching} onClick={()=>void query.refetch()}>刷新</button></div>
    </div>
    <div className="path-summary"><div><small>分析目标</small><strong>{data.targetLabel}</strong></div><div><small>目标日期</small><strong>{data.targetDate||'未设日期'}</strong></div><div><small>预计完成</small><strong>{data.forecastEnd||(!focus&&!eligible.length?'暂无待交付目标':'待确认')}</strong></div><div><small>交付差额</small><strong className={data.deadlineSlack!==null&&data.deadlineSlack<0?'danger-text':''}>{data.deadlineSlack===null?'待确认':data.deadlineSlack<0?`预计延期 ${-data.deadlineSlack} 天`:`尚余 ${data.deadlineSlack} 天`}</strong></div></div>
    {hasWorkdayCalendarFallback([data.targetDate,data.forecastEnd])&&<p role="status" className="path-coverage">部分日期超出法定工作日日历覆盖范围，将按周一至周五计算。</p>}
    {(!data.complete||data.coverage.reviewed<data.coverage.total||data.coverage.unplanned>0)&&<div className="path-coverage">已核对 {data.coverage.reviewed}/{data.coverage.total} 个需求；{data.coverage.unplanned} 个待规划。{!data.complete?'存在待确认条件，当前日期与余量分析不完整。':'预测仅覆盖已纳入计划的目标。'}</div>}
    {!focus&&<section className="path-float-distribution" aria-label="需求余量分布">{[{key:'critical',label:'0 天',test:(f:number|null)=>f===0},{key:'near',label:'1—2 天',test:(f:number|null)=>f!==null&&f>0&&f<=2},{key:'other',label:'大于 2 天',test:(f:number|null)=>f!==null&&f>2},{key:'unknown',label:'待确认',test:(f:number|null)=>f===null}].map(bucket=>{const cards=projectPathGraph(data,undefined,false).cards.filter(c=>!['completed','cancelled'].includes(c.status));const count=cards.filter(c=>bucket.test(c.floatDays)).length;return <button key={bucket.key} className={floatFilter===bucket.key?'selected':''} onClick={()=>setParam('pathFloat',floatFilter===bucket.key?'':bucket.key)}><span>{bucket.label}<strong>{count} 个需求</strong></span><i style={{width:`${100*count/Math.max(1,cards.length)}%`}}/></button>;})}</section>}
    <div className="path-filters"><input aria-label="筛选图中节点" value={search} placeholder={focus?'查找工作项或负责人':'查找需求或负责人'} onChange={e=>setParam('pathSearch',e.target.value)}/>{!focus&&<select aria-label="图显示范围" value={attention?'attention':'all'} onChange={e=>setParam('pathScope',e.target.value)}><option value="attention">关键与异常范围</option><option value="all">全部需求</option></select>}<select aria-label="按余量筛选" value={floatFilter} onChange={e=>setParam('pathFloat',e.target.value)}><option value="">全部余量</option><option value="critical">0 天</option><option value="near">1—2 天</option><option value="other">大于 2 天</option><option value="unknown">待确认</option></select><small>粗线：当前目标关键关系 · 风险标签：项目风险 · 筛选不改变计算</small></div>
    {filtered.cards.length?<Suspense fallback={<LoadingState label="加载依赖图…"/>}><DependencyGraph cards={filtered.cards} links={filtered.links} selected={selected} onSelect={id=>setParam('pathNode',id)} viewKey={`${session.accountId}:${projectId}:${focus||'all'}`}/></Suspense>:<EmptyState title="当前范围没有可显示节点" detail="调整筛选条件或配置工作项及前置关系。"/>}
    <div className="path-content-grid"><section className="path-detail"><h3>{selectedCard?.title||'选择节点查看交付条件'}</h3>{selectedCard&&<><p>{selectedCard.subtitle}</p><p>{risk?.riskReason}</p><p>{selectedNode?.source}</p>{selectedNode?.unknownReasons.length?<p className="danger-text">{selectedNode.unknownReasons.join('；')}</p>:null}<div className="button-row">{(!focus||selectedCard.external)&&<button className="primary-button" onClick={()=>directTo(selectedCard.requirementId,selectedCard.workItemId)}>进入需求路径</button>}{focus&&selectedNode?.workItemId&&selectedNode.requirementId===focus&&<button className="ghost-button" onClick={()=>{const p=new URLSearchParams(params);p.delete('view');p.set('workItemId',selectedNode.id);setParams(p,{state:location.state});}}>定位并处理工作项</button>}{canEstimate&&<button className="ghost-button" onClick={()=>setEditor({kind:'estimate',node:selectedNode!})}>工期与预测</button>}{focus&&manager&&selectedNode?.kind==='acceptance'&&selectedNode.requirementId===focus&&<button className="ghost-button" onClick={()=>setEditor({kind:'acceptance'})}>预计验收日期</button>}</div></>}</section>
      <section className="path-blockers"><h3>阻塞源排行 <small>{data.blockers.length} 项</small></h3>{!data.blockers.length?<p className="field-help">当前没有需要处理的阻塞源。</p>:data.blockers.slice(0,20).map(b=><button className="path-blocker" key={b.nodeId} onClick={()=>{if(!focus)setParam('pathNode',b.requirementId);else if(graph.cards.some(c=>c.id===b.nodeId))setParam('pathNode',b.nodeId);else directTo(b.requirementId,b.workItemId);}}><span><strong>{b.title}</strong><small>{b.reasons.join('；')} · {b.ownerName||'未分派'}</small><span className="path-impact-bar"><i style={{width:`${Math.max(4,b.affectedRequirementIds.length/Math.max(1,data.coverage.total)*100)}%`}}/></span></span><span>{b.affectedRequirementIds.length} 个下游需求{b.critical&&<small>关键阻塞源</small>}</span></button>)}</section></div>
    <section className="path-list"><h3>节点列表 <small>{filtered.cards.length} / {graph.cards.length}</small></h3><div className="path-node-list">{filtered.cards.map(c=><button key={c.id} className={selected===c.id?'selected':''} onClick={()=>setParam('pathNode',c.id)}><span>{c.title}</span><small>{c.forecast||'待确认'} · {riskLabels[c.risk as keyof typeof riskLabels]||'待评估'}{c.critical?' · 关键':''}{c.hiddenCount?` · 隐藏 ${c.hiddenCount} 条关系`:''}</small></button>)}</div></section>
    <section className="path-relations"><h3>关系明细 <small>{visibleLinks.length} 条</small></h3>{!visibleLinks.length?<p className="field-help">尚未配置{focus?'前置关系':'跨需求依赖'}。</p>:visibleLinks.map(d=>{
      const source=data.nodes.find(n=>n.id===(d.sourceWorkItemId||acceptanceId(d.sourceRequirementId))),targetNode=data.nodes.find(n=>n.id===(d.targetWorkItemId||`start:${d.targetRequirementId}`));
      return <div className="path-relation" key={d.id}><button onClick={()=>focus?setParam('pathNode',targetNode!.id):directTo(d.targetRequirementId,d.targetWorkItemId)}>{source?.title} → {targetNode?.title}<small>{d.origin==='template'?'继承模板':'本需求调整'} · {d.sourceWorkItemId||d.targetWorkItemId?'部分交付':'整需求依赖'}</small></button>{(manager||canEdit&&d.sourceRequirementId===focus&&d.targetRequirementId===focus)&&<button className="ghost-button" onClick={()=>setRemoveId({id:d.id,revision:data.revision})}>移除</button>}</div>;
    })}</section>
    {editor&&<PathEditor key={`${editor.kind}:${editor.kind==='estimate'?editor.node.id:''}`} editor={editor} data={data} requirement={requirement} manager={manager} onClose={()=>setEditor(null)} onReload={async()=>{const result=await query.refetch({throwOnError:true});return result.data!;}}/>}
    {removeId&&<Modal title="移除依赖" width={500} onClose={()=>setRemoveId(null)}><p>移除后重新计算路径和预测，计划日期保持原值。</p>{removeId.revision!==data.revision&&<p className="form-error">依赖或进度已变化，请关闭后重新核对这条关系。</p>}<FormError>{mutation.error?.message}</FormError><div className="button-row"><button className="ghost-button" onClick={()=>setRemoveId(null)}>取消</button><button className="primary-button" disabled={mutation.isPending||removeId.revision!==data.revision} onClick={()=>mutation.mutate(removeId)}>确认移除</button></div></Modal>}
  </div>;
}
