import { useEffect, useRef } from 'react';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { init, use as registerEChartsModules, type EChartsCoreOption, type EChartsType } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useTheme } from '../theme';
import { chartColorResolver, resolveChartTokens } from '../chart-theme';
import { chartAnimationEnabled, useReducedMotion } from '../motion';

registerEChartsModules([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export function Chart({ option, height = 240, ariaLabel }: { option: Record<string, unknown>; height?: number; ariaLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const instance = useRef<EChartsType | null>(null);
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const previousTheme = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!ref.current) return;
    const chart = init(ref.current, undefined, { renderer: 'canvas' });
    instance.current = chart;
    let frame = 0;
    let lastWidth = ref.current.clientWidth;
    let lastHeight = ref.current.clientHeight;
    const observer = new ResizeObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!ref.current) return;
        const { clientWidth: width, clientHeight: height } = ref.current;
        if (width === lastWidth && height === lastHeight) return;
        lastWidth = width; lastHeight = height;
        chart.resize();
      });
    });
    observer.observe(ref.current);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); chart.dispose(); instance.current = null; previousTheme.current = undefined; };
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
      const animation = chartAnimationEnabled(option, reducedMotion, previousTheme.current !== undefined && previousTheme.current !== theme, !document.hidden);
      previousTheme.current = theme;
      ref.current.dataset.chartMotion = animation ? 'short' : 'none';
      chart.setOption({
        color: ['--chart-line','--success','--warning','--purple','--danger','--info'].map(colors.resolve),
        ...resolved,
        animation,
        animationThreshold: 200,
        animationDuration: 180,
        animationDurationUpdate: 140,
        animationEasing: 'cubicOut',
        animationEasingUpdate: 'cubicOut',
        textStyle: { fontFamily: font, color: text, ...resolved.textStyle as object },
        tooltip: { confine: true, extraCssText: 'max-width:min(360px,100%);white-space:normal;overflow-wrap:anywhere;', backgroundColor: colors.resolve('--bg-surface'), borderColor: line, textStyle: { color: text }, ...resolved.tooltip as object },
      } as EChartsCoreOption, { replaceMerge: ['series', 'xAxis', 'yAxis', 'legend', 'grid'], lazyUpdate: false });
    } finally { colors.dispose(); }
  }, [option, theme, reducedMotion]);
  return <div ref={ref} style={{ height }} className="themed-chart" data-chart-theme={theme} role="img" aria-label={ariaLabel} />;
}
