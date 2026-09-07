import { useEffect, useRef } from 'react';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { init, use as registerEChartsModules, type EChartsCoreOption, type EChartsType } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useTheme } from '../theme';
import { chartColorResolver, resolveChartTokens } from '../chart-theme';

registerEChartsModules([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export function Chart({ option, height = 240, ariaLabel }: { option: Record<string, unknown>; height?: number; ariaLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const instance = useRef<EChartsType | null>(null);
  const theme = useTheme();
  useEffect(() => {
    if (!ref.current) return;
    const chart = init(ref.current, undefined, { renderer: 'canvas' });
    instance.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => { observer.disconnect(); chart.dispose(); instance.current = null; };
  }, []);
  useEffect(() => {
    const chart = instance.current;
    if (!chart || !ref.current) return;
    const colors = chartColorResolver(ref.current);
    try {
      const resolved = resolveChartTokens(option, colors.resolve);
      const text = colors.resolve('--text-secondary');
      const line = colors.resolve('--border-default');
      for (const axis of ['xAxis', 'yAxis']) {
        const decorate = (value: unknown) => {
          const data = value as Record<string, unknown>;
          return { ...data, axisLabel: { color: text, ...data.axisLabel as object }, axisLine: { lineStyle: { color: line }, ...data.axisLine as object }, splitLine: { lineStyle: { color: line }, ...data.splitLine as object } };
        };
        if (resolved[axis]) resolved[axis] = Array.isArray(resolved[axis]) ? (resolved[axis] as unknown[]).map(decorate) : decorate(resolved[axis]);
      }
      const legends = (chart.getOption() || {}).legend as Array<{ selected?: Record<string, boolean> }> | undefined;
      const selected = legends?.[0]?.selected;
      if (resolved.legend) resolved.legend = { ...resolved.legend as object, ...(selected ? { selected } : {}) };
      const font = getComputedStyle(ref.current).fontFamily;
      chart.setOption({
        color: ['--chart-line','--success','--warning','--purple','--danger','--info'].map(colors.resolve),
        ...resolved,
        textStyle: { fontFamily: font, color: text, ...resolved.textStyle as object },
        tooltip: { backgroundColor: colors.resolve('--bg-surface'), borderColor: line, textStyle: { color: text }, ...resolved.tooltip as object },
      } as EChartsCoreOption, { replaceMerge: ['series', 'xAxis', 'yAxis', 'legend', 'grid'], lazyUpdate: false });
    } finally { colors.dispose(); }
  }, [option, theme]);
  return <div ref={ref} style={{ height }} className="themed-chart" data-chart-theme={theme} role="img" aria-label={ariaLabel} />;
}
