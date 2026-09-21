import { useMemo, useRef, useState } from 'react';
import type { WorkItemTemplate } from '../types';
import { templateOverview } from '../template-overview';
import { TemplateOverview } from './TemplateOverview';
import { TemplateGantt } from './TemplateGantt';
import { Button } from './Button';
import './template-overview.css';

export function TemplatePreview({ template, onEdit }: {
  template: Pick<WorkItemTemplate, 'name' | 'description' | 'items' | 'dependencyMode'>;
  onEdit?: () => void;
}) {
  const overview = useMemo(() => templateOverview(template), [template]);
  const [selected, setSelected] = useState('');
  const gantt = useRef<HTMLDivElement>(null), flow = useRef<HTMLDivElement>(null);
  const items = useMemo(() => overview.nodes.map(item => ({ ...item, clientKey: item.id, predecessorKeys: item.predecessorIds || [] })), [overview]);
  const item = overview.nodes.find(node => node.id === selected);
  const select = (id: string) => {
    setSelected(id);
    // Scroll each pane without moving the surrounding dialog or the other pane.
    for (const pane of [gantt.current, flow.current]) {
      const milestone = pane?.querySelector(`[data-milestone-id="${CSS.escape(id)}"]`)
        ?.parentElement?.querySelector<HTMLElement>('.gantt-milestone-label');
      const node = pane?.querySelector<HTMLElement>(`[data-template-node="${CSS.escape(id)}"], [data-template-work="${CSS.escape(id)}"]`) || milestone;
      if (!pane || !node) continue;
      const bounds = pane.getBoundingClientRect(), target = node.getBoundingClientRect();
      if (target.top < bounds.top) pane.scrollTop += target.top - bounds.top - 8;
      else if (target.bottom > bounds.bottom) pane.scrollTop += target.bottom - bounds.bottom + 8;
      if (pane === gantt.current) {
        const bar = (milestone || node.parentElement?.querySelector('.template-plan-bar'))?.getBoundingClientRect();
        const labelWidth = 130;
        if (bar && (bar.left < bounds.left + labelWidth || bar.right > bounds.right)) pane.scrollLeft += bar.left - bounds.left - labelWidth - 10;
      }
    }
  };
  return <div className="template-preview">
    <div className="template-preview-heading"><div><h3>{template.name || '新建流程'}</h3><p className="template-preview-summary">{overview.workCount} 个工作项 · {overview.milestoneCount} 个里程碑 · {overview.span} 个工作日</p></div>{onEdit && <Button variant="secondary" onClick={onEdit}>编辑流程</Button>}</div>
    {template.description && <details className="template-preview-description"><summary>用途说明</summary><p>{template.description}</p></details>}
    <div className="template-preview-split">
      <section className="template-preview-pane" aria-label="甘特预览"><header>甘特图<small>按工作日排列</small></header><div ref={gantt} className="template-preview-scroll">
        {overview.invalidDependencies ? <p className="template-structure-note">依赖有误，请在编辑中检查后查看排期。</p> : !overview.nodes.length ? <p className="template-structure-note">暂无工作项和里程碑</p> : <TemplateGantt items={items} selected={selected} onSelect={select} />}
      </div></section>
      <section className="template-preview-pane" aria-label="流程预览"><header>流程图<small>点击元素联动查看</small></header><div ref={flow} className="template-preview-scroll"><TemplateOverview overview={overview} selected={selected} onSelect={select}/></div></section>
    </div>
    <div className="template-preview-selection" aria-live="polite">{item ? <><strong>{item.title}</strong><span>{item.kind === 'milestone' ? `${item.startOffsetDays ? `第 ${item.startOffsetDays} 个工作日结束` : '流程开始时'} · ${item.confirmationMode === 'manual' ? '手动确认' : '前置完成后达成'}` : `第 ${item.startOffsetDays + 1}—${item.startOffsetDays + item.durationDays} 个工作日 · 工期 ${item.durationDays} 天`}</span><span>{item.predecessorIds?.length ? '前置：' + item.predecessorIds.map(id => overview.nodes.find(node => node.id === id)?.title || '失效元素').join('、') : '无前置依赖'}</span></> : <span>点击工作项或里程碑查看详情</span>}</div>
  </div>;
}
