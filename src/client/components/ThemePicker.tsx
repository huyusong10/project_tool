import { useEffect, useId, useRef, useState } from "react";
import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import { setTheme, themes, useTheme, useThemePreference } from "../theme";

/** 外观菜单不参与 InlineEdit 的编辑器抢占和自动提交。 */
export function ThemePicker() {
  const theme = useTheme();
  const preference = useThemePreference();
  const Icon = preference === "system" ? Monitor : theme === "classic" ? Sun : theme === "dcim" ? Moon : Palette;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div className="theme-picker" ref={root} data-preserve-edit onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === "Tab") setOpen(false);
  }}>
    <button ref={trigger} type="button" className="icon-button theme-toggle" aria-label={`切换风格，当前${themes.find((entry) => entry.id === theme)?.label}`} title="切换风格" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
    }}><Icon size={17} /></button>
    {open && <div id={id} ref={menu} className="theme-menu" role="menu" aria-label="选择界面风格" onKeyDown={(event) => {
      const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button') || []);
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "ArrowDown" ? (index + 1) % buttons.length : event.key === "ArrowUp" ? (index + buttons.length - 1) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : null;
      if (next !== null) { event.preventDefault(); buttons[next]?.focus(); }
    }}>
      <button type="button" role="menuitemradio" aria-checked={preference === "system"} onClick={() => { setTheme("system"); close(); }}>
        <span className="theme-auto-icon" aria-hidden="true"><Monitor size={22} /></span>
        <span><strong>跟随系统</strong><small>日间经典蓝白 · 夜间杰瑞橙</small></span>
        {preference === "system" && <Check size={16} />}
      </button>
      {themes.map((entry) => <button type="button" role="menuitemradio" aria-checked={preference === entry.id} key={entry.id} onClick={() => { setTheme(entry.id); close(); }}>
        <span className="theme-swatch" data-theme={entry.id} aria-hidden="true"><i /><i /><i /></span>
        <span><strong>{entry.label}</strong><small>{entry.detail}</small></span>
        {preference === entry.id && <Check size={16} />}
      </button>)}
    </div>}
  </div>;
}
