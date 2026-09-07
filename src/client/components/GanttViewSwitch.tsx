import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useSession } from "../app-context";
import { Columns2, Layers } from "lucide-react";

export type GanttViewMode = "overlay" | "split";
const memory = new Map<string, GanttViewMode>();
const changeEvent = "project-manage:gantt-view-change";
const resolve = (value: string | null): GanttViewMode => value === "split" ? "split" : "overlay";

export function useGanttView() {
  const { session } = useSession();
  const key = `project-manage:gantt-view:${session.accountId || "guest"}`;
  const read = useCallback(() => {
    if (memory.has(key)) return memory.get(key)!;
    try { return resolve(localStorage.getItem(key)); } catch { return "overlay" as const; }
  }, [key]);
  const subscribe = useCallback((notify: () => void) => {
    const storage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) { memory.delete(key); notify(); }
    };
    window.addEventListener(changeEvent, notify);
    window.addEventListener("storage", storage);
    return () => { window.removeEventListener(changeEvent, notify); window.removeEventListener("storage", storage); };
  }, [key]);
  const value = useSyncExternalStore(subscribe, read, () => "overlay" as const);
  const change = (next: GanttViewMode) => {
    memory.set(key, next);
    try { localStorage.setItem(key, next); } catch { /* 当前页面仍保留选择。 */ }
    window.dispatchEvent(new Event(changeEvent));
  };
  return [value, change] as const;
}

export function GanttViewSwitch({ value, onChange }: { value: GanttViewMode; onChange: (value: GanttViewMode) => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const label = value === "split" ? "计划·实际双轨" : "现有视图";
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false; };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  return <details className="gantt-view-picker" ref={ref} data-preserve-edit onKeyDown={(event) => {
    if (event.key === "Escape" && ref.current) { event.preventDefault(); event.stopPropagation(); ref.current.open = false; ref.current.querySelector("summary")?.focus(); }
  }}>
    <summary role="button" aria-label={`甘特显示方式，当前${label}`} title={`甘特显示方式：${label}`}>
      {value === "split" ? <Columns2 size={17} /> : <Layers size={17} />}
    </summary>
    <div className="gantt-view-options" role="group" aria-label="甘特显示方式">
      {([['overlay', '现有视图'], ['split', '计划·实际双轨']] as const).map(([mode, name]) => <button key={mode} type="button" aria-pressed={value === mode} onClick={() => {
        onChange(mode);
        if (ref.current) { ref.current.open = false; ref.current.querySelector("summary")?.focus(); }
      }}>{name}</button>)}
    </div>
  </details>;
}
