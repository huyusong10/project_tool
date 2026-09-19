import { Button, MenuButtons, type ButtonVariant } from './Button';
import { Children, Fragment, isValidElement, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Ellipsis } from 'lucide-react';
import { AnchoredPopover } from './inline-edit/popover';
import { WorkspaceRuntimeContext } from '../workspace-runtime';
import { useLocation } from 'react-router-dom';

function hasMenuContent(children:ReactNode):boolean {
  return Children.toArray(children).some(child=>isValidElement<{children?:ReactNode}>(child)
    ? child.type===Fragment?hasMenuContent(child.props.children):true
    : typeof child==='string'&&child.trim().length>0);
}
const menuItems=(menu:HTMLDivElement|null)=>Array.from(menu?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[]).filter(button=>button.getClientRects().length>0);

/** Navigation menus share anchoring without taking ownership of a business field. */
export function TopbarMenu({ label = '更多操作', icon = <Ellipsis size={17}/>, children, text, variant = "secondary", disabled = false }: {
  label?: string; variant?: ButtonVariant; icon?: ReactNode; text?: ReactNode; children: ReactNode; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const runtime = useContext(WorkspaceRuntimeContext);
  const location = useLocation();
  const available=hasMenuContent(children);
  useEffect(() => setOpen(false), [location.key]);
  useEffect(()=>{if(!available)setOpen(false);},[available]);
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    if (!open) return;
    // AnchoredPopover becomes visible after its position is measured.
    const frame=requestAnimationFrame(()=>menuItems(menu.current)[0]?.focus());
    const unregister=runtime?.register({ element: () => menu.current, kind: 'menu', trigger: trigger.current, close: () => setOpen(false) });
    return()=>{cancelAnimationFrame(frame);unregister?.();};
  }, [open, runtime]);
  if(!available)return null;
  return <div className="topbar-menu-trigger" data-workspace-zone="tools" data-preserve-edit>
    <Button variant={variant} iconOnly={!text} ref={trigger} type="button" className={text ? 'ghost-button topbar-menu-button' : 'ghost-button topbar-icon'} aria-label={label} title={label} disabled={disabled} aria-haspopup="menu" aria-expanded={open}
      onClick={() => setOpen(value => !value)} onKeyDown={event => { if(event.key==='Escape'&&open&&!event.nativeEvent.isComposing){event.preventDefault();event.stopPropagation();close(true);}else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>{icon}{text}</Button>
    <AnchoredPopover align="end" anchorRef={trigger} open={open} onOutside={() => close()} onEscape={() => close(true)} preserveEditing role="presentation" width={240} className="topbar-menu-popover">
      <div ref={menu} role="menu" aria-label={label} data-workspace-zone="tools" data-preserve-edit className="topbar-menu-content"
        onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && !trigger.current?.contains(event.relatedTarget)) close(); }}
        onClick={event => { if ((event.target as Element).closest('button') && !(event.target as Element).closest('[data-menu-stay]')) {
          if (runtime) runtime.lastTrigger = trigger.current;
          // 菜单项即将移除；让新弹窗记住仍存在的入口，不打断操作自行转移的焦点。
          close(Boolean(menu.current?.contains(document.activeElement)));
        } }}
        onKeyDown={event => {
          if (event.defaultPrevented) return;
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); close(true); return; }
          const items = menuItems(menu.current);
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index + items.length - 1) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null;
          if (next !== null) { event.preventDefault(); items[next]?.focus(); }
        }}>{<MenuButtons>{children}</MenuButtons>}</div>
    </AnchoredPopover>
  </div>;
}
