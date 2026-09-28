import { useEffect, useId, useRef, useState } from 'react';
import { SquareCheck, Square, ChevronDown, Plus, RefreshCw, Search } from 'lucide-react';
import { matchesSearch } from '../../../shared/search';
import { Button } from '../../components/Button';
import { AnchoredPopover } from '../../components/inline-edit/popover';
import '../../components/select.css';

export type JiraOption = { value: string; label: string };
export function JiraMultiSelect({ label, value, options, onChange, disabled, loading, error, onRetry, onSearch, allowCreate = false, emptyText = '没有可选项', unavailable = true, maxSelections = 30, bulkSelection = false }: {
  label: string; value: string[]; options: JiraOption[]; onChange: (value: string[]) => void;
  disabled?: boolean; loading?: boolean; error?: string; onRetry?: () => void; onSearch?: (query: string) => void;
  allowCreate?: boolean; emptyText?: string; unavailable?: boolean; maxSelections?: number; bulkSelection?: boolean;
}) {
  const anchor = useRef<HTMLButtonElement>(null), search = useRef<HTMLInputElement>(null), listId = useId();
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0);
  const known = useRef(new Map<string, string>());
  for (const option of options) known.current.set(option.value, option.label);
  const missing = value.filter(v => !options.some(o => o.value === v));
  const choices = [...options, ...missing.map(v => ({ value: v, label: (known.current.get(v) || v) + (unavailable ? '（当前未列出，已保留）' : '') }))];
  const visible = choices.filter(o => matchesSearch([o.label, o.value], query));
  const text = value.map(v => choices.find(o => o.value === v)?.label || v).join('、');
  const close = (focus = false) => { setOpen(false); if (focus) anchor.current?.focus({ preventScroll: true }); };
  const choose = (v: string) => { if (!disabled && (value.includes(v) || value.length < maxSelections)) onChange(value.includes(v) ? value.filter(item => item !== v) : [...value, v]); };
  useEffect(() => { if (open) { const frame = requestAnimationFrame(() => search.current?.focus()); return () => cancelAnimationFrame(frame); } }, [open]);
  useEffect(() => { if (open) document.getElementById(listId + '-' + active)?.scrollIntoView({ block: 'nearest' }); }, [active, open, listId]);
  useEffect(() => { if (!open || !onSearch) return; const timer = window.setTimeout(() => onSearch(query.trim()), 300); return () => clearTimeout(timer); }, [query, open, onSearch]);
  const create = allowCreate && query.trim() && !choices.some(o => o.value === query.trim());
  return <span className="select-field jira-multi-select">
    <button type="button" ref={anchor} className="select-trigger" role="combobox" aria-label={label} aria-expanded={open} aria-haspopup="listbox" aria-controls={open ? listId : undefined} disabled={disabled} title={text || undefined}
      onClick={() => { setOpen(!open); setQuery(''); setActive(0); }} onKeyDown={event => { if (['ArrowDown', 'Enter', ' '].includes(event.key)) { event.preventDefault(); setOpen(true); } }}>
      <span>{bulkSelection && value.length ? `已选 ${value.length} 项 · ${text}` : text || (loading ? '正在读取…' : '请选择（可多选）')}</span><ChevronDown size={15} />
    </button>
    <AnchoredPopover anchorRef={anchor} open={open && !disabled} width={340} matchAnchor role="presentation" preserveEditing className="select-popover jira-multi-popover" onOutside={() => close()} onEscape={() => close(true)}>
      <div data-preserve-edit onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
        if (event.key === 'Tab') close();
        if (event.target !== search.current && !(event.target instanceof Element && event.target.closest('[role=option]'))) return;
        if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setActive(i => Math.max(0, Math.min(visible.length - 1, i + (event.key === 'ArrowDown' ? 1 : -1)))); }
        if (event.key === 'Enter') { event.preventDefault(); if (visible[active]) choose(visible[active].value); else if (create) { choose(query.trim()); setQuery(''); } }
      }}>
        <label className="select-search"><Search size={15} /><input ref={search} aria-label={'搜索' + label} value={query} autoComplete="off" maxLength={200} onChange={event => { setQuery(event.target.value); setActive(0); }} aria-controls={listId} aria-activedescendant={visible[active] ? listId + '-' + active : undefined} /></label>
        {loading && <p className="select-empty" role="status">正在读取…</p>}
        {bulkSelection && <div className="jira-pr-summary"><span>已选 {value.length} 项</span><Button variant="link" onClick={() => onChange([...new Set([...value, ...visible.map(o => o.value)])].slice(0, maxSelections))}>全选筛选结果</Button><Button variant="link" onClick={() => onChange([])}>清空</Button></div>}
        {error && <div className="jira-picker-error" role="alert">{error}{onRetry && <Button variant="secondary" type="button" aria-label={'重试读取' + label} title="重试读取" onClick={onRetry}><RefreshCw size={15} /></Button>}</div>}
        <div id={listId} role="listbox" aria-label={label} aria-multiselectable="true" className="select-options">
          {visible.map((option, index) => <button key={option.value} id={listId + '-' + index} type="button" role="option" tabIndex={-1} aria-selected={value.includes(option.value)} data-active={active === index} disabled={!value.includes(option.value) && value.length >= maxSelections} onPointerMove={() => setActive(index)} onClick={() => choose(option.value)}>{value.includes(option.value) ? <SquareCheck size={16} /> : <Square size={16} />}<span>{option.label}</span></button>)}
          {!visible.length && !loading && !error && <p className="select-empty">{query ? '没有匹配的选项' : emptyText}</p>}
        </div>
        {create && <Button variant="secondary" type="button" className="jira-create-label" disabled={value.length >= maxSelections} onClick={() => { choose(query.trim()); setQuery(''); }}><Plus size={15} />添加“{query.trim()}”</Button>}
      </div>
    </AnchoredPopover>
  </span>;
}
