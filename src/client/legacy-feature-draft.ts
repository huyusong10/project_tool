import * as pathsApi from './features/paths/api';
import { useEffect, useRef, useState } from 'react';
import type { DependencyChanges, DependencyChangesInput } from '../shared/path-contracts';
import { readHistory, type EditorHistory } from './editor-session';
import { readDraftRecord, writeSharedDraftRecord, ownsDraft, takeDraft, releaseDraft } from './graph-draft-storage';
import { ApiError, jsonBody } from './api';
import type { useGraphHistory } from './use-graph-draft';

type Layout=NonNullable<DependencyChanges['layouts']>[number];
type Pending=DependencyChangesInput&{batchId:string;previewToken:string};
type History=ReturnType<typeof useGraphHistory<DependencyChanges>>;
type Recovery={kind:'ready'|'reading'|'conflict'|'pending'|'locked'|'error';message?:string;layouts?:Layout[];conflicts?:string[]};
const layoutKey=(layout:Layout)=>layout.scope+':'+layout.direction;
export function mergeFeatureLayouts(current:DependencyChanges,layouts:Layout[],choices:Record<string,'current'|'legacy'>={}){
  const merged=[...(current.layouts||[])],conflicts:string[]=[];
  for(const layout of layouts){const key=layoutKey(layout),index=merged.findIndex(l=>layoutKey(l)===key);
    if(index<0)merged.push(layout);
    else if(JSON.stringify(merged[index])!==JSON.stringify(layout)){
      if(!choices[key])conflicts.push(key);else if(choices[key]==='legacy')merged[index]=layout;
    }
  }
  return {changes:{...current,layouts:merged},conflicts};
}
export function useLegacyFeatureDraft(key:string,projectId:string,history:History,pending:unknown,onSaved:()=>void,enabled=true){
  const oldKey='pm-graph-draft:'+key+':feature-layouts',submission=oldKey+':submission';
  const [recovery,setRecovery]=useState<Recovery>({kind:enabled?'reading':'ready'}),[attempt,setAttempt]=useState(0);
  const latest=useRef({history,pending,onSaved});latest.current={history,pending,onSaved};
  const done=useRef(!enabled),active=useRef(true),running=useRef(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const read=async()=>{
    const saved=await readDraftRecord<EditorHistory<DependencyChanges>>(oldKey);
    return readHistory<DependencyChanges>(saved??JSON.parse(sessionStorage.getItem(oldKey)||'null'));
  };
  const clear=async()=>{await writeSharedDraftRecord(oldKey,undefined);await writeSharedDraftRecord(submission,undefined);sessionStorage.removeItem(oldKey);sessionStorage.removeItem(submission);releaseDraft(oldKey);done.current=true;if(active.current)setRecovery({kind:'ready'});};
  const importLayouts=async(layouts:Layout[],choices:Record<string,'current'|'legacy'>={})=>{
    const current=latest.current.history;
    if(current.readOnly||current.loading||current.busy||latest.current.pending||!ownsDraft(oldKey,true))return;
    const merged=mergeFeatureLayouts(current.session.state.values[current.session.state.index],layouts,choices);
    if(merged.conflicts.length){setRecovery({kind:'conflict',layouts,conflicts:merged.conflicts});return;}
    if(layouts.length&&!current.change(merged.changes)){
      if(JSON.stringify(current.session.state.values[current.session.state.index])!==JSON.stringify(merged.changes))throw new Error('当前草稿已被其他页面接管，旧布局仍保留');
    }
    await current.flush();await clear();
  };
  const run=async(retrySubmission=false)=>{
    if(running.current)return;running.current=true;
    try{
      const stored=await read(),batch=await readDraftRecord<Pending>(submission)??JSON.parse(sessionStorage.getItem(submission)||'null') as Pending|null;
      if(!stored&&!batch){done.current=true;if(active.current)setRecovery({kind:'ready'});return;}
      if(!active.current)return;
      if(!ownsDraft(oldKey,true)){setRecovery({kind:'locked',message:'另一页面正在编辑旧特性布局'});return;}
      if(batch){
        const receipt=await pathsApi.projectsDependencyChangesById<{status:'applied'|'not_found'}>(projectId, batch.batchId, {readOnly:true});
        if(!active.current)return;
        if(receipt.status==='applied'){await clear();latest.current.onSaved();return;}
        if(!retrySubmission){setRecovery({kind:'pending',message:'旧特性布局的提交尚无回执，原批次和布局已保留'});return;}
        try{await pathsApi.projectsDependencyChangesApply(projectId, {method:'POST',body:jsonBody(batch)});await clear();latest.current.onSaved();return;}
        catch(error){if(!(error instanceof ApiError)||error.status>=500)throw error;await writeSharedDraftRecord(submission,undefined);sessionStorage.removeItem(submission);}
      }
      if(!active.current)return;
      await importLayouts(stored?.values[stored.index]?.layouts||[]);
    }catch(error){if(active.current)setRecovery({kind:'error',message:(error as Error).message});}
    finally{running.current=false;}
  };
  const runRef=useRef(run);runRef.current=run;
  useEffect(()=>{if(!enabled||done.current||history.loading||history.readOnly||history.busy||pending)return;void runRef.current();},[enabled,history.loading,history.readOnly,history.busy,pending,attempt]);
  return {...recovery,blocked:!['ready','reading'].includes(recovery.kind),loading:recovery.kind==='reading'&&!pending&&!history.readOnly,
    retry:()=>setAttempt(n=>n+1),retrySubmission:()=>void run(true),takeOver:()=>{takeDraft(oldKey);setAttempt(n=>n+1);},
    resolve:(choices:Record<string,'current'|'legacy'>)=>void importLayouts(recovery.layouts||[],choices).catch(error=>setRecovery({kind:'error',message:(error as Error).message})),
  };
}
