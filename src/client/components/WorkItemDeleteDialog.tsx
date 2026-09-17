import * as workItemsApi from '../features/work-items/api';
import { Button } from './Button';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from '../api';
import { invalidateRequirementViews } from '../query-keys';
import { canDeleteWorkItem } from '../../shared/domain';
import type { Requirement, WorkItem } from '../types';
import { ConfirmDialog } from './Modal';

export function WorkItemDeleteDialog({ target, requirement, canManage, onReload, onWriteNeedsRecheck, onClose }: {
  target: WorkItem;
  requirement: Requirement;
  canManage: boolean;
  onReload: () => Promise<Requirement>;
  onWriteNeedsRecheck: () => void;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [unknown,setUnknown]=useState(false);
  const [baseline, setBaseline] = useState(target);
  const [reading, setReading] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const [readError, setReadError] = useState('');
  const submitting = useRef(false);
  const readingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const latest = requirement.workItems.find((item) => item.id === baseline.id);
  const changed = Boolean(latest && latest.version !== baseline.version);
  const hasHistory = (requirement.progressUpdates || []).some((entry) => entry.workItemId === baseline.id);
  const warning = !canManage ? '当前需求不允许管理工作项，请关闭确认窗口。'
    : !latest ? '工作项已被删除，请关闭确认窗口。'
    : !canDeleteWorkItem(latest, hasHistory) ? '工作项已有执行信息或进展历史，不能删除。'
    : changed ? '工作项已更新，请重新读取并核对后再确认删除。' : '';
  const readLatest = async () => {
    if (readingRef.current) return null;
    readingRef.current = true; setReading(true); setNeedsRefresh(true); setReadError('');
    try {
      const fresh = await onReload();
      if (!mounted.current) return null;
      const item = fresh.workItems.find((entry) => entry.id === baseline.id);
      if (item) setBaseline(item);
      setNeedsRefresh(false); setRefreshed(true);
      return fresh;
    } catch (caught) {
      if (mounted.current) setReadError(caught instanceof Error ? caught.message : '工作项读取失败');
      return null;
    } finally {
      readingRef.current = false;
      if (mounted.current) setReading(false);
    }
  };
  const mutation = useMutation({
    mutationFn: (item: WorkItem) => workItemsApi.workItemsById(item.id, { method: 'DELETE', body: jsonBody({ expectedVersion: item.version }) }),
    onSuccess: () => {
      invalidateRequirementViews(client, baseline.requirementId);
      if (mounted.current) onClose();
    },
    onError: async (error) => {
      if (!mounted.current) return;
      setNeedsRefresh(true);
      if (requiresWriteRecheck(error)) {
        if(isWriteOutcomeUnknown(error)){setUnknown(true);onWriteNeedsRecheck();}
        await readLatest();
      }
    },
    onSettled: () => { submitting.current = false; },
  });
  const pending = mutation.isPending || reading;
  const blocked = unknown || Boolean(warning) || needsRefresh;
  return <ConfirmDialog title="删除工作项" description={<>
    <p>工作项“<strong>{baseline.title}</strong>”将从需求计划中删除。其前置和后续依赖将一并删除，其他工作项保留。</p>
    {warning && <p className="form-error" role="alert">{warning}</p>}
    {readError && <p className="form-error" role="alert">{readError}</p>}
    {unknown&&<p>删除结果待核对，本窗口不会重复提交。请核对操作记录。</p>}{refreshed && <p>已读取最新工作项，请核对名称和删除条件后再确认。</p>}
    {(changed || needsRefresh) && <Button variant="secondary" type="button" className="ghost-button" disabled={pending} onClick={() => void readLatest()}>重新读取工作项</Button>}
  </>} confirmLabel="确认删除" pendingLabel="处理中…" danger pending={pending} disabled={blocked} error={mutation.error?.message}
    onClose={() => { if (!submitting.current && !readingRef.current) onClose(); }}
    onConfirm={() => {
      if (submitting.current || readingRef.current || blocked) return;
      submitting.current = true;
      mutation.mutate(baseline);
    }} />;
}
