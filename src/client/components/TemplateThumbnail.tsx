import { useId } from 'react';
import type { TemplateOverview } from '../template-overview';

/** Overview graphics only; opening either thumbnail shows the full, accessible preview. */
export function TemplateThumbnail({ overview, name, onOpen }: { overview: TemplateOverview; name: string; onOpen: () => void }) {
  const marker = 'thumbnail-arrow-' + useId().replace(/:/g, '');
  const work = overview.nodes.filter(node => node.kind !== 'milestone');
  const milestones = overview.nodes.filter(node => node.kind === 'milestone');
  const span = Math.max(1, overview.span);
  const width = Math.max(440, overview.levels.length * 108);
  const height = Math.max(132, ...overview.levels.map(level => level.items.length * 24 + 40));
  const nodes = overview.levels.flatMap((level, column) => level.items.map((item, row) => ({
    ...item, column,
    x: (width - (overview.levels.length - 1) * 108) / 2 + column * 108,
    y: height / 2 + (row - (level.items.length - 1) / 2) * 24,
  })));
  const byId = new Map(nodes.map(node => [node.id, node]));
  return <button type="button" className="template-thumbnail-button" aria-label={`查看流程 ${name}`} onClick={onOpen}>
    <span className="template-thumbnail template-thumbnail-gantt">
      <span className="template-thumbnail-caption">甘特<span>时间分布</span></span>
      {!overview.nodes.length ? <span className="template-thumbnail-empty">暂无工作项</span> : overview.invalidDependencies ? <span className="template-thumbnail-empty">依赖待检查</span> : <svg viewBox="0 0 320 132" aria-hidden="true">
        {milestones.map(node => {
          const x = 8 + node.startOffsetDays / span * 304;
          return <g key={node.id} className="template-thumb-milestone"><title>{node.title}</title><path d={`M ${x} 8 l 4 4 l -4 4 l -4 -4 Z`} /><line x1={x} x2={x} y1={18} y2={112} /></g>;
        })}
        {work.map((node, index) => <rect key={node.id} data-thumbnail-work={node.id} className="template-thumb-bar" x={8 + node.startOffsetDays / span * 304} y={24 + index * 84 / Math.max(1, work.length)} width={Math.max(1, node.durationDays / span * 304)} height={Math.min(6, 60 / Math.max(1, work.length))} rx={2}><title>{node.title} · {node.durationDays} 工作日</title></rect>)}
        <text x={8} y={129}>第 1 日</text><text x={312} y={129} textAnchor="end">第 {span} 日</text>
      </svg>}
    </span>
    <span className="template-thumbnail template-thumbnail-flow">
      <span className="template-thumbnail-caption">{overview.dependencies && !overview.invalidDependencies ? '流程' : '计划顺序'}<span>点击查看完整预览</span></span>
      {!nodes.length ? <span className="template-thumbnail-empty">暂无流程元素</span> : overview.invalidDependencies ? <span className="template-thumbnail-empty">依赖待检查</span> : <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <defs><marker id={marker} viewBox="0 0 8 8" refX={7} refY={4} markerWidth={4} markerHeight={4} orient="auto"><path d="M 0 0 L 8 4 L 0 8 Z" /></marker></defs>
        {overview.edges.map((edge, index) => {
          const source = byId.get(edge.source)!, target = byId.get(edge.target)!;
          const sx = source.x + 36, tx = target.x - 38, middle = (sx + tx) / 2;
          const lane = 8 + index % 3 * 4;
          const path = target.column - source.column > 1
            ? `M ${sx} ${source.y} H ${sx + 8} V ${lane} H ${tx - 8} V ${target.y} H ${tx}`
            : `M ${sx} ${source.y} C ${middle} ${source.y}, ${middle} ${target.y}, ${tx} ${target.y}`;
          return <path key={edge.source + ':' + edge.target} data-thumbnail-edge={edge.source + ':' + edge.target} className="template-thumb-edge" d={path} markerEnd={`url(#${marker})`} />;
        })}
        {nodes.map(node => <g key={node.id} data-thumbnail-node={node.id} className={node.kind === 'milestone' ? 'template-thumb-node is-milestone' : 'template-thumb-node'}>
          <title>{node.title}</title><rect x={node.x - 36} y={node.y - 9} width={72} height={18} rx={node.kind === 'milestone' ? 9 : 4} />
          <text x={node.x} y={node.y + 3.5} textAnchor="middle">{node.title.length > 6 ? node.title.slice(0, 5) + '…' : node.title}</text>
        </g>)}
        {overview.levels.filter(level => level.items.length > 3).map(level => {
          const first = byId.get(level.items[0].id)!;
          return <text key={level.rank} x={first.x} y={height - 4} textAnchor="middle">{level.items.length} 项{overview.dependencies ? '并行' : '同时开始'}</text>;
        })}
      </svg>}
    </span>
  </button>;
}
