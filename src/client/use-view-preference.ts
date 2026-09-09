import {useEffect,useState} from 'react';
export function useViewPreference<T extends string>(key:string,fallback:T){
  const [value,setValue]=useState<T>(()=>{try{const saved=JSON.parse(sessionStorage.getItem('pm-path-view:'+key)||'null');return typeof saved==='string'?saved as T:fallback;}catch{return fallback;}});
  useEffect(()=>{try{sessionStorage.setItem('pm-path-view:'+key,JSON.stringify(value));}catch{/* The current view still works. */}},[key,value]);
  return [value,setValue] as const;
}
