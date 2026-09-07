import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from '../api';
import { useBusinessDate, useSession } from '../app-context';
import { invalidateArchiveViews, invalidateRequirementViews } from '../query-keys';
import type { Requirement } from '../types';
import { requirementStatusLabels } from '../../shared/domain';
import { Modal } from './Modal';
import { FormError, FormField } from './Form';
import { useToast } from './Toast';
import { canonicalizeContent } from '../../shared/search';

export type RequirementCommand = 'complete-as-planned' | 'accept' | 'cancel' | 'archive';
const commands = {
  'complete-as-planned': { title: '按期完成（历史补录）', confirm: '确认按期完成' },
  accept: { title: '确认验收', confirm: '确认验收' },
  cancel: { title: '取消需求', confirm: '确认取消' },
  archive: { title: '归档需求', confirm: '确认归档' },
};

const reconciledCommands: Partial<Record<RequirementCommand, { status: string; eventType: string; message: string }>> = {
  accept: { status: 'completed', eventType: 'accept', message: '已核对最新状态：需求已验收' },
  cancel: { status: 'cancelled', eventType: 'cancel', message: '已核对最新状态：需求已取消' },
};

function matchesPlannedCompletion(latest: Requirement, baseline: Requirement, accountId?: string) {
  const pending = baseline.workItems.filter((item) => !['completed', 'cancelled'].includes(item.status));
  const accepted = latest.progressUpdates?.some((update) => update.workItemId === null
    && update.eventType === 'accept' && update.content === '历史补录，按计划完成；确认验收'
    && update.createdByAccountId === accountId && update.createdAt === latest.updatedAt);
  return latest.status === 'completed' && latest.version === baseline.version + 2
    && pending.length > 0 && accepted && pending.every((expected) => {
    const item = latest.workItems.find((entry) => entry.id === expected.id);
    const content = `历史补录，按计划完成（${expected.plannedStart} 至 ${expected.plannedEnd}）`;
    return item?.status === 'completed'
      && item.version === expected.version + 1
      && item.actualStart === expected.plannedStart
      && item.actualEnd === expected.plannedEnd
      && latest.progressUpdates?.some((update) => update.workItemId === expected.id
        && update.eventType === 'complete' && update.content === content
        && update.createdByAccountId === accountId && update.createdAt === item.updatedAt);
  });
}

function commandWarning(action: RequirementCommand, requirement: Requirement, today: string) {
  if (action === 'accept') return requirement.status === 'pending_acceptance' ? '' : '需求已不在待验收状态，请关闭后重新选择操作。';
  if (action === 'archive') {
    if (requirement.deletedAt) return '需求已归档，不能重复提交。';
    if (!['completed', 'cancelled'].includes(requirement.status)) return '需求必须先完成验收或取消，才能归档。';
    if (requirement.issueSummary?.active) return `需求仍有 ${requirement.issueSummary.active} 个未解决问题，不能归档。`;
    return '';
  }
  if (['completed', 'cancelled'].includes(requirement.status)) return '需求已经结束，请关闭后重新选择操作。';
  if (action === 'cancel') return '';
  const active = requirement.workItems.filter((item) => item.status !== 'cancelled');
  if (!active.length) return '请先添加有效工作项并补齐计划日期。';
  const executedIds = new Set((requirement.progressUpdates || []).filter((entry) => !['note', 'correction'].includes(entry.eventType)).map((entry) => entry.workItemId));
  for (const item of active.filter((entry) => entry.status !== 'completed')) {
    if (item.status !== 'not_started' || item.progress !== 0 || item.actualStart || item.actualEnd || item.blockedAt || executedIds.has(item.id)) return `“${item.title}”已有执行记录，请使用正常完成或实际日期修正。`;
    if (!item.plannedStart || !item.plannedEnd) return `请先补齐“${item.title}”的计划开始和完成日期。`;
    if (item.plannedStart > item.plannedEnd) return `“${item.title}”的计划完成日期不能早于开始日期。`;
    if (item.plannedEnd > today) return `“${item.title}”计划尚未结束，暂不能补录完成。`;
  }
  return '';
}

