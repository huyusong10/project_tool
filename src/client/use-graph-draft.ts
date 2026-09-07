import { useEffect, useRef, useState } from 'react';
import { api, ApiError, isWriteOutcomeUnknown, jsonBody } from './api';
import type { DependencyChanges, DependencyChangePreview, DependencyChangeReceipt, DependencyChangesInput } from '../shared/path-contracts';
import type { PathAnalysis } from '../shared/paths';

const prefix = 'pm-graph-draft:';
export function clearGraphDrafts(accountId?: string) {
  if (typeof sessionStorage === 'undefined') return;
  for (const key of Object.keys(sessionStorage)) if (key.startsWith(prefix + (accountId ? accountId + ':' : ''))) sessionStorage.removeItem(key);
}
export function clearProjectGraphDrafts(accountId:string,projectId:string){
  const base=prefix+accountId+':'+projectId;
  for(const key of Object.keys(sessionStorage))if(key===base||key.startsWith(base+':'))sessionStorage.removeItem(key);
}
type History<T> = { version: string; values: T[]; index: number; active: boolean };
export function useGraphHistory<T>(key: string, initial: T, version: string) {
  const storageKey = prefix + key, initialRef = useRef(initial);
  const [state, setState] = useState<History<T>>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null') as History<T> | null;
      if (saved && Array.isArray(saved.values) && saved.index >= 0 && saved.index < saved.values.length) return saved;
    } catch { /* Invalid or unavailable session storage starts a fresh draft. */ }
    return { version, values: [initial], index: 0, active: false };
  });
  const ref = useRef(state); ref.current = state;
  const editingGroup=useRef<string|null>(null);
  const update = (next: History<T>) => {
    ref.current = next; setState(next);
    try { if (next.active) sessionStorage.setItem(storageKey, JSON.stringify(next)); else sessionStorage.removeItem(storageKey); } catch { /* In-memory draft remains usable. */ }
  };
  return {
    value: state.values[state.index], active: state.active, version: state.version, dirty: state.index > 0,
    canUndo: state.index > 0, canRedo: state.index < state.values.length - 1,
    begin: () => update({ ...ref.current, active: true }),
    endGroup: () => {editingGroup.current=null;},
    change: (value: T, group?: string) => {
      const old = ref.current; if (JSON.stringify(old.values[old.index]) === JSON.stringify(value)) return;
      if(group&&editingGroup.current===group&&old.index>0){update({...old,values:[...old.values.slice(0,old.index),value]});return;}
      editingGroup.current=group||null;
      update({ ...old, active: true, values: [...old.values.slice(0, old.index + 1), value], index: old.index + 1 });
    },
    undo: () => { editingGroup.current=null; const old = ref.current; if (old.index) update({ ...old, index: old.index - 1 }); },
    redo: () => { editingGroup.current=null; const old = ref.current; if (old.index + 1 < old.values.length) update({ ...old, index: old.index + 1 }); },
    reset: (next = initialRef.current, nextVersion = version) => update({ version: nextVersion, values: [next], index: 0, active: false }),
    rebase: (nextVersion: string, value = ref.current.values[ref.current.index]) => update({ ...ref.current, version: nextVersion, values: [initialRef.current, value], index: 1 }),
  };
}
const empty: DependencyChanges = { add: [], remove: [], estimates: [] };
type PendingBatch = DependencyChangesInput & { batchId: string; previewToken: string };
export function useDependencyDraft(accountId: string, data: PathAnalysis, target: string, onSaved: () => void) {
  const key = accountId + ':' + data.projectId, history = useGraphHistory(key, empty, String(data.revision));
  const pendingKey = prefix + key + ':submission';
  const [pending, setPending] = useState<PendingBatch | null>(() => {
    try { return JSON.parse(sessionStorage.getItem(pendingKey) || 'null'); } catch { return null; }
  });
  const [preview, setPreview] = useState<DependencyChangePreview | null>(null), [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false), [previewing, setPreviewing] = useState(false);
  const [previewAttempt,setPreviewAttempt]=useState(0);
  const saving = useRef(false), generation = useRef(0), latest = useRef<DependencyChangePreview | null>(null);
  const denied=useRef(()=>{});denied.current=()=>{history.reset();onSaved();};
  const changes = history.value, count = changes.add.length + changes.remove.length + changes.estimates.length;
  const conflict = count > 0 && Number(history.version) !== data.revision;
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
  const storePending = (value: PendingBatch | null) => {
    setPending(value); try { if (value) sessionStorage.setItem(pendingKey, JSON.stringify(value)); else sessionStorage.removeItem(pendingKey); } catch { /* In-memory receipt recovery still works. */ }
  };
  const success = () => { storePending(null); history.reset(); setPreview(null); latest.current = null; setError(null); onSaved(); };
  const checkReceipt = async (batch: PendingBatch) => {
    const receipt = await api<({ status: 'applied' } & DependencyChangeReceipt) | { status: 'not_found' }>(
      '/api/projects/' + data.projectId + '/dependency-changes/' + batch.batchId, { readOnly: true });
    if (receipt.status === 'applied') { success(); return true; }
    return false;
  };
  const save = async () => {
    if (saving.current || (!pending && (!latest.current || conflict || !count))) return false;
    saving.current = true; setBusy(true);
    const batch = pending || { ...input, batchId: crypto.randomUUID(), previewToken: latest.current!.previewToken };
    try {
      if (pending && await checkReceipt(batch)) return true;
      storePending(batch);
      await api('/api/projects/' + data.projectId + '/dependency-changes/apply', { method: 'POST', body: jsonBody(batch) });
      success(); return true;
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
    ...history, changes, count, conflict, preview, previewing, busy, pending, error, save,retryPreview:()=>setPreviewAttempt(n=>n+1),
    issue: error instanceof ApiError ? error.details as { nodeIds?: string[]; edgeIds?: string[] } | undefined : undefined,
    cancel: () => { if (!pending) { history.reset(empty, String(data.revision)); setError(null); } },
    change: (next: DependencyChanges) => { if (!pending && !saving.current && JSON.stringify(next)!==JSON.stringify(changes)) { latest.current = null; setPreview(null); setError(null); if (!count && Number(history.version) !== data.revision) history.rebase(String(data.revision), next); else history.change(next); } },
    rebase: () => {
      history.rebase(String(data.revision), { ...changes, remove: changes.remove.filter(id => data.dependencies.some(d => d.id === id)) });
      setError(null);
    },
  };
}
