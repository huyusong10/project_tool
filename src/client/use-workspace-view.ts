import {useAppSearchParams} from './use-app-navigation';
import {useCallback,useEffect,useRef,useState} from 'react';
import {createSearchParams,type SetURLSearchParams} from 'react-router-dom';

/** Local view updates are synchronous; router changes only import history/link navigation. */
export function useWorkspaceParams(){
  const [url,writeUrl]=useAppSearchParams(),serialized=url.toString();
  const [view,setView]=useState(()=>new URLSearchParams(url));
  const current=useRef(view),written=useRef<string|null>(null);current.current=view;
  const setParams: SetURLSearchParams=useCallback((next,options)=>{
    const value=createSearchParams(typeof next==='function'?next(current.current):next);
    current.current=value;written.current=value.toString();setView(value);writeUrl(value,options);
  },[writeUrl]);
  useEffect(()=>{if(written.current===serialized){written.current=null;return;}if(current.current.toString()!==serialized){const restored=new URLSearchParams(serialized);current.current=restored;setView(restored);}},[serialized]);
  return [view,setParams] as const;
}
