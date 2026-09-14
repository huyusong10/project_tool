import {Children,Fragment,isValidElement,useContext,useEffect,useId,useLayoutEffect,useRef,useState,type ReactNode,type SelectHTMLAttributes} from 'react';
import {Check,ChevronDown,Search} from 'lucide-react';
import {AnchoredPopover} from './InlineEdit';
import {WorkspaceRuntimeContext} from '../workspace-runtime';
import './select.css';

type Option={value:string;label:string;disabled:boolean};
function text(node:ReactNode):string{return Children.toArray(node).map(child=>isValidElement<{children?:ReactNode}>(child)?text(child.props.children):String(child)).join('');}
function optionsFrom(children:ReactNode,disabled=false):Option[]{
  return Children.toArray(children).flatMap(child=>{
    if(!isValidElement<{value?:string|number;children?:ReactNode;disabled?:boolean}>(child))return [];
    if(child.type===Fragment||child.type==='optgroup')return optionsFrom(child.props.children,disabled||!!child.props.disabled);
    return child.type==='option'?[{value:String(child.props.value??text(child.props.children)),label:text(child.props.children),disabled:disabled||!!child.props.disabled}]:[];
  });
}

/** Local selection uses the same anchored popup as inline editors. The native
 * control only participates in form validation and existing change handlers. */
export function Select({children,className='',...props}:SelectHTMLAttributes<HTMLSelectElement>){
  const native=useRef<HTMLSelectElement>(null),trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),search=useRef<HTMLInputElement>(null);
  const runtime=useContext(WorkspaceRuntimeContext),listId=useId(),options=optionsFrom(children);
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(0),[invalid,setInvalid]=useState(false),[label,setLabel]=useState(props['aria-label']||'请选择');
  const [uncontrolled,setUncontrolled]=useState(String(props.defaultValue??options[0]?.value??'')),value=String(props.value??uncontrolled);
  const visible=options.filter(o=>!query||o.label.toLocaleLowerCase().includes(query.toLocaleLowerCase())),selected=options.find(o=>o.value===value),searchable=options.length>7;
  const close=(focus=false)=>{setOpen(false);setQuery('');if(focus)trigger.current?.focus({preventScroll:true});};
  const explicitLabel=props['aria-label'];
  useLayoutEffect(()=>{setLabel(explicitLabel||trigger.current?.closest('label')?.querySelector('span')?.textContent||'请选择');},[explicitLabel]);
  useEffect(()=>{
    if(!open)return;
    const frame=requestAnimationFrame(()=>{if(searchable)search.current?.focus();else panel.current?.focus();});
    const unregister=runtime?.register({element:()=>panel.current,kind:'menu',trigger:trigger.current,close:()=>setOpen(false)});
    return()=>{cancelAnimationFrame(frame);unregister?.();};
  },[open,runtime,searchable]);
  useEffect(()=>{if(open)panel.current?.querySelector('[data-active=true]')?.scrollIntoView({block:'nearest'});},[active,open]);
  const choose=(option:Option)=>{
    if(option.disabled||!native.current||native.current.matches(':disabled'))return;
    native.current.value=option.value;setUncontrolled(option.value);setInvalid(false);
    native.current.dispatchEvent(new Event('change',{bubbles:true}));close(true);
  };
  const keyDown=(event:React.KeyboardEvent)=>{
    if(event.nativeEvent.isComposing)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
    if(event.key==='Tab'){close();return;}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();const enabled=visible.map((o,i)=>o.disabled?-1:i).filter(i=>i>=0);if(!enabled.length)return;
      const i=enabled.indexOf(active);setActive(event.key==='Home'?enabled[0]:event.key==='End'?enabled.at(-1)!:enabled[(i+(event.key==='ArrowDown'?1:-1)+enabled.length)%enabled.length]);
    }else if(event.key==='Enter'||event.key===' '&&!searchable){event.preventDefault();if(visible[active])choose(visible[active]);}
    else if(!searchable&&event.key.length===1){const i=visible.findIndex(o=>!o.disabled&&o.label.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));if(i>=0)setActive(i);}
  };
  return <span className={'select-field '+className} data-preserve-edit>
    <select {...props} id={undefined} aria-label="内部表单值" aria-labelledby={undefined} ref={native} hidden tabIndex={-1} aria-hidden="true" onInvalid={event=>{event.preventDefault();setInvalid(true);trigger.current?.focus();props.onInvalid?.(event);}}>{children}</select>
    <button ref={trigger} id={props.id} type="button" className="select-trigger" role="combobox" aria-label={label} aria-expanded={open} aria-haspopup="listbox" aria-controls={open?listId:undefined} aria-required={props.required} aria-invalid={invalid||undefined} disabled={props.disabled}
      // Commit after the click: clearing another field's validation can move this trigger between mouse-down and mouse-up.
      onMouseDown={event=>event.preventDefault()}
      onClick={()=>{if(open)close();else{if(runtime?.interaction?.operation?.kind==='field')runtime.commitFields(false);setActive(Math.max(0,options.findIndex(o=>o.value===value)));setOpen(true);}}}
      onKeyDown={event=>{if(open){keyDown(event);return;}if(['ArrowDown','ArrowUp','Enter',' '].includes(event.key)){event.preventDefault();setActive(Math.max(0,options.findIndex(o=>o.value===value)));setOpen(true);}}}>
      <span>{selected?.label||value||'请选择'}</span><ChevronDown size={15}/>
    </button>
    <AnchoredPopover anchorRef={trigger} open={open} width={260} matchAnchor preserveEditing onOutside={()=>close()} onEscape={()=>close(true)} className="select-popover" role="presentation">
      <div ref={panel} tabIndex={-1} onKeyDown={keyDown} data-preserve-edit>
        {searchable&&<label className="select-search"><Search size={15}/><input ref={search} aria-label={'搜索'+label} placeholder="搜索选项" value={query} onChange={event=>{setQuery(event.target.value);setActive(0);}} aria-controls={listId} aria-activedescendant={visible[active]?listId+'-'+active:undefined}/></label>}
        <div id={listId} role="listbox" aria-label={label} className="select-options" aria-activedescendant={visible[active]?listId+'-'+active:undefined}>
          {visible.map((option,i)=><button type="button" role="option" id={listId+'-'+i} key={option.value} aria-selected={option.value===value} disabled={option.disabled} tabIndex={-1} data-active={i===active} onPointerMove={()=>setActive(i)} onClick={()=>choose(option)}><span>{option.label}</span>{option.value===value&&<Check size={15}/>}</button>)}
          {!visible.length&&<p className="select-empty">没有匹配的选项</p>}
        </div>
      </div>
    </AnchoredPopover>
  </span>;
}
