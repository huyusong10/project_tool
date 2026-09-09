import { CalendarDays, LocateFixed, Scan } from 'lucide-react';
import { useRef } from 'react';
import { ganttZoomOptions, type GanttZoom } from '../gantt-geometry';
import type { useGanttNavigation } from '../use-gantt-navigation';
import '../gantt-navigation.css';

type Navigation = ReturnType<typeof useGanttNavigation>;
export function GanttNavigation({ navigation }: { navigation: Navigation }) {
  const lastJump = useRef('');
  const jump = (input: HTMLInputElement, explicit = false) => {
    if (!input.validity.valid || !input.value || (!explicit && input.value === lastJump.current)) return;
    lastJump.current = input.value; navigation.navigateTo(input.value);
  };
  return <div className="gantt-navigation" role="group" aria-label="甘特时间导航">
    <button type="button" className="ghost-button" onClick={navigation.today} title="定位到今天"><LocateFixed size={15} />今天</button>
    <button type="button" className="ghost-button" onClick={navigation.fit} title="适配全部排期"><Scan size={15} />适配全部</button>
    <div className="view-tabs" aria-label="时间粒度">{(Object.keys(ganttZoomOptions) as GanttZoom[]).map(zoom =>
      <button type="button" key={zoom} className={navigation.zoom === zoom ? 'active' : ''} onClick={() => navigation.changeZoom(zoom)}>{ganttZoomOptions[zoom].label}</button>)}</div>
    <label className="gantt-date-jump" title="跳转到日期，按 Enter 或离开输入框定位"><CalendarDays size={15} /><input type="date" aria-label="跳转到日期" onBlur={event => jump(event.currentTarget)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); jump(event.currentTarget, true); } }} /></label>
    <span className="gantt-visible-range" title="当前可见日期；拖动表头或空白处可连续浏览">{navigation.visible}</span>
  </div>;
}

export function GanttScrollbar({ navigation }: { navigation: Navigation }) {
  return <div className="gantt-navigation-scrollbar" ref={navigation.barRef} role="scrollbar" tabIndex={0} aria-label="横向滚动时间轴" aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}><span className="gantt-scroll-thumb" /></div>;
}
