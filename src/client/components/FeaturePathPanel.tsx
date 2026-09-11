import {useEffect,useMemo,useState} from 'react';
import {flushSync} from 'react-dom';
import {useQueryClient} from '@tanstack/react-query';
import {Link2,SlidersHorizontal,Check} from 'lucide-react';
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
import {ApiError} from '../api';
import {featurePathGraph} from '../../shared/feature-projection';
import type {PathAnalysis} from '../../shared/paths';
import type {FeatureRelationChange} from '../../shared/features';
import {GraphWorkspace} from './GraphWorkspace';
import {PageHeader} from './PageHeader';
import {EditorToolbar} from './EditorToolbar';
import {EditorField} from './EditorField';
import {CanvasNavigation} from './CanvasNavigation';
import {CanvasDraftDetails} from './CanvasDraftDetails';
import {TopbarMenu} from './TopbarMenu';
import {FeatureAssessment} from './FeaturePlanning';
import {Modal} from './Modal';
import {SearchInput} from './SearchInput';
import './feature-planning.css';

export function FeaturePathPanel({projectId}:{projectId:string}) {
  const {session}=useSession();
  const query=useResourceQuery<{analysis:PathAnalysis}>([...keys.featureGraph,projectId,session.accountId,'features'],'/api/projects/'+projectId+'/path-graph?view=features',!!projectId);
  useEffect(()=>{if(query.error instanceof ApiError&&[401,403].includes(query.error.status))clearProjectGraphDrafts(session.accountId||'guest',projectId);},[query.error,session.accountId,projectId]);
  if(query.unavailable||!query.data)return <><PageHeader title="路径分析"/><div className="page-content"><p>{query.error?.message||'正在读取特性关系…'}</p>{query.error&&<button className="ghost-button" onClick={()=>void query.refetch()}>重新读取</button>}</div></>;
  return <FeatureWorkspace key={(session.accountId||'guest')+projectId} formal={query.data.analysis}/>;
}
function FeatureWorkspace({formal}:{formal:PathAnalysis}){
  const {session}=useSession(),account=session.accountId||'guest',projectId=formal.projectId,manage=canManageProject(session,projectId),client=useQueryClient();
  const [params,setParams]=useWorkspaceParams(),[choosing,setChoosing]=useState(false),[discarding,setDiscarding]=useState(false),[issue,setIssue]=useState(''),[locate,setLocate]=useState<{id:string;sequence:number}>();
  const draft=useDependencyDraft(account,formal,'project',()=>invalidateRequirementViews(client));
  const navigation=useCanvasNavigation(account,projectId,async()=>{flushSync(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});await draft.flush();return true;});
  const go=(url:string)=>void navigation.go(url),setParam=(name:string,value:string)=>setParams(old=>{const next=new URLSearchParams(old);if(value)next.set(name,value);else next.delete(name);return next;},{replace:true});
  const data=useMemo(()=>draft.preview?.analysis||draftNetwork(formal,draft.changes,draft.templateInstances),[formal,draft.changes,draft.preview,draft.templateInstances]);
  const context=data.featureContext!,planning=params.get('planning')!=='0',actual=params.get('actual')!=='0',editing=manage&&draft.active&&!draft.loading&&!draft.readOnly&&!draft.busy&&!draft.pending;
  const graph=useMemo(()=>featurePathGraph(data,context.overview,context.relations,context.requirements,undefined,planning,actual),[data,context,planning,actual]);
  const viewKey=account+':'+projectId+':features',layout=data.layouts?.find(l=>l.scope==='features'&&l.direction==='right'),formalLayout=formal.layouts?.find(l=>l.scope==='features'&&l.direction==='right');
  const {interaction,selected,edgeId,select}=useEditorInteraction(params.get('pathNode')||params.get('node')||'',selection=>setParams(old=>{const next=new URLSearchParams(old);for(const key of ['node','edge','pathNode','pathEdge'])next.delete(key);if(selection.kind==='nodes'){next.set('pathNode',selection.primary);next.set('pathInspector','open');}if(selection.kind==='edge'){next.set('pathEdge',selection.id);next.set('pathInspector','open');}return next;},{replace:true}),params.get('pathEdge')||params.get('edge')||'');
  const card=graph.cards.find(c=>c.id===selected),edge=graph.links.find(e=>e.id===edgeId),group=context.overview.groups.find(g=>g.id===card?.featureId),changesOpen=params.get('pathPanel')==='changes';
  const relationName=(id:string)=>context.overview.groups.find(g=>g.id===id)?.name||id;
  const validate=(source:string,target:string)=>{
    const a=graph.cards.find(c=>c.id===source),b=graph.cards.find(c=>c.id===target);
    if(!a?.featureId||!b?.featureId||a.archived||b.archived||a.featureId==='ungrouped'||b.featureId==='ungrouped')return {message:'规划关系只能连接当前特性'};
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
  const enter=(id:string)=>go('/paths?view=feature&featureId='+encodeURIComponent(id));
  const maintain=()=>{if(group)go('/features?'+new URLSearchParams({feature:group.id,...group.archivedAt?{state:'archived'}:{},returnTo:'/paths?'+params}));};
  const detail=params.get('pathInspector')!=='closed'&&(card||edge)?<div className="canvas-inspector">
    <div className="graph-panel-heading"><h3>{card?.title||'关系详情'}</h3><button className="ghost-button" onClick={()=>setParam('pathInspector','closed')}>关闭</button></div>
    <div className="canvas-inspector-body">{group?<>
      <div className="canvas-assessment"><FeatureAssessment group={group}/><small>{group.assessedAt?new Date(group.assessedAt).toLocaleDateString('zh-CN')+' · '+(group.assessedByName||'原评估人'):'尚未评估'}</small></div>
      {group.archivedAt&&<p className="field-help">归档特性 · 保留依赖关系</p>}
      {group.overview.expectation&&<section><h4>当前预期</h4><p className="canvas-summary-text">{group.overview.expectation}</p></section>}
      {group.overview.progressSummary&&<section><h4>进展简述</h4><p className="canvas-summary-text">{group.overview.progressSummary}</p></section>}
      <section><h4>执行事实</h4>{group.counts.total?<div className="feature-facts"><span>已完成 {group.counts.completed}</span><span>进行中 {group.counts.inProgress}</span><span>延期 {group.counts.delayed}</span></div>:<p className="field-help">尚未关联有效需求</p>}</section>
    </>:card?.featureId==='ungrouped'?<p>{context.overview.ungroupedCount} 个需求尚未归属特性。</p>:card?<p>{card.subtitle}</p>:null}
    {edge&&<>
      {!!edge.planningRelationIds?.length&&<section><h4>规划关系</h4>{edge.planningRelationIds.map(id=>{const r=context.relations.find(r=>r.id===id)!;return <div key={id}><p>{relationName(r.sourceFeatureId)} → {relationName(r.targetFeatureId)}</p>{editing?<label className="field"><span>关系说明</span><EditorField multiline fieldKey={r.id+':note'} aria-label="规划关系说明" value={r.note} onCommit={note=>changeRelation({op:'update',id:r.id,expectedVersion:r.version||1,note})}/></label>:r.note&&<p className="canvas-summary-text">{r.note}</p>}{editing&&<button className="ghost-button danger-text" onClick={()=>changeRelation({op:'delete',id:r.id,expectedVersion:r.version||1})}>移除规划关系</button>}</div>;})}</section>}
      {!!edge.dependencyIds.length&&<section><h4>实际依赖 · {edge.dependencyIds.length} 条</h4><div className="canvas-dependency-list">{edge.dependencyIds.map(id=>{const d=data.dependencies.find(d=>d.id===id);if(!d)return null;const name=(req:string,milestone?:string|null)=>context.requirements.find(r=>r.id===req)?.title||data.nodes.find(n=>n.id===milestone)?.title||'历史交付';return <button className="ghost-button" key={id} onClick={()=>go('/paths?'+new URLSearchParams({view:'project',pathRelation:id,pathInspector:'open',pathScope:'all'}))}>{name(d.sourceRequirementId,d.sourceMilestoneId)} → {name(d.targetRequirementId,d.targetMilestoneId)}</button>;})}</div></section>}
    </>}</div>
    {card?.featureId&&<footer className="canvas-inspector-actions"><button className="primary-button" onClick={()=>enter(card.featureId!)}>进入需求图</button>{group?<button className="ghost-button" onClick={maintain}>{manage&&!group.archivedAt?'维护特性':'查看特性'}</button>:<button className="ghost-button" onClick={()=>go('/requirements?group=ungrouped')}>整理需求</button>}</footer>}
  </div>:undefined;
  const toolbar=<EditorToolbar persistentStatus title="路径分析" editing={draft.active} canEdit={manage&&!draft.readOnly} begin={draft.begin} undo={()=>commands.dispatch({type:'undo'})} redo={()=>commands.dispatch({type:'redo'})} canUndo={editing&&draft.canUndo} canRedo={editing&&draft.canRedo} save={()=>void draft.save()} canSave={!draft.readOnly&&!!(draft.pending||!draft.conflict&&(draft.count||Object.keys(draft.fields).length))} busy={draft.busy||draft.loading} discard={()=>draft.count?setDiscarding(true):draft.cancel()}
    status={<button className="ghost-button canvas-draft-status" aria-label="草稿状态" onClick={()=>setParam('pathPanel',changesOpen?'':'changes')} data-draft-stored={draft.stored}>{draft.loading?'恢复草稿…':draft.legacy.blocked?'旧草稿待核对':draft.pending?'提交结果待核对':draft.readOnly?'其他页面编辑中':draft.conflict?'版本冲突':draft.count?draft.count+' 项未保存':draft.active?'编辑中':'正式资料'}</button>}
    extra={<>{editing&&<button className="ghost-button" onClick={()=>setChoosing(true)}><Link2 size={17}/>建立规划关系</button>}</>}/>;
  const display=<TopbarMenu label="显示关系" text="显示" icon={<SlidersHorizontal size={16}/>}><button role="menuitemcheckbox" aria-checked={planning} data-menu-stay onClick={()=>setParam('planning',planning?'0':'1')}><Check size={15} style={{visibility:planning?'visible':'hidden'}}/>规划关系</button><button role="menuitemcheckbox" aria-checked={actual} data-menu-stay onClick={()=>setParam('actual',actual?'0':'1')}><Check size={15} style={{visibility:actual?'visible':'hidden'}}/>实际依赖</button></TopbarMenu>;
  const search=params.get('pathSearch')||'',matching=graph.cards.filter(c=>(c.title+' '+(c.expectation||'')).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div className="feature-path"><GraphWorkspace document={draft} commands={commands} interaction={interaction} cards={graph.cards} links={graph.links} viewKey={viewKey} historyIndex={window.history.state?.idx} positions={layout?.positions} editing={editing} validateConnection={validate} locate={locate}
    navigation={<CanvasNavigation params={params} data={data} onGo={go} onBack={navigation.back} extra={display}/>} toolbar={toolbar} detail={detail} onDismissDetail={()=>setParam('pathInspector','closed')}
    onOpenNode={card=>{if(card.featureId)enter(card.featureId);else select(card.id);}}
    onRevealField={key=>{const r=context.relations.find(r=>key===r.id+':note');if(r){setParam('pathEdge','feature:'+r.sourceFeatureId+'>feature:'+r.targetFeatureId);setParam('pathInspector','open');}else {const id=key.startsWith('title:')?key.slice(6):key.slice(0,key.lastIndexOf(':')),node=data.nodes.find(n=>n.id===id);void navigation.go(node?.requirementId?requirementCanvasUrl(node.requirementId,params,data,id):'/paths?'+new URLSearchParams({view:'project',pathNode:id,pathInspector:'open',pathScope:'all'}),true,true);}}}
    auxiliary={changesOpen?<><div className="graph-panel-heading"><h3>修改与冲突</h3><button className="ghost-button" onClick={()=>setParam('pathPanel','')}>关闭</button></div><CanvasDraftDetails draft={draft} data={data} onGo={url=>void navigation.go(url,true,true)}/></>:undefined} auxiliaryKey="changes" onDismissAuxiliary={()=>setParam('pathPanel','')}
    finder={<><SearchInput value={search} onChange={value=>setParam('pathSearch',value)} placeholder="查找特性"/>{matching.map(c=><button className="ghost-button canvas-finder-row" key={c.id} onClick={()=>{select(c.id);setLocate({id:c.id,sequence:Date.now()});}}>{c.title}</button>)}</>}
    footer={<><span>虚线：规划关系 · 实线：实际依赖</span>{issue&&<span role="alert" className="danger-text">{issue}</span>}{!graph.cards.length&&<span>{manage?<button className="ghost-button" onClick={()=>go('/features?'+new URLSearchParams({create:'1',returnTo:'/paths?view=features'}))}>创建第一个特性</button>:'暂无特性'}</span>}{(draft.error||draft.conflict||draft.legacy.blocked)&&<button className="ghost-button danger-text" onClick={()=>setParam('pathPanel','changes')}>查看修改与错误</button>}</>}/>
    {choosing&&editing&&<PlanningConnectionDialog groups={context.overview.groups.filter(g=>!g.archivedAt)} onClose={()=>setChoosing(false)} onCreate={(source,target,note)=>{if(connect('feature:'+source,'feature:'+target,note)){setChoosing(false);return true;}return false;}}/>}
    {discarding&&<Modal title="放弃画布修改" onClose={()=>setDiscarding(false)}><p>将放弃所有层尚未保存的修改。</p><div className="form-actions"><button className="ghost-button" onClick={()=>setDiscarding(false)}>继续编辑</button><button className="primary-button" onClick={()=>{draft.cancel();setDiscarding(false);}}>放弃修改</button></div></Modal>}
  </div>;
}
function PlanningConnectionDialog({groups,onClose,onCreate}:{groups:Array<{id:string;name:string}>;onClose:()=>void;onCreate:(source:string,target:string,note:string)=>boolean}){
  const [source,setSource]=useState(''),[target,setTarget]=useState(''),[note,setNote]=useState(''),[error,setError]=useState('');
  return <Modal title="建立规划关系" onClose={onClose}><form className="feature-form" onSubmit={e=>{e.preventDefault();if(!onCreate(source,target,note))setError('无法建立关系，请检查重复、自连接或规划循环。');}}><p className="field-help">关系加入画布草稿，与各层修改一起保存。</p>{[{label:'前置特性',value:source,set:setSource},{label:'后续特性',value:target,set:setTarget}].map(field=><label className="field" key={field.label}><span>{field.label}</span><select aria-label={field.label} required value={field.value} onChange={e=>field.set(e.target.value)}><option value="">请选择特性</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>)}<label className="field"><span>关系说明</span><textarea aria-label="关系说明" maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></label>{error&&<p role="alert" className="form-error">{error}</p>}<div className="form-actions"><button type="button" className="ghost-button" onClick={onClose}>取消</button><button className="primary-button">加入草稿</button></div></form></Modal>;
}
