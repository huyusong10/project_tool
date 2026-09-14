import {Select} from './Select';
import {useDeliveryForm} from '../use-delivery-form';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, InvalidResponseError, isWriteOutcomeUnknown, jsonBody } from '../api';
import {useIntake} from './RequirementIntake';
import {assertCleanProjectDraft} from '../use-graph-draft';
import { useSession } from '../app-context';
import { useResourceQuery } from '../use-resource-query';
import { invalidateRequirementViews, keys } from '../query-keys';
import type { FeatureOverview } from '../../shared/feature-overview';
import { phaseInput, phaseStatusLabels, type FeaturePhase } from '../../shared/feature-phases';
import { todayIso } from '../../shared/domain';
import type { Requirement } from '../types';
import { Modal } from './Modal';
import { ExecutionStageBadge } from './ExecutionStageBadge';
import './phase-planning.css';

export type PhaseEdit = { requirementIds?:string[]; feature: FeatureOverview; phase?: FeaturePhase; stageKey?:string; mode: 'edit' | 'deliver' | 'reopen' | 'delete' | 'placement' | 'history' };
type PhaseForm = { sortOrder?:number; name: string; scope: string; targetDate: string | null; note: string; reason: string; deliveredAt: string };
type PendingPhase = { edit: PhaseEdit; value: PhaseForm; payload: Record<string, unknown>; selected?:Requirement[] };
const pendingKey = (account: string, project: string) => 'pm-phase-write:' + account + ':' + project;
export function readPendingPhase(account: string, project: string): PendingPhase | null {
  try { const value = JSON.parse(sessionStorage.getItem(pendingKey(account, project)) || 'null') as PendingPhase | null; return value?.edit.feature.projectId === project && value.payload && value.value ? value : null; } catch { return null; }
}
export function PhaseStatusBadge({ phase }: { phase: Pick<FeaturePhase,'status'> }) {
  const tone = phase.status === 'delivered' ? 'completed' : phase.status === 'ready' ? 'submitted' : phase.status === 'in_progress' ? 'development' : 'not_started';
  return <span className={'stage-badge stage-' + tone}>{phaseStatusLabels[phase.status]}</span>;
}
export function PhaseRows({ feature, manage, onEdit, status = '', attention = false, from = '', through = '' }: { feature: FeatureOverview; manage: boolean; onEdit: (edit: PhaseEdit) => void; status?: string; attention?: boolean; from?: string; through?: string }) {
  const phases = (feature.phases || []).filter(p => (!status || p.status === status) && (!attention || p.overdue || !!p.note) && (!from || !!p.targetDate && p.targetDate >= from) && (!through || !!p.targetDate && p.targetDate <= through));
  return <div className="phase-list"><div className="phase-list-heading"><span>{feature.phases?.length || 0} 个 Phase{feature.unassignedPhaseCount ? ' · ' + feature.unassignedPhaseCount + ' 个需求未安排 Phase' : ''}</span></div>{phases.map(phase => <article className="phase-row" key={phase.id} data-testid="phase-row"><div className="phase-row-target"><strong>{phase.name}</strong><p>{phase.scope || '交付范围待明确'}</p></div><div className="phase-row-state"><PhaseStatusBadge phase={phase} /><div className="phase-distribution">{phase.distribution.map(s => <button className={"stage-badge stage-"+(phase.requirements.find(r=>r.executionStage.key===s.key)?.executionStage.tone||"not_started")} key={s.key} onClick={()=>onEdit({feature,phase,mode:'history',stageKey:s.key})}>{s.label} {s.count}</button>)}</div>{!phase.requirements.length && <small>尚未安排需求</small>}</div><div className="phase-row-date"><small>目标交付</small><span>{phase.targetDate || '尚未安排'}</span>{phase.deliveredAt&&<><small>实际交付</small><span>{phase.deliveredAt}</span></>}{phase.overdue && <span className="danger-text">已超过目标日期</span>}</div><div className="phase-row-note"><p>{phase.note || '—'}</p></div><div className="phase-row-actions"><Link className="ghost-button" to={'/requirements?' + new URLSearchParams({ feature: feature.id, phase: phase.id })}>需求</Link><button className="ghost-button" onClick={() => onEdit({ feature, phase, mode: 'history' })}>详情</button>{manage && !feature.archivedAt && <><button className="ghost-button" onClick={() => onEdit({ feature, phase, mode: phase.deliveredAt ? 'reopen' : 'edit' })}>{phase.deliveredAt ? '重新打开' : '编辑'}</button>{!phase.deliveredAt && <button className="ghost-button" onClick={() => onEdit({ feature, phase, mode: 'placement' })}>安排需求</button>}{!phase.requirements.length && !phase.deliveries.length && <button className="ghost-button danger-text" onClick={() => onEdit({ feature, phase, mode: 'delete' })}>删除</button>}{phase.status === 'ready' && <button className="primary-button" onClick={() => onEdit({ feature, phase, mode: 'deliver' })}>确认交付</button>}</>}</div></article>)}{!phases.length && <p className="field-help">{feature.phases?.length ? '没有符合筛选条件的 Phase' : '尚未规划 Phase，可以先记录下一次交付目标。'}</p>}</div>;
}
export function PhaseDialog({ edit, onClose }: { edit: PhaseEdit; onClose: () => void }) {
  const { session } = useSession(), client = useQueryClient(), account = session.accountId || session.username || "guest", projectId = edit.feature.projectId;
  const [pending] = useState(() => readPendingPhase(account, projectId));
  const [local,setLocal,clearLocal]=useDeliveryForm(projectId,(edit.phase?.id||edit.feature.id)+':phase:'+edit.mode,()=>({baseline:edit.phase,value:pending?.value || { name: edit.phase?.name || 'Phase ' + (Math.max(0, ...(edit.feature.phases || []).map(p => Number(/^Phase (\d+)$/.exec(p.name)?.[1] || 0))) + 1), sortOrder:edit.phase?.sortOrder??edit.feature.phases?.length??0, scope: edit.phase?.scope || '', targetDate: edit.phase?.targetDate || null, note: edit.phase?.note || '', reason: '', deliveredAt: todayIso() } as PhaseForm}),!!pending);
  const [baseline,setBaseline]=useState(local.baseline),[value,setValue]=useState(local.value);
  useEffect(()=>setLocal({baseline,value}),[baseline,value,setLocal]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [needsRead, setNeedsRead] = useState(!!pending), [unknown, setUnknown] = useState(!!pending), lock = useRef(false);
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const persist = (item: PendingPhase | null) => { try { const key = pendingKey(account, projectId); if (item) sessionStorage.setItem(key, JSON.stringify(item)); else sessionStorage.removeItem(key); } catch { /* The open dialog retains input. */ } };
  const changed = () => { invalidateRequirementViews(client); void client.invalidateQueries({ queryKey: ['feature-phases'] }); };
  if (edit.mode === 'placement') return <PhasePlacementDialog edit={edit} onClose={onClose} />;
  if (edit.mode === 'history') return <Modal title={edit.phase!.name + ' · 详情'} width={760} onClose={onClose}><div className="phase-history"><p className="feature-full-text">{edit.phase!.scope || '交付范围待明确'}</p><h3>关联需求</h3>{edit.phase!.requirements.filter(r=>!edit.stageKey||r.executionStage.key===edit.stageKey).map(r => <div className="phase-history-requirement" key={r.id}><Link to={'/requirements/' + r.id}>{r.title}</Link><ExecutionStageBadge requirement={r} />{r.deletedAt && <small>已归档</small>}</div>)}<h3>交付记录</h3>{edit.phase!.deliveries.map(d => <article key={d.id}><strong>{d.deliveredAt} · {d.deliveredByName || '原交付人'}</strong><p>{d.snapshot.scope || d.snapshot.name}</p><ul>{d.snapshot.requirements.map(r => <li key={r.id}>{r.title}</li>)}</ul>{d.reopenedAt && <p>重新打开：{d.reopenReason}</p>}</article>)}{!edit.phase!.deliveries.length && <p>尚无交付记录</p>}</div></Modal>;
  const title = { edit: baseline ? '编辑 Phase' : '新增 Phase', deliver: '确认交付', reopen: '重新打开 Phase', delete: '删除空 Phase' }[edit.mode];
  const read = async () => {
    setBusy(true); try {
      const phases = await api<FeaturePhase[]>('/api/projects/' + projectId + '/feature-phases?featureId=' + edit.feature.id);
      if (!Array.isArray(phases)) throw new InvalidResponseError(200, false, 'Phase 列表不完整');
      const latest = phases.find(p => baseline ? p.id === baseline.id : p.name === value.name.trim());
      const applied = edit.mode === 'delete' ? !latest : latest && (edit.mode === 'deliver' ? latest.deliveredAt === value.deliveredAt : edit.mode === 'reopen' ? !latest.deliveredAt && latest.version > (baseline?.version || 0) : latest.name === value.name.trim() && latest.scope === value.scope.trim() && latest.targetDate === value.targetDate && latest.note === value.note.trim() && latest.sortOrder === (value.sortOrder ?? 0));
      if (!alive.current) return;
      if (unknown && applied) { persist(null); clearLocal(); changed(); onClose(); return; }
      if (baseline && !latest) { setError('Phase 已不存在，输入仍保留。请关闭后核对特性。'); return; }
      if (latest?.deliveredAt && edit.mode === 'edit') { setError('Phase 已交付，须先重新打开才能编辑。'); return; }
      setBaseline(latest); persist(null); setUnknown(false); setNeedsRead(false); setError('已读取最新版本，输入已保留，请核对后保存。'); changed();
    } catch (e) { if (alive.current) setError((e as Error).message); } finally { if (alive.current) setBusy(false); }
  };
  const save = async () => {
    if (lock.current || needsRead) return; lock.current = true; setBusy(true); setError('');
    try {
      const payload = edit.mode === 'edit' ? phaseInput.parse({ sortOrder:value.sortOrder,name: value.name, scope: value.scope, targetDate: value.targetDate, note: value.note, reason: value.reason, ...(baseline ? { id: baseline.id, expectedVersion: baseline.version } : {}) }) : { expectedVersion: baseline!.version, reason: value.reason, ...(edit.mode === 'deliver' ? { deliveredAt: value.deliveredAt } : {}) };
      if(baseline)await assertCleanProjectDraft(account,projectId,{requirementId:'',phaseId:baseline.id,action:'phase'});
      persist({ edit: { ...edit, phase: baseline }, value, payload });
      const url = '/api/projects/' + projectId + (edit.mode === 'edit' ? '/features/' + edit.feature.id + '/phases' : '/feature-phases/' + baseline!.id + (edit.mode === 'delete' ? '' : '/' + edit.mode));
      const saved = await api<FeaturePhase | { id: string; deleted: boolean }>(url, { method: edit.mode === 'delete' ? 'DELETE' : 'POST', body: jsonBody(payload) });
      if (!saved?.id || (edit.mode === 'delete' ? !('deleted' in saved && saved.deleted) : !('version' in saved && saved.version > (baseline?.version || 0)))) throw new InvalidResponseError(200, true, 'Phase 保存结果不完整');
      persist(null); clearLocal(); changed(); if (alive.current) onClose();
    } catch (e) { if (!alive.current) return; const uncertain = isWriteOutcomeUnknown(e) || e instanceof ApiError && e.status >= 500; setError((e as Error).message); setUnknown(uncertain); setNeedsRead(uncertain || e instanceof ApiError && e.status === 409); if (!uncertain) persist(null); } finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  return <Modal title={title} onClose={onClose} closable={!busy}><form className="feature-form" onSubmit={e => { e.preventDefault(); void save(); }}><fieldset disabled={busy || unknown}>{edit.mode === 'edit' && <><label className="field"><span>Phase 名称</span><input required maxLength={200} value={value.name} onChange={e => setValue({ ...value, name: e.target.value })} /></label><label className="field"><span>展示顺序</span><input type="number" min={1} step={1} value={(value.sortOrder??0)+1} onChange={e=>setValue({...value,sortOrder:Math.max(0,Number(e.target.value)-1)})}/></label><label className="field"><span>交付范围</span><textarea rows={4} maxLength={10000} value={value.scope} onChange={e => setValue({ ...value, scope: e.target.value })} /></label><label className="field"><span>目标交付日期</span><input type="date" value={value.targetDate || ''} onChange={e => setValue({ ...value, targetDate: e.target.value || null })} /></label><label className="field"><span>关注说明</span><textarea rows={2} maxLength={2000} value={value.note} onChange={e => setValue({ ...value, note: e.target.value })} /></label></>}{edit.mode === 'deliver' && <><p>确认 {baseline?.name} 已实际交付，保存本次交付范围和需求清单。</p><label className="field"><span>实际交付日期</span><input required type="date" max={todayIso()} value={value.deliveredAt} onChange={e => setValue({ ...value, deliveredAt: e.target.value })} /></label></>}{edit.mode === 'delete' && <p>删除 {baseline?.name}。</p>}{(baseline || edit.mode === 'reopen') && <label className="field"><span>变更原因</span><textarea required={edit.mode === 'reopen'} maxLength={2000} rows={2} value={value.reason} onChange={e => setValue({ ...value, reason: e.target.value })} /></label>}</fieldset>{error && <p role="alert" className="warning-banner">{error}</p>}{needsRead && <button type="button" className="ghost-button" disabled={busy} onClick={() => void read()}>读取最新 Phase 并核对</button>}<div className="form-actions"><button type="button" className="ghost-button" disabled={busy} onClick={onClose}>关闭</button><button className="primary-button" disabled={busy || needsRead}>{busy ? '保存中…' : title}</button></div></form></Modal>;
}
function PhasePlacementDialog({ edit, onClose }: { edit: PhaseEdit; onClose: () => void }) {
  const { session } = useSession(), client = useQueryClient(), projectId = edit.feature.projectId, account=session.accountId||session.username||'guest';
  const [pending]=useState(()=>readPendingPhase(account,projectId));
  const [local,setLocal,clearLocal]=useDeliveryForm(projectId,edit.feature.id+':placement:'+(edit.phase?.id||'all')+':'+(edit.requirementIds||[]).join(','),()=>({targetFeatureId:String(pending?.payload.featureId||edit.feature.id),selected:pending?.selected||[] as Requirement[],phaseId:String(pending?.payload.phaseId||edit.phase?.id||''),reason:pending?.value.reason||'',initialized:!!pending}),!!pending);
  const catalog=useIntake(projectId),[targetFeatureId,setTargetFeatureId]=useState(local.targetFeatureId);
  const targetPhases=useResourceQuery<FeaturePhase[]>(['feature-phases',projectId,targetFeatureId],'/api/projects/'+projectId+'/feature-phases?featureId='+targetFeatureId,!!targetFeatureId);

  const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const clear=()=>{try{sessionStorage.removeItem(pendingKey(account,projectId));}catch{/* Open dialog retains state. */}};
  const query = useResourceQuery<Requirement[]>([...keys.requirements, projectId, 'phase-placement', session.accountId], '/api/requirements?projectId=' + projectId, true);
  const [selected, setSelected] = useState<Requirement[]>(local.selected), [phaseId, setPhaseId] = useState(local.phaseId), [reason, setReason] = useState(local.reason), [error, setError] = useState(''), [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(!!pending);
  const lock = useRef(false), rows = (query.data || []).filter(r => (edit.requirementIds?.length?edit.requirementIds.includes(r.id):r.featureId === edit.feature.id) && !r.deletedAt);
  const initialized=useRef(local.initialized);useEffect(()=>{if(!initialized.current&&query.data&&!pending){initialized.current=true;setSelected(query.data.filter(r=>edit.requirementIds?.includes(r.id)));}},[query.data,edit.requirementIds,pending]);
  useEffect(()=>setLocal({targetFeatureId,selected,phaseId,reason,initialized:initialized.current}),[targetFeatureId,selected,phaseId,reason,setLocal]);
  const save = async () => {
    if (lock.current || blocked) return; lock.current = true; setBusy(true); setError('');
    try { for(const r of selected)await assertCleanProjectDraft(account,projectId,{requirementId:r.id,action:'phase'});
      const payload={ requirements: selected.map(r => ({ id: r.id, expectedVersion: r.version })), featureId: targetFeatureId, phaseId: phaseId || null, reason };
      sessionStorage.setItem(pendingKey(account,projectId),JSON.stringify({edit,selected,payload,value:{name:'',scope:'',targetDate:null,note:'',reason,deliveredAt:''}}));
      const result=await api<{features:unknown[]}>('/api/projects/' + projectId + '/requirement-placement', { method: 'POST', body: jsonBody(payload) });
      if(!result||!Array.isArray(result.features))throw new InvalidResponseError(200,true,'需求安排返回不完整');
      clear();clearLocal();if(alive.current){invalidateRequirementViews(client);onClose();} }
    catch (e) { if(alive.current){setError((e as Error).message); const uncertain=isWriteOutcomeUnknown(e)||e instanceof ApiError&&e.status>=500;setBlocked(uncertain||e instanceof ApiError&&e.status===409);if(!uncertain)clear();} } finally { lock.current = false;if(alive.current)setBusy(false); }
  };
  return <Modal title="安排需求到 Phase" width={760} onClose={onClose} closable={!busy}><form className="feature-form" onSubmit={e => { e.preventDefault(); void save(); }}><fieldset disabled={busy || blocked}><label className="field"><span>目标特性</span><Select aria-label="目标特性" value={targetFeatureId} onChange={e=>{setTargetFeatureId(e.target.value);setPhaseId('');}}>{catalog.data?.features.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</Select></label><label className="field"><span>安排到</span><Select value={phaseId} onChange={e => setPhaseId(e.target.value)}><option value="">未安排 Phase</option>{targetPhases.data?.filter(p => !p.deliveredAt).map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</Select></label><div className="phase-pick-list">{rows.map(r => <label key={r.id}><input type="checkbox" checked={selected.some(s => s.id === r.id)} onChange={e => setSelected(old => e.target.checked ? [...old, r] : old.filter(s => s.id !== r.id))} /><span>{r.title}<small>{r.phaseName || '未安排 Phase'}</small></span><ExecutionStageBadge requirement={r} /></label>)}</div><label className="field"><span>调整原因</span><textarea rows={2} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></label></fieldset>{(error || query.error) && <p role="alert" className="warning-banner">{error || query.error?.message}</p>}{blocked && <button type="button" disabled={busy} className="ghost-button" onClick={() => void query.refetch().then(r => { if (!alive.current||r.error || !r.data) return; clear(); if (selected.every(s => r.data!.some(n => n.id === s.id && (n.phaseId || '') === phaseId&&n.featureId===targetFeatureId))) { clearLocal(); invalidateRequirementViews(client); onClose(); } else { setSelected(old => old.flatMap(s => r.data!.filter(n => n.id === s.id))); setBlocked(false); setError('已读取最新资料，请核对后继续。'); } })}>读取最新归属并核对</button>}<div className="form-actions"><button type="button" className="ghost-button" disabled={busy} onClick={onClose}>关闭</button><button className="primary-button" disabled={busy || blocked || !selected.length || query.unavailable}>保存安排</button></div></form></Modal>;
}
