import './object-inspector.css';
import {useRef,useState,type ReactNode} from 'react';
import {useWorkspaceLayer} from '../workspace-runtime';

export function ObjectInspector({title,identity,onClose,children,hidden=false}:{hidden?:boolean;title:string;identity:string;onClose:()=>void;children:ReactNode}){
  const ref=useRef<HTMLElement>(null),[wide,setWide]=useState(false);
  useWorkspaceLayer(ref,true,'detail',onClose,identity);
  return <aside hidden={hidden} ref={ref} className={'workspace-object-inspector'+(wide?' is-wide':'')} aria-label="对象详情" onKeyDown={e=>{if(e.key==='Escape'&&!e.defaultPrevented){e.preventDefault();onClose();}}}>
    <header><h3>{title}</h3><button className="ghost-button" onClick={()=>setWide(v=>!v)}>{wide?'收起':'展开'}</button><button className="ghost-button" onClick={onClose}>关闭</button></header>
    <div className="object-inspector-body">{children}</div>
  </aside>;
}
