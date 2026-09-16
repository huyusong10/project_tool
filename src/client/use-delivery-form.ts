import {useCallback,useRef,useState,type SetStateAction} from 'react';
import {useGuestWorkspace,useSession} from './app-context';

/** Unsubmitted input is separate from immutable pending-request receipts. */
export function useDeliveryForm<T>(projectId:string,object:string,initial:()=>T,pending=false){
  const {session}=useSession(),key='pm-delivery-inputs:'+(session.accountId||session.username||'guest')+':'+projectId+':'+object;
  const guest=useGuestWorkspace(projectId);
  const initialRef=useRef(initial);initialRef.current=initial;
  const read=useCallback(()=>{
    if(!guest&&!pending)try{const saved=sessionStorage.getItem(key);if(saved)return JSON.parse(saved) as T;}catch{/* Invalid local input does not block loading formal data. */}
    return initialRef.current();
  },[key,pending,guest]);
  const [state,setState]=useState(()=>({key,value:read()}));
  let value=state.value;
  // A mounted form may change project or account without being replaced by its parent.
  if(state.key!==key){value=read();setState({key,value});}
  const set=useCallback((next:SetStateAction<T>)=>setState(old=>{
    const previous=old.key===key?old.value:read();
    const value=typeof next==='function'?(next as (old:T)=>T)(previous):next;
    try{if(!guest)sessionStorage.setItem(key,JSON.stringify(value));}catch{/* Keep the open form's input. */}
    return {key,value};
  }),[key,read,guest]);
  const clear=useCallback(()=>{try{sessionStorage.removeItem(key);}catch{/* The current form can still close. */}},[key]);
  return [value,set,clear] as const;
}
