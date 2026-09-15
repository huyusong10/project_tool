import {X,Maximize2,Minimize2} from 'lucide-react';
import './object-inspector.css';
import {useRef,useState,type ReactNode} from 'react';
import {useWorkspaceLayer} from '../workspace-runtime';

export function ObjectInspector({title,identity,onClose,children,hidden=false}:{hidden?:boolean;title:string;identity:string;onClose:()=>void;children:ReactNode}){
  const ref=useRef<HTMLElement>(null),[wide,setWide]=useState(false);
  useWorkspaceLayer(ref,true,'detail',onClose,identity);
  return <aside hidden={hidden} ref={ref} className={'workspace-object-inspector'+(wide?' is-wide':'')} aria-label="对象详情" onKeyDown={e=>{if(e.key==='Escape'&&!e.defaultPrevented){e.preventDefault();onClose();}}}>
    <header><h3>{title}</h3><button className="icon-button" title={wide?'收起详情':'展开详情'} aria-label={wide?'收起详情':'展开详情'} onClick={()=>setWide(v=>!v)}>{wide?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button><button className="icon-button" aria-label="关闭" title="关闭" onClick={onClose}><X size={17}/></button></header>
    <div className="object-inspector-body">{children}</div>
  </aside>;
}
