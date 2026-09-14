import {useCallback,useState,type SetStateAction} from 'react';
import {useSession} from './app-context';

/** Unsubmitted input is separate from immutable pending-request receipts. */
export function useDeliveryForm<T>(projectId:string,object:string,initial:()=>T,pending=false){
  const {session}=useSession(),key='pm-delivery-inputs:'+(session.accountId||session.username||'guest')+':'+projectId+':'+object;
  const [value,setValue]=useState<T>(()=>{if(!pending)try{const saved=sessionStorage.getItem(key);if(saved)return JSON.parse(saved) as T;}catch{/* Invalid local input does not block loading formal data. */}return initial();});
  const set=useCallback((next:SetStateAction<T>)=>setValue(old=>{const value=typeof next==='function'?(next as (old:T)=>T)(old):next;try{sessionStorage.setItem(key,JSON.stringify(value));}catch{/* Keep the open form's input. */}return value;}),[key]);
  const clear=useCallback(()=>{try{sessionStorage.removeItem(key);}catch{/* The current form can still close. */}},[key]);
  return [value,set,clear] as const;
}