export function RequirementCommandDialog({ action, requirement, onReload, onClose, onArchived }: {
  action: RequirementCommand;
  requirement: Requirement;
  onReload: () => Promise<Requirement>;
  onClose: () => void;
  onArchived: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const { businessDate: today } = useBusinessDate();
  const { session } = useSession();
  const [baseline, setBaseline] = useState(requirement);
  const [text, setText] = useState('');
  const [reading, setReading] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const [readError, setReadError] = useState<Error | null>(null);
  const submitting = useRef(false);
  const readingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const changed = requirement.version > baseline.version
    || (requirement.version === baseline.version && requirement.status !== baseline.status);
  const readLatest = async () => {
    if (readingRef.current) return null;
    readingRef.current = true; setReading(true); setNeedsRefresh(true); setReadError(null);
    try {
      // 归档命令必须能读到已归档需求，否则归档生效后的读取恒为 404。
      const latest = action === 'archive'
        ? await api<Requirement>(`/api/requirements/${baseline.id}?includeDeleted=true`, { readOnly: true })
        : await onReload();
      if (!mounted.current) return null;
      setBaseline(latest); setNeedsRefresh(false); setRefreshed(true);
      return latest;
    } catch (caught) {
      if (mounted.current) setReadError(caught instanceof Error ? caught : new Error('需求读取失败'));
      return null;
    } finally {
      readingRef.current = false;
      if (mounted.current) setReading(false);
    }
  };
  const mutation = useMutation({
    mutationFn: (input: { expectedVersion: number; content?: string; reason?: string }) => api(`/api/requirements/${baseline.id}${action === 'archive' ? '' : `/${action}`}`, {
      method: action === 'archive' ? 'DELETE' : 'POST', body: jsonBody(input),
    }),
    onSuccess: () => {
      if (action === 'archive') invalidateArchiveViews(client);
      else invalidateRequirementViews(client, baseline.id);
      if (!mounted.current) return;
      toast.success(action === 'complete-as-planned' ? '需求已按期补录完成' : action === 'accept' ? '需求已验收' : action === 'cancel' ? '需求已取消' : '需求已归档');
      onClose();
      if (action === 'archive') onArchived();
    },
    onError: async (error, input) => {
      if (!mounted.current) return;
      // 确定性校验错误（如 400 VALIDATION_ERROR）重读也不会改变结果，直接展示错误即可。
      if (!requiresWriteRecheck(error)) return;
      setNeedsRefresh(true);
      if (action === 'archive' && isWriteOutcomeUnknown(error)) {
        readingRef.current = true; setReading(true); setReadError(null);
        try {
          const latest = await api<Requirement>(`/api/requirements/${baseline.id}?includeDeleted=true`, { readOnly: true });
          if (latest.deletedAt && latest.version === baseline.version + 1 && mounted.current) {
            invalidateArchiveViews(client);
            toast.success('已核对最新状态：需求已归档');
            onClose();
            onArchived();
            return;
          }
        } catch (caught) {
          if (mounted.current) setReadError(caught instanceof Error ? caught : new Error('需求归档状态读取失败'));
        } finally {
          readingRef.current = false;
          if (mounted.current) setReading(false);
        }
      }
      const expected = baseline;
      const latest = await readLatest();
      if (action === 'archive') {
        // 响应不明时必须匹配本次版本，不能把恢复后再次归档误认成本次写入。
        if (latest?.deletedAt && (!isWriteOutcomeUnknown(error) || latest.version === expected.version + 1) && mounted.current) {
          invalidateArchiveViews(client);
          toast.success('已核对最新状态：需求已归档');
          onClose();
          onArchived();
        }
        return;
      }
      if (action === 'complete-as-planned' && latest && matchesPlannedCompletion(latest, expected, session.accountId) && mounted.current) {
        invalidateRequirementViews(client, baseline.id);
        toast.success('已核对最新状态：需求已按期补录完成');
        onClose();
        return;
      }
      const reconciled = reconciledCommands[action];
      const expectedContent = canonicalizeContent(action === 'accept' ? input.content : action === 'cancel' ? input.reason : undefined);
      if (reconciled && expectedContent && latest?.status === reconciled.status
        && latest.version === expected.version + 1
        && latest.progressUpdates?.some((update) => update.workItemId === null
          && update.eventType === reconciled.eventType && update.content === expectedContent
          && update.createdByAccountId === session.accountId && update.createdAt === latest.updatedAt)
        && mounted.current) {
        invalidateRequirementViews(client, baseline.id);
        toast.success(reconciled.message);
        onClose();
      }
    },
    onSettled: () => { submitting.current = false; },
  });
  const warning = commandWarning(action, baseline, today);
  const pending = mutation.isPending || reading;
  const blocked = changed || needsRefresh || Boolean(warning);
  const needsText = action === 'accept' || action === 'cancel';
  const pendingItems = baseline.workItems.filter((item) => !['completed', 'cancelled'].includes(item.status));
  const close = () => { if (!submitting.current && !readingRef.current) onClose(); };

  return <Modal title={commands[action].title} width={560} closable={!pending} onClose={close}>
    <form className="requirement-command-form" onSubmit={(event) => {
      event.preventDefault();
      if (submitting.current || readingRef.current || blocked || (needsText && !text.trim())) return;
      submitting.current = true;
      mutation.mutate({ expectedVersion: baseline.version, ...(action === 'accept' ? { content: text.trim() } : action === 'cancel' ? { reason: text.trim() } : {}) });
    }}>
      <p><strong>{baseline.title}</strong> · {requirementStatusLabels[baseline.status as keyof typeof requirementStatusLabels]}</p>
      {action === 'complete-as-planned' && <>
        <p>将补录 {pendingItems.length} 个工作项，实际日期使用各自计划日期，进度设为 100%。已完成、已取消工作项保持不变。</p>
        {!!pendingItems.length && <ul className="requirement-command-plan">{pendingItems.map((item) => <li key={item.id}><strong>{item.title}</strong><span>{item.plannedStart || '未排期'} → {item.plannedEnd || '未排期'}</span></li>)}</ul>}
        <p>用于录入过去已经按期交付的需求：一次完成所有未执行工作项并通过验收。补录说明自动填写，操作会完整保留审计记录。</p>
      </>}
      {action === 'accept' && <p>验收后需求将计入已完成需求和完成率，请填写验收结论。</p>}
      {action === 'cancel' && <p>将取消 {pendingItems.length} 个未结束工作项。已完成工作项和历史记录保持不变。</p>}
      {action === 'archive' && <p>需求将从日常页面隐藏，历史数据仍会保留并可在归档中心恢复。</p>}
      {needsText && <FormField label={action === 'accept' ? '验收说明' : '取消原因'} full><textarea autoFocus required rows={4} disabled={pending} value={text} onChange={(event) => setText(event.target.value)} /></FormField>}
      <FormError>{mutation.error?.message}</FormError>
      <FormError>{warning}</FormError>
      <FormError>{changed ? '需求已更新，请重新读取并核对后再确认；原确认内容已保留。' : undefined}</FormError>
      <FormError>{readError?.message}</FormError>
      {refreshed && <p>已读取最新需求（版本 {baseline.version}），请核对后再确认。{needsText && '已填写的说明保持不变。'}</p>}
      {(changed || needsRefresh) && <div><button type="button" className="ghost-button" disabled={pending} onClick={() => void readLatest()}>重新读取需求</button></div>}
      <div className="form-actions">
        <button type="button" className="ghost-button" disabled={pending} onClick={close}>取消</button>
        <button autoFocus={!needsText} className={`primary-button${action === 'cancel' || action === 'archive' ? ' danger-button' : ''}`} disabled={pending || blocked || (needsText && !text.trim())}>{pending ? '处理中…' : commands[action].confirm}</button>
      </div>
    </form>
  </Modal>;
}
