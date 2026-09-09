import {useState,type SetStateAction} from 'react';
function read(key:string):string|null{try{const saved=JSON.parse(sessionStorage.getItem('pm-path-view:'+key)||'null');return typeof saved==='string'?saved:null;}catch{return null;}}
export function useViewPreference<T extends string>(key:string,fallback:T,legacy?:{key:string;defaultValue:T}){
  const [local,setLocal]=useState<{key:string;value:T}|null>(null);
  const saved=read(key),old=legacy?read(legacy.key):null;
  const value=local?.key===key?local.value:(saved??(legacy&&old!==legacy.defaultValue?old:null)??fallback) as T;
  const setValue=(next:SetStateAction<T>)=>{const updated=typeof next==='function'?next(value):next;setLocal({key,value:updated});try{sessionStorage.setItem('pm-path-view:'+key,JSON.stringify(updated));}catch{/* The current view still works. */}};
  return [value,setValue] as const;
}
