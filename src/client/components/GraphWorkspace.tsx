import { useEffect,useRef,useState,type ComponentProps,type ReactNode } from 'react';
import { DependencyGraph } from './DependencyGraph';
import '../paths.css';
import {FindTool} from './EditorToolbar';
function FloatingPanel({content,side,replacement,contentKey,analysis=false}:{analysis?:boolean;content:ReactNode;side:'left'|'right';replacement:boolean;contentKey?:string}){
  const [retained,setRetained]=useState(content);
  useEffect(()=>{if(content)setRetained(content);else {const timer=setTimeout(()=>setRetained(undefined),200);return()=>clearTimeout(timer);}},[content]);
  if(!content&&(!retained||replacement&&matchMedia('(max-width:800px)').matches))return null;
  return <aside className={(side==='right'?'graph-detail':'graph-auxiliary')+' graph-overlay nopan nodrag nowheel'+(!content?' is-leaving':'')} data-graph-panel={analysis?'bottom':side} aria-hidden={!content} inert={!content}><div key={contentKey} className="graph-panel-content">{content||retained}</div></aside>;
}
export function GraphWorkspace({ toolbar, detail, auxiliary, footer, finder,palette,analysis=false, ...graph }: ComponentProps<typeof DependencyGraph> & {
  toolbar: ReactNode; detail?: ReactNode; auxiliary?: ReactNode; footer?: ReactNode;finder?:ReactNode;palette?:ReactNode;analysis?:boolean;
}) {
  const root=useRef<HTMLElement>(null);
  const finderKey='pm-graph-view:'+graph.viewKey+':finder';
  const [finding,setFinding]=useState(()=>{try{return localStorage.getItem(finderKey)==='true';}catch{return false;}});
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
      const bottom=stacked?Math.max(a.height,0)+b.height+40:Math.max(a.height,b.height)+28;
      element.style.setProperty('--graph-bottom-clearance',bottom+'px');
    };
    const observer=new ResizeObserver(update);[element,toolbar,footer,controls,element.querySelector('.graph-finder')].filter((e):e is HTMLElement=>!!e).forEach(e=>observer.observe(e));update();
    return()=>observer.disconnect();
  },[finding]);
  return <section ref={root} className={'graph-workspace graph-editor-workspace'+(analysis?' has-analysis':'')+(detail?' has-inspector':'')} aria-label="交付依赖工作区">
    <DependencyGraph {...graph} onSearch={()=>{setFinding(true);graph.onSearch?.();requestAnimationFrame(()=>root.current?.querySelector<HTMLInputElement>('.graph-finder input')?.focus());}}>
      <div className="graph-toolbar graph-overlay nopan nodrag nowheel" data-graph-panel="top">{toolbar}</div>
      <div className="graph-tool-rail graph-overlay nopan nodrag nowheel" data-graph-panel="left">{palette}{finder&&<FindTool onClick={()=>setFinding(v=>!v)}/>}</div>
      {finder&&finding&&<div className="graph-finder graph-overlay nopan nodrag nowheel" data-graph-panel="left">{finder}</div>}
      <FloatingPanel content={detail} side="right" replacement={!!auxiliary} contentKey={graph.selected+'|'+(graph.selectedEdge||'')}/>
      <FloatingPanel analysis={analysis} content={auxiliary} side="left" replacement={!!detail}/>
      <div className="graph-footer graph-overlay nopan nodrag nowheel" data-graph-panel="bottom">{footer}</div>
    </DependencyGraph>
  </section>;
}
