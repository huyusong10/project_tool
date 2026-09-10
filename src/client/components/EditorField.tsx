import {useEffect,useRef,useState,useId,type InputHTMLAttributes} from 'react';
import {useWorkspaceRuntime} from '../workspace-runtime';

/** The same field transaction backs native properties and inline card names. */
export function EditorField({fieldKey,value,onCommit,inline=false,multiline=false,...input}:Omit<InputHTMLAttributes<HTMLInputElement>,'value'|'onChange'> & {fieldKey:string;value:string;onCommit:(value:string)=>void;inline?:boolean;multiline?:boolean}){
  const runtime=useWorkspaceRuntime(),owner=useId(),saved=inline||runtime.fieldOwner?.key===fieldKey&&runtime.fieldOwner.owner!==owner?undefined:runtime.document?.fields[fieldKey];
  const [raw,setRaw]=useState(saved?.value??value),[editing,setEditing]=useState(false),[error,setError]=useState(saved?.error||'');
  const element=useRef<HTMLInputElement&HTMLTextAreaElement&HTMLElement>(null),state=useRef({raw,original:saved?.original??value,dirty:!!saved});
  const latest=useRef({value,onCommit});latest.current={value,onCommit};
  const ticket=useRef<number|undefined>(undefined);
  const epoch=runtime.document?.fieldEpoch,fieldEpoch=useRef(epoch);
  const release=()=>{if(runtime.fieldOwner?.owner===owner)runtime.fieldOwner=undefined;};
  const finish=(cancel=false)=>{
    if(runtime.document?.isFieldActive(fieldKey)===false||fieldEpoch.current!==runtime.document?.fieldEpoch){
      if(ticket.current!==undefined)runtime.interaction?.complete(ticket.current,()=>{});ticket.current=undefined;release();return true;
    }
    if(!state.current.dirty&&!editing){if(ticket.current!==undefined)runtime.interaction?.complete(ticket.current,()=>{});ticket.current=undefined;release();return true;}
    const text=cancel?state.current.original:state.current.raw;
    const invalid=!cancel&&(input.required&&!text.trim()?'请填写名称':input.type==='number'&&(!text.trim()||!Number.isFinite(Number(text))||Number(text)<Number(input.min??0)||input.max!==undefined&&Number(text)>Number(input.max))?'请输入有效工期':'');
    if(invalid){setError(invalid);runtime.document?.setField(fieldKey,{value:text,original:state.current.original,error:invalid});if(ticket.current!==undefined)runtime.interaction?.complete(ticket.current,()=>{});ticket.current=undefined;release();return false;}
    if(inline&&element.current)element.current.textContent=text;
    state.current={raw:text,original:text,dirty:false};setRaw(text);setError('');setEditing(false);
    runtime.document?.setField(fieldKey);
    if(!cancel&&text!==latest.current.value)latest.current.onCommit(text);
    if(ticket.current!==undefined){runtime.interaction?.complete(ticket.current,()=>{});ticket.current=undefined;}
    release();return true;
  };
  const focus=()=>{const node=element.current;if(!node||!node.isConnected||node.matches(':disabled')||node.closest('[inert],[aria-hidden="true"]')||inline&&!editing)return false;for(let parent=node.parentElement;parent;parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)parent.open=true;node.focus({preventScroll:true});if(document.activeElement!==node)return false;node.scrollIntoView({block:'nearest',inline:'nearest'});return true;};
  const actions=useRef({commit:()=>inline&&!editing?true:finish(),focus,cancel:()=>{finish(true);}});actions.current={commit:()=>inline&&!editing?true:finish(),focus,cancel:()=>{finish(true);}};
  useEffect(()=>{const handlers={key:fieldKey,commit:()=>actions.current.commit(),focus:()=>actions.current.focus(),cancel:()=>actions.current.cancel()};const id=Symbol(fieldKey);runtime.fields.set(id,handlers);return()=>{handlers.commit();runtime.fields.delete(id);};},[runtime,fieldKey,inline]);
  useEffect(()=>{if(runtime.document?.pendingField===fieldKey)runtime.focusPendingField();});
  useEffect(()=>{if(saved&&!state.current.dirty){state.current={raw:saved.value,original:saved.original,dirty:true};setRaw(saved.value);setError(saved.error||'');}},[saved]);
  useEffect(()=>{if(!state.current.dirty){state.current.raw=value;state.current.original=value;setRaw(value);}},[value]);
  useEffect(()=>{if(fieldEpoch.current===epoch)return;fieldEpoch.current=epoch;const buffer=inline?undefined:runtime.document?.fields[fieldKey],value=buffer?.value??latest.current.value;state.current={raw:value,original:buffer?.original??latest.current.value,dirty:!!buffer};setRaw(value);setError(buffer?.error||'');setEditing(false);},[epoch,runtime,fieldKey,inline]);
  const change=(text:string)=>{state.current.raw=text;state.current.dirty=true;setRaw(text);runtime.document?.setField(fieldKey,{value:text,original:state.current.original});};
  const start=()=>{state.current.original=latest.current.value;ticket.current=runtime.interaction?.begin('field',()=>actions.current.cancel());runtime.fieldOwner={key:fieldKey,owner};};
  const key=(event:React.KeyboardEvent<HTMLElement>)=>{
    if(event.nativeEvent.isComposing||event.nativeEvent.keyCode===229)return;
    if(event.key==='Escape'){if(state.current.dirty||inline){event.preventDefault();event.stopPropagation();}finish(true);if(inline)element.current?.blur();}
    if(inline&&event.key==='Enter'){event.preventDefault();event.stopPropagation();if(finish())element.current?.blur();}
  };
  if(inline)return <strong ref={element} title={value} tabIndex={input.disabled?undefined:0} data-inline-title={fieldKey.replace(/^title:/,'')} className={editing?'nodrag nopan':undefined} contentEditable={editing} suppressContentEditableWarning
    onDoubleClick={event=>{if(input.disabled)return;event.stopPropagation();start();setEditing(true);requestAnimationFrame(()=>{const node=element.current;if(!node)return;node.focus();const range=document.createRange();range.selectNodeContents(node);window.getSelection()?.removeAllRanges();window.getSelection()?.addRange(range);});}}
    onFocus={()=>{if(editing&&ticket.current===undefined)start();}} onInput={e=>change(e.currentTarget.textContent||'')} onBlur={()=>finish()} onClick={e=>{if(editing)e.stopPropagation();}} onKeyDown={key}>{editing?state.current.original:raw}</strong>;
  if(multiline)return <><textarea aria-label={input['aria-label']} disabled={input.disabled} required={input.required} ref={element} value={raw} aria-invalid={!!error} onFocus={start} onChange={e=>change(e.target.value)} onBlur={()=>finish()} onKeyDown={key}/>{error&&<small role="alert" className="form-error">{error}</small>}</>;
  return <><input {...input} ref={element} value={raw} aria-invalid={!!error} onFocus={start} onChange={e=>change(e.target.value)} onBlur={()=>finish()} onKeyDown={key}/>{error&&<small role="alert" className="form-error">{error}</small>}</>;
}
