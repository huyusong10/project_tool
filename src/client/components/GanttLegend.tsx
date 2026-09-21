import './gantt-timeline.css';

export function GanttLegend({preview=false}:{preview?:boolean}) {
  return <span className="gantt-track-legend" role="group" aria-label={preview?'计划预测图例':'计划实际图例'}>
    <span><i className="is-plan"/>计划</span>
    {preview
      ? <span title="根据当前依赖和工期推算，尚未写入计划"><i className="is-prediction"/>预测</span>
      : <><span title="条长表示实际执行日期，填充表示完成比例；绿色已完成，灰色断纹已取消，红色描边延期"><i className="is-actual"/>实际</span><span title="红色虚线延伸至预计完成日"><i className="is-forecast"/>预计延期</span></>}
    <span><i className="is-milestone"/>交付 / 里程碑</span>
  </span>;
}
