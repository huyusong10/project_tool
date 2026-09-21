import { memo } from "react";
import { format } from "date-fns";
import { ganttTrackStyle, type GanttZoom } from "../gantt-geometry";
import './gantt-timeline.css';
export { buildBusinessDayTimeline, businessDateIndex, ganttInterval, ganttTodayPosition, ganttTrackStyle, ganttZoomOptions, toGanttDate, type GanttZoom } from "../gantt-geometry";
const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];

function markerVisible(dates: Date[], zoom: GanttZoom, index: number) {
  const date = dates[index];
  if (zoom === "day") return true;
  if (zoom === "week") return index === 0 || date.getDay() === 1;
  return index === 0 || dates[index - 1]?.getMonth() !== date.getMonth();
}

function markerWidth(dates: Date[], zoom: GanttZoom, index: number, cellWidth: number) {
  if (zoom === "day") return cellWidth;
  const next = dates.findIndex((_date, candidate) => candidate > index && markerVisible(dates, zoom, candidate));
  return (next < 0 ? dates.length - index : next - index) * cellWidth;
}

export const GanttScale = memo(function GanttScale({
  dates,
  zoom,
  cellWidth,
  todayOffset,
  todayVisible,
  className = "",
}: {
  dates: Date[];
  zoom: GanttZoom;
  cellWidth: number;
  todayOffset: number;
  todayVisible: boolean;
  className?: string;
}) {
  const style = ganttTrackStyle(dates, cellWidth,zoom);
  if (zoom === 'day') return <div className={`gantt-scale unified-gantt-scale gantt-scale-grouped ${className}`.trim()} style={style} role="columnheader">
    {dates.map((date,index)=> (index===0 || date.getMonth()!==dates[index-1].getMonth()) && <span className="gantt-scale-month" key={'month-'+date.toISOString()} style={{left:index*cellWidth,width:markerWidth(dates,'month',index,cellWidth)}}><b>{format(date,'yyyy年 M月')}</b></span>)}
    {dates.map((date,index)=><span className={'gantt-scale-day'+(index===todayOffset&&todayVisible?' is-today':'')} key={date.toISOString()} style={{left:index*cellWidth,width:cellWidth}} data-date={format(date,'yyyy-MM-dd')}><b>{format(date,'dd')}</b><small>{weekdayLabels[date.getDay()]}</small></span>)}
    {todayVisible && <i className="gantt-today-line" style={{left:(todayOffset+1)*cellWidth}}/>}
  </div>;
  return <div className={`gantt-scale unified-gantt-scale ${className}`.trim()} style={style} role="columnheader">
    {dates.map((date, index) => markerVisible(dates, zoom, index) && <span
      className="gantt-scale-label"
      style={{ left: index * cellWidth, width: markerWidth(dates, zoom, index, cellWidth) }}
      key={date.toISOString()}
    >{zoom === "month" ? format(date, "yyyy/MM") : format(date, "MM/dd")}</span>)}
    {dates.map((date, index) => (zoom==='month'||cellWidth<12?markerVisible(dates,zoom,index):true)&&<i
      className={`gantt-scale-tick${date.getDay() === 1 || index === 0 ? " is-major" : ""}`}
      data-date={format(date, "yyyy-MM-dd")}
      style={{ left: index * cellWidth, width: cellWidth }}
      key={`tick-${date.toISOString()}`}
    >{zoom !== "month" && <span>{format(date, "dd")}</span>}</i>)}
    {todayVisible && <i className="gantt-today-line" style={{ left: (todayOffset + 1) * cellWidth }} />}
  </div>;
});
