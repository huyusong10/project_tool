import { Button } from './Button';
import {useContext,useEffect,useRef,useState,type ButtonHTMLAttributes} from 'react';
import {Info} from 'lucide-react';
import {AnchoredPopover} from './InlineEdit';
import {WorkspaceRuntimeContext} from '../workspace-runtime';
import {useLocation} from 'react-router-dom';

/** Status occupies its own slot; explanations never change the toolbar height. */
export function ToolbarStatus({children,title,onClick,disabled,...props}:ButtonHTMLAttributes<HTMLButtonElement>){
  const anchor=useRef<HTMLButtonElement>(null),[open,setOpen]=useState(false);
  const panel=useRef<HTMLDivElement>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const runtime=useContext(WorkspaceRuntimeContext);
  const location=useLocation();
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  useEffect(()=>setOpen(false),[location.key]);
  useEffect(()=>{if(open)return runtime?.register({element:()=>panel.current,kind:'menu',trigger:anchor.current,close:()=>setOpen(false)});},[open,runtime]);
  const cancelClose=()=>clearTimeout(timer.current);
  const close=()=>{cancelClose();setOpen(false);};
  const leave=()=>{cancelClose();timer.current=setTimeout(()=>{if(!panel.current?.contains(document.activeElement)&&document.activeElement!==anchor.current)close();},180);};
  return <>
    <button {...props} ref={anchor} type="button" className="canvas-draft-status toolbar-status-trigger" aria-label={props['aria-label']||'草稿状态'} aria-expanded={open} aria-haspopup="dialog"
      onBlur={event=>{if(event.relatedTarget instanceof Node&&!panel.current?.contains(event.relatedTarget))close();}}
      onPointerEnter={event=>{cancelClose();if(event.pointerType==='mouse')setOpen(true);}} onPointerLeave={leave} onClick={()=>setOpen(true)} onKeyDown={event=>{if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close();}else if(event.key==='ArrowDown'){event.preventDefault();setOpen(true);}}}>
      <span className="toolbar-status-dot" aria-hidden="true"/><span>{children}</span><Info size={13} aria-hidden="true"/>
    </button>
    <AnchoredPopover anchorRef={anchor} open={open} onOutside={close} onEscape={()=>{close();anchor.current?.focus({preventScroll:true});}} width={280} className="toolbar-status-popover" role="presentation" preserveEditing>
      <div ref={panel} role="dialog" aria-label="状态说明" onPointerEnter={cancelClose} onPointerLeave={leave} onBlur={event=>{if(event.relatedTarget instanceof Node&&!panel.current?.contains(event.relatedTarget)&&event.relatedTarget!==anchor.current)close();}}>
      <strong>{children}</strong><p>{children==='已保存'?'当前修改已保存。':title||'可查看本机草稿、保存记录和需要处理的问题。'}</p>
      {onClick&&<Button variant="secondary" type="button" className="ghost-button" disabled={disabled} onClick={event=>{close();onClick(event);}}>查看详情</Button>}
      </div>
    </AnchoredPopover>
  </>;
}
