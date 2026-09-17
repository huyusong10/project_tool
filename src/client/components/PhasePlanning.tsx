
import * as planningApi from "../features/planning/api";
import * as requirementsApi from "../features/requirements/api";
import { ReferenceLinksEditor } from "./ReferenceLinks";
import { readReferenceLinks } from "../../shared/reference-links";
import { Button } from "./Button";
import { Select } from "./Select";
import { useDeliveryForm } from "../use-delivery-form";
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, InvalidResponseError, isWriteOutcomeUnknown, jsonBody } from "../api";
import { PhaseChoiceControl } from '../features/planning/PhaseChoiceControl';
import { useIntake } from '../features/planning/use-intake';
import { assertCleanProjectDraft } from "../use-graph-draft";
import { useSession } from "../app-context";
import { useResourceQuery } from "../use-resource-query";
import { invalidateRequirementViews, keys } from "../query-keys";

import { phaseInput, phaseStatusLabels, type FeaturePhase } from "../../shared/feature-phases";
import type { Requirement } from "../types";
import { Modal } from "./Modal";
import { ExecutionStageBadge } from "./ExecutionStageBadge";
import "./phase-planning.css";

import { type PhaseEdit, readPendingPhase, nextPhaseName, type PhaseForm, type PendingPhase, pendingKey } from '../features/planning/phase-model';

export function PhaseStatusBadge({ phase }: { phase: Pick<FeaturePhase,'status'> }) {
  const tone = phase.status === 'completed' ? 'completed' : phase.status === 'in_progress' ? 'development' : 'not_started';
  return <span className={'stage-badge stage-' + tone}>{phaseStatusLabels[phase.status]}</span>;
}

