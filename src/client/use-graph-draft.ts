import {rebaseEditor} from './editor-rebase';
import { useEffect, useRef, useState } from 'react';
import {readDraftRecord,writeDraftRecord,clearDraftRecords,ownsDraft,takeDraft,releaseDraft} from './graph-draft-storage';
import { api, ApiError, isWriteOutcomeUnknown, jsonBody } from './api';
import type { DependencyChanges, DependencyChangePreview, DependencyChangeReceipt, DependencyChangesInput } from '../shared/path-contracts';
import type { PathAnalysis } from '../shared/paths';

const prefix = 'pm-graph-draft:';
export function clearGraphDrafts(accountId?: string) {
  void clearDraftRecords(prefix+(accountId?accountId+':':'')).catch(()=>{});
  if (typeof sessionStorage === 'undefined') return;
  for(const storage of [sessionStorage,localStorage])for (const key of Object.keys(storage)) if ([prefix,'pm-path-origin:','pm-path-view:','pm-graph-view:','pm-detail-scroll:','pm-editor-new-template:','pm-editor-lease:pm-graph-draft:'].some(p=>key.startsWith(p+(accountId?accountId+':':'')))) storage.removeItem(key);
}
export function clearProjectGraphDrafts(accountId:string,projectId:string){
  const base=prefix+accountId+':'+projectId;void clearDraftRecords(base).catch(()=>{});
  for(const storage of [sessionStorage,localStorage])for(const key of Object.keys(storage))if(key===base||key.startsWith(base+':')||['pm-path-origin:','pm-path-view:','pm-graph-view:','pm-detail-scroll:','pm-editor-new-template:','pm-editor-lease:pm-graph-draft:'].some(p=>(key===p+accountId+':'+projectId||key.startsWith(p+accountId+':'+projectId+':'))))storage.removeItem(key);
}
type History<T> = { version: string; values: T[]; index: number; active: boolean; baseline?:T; server?:PathAnalysis };
export function useGraphHistory<T>(key: string, initial: T, version: string, source?:PathAnalysis) {
  const storageKey = prefix + key, initialRef = useRef(initial);
  const [state, setState] = useState<History<T>>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null') as History<T> | null;
      if (saved && Array.isArray(saved.values) && saved.index >= 0 && saved.index < saved.values.length) return saved;
    } catch { /* Invalid or unavailable session storage starts a fresh draft. */ }
    return { version, values: [initial], index: 0, active: false,server:source };
  });
  const [loading,setLoading]=useState(true),[storageError,setStorageError]=useState(''),[restored,setRestored]=useState(false),[readOnly,setReadOnly]=useState(false);
  const ref = useRef(state); ref.current = state;
  const ready=useRef(false),beginRequested=useRef(false);
  useEffect(()=>{let cancelled=false;ready.current=false;setLoading(true);
    void readDraftRecord<History<T>>(storageKey).then(saved=>{if(cancelled)return;
      if(saved&&Array.isArray(saved.values)&&saved.index>=0&&saved.index<saved.values.length){ref.current=saved;setState(saved);setRestored(saved.active);}
      else if(ref.current.active){void writeDraftRecord(storageKey,ref.current).catch(()=>setStorageError('本机草稿保存失败，关闭页面可能丢失修改'));}
      ready.current=true;setLoading(false);if(beginRequested.current){ref.current={...ref.current,active:true};setState(ref.current);}
      setReadOnly(!ownsDraft(storageKey,ref.current.active));
    }).catch(()=>{if(!cancelled){ready.current=true;setLoading(false);setStorageError('本机存储不可用，草稿仅保留在当前页面');}});
    const refresh=()=>setReadOnly(!ownsDraft(storageKey,ref.current.active)),timer=setInterval(refresh,15000),leave=()=>releaseDraft(storageKey);
    window.addEventListener('storage',refresh);window.addEventListener('pagehide',leave);
    return()=>{cancelled=true;clearInterval(timer);window.removeEventListener('storage',refresh);window.removeEventListener('pagehide',leave);releaseDraft(storageKey);};
  },[storageKey]);
  const editingGroup=useRef<string|null>(null);
  const update = (next: History<T>) => {
    if(!ready.current){beginRequested.current=next.active;return;}
    if(!ownsDraft(storageKey,true)){setReadOnly(true);return;}
    if(next.values.length>101){const drop=next.values.length-101;next={...next,baseline:next.baseline||next.values[0],values:next.values.slice(drop),index:Math.max(0,next.index-drop)};}
    ref.current = next; setState(next);
    void writeDraftRecord(storageKey,next.active?next:undefined).then(()=>setStorageError('')).catch(()=>setStorageError('本机草稿保存失败，关闭页面可能丢失修改'));
    try { if (next.active) sessionStorage.setItem(storageKey, JSON.stringify(next)); else sessionStorage.removeItem(storageKey); } catch { /* In-memory draft remains usable. */ }
  };
  return {
    source:state.server,baseline:state.baseline||state.values[0],value: state.values[state.index], active: state.active, version: state.version, dirty: JSON.stringify(state.values[state.index])!==JSON.stringify(state.baseline||state.values[0]),
    loading,storageError,restored,readOnly,takeOver:async()=>{const saved=await readDraftRecord<History<T>>(storageKey);takeDraft(storageKey);if(saved){ref.current=saved;setState(saved);}setReadOnly(false);},
    canUndo: state.index > 0, canRedo: state.index < state.values.length - 1,
    begin: () => update({ ...ref.current, active: true }),
    endGroup: () => {editingGroup.current=null;},
    change: (value: T, group?: string) => {
      const old = ref.current; if (JSON.stringify(old.values[old.index]) === JSON.stringify(value)) return;
      if(group&&editingGroup.current===group&&old.index>0){update({...old,values:[...old.values.slice(0,old.index),value]});return;}
      editingGroup.current=group||null;
      update({ ...old, active: true, server:old.values.length===1?source:old.server||source,values: [...old.values.slice(0, old.index + 1), value], index: old.index + 1 });
    },
    undo: () => { editingGroup.current=null; const old = ref.current; if (old.index) update({ ...old, index: old.index - 1 }); },
    redo: () => { editingGroup.current=null; const old = ref.current; if (old.index + 1 < old.values.length) update({ ...old, index: old.index + 1 }); },
    reset: (next = initialRef.current, nextVersion = version) => update({ version: nextVersion, values: [next],baseline:next, index: 0, active: false,server:source }),
    rebase: (nextVersion: string, value = ref.current.values[ref.current.index]) => update({ ...ref.current, version: nextVersion,server:source,baseline:initial,values: [initial, value], index: 1 }),
  };
}
const empty: DependencyChanges = { add: [], remove: [], estimates: [] };
type PendingBatch = DependencyChangesInput & { batchId: string; previewToken: string };
export function useDependencyDraft(accountId: string, data: PathAnalysis, target: string, onSaved: (receipt?:DependencyChangeReceipt) => void) {
  const key = accountId + ':' + data.projectId, history = useGraphHistory(key, empty, String(data.revision),data);
  const pendingKey = prefix + key + ':submission';
  const [pendingReady,setPendingReady]=useState(false);
  const [pending, setPending] = useState<PendingBatch | null>(() => {
    try { return JSON.parse(sessionStorage.getItem(pendingKey) || 'null'); } catch { return null; }
  });
  const [preview, setPreview] = useState<DependencyChangePreview | null>(null), [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false), [previewing, setPreviewing] = useState(false);
  const [previewAttempt,setPreviewAttempt]=useState(0);
  const saving = useRef(false), generation = useRef(0), latest = useRef<DependencyChangePreview | null>(null);
  const denied=useRef(()=>{});denied.current=()=>{history.reset();onSaved();};
  const changes = history.value, count = changes.add.length + changes.remove.length + changes.estimates.length+(changes.entities?.length||0)+(changes.layouts?.length||0);
  const resolutionVersion=JSON.stringify([data.revision,data.layouts?.map(l=>[l.scope,l.direction,l.version])]);
  const [resolutionState,setResolutionState]=useState<{version:string;values:Record<string,'draft'|'server'>}>({version:resolutionVersion,values:{}});
  const resolutions=resolutionState.version===resolutionVersion?resolutionState.values:{};
  const rebased=rebaseEditor(history.source,data,changes,resolutions);
  const conflict = count > 0 && (Number(history.version) !== data.revision || (changes.layouts||[]).some(l=>l.expectedVersion!==(data.layouts?.find(v=>v.scope===l.scope&&v.direction===l.direction)?.version||0)));
  const input: DependencyChangesInput = { expectedRevision: count ? Number(history.version) : data.revision, target, changes };
  const fingerprint = JSON.stringify(input);
  useEffect(() => {
    const current = ++generation.current; setPreview(null); latest.current = null;
    if (!count || conflict || pending) { setPreviewing(false); return; }
    const controller = new AbortController(); setPreviewing(true);
    const timer = setTimeout(() => {
      void api<DependencyChangePreview>('/api/projects/' + data.projectId + '/dependency-changes/preview', {
        method: 'POST', body: fingerprint, readOnly: true, signal: controller.signal,
      }).then(result => {
        if (current === generation.current) { setPreview(result); latest.current = result; setError(null); }
      }).catch(caught => { if (current === generation.current && !controller.signal.aborted) {setError(caught);if(caught instanceof ApiError&&[401,403].includes(caught.status))denied.current();} })
        .finally(() => { if (current === generation.current) setPreviewing(false); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [fingerprint, count, conflict, pending, data.projectId,data.asOfDate,previewAttempt]);
  useEffect(()=>{let stopped=false;setPendingReady(false);void readDraftRecord<PendingBatch>(pendingKey).then(value=>{if(!stopped&&value)setPending(value);}).catch(()=>{}).finally(()=>{if(!stopped)setPendingReady(true);});return()=>{stopped=true;};},[pendingKey]);
  const storePending = (value: PendingBatch | null) => {
    void writeDraftRecord(pendingKey,value||undefined).catch(()=>{});
    setPending(value); try { if (value) sessionStorage.setItem(pendingKey, JSON.stringify(value)); else sessionStorage.removeItem(pendingKey); } catch { /* In-memory receipt recovery still works. */ }
  };
  const success = (receipt:DependencyChangeReceipt) => { storePending(null); history.reset(); setPreview(null); latest.current = null; setError(null); onSaved(receipt); };
  const checkReceipt = async (batch: PendingBatch) => {
    const receipt = await api<({ status: 'applied' } & DependencyChangeReceipt) | { status: 'not_found' }>(
      '/api/projects/' + data.projectId + '/dependency-changes/' + batch.batchId, { readOnly: true });
    if (receipt.status === 'applied') { success(receipt); return true; }
    return false;
  };
  const save = async () => {
    if (!pendingReady||history.loading||history.readOnly||saving.current || (!pending && (!latest.current || conflict || !count))) return false;
    saving.current = true; setBusy(true);
    const batch = pending || { ...input, batchId: crypto.randomUUID(), previewToken: latest.current!.previewToken };
    try {
      if (pending && await checkReceipt(batch)) return true;
      await writeDraftRecord(pendingKey,batch);storePending(batch);
      const receipt=await api<DependencyChangeReceipt>('/api/projects/' + data.projectId + '/dependency-changes/apply', { method: 'POST', body: jsonBody(batch) });
      success(receipt); return true;
    } catch (caught) {
      const failure = caught as Error;
      if (isWriteOutcomeUnknown(failure) || failure instanceof ApiError && failure.status >= 500) {
        try { if (await checkReceipt(batch)) return true; } catch { /* Keep the exact batch for a later receipt check. */ }
        setError(new Error('提交结果待核对。修改已保留，请查询回执后重试同一批次。'));
      } else { storePending(null); setError(failure); latest.current = null; setPreview(null);if(failure instanceof ApiError&&[401,403].includes(failure.status))history.reset();setPreviewAttempt(n=>n+1); onSaved(); }
      return false;
    } finally { saving.current = false; setBusy(false); }
  };
  return {
    ...history,loading:history.loading||!pendingReady,changes,count,conflict,conflicts:conflict?rebased.conflicts:[],unresolved:rebased.pending.length,resolveConflict:(key:string,value:'draft'|'server')=>setResolutionState(old=>({version:resolutionVersion,values:{...(old.version===resolutionVersion?old.values:{}),[key]:value}})),preview, previewing, busy, pending, error, save,retryPreview:()=>setPreviewAttempt(n=>n+1),
    issue: error instanceof ApiError ? error.details as { nodeIds?: string[]; edgeIds?: string[] } | undefined : undefined,
    cancel: () => { if (!pending) { history.reset(empty, String(data.revision)); setError(null); } },
    change: (next: DependencyChanges) => { if (!pending && !saving.current && JSON.stringify(next)!==JSON.stringify(changes)) { latest.current = null; setPreview(null); setError(null); if (!count && Number(history.version) !== data.revision) history.rebase(String(data.revision), next); else history.change(next); } },
    rebase: () => {
      if(rebased.pending.length)return;history.rebase(String(data.revision),rebased.changes);setResolutionState({version:resolutionVersion,values:{}});
      setError(null);
    },
  };
}
