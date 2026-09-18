import * as requirementsApi from './features/requirements/api';
import * as pathsApi from './features/paths/api';
import { useGuestWorkspace } from './app-context';
import { randomUUID } from './random-uuid';
import { remapEditorViews } from './path-view';
import { executionDraftConflicts, type ExecutionCommand } from '../shared/execution-draft';
import { EditorSession, newHistory, readHistory, type HistoryCommand, type EditorHistory, type FieldAvailability } from './editor-session';
import { projectFieldActive } from './editor-fields';
import { currentEditorAnalysis, rebaseEditorHistory } from './editor-rebase';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { readDraftRecord, writeDraftRecord, writeSharedDraftRecord, watchDraftRecord, clearDraftRecords, ownsDraft, takeDraft, releaseDraft } from './graph-draft-storage';
import { ApiError, isWriteOutcomeUnknown, jsonBody } from './api';
import type { DependencyChanges, DependencyChangePreview, DependencyChangeReceipt, DependencyChangesInput } from '../shared/path-contracts';
import type { PathAnalysis } from '../shared/paths';
import type { DraftTemplateInstance } from '../shared/template-instance';
import { useLegacyFeatureDraft } from './legacy-feature-draft';

const prefix = 'pm-graph-draft:';
export function clearGraphDrafts(accountId?: string) {
  for(const [key,session] of sessions)if(key.startsWith(prefix+(accountId?accountId+':':''))){session.blocked=true;session.notify();sessions.delete(key);}
  void clearDraftRecords(prefix+(accountId?accountId+':':'')).catch(()=>{});
  if (typeof sessionStorage === 'undefined') return;
  for(const storage of [sessionStorage,localStorage])for (const key of Object.keys(storage)) if ([prefix,'pm-project-task:','pm-workspace-rows:','pm-path-origin:','pm-editor-ids:','pm-path-view:','pm-canvas-navigation:','pm-graph-view:','pm-delivery-inputs:','pm-delivery-inputs:','pm-detail-scroll:','pm-editor-new-template:','pm-editor-lease:pm-graph-draft:'].some(p=>key.startsWith(p+(accountId?accountId+':':'')))) storage.removeItem(key);
}
export function clearProjectGraphDrafts(accountId:string,projectId:string){
  const base=prefix+accountId+':'+projectId;for(const [key,session] of sessions)if(key===base||key.startsWith(base+':')){session.blocked=true;session.notify();sessions.delete(key);}void clearDraftRecords(base).catch(()=>{});
  for(const storage of [sessionStorage,localStorage])for(const key of Object.keys(storage))if(key===base||key.startsWith(base+':')||['pm-project-task:','pm-workspace-rows:','pm-path-origin:','pm-editor-ids:','pm-path-view:','pm-canvas-navigation:','pm-graph-view:','pm-detail-scroll:','pm-editor-new-template:','pm-editor-lease:pm-graph-draft:'].some(p=>(key===p+accountId+':'+projectId||key.startsWith(p+accountId+':'+projectId+':'))))storage.removeItem(key);
}
const sessions=new Map<string,EditorSession<unknown>>();
function releaseUnusedHistory<T>(key:string,current:EditorSession<T>,releaseLease:boolean) {
  void current.flush().then(()=>{
    if(current.mounts||current.saving||sessions.get(key)!==current)return;
    if(releaseLease)releaseDraft(key);
    // Clean layout baselines can be read back from IndexedDB; unsaved input stays in memory.
    if(!current.state.active&&!Object.keys(current.state.fields).length&&!current.error)sessions.delete(key);
  });
}
export async function assertCleanProjectDraft(accountId:string,projectId:string,command?:ExecutionCommand){
  const key=prefix+accountId+':'+projectId,session=sessions.get(key);
  const state=((!session?.loading?session?.state:undefined)||readHistory<DependencyChanges>((await readDraftRecord(key))??JSON.parse(sessionStorage.getItem(key)||'null'))) as EditorHistory<DependencyChanges>|undefined;
  if(await readDraftRecord(key+':submission')||sessionStorage.getItem(key+':submission'))throw new Error('项目有待核对提交，请先查询原批次回执');
  const changes=state?.values[state.index] as DependencyChanges|undefined;
  if(!changes)return;
  const conflicts=command?executionDraftConflicts(changes,state?.server,command):changes.add.length||changes.remove.length||changes.estimates.length||changes.entities?.length?['项目业务修改']:[];
  const fieldIds=command?.phaseId?new Set([...(state?.server?.requirements||[]).filter(r=>r.phaseId===command.phaseId).map(r=>r.id),...(changes.entities||[]).filter(c=>c.entity==='requirement'&&c.data.phaseId===command.phaseId).map(c=>c.id)]):new Set([command?.workItemId||command?.requirementId||'']);
  if(command?.phaseId)for(const n of state?.server?.nodes||[])if(n.requirementId&&fieldIds.has(n.requirementId))fieldIds.add(n.id);
  const fields=Object.keys(state?.fields||{}).filter(key=>state&&projectFieldActive(state,key)&&(!command||[...fieldIds].some(id=>key.includes(id))));
  if(conflicts.length||fields.length)throw new Error('本次操作涉及未保存业务草稿：'+[...conflicts,...fields.map(()=>'未完成字段')].join('、')+'。请保存或处理这些修改后再执行');
}
export async function assertCleanRequirementDraft(accountId:string,requirementId:string,command?:Omit<ExecutionCommand,'requirementId'>){
  const r=await requirementsApi.requirementsById<{projectId:string}>(requirementId, {readOnly:true});
  await assertCleanProjectDraft(accountId,r.projectId,{requirementId,...command});
}
export function useGraphHistory<T>(key:string,initial:T,version:string,source?:PathAnalysis,fieldAvailability?:FieldAvailability<T>,enabled=true){
  const storageKey=prefix+(enabled?'':'readonly:')+key;
  let session=sessions.get(storageKey) as EditorSession<T>|undefined;
  if(!session){session=new EditorSession(newHistory(initial,version,source));sessions.set(storageKey,session as EditorSession<unknown>);}
  const current=session;
  current.fieldAvailability=fieldAvailability;
  if(!enabled){current.loading=false;current.readOnly=true;if(current.state.version!==version)current.state=newHistory(initial,version,source);}
  useSyncExternalStore(current.subscribe,current.snapshot);
  const latestSource=source?currentEditorAnalysis(source,current.state.server):undefined;
  const latest=useRef({initial,version,source});latest.current={initial,version:latestSource?String(latestSource.revision):version,source:latestSource};
  const persist=()=>current.persist(async state=>{if(current.blocked)return;await writeDraftRecord(storageKey,state.active||Object.keys(state.fields).length||Object.keys(state.layouts).length?state:undefined);sessionStorage.removeItem(storageKey);});
  const dispatch=(command:HistoryCommand<T>)=>{
    if(!enabled||current.loading||current.readOnly||current.blocked)return false;
    if(command.type!=='layout-baseline'&&!ownsDraft(storageKey,true)){current.readOnly=true;current.notify();return false;}
    const changed=current.dispatch(command);if(changed)void persist();return changed;
  };
  useEffect(()=>{
    current.mounts++;
    if(!enabled)return()=>{current.mounts--;releaseUnusedHistory(storageKey,current,false);};
    let stopped=false;if(!current.loading){current.readOnly=!ownsDraft(storageKey,current.state.active||!!Object.keys(current.state.fields).length);current.notify();}
    if(current.loading)void (async()=>{
      try{
        const stored=await readDraftRecord<unknown>(storageKey),legacy=stored===undefined?JSON.parse(sessionStorage.getItem(storageKey)||'null'):undefined;
        const restored=readHistory<T>(stored??legacy);
        if(restored){current.state={...restored,server:restored.server||latest.current.source};current.restored=restored.active;current.stored=true;if(legacy){await writeDraftRecord(storageKey,current.state);sessionStorage.removeItem(storageKey);}}
      }catch(error){current.error=(error as Error).message.includes('原记录')?(error as Error).message:'本机存储不可用，草稿仅保留在当前页面';current.blocked=(error as Error).message.includes('原记录');}
      current.loading=false;current.readOnly=!ownsDraft(storageKey,current.state.active||!!Object.keys(current.state.fields).length);current.notify();
    })();
    const refresh=()=>{if(stopped)return;const denied=!ownsDraft(storageKey,current.state.active||!!Object.keys(current.state.fields).length);if(denied!==current.readOnly){current.readOnly=denied;current.notify();}},leave=()=>{current.readOnly=true;void current.flush();releaseDraft(storageKey);};
    const timer=setInterval(refresh,15000);window.addEventListener('storage',refresh);window.addEventListener('pagehide',leave);
    return()=>{stopped=true;clearInterval(timer);window.removeEventListener('storage',refresh);window.removeEventListener('pagehide',leave);current.mounts--;releaseUnusedHistory(storageKey,current,true);};
  },[current,storageKey,enabled]);
  const state=current.state;
  return {
    session:current,dispatch,flush:current.flush,busy:current.saving,setBusy:(value:boolean)=>{current.setSaving(value);if(!value&&!current.mounts)releaseUnusedHistory(storageKey,current,enabled);},source:state.server,baseline:state.baseline||state.values[0],value:state.values[state.index],active:state.active,version:state.version,
    dirty:JSON.stringify(state.values[state.index])!==JSON.stringify(state.baseline||state.values[0]),loading:current.loading,storageError:current.error,stored:current.stored,restored:current.restored,readOnly:current.readOnly||current.blocked,
    get fields(){return current.fields;},get fieldEpoch(){return current.fieldEpoch;},get pendingField(){return current.pendingField;},requestField:current.requestField,isFieldActive:current.isFieldActive,layoutBaselines:state.layouts,
    setField:(key:string,buffer?:import('./editor-session').FieldBuffer)=>dispatch({type:'field',key,buffer}),
    captureLayout:(scope:string,positions:Record<string,import('./path-layout').Point>)=>dispatch({type:'layout-baseline',scope,positions}),
    takeOver:async(beforeUnlock?:()=>Promise<void>)=>{
      if(!enabled||current.loading||current.saving||current.blocked)return false;
      current.loading=true;current.notify();
      try{
        await current.flush();const saved=readHistory<T>(await readDraftRecord(storageKey));takeDraft(storageKey);
        current.adopt(saved?{...saved,server:saved.server||latest.current.source}:newHistory(latest.current.initial,latest.current.version,latest.current.source));
        await beforeUnlock?.();current.readOnly=false;return true;
      }catch(error){current.error='无法接管草稿：'+(error as Error).message;current.readOnly=true;return false;}
      finally{current.loading=false;current.notify();}
    },
    canUndo:state.index>0,canRedo:state.index+1<state.values.length,
    begin:()=>dispatch({type:'begin'}),endGroup:()=>dispatch({type:'end-group'}),
    change:(value:T,group?:string)=>dispatch({type:'change',value,group}),
    undo:()=>dispatch({type:'undo'}),redo:()=>dispatch({type:'redo'}),
    reset:(next=latest.current.initial,nextVersion=latest.current.version)=>dispatch({type:'reset',value:next,version:nextVersion,server:latest.current.source}),
    rebase:(nextVersion:string,value=current.state.values[current.state.index],values?:T[])=>dispatch({type:'rebase',value,values,baseline:latest.current.initial,version:nextVersion,server:latest.current.source}),
  };
}
const empty: DependencyChanges = { add: [], remove: [], estimates: [] };
const noResolutions:Record<string,'draft'|'server'>={};
type PendingBatch = DependencyChangesInput & { batchId: string; previewToken: string };
export function useDependencyDraft(accountId: string, incoming: PathAnalysis, target: string, onSaved: (receipt?:DependencyChangeReceipt) => void, scope?:string) {
  const enabled=!useGuestWorkspace(incoming.projectId);
  const key = accountId + ':' + incoming.projectId+(scope?':'+scope:''), history = useGraphHistory(key, empty, String(incoming.revision),incoming,projectFieldActive,enabled);
  const data=currentEditorAnalysis(incoming,history.source);
  const pendingKey = prefix + key + ':submission';
  const [pendingReady,setPendingReady]=useState(false);
  const [pending, setPending] = useState<PendingBatch | null>(() => {
    try { return enabled ? JSON.parse(sessionStorage.getItem(pendingKey) || 'null') : null; } catch { return null; }
  });
  const legacy=useLegacyFeatureDraft(key,data.projectId,history,pending,()=>onSaved(),enabled&&!scope);
  const [preview, setPreview] = useState<DependencyChangePreview | null>(null), [error, setError] = useState<Error | null>(null);
  const [templateInstances,setTemplateInstances]=useState<DraftTemplateInstance[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [previewAttempt,setPreviewAttempt]=useState(0);
  const generation = useRef(0), latest = useRef<DependencyChangePreview | null>(null);
  const denied=useRef(()=>{});denied.current=()=>{history.reset();onSaved();};
  const changes = history.value, count = changes.add.length + changes.remove.length + changes.estimates.length+(changes.entities?.length||0)+(changes.layouts?.length||0)+(changes.featureRelations?.length||0)+Number(!!changes.commitment);
  const featureVersion=(value:PathAnalysis|undefined)=>JSON.stringify([value?.featureContext?.relations,value?.featureContext?.overview.features.map(g=>[g.id,g.archivedAt])]);
  const resolutionVersion=JSON.stringify([data.revision,data.layouts?.map(l=>[l.scope,l.direction,l.version]),featureVersion(data)]);
  const [resolutionState,setResolutionState]=useState<{version:string;values:Record<string,'draft'|'server'>}>({version:resolutionVersion,values:{}});
  const resolutions=resolutionState.version===resolutionVersion?resolutionState.values:noResolutions;
  const historyValues=history.session.state.values,historyIndex=history.session.state.index;
  const rebased=useMemo(()=>rebaseEditorHistory(history.source,data,historyValues,historyIndex,resolutions),[history.source,data,historyValues,historyIndex,resolutions]);
  const conflict = history.session.state.values.some(v=>v.add.length||v.remove.length||v.estimates.length||v.entities?.length||v.layouts?.length||v.featureRelations?.length||v.commitment) && (Number(history.version) !== data.revision || history.session.state.values.some(v=>!!v.featureRelations?.length&&featureVersion(history.source)!==featureVersion(data)||(v.layouts||[]).some(l=>l.expectedVersion!==(data.layouts?.find(d=>d.scope===l.scope&&d.direction===l.direction)?.version||0))));
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
    if (!enabled || !count || conflict || pending) { setPreviewing(false); return; }
    const controller = new AbortController(); setPreviewing(true);
    const timer = setTimeout(() => {
      void pathsApi.projectsDependencyChangesPreview<DependencyChangePreview>(data.projectId, {
        method: 'POST', body: fingerprint, readOnly: true, signal: controller.signal,
      }).then(result => {
        if (current === generation.current) { setPreview(result);setTemplateInstances(result.templateInstances||[]); latest.current = result; setError(null); }
      }).catch(caught => { if (current === generation.current && !controller.signal.aborted) {setError(caught);if(caught instanceof ApiError&&[401,403].includes(caught.status))denied.current();} })
        .finally(() => { if (current === generation.current) setPreviewing(false); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [fingerprint, count, conflict, pending, data.projectId,data.asOfDate,previewAttempt,enabled]);
  useEffect(()=>{if(!enabled){setPending(null);setPendingReady(true);return;}let stopped=false;const load=()=>{if(stopped)return;setPendingReady(false);void readDraftRecord<PendingBatch>(pendingKey).then(value=>{if(!stopped)setPending(value||null);}).catch(()=>{}).finally(()=>{if(!stopped)setPendingReady(true);});};const unwatch=watchDraftRecord(pendingKey,load);load();return()=>{stopped=true;unwatch();};},[pendingKey,enabled]);
  const updatePending = (value: PendingBatch | null) => {
    setPending(value); try { if (value) sessionStorage.setItem(pendingKey, JSON.stringify(value)); else sessionStorage.removeItem(pendingKey); } catch { /* In-memory receipt recovery still works. */ }
  };
  const storePending = (value: PendingBatch | null) => {void writeSharedDraftRecord(pendingKey,value||undefined).catch(()=>{});updatePending(value);};
  const success = (receipt:DependencyChangeReceipt) => { if(history.session.blocked)return;remapEditorViews(accountId+':'+data.projectId,receipt.addedIds);storePending(null); history.reset(); setPreview(null); latest.current = null; setError(null); onSaved(receipt); };
  const checkReceipt = async (batch: PendingBatch) => {
    const receipt = await pathsApi.projectsDependencyChangesById<({ status: 'applied' } & DependencyChangeReceipt) | { status: 'not_found' }>(data.projectId, batch.batchId, { readOnly: true });
    if (receipt.status === 'applied') { success(receipt); return true; }
    return false;
  };
  const save = async (allowApply?: (preview:DependencyChangePreview)=>boolean) => {
    if (!enabled||!pendingReady||history.loading||history.readOnly||history.session.saving || (!pending&&(legacy.blocked||legacy.loading)) || Object.values(history.session.fields).some(f=>f.error) || (!pending && (conflict || JSON.stringify(history.session.state.values[history.session.state.index])===JSON.stringify(empty)))) return false;
    history.setBusy(true);
    let batch = pending;
    let pendingChecked = Boolean(batch);
    try {
      if (!batch) {
        batch = await readDraftRecord<PendingBatch>(pendingKey) || null;
        pendingChecked = true;
        if (batch) updatePending(batch);
      }
      if (batch && await checkReceipt(batch)) return true;
      // Ctrl+S can arrive immediately after an input blur. Preview that exact
      // snapshot before saving instead of ignoring the shortcut or using an old token.
      if (!batch) {
        const exact=saveInput();
        const confirmed = JSON.stringify(exact)===fingerprint&&latest.current || await pathsApi.projectsDependencyChangesPreview<DependencyChangePreview>(data.projectId, { method: 'POST', body: jsonBody(exact), readOnly: true });
        if(allowApply&&!allowApply(confirmed)){setPreview(confirmed);latest.current=confirmed;return false;}
        batch = { ...exact, batchId: randomUUID(), previewToken: confirmed.previewToken };
      }
      await writeSharedDraftRecord(pendingKey,batch);updatePending(batch);
      const receipt=await pathsApi.projectsDependencyChangesApply<DependencyChangeReceipt>(data.projectId, { method: 'POST', body: jsonBody(batch) });
      success(receipt); return true;
    } catch (caught) {
      const failure = caught as Error;
      if (!pendingChecked) {
        setError(new Error('无法核对本机待提交批次，未执行保存：'+failure.message));
        return false;
      }
      if (batch && (isWriteOutcomeUnknown(failure) || failure instanceof ApiError && failure.status >= 500)) {
        try { if (await checkReceipt(batch)) return true; } catch { /* Keep the exact batch for a later receipt check. */ }
        setError(new Error('提交结果待核对。修改已保留，请查询回执后重试同一批次。'));
      } else { storePending(null); setError(failure); latest.current = null; setPreview(null);if(failure instanceof ApiError&&[401,403].includes(failure.status))history.reset();setPreviewAttempt(n=>n+1); onSaved(); }
      return false;
    } finally { history.setBusy(false); }
  };
  return {
    templateInstances,legacy,conflictChoices:resolutions,
    ...history,loading:history.loading||!pendingReady||legacy.loading,readOnly:history.readOnly||legacy.blocked&&legacy.kind!=='error',changes,count,conflict,conflicts:conflict?rebased.conflicts:[],unresolved:rebased.pending.length,resolveConflict:(key:string,value:'draft'|'server')=>setResolutionState(old=>({version:resolutionVersion,values:{...(old.version===resolutionVersion?old.values:{}),[key]:value}})),preview, previewing, pending, error, save,retryPreview:()=>setPreviewAttempt(n=>n+1),
    takeOver:()=>history.takeOver(async()=>{setPending(await readDraftRecord<PendingBatch>(pendingKey)||null);}),
    get fields(){return history.fields;},get fieldEpoch(){return history.fieldEpoch;},get pendingField(){return history.pendingField;},
    issue: error instanceof ApiError ? error.details as { nodeIds?: string[]; edgeIds?: string[] } | undefined : undefined,
    cancel: () => { if (!pending) { history.reset(empty, String(data.revision)); setError(null); } },
    change: (next: DependencyChanges) => { if ((!legacy.blocked||legacy.kind==='error')&&!legacy.loading&&!pending && !history.session.saving && JSON.stringify(next)!==JSON.stringify(changes)) { latest.current = null; setPreview(null); setError(null); if (!count && Number(history.version) !== data.revision) history.rebase(String(data.revision), next); else history.change(next); } },
    rebase: () => {
      if(rebased.pending.length)return;history.rebase(String(data.revision),rebased.current,rebased.values);setResolutionState({version:resolutionVersion,values:{}});
      setError(null);
    },
  };
}
