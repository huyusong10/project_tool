import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PathAnalysis } from '../../shared/paths';
import type { Requirement, WorkItem } from '../types';
import { jsonBody, requiresWriteRecheck } from '../api';
import { useSession } from '../app-context';
import * as pathsApi from '../features/paths/api';
import { invalidateRequirementViews, keys } from '../query-keys';
import { useResourceQuery } from '../use-resource-query';
import { assertCleanRequirementDraft } from '../use-graph-draft';
import { Button } from './Button';
import { FormError } from './Form';
import { Modal, useSynchronousPendingLock } from './Modal';

export function WorkItemForecast({ requirement, item }: { requirement: Requirement; item: WorkItem }) {
  const [open, setOpen] = useState(false);
  return <><Button variant="secondary" onClick={() => setOpen(true)}>更新预测</Button>
    {open && <ForecastDialog requirement={requirement} item={item} onClose={() => setOpen(false)} />}</>;
}

function ForecastDialog({ requirement, item, onClose }: { requirement: Requirement; item: WorkItem; onClose: () => void }) {
  const { session } = useSession();
  const [initial, setInitial] = useState<PathAnalysis | null>(null);
  const query = useResourceQuery<PathAnalysis>([...keys.paths, requirement.projectId, 'work-forecast', session.accountId],
    signal => pathsApi.projectsPathAnalysisQuery<PathAnalysis>(requirement.projectId, { signal }), true, data => setInitial(previous => previous || data), true);
  if (!initial) return <Modal title="更新交付预测" onClose={onClose}>
    <p role="status">{query.error?.message || '正在读取最新预测…'}</p>
    {query.error && <Button variant="secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>重新读取</Button>}
  </Modal>;
  return <ForecastForm requirement={requirement} item={item} data={query.data || initial} unavailable={query.unavailable} onClose={onClose}
    onReload={async () => { const result = await query.refetch({ throwOnError: true }); if (!result.data) throw Error('预测无法读取'); return result.data; }} />;
}

function ForecastForm({ requirement, item, data, unavailable, onReload, onClose }: {
  requirement: Requirement; item: WorkItem; data: PathAnalysis; unavailable: boolean; onReload: () => Promise<PathAnalysis>; onClose: () => void;
}) {
  const { session } = useSession(), client = useQueryClient();
  const node = data.nodes.find(node => node.id === item.id);
  const [forecast, setForecast] = useState(node?.estimate.forecastEnd || '');
  const [baseline, setBaseline] = useState(data.revision), [needsCheck, setNeedsCheck] = useState(false);
  const [checking, setChecking] = useState(false), [readError, setReadError] = useState('');
  const stale = needsCheck || baseline !== data.revision || unavailable;
  const terminal = !node || ['completed', 'cancelled'].includes(node.status);
  const unchanged = forecast === (node?.estimate.forecastEnd || '');
  const mutation = useMutation({ mutationFn: async () => {
    await assertCleanRequirementDraft(session.accountId || 'guest', requirement.id);
    return pathsApi.saveEstimate(item.id, { method: 'PATCH', body: jsonBody({ expectedRevision: baseline, forecastEnd: forecast || null }) });
  }, onSuccess: () => { invalidateRequirementViews(client, requirement.id); onClose(); },
  onError: error => { if (requiresWriteRecheck(error)) setNeedsCheck(true); } });
  const lock = useSynchronousPendingLock(mutation.isPending);
  const close = () => { if (!checking && lock.canClose()) onClose(); };
  const reload = async () => {
    setChecking(true); setReadError('');
    try { const latest = await onReload(); setBaseline(latest.revision); setNeedsCheck(false); mutation.reset(); invalidateRequirementViews(client, requirement.id); }
    catch (error) { setReadError((error as Error).message); }
    finally { setChecking(false); }
  };
  return <Modal title="更新交付预测" onClose={close} closable={!lock.busy && !checking}>
    <form onSubmit={event => { event.preventDefault(); if (!stale && !terminal && !unchanged && !checking) lock.run(() => mutation.mutate()); }}>
      <fieldset className="form-grid form-fieldset" disabled={lock.busy || checking}>
        <strong className="field-full">{item.title}</strong>
        <p className="field-help field-full">计划：{item.plannedStart || '待定'} ～ {item.plannedEnd || '待定'} · 已完成 {item.progress}%</p>
        <p className="field-help field-full">当前人工预测：{node?.estimate.forecastEnd || '未设置'}；系统预计完成：{node?.forecastEnd || '待确认'}。</p>
        {node?.status==='not_started'&&!node.estimate.forecastEnd&&node.forecastStart&&item.plannedStart&&node.forecastStart<item.plannedStart&&<p className="field-help field-full">自动预计从最早可开工日 {node.forecastStart} 按 {node.remainingDays} 个工作日推算，可能早于计划开始。</p>}
        {stale && <div className="warning-banner field-full" role="alert">数据或保存结果需要核对，已填日期保留。<Button variant="secondary" type="button" onClick={() => void reload()}>重新读取并核对</Button></div>}
        {terminal && <p className="field-full" role="alert">工作项已结束或不可用，不能修改当前预测。</p>}
        <label className="field field-full"><span>人工预测完成</span><input type="date" min={data.asOfDate} value={forecast} onChange={event => setForecast(event.target.value)} /></label>
        <p className="field-help field-full">留空后按剩余工作和前置关系计算。更新预测不改变计划日期或已记录进度。</p>
        <FormError>{readError || mutation.error?.message}</FormError>
        <div className="form-actions field-full"><Button variant="secondary" type="button" onClick={close}>返回</Button>
          <Button variant="primary" type="submit" busy={lock.busy} disabled={stale || terminal || unchanged || lock.busy || checking}>保存预测</Button></div>
      </fieldset>
    </form>
  </Modal>;
}
