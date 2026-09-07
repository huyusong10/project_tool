import { useEffect,useRef,type ComponentProps,type ReactNode } from 'react';
import { DependencyGraph } from './DependencyGraph';
import '../paths.css';
export function GraphWorkspace({ toolbar, detail, auxiliary, footer, ...graph }: ComponentProps<typeof DependencyGraph> & {
  toolbar: ReactNode; detail?: ReactNode; auxiliary?: ReactNode; footer?: ReactNode;
}) {
  const root=useRef<HTMLElement>(null);
  useEffect(()=>{const element=root.current,toolbar=element?.querySelector('.graph-toolbar');if(!element||!toolbar)return;const observer=new ResizeObserver(()=>element.style.setProperty('--graph-toolbar-bottom',(toolbar.getBoundingClientRect().bottom-element.getBoundingClientRect().top+12)+'px'));observer.observe(toolbar);return()=>observer.disconnect();},[]);
  return <section ref={root} className="graph-workspace" aria-label="交付依赖工作区">
    <DependencyGraph {...graph}>
      <div className="graph-toolbar graph-overlay nopan nodrag nowheel" data-graph-panel="top">{toolbar}</div>
      {detail && <aside className="graph-detail graph-overlay nopan nodrag nowheel" data-graph-panel="right">{detail}</aside>}
      {auxiliary && <aside className="graph-auxiliary graph-overlay nopan nodrag nowheel" data-graph-panel="left">{auxiliary}</aside>}
      <div className="graph-footer graph-overlay nopan nodrag nowheel" data-graph-panel="bottom">{footer}</div>
    </DependencyGraph>
  </section>;
}
