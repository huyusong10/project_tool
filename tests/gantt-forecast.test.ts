import { describe, expect, it } from 'vitest';
import { ganttForecast } from '../src/client/gantt-forecast';
import { analysePaths, type PathNode } from '../src/shared/paths';
import { deliveryForecast } from '../src/shared/forecast-basis';
import { pathFixture, date } from './fixtures/path-network';

const node = (patch: Partial<PathNode> = {}, asOfDate = '2026-09-11') => deliveryForecast({ kind: 'work', status: 'in_progress', forecastStart: asOfDate, forecastEnd: '2026-09-17', remainingDays: 4, source: '按进度估算剩余工期', unknownReasons: [], ...patch } as PathNode, { revision: 1, asOfDate });
describe('甘特交付预测', () => {
  it('从统计日算剩余工作日，今天不再计入未来尾段', () => {
    expect(ganttForecast(node(), 'in_progress', '2026-09-11')?.label).toBe('预计 09/17 · 还需 4 工作日');
    expect(ganttForecast(node({ forecastEnd: '2026-09-14' }), 'in_progress', '2026-09-11')?.label).toBe('预计 09/14 · 还需 1 工作日');
    // 9/20 is an official make-up working Sunday.
    expect(ganttForecast(node({ forecastEnd: '2026-09-21' }, '2026-09-18'), 'in_progress', '2026-09-18')?.label).toBe('预计 09/21 · 还需 2 工作日');
  });
  it('今日完成只显示文字，不人为加长一天', () => {
    expect(ganttForecast(node({ forecastEnd: '2026-09-11' }), 'in_progress', '2026-09-11')).toMatchObject({ end: '2026-09-11', label: '预计今日完成' });
  });
  it.each([undefined, node({ forecastEnd: null }), node({ forecastEnd: 'invalid' }), node({ forecastEnd: '2026-09-10' }), node({ unknownReasons: ['人工预测已过期'] })])('缺失、无效、过期或前置未确认时不虚构尾段', value => {
    expect(ganttForecast(value, 'in_progress', '2026-09-11')).toMatchObject({ end: null, label: '预测待更新' });
  });
  it('跨日旧快照不作为当前预测；已结束不留预测', () => {
    expect(ganttForecast(node({}, '2026-09-10'), 'in_progress', '2026-09-11')?.end).toBeNull();
    for (const status of ['completed', 'cancelled']) expect(ganttForecast(node(), status, '2026-09-11')).toBeNull();
  });
  it('直接采用含串并行依赖的需求完成事件；无关需求缺失不抹掉已知的局部预测', () => {
    const input = pathFixture(), analysis = analysePaths(input);
    const acceptance = analysis.nodes.find(n => n.id === 'acceptance:A');
    expect(ganttForecast(deliveryForecast(acceptance, analysis), 'in_progress', input.asOfDate)?.end).toBe(date(6));
    Object.assign(input.workItems.find(w => w.id === 'C2')!, { durationDays: null, plannedEnd: null });
    const partial = analysePaths(input);
    expect(partial.forecastEnd).toBeNull();
    expect(ganttForecast(deliveryForecast(partial.nodes.find(n => n.id === 'acceptance:A'), partial), 'in_progress', input.asOfDate)?.end).toBe(date(6));
  });
  it('未开始工作保留前置完成后的真实预测开始，未知开始不从今天补画', () => {
    expect(ganttForecast(node({forecastStart:'2026-09-20',forecastEnd:'2026-09-22'}), 'not_started', '2026-09-11')).toMatchObject({start:'2026-09-20',end:'2026-09-22',started:false});
    expect(ganttForecast(node({forecastStart:null}), 'not_started', '2026-09-11')?.end).toBeNull();
  });
});