export function PhaseDialog({ edit, onClose, onCreated }: { edit: PhaseEdit; onClose: () => void; onCreated?:(phase:FeaturePhase)=>void }) {
  const { session } = useSession(), client = useQueryClient(), account = session.accountId || session.username || "guest", projectId = edit.feature.projectId;
  const [pending] = useState(() => readPendingPhase(account, projectId));
  const [local,setLocal,clearLocal]=useDeliveryForm(projectId,(edit.phase?.id||edit.feature.id)+':phase:'+edit.mode,()=>({baseline:edit.phase,value:pending?.value || { referenceLinks:edit.phase?.referenceLinks||[],name: edit.phase?.name || nextPhaseName(edit.feature.phases||[]), sortOrder:edit.phase?.sortOrder??edit.feature.phases?.length??0, scope: edit.phase?.scope || '', targetDate: edit.phase?.targetDate || null, note: edit.phase?.note || '', reason: '' } as PhaseForm}),!!pending);
  const [baseline,setBaseline]=useState(local.baseline),[value,setValue]=useState(local.value);
  useEffect(()=>setLocal({baseline,value}),[baseline,value,setLocal]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [needsRead, setNeedsRead] = useState(!!pending), [unknown, setUnknown] = useState(!!pending), lock = useRef(false);
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const persist = (item: PendingPhase | null) => { try { const key = pendingKey(account, projectId); if (item) sessionStorage.setItem(key, JSON.stringify(item)); else sessionStorage.removeItem(key); } catch { /* The open dialog retains input. */ } };
  const changed = () => { invalidateRequirementViews(client); void client.invalidateQueries({ queryKey: ['feature-phases'] }); };
  if (edit.mode === 'placement') return <PhasePlacementDialog edit={edit} onClose={onClose} />;
  if (edit.mode === 'history') return <Modal title={edit.phase!.name + ' · 详情'} width={760} onClose={onClose}><div className="phase-history"><p className="feature-full-text">{edit.phase!.scope || '交付范围待明确'}</p><h3>关联需求</h3>{edit.phase!.requirements.filter(r=>!edit.stageKey||r.executionStage.key===edit.stageKey).map(r => <div className="phase-history-requirement" key={r.id}><Link to={'/requirements/' + r.id}>{r.title}</Link><ExecutionStageBadge requirement={r} />{r.deletedAt && <small>已归档</small>}</div>)}<h3>历史交付记录</h3>{edit.phase!.deliveries.map(d => <article key={d.id}><strong>{d.deliveredAt} · {d.deliveredByName || '原交付人'}</strong><p>{d.snapshot.scope || d.snapshot.name}</p><ul>{d.snapshot.requirements.map(r => <li key={r.id}>{r.title}</li>)}</ul>{d.reopenedAt && <p>重新打开：{d.reopenReason}</p>}</article>)}{!edit.phase!.deliveries.length && <p>尚无交付记录</p>}</div></Modal>;
  const title = { edit: baseline ? '编辑 Phase' : '新建 Phase', delete: '删除空 Phase' }[edit.mode];
  const read = async () => {
    setBusy(true); try {
      const phases = await planningApi.projectsFeaturePhasesQuery<FeaturePhase[]>(projectId, edit.feature.id);
      if (!Array.isArray(phases)) throw new InvalidResponseError(200, false, 'Phase 列表不完整');
      const latest = phases.find(p => baseline ? p.id === baseline.id : p.name === value.name.trim());
      const applied = edit.mode === 'delete' ? !latest : latest && (latest.name === value.name.trim() && latest.scope === value.scope.trim() && latest.targetDate === value.targetDate && latest.note === value.note.trim() && (value.referenceLinks===undefined||JSON.stringify(latest.referenceLinks)===JSON.stringify(readReferenceLinks(value.referenceLinks))) && latest.sortOrder === (value.sortOrder ?? 0));
      if (!alive.current) return;
      if (unknown && applied) { persist(null); clearLocal(); changed(); if(!edit.phase&&edit.mode==='edit'&&latest)onCreated?.(latest); onClose(); return; }
      if (baseline && !latest) { setError('Phase 已不存在，输入仍保留。请关闭后核对特性。'); return; }
      setBaseline(latest); persist(null); setUnknown(false); setNeedsRead(false); setError('已读取最新版本，输入已保留，请核对后保存。'); changed();
    } catch (e) { if (alive.current) setError((e as Error).message); } finally { if (alive.current) setBusy(false); }
  };
  const save = async () => {
    if (lock.current || needsRead) return; lock.current = true; setBusy(true); setError('');
    try {
      const payload = edit.mode === 'edit' ? phaseInput.parse({ sortOrder:value.sortOrder,name: value.name, scope: value.scope, targetDate: value.targetDate, note: value.note,referenceLinks:value.referenceLinks, reason: value.reason, ...(baseline ? { id: baseline.id, expectedVersion: baseline.version } : {}) }) : { expectedVersion: baseline!.version, reason: value.reason };
      await assertCleanProjectDraft(account,projectId,baseline?{requirementId:'',phaseId:baseline.id,action:'phase'}:undefined);
      persist({ edit: { ...edit, phase: baseline }, value, payload });
      const saved = edit.mode === 'delete'
        ? await planningApi.deletePhase(projectId, baseline!.id, payload)
        : await planningApi.savePhase(projectId, edit.feature.id, payload);
      if (!saved?.id || (edit.mode === 'delete' ? !('deleted' in saved && saved.deleted) : !('version' in saved && saved.version > (baseline?.version || 0)))) throw new InvalidResponseError(200, true, 'Phase 保存结果不完整');
      persist(null); clearLocal(); changed(); if (alive.current) {if(!edit.phase&&edit.mode==='edit'&&'version' in saved)onCreated?.(saved);onClose();}
    } catch (e) { if (!alive.current) return; const uncertain = isWriteOutcomeUnknown(e) || e instanceof ApiError && e.status >= 500; setError((e as Error).message); setUnknown(uncertain); setNeedsRead(uncertain || e instanceof ApiError && e.status === 409); if (!uncertain) persist(null); } finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  return <Modal title={title} onClose={onClose} closable={!busy}><form className="feature-form" onSubmit={e => { e.preventDefault(); e.stopPropagation(); void save(); }}><fieldset disabled={busy || unknown}>{edit.mode === 'edit' && <><label className="field"><span>Phase 名称</span><input required maxLength={200} value={value.name} onChange={e => setValue({ ...value, name: e.target.value })} /></label><label className="field"><span>展示顺序</span><input type="number" min={1} step={1} value={(value.sortOrder??0)+1} onChange={e=>setValue({...value,sortOrder:Math.max(0,Number(e.target.value)-1)})}/></label><label className="field"><span>交付范围</span><textarea rows={4} maxLength={10000} value={value.scope} onChange={e => setValue({ ...value, scope: e.target.value })} /></label><label className="field"><span>目标交付日期</span><input type="date" value={value.targetDate || ''} onChange={e => setValue({ ...value, targetDate: e.target.value || null })} /></label><label className="field"><span>关注说明</span><textarea rows={2} maxLength={2000} value={value.note} onChange={e => setValue({ ...value, note: e.target.value })} /></label><ReferenceLinksEditor value={value.referenceLinks??baseline?.referenceLinks??[]} onChange={referenceLinks=>setValue({...value,referenceLinks})}/></>}{edit.mode === 'delete' && <p>删除 {baseline?.name}。</p>}{baseline && <label className="field"><span>变更原因</span><textarea maxLength={2000} rows={2} value={value.reason} onChange={e => setValue({ ...value, reason: e.target.value })} /></label>}</fieldset>{error && <p role="alert" className="warning-banner">{error}</p>}{needsRead && <Button variant="secondary" type="button" className="ghost-button" disabled={busy} onClick={() => void read()}>读取最新 Phase 并核对</Button>}<div className="form-actions"><Button variant="secondary" type="button" className="ghost-button" disabled={busy} onClick={()=>{clearLocal();onClose();}}>取消</Button><Button busy={(busy)} aria-label={busy ? '保存中…' : title} variant={edit.mode === "edit" ? "primary" : "soft"} tone={edit.mode === "delete" ? "danger" : "primary"} type="submit" className="primary-button" disabled={busy || needsRead}>{title}</Button></div></form></Modal>;
}

export function PhasePlacementDialog({ edit, onClose }: { edit: PhaseEdit; onClose: () => void }) {
  const { session } = useSession(), client = useQueryClient(), projectId = edit.feature.projectId, account=session.accountId||session.username||'guest';
  const [pending]=useState(()=>readPendingPhase(account,projectId));
  const [local,setLocal,clearLocal]=useDeliveryForm(projectId,edit.feature.id+':placement:'+(edit.phase?.id||'all')+':'+(edit.requirementIds||[]).join(','),()=>({targetFeatureId:String(pending?.payload.featureId||edit.feature.id),selected:pending?.selected||[] as Requirement[],phaseId:String(pending?.payload.phaseId||edit.phase?.id||''),reason:pending?.value.reason||'',initialized:!!pending}),!!pending);
  const catalog=useIntake(projectId),[targetFeatureId,setTargetFeatureId]=useState(local.targetFeatureId);

  const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const clear=()=>{try{sessionStorage.removeItem(pendingKey(account,projectId));}catch{/* Open dialog retains state. */}};
  const query = useResourceQuery<Requirement[]>([...keys.requirements, projectId, 'phase-placement', session.accountId], signal => requirementsApi.requirementsQuery<Requirement[]>(projectId, { signal }), true);
  const [selected, setSelected] = useState<Requirement[]>(local.selected), [phaseId, setPhaseId] = useState(local.phaseId), [reason, setReason] = useState(local.reason), [error, setError] = useState(''), [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(!!pending);
  const lock = useRef(false), rows = (query.data || []).filter(r => (edit.requirementIds?.length?edit.requirementIds.includes(r.id):true) && !r.deletedAt && !catalog.data?.features.find(f=>f.id===r.featureId)?.archivedAt);
  const initialized=useRef(local.initialized);useEffect(()=>{if(!initialized.current&&query.data&&!pending){initialized.current=true;setSelected(query.data.filter(r=>edit.requirementIds?.includes(r.id)));}},[query.data,edit.requirementIds,pending]);
  useEffect(()=>setLocal({targetFeatureId,selected,phaseId,reason,initialized:initialized.current}),[targetFeatureId,selected,phaseId,reason,setLocal]);
  const save = async () => {
    if (lock.current || blocked) return; lock.current = true; setBusy(true); setError('');
    try { for(const r of selected)await assertCleanProjectDraft(account,projectId,{requirementId:r.id,action:'phase'});
      const payload={ requirements: selected.map(r => ({ id: r.id, expectedVersion: r.version })), featureId: targetFeatureId, phaseId: phaseId || null, reason };
      sessionStorage.setItem(pendingKey(account,projectId),JSON.stringify({edit,selected,payload,value:{name:'',scope:'',targetDate:null,note:'',reason}}));
      const result=await planningApi.projectsRequirementPlacement<{features:unknown[]}>(projectId, { method: 'POST', body: jsonBody(payload) });
      if(!result||!Array.isArray(result.features))throw new InvalidResponseError(200,true,'需求安排返回不完整');
      clear();clearLocal();if(alive.current){invalidateRequirementViews(client);onClose();} }
    catch (e) { if(alive.current){setError((e as Error).message); const uncertain=isWriteOutcomeUnknown(e)||e instanceof ApiError&&e.status>=500;setBlocked(uncertain||e instanceof ApiError&&e.status===409);if(!uncertain)clear();} } finally { lock.current = false;if(alive.current)setBusy(false); }
  };
  return <Modal title={edit.requirementIds?.length?'调整需求归属':'移入需求'} width={760} onClose={onClose} closable={!busy}><form className="feature-form" onSubmit={e => { e.preventDefault(); e.stopPropagation(); void save(); }}><fieldset disabled={busy || blocked}><label className="field"><span>目标特性</span><Select aria-label="目标特性" value={targetFeatureId} onChange={e=>{setTargetFeatureId(e.target.value);setPhaseId('');}}>{catalog.data?.features.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</Select></label>{catalog.data?.features.find(f=>f.id===targetFeatureId)?.kind!=='other'&&<PhaseChoiceControl Editor={PhaseDialog} key={targetFeatureId} projectId={projectId} featureId={targetFeatureId} value={phaseId} onChange={setPhaseId} label="目标 Phase"/>}<div className="phase-pick-list">{rows.map(r => <label key={r.id}><input type="checkbox" checked={selected.some(s => s.id === r.id)} onChange={e => setSelected(old => e.target.checked ? [...old, r] : old.filter(s => s.id !== r.id))} /><span>{r.title}<small>{r.featureName||'其他需求'} / {r.phaseName || '未分派 Phase'}</small></span><ExecutionStageBadge requirement={r} /></label>)}</div><label className="field"><span>调整原因</span><textarea rows={2} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></label></fieldset>{(error || query.error) && <p role="alert" className="warning-banner">{error || query.error?.message}</p>}{blocked && <Button variant="secondary" type="button" disabled={busy} className="ghost-button" onClick={() => void query.refetch().then(r => { if (!alive.current||r.error || !r.data) return; clear(); if (selected.every(s => r.data!.some(n => n.id === s.id && (n.phaseId || '') === phaseId&&n.featureId===targetFeatureId))) { clearLocal(); invalidateRequirementViews(client); onClose(); } else { setSelected(old => old.flatMap(s => r.data!.filter(n => n.id === s.id))); setBlocked(false); setError('已读取最新资料，请核对后继续。'); } })}>读取最新归属并核对</Button>}<div className="form-actions"><Button variant="secondary" type="button" className="ghost-button" disabled={busy} onClick={()=>{clearLocal();onClose();}}>取消</Button><Button variant="primary" type="submit" className="primary-button" disabled={busy || blocked || !selected.length || query.unavailable}>保存安排</Button></div></form></Modal>;
}

export type { PhaseEdit } from '../features/planning/phase-model';
export { readPendingPhase } from '../features/planning/phase-model';
export { nextPhaseName } from '../features/planning/phase-model';
