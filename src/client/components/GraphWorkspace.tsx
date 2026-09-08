import { useEffect,useLayoutEffect,useRef,useState,type ComponentProps,type CSSProperties,type ReactNode } from 'react';
import { DependencyGraph } from './DependencyGraph';
import '../paths.css';
import {useDismissLayer} from '../use-dismiss-layer';
import {FindTool} from './EditorToolbar';
type PanelSize='compact'|'timeline'|'expanded';
function FloatingPanel({content,side,replacement,contentKey,analysis=false,size='compact',onDismiss}:{onDismiss?:()=>void;analysis?:boolean;size?:PanelSize;content:ReactNode;side:'left'|'right';replacement:boolean;contentKey?:string}){
  const ref=useRef<HTMLElement>(null);
  useDismissLayer(ref,!!content&&!!onDismiss,()=>onDismiss?.(),side==='right'?'.graph-overlay,.graph-view-controls,.react-flow__node,.react-flow__edge,.dependency-layout-notice':'.graph-toolbar,.graph-tool-rail,.graph-finder,.graph-footer,.graph-view-controls,.dependency-layout-notice');
  const [retained,setRetained]=useState(content?{content,contentKey,analysis,size}:null),geometry=useRef<CSSProperties|undefined>(undefined);
  useLayoutEffect(()=>{
    if(content){
      setRetained({content,contentKey,analysis,size});
      const element=ref.current!;
      const measure=()=>{geometry.current={left:element.offsetLeft,top:element.offsetTop,right:'auto',bottom:'auto',width:element.offsetWidth,height:element.offsetHeight,maxWidth:'none',maxHeight:'none'};};
      measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();
    }
    const timer=setTimeout(()=>setRetained(null),matchMedia('(prefers-reduced-motion:reduce)').matches?0:200);return()=>clearTimeout(timer);
  },[content,contentKey,analysis,size]);
  const shown=content?{content,contentKey,analysis,size}:retained;
  if(!shown||!content&&replacement&&matchMedia('(max-width:800px)').matches)return null;
  return <aside ref={ref} className={(side==='right'?'graph-detail':'graph-auxiliary')+' graph-overlay nopan nodrag nowheel'+(!content?' is-leaving':'')} data-graph-panel={shown.analysis?'bottom':side} data-size={shown.size} style={!content?geometry.current:undefined} aria-hidden={!content} inert={!content}><div key={shown.contentKey} className="graph-panel-content">{shown.content}</div></aside>;
}
export function GraphWorkspace({ toolbar, detail, auxiliary, footer, finder,palette,analysis=false,auxiliarySize='compact',onDismissDetail,onDismissAuxiliary, ...graph }: ComponentProps<typeof DependencyGraph> & {
  onDismissDetail?:()=>void;onDismissAuxiliary?:()=>void;toolbar: ReactNode; detail?: ReactNode; auxiliary?: ReactNode; footer?: ReactNode;finder?:ReactNode;palette?:ReactNode;analysis?:boolean;auxiliarySize?:PanelSize;
}) {
  const root=useRef<HTMLElement>(null),finderRef=useRef<HTMLDivElement>(null);
  const finderKey='pm-graph-view:'+graph.viewKey+':finder';
  const [finding,setFinding]=useState(()=>{try{return localStorage.getItem(finderKey)==='true';}catch{return false;}});
  useDismissLayer(finderRef,finding,()=>setFinding(false),'.graph-tool-rail,.graph-auxiliary,.graph-toolbar,.graph-footer,.graph-view-controls');
  useEffect(()=>{try{localStorage.setItem(finderKey,String(finding));}catch{/* View is still usable. */}},[finderKey,finding]);
  useEffect(()=>{
    const element=root.current;if(!element)return;
    const toolbar=element.querySelector('.graph-toolbar')!,footer=element.querySelector('.graph-footer')!,controls=element.querySelector('.graph-view-controls')!;
    const update=()=>{
      const box=element.getBoundingClientRect(),a=footer.getBoundingClientRect(),b=controls.getBoundingClientRect();
      const finder=element.querySelector('.graph-finder');element.style.setProperty('--graph-find-bottom',((finder?finder.getBoundingClientRect().bottom:toolbar.getBoundingClientRect().bottom)-box.top+12)+'px');
      const stacked=box.width<801||a.width+b.width+44>box.width;
      element.dataset.stacked=String(stacked);
      element.style.setProperty('--graph-toolbar-bottom',(toolbar.getBoundingClientRect().bottom-box.top+12)+'px');
      element.style.setProperty('--graph-footer-height',a.height+'px');
      // Reserve 12px clearance even at the 8px entry-animation offset.
      const bottom=box.bottom-Math.min(footer.getBoundingClientRect().top,controls.getBoundingClientRect().top)+20;
      element.style.setProperty('--graph-bottom-clearance',bottom+'px');
    };
    const observer=new ResizeObserver(update);[element,toolbar,footer,controls,element.querySelector('.graph-finder')].filter((e):e is HTMLElement=>!!e).forEach(e=>observer.observe(e));update();
    return()=>observer.disconnect();
  },[finding]);
  return <section ref={root} className={'graph-workspace graph-editor-workspace'+(finding?' has-finder':'')+(analysis?' has-analysis':'')+(detail?' has-inspector':'')} aria-label="交付依赖工作区" onKeyDown={e=>{if(e.key==='Escape'&&!e.defaultPrevented&&root.current?.querySelector('.dependency-canvas')?.getAttribute('data-connection-active')!=='true'){if(auxiliary){e.preventDefault();onDismissAuxiliary?.();}else if(detail){e.preventDefault();onDismissDetail?.();}}}}>
    <DependencyGraph {...graph} onDismissOverlays={()=>{if(auxiliary){onDismissAuxiliary?.();return true;}if(detail){onDismissDetail?.();return true;}if(finding){setFinding(false);return true;}return false;}} onSearch={()=>{setFinding(true);graph.onSearch?.();requestAnimationFrame(()=>root.current?.querySelector<HTMLInputElement>('.graph-finder input')?.focus());}}>
      <div className="graph-toolbar graph-overlay nopan nodrag nowheel" data-graph-panel="top">{toolbar}</div>
      <div className="graph-tool-rail graph-overlay nopan nodrag nowheel" data-graph-panel="left">{palette}{finder&&<FindTool onClick={()=>setFinding(v=>!v)}/>}</div>
      {finder&&finding&&<div ref={finderRef} className="graph-finder graph-overlay nopan nodrag nowheel" data-graph-panel="left">{finder}</div>}
      <FloatingPanel onDismiss={onDismissDetail} content={detail} side="right" replacement={!!auxiliary} contentKey={graph.selected+'|'+(graph.selectedEdge||'')}/>
      <FloatingPanel onDismiss={onDismissAuxiliary} analysis={analysis} size={auxiliarySize} content={auxiliary} side="left" replacement={!!detail}/>
      <div className="graph-footer graph-overlay nopan nodrag nowheel" data-graph-panel="bottom">{footer}</div>
    </DependencyGraph>
  </section>;
}
