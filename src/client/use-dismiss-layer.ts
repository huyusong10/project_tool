import {useEffect, useRef, type RefObject} from 'react';

/** Dismiss the whole layer, never individual fields or the browser's native picker. */
export function useDismissLayer(ref:RefObject<HTMLElement|null>,enabled:boolean,onDismiss:()=>void,ignore=''){
  const latest=useRef({onDismiss,ignore});latest.current={onDismiss,ignore};
  useEffect(()=>{
    if(!enabled)return;
    const outside=(event:Event)=>{
      const target=event.target;
      if(!(target instanceof Element)||!ref.current||ref.current.contains(target)||target.closest('[role="dialog"],.modal-backdrop'))return;
      if(latest.current.ignore&&target.closest(latest.current.ignore))return;
      const active=document.activeElement;if(active instanceof HTMLElement&&ref.current.contains(active))active.blur();
      latest.current.onDismiss();
    };
    const escape=(event:KeyboardEvent)=>{
      if(event.key!=='Escape'||event.defaultPrevented||!ref.current?.contains(event.target as Node))return;
      event.preventDefault();event.stopPropagation();latest.current.onDismiss();
    };
    document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape);};
  },[ref,enabled]);
}
