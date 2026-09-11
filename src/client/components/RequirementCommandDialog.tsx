import {assertCleanRequirementDraft} from '../use-graph-draft';
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

export type RequirementCommand = 'complete-as-planned' | 'cancel' | 'archive';
export type RequirementCommandRecheck = { action: RequirementCommand; baselineVersion: number; text: string; stage: 'read' | 'review' };
const requirementCommands: RequirementCommand[] = ['complete-as-planned', 'cancel', 'archive'];
function requirementCommandRecheckKey(accountKey: string, requirementId: string) {
  return `project-manage:requirement-command-recheck:${accountKey}:${requirementId}`;
}
export function readRequirementCommandRecheck(accountKey: string, requirementId: string): RequirementCommandRecheck | null {
  try {
    const raw = sessionStorage.getItem(requirementCommandRecheckKey(accountKey, requirementId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<RequirementCommandRecheck>;
    return requirementCommands.includes(value.action as RequirementCommand)
      && typeof value.baselineVersion === 'number'
      && typeof value.text === 'string'
      && (value.stage === 'read' || value.stage === 'review') ? value as RequirementCommandRecheck : null;
  } catch { return null; }
}
export function persistRequirementCommandRecheck(accountKey: string, requirementId: string, value: RequirementCommandRecheck | null) {
  try {
    const key = requirementCommandRecheckKey(accountKey, requirementId);
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch { /* 当前页面仍保留核对锁。 */ }
}
const commands = {
  'complete-as-planned': { title: '按期完成（历史补录）', confirm: '确认按期完成' },
  cancel: { title: '取消需求', confirm: '确认取消' },
  archive: { title: '归档需求', confirm: '确认归档' },
};

function commandWarning(action: RequirementCommand, requirement: Requirement, today: string) {
  if (action === 'archive') {
    if (requirement.deletedAt) return '需求已归档，不能重复提交。';
    if (!['completed', 'cancelled'].includes(requirement.status)) return '需求必须先完成或取消，才能归档。';
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

export function RequirementCommandDialog({ action, requirement, recheck, onRecheckChange, onReload, onClose, onArchived }: {
  action: RequirementCommand;
  requirement: Requirement;
  recheck: RequirementCommandRecheck | null;
  onRecheckChange: (value: RequirementCommandRecheck | null) => void;
  onReload: () => Promise<Requirement>;
  onClose: () => void;
  onArchived: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const { businessDate: today } = useBusinessDate();
  const { session } = useSession();
  const [baseline, setBaseline] = useState(requirement);
  const [text, setText] = useState(recheck?.text || '');
  const [reading, setReading] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(recheck?.stage === 'read');
  const [refreshed, setRefreshed] = useState(false);
  const [readError, setReadError] = useState<Error | null>(null);
  const submitting = useRef(false);
  const unknownVersion=useRef<number|null>(recheck?.baselineVersion ?? null);const [reviewRequired,setReviewRequired]=useState(recheck?.stage === 'review');
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
      const requiresReview = unknownVersion.current !== null && latest.version !== unknownVersion.current;
      setReviewRequired(requiresReview);
      if (requiresReview) onRecheckChange({ action, baselineVersion: unknownVersion.current!, text, stage: 'review' });
      else onRecheckChange(null);
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
    mutationFn: async (input: { expectedVersion: number; content?: string; reason?: string }) => {await assertCleanRequirementDraft(session.accountId||'guest',baseline.id,{action});return api(`/api/requirements/${baseline.id}${action === 'archive' ? '' : `/${action}`}`, {
      method: action === 'archive' ? 'DELETE' : 'POST', body: jsonBody(input),
    });},
    onMutate: (input) => onRecheckChange({ action, baselineVersion: input.expectedVersion, text, stage: 'read' }),
    onSuccess: () => {
      onRecheckChange(null);
      unknownVersion.current = null;
      if (action === 'archive') invalidateArchiveViews(client);
      else invalidateRequirementViews(client, baseline.id);
      if (!mounted.current) return;
      toast.success(action === 'complete-as-planned' ? '需求已按期补录完成' : action === 'cancel' ? '需求已取消' : '需求已归档');
      onClose();
      if (action === 'archive') onArchived();
    },
    onError: async (error, input) => {
      if (isWriteOutcomeUnknown(error)) {
        unknownVersion.current = input.expectedVersion;
        onRecheckChange({ action, baselineVersion: input.expectedVersion, text, stage: 'read' });
      } else {
        unknownVersion.current = null;
        onRecheckChange(null);
      }
      if(!mounted.current||!requiresWriteRecheck(error))return;
      setNeedsRefresh(true);await readLatest();
    },
    onSettled: () => { submitting.current = false; },
  });
  const warning = commandWarning(action, baseline, today);
  const pending = mutation.isPending || reading;
  const blocked = changed || needsRefresh || reviewRequired || Boolean(warning);
  const needsText = action === 'cancel';
  const pendingItems = baseline.workItems.filter((item) => !['completed', 'cancelled'].includes(item.status));
  const close = () => { if (!submitting.current && !readingRef.current) onClose(); };
  const finishReview = () => { onRecheckChange(null); unknownVersion.current = null; setReviewRequired(false); onClose(); };

  return <Modal title={commands[action].title} width={560} closable={!pending} onClose={close}>
    <form className="requirement-command-form" onSubmit={(event) => {
      event.preventDefault();
      if (submitting.current || readingRef.current || blocked || (needsText && !text.trim())) return;
      submitting.current = true;
      mutation.mutate({ expectedVersion: baseline.version, ...(action === 'cancel' ? { reason: text.trim() } : {}) });
    }}>
      <p><strong>{baseline.title}</strong> · {requirementStatusLabels[baseline.status as keyof typeof requirementStatusLabels]}</p>
      {action === 'complete-as-planned' && <>
        <p>将补录 {pendingItems.length} 个工作项，实际日期使用各自计划日期，进度设为 100%。已完成、已取消工作项保持不变。</p>
        {!!pendingItems.length && <ul className="requirement-command-plan">{pendingItems.map((item) => <li key={item.id}><strong>{item.title}</strong><span>{item.plannedStart || '未排期'} → {item.plannedEnd || '未排期'}</span></li>)}</ul>}
        <p>用于录入过去已经按期交付的需求：一次完成所有未执行工作项。补录说明自动填写，操作会完整保留审计记录。</p>
      </>}
      {action === 'cancel' && <p>将取消 {pendingItems.length} 个未结束工作项。已完成工作项和历史记录保持不变。</p>}
      {action === 'archive' && <p>需求将从日常页面隐藏，历史数据仍会保留并可在归档中心恢复。</p>}
      {needsText && <FormField label="取消原因" full><textarea autoFocus required rows={4} disabled={pending} value={text} onChange={(event) => setText(event.target.value)} /></FormField>}
      <FormError>{mutation.error?.message}</FormError>
      {reviewRequired&&<div className="warning-banner">提交结果仍待核对，当前版本已变化。本窗口不再提交；请核对执行记录，已填说明保留。<button type="button" className="ghost-button" onClick={finishReview}>已核对并关闭</button></div>}
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
