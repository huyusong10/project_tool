import { Button } from './Button';
type ProgressInputProps = {
  value: number;
  onChange: (value: number) => void;
  name?: string;
  label?: string;
  max?: number;
  presets?: number[];
};

export function ProgressInput({ value, onChange, name = 'progress', label = '当前完成度（估算）', max = 100, presets = [25, 50, 75, 90, max] }: ProgressInputProps) {
  const normalized = Math.min(max, Math.max(0, Math.round(value)));
  const shortcuts = [...new Set(presets)].filter((item) => item <= max);
  const update = (next: string) => onChange(Math.min(max, Math.max(0, Number(next) || 0)));
  return <div className="progress-input field-full">
    <div className="progress-input-heading"><span>{label}</span><strong>{normalized}%</strong></div>
    <div className="progress-input-controls">
      <input aria-label={label} type="range" min="0" max={max} step="5" value={normalized} onChange={(event) => update(event.target.value)} />
      <label><input name={name} aria-label={`${label}数值`} type="number" min="0" max={max} step="1" value={normalized} onChange={(event) => update(event.target.value)} /><span>%</span></label>
    </div>
    <div className="progress-shortcuts">{shortcuts.map((item) => <Button variant="secondary" size="small" aria-pressed={normalized === item} type="button" className={normalized === item ? 'active' : ''} key={item} onClick={() => onChange(item)}>{item}%</Button>)}</div>
  </div>;
}
