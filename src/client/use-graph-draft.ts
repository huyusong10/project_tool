import {executionDraftConflicts,type ExecutionCommand} from '../shared/execution-draft';
import {EditorSession,newHistory,readHistory,type HistoryCommand} from './editor-session';
import {rebaseEditorHistory} from './editor-rebase';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {readDraftRecord,writeDraftRecord,clearDraftRecords,ownsDraft,takeDraft,releaseDraft} from './graph-draft-storage';
import { api, ApiError, isWriteOutcomeUnknown, jsonBody } from './api';
import type { DependencyChanges, DependencyChangePreview, DependencyChangeReceipt, DependencyChangesInput } from '../shared/path-contracts';
import type { PathAnalysis } from '../shared/paths';

const prefix = 'pm-graph-draft:';
export function clearGraphDrafts(accountId?: string) {
  for(const [key,session] of sessions)if(key.startsWith(prefix+(accountId?accountId+':':''))){session.blocked=true;session.notify();sessions.delete(key);}
  void clearDraftRecords(prefix+(accountId?accountId+':':'')).catch(()=>{});
  if (typeof sessionStorage === 'undefined') return;
  for(const storage of [sessionStorage,localStorage])for (const key of Object.keys(storage)) if ([prefix,'pm-path-origin:','pm-path-view:','pm-graph-view:','pm-detail-scroll:','pm-editor-new-template:','pm-editor-lease:pm-graph-draft:'].some(p=>key.startsWith(p+(accountId?accountId+':':'')))) storage.removeItem(key);
}
export function clearProjectGraphDrafts(accountId:string,projectId:string){
  const base=prefix+accountId+':'+projectId;for(const [key,session] of sessions)if(key===base||key.startsWith(base+':')){session.blocked=true;session.notify();sessions.delete(key);}void clearDraftRecords(base).catch(()=>{});
  for(const storage of [sessionStorage,localStorage])for(const key of Object.keys(storage))if(key===base||key.startsWith(base+':')||['pm-path-origin:','pm-path-view:','pm-graph-view:','pm-detail-scroll:','pm-editor-new-template:','pm-editor-lease:pm-graph-draft:'].some(p=>(key===p+accountId+':'+projectId||key.startsWith(p+accountId+':'+projectId+':'))))storage.removeItem(key);
}
const sessions=new Map<string,EditorSession<unknown>>();
export async function assertCleanProjectDraft(accountId:string,projectId:string,command?:ExecutionCommand){
  const key=prefix+accountId+':'+projectId,session=sessions.get(key);
  const state=(!session?.loading?session?.state:undefined)||readHistory<DependencyChanges>((await readDraftRecord(key))??JSON.parse(sessionStorage.getItem(key)||'null'));
  if(await readDraftRecord(key+':submission')||sessionStorage.getItem(key+':submission'))throw new Error('项目有待核对提交，请先查询原批次回执');
  const changes=state?.values[state.index] as DependencyChanges|undefined;
  if(!changes)return;
  const conflicts=command?executionDraftConflicts(changes,state?.server,command):changes.add.length||changes.remove.length||changes.estimates.length||changes.entities?.length?['项目业务修改']:[];
  const fields=Object.keys(state?.fields||{}).filter(key=>!command||key.includes(command.workItemId||command.requirementId));
  if(conflicts.length||fields.length)throw new Error('本次操作涉及未保存业务草稿：'+[...conflicts,...fields.map(()=>'未完成字段')].join('、')+'。请保存或处理这些修改后再执行');
}
export async function assertCleanRequirementDraft(accountId:string,requirementId:string,command?:Omit<ExecutionCommand,'requirementId'>){
  const r=await api<{projectId:string}>('/api/requirements/'+requirementId,{readOnly:true});
  await assertCleanProjectDraft(accountId,r.projectId,{requirementId,...command});
}
export function useGraphHistory<T>(key:string,initial:T,version:string,source?:PathAnalysis){
  const storageKey=prefix+key;
  let session=sessions.get(storageKey) as EditorSession<T>|undefined;
  if(!session){session=new EditorSession(newHistory(initial,version,source));sessions.set(storageKey,session as EditorSession<unknown>);}
  const current=session;
  useSyncExternalStore(current.subscribe,current.snapshot);
  const latest=useRef({initial,version,source});latest.current={initial,version,source};
  const persist=()=>current.persist(async state=>{if(current.blocked)return;await writeDraftRecord(storageKey,state.active||Object.keys(state.fields).length||Object.keys(state.layouts).length?state:undefined);sessionStorage.removeItem(storageKey);});
  const dispatch=(command:HistoryCommand<T>)=>{
    if(current.loading||current.readOnly||current.blocked)return false;
    if(command.type!=='layout-baseline'&&!ownsDraft(storageKey,true)){current.readOnly=true;current.notify();return false;}
    const changed=current.dispatch(command);if(changed)void persist();return changed;
  };
  useEffect(()=>{
    let stopped=false;current.mounts++;if(!current.loading){current.readOnly=!ownsDraft(storageKey,current.state.active||!!Object.keys(current.state.fields).length);current.notify();}
    if(current.loading)void (async()=>{
      try{
        const stored=await readDraftRecord<unknown>(storageKey),legacy=stored===undefined?JSON.parse(sessionStorage.getItem(storageKey)||'null'):undefined;
        const restored=readHistory<T>(stored??legacy);
        if(restored){current.state=restored;current.restored=restored.active;current.stored=true;if(legacy){await writeDraftRecord(storageKey,restored);sessionStorage.removeItem(storageKey);}}
      }catch(error){current.error=(error as Error).message.includes('原记录')?(error as Error).message:'本机存储不可用，草稿仅保留在当前页面';current.blocked=(error as Error).message.includes('原记录');}
      current.loading=false;current.readOnly=!ownsDraft(storageKey,current.state.active||!!Object.keys(current.state.fields).length);current.notify();
    })();
    const refresh=()=>{if(stopped)return;const denied=!ownsDraft(storageKey,current.state.active||!!Object.keys(current.state.fields).length);if(denied!==current.readOnly){current.readOnly=denied;current.notify();}},leave=()=>{current.readOnly=true;void current.flush();releaseDraft(storageKey);};
    const timer=setInterval(refresh,15000);window.addEventListener('storage',refresh);window.addEventListener('pagehide',leave);
    return()=>{stopped=true;clearInterval(timer);window.removeEventListener('storage',refresh);window.removeEventListener('pagehide',leave);void current.flush();if(--current.mounts===0)queueMicrotask(()=>{if(!current.mounts&&!current.saving)releaseDraft(storageKey);});};
  },[current,storageKey]);
  const state=current.state;
  return {
    session:current,dispatch,flush:current.flush,busy:current.saving,setBusy:(value:boolean)=>{current.setSaving(value);if(!value&&!current.mounts)releaseDraft(storageKey);},source:state.server,baseline:state.baseline||state.values[0],value:state.values[state.index],active:state.active,version:state.version,
    dirty:JSON.stringify(state.values[state.index])!==JSON.stringify(state.baseline||state.values[0]),loading:current.loading,storageError:current.error,stored:current.stored,restored:current.restored,readOnly:current.readOnly||current.blocked,
    fields:state.fields,layoutBaselines:state.layouts,
    setField:(key:string,buffer?:import('./editor-session').FieldBuffer)=>dispatch({type:'field',key,buffer}),
    captureLayout:(scope:string,positions:Record<string,import('./path-layout').Point>)=>dispatch({type:'layout-baseline',scope,positions}),
    takeOver:async()=>{const saved=readHistory<T>(await readDraftRecord(storageKey));takeDraft(storageKey);if(saved)current.state=saved;current.readOnly=false;current.notify();},
    canUndo:state.index>0,canRedo:state.index+1<state.values.length,
    begin:()=>dispatch({type:'begin'}),endGroup:()=>dispatch({type:'end-group'}),
    change:(value:T,group?:string)=>dispatch({type:'change',value,group}),
    undo:()=>dispatch({type:'undo'}),redo:()=>dispatch({type:'redo'}),
    reset:(next=latest.current.initial,nextVersion=latest.current.version)=>dispatch({type:'reset',value:next,version:nextVersion,server:latest.current.source}),
    rebase:(nextVersion:string,value=current.state.values[current.state.index],values?:T[])=>dispatch({type:'rebase',value,values,baseline:latest.current.initial,version:nextVersion,server:latest.current.source}),
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
  const [previewing, setPreviewing] = useState(false);
  const [previewAttempt,setPreviewAttempt]=useState(0);
  const generation = useRef(0), latest = useRef<DependencyChangePreview | null>(null);
  const denied=useRef(()=>{});denied.current=()=>{history.reset();onSaved();};
  const changes = history.value, count = changes.add.length + changes.remove.length + changes.estimates.length+(changes.entities?.length||0)+(changes.layouts?.length||0)+Number(!!changes.commitment);
  const resolutionVersion=JSON.stringify([data.revision,data.layouts?.map(l=>[l.scope,l.direction,l.version])]);
  const [resolutionState,setResolutionState]=useState<{version:string;values:Record<string,'draft'|'server'>}>({version:resolutionVersion,values:{}});
  const resolutions=resolutionState.version===resolutionVersion?resolutionState.values:{};
  const rebased=rebaseEditorHistory(history.source,data,history.session.state.values,history.session.state.index,resolutions);
  const conflict = history.session.state.values.some(v=>v.add.length||v.remove.length||v.estimates.length||v.entities?.length||v.layouts?.length||v.commitment) && (Number(history.version) !== data.revision || history.session.state.values.some(v=>(v.layouts||[]).some(l=>l.expectedVersion!==(data.layouts?.find(d=>d.scope===l.scope&&d.direction===l.direction)?.version||0))));
  useEffect(()=>{
    if(!conflict||history.loading||history.readOnly||history.busy||pending)return;
    if(rebased.pending.length)return;
    history.rebase(String(data.revision),rebased.current,rebased.values);
  });
  const input: DependencyChangesInput = { expectedRevision: count ? Number(history.version) : data.revision, target, changes };
  const saveInput=()=>({expectedRevision:Number(history.session.state.version),target,changes:history.session.state.values[history.session.state.index]});
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
    if (!pendingReady||history.loading||history.readOnly||history.session.saving || Object.values(history.session.state.fields).some(f=>f.error) || (!pending && (conflict || JSON.stringify(history.session.state.values[history.session.state.index])===JSON.stringify(empty)))) return false;
    history.setBusy(true);
    let batch = pending;
    try {
      if (batch && await checkReceipt(batch)) return true;
      // Ctrl+S can arrive immediately after an input blur. Preview that exact
      // snapshot before saving instead of ignoring the shortcut or using an old token.
      if (!batch) {
        const exact=saveInput();
        const confirmed = JSON.stringify(exact)===fingerprint&&latest.current || await api<DependencyChangePreview>('/api/projects/' + data.projectId + '/dependency-changes/preview', { method: 'POST', body: jsonBody(exact), readOnly: true });
        batch = { ...exact, batchId: crypto.randomUUID(), previewToken: confirmed.previewToken };
      }
      await writeDraftRecord(pendingKey,batch);storePending(batch);
      const receipt=await api<DependencyChangeReceipt>('/api/projects/' + data.projectId + '/dependency-changes/apply', { method: 'POST', body: jsonBody(batch) });
      success(receipt); return true;
    } catch (caught) {
      const failure = caught as Error;
      if (batch && (isWriteOutcomeUnknown(failure) || failure instanceof ApiError && failure.status >= 500)) {
        try { if (await checkReceipt(batch)) return true; } catch { /* Keep the exact batch for a later receipt check. */ }
        setError(new Error('提交结果待核对。修改已保留，请查询回执后重试同一批次。'));
      } else { storePending(null); setError(failure); latest.current = null; setPreview(null);if(failure instanceof ApiError&&[401,403].includes(failure.status))history.reset();setPreviewAttempt(n=>n+1); onSaved(); }
      return false;
    } finally { history.setBusy(false); }
  };
  return {
    ...history,loading:history.loading||!pendingReady,changes,count,conflict,conflicts:conflict?rebased.conflicts:[],unresolved:rebased.pending.length,resolveConflict:(key:string,value:'draft'|'server')=>setResolutionState(old=>({version:resolutionVersion,values:{...(old.version===resolutionVersion?old.values:{}),[key]:value}})),preview, previewing, pending, error, save,retryPreview:()=>setPreviewAttempt(n=>n+1),
    issue: error instanceof ApiError ? error.details as { nodeIds?: string[]; edgeIds?: string[] } | undefined : undefined,
    cancel: () => { if (!pending) { history.reset(empty, String(data.revision)); setError(null); } },
    change: (next: DependencyChanges) => { if (!pending && !history.session.saving && JSON.stringify(next)!==JSON.stringify(changes)) { latest.current = null; setPreview(null); setError(null); if (!count && Number(history.version) !== data.revision) history.rebase(String(data.revision), next); else history.change(next); } },
    rebase: () => {
      if(rebased.pending.length)return;history.rebase(String(data.revision),rebased.current,rebased.values);setResolutionState({version:resolutionVersion,values:{}});
      setError(null);
    },
  };
}
