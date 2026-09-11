import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Ellipsis } from 'lucide-react';
import { AnchoredPopover } from './InlineEdit';
import { WorkspaceRuntimeContext } from '../workspace-runtime';
import { useLocation } from 'react-router-dom';

/** Navigation menus share anchoring without taking ownership of a business field. */
export function TopbarMenu({ label = '更多操作', icon = <Ellipsis size={17}/>, children, text, disabled = false }: {
  label?: string; icon?: ReactNode; text?: ReactNode; children: ReactNode; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const runtime = useContext(WorkspaceRuntimeContext);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.key]);
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return runtime?.register({ element: () => menu.current, kind: 'menu', trigger: trigger.current, close: () => setOpen(false) });
  }, [open, runtime]);
  return <div className="topbar-menu-trigger" data-workspace-zone="tools" data-preserve-edit>
    <button ref={trigger} type="button" className={text ? 'ghost-button topbar-menu-button' : 'ghost-button topbar-icon'} aria-label={label} title={label} disabled={disabled} aria-haspopup="menu" aria-expanded={open}
      onClick={() => setOpen(value => !value)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>{icon}{text}</button>
    <AnchoredPopover anchorRef={trigger} open={open} onOutside={() => close()} onEscape={() => close(true)} preserveEditing role="presentation" width={240} className="topbar-menu-popover">
      <div ref={menu} role="menu" aria-label={label} data-workspace-zone="tools" data-preserve-edit className="topbar-menu-content"
        onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && !trigger.current?.contains(event.relatedTarget)) close(); }}
        onClick={event => { if ((event.target as Element).closest('button') && !(event.target as Element).closest('[data-menu-stay]')) { if (runtime) runtime.lastTrigger = trigger.current; close(); } }}
        onKeyDown={event => {
          if (event.defaultPrevented) return;
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); close(true); return; }
          const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index + items.length - 1) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null;
          if (next !== null) { event.preventDefault(); items[next]?.focus(); }
        }}>{children}</div>
    </AnchoredPopover>
  </div>;
}
