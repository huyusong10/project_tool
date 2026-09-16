import { Button } from './Button';
import {X,Maximize2,Minimize2,ArrowUpRight} from 'lucide-react';
import {hasActiveSortDrag} from './DragPreview';
import './object-inspector.css';
import {useRef,useState,type ReactNode} from 'react';
import {useWorkspaceLayer} from '../workspace-runtime';

export function ObjectInspector({title,identity,onClose,onEnter,children,hidden=false}:{hidden?:boolean;title:string;identity:string;onClose:()=>void;onEnter?:()=>void;children:ReactNode}){
  const ref=useRef<HTMLElement>(null),[wide,setWide]=useState(false);
  const close=()=>{const action=Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-detail-action]')||[]).at(-1);if(action){action.querySelector<HTMLButtonElement>('[data-detail-back]')?.click();return;}onClose();};
  useWorkspaceLayer(ref,true,'detail',close,identity);
  return <aside hidden={hidden} ref={ref} className={'workspace-object-inspector'+(wide?' is-wide':'')} aria-label="对象详情" onKeyDown={e=>{if(e.key==='Escape'&&!e.defaultPrevented&&!hasActiveSortDrag()){e.preventDefault();close();}}}>
    <header><h3 title={title}>{title}</h3>{onEnter&&<Button variant="ghost" iconOnly className="icon-button" aria-label="进入来源" title="进入来源" onClick={onEnter}><ArrowUpRight size={16}/></Button>}<Button variant="ghost" iconOnly className="icon-button inspector-size-toggle" title={wide?'收起详情':'展开详情'} aria-label={wide?'收起详情':'展开详情'} onClick={()=>setWide(v=>!v)}>{wide?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</Button><Button variant="ghost" iconOnly className="icon-button" aria-label="关闭" title="关闭" onClick={close}><X size={17}/></Button></header>
    <div className="object-inspector-body">{children}</div>
  </aside>;
}
