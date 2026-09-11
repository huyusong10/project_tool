import {useState} from 'react';
import type {PathAnalysis} from '../../shared/paths';
import type {useDependencyDraft} from '../use-graph-draft';
import {requirementCanvasUrl} from '../canvas-navigation';

type Draft=ReturnType<typeof useDependencyDraft>;
export function CanvasDraftDetails({draft,data,onGo}:{draft:Draft;data:PathAnalysis;onGo:(url:string)=>void}){
  const [choices,setChoices]=useState<Record<string,'current'|'legacy'>>({}),legacy=draft.legacy;
  const name=(id:string)=>data.requirements.find(r=>r.id===id)?.title||data.nodes.find(n=>n.id===id)?.title||data.featureContext?.overview.groups.find(g=>g.id===id)?.name||id;
  const locate=(id:string)=>{const node=data.nodes.find(n=>n.id===id);onGo(node?.requirementId?requirementCanvasUrl(node.requirementId,new URLSearchParams({view:'project'}),data,id):'/paths?'+new URLSearchParams({view:'project',pathNode:id,pathInspector:'open',pathScope:'all'}));};
  const scopeUrl=(scope:string)=>scope==='features'?'/paths?view=features':scope.startsWith('feature:')?'/paths?view=feature&featureId='+encodeURIComponent(scope.slice(8)):scope.startsWith('requirement:')?requirementCanvasUrl(scope.slice(12),new URLSearchParams({view:'project'}),data):'/paths?view=project';
  return <div className="canvas-draft-details"><p>所有层的修改一起保存，共 {draft.count} 项。</p>
    {draft.storageError&&<p role="alert" className="form-error">{draft.storageError}</p>}
    {draft.session.readOnly&&<button className="ghost-button" onClick={()=>void draft.takeOver()}>接管此草稿</button>}
    {legacy.blocked&&<section className="warning-banner" role="alert"><p>{legacy.message||'旧特性布局与当前草稿存在不同修改，请选择要保留的布局。'}</p>
      {legacy.conflicts?.map(key=><label className="field" key={key}><span>{key}</span><select aria-label={'合并布局 '+key} value={choices[key]||''} onChange={e=>setChoices({...choices,[key]:e.target.value as 'current'|'legacy'})}><option value="">选择保留的布局</option><option value="current">当前画布草稿</option><option value="legacy">旧特性布局草稿</option></select></label>)}
      {legacy.kind==='conflict'?<button className="ghost-button" disabled={legacy.conflicts?.some(key=>!choices[key])} onClick={()=>legacy.resolve(choices)}>合入统一草稿</button>:legacy.kind==='locked'?<button className="ghost-button" onClick={legacy.takeOver}>接管旧特性草稿</button>:<><button className="ghost-button" onClick={legacy.retry}>重新核对旧草稿</button>{legacy.kind==='pending'&&<button className="ghost-button" onClick={legacy.retrySubmission}>核对后重试原批次</button>}</>}
    </section>}
    {draft.error&&<div role="alert" className="form-error">{draft.error.message}<button className="ghost-button" onClick={draft.retryPreview}>重新检查</button></div>}
    {draft.pending&&<button className="primary-button" disabled={draft.busy} onClick={()=>void draft.save()}>核对提交结果</button>}
    {!!draft.changes.featureRelations?.length&&<section><h4>特性总览 · 规划关系</h4>{draft.changes.featureRelations.map(c=>{const r=data.featureContext?.relations.find(r=>r.id===c.id);return <div className="canvas-change-row" key={c.id}><span>{c.op==='create'?'新增':c.op==='delete'?'删除':'修改说明'}：{c.op==='create'?name(c.sourceFeatureId)+' → '+name(c.targetFeatureId):r?name(r.sourceFeatureId)+' → '+name(r.targetFeatureId):'规划关系'}</span><button className="ghost-button" onClick={()=>onGo('/paths?view=features')}>定位</button></div>;})}</section>}
    {!!draft.changes.entities?.length&&<section><h4>需求与工作项</h4>{draft.changes.entities.map(c=><div className="canvas-change-row" key={c.id}><span>{c.op==='create'?'新增':c.op==='delete'?'删除':'修改'}：{c.data.title||name(c.id)}</span>{c.op!=='delete'&&<button className="ghost-button" onClick={()=>locate(c.id)}>定位</button>}</div>)}</section>}
    {!!(draft.changes.add.length+draft.changes.remove.length)&&<section><h4>实际依赖</h4>{draft.changes.add.map(c=><div className="canvas-change-row" key={c.clientId}><span>新增：{name(c.sourceWorkItemId||c.sourceMilestoneId||c.sourceRequirementId)} → {name(c.targetWorkItemId||c.targetMilestoneId||c.targetRequirementId)}</span><button className="ghost-button" onClick={()=>onGo('/paths?'+new URLSearchParams({view:'project',pathRelation:c.clientId,pathInspector:'open',pathScope:'all'}))}>定位</button></div>)}{draft.changes.remove.map(id=><p key={id}>删除：{name(data.dependencies.find(d=>d.id===id)?.sourceRequirementId||id)} 的依赖</p>)}</section>}
    {!!draft.changes.estimates.length&&<section><h4>工作项估算</h4>{draft.changes.estimates.map(c=><div className="canvas-change-row" key={c.workItemId}><span>{name(c.workItemId)}</span><button className="ghost-button" onClick={()=>locate(c.workItemId)}>定位</button></div>)}</section>}
    {!!draft.changes.layouts?.length&&<section><h4>共享布局</h4>{draft.changes.layouts.map(l=><div className="canvas-change-row" key={l.scope+l.direction}><span>{l.scope==='features'?'特性总览':l.scope==='global'?'全部需求':name(l.scope.slice(l.scope.indexOf(':')+1))}</span><button className="ghost-button" onClick={()=>onGo(scopeUrl(l.scope))}>定位</button></div>)}</section>}
    {draft.conflicts.map(c=><div className="draft-conflict" key={c.key}><strong>{c.title} · {c.field}</strong><p>服务器：{JSON.stringify(c.server)??'已不存在'}</p><p>我的修改：{JSON.stringify(c.draft)}</p><div className="button-row"><button className="ghost-button" onClick={()=>draft.resolveConflict(c.key,'server')}>使用服务器内容</button>{c.canKeep&&<button className="ghost-button" onClick={()=>draft.resolveConflict(c.key,'draft')}>保留我的修改</button>}</div></div>)}
    {draft.conflict&&<button className="primary-button" disabled={draft.unresolved>0} onClick={draft.rebase}>按最新资料重新预览</button>}
  </div>;
}
