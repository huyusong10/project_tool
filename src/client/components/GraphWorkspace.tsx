import { useEffect,useRef,useState,type ComponentProps,type ReactNode } from 'react';
import { DependencyGraph } from './DependencyGraph';
import '../paths.css';
function FloatingPanel({content,side,replacement,contentKey}:{content:ReactNode;side:'left'|'right';replacement:boolean;contentKey?:string}){
  const [retained,setRetained]=useState(content);
  useEffect(()=>{if(content)setRetained(content);else {const timer=setTimeout(()=>setRetained(undefined),200);return()=>clearTimeout(timer);}},[content]);
  if(!content&&(!retained||replacement&&matchMedia('(max-width:800px)').matches))return null;
  return <aside className={(side==='right'?'graph-detail':'graph-auxiliary')+' graph-overlay nopan nodrag nowheel'+(!content?' is-leaving':'')} data-graph-panel={side} aria-hidden={!content} inert={!content}><div key={contentKey} className="graph-panel-content">{content||retained}</div></aside>;
}
export function GraphWorkspace({ toolbar, detail, auxiliary, footer, finder, ...graph }: ComponentProps<typeof DependencyGraph> & {
  toolbar: ReactNode; detail?: ReactNode; auxiliary?: ReactNode; footer?: ReactNode;finder?:ReactNode;
}) {
  const root=useRef<HTMLElement>(null);
  useEffect(()=>{
    const element=root.current;if(!element)return;
    const toolbar=element.querySelector('.graph-toolbar')!,footer=element.querySelector('.graph-footer')!,controls=element.querySelector('.graph-view-controls')!;
    const update=()=>{
      const box=element.getBoundingClientRect(),a=footer.getBoundingClientRect(),b=controls.getBoundingClientRect();
      const stacked=box.width<801||a.width+b.width+44>box.width;
      element.dataset.stacked=String(stacked);
      element.style.setProperty('--graph-toolbar-bottom',(toolbar.getBoundingClientRect().bottom-box.top+12)+'px');
      element.style.setProperty('--graph-footer-height',a.height+'px');
      const bottom=stacked?Math.max(a.height,0)+b.height+40:Math.max(a.height,b.height)+28;
      element.style.setProperty('--graph-bottom-clearance',bottom+'px');
    };
    const observer=new ResizeObserver(update);[element,toolbar,footer,controls].forEach(e=>observer.observe(e));update();
    return()=>observer.disconnect();
  },[]);
  return <section ref={root} className="graph-workspace" aria-label="交付依赖工作区">
    <DependencyGraph {...graph}>
      <div className="graph-toolbar graph-overlay nopan nodrag nowheel" data-graph-panel="top">{toolbar}</div>
      {finder&&<div className="graph-finder graph-overlay nopan nodrag nowheel" data-graph-panel="finder">{finder}</div>}
      <FloatingPanel content={detail} side="right" replacement={!!auxiliary} contentKey={graph.selected+'|'+(graph.selectedEdge||'')}/>
      <FloatingPanel content={auxiliary} side="left" replacement={!!detail}/>
      <div className="graph-footer graph-overlay nopan nodrag nowheel" data-graph-panel="bottom">{footer}</div>
    </DependencyGraph>
  </section>;
}
