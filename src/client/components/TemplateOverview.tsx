import { memo, useId, useLayoutEffect, useRef, useState } from 'react';
import { Diamond } from 'lucide-react';
import type { TemplateOverview as Overview } from '../template-overview';

export function TemplateStats({ overview }: { overview: Overview }) {
  return <dl className="template-stats">
    <div><dt>工作项</dt><dd>{overview.workCount}<small> 项</small></dd></div>
    <div><dt>里程碑</dt><dd>{overview.milestoneCount}<small> 个</small></dd></div>
    <div><dt>计划跨度</dt><dd>{overview.span}<small> 工作日</small></dd></div>
  </dl>;
}

/** 静态概览只测量连线端点，不写入流程位置，也不挂载可编辑画布。 */
export const TemplateOverview = memo(function TemplateOverview({ overview }: { overview: Overview }) {
  const root = useRef<HTMLDivElement>(null);
  const marker = 'template-arrow-' + useId().replace(/:/g, '');
  const [paths, setPaths] = useState<Array<{ source: string; target: string; d: string }>>([]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      const boxes = new Map([...element.querySelectorAll<HTMLElement>('[data-template-node]')].map(node => [node.dataset.templateNode!, node.getBoundingClientRect()]));
      const rank = new Map(overview.levels.flatMap((level, index) => level.items.map(item => [item.id, index] as const)));
      setPaths(overview.edges.flatMap((edge, index) => {
        const source = boxes.get(edge.source), target = boxes.get(edge.target);
        if (!source || !target) return [];
        const sx = source.x + source.width / 2 - bounds.x, sy = source.bottom - bounds.y;
        const tx = target.x + target.width / 2 - bounds.x, ty = target.top - bounds.y - 3;
        const middle = (sy + ty) / 2;
        const sourceLevel = overview.levels[rank.get(edge.source)!].items.map(item => boxes.get(item.id)!);
        const targetLevel = overview.levels[rank.get(edge.target)!].items.map(item => boxes.get(item.id)!);
        const wrapped = source.bottom < Math.max(...sourceLevel.map(box => box.bottom)) - 1 || target.top > Math.min(...targetLevel.map(box => box.top)) + 1;
        // 跨层依赖沿左侧空白经过，避免穿过中间工作项。
        const lane = 4 + index % 4 * 4;
        const d = wrapped || rank.get(edge.target)! - rank.get(edge.source)! > 1
          ? `M ${sx} ${sy} V ${sy + 4} H ${lane} V ${ty - 4} H ${tx} V ${ty}`
          : `M ${sx} ${sy} C ${sx} ${middle}, ${tx} ${middle}, ${tx} ${ty}`;
        return [{ ...edge, d }];
      }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const node of element.querySelectorAll('[data-template-node]')) observer.observe(node);
    return () => observer.disconnect();
  }, [overview]);
  return <div className="template-structure">
    <div className="template-structure-heading"><span>{overview.dependencies && !overview.invalidDependencies ? '流程结构' : '计划顺序'}</span><small>{overview.dependencies && !overview.invalidDependencies ? '箭头表示前后依赖' : '按开始时间排列'}</small></div>
    {overview.invalidDependencies && <p className="template-structure-note">部分依赖无法显示，请在编辑中检查。</p>}
    <div ref={root} className="template-structure-body" aria-label="工作项与里程碑概览">
      <svg className="template-structure-edges" aria-hidden="true"><defs><marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
        {paths.map(edge => <path key={edge.source + ':' + edge.target} data-template-edge={edge.source + ':' + edge.target} d={edge.d} markerEnd={`url(#${marker})`} />)}
      </svg>
      {overview.levels.map(level => <div className="template-structure-level" key={level.rank}>
        {level.items.map(item => <div key={item.id} data-template-node={item.id} className={`template-structure-node${item.kind === 'milestone' ? ' is-milestone' : ''}`}>
          {item.kind === 'milestone' ? <Diamond size={13} aria-label="里程碑" /> : <i aria-hidden="true" />}
          <span>{item.title}</span>
        </div>)}
      </div>)}
      {!overview.nodes.length && <p className="template-structure-note">暂无工作项和里程碑</p>}
    </div>
  </div>;
});
