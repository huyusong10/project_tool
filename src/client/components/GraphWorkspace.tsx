import { useEffect,useRef,type ComponentProps,type ReactNode } from 'react';
import { DependencyGraph } from './DependencyGraph';
import '../paths.css';
export function GraphWorkspace({ toolbar, detail, auxiliary, footer, ...graph }: ComponentProps<typeof DependencyGraph> & {
  toolbar: ReactNode; detail?: ReactNode; auxiliary?: ReactNode; footer?: ReactNode;
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
      {detail && <aside className="graph-detail graph-overlay nopan nodrag nowheel" data-graph-panel="right">{detail}</aside>}
      {auxiliary && <aside className="graph-auxiliary graph-overlay nopan nodrag nowheel" data-graph-panel="left">{auxiliary}</aside>}
      <div className="graph-footer graph-overlay nopan nodrag nowheel" data-graph-panel="bottom">{footer}</div>
    </DependencyGraph>
  </section>;
}
