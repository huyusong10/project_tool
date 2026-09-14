import {useEffect} from 'react';
import {useLocation,useSearchParams} from 'react-router-dom';
import {useAppNavigate} from './use-app-navigation';
import type {PathAnalysis} from '../shared/paths';
export type CanvasView='features'|'feature'|'project'|'requirement';
export function canvasView(params:URLSearchParams):CanvasView {
  const view=params.get('view');
  if(['features','feature','project','requirement'].includes(view||''))return view as CanvasView;
  return [...params.keys()].some(k=>k.startsWith('path'))?'project':'features';
}
export function canvasScope(params:URLSearchParams){const view=canvasView(params);return view==='requirement'?'requirement:'+params.get('requirementId'):view==='feature'?'feature:'+(params.get('featureId')||'unassigned'):view==='project'?'global':'features';}
export function canvasRoot(params:URLSearchParams){const view=canvasView(params);return view==='features'||view==='feature'||view==='requirement'&&params.get('root')==='features'?'features':'project';}
export function requirementCanvasUrl(id:string,params:URLSearchParams,data?:PathAnalysis,workItemId?:string|null){
  const next=new URLSearchParams({view:'requirement',requirementId:id,root:canvasRoot(params)});
  if(next.get('root')==='features')next.set('featureId',data?.requirements.find(r=>r.id===id)?.featureId||data?.featureContext?.requirements.find(r=>r.id===id)?.featureId||'unassigned');
  if(workItemId){next.set('pathNode',workItemId);next.set('pathInspector','open');}
  next.set('mode',params.get('mode')||'graph');
  if(params.has('phaseId'))next.set('phaseId',params.get('phaseId')!);
  return '/?'+next;
}
const storageKey=(account:string,project:string,scope:string)=>'pm-canvas-navigation:'+account+':'+project+':'+scope;
export function restoredCanvasUrl(account:string,project:string,url:string){
  const parsed=new URL(url,'http://canvas.local');if(!['/','/paths','/features'].includes(parsed.pathname))return url;
  const explicit=parsed.searchParams;
  try{const saved=new URLSearchParams(sessionStorage.getItem(storageKey(account,project,canvasScope(explicit)))||'');
    for(const [key,value] of saved)if(!explicit.has(key)&&(key.startsWith('path')||['node','edge','planning','actual','phaseId','q','stage','attention'].includes(key)))explicit.set(key,value);
  }catch{/* Explicit links work without local storage. */}
  return '/?'+explicit;
}
export function useCanvasNavigation(account:string,project:string,prepare?:()=>boolean|Promise<boolean>){
  const [params]=useSearchParams(),location=useLocation(),navigate=useAppNavigate();
  useEffect(()=>{if(!['/','/paths'].includes(location.pathname))return;try{sessionStorage.setItem(storageKey(account,project,canvasScope(params)),params.toString());}catch{/* Viewport remains in memory. */}},[account,project,params,location.pathname]);
  const go=async(url:string,restore=true,revealInvalid=false)=>{if(prepare&&!(await prepare())&&!revealInvalid)return;const parsed=new URL(url,'http://canvas.local');if(['/','/paths'].includes(parsed.pathname)){parsed.pathname='/';if(!parsed.searchParams.has('mode'))parsed.searchParams.set('mode',params.get('mode')||'table');url=parsed.pathname+parsed.search;}navigate(restore?restoredCanvasUrl(account,project,url):url);};
  return {params,go,root:canvasRoot(params),view:canvasView(params),back:()=>{if(prepare)void Promise.resolve(prepare()).then(ok=>{if(ok)navigate(-1);});else navigate(-1);}};
}
export function canvasReturnUrl(raw:string|null){return raw&&raw.startsWith('/')&&!raw.startsWith('//')&&['/','/paths'].includes(new URL(raw,'http://canvas.local').pathname)?raw:'/?view=features';}
