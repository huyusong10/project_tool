import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PathAnalysis } from '../../shared/paths';
import type { WorkItem } from '../types';
import { api, jsonBody, requiresWriteRecheck } from '../api';
import { useSession } from '../app-context';
import { invalidateRequirementViews } from '../query-keys';
import { assertCleanRequirementDraft } from '../use-graph-draft';
import { Modal, useSynchronousPendingLock } from './Modal';
import { FormError } from './Form';

export function ForecastDateEditor({ item, data, onClose }: { item: WorkItem; data: PathAnalysis; onClose: () => void }) {
  const client = useQueryClient(), { session } = useSession();
  const [baseline, setBaseline] = useState(data);
  const [date, setDate] = useState(data.nodes.find(n => n.id === item.id)?.estimate.forecastEnd || '');
  const [needsReload, setNeedsReload] = useState(false);
  const node = baseline.nodes.find(n => n.id === item.id);
  const ended = !node || ['completed', 'cancelled'].includes(node.status);
  const mutation = useMutation({
    mutationFn: async () => {
      await assertCleanRequirementDraft(session.accountId || 'guest', item.requirementId, { workItemId: item.id, action: '更新预计完成日期' });
      return api(`/api/work-items/${item.id}/path-estimate`, { method: 'PATCH', body: jsonBody({ expectedRevision: baseline.revision, forecastEnd: date || null }) });
    },
    onSuccess: () => { invalidateRequirementViews(client, item.requirementId); onClose(); },
    onError: error => { if (requiresWriteRecheck(error)) setNeedsReload(true); },
  });
  const reload = useMutation({
    mutationFn: () => api<PathAnalysis>(`/api/projects/${data.projectId}/path-analysis?target=project`),
    onSuccess: latest => { setBaseline(latest); setNeedsReload(false); mutation.reset(); invalidateRequirementViews(client, item.requirementId); },
  });
  const lock = useSynchronousPendingLock(mutation.isPending || reload.isPending);
  const close = () => { if (lock.canClose()) onClose(); };
  return <Modal title="修改预计完成日期" width={460} closable={!lock.busy} onClose={close}>
    <form onSubmit={event => { event.preventDefault(); if (!needsReload && !ended) lock.run(() => mutation.mutate()); }}>
      <fieldset disabled={lock.busy}>
        <p>{item.title}</p>
        <p className="field-help">当前推算：{node?.forecastEnd || '待更新'}；已填写的预计完成：{node?.estimate.forecastEnd || '未填写'}。</p>
        {needsReload && <div className="warning-banner">数据或保存结果需要重新读取，已填日期保留。<button type="button" className="ghost-button" onClick={() => lock.run(() => reload.mutate())}>重新读取</button></div>}
        {ended && <p role="alert">工作项已结束或不可用，不能修改预测。</p>}
        <label className="field"><span>预计完成日期</span><input type="date" min={baseline.asOfDate} value={date} onChange={event => setDate(event.target.value)} /></label>
        <p className="field-help">保存后按前置关系更新交付预测，保留原计划。清空日期恢复自动估算。</p>
        <FormError>{mutation.error?.message || reload.error?.message}</FormError>
        <div className="button-row"><button type="button" className="ghost-button" onClick={close}>取消</button><button className="primary-button" disabled={needsReload || ended || lock.busy}>{lock.busy ? '处理中…' : '保存'}</button></div>
      </fieldset>
    </form>
  </Modal>;
}
