import { useState } from 'react';
export function PredecessorPicker({ label = '前置工作项', options, value, onChange, disabled = false }: {
  label?: string; options: Array<{ id: string; title: string; disabled?: boolean; reason?: string }>;
  value: string[]; onChange: (ids: string[]) => void; disabled?: boolean;
}) {
  const [search, setSearch] = useState('');
  return <fieldset className="predecessor-picker" disabled={disabled}><legend>{label}</legend>
    <div className="predecessor-tags">{value.map(id => <button type="button" key={id} onClick={() => onChange(value.filter(k => k !== id))} aria-label={'移除前置 ' + (options.find(o => o.id === id)?.title || id)}>{options.find(o => o.id === id)?.title || '已失效工作项'} ×</button>)}
      {!!value.length && <button type="button" onClick={() => onChange([])}>清空</button>}{!value.length && <small>没有前置，可独立开始</small>}</div>
    <input aria-label={'搜索' + label} value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索前置…"/>
    <div className="predecessor-options">{options.filter(o => o.title.toLowerCase().includes(search.toLowerCase())).map(o =>
      <label key={o.id} title={o.reason}><input type="checkbox" checked={value.includes(o.id)} disabled={o.disabled && !value.includes(o.id)}
        onChange={() => onChange(value.includes(o.id) ? value.filter(id => id !== o.id) : [...value, o.id])}/><span>{o.title}</span></label>)}</div>
  </fieldset>;
}
