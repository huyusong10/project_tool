import {useIsMutating} from '@tanstack/react-query';
import {createPortal} from 'react-dom';
import {CompactButtons} from './Button';
import {useObjectDetail,readDetailMemory,writeDetailMemory} from './ObjectDetailContext';
import {createContext, useContext, useId, useMemo, useState, type ReactNode} from 'react';
import './detail-workspace.css';

type DetailActionHost = {element: HTMLDivElement | null; register: (id: string) => () => void};
export const DetailActionContext = createContext<DetailActionHost | null>(null);
export const useDetailActionHost = () => useContext(DetailActionContext);

const ToolbarContext=createContext<{element:HTMLDivElement|null;active:boolean}|null>(null);
export function DetailToolbar({children}:{children:ReactNode}){const host=useContext(ToolbarContext);const content=<CompactButtons>{children}</CompactButtons>;return host?host.active&&host.element?createPortal(content,host.element):null:content;}

/** Keep each section mounted so navigation preserves input and its scroll position. */
export function DetailWorkspace({label, summary, tabs, initialTab, activeTab, onTabChange, disabled = false, children}: {
  label: string; summary?: ReactNode; tabs: Array<{id: string; label: string; content: ReactNode; actions?: ReactNode; description?: string}>;
  initialTab?: string; activeTab?: string; onTabChange?: (id: string) => void; disabled?: boolean; children?: ReactNode;
}) {
  const prefix = useId(), busy=useIsMutating()>0;
  const detail = useObjectDetail();
  const [localTab, setLocalTab] = useState(() => detail ? readDetailMemory(detail.key+':tab', initialTab || tabs[0]?.id) : initialTab || tabs[0]?.id);
  const requested = activeTab || detail?.tab || localTab;
  const selected = tabs.some(tab => tab.id === requested) ? requested : tabs[0]?.id;
  const [toolbar,setToolbar]=useState<HTMLDivElement|null>(null);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [actions, setActions] = useState<string[]>([]);
  const host = useMemo<DetailActionHost>(() => ({element, register(id) {
    setActions(current => [...current, id]);
    return () => setActions(current => current.filter(value => value !== id));
  }}), [element]);
  const choose = (id: string) => {setLocalTab(id); if(detail){writeDetailMemory(detail.key+':tab',id);detail.onTabChange?.(id);} onTabChange?.(id);};
  return <DetailActionContext.Provider value={host}>
    <div className="detail-workspace" aria-label={label}>
      <div className="detail-workspace-content" inert={actions.length > 0 || undefined} aria-hidden={actions.length > 0 || undefined}>
        {summary && <div className="detail-workspace-summary">{summary}</div>}
        <nav className="detail-workspace-tabs" role="tablist" aria-label={label + '内容'}>
          {tabs.map((tab, index) => <button type="button" role="tab" id={`${prefix}-tab-${tab.id}`} aria-controls={`${prefix}-panel-${tab.id}`} aria-selected={selected === tab.id} tabIndex={selected === tab.id ? 0 : -1} disabled={disabled||busy} key={tab.id} onClick={() => choose(tab.id)} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
            if (next < 0) return;
            event.preventDefault(); choose(tabs[next].id); document.getElementById(`${prefix}-tab-${tabs[next].id}`)?.focus();
          }}>{tab.label}</button>)}
        </nav>
        <div className="detail-workspace-toolbar"><span>{tabs.find(tab=>tab.id===selected)?.description}</span><div className="panel-actions" ref={setToolbar}><CompactButtons>{tabs.find(tab=>tab.id===selected)?.actions}</CompactButtons></div></div>
        {tabs.map(tab => <section className="detail-workspace-panel" role="tabpanel" id={`${prefix}-panel-${tab.id}`} aria-labelledby={`${prefix}-tab-${tab.id}`} hidden={selected !== tab.id} key={tab.id} ref={element=>{if(element&&detail)element.scrollTop=readDetailMemory(detail.key+':scroll:'+tab.id,0);}} onScroll={event=>{if(detail)writeDetailMemory(detail.key+':scroll:'+tab.id,event.currentTarget.scrollTop);}}><ToolbarContext.Provider value={{element:toolbar,active:selected===tab.id}}>{tab.content}</ToolbarContext.Provider></section>)}
      </div>
      <div ref={setElement} className="detail-action-host" hidden={!actions.length} />
      {children}
    </div>
  </DetailActionContext.Provider>;
}
