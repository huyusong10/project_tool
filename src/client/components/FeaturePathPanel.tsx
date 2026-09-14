import {Select} from './Select';
import {useEffect,useMemo,useState,useRef} from 'react';
import {flushSync} from 'react-dom';
import {useQueryClient} from '@tanstack/react-query';
import {Link2,Check} from 'lucide-react';
import {useSession} from '../app-context';
import {canManageProject} from '../permissions';
import {useResourceQuery} from '../use-resource-query';
import {keys,invalidateRequirementViews} from '../query-keys';
import {useDependencyDraft,clearProjectGraphDrafts} from '../use-graph-draft';
import {useEditorInteraction} from '../use-editor-interaction';
import {useWorkspaceParams} from '../use-workspace-view';
import {editorAdapter} from '../editor-adapter';
import {draftNetwork} from '../dependency-draft';
import {requirementCanvasUrl,useCanvasNavigation} from '../canvas-navigation';
import {randomUUID} from '../random-uuid';
import {api,ApiError} from '../api';
import {featurePathGraph} from '../../shared/feature-projection';
import type {PathAnalysis} from '../../shared/paths';
import type {FeatureRelationChange} from '../../shared/features';
import {GraphWorkspace} from './GraphWorkspace';
import {PageHeader} from './PageHeader';
import {EditorToolbar} from './EditorToolbar';
import {EditorField} from './EditorField';
import {canvasNavigation} from './CanvasNavigation';
import {CanvasDraftDetails} from './CanvasDraftDetails';

import {FeatureEditor,readFeaturePending,type FeatureEdit} from './FeaturePlanning';
import {DeliveryFeatureDetails} from './DeliveryFeatureDetails';
import {FeatureTable,DeliveryFilters,matchesDeliveryFeature} from './DeliveryTables';
import {Modal} from './Modal';
import {SearchInput} from './SearchInput';
import './feature-planning.css';

