import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useSession } from '../app-context';
import { canManageProject } from '../permissions';
import { useResourceQuery } from '../use-resource-query';
import { keys,invalidateRequirementViews } from '../query-keys';
import { useDependencyDraft } from '../use-graph-draft';
import { useEditorInteraction } from '../use-editor-interaction';
import { editorAdapter } from '../editor-adapter';
import type { PathAnalysis,DiagramLayout } from '../../shared/paths';
import type { GraphCard,GraphLink } from '../../shared/path-projection';
import type { GroupOverviewReport } from '../../shared/group-overview';
import type { FeatureRelation } from '../../shared/features';
import { GraphWorkspace } from './GraphWorkspace';
import { PageHeader } from './PageHeader';
import { FeatureDetails,FeatureRequirementList,FeatureEditor,readFeaturePending,type FeatureEdit } from './FeaturePlanning';
import { FeatureRelationEditor,readRelationPending,type RelationEdit } from './FeatureRelationEditor';

type FeatureGraph = { projectId:string;revision:number;cards:GraphCard[];links:GraphLink[];overview:GroupOverviewReport;relations:FeatureRelation[];analysis:PathAnalysis;savedLayout:DiagramLayout };
export function FeaturePathPanel({projectId}:{projectId:string}) {
  const {session}=useSession(),[params]=useSearchParams(),featureId=params.get('view')==='feature'?params.get('featureId')||'ungrouped':'';
  const query=useResourceQuery<FeatureGraph>([...keys.featureGraph,projectId,session.accountId,featureId],'/api/projects/'+projectId+'/path-graph?'+new URLSearchParams(featureId?{view:'feature',featureId}:{view:'features'}),!!projectId);
  if(query.unavailable)return <><PageHeader title="路径分析"/><div className="page-content"><p>{query.error?.message||'正在读取特性关系…'}</p>{query.error&&<button className="ghost-button" onClick={()=>void query.refetch()}>重新读取</button>}</div></>;
  return <FeaturePathWorkspace key={(session.accountId||'guest')+projectId+featureId} graph={query.data!} featureId={featureId} refreshError={query.error?.message}/>;
}
function FeaturePathWorkspace({graph,featureId,refreshError}:{graph:FeatureGraph;featureId:string;refreshError?:string}) {
  const {session}=useSession(),account=session.accountId||session.username||'guest',projectId=graph.projectId,client=useQueryClient(),[params,setParams]=useSearchParams();
  const manage=canManageProject(session,projectId),[planning,setPlanning]=useState(true),[actual,setActual]=useState(true);
  const [edit,setEdit]=useState<FeatureEdit|null>(()=>readFeaturePending(account,projectId)),[relation,setRelation]=useState<RelationEdit|null>(()=>readRelationPending(account,projectId)?.value||null);
  useEffect(()=>{if(!manage){setEdit(null);setRelation(null);}},[manage]);
  const draft=useDependencyDraft(account,graph.analysis,'project',()=>invalidateRequirementViews(client),'feature-layouts');
  const scope=featureId?'feature:'+featureId:'features',viewKey=account+':'+projectId+':'+scope;
  const selectionKey='pm-graph-view:'+viewKey+':selection';
  const [savedSelection]=useState(()=>{try{return JSON.parse(sessionStorage.getItem(selectionKey)||'{}') as {node?:string;edge?:string};}catch{return {};}});
  const {interaction,selected,edgeId,select}=useEditorInteraction(params.get('node')||savedSelection.node||'',selection=>{try{sessionStorage.setItem(selectionKey,JSON.stringify({node:selection.kind==='nodes'?selection.primary:'',edge:selection.kind==='edge'?selection.id:''}));}catch{/* Selection is retained in the URL. */}setParams(old=>{const next=new URLSearchParams(old);next.delete('node');next.delete('edge');if(selection.kind==='nodes')next.set('node',selection.primary);if(selection.kind==='edge')next.set('edge',selection.id);return next;},{replace:true});},params.get('edge')||savedSelection.edge||'');
  const links=useMemo(()=>graph.links.flatMap(e=>{if(featureId)return [e];const dependencyIds=actual?e.dependencyIds:[],planningRelationIds=planning?e.planningRelationIds||[]:[];if(!dependencyIds.length&&!planningRelationIds.length)return [];return [{...e,dependencyIds,planningRelationIds,planningOnly:!dependencyIds.length,label:[planningRelationIds.length?'规划':'',dependencyIds.length?dependencyIds.length+' 条实际依赖':''].filter(Boolean).join(' · ')}];}),[graph.links,planning,actual,featureId]);
  const card=graph.cards.find(c=>c.id===selected),edge=links.find(e=>e.id===edgeId),group=graph.overview.groups.find(g=>g.id===card?.featureId);
  const focused=graph.overview.groups.find(g=>g.id===featureId),layout=draft.changes.layouts?.find(l=>l.scope===scope)||graph.savedLayout;
  const commands=editorAdapter({move:positions=>draft.change({...draft.changes,layouts:[...(draft.changes.layouts||[]).filter(l=>l.scope!==scope),{scope,direction:'right',positions:{...(graph.analysis.layouts?.find(l=>l.scope===scope&&l.direction==='right')?.positions||graph.savedLayout.positions),...positions},expectedVersion:graph.savedLayout.version}]}),save:()=>{if(manage)void draft.save();},undo:draft.undo,redo:draft.redo,...(!featureId?{connect:(source:string,target:string)=>setRelation({sourceFeatureId:source.slice(8),targetFeatureId:target.slice(8),note:''})}:{})},manage&&!draft.pending);
  const relationName=(id:string)=>graph.overview.groups.find(g=>g.id===id)?.name||id;
  const detail=card||edge?<><div className="graph-panel-heading"><h3>{card?.title||'关系详情'}</h3><button className="ghost-button" onClick={()=>select('')}>关闭</button></div>{group?<FeatureDetails projectId={projectId} group={group} onEdit={setEdit}/>:card?.featureId==='ungrouped'?<><Link to="/requirements?group=ungrouped">查看并整理需求</Link><Link className="ghost-button" to="/paths?view=feature&featureId=ungrouped">进入需求关系图</Link><FeatureRequirementList projectId={projectId} featureId="ungrouped"/></>:card?.archived?<p>归档需求 · {card.title}</p>:card?.requirementId?<><p>{card.subtitle}</p><Link className="primary-button" to={'/requirements/'+card.requirementId+'?view=path'} state={{featureReturn:'/paths?'+params.toString()}}>进入需求路径</Link><Link className="ghost-button" to={'/requirements/'+card.requirementId}>查看需求详情</Link></>:card?<p>{card.subtitle}</p>:null}
    {edge&&<><h3>人工规划</h3>{edge.planningRelationIds?.length?edge.planningRelationIds.map(id=>{const r=graph.relations.find(r=>r.id===id)!;return <div key={id}><p>{relationName(r.sourceFeatureId)} → {relationName(r.targetFeatureId)}</p><p>{r.note||'尚未填写关系说明'}</p>{manage&&<button className="ghost-button" onClick={()=>setRelation(r)}>编辑规划关系</button>}</div>}):<p>没有人工规划关系</p>}<h3>实际依赖</h3>{edge.dependencyIds.length?edge.dependencyIds.map(id=>{const d=graph.analysis.dependencies.find(d=>d.id===id)!;const label=(req:string,milestone?:string|null)=>graph.analysis.requirements.find(r=>r.id===req)?.title||graph.analysis.nodes.find(n=>n.id===milestone||n.requirementId===req)?.title||'历史交付';return <p key={id}><Link to={'/paths?view=project&pathRelation='+encodeURIComponent(id)+'&pathInspector=open&pathScope=all'}>{label(d.sourceRequirementId,d.sourceMilestoneId)} → {label(d.targetRequirementId,d.targetMilestoneId)}</Link></p>}):<p>尚无需求实际依赖</p>}</>}
  </>:undefined;
  return <div className="feature-path"><PageHeader title="路径分析" actions={<>{manage&&<><button className="ghost-button" onClick={()=>setEdit({mode:'basic'})}>新建特性</button>{!featureId&&<button className="ghost-button" onClick={()=>setRelation({})}>建立规划关系</button>}<button className="primary-button" disabled={draft.busy||!draft.count&&!draft.pending} onClick={()=>void draft.save()}>{draft.pending?'核对布局提交':'保存布局'}</button></>}</>}/>
    <div className="feature-path-bar"><Link to="/paths">特性关系图</Link>{featureId&&<><span>›</span><span>{focused?.name||'未归属需求'}</span></>}<span className="feature-path-spacer"/><Link to={focused?'/features?'+new URLSearchParams({feature:focused.id,...(focused.archivedAt?{state:'archived'}:{})}):'/features'}>特性规划</Link><Link to="/paths?view=project">全部需求</Link>{!featureId&&<><label><input type="checkbox" checked={planning} onChange={e=>setPlanning(e.target.checked)}/>规划关系</label><label><input type="checkbox" checked={actual} onChange={e=>setActual(e.target.checked)}/>实际依赖</label></>}</div>
    {(refreshError||draft.error||draft.conflict)&&<div role="alert" className="warning-banner feature-path-error">{refreshError||draft.error?.message||'共享布局已变化，已保留移动位置。'}{draft.conflict&&<><button className="ghost-button" onClick={()=>{for(const conflict of draft.conflicts)draft.resolveConflict(conflict.key,'draft');draft.rebase();}}>保留布局并核对最新版本</button><button className="ghost-button" onClick={()=>draft.cancel()}>使用服务器布局</button></>}</div>}
    <GraphWorkspace document={draft} commands={commands} interaction={interaction} cards={graph.cards} links={links} viewKey={viewKey} positions={layout.positions} editing={manage&&!draft.pending} validateConnection={(source,target)=>{const a=graph.cards.find(c=>c.id===source),b=graph.cards.find(c=>c.id===target);return !a?.featureId||!b?.featureId||a.archived||b.archived||a.featureId==='ungrouped'||b.featureId==='ungrouped'?{message:'规划关系只能连接当前特性'}:null;}} toolbar={null} detail={detail} onDismissDetail={()=>select('')} footer={<span>{featureId?'需求实际依赖':'虚线：人工规划 · 实线：实际依赖'} · {graph.cards.length} 个节点{draft.count?' · 布局未保存':''}</span>}/>
    {edit&&manage&&<FeatureEditor projectId={projectId} edit={edit} onClose={()=>setEdit(null)}/>} {relation&&manage&&<FeatureRelationEditor projectId={projectId} groups={graph.overview.groups} initial={relation} onClose={()=>setRelation(null)}/>}
  </div>;
}
