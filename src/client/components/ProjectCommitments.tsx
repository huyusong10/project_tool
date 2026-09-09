import {useState,useEffect,useRef} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api} from '../api';
import {useSession} from '../app-context';
import {canManageProject} from '../permissions';
import {useDependencyDraft} from '../use-graph-draft';
import {invalidateRequirementViews,keys} from '../query-keys';
import type {PathAnalysis} from '../../shared/paths';
import {compareCommitments,type DeliveryCommitment} from '../../shared/commitments';
import {Modal} from './Modal';
import {DeliveryBatchReview} from './DeliveryBatchReview';
export function ProjectCommitmentControl({projectId}:{projectId:string}) {
  const [open,setOpen]=useState(false);
  return <><button type="button" className="ghost-button" onClick={()=>setOpen(true)}>交付承诺</button>{open&&<ProjectCommitmentDialog projectId={projectId} onClose={()=>setOpen(false)}/>}</>;
}
function ProjectCommitmentDialog({projectId,onClose}:{projectId:string;onClose:()=>void}) {
  const query=useQuery({queryKey:[...keys.paths,projectId],queryFn:()=>api<PathAnalysis>('/api/projects/'+projectId+'/path-analysis')});
  return <Modal title="项目交付承诺" width={760} onClose={onClose}>{query.data?<CommitmentEditor data={query.data} onClose={onClose}/>:<p>{query.error?.message||'正在读取交付信息…'}</p>}</Modal>;
}
function CommitmentEditor({data,onClose}:{data:PathAnalysis;onClose:()=>void}) {
  const {session}=useSession(),client=useQueryClient(),manager=canManageProject(session,data.projectId);
  const draft=useDependencyDraft(session.accountId||'guest',data,'project',()=>invalidateRequirementViews(client));
  const [reason,setReason]=useState(''),[milestone,setMilestone]=useState(''),[review,setReview]=useState(false);
  const initialized=useRef(false);useEffect(()=>{if(draft.loading||initialized.current)return;initialized.current=true;if(draft.changes.commitment){setReason(draft.changes.commitment.reason);setMilestone(draft.changes.commitment.milestoneId||'');}},[draft.loading,draft.changes.commitment]);
  const history=useQuery({queryKey:[...keys.commitments,data.projectId],queryFn:()=>api<DeliveryCommitment[]>('/api/projects/'+data.projectId+'/delivery-commitments')});
  const summary=useQuery({queryKey:[...keys.commitments,data.projectId,'summary'],queryFn:()=>api<{first:{rate:number|null;sampleCount:number};latest:{rate:number|null;sampleCount:number};acceptedCount:number;withoutCommitment:number;missingFirstDate:number;overdueOpen:number;withdrawnOrCancelled:number}>('/api/projects/'+data.projectId+'/delivery-commitments/summary')});
  const joining=useRef(false);
  if(review)return <DeliveryBatchReview draft={draft} data={data} onSaved={onClose}/>;
  return <>
    <p>确认当前项目整体交付范围和目标。后续计划调整保留首次承诺；未确认的历史需求不补造承诺。</p>
    {summary.data&&<dl className="commitment-summary"><div><dt>首次承诺交付率</dt><dd>{summary.data.first.rate==null?'不可计算':summary.data.first.rate+'%'} · {summary.data.first.sampleCount} 项样本</dd></div><div><dt>最近承诺交付率</dt><dd>{summary.data.latest.rate==null?'不可计算':summary.data.latest.rate+'%'} · {summary.data.latest.sampleCount} 项样本</dd></div><div><dt>覆盖情况</dt><dd>已验收 {summary.data.acceptedCount} · 无承诺 {summary.data.withoutCommitment} · 首次缺日期 {summary.data.missingFirstDate}</dd></div><div><dt>当前情况</dt><dd>未验收延期 {summary.data.overdueOpen} · 撤出／取消 {summary.data.withdrawnOrCancelled}</dd></div></dl>}
    {manager&&<form onSubmit={async e=>{e.preventDefault();if(joining.current)return;joining.current=true;draft.begin();draft.change({...draft.changes,commitment:{reason,milestoneId:milestone||null}});await draft.flush();joining.current=false;setReview(true);}}><fieldset className="form-fieldset" disabled={draft.loading||draft.readOnly||draft.busy||!!draft.pending||history.isLoading}>
      <label className="field"><span>交付标识（可选）</span><select value={milestone} onChange={e=>setMilestone(e.target.value)}><option value="">项目整体</option>{data.milestones?.filter(m=>!m.requirementId&&!m.cancelled).map(m=><option key={m.id} value={m.id}>{m.title}</option>)}</select></label>
      <label className="field"><span>{history.data?.length?'变更说明（必填）':'确认说明（可选）'}</span><textarea required={!!history.data?.length} value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <div className="form-actions"><button className="primary-button">预览交付承诺及全部草稿</button></div>
    </fieldset></form>}
    {draft.count>0&&<p>项目已有 {draft.count} 项草稿。<button type="button" className="ghost-button" onClick={()=>setReview(true)}>查看全部修改</button></p>}
    {(history.error||summary.error)&&<p role="alert" className="form-error">{history.error?.message||summary.error?.message}</p>}
    <div className="commitment-history">{history.data?.map((c,index)=><details key={c.id}><summary>{new Date(c.confirmedAt).toLocaleString()} · {c.items.length} 项 · {c.reason||'首次确认'}</summary><p>确认人 {c.confirmedName||c.confirmedBy} · 项目目标 {c.targetDate||'待确认'}{c.milestoneTitle?' · '+c.milestoneTitle:''}</p><ul>{c.items.map(i=><li key={i.id}>{i.title} · {i.targetDate||'日期待确认'}{i.acceptanceCriteria?' · '+i.acceptanceCriteria:''}</li>)}</ul>{index+1<(history.data?.length||0)&&<p>项目目标：{history.data?.[index+1].targetDate||'待确认'} → {c.targetDate||'待确认'}</p>}{compareCommitments(history.data?.[index+1]||null,c).map(d=><p key={d.id}>{d.change==='added'?'新纳入':d.change==='removed'?'撤出':'调整'} {d.title} · {d.before?.targetDate||'—'} → {d.after?.targetDate||'—'}{d.before?.acceptanceCriteria!==d.after?.acceptanceCriteria?'；验收标准：'+(d.before?.acceptanceCriteria||'未填写')+' → '+(d.after?.acceptanceCriteria||'未填写'):''}</p>)}</details>)}{history.data?.length===0&&<p>尚无确认记录。</p>}</div>
  </>;
}
