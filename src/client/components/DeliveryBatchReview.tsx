import {useState} from 'react';
import type {useDependencyDraft} from '../use-graph-draft';
import type {PathAnalysis} from '../../shared/paths';
import {DeliveryImpactTable} from './DeliveryImpactTable';
const labels:Record<string,string>={title:'名称',deliveryScope:'交付范围',executionMode:'执行方式',acceptanceOwnerId:'验收人',ownerId:'负责人',acceptanceCriteria:'验收标准',background:'背景',referenceUrl:'参考链接',reviewForecast:'预测核对',durationDays:'工期',forecastEnd:'预计完成',unblockEstimate:'预计解阻',blockedCoordinatorId:'协调人',blockedNextReviewAt:'下次核对',blockedIssueId:'关联问题',plannedStart:'计划开始',plannedEnd:'计划结束',targetDate:'目标日期',reason:'说明'};
const display=(v:unknown):string=>v==null?'未设置':typeof v==='object'?Object.entries(v).map(([k,x])=>(k==='remainingDays'?'剩余工作日':labels[k]||k)+' '+display(x)).join('，'):({committed:'纳入交付',candidate:'候选',direct:'直接执行',work_items:'工作项分解'}[String(v)]||String(v));
export function DeliveryBatchReview({draft,data,onSaved}:{draft:ReturnType<typeof useDependencyDraft>;data:PathAnalysis;onSaved:()=>void}) {
  const [confirmed,setConfirmed]=useState('');
  const signature=JSON.stringify([draft.changes,draft.preview?.previewToken]),label=(id:string)=>data.requirements.find(r=>r.id===id)?.title||data.nodes.find(n=>n.id===id)?.title||draft.changes.entities?.find(c=>c.id===id)?.data.title||id;
  const change=draft.preview?.differences.commitment;
  return <div className="delivery-batch-review">
    <p>以下 {draft.count} 项包含本次修改及项目已有草稿，将一起保存。</p>
    <ul>{draft.changes.entities?.map(c=><li key={c.id}><strong>{c.op==='create'?'新增':c.op==='delete'?'移除':'修改'} {label(c.id)}</strong>{c.op!=='delete'&&<dl>{Object.entries(c.data).map(([key,value])=><div key={key}><dt>{labels[key]||key}</dt><dd>{display(value)}</dd></div>)}</dl>}</li>)}
      {draft.changes.add.map(e=><li key={e.clientId}>增加依赖：{label(e.sourceMilestoneId||e.sourceWorkItemId||e.sourceRequirementId)} → {label(e.targetMilestoneId||e.targetWorkItemId||e.targetRequirementId)}</li>)}
      {draft.changes.remove.map(id=>{const e=data.dependencies.find(e=>e.id===id);return <li key={id}>移除依赖：{e?label(e.sourceWorkItemId||e.sourceRequirementId)+' → '+label(e.targetWorkItemId||e.targetRequirementId):id}</li>;})}
      {draft.changes.estimates.map(e=><li key={e.workItemId}>估算 {label(e.workItemId)}：{display(Object.fromEntries(Object.entries(e).filter(([k])=>k!=='workItemId')))}</li>)}
      {draft.changes.layouts?.map(l=><li key={l.scope+':'+l.direction}>共享布局：{l.scope==='global'?'项目全图':label(l.scope.replace('requirement:',''))} · {Object.keys(l.positions).length} 个节点</li>)}
      {draft.changes.commitment&&<li>确认项目整体交付承诺：{draft.changes.commitment.reason||'首次确认'}</li>}
    </ul>
    {change&&<details open><summary>承诺快照：{change.value.items.length} 项 · 项目目标 {change.value.targetDate||'待确认'}</summary><p>{change.value.milestoneTitle&&'交付标识：'+change.value.milestoneTitle}</p><ul>{change.value.items.map(i=><li key={i.id}>{i.title} · {i.targetDate||'日期待确认'}{i.acceptanceCriteria&&' · '+i.acceptanceCriteria}</li>)}</ul>{change.differences.map(d=><p key={d.id}>{d.change==='added'?'新纳入':d.change==='removed'?'撤出':'变更'}：{d.title} · {d.before?.targetDate||'—'} → {d.after?.targetDate||'—'}{d.before?.acceptanceCriteria!==d.after?.acceptanceCriteria?'；验收标准变化':''}</p>)}</details>}
    {draft.preview&&<DeliveryImpactTable entries={draft.preview.differences.impact||[]} target={draft.preview.differences.target}/>}
    {draft.conflicts.map(c=><div className="editor-conflict" key={c.key}><strong>{c.title} · {labels[c.field]||c.field}</strong><p>最新：{display(c.server)}；草稿：{display(c.draft)}</p><div className="button-row"><button type="button" className="ghost-button" onClick={()=>draft.resolveConflict(c.key,'server')}>使用最新值</button>{c.canKeep&&<button type="button" className="ghost-button" onClick={()=>draft.resolveConflict(c.key,'draft')}>保留草稿值</button>}</div></div>)}
    {draft.conflict&&<button type="button" className="ghost-button" disabled={draft.unresolved>0} onClick={draft.rebase}>核对后重新预览</button>}
    {(draft.error||draft.storageError)&&<p role="alert" className="form-error">{draft.error?.message||draft.storageError}</p>}
    {draft.readOnly&&<button type="button" className="ghost-button" onClick={()=>void draft.takeOver()}>接管此草稿</button>}
    {draft.previewing&&<p className="field-help">正在预览修改…</p>}
    <label className="editor-person-check"><input type="checkbox" disabled={draft.previewing||!draft.preview||draft.conflict||draft.busy} checked={confirmed===signature} onChange={e=>setConfirmed(e.target.checked?signature:'')}/>已核对本次及已有草稿，整批保存</label>
    <div className="form-actions"><button type="button" className="ghost-button" disabled={draft.busy||draft.previewing} onClick={draft.retryPreview}>重新预览</button><button type="button" className="primary-button" disabled={draft.busy||draft.loading||draft.readOnly||(!draft.pending&&(draft.conflict||confirmed!==signature||!draft.preview))} onClick={()=>void draft.save().then(saved=>{if(saved)onSaved();})}>{draft.pending?'核对原批次并保存':'确认保存全部修改'}</button></div>
  </div>;
}