export function FeaturePathPanel({projectId}:{projectId:string}) {
  const {session}=useSession();
  const query=useResourceQuery<{analysis:PathAnalysis}>([...keys.featureGraph,projectId,session.accountId,'features'],'/api/projects/'+projectId+'/path-graph?view=features',!!projectId);
  useEffect(()=>{if(query.error instanceof ApiError&&[401,403].includes(query.error.status))clearProjectGraphDrafts(session.accountId||'guest',projectId);},[query.error,session.accountId,projectId]);
  if(query.unavailable||!query.data)return <><PageHeader title="项目交付"/><div className="page-content"><p>{query.error?.message||'正在读取特性关系…'}</p>{query.error&&<button className="ghost-button" onClick={()=>void query.refetch()}>重新读取</button>}</div></>;
  return <FeatureWorkspace key={(session.accountId||'guest')+projectId} formal={query.data.analysis}/>;
}
function FeatureWorkspace({formal}:{formal:PathAnalysis}){
  const {session}=useSession(),account=session.accountId||'guest',projectId=formal.projectId,manage=canManageProject(session,projectId),client=useQueryClient();
  const [params,setParams]=useWorkspaceParams(),[choosing,setChoosing]=useState(false),[discarding,setDiscarding]=useState(false),[featureEdit,setFeatureEdit]=useState<FeatureEdit|null>(()=>{const p=readFeaturePending(account,projectId);return p&&!p.feature?p:null;}),[issue,setIssue]=useState(''),[locate,setLocate]=useState<{id:string;sequence:number}>();
  const orderKey='pm-feature-order-write:'+account+':'+projectId;
  const [orderPending,setOrderPending]=useState(()=>sessionStorage.getItem(orderKey)||'');
  const [readError,setReadError]=useState(''),[denied,setDenied]=useState(false);
  const refresh=async()=>{try{setReadError('');await api('/api/projects/'+projectId+'/feature-overview?state=all');invalidateRequirementViews(client);}catch(e){setReadError((e as Error).message);if(e instanceof ApiError&&[401,403].includes(e.status)){clearProjectGraphDrafts(account,projectId);setDenied(true);invalidateRequirementViews(client);}}};
  const draft=useDependencyDraft(account,formal,'project',()=>invalidateRequirementViews(client));
  const navigation=useCanvasNavigation(account,projectId,async()=>{flushSync(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});await draft.flush();return true;});
  const go=(url:string)=>void navigation.go(url),setParam=(name:string,value:string)=>setParams(old=>{const next=new URLSearchParams(old);if(value)next.set(name,value);else next.delete(name);return next;},{replace:true});
  const data=useMemo(()=>draft.preview?.analysis||draftNetwork(formal,draft.changes,draft.templateInstances),[formal,draft.changes,draft.preview,draft.templateInstances]);
  const context=data.featureContext!,planning=params.get('planning')!=='0',actual=params.get('actual')!=='0',editing=manage&&draft.active&&!draft.loading&&!draft.readOnly&&!draft.busy&&!draft.pending;
  const graph=useMemo(()=>featurePathGraph(data,context.overview,context.relations,context.requirements,undefined,planning,actual),[data,context,planning,actual]);
  const viewKey=account+':'+projectId+':features',layout=data.layouts?.find(l=>l.scope==='features'&&l.direction==='right'),formalLayout=formal.layouts?.find(l=>l.scope==='features'&&l.direction==='right');
  const {interaction,selected,edgeId,select}=useEditorInteraction(params.get('pathNode')||params.get('node')||'',selection=>setParams(old=>{const next=new URLSearchParams(old),previous=next.get('pathNode')||next.get('node');if(selection.kind==='nodes'&&previous!==selection.primary)next.delete('phaseId');for(const key of ['node','edge','pathNode','pathEdge'])next.delete(key);if(selection.kind==='nodes'){next.set('pathNode',selection.primary);next.set('pathInspector','open');}if(selection.kind==='edge'){next.set('pathEdge',selection.id);next.set('pathInspector','open');}return next;},{replace:true}),params.get('pathEdge')||params.get('edge')||'');
  const pendingRestored=useRef(false);useEffect(()=>{if(pendingRestored.current||!manage)return;pendingRestored.current=true;const pending=readFeaturePending(account,projectId);if(pending?.feature)select('feature:'+pending.feature.id);},[account,projectId,manage,select]);
  const card=graph.cards.find(c=>c.id===selected),edge=graph.links.find(e=>e.id===edgeId),feature=context.overview.features.find(g=>g.id===card?.featureId),changesOpen=params.get('pathPanel')==='changes';
  const relationName=(id:string)=>context.overview.features.find(g=>g.id===id)?.name||id;
  const validate=(source:string,target:string)=>{
    const a=graph.cards.find(c=>c.id===source),b=graph.cards.find(c=>c.id===target);
    if(!a?.featureId||!b?.featureId||a.archived||b.archived||a.featureId==='unassigned'||b.featureId==='unassigned')return {message:'规划关系只能连接当前特性'};
    if(context.relations.some(r=>r.sourceFeatureId===a.featureId&&r.targetFeatureId===b.featureId))return {message:'这条规划关系已经存在',kind:'duplicate' as const};
    const seen=new Set<string>(),queue=[b.featureId];for(let i=0;i<queue.length;i++){const id=queue[i];if(id===a.featureId)return {message:'规划关系形成循环（包含保留的归档关系）',kind:'cycle' as const};if(seen.has(id))continue;seen.add(id);queue.push(...context.relations.filter(r=>r.sourceFeatureId===id).map(r=>r.targetFeatureId));}return null;
  };
  const changeRelation=(change:FeatureRelationChange)=>{
    const previous=draft.changes.featureRelations?.find(c=>c.id===change.id),rest=(draft.changes.featureRelations||[]).filter(c=>c.id!==change.id);
    if(previous?.op==='create'&&change.op==='update')rest.push({...previous,note:change.note});else if(!(previous?.op==='create'&&change.op==='delete'))rest.push(change);
    draft.change({...draft.changes,featureRelations:rest});
  };
  const connect=(source:string,target:string,note='')=>{
    const problem=validate(source,target);if(problem){setIssue(problem.message);return false;}
    changeRelation({op:'create',id:randomUUID(),sourceFeatureId:source.slice(8),targetFeatureId:target.slice(8),note});
    setParams(old=>{const next=new URLSearchParams(old);next.delete('pathNode');next.set('pathEdge',source+'>'+target);next.set('pathInspector','open');return next;},{replace:true});setIssue('');return true;
  };
  const commands=editorAdapter({move:positions=>draft.change({...draft.changes,layouts:[...(draft.changes.layouts||[]).filter(l=>l.scope!=='features'||l.direction!=='right'),{scope:'features',direction:'right',expectedVersion:formalLayout?.version||0,positions}]}),connect,undo:draft.undo,redo:draft.redo,save:()=>void draft.save(),delete:(_ids,id)=>{const r=context.relations.find(r=>r.id===graph.links.find(e=>e.id===id)?.planningRelationIds?.[0]);if(r)changeRelation({op:'delete',id:r.id,expectedVersion:r.version||1});}},editing);
  const enter=(id:string,stage?:string)=>{const next=new URLSearchParams({view:'feature',featureId:id});if(context.overview.features.find(f=>f.id===id)?.phases?.some(p=>p.id===params.get('phaseId')))next.set('phaseId',params.get('phaseId')!);if(stage)next.set('stage',stage);go('/?'+next);};
  const choosePhase=(f:typeof context.overview.features[number],p:NonNullable<typeof f.phases>[number],stage?:string)=>{select('feature:'+f.id);setParam('phaseId',p.id);if(stage){go('/?'+new URLSearchParams({view:'feature',featureId:f.id,phaseId:p.id,stage}));}};
  useEffect(()=>{if(params.get('create')==='1'&&manage)setFeatureEdit(readFeaturePending(account,projectId)||{mode:'basic'});},[params,manage,account,projectId]);
  const detail=params.get('pathInspector')!=='closed'&&(card||edge)?<div className="canvas-inspector">
    <div className="canvas-inspector-body">{feature?<DeliveryFeatureDetails key={feature.id} feature={feature} phaseId={params.get('phaseId')} onEnter={stage=>enter(feature.id,stage)} onPhase={()=>setParam('phaseId','')}/>:card?.featureId==='unassigned'?<p>{context.overview.unassignedCount} 个需求尚未关联特性。</p>:card?<p>{card.subtitle}</p>:null}
    {edge&&<>
      {!!edge.planningRelationIds?.length&&<section><h4>规划关系</h4>{edge.planningRelationIds.map(id=>{const r=context.relations.find(r=>r.id===id)!;return <div key={id}><p>{relationName(r.sourceFeatureId)} → {relationName(r.targetFeatureId)}</p>{editing?<label className="field"><span>关系说明</span><EditorField multiline fieldKey={r.id+':note'} aria-label="规划关系说明" value={r.note} onCommit={note=>changeRelation({op:'update',id:r.id,expectedVersion:r.version||1,note})}/></label>:r.note&&<p className="canvas-summary-text">{r.note}</p>}{editing&&<button className="ghost-button danger-text" onClick={()=>changeRelation({op:'delete',id:r.id,expectedVersion:r.version||1})}>移除规划关系</button>}</div>;})}</section>}
      {!!edge.dependencyIds.length&&<section><h4>实际依赖 · {edge.dependencyIds.length} 条</h4><div className="canvas-dependency-list">{edge.dependencyIds.map(id=>{const d=data.dependencies.find(d=>d.id===id);if(!d)return null;const name=(req:string,milestone?:string|null)=>context.requirements.find(r=>r.id===req)?.title||data.nodes.find(n=>n.id===milestone)?.title||'历史交付';return <button className="ghost-button" key={id} onClick={()=>go('/paths?'+new URLSearchParams({view:'project',pathRelation:id,pathInspector:'open',pathScope:'all'}))}>{name(d.sourceRequirementId,d.sourceMilestoneId)} → {name(d.targetRequirementId,d.targetMilestoneId)}</button>;})}</div></section>}
    </>}</div>
  </div>:undefined;
  const display=<><button role="menuitemcheckbox" aria-checked={planning} data-menu-stay onClick={()=>setParam('planning',planning?'0':'1')}><Check size={15} style={{visibility:planning?'visible':'hidden'}}/>规划关系（虚线）</button><button role="menuitemcheckbox" aria-checked={actual} data-menu-stay onClick={()=>setParam('actual',actual?'0':'1')}><Check size={15} style={{visibility:actual?'visible':'hidden'}}/>实际依赖（实线）</button></>;
  const toolbar=<EditorToolbar pageNavigation={canvasNavigation({params,data,onGo:go,onBack:navigation.back})} secondaryActions={<><button className="ghost-button" aria-label="刷新特性" onClick={()=>void refresh()}>刷新</button>{manage&&<button className="ghost-button" onClick={()=>setFeatureEdit({mode:'basic'})}>新建特性</button>}</>} title="项目交付" editing={draft.active} canEdit={manage&&!draft.readOnly} begin={draft.begin} undo={()=>commands.dispatch({type:'undo'})} redo={()=>commands.dispatch({type:'redo'})} canUndo={editing&&draft.canUndo} canRedo={editing&&draft.canRedo} save={()=>void draft.save()} canSave={!draft.readOnly&&!!(draft.pending||!draft.conflict&&(draft.count||Object.keys(draft.fields).length))} busy={draft.busy||draft.loading} discard={()=>draft.count?setDiscarding(true):draft.cancel()}
    status={<button className="ghost-button canvas-draft-status" aria-label="草稿状态" onClick={()=>setParam('pathPanel',changesOpen?'':'changes')} data-draft-stored={draft.stored}>{draft.loading?'恢复草稿…':draft.legacy.blocked?'旧草稿待核对':draft.pending?'提交结果待核对':draft.readOnly?'其他页面编辑中':draft.conflict?'版本冲突':draft.count?draft.count+' 项未保存':draft.active?'编辑中':'正式资料'}</button>}
    extra={(params.get('mode')==='graph'||editing)?<>{params.get('mode')==='graph'&&display}{editing&&<button className="ghost-button" onClick={()=>setChoosing(true)}><Link2 size={17}/>建立规划关系</button>}</>:undefined}/>;
  const search=params.get('pathSearch')||'',matching=graph.cards.filter(c=>(c.title+' '+(c.expectation||'')).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  if(denied)return <p role="alert">项目权限已移除</p>;
  return <div className="feature-path">{readError&&<p role="alert" className="warning-banner">{readError}</p>}{orderPending&&<div role="alert" className="warning-banner">旧排序操作待核对：{orderPending}<button className="ghost-button" onClick={()=>void api('/api/projects/'+projectId+'/feature-overview?state=all').then(()=>{invalidateRequirementViews(client);setOrderPending('');sessionStorage.removeItem(orderKey);}).catch(e=>setReadError((e as Error).message))}>读取最新资料并核对顺序</button></div>}<GraphWorkspace table={<FeatureTable features={context.overview.features} params={params} selected={selected} onSelect={select} onEnter={enter} onPhase={choosePhase} onSort={v=>setParam('tableSort',v)}/>} visibleIds={graph.cards.filter(c=>!c.featureId||c.featureId==='unassigned'||context.overview.features.some(f=>f.id===c.featureId&&matchesDeliveryFeature(f,params))).map(c=>c.id)} selectedPhaseId={params.get('phaseId')||undefined} onSelectPhase={(featureId,phaseId)=>{select('feature:'+featureId);setParam('phaseId',phaseId);}} document={draft} commands={commands} interaction={interaction} cards={graph.cards} links={graph.links} viewKey={viewKey} historyIndex={window.history.state?.idx} positions={layout?.positions} editing={editing} validateConnection={validate} locate={locate}
    navigation={<DeliveryFilters features params={params} setParam={setParam}/>}  toolbar={toolbar} detailTitle={card?.title||'关系详情'} detail={detail} onDismissDetail={()=>setParam('pathInspector','closed')}
    onOpenNode={card=>{if(card.featureId)enter(card.featureId);else select(card.id);}}
    onRevealField={key=>{const r=context.relations.find(r=>key===r.id+':note');if(r){setParam('pathEdge','feature:'+r.sourceFeatureId+'>feature:'+r.targetFeatureId);setParam('pathInspector','open');}else {const id=key.startsWith('title:')?key.slice(6):key.slice(0,key.lastIndexOf(':')),node=data.nodes.find(n=>n.id===id);void navigation.go(node?.requirementId?requirementCanvasUrl(node.requirementId,params,data,id):'/paths?'+new URLSearchParams({view:'project',pathNode:id,pathInspector:'open',pathScope:'all'}),true,true);}}}
    auxiliary={changesOpen?<><div className="graph-panel-heading"><h3>修改与冲突</h3><button className="ghost-button" onClick={()=>setParam('pathPanel','')}>关闭</button></div><CanvasDraftDetails draft={draft} data={data} onGo={url=>void navigation.go(url,true,true)}/></>:undefined} auxiliaryKey="changes" onDismissAuxiliary={()=>setParam('pathPanel','')}
    finder={<><SearchInput value={search} onChange={value=>{setParam('pathSearch',value);setParam('q',value);}} placeholder="查找特性"/>{matching.map(c=><button className="ghost-button canvas-finder-row" key={c.id} onClick={()=>{select(c.id);setLocate({id:c.id,sequence:Date.now()});}}>{c.title}</button>)}</>}
    footer={(issue||!graph.cards.length||draft.error||draft.conflict||draft.legacy.blocked)?<>{issue&&<span role="alert" className="danger-text">{issue}</span>}{!graph.cards.length&&<span>{manage?<button className="ghost-button" onClick={()=>go('/features?'+new URLSearchParams({create:'1',returnTo:'/paths?view=features'}))}>创建第一个特性</button>:'暂无特性'}</span>}{(draft.error||draft.conflict||draft.legacy.blocked)&&<button className="ghost-button danger-text" onClick={()=>setParam('pathPanel','changes')}>查看修改与错误</button>}</>:undefined}/>
    {featureEdit&&<FeatureEditor projectId={projectId} edit={featureEdit} onClose={()=>{setFeatureEdit(null);setParam('create','');}} onSaved={id=>select('feature:'+id)}/>}
    {choosing&&editing&&<PlanningConnectionDialog features={context.overview.features.filter(g=>!g.archivedAt)} onClose={()=>setChoosing(false)} onCreate={(source,target,note)=>{if(connect('feature:'+source,'feature:'+target,note)){setChoosing(false);return true;}return false;}}/>}
    {discarding&&<Modal title="放弃画布修改" onClose={()=>setDiscarding(false)}><p>将放弃所有层尚未保存的修改。</p><div className="form-actions"><button className="ghost-button" onClick={()=>setDiscarding(false)}>继续编辑</button><button className="primary-button" onClick={()=>{draft.cancel();setDiscarding(false);}}>放弃修改</button></div></Modal>}
  </div>;
}
function PlanningConnectionDialog({features,onClose,onCreate}:{features:Array<{id:string;name:string}>;onClose:()=>void;onCreate:(source:string,target:string,note:string)=>boolean}){
  const [source,setSource]=useState(''),[target,setTarget]=useState(''),[note,setNote]=useState(''),[error,setError]=useState('');
  return <Modal title="建立规划关系" onClose={onClose}><form className="feature-form" onSubmit={e=>{e.preventDefault();if(!onCreate(source,target,note))setError('无法建立关系，请检查重复、自连接或规划循环。');}}><p className="field-help">关系加入画布草稿，与各层修改一起保存。</p>{[{label:'前置特性',value:source,set:setSource},{label:'后续特性',value:target,set:setTarget}].map(field=><label className="field" key={field.label}><span>{field.label}</span><Select aria-label={field.label} required value={field.value} onChange={e=>field.set(e.target.value)}><option value="">请选择特性</option>{features.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</Select></label>)}<label className="field"><span>关系说明</span><textarea aria-label="关系说明" maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></label>{error&&<p role="alert" className="form-error">{error}</p>}<div className="form-actions"><button type="button" className="ghost-button" onClick={onClose}>取消</button><button className="primary-button">加入草稿</button></div></form></Modal>;
}
