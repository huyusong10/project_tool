import {createContext, useContext, useId, useMemo, useState, type ReactNode} from 'react';
import './detail-workspace.css';

type DetailActionHost = {element: HTMLDivElement | null; register: (id: string) => () => void};
export const DetailActionContext = createContext<DetailActionHost | null>(null);
export const useDetailActionHost = () => useContext(DetailActionContext);

/** Keep each section mounted so navigation preserves input and its scroll position. */
export function DetailWorkspace({label, summary, tabs, initialTab, activeTab, onTabChange, disabled = false, children}: {
  label: string; summary?: ReactNode; tabs: Array<{id: string; label: string; content: ReactNode}>;
  initialTab?: string; activeTab?: string; onTabChange?: (id: string) => void; disabled?: boolean; children?: ReactNode;
}) {
  const prefix = useId();
  const [localTab, setLocalTab] = useState(initialTab || tabs[0]?.id);
  const selected = activeTab || localTab;
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [actions, setActions] = useState<string[]>([]);
  const host = useMemo<DetailActionHost>(() => ({element, register(id) {
    setActions(current => [...current, id]);
    return () => setActions(current => current.filter(value => value !== id));
  }}), [element]);
  const choose = (id: string) => {setLocalTab(id); onTabChange?.(id);};
  return <DetailActionContext.Provider value={host}>
    <div className="detail-workspace" aria-label={label}>
      <div className="detail-workspace-content" inert={actions.length > 0 || undefined} aria-hidden={actions.length > 0 || undefined}>
        {summary && <div className="detail-workspace-summary">{summary}</div>}
        <nav className="detail-workspace-tabs" role="tablist" aria-label={label + '内容'}>
          {tabs.map((tab, index) => <button type="button" role="tab" id={`${prefix}-tab-${tab.id}`} aria-controls={`${prefix}-panel-${tab.id}`} aria-selected={selected === tab.id} tabIndex={selected === tab.id ? 0 : -1} disabled={disabled} key={tab.id} onClick={() => choose(tab.id)} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
            if (next < 0) return;
            event.preventDefault(); choose(tabs[next].id); document.getElementById(`${prefix}-tab-${tabs[next].id}`)?.focus();
          }}>{tab.label}</button>)}
        </nav>
        {tabs.map(tab => <section className="detail-workspace-panel" role="tabpanel" id={`${prefix}-panel-${tab.id}`} aria-labelledby={`${prefix}-tab-${tab.id}`} hidden={selected !== tab.id} key={tab.id}>{tab.content}</section>)}
      </div>
      <div ref={setElement} className="detail-action-host" hidden={!actions.length} />
      {children}
    </div>
  </DetailActionContext.Provider>;
}
