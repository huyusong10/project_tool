import {createContext,useContext,useEffect,useRef,type RefObject} from 'react';
import type {EditorInteraction} from './editor-interaction';
import type {FieldBuffer} from './editor-session';
export type WorkspaceDocument={fields:Record<string,FieldBuffer>;fieldEpoch:number;pendingField?:string;requestField:(key?:string)=>void;isFieldActive:(key:string)=>boolean;setField:(key:string,buffer?:FieldBuffer)=>unknown;captureLayout:(scope:string,positions:Record<string,import('./path-layout').Point>)=>unknown;layoutBaselines:Record<string,Record<string,import('./path-layout').Point>>;flush:()=>Promise<void>};
export type LayerKind='menu'|'finder'|'detail'|'auxiliary';
type Layer={element:()=>HTMLElement|null;kind:LayerKind;close:()=>void;trigger:HTMLElement|null};
type PointerHandlers={move?:(e:PointerEvent)=>void;up?:(e:PointerEvent)=>void;focus?:(e:FocusEvent)=>void};
export class WorkspaceRuntime{
  root:HTMLElement|null=null;lastTrigger:HTMLElement|null=null;interaction:EditorInteraction|null=null;
  fieldOwner?:{key:string;owner:string};
  document?:WorkspaceDocument;save?:()=>void;requestSave?:()=>void;revealField?:(key:string)=>void;composing=false;saveRequested=false;
  fields=new Map<symbol,{key:string;commit:()=>boolean;focus:()=>boolean;cancel:()=>void}>();
  focusPendingField(){const key=this.document?.pendingField;if(!key)return;for(const field of this.fields.values())if(field.key===key&&field.focus()){this.document?.requestField();return;}}
  private revealInvalid(key:string){this.document?.requestField(key);this.revealField?.(key);this.focusPendingField();}
  commitFields(reveal=true){for(const field of this.fields.values())if(!field.commit()){if(reveal)this.revealInvalid(field.key);return false;}const invalid=Object.entries(this.document?.fields||{}).find(([,f])=>f.error);if(invalid){if(reveal)this.revealInvalid(invalid[0]);return false;}return true;}
  private layers=new Map<symbol,Layer>();private pointers=new Set<PointerHandlers>();
  covers(target:Element){return !!target.closest('[data-workspace-zone]')||[...this.layers.values()].some(layer=>layer.element()?.contains(target));}
  register(layer:Layer){const id=Symbol();this.layers.set(id,layer);return()=>{this.layers.delete(id);};}
  subscribe(handlers:PointerHandlers){this.pointers.add(handlers);return()=>{this.pointers.delete(handlers);};}
  pointerMove=(event:PointerEvent)=>{for(const handler of this.pointers)handler.move?.(event);};
  pointerUp=(event:PointerEvent)=>{for(const handler of this.pointers)handler.up?.(event);};
  focus=(event:FocusEvent)=>{for(const handler of this.pointers)handler.focus?.(event);};
  cancel=()=>{this.interaction?.cancel();};
  private close(layer:Layer,restore:boolean){const element=layer.element(),active=document.activeElement;layer.close();if(restore&&(active===document.body||active instanceof Node&&element?.contains(active))){const target=layer.trigger?.isConnected?layer.trigger:this.root?.querySelector<HTMLElement>('.dependency-canvas');target?.focus({preventScroll:true});}}
  dismiss(target?:Element){const layers=[...this.layers.values()].reverse();const layer=layers.find(l=>target&&l.element()?.contains(target))||layers[0];if(!layer)return false;this.close(layer,true);return true;}
  outside=(event:PointerEvent)=>{
    const target=event.target;if(target instanceof Element&&(this.root?.contains(target)||target.closest('.topbar,[data-workspace-zone="tools"]'))){const button=target.closest<HTMLElement>('button,summary');if(button)this.lastTrigger=button;}if(!(target instanceof Element)||target.closest('[role=dialog],.modal-backdrop'))return;
    const layers=[...this.layers.values()].reverse(),inside=layers.find(l=>l.element()?.contains(target));
    for(const layer of layers)if(layer.kind==='menu'&&!layer.element()?.contains(target)&&!layer.trigger?.contains(target))this.close(layer,false);
    if(inside){if(this.interaction?.operation?.kind!=='field')this.cancel();return;}
    const zone=target.closest<HTMLElement>('[data-workspace-zone]')?.dataset.workspaceZone;
    for(const layer of layers){
      if(layer.kind==='menu')continue;
      if(zone==='tools'||zone==='notice'||zone==='controls')continue;
      if(layer.kind==='detail'&&(target.closest('.react-flow__node,.react-flow__edge')))continue;
      this.close(layer,false);
    }
  };
  focusOut=(event:FocusEvent)=>{const target=event.relatedTarget;if(!(target instanceof Node))return;for(const layer of this.layers.values())if(layer.kind==='menu'&&layer.element()?.contains(event.target as Node)&&!layer.element()?.contains(target)&&!layer.trigger?.contains(target))this.close(layer,false);};
}
export const WorkspaceRuntimeContext=createContext<WorkspaceRuntime|null>(null);
export function useWorkspaceRuntime(){const runtime=useContext(WorkspaceRuntimeContext);if(!runtime)throw new Error('缺少工作区运行环境');return runtime;}
export function useWorkspaceLayer(ref:RefObject<HTMLElement|null>,enabled:boolean,kind:LayerKind,onDismiss:()=>void,identity?:string){
  const runtime=useWorkspaceRuntime(),latest=useRef(onDismiss);latest.current=onDismiss;
  useEffect(()=>{if(!enabled)return;return runtime.register({element:()=>ref.current,kind,close:()=>latest.current(),trigger:kind==='finder'?runtime.root?.querySelector<HTMLElement>('[aria-label="查找与筛选"]')||null:runtime.lastTrigger|| (document.activeElement instanceof HTMLElement?document.activeElement:null)});},[runtime,ref,enabled,kind,identity]);
}
export function useWorkspaceEvents(runtime:WorkspaceRuntime,root:RefObject<HTMLElement|null>){
  useEffect(()=>{runtime.root=root.current;const hidden=()=>{if(document.hidden)runtime.cancel();};document.addEventListener('pointerdown',runtime.outside,true);document.addEventListener('pointermove',runtime.pointerMove);document.addEventListener('pointerup',runtime.pointerUp);document.addEventListener('pointercancel',runtime.cancel);document.addEventListener('focusin',runtime.focus);document.addEventListener('focusout',runtime.focusOut);window.addEventListener('blur',runtime.cancel);document.addEventListener('visibilitychange',hidden);
    return()=>{runtime.commitFields(false);runtime.cancel();document.removeEventListener('pointerdown',runtime.outside,true);document.removeEventListener('pointermove',runtime.pointerMove);document.removeEventListener('pointerup',runtime.pointerUp);document.removeEventListener('pointercancel',runtime.cancel);document.removeEventListener('focusin',runtime.focus);document.removeEventListener('focusout',runtime.focusOut);window.removeEventListener('blur',runtime.cancel);document.removeEventListener('visibilitychange',hidden);};},[runtime,root]);
}
