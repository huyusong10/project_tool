import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
const chartFontFamily = '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif';
export function Chart({ option, height = 240, ariaLabel }: { option: Record<string, unknown>; height?: number; ariaLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    chart.setOption({ textStyle: { fontFamily: chartFontFamily }, ...option });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [option]);
  return <div ref={ref} style={{ height, fontFamily: chartFontFamily }} role="img" aria-label={ariaLabel} />;
}
