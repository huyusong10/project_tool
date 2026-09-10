import {useCallback,useEffect,useRef,useState} from 'react';
import {api,jsonBody,ApiError} from './api';
import {randomUUID} from './random-uuid';
import type {RequirementDraft} from '../shared/requirement-drafts';
import {mergeDraftDocument,type DraftDocument} from '../shared/draft-editing';
const documentOf=(d:RequirementDraft):DraftDocument=>({title:d.title,content:d.content});
type SaveRequest={requestId:string;expectedVersion:number}&DraftDocument;
type Recovery={base:RequirementDraft;document:DraftDocument;pending?:SaveRequest};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

export function usePersonalDraft(initial:RequirementDraft){
  const cacheKey=`personal-requirement-draft:${initial.accountId}:${initial.id}`;
  const [saved,setSaved]=useState(initial),[document,setDocument]=useState(documentOf(initial));
  const [status,setStatus]=useState('已保存'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [conflict,setConflict]=useState<{base:DraftDocument;local:DraftDocument;remote:RequirementDraft}|null>(null);
  const [recovery,setRecovery]=useState<Recovery|null>(()=>{try{return JSON.parse(localStorage.getItem(cacheKey)||'null');}catch{return null;}});
  const pending=useRef<SaveRequest|undefined>(undefined),running=useRef(false),active=useRef(true),latest=useRef({saved,document,conflict,recovery});
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  latest.current={saved,document,conflict,recovery};
  const dirty=!same(document,documentOf(saved));
  const store=useCallback((data:Recovery)=>{try{localStorage.setItem(cacheKey,JSON.stringify(data));}catch{setError('浏览器缓存不可用，请保持页面打开直到服务端保存成功。');}},[cacheKey]);
  const reconcile=useCallback((remote:RequirementDraft,base:DraftDocument,local:DraftDocument)=>{
    const merged=mergeDraftDocument(base,local,documentOf(remote));
    if(remote.status!=='draft'||merged.conflicts.length){setConflict({base,local,remote});setStatus('存在版本冲突');}
    else {setSaved(remote);setDocument(merged.document);setError('');setStatus(same(merged.document,documentOf(remote))?'已保存':'已合并，待保存');}
  },[]);
  useEffect(()=>{const current=latest.current;if(initial.version>current.saved.version&&!running.current&&!current.recovery&&!current.conflict)reconcile(initial,documentOf(current.saved),current.document);},[initial,reconcile]);
  const save=useCallback(async()=>{
    const current=latest.current;
    if(running.current||current.conflict||current.recovery||current.saved.status!=='draft'||!current.saved.projectAccessible)return;
    if(!pending.current&&same(current.document,documentOf(current.saved)))return;
    running.current=true;setBusy(true);setStatus('保存中');setError('');
    const request=pending.current||{requestId:randomUUID(),expectedVersion:current.saved.version,...current.document};pending.current=request;
    store({base:current.saved,document:current.document,pending:request});
    try{
      const remote=await api<RequirementDraft>('/api/my/requirement-drafts/'+current.saved.id,{method:'PUT',body:jsonBody(request)});
      if(!active.current)return;
      pending.current=undefined;
      const local=latest.current.document;
      // A later Agent revision may be returned for an idempotent retry; merge, never overwrite it.
      reconcile(remote,{title:request.title,content:request.content},local);
      if(same(local,documentOf(remote))){localStorage.removeItem(cacheKey);setStatus('已保存');}
    }catch(e){
      if(!active.current)return;
      setStatus('保存失败');setError((e as Error).message);
      if(e instanceof ApiError){pending.current=undefined;if(e.status===409){try{const remote=await api<RequirementDraft>('/api/my/requirement-drafts/'+current.saved.id);reconcile(remote,documentOf(current.saved),latest.current.document);}catch(fetchError){setError((fetchError as Error).message);}}}
    }finally{running.current=false;if(active.current)setBusy(false);}
  },[cacheKey,reconcile,store]);
  useEffect(()=>{
    if(!dirty||conflict||recovery||status==='保存失败')return;
    store({base:saved,document,pending:pending.current});
    const timer=window.setTimeout(()=>void save(),900);return()=>window.clearTimeout(timer);
  },[document,saved,dirty,conflict,recovery,status,save,store]);
  useEffect(()=>{const listener=(e:BeforeUnloadEvent)=>{if(!same(latest.current.document,documentOf(latest.current.saved))){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',listener);return()=>window.removeEventListener('beforeunload',listener);},[]);
  const edit=(next:DraftDocument)=>{setDocument(next);setStatus('待保存');setError('');};
  const resolve=(choices:Record<string,'local'|'remote'>)=>{if(!conflict)return;const merged=mergeDraftDocument(conflict.base,conflict.local,documentOf(conflict.remote),choices);pending.current=undefined;setSaved(conflict.remote);setDocument(merged.document);setConflict(null);setStatus('待保存');setError('');};
  const restore=()=>{if(!recovery)return;pending.current=recovery.pending;reconcile(saved,documentOf(recovery.base),recovery.document);setRecovery(null);};
  const discardRecovery=()=>{setRecovery(null);localStorage.removeItem(cacheKey);};
  const accept=(d:RequirementDraft)=>{setSaved(d);setDocument(documentOf(d));pending.current=undefined;setConflict(null);setStatus('已保存');localStorage.removeItem(cacheKey);};
  return {saved,document,edit,dirty,status,error,busy,save,conflict,resolve,recovery,restore,discardRecovery,accept};
}
