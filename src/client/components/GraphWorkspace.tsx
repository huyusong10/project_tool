import { useEffect,useLayoutEffect,useRef,useState,useContext,type ComponentProps,type CSSProperties,type ReactNode } from 'react';
import { DependencyGraph } from './DependencyGraph';
import '../paths.css';
import {WorkspaceRuntime,WorkspaceRuntimeContext,useWorkspaceLayer,useWorkspaceEvents,type WorkspaceDocument} from '../workspace-runtime';
import {flushSync} from 'react-dom';
import {FindTool} from './EditorToolbar';
type PanelSize='compact'|'timeline'|'expanded';
function FloatingPanel({content,side,replacement,contentKey,analysis=false,size='compact',onDismiss}:{onDismiss?:()=>void;analysis?:boolean;size?:PanelSize;content:ReactNode;side:'left'|'right';replacement:boolean;contentKey?:string}){
  const ref=useRef<HTMLElement>(null),hadFocus=useRef(false);
  useWorkspaceLayer(ref,!!content&&!!onDismiss,side==='right'?'detail':'auxiliary',()=>onDismiss?.(),contentKey);
  const [retained,setRetained]=useState(content?{content,contentKey,analysis,size}:null),geometry=useRef<CSSProperties|undefined>(undefined);
  useLayoutEffect(()=>{
    if(content){
      setRetained({content,contentKey,analysis,size});
      const element=ref.current!;
      const measure=()=>{geometry.current={left:element.offsetLeft,top:element.offsetTop,right:'auto',bottom:'auto',width:element.offsetWidth,height:element.offsetHeight,maxWidth:'none',maxHeight:'none'};};
      measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();
    }
    const active=document.activeElement;
    if(hadFocus.current&&(active===document.body||active instanceof Node&&ref.current?.contains(active)))ref.current?.closest<HTMLElement>('.graph-workspace')?.querySelector<HTMLElement>('.dependency-canvas')?.focus({preventScroll:true});
    hadFocus.current=false;
    const timer=setTimeout(()=>setRetained(null),matchMedia('(prefers-reduced-motion:reduce)').matches?0:200);return()=>clearTimeout(timer);
  },[content,contentKey,analysis,size]);
  const shown=content?{content,contentKey,analysis,size}:retained;
  if(!shown||!content&&replacement&&matchMedia('(max-width:800px)').matches)return null;
  return <aside ref={ref} onFocusCapture={()=>{hadFocus.current=true;}} onBlurCapture={e=>{if(e.relatedTarget instanceof Node&&!e.currentTarget.contains(e.relatedTarget))hadFocus.current=false;}} className={(side==='right'?'graph-detail':'graph-auxiliary')+' graph-overlay nopan nodrag nowheel'+(!content?' is-leaving':'')} data-graph-panel={shown.analysis?'bottom':side} data-size={shown.size} style={!content?geometry.current:undefined} aria-hidden={!content} inert={!content}><div key={shown.contentKey} className="graph-panel-content">{shown.content}</div></aside>;
}
function Workspace({ document:editorDocument, auxiliaryKey, toolbar, detail, auxiliary, footer, finder,palette,analysis=false,auxiliarySize='compact',onDismissDetail,onDismissAuxiliary, ...graph }: ComponentProps<typeof DependencyGraph> & {
  document:WorkspaceDocument;auxiliaryKey?:string;onDismissDetail?:()=>void;onDismissAuxiliary?:()=>void;toolbar: ReactNode; detail?: ReactNode; auxiliary?: ReactNode; footer?: ReactNode;finder?:ReactNode;palette?:ReactNode;analysis?:boolean;auxiliarySize?:PanelSize;
}) {
  const root=useRef<HTMLElement>(null),finderRef=useRef<HTMLDivElement>(null);
  const runtime=useContext(WorkspaceRuntimeContext)!;runtime.document=editorDocument;runtime.interaction=graph.interaction;runtime.revealField=graph.onRevealField;runtime.save=()=>{graph.commands.dispatch({type:'save'});};useWorkspaceEvents(runtime,root);
  const requestSave=()=>{if(runtime.composing){runtime.saveRequested=true;return;}if(runtime.interaction?.operation&&runtime.interaction.operation.kind!=='field'){runtime.cancel();return;}let valid=false;flushSync(()=>{valid=runtime.commitFields();});if(valid)runtime.save?.();};
  const finderKey='pm-graph-view:'+graph.viewKey+':finder';
  const finderHistoryKey=graph.historyIndex===undefined?null:finderKey+':history:'+graph.historyIndex;
  const [finding,setFinding]=useState(()=>{try{return ((finderHistoryKey?sessionStorage.getItem(finderHistoryKey):null)??localStorage.getItem(finderKey))==='true';}catch{return false;}});
  useWorkspaceLayer(finderRef,finding,'finder',()=>setFinding(false));
  useEffect(()=>{try{localStorage.setItem(finderKey,String(finding));if(finderHistoryKey)sessionStorage.setItem(finderHistoryKey,String(finding));}catch{/* View is still usable. */}},[finderKey,finderHistoryKey,finding]);
  useEffect(()=>{
    const element=root.current;if(!element)return;
    const footer=element.querySelector('.graph-footer')!,controls=element.querySelector('.graph-view-controls')!;
    const update=()=>{
      const box=element.getBoundingClientRect(),a=footer.getBoundingClientRect(),b=controls.getBoundingClientRect();
      const finder=element.querySelector('.graph-finder');element.style.setProperty('--graph-find-bottom',((finder?finder.getBoundingClientRect().bottom:box.top)-box.top+12)+'px');
      const stacked=box.width<801||a.width+b.width+44>box.width;
      element.dataset.stacked=String(stacked);
      element.style.setProperty('--graph-footer-height',a.height+'px');
      // Reserve 12px clearance even at the 8px entry-animation offset.
      const bottom=box.bottom-Math.min(footer.getBoundingClientRect().top,controls.getBoundingClientRect().top)+20;
      element.style.setProperty('--graph-bottom-clearance',bottom+'px');
    };
    const observer=new ResizeObserver(update);[element,footer,controls,element.querySelector('.graph-finder')].filter((e):e is HTMLElement=>!!e).forEach(e=>observer.observe(e));update();
    return()=>observer.disconnect();
  },[finding]);
  return <section ref={root} className={'graph-workspace graph-editor-workspace'+(finding?' has-finder':'')+(analysis?' has-analysis':'')+(detail?' has-inspector':'')} aria-label="交付依赖工作区" onCompositionStart={()=>{runtime.composing=true;}} onCompositionEnd={()=>{runtime.composing=false;if(runtime.saveRequested){runtime.saveRequested=false;queueMicrotask(requestSave);}}}
    onClickCapture={e=>{if((e.target as HTMLElement).closest('[aria-label="保存修改"]')){e.preventDefault();e.stopPropagation();requestSave();}}}
    onKeyDownCapture={e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();e.stopPropagation();requestSave();}}}
    onKeyDown={e=>{const input=(e.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]');if(!e.defaultPrevented&&!input&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.stopPropagation();if(!runtime.interaction?.cancel())graph.commands.dispatch({type:e.shiftKey?'redo':'undo'});return;}if(e.key!=='Escape'||e.defaultPrevented||e.nativeEvent.isComposing)return;if(runtime.interaction?.operation){e.preventDefault();e.stopPropagation();runtime.cancel();return;}if(runtime.dismiss(e.target as Element)){e.preventDefault();e.stopPropagation();}}}>

    <DependencyGraph {...graph} originPositions={editorDocument.layoutBaselines[graph.viewKey]} onOrigin={positions=>editorDocument.captureLayout(graph.viewKey,positions)} onDismissOverlays={()=>runtime.dismiss()} onSearch={()=>{setFinding(true);graph.onSearch?.();requestAnimationFrame(()=>root.current?.querySelector<HTMLInputElement>('.graph-finder input')?.focus());}}/>
      {toolbar}
      <div className="graph-tool-rail graph-overlay nopan nodrag nowheel" data-graph-panel="left" data-workspace-zone="tools">{palette}{finder&&<FindTool onClick={()=>setFinding(v=>!v)}/>}</div>
      {finder&&finding&&<div ref={finderRef} className="graph-finder graph-overlay nopan nodrag nowheel" data-graph-panel="left">{finder}</div>}
      <FloatingPanel onDismiss={onDismissDetail} content={detail} side="right" replacement={!!auxiliary} contentKey={JSON.stringify(graph.interaction.selection)}/>
      <FloatingPanel contentKey={auxiliaryKey} onDismiss={onDismissAuxiliary} analysis={analysis} size={auxiliarySize} content={auxiliary} side="left" replacement={!!detail}/>
      <div className="graph-footer graph-overlay nopan nodrag nowheel" data-graph-panel="bottom" data-workspace-zone="tools">{footer}</div>

  </section>;
}

export function GraphWorkspace(props:ComponentProps<typeof Workspace>){const [runtime]=useState(()=>new WorkspaceRuntime());return <WorkspaceRuntimeContext.Provider value={runtime}><Workspace {...props}/></WorkspaceRuntimeContext.Provider>;}
