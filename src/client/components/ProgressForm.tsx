import {assertCleanRequirementDraft} from '../use-graph-draft';
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, jsonBody, requiresWriteRecheck } from '../api';
import { useSession } from '../app-context';
import { invalidateRequirementViews } from '../query-keys';
import type { ProgressUpdate, WorkItem } from '../types';
import { requirementStatusLabels } from '../../shared/domain';
import { FormError, FormField, FormSubmitActions } from './Form';
import { Modal } from './Modal';
import { ProgressInput } from './ProgressInput';
import { useToast } from './Toast';
import { canonicalizeContent } from '../../shared/search';

export type ProgressScope = {
  items: WorkItem[];
  updates?: ProgressUpdate[];
  allowRequirementNote: boolean;
  requirementStatus?: string;
};

const terminal = (status: string) => ['completed', 'cancelled'].includes(status);

export function ProgressForm({
  requirementId, scope, loadScope, fixedItemId, contextLabel, title = '增加进展', submitLabel = '记录进展', onClose,
}: {
  requirementId: string;
  scope: ProgressScope;
  loadScope: () => Promise<ProgressScope>;
  fixedItemId?: string | null;
  contextLabel: string;
  title?: string;
  submitLabel?: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const { session } = useSession();
  const toast = useToast();
  const submitting = useRef(false);
  const initialUpdateIds = useRef(new Set((scope.updates || []).map((update) => update.id)));
  const [workItemId, setWorkItemId] = useState(() => fixedItemId || (scope.allowRequirementNote ? '' : scope.items.find((item) => !terminal(item.status))?.id || ''));
  const [draftItem, setDraftItem] = useState(() => scope.items.find((item) => item.id === workItemId));
  const [percent, setPercent] = useState(draftItem?.progress || 0);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const availableItems = scope.items.filter((item) => !terminal(item.status));
  const currentItem = scope.items.find((item) => item.id === workItemId);
  const unavailable = Boolean(workItemId && (!currentItem || terminal(currentItem.status)));
  const changed = Boolean(currentItem && (!draftItem || currentItem.version !== draftItem.version || currentItem.status !== draftItem.status));
  const locked = scope.requirementStatus && ['pending_acceptance', 'completed', 'cancelled'].includes(scope.requirementStatus);
  const writesPercent = Boolean(workItemId && draftItem?.status === 'in_progress');
  const decreasing = writesPercent && percent < (currentItem?.progress || 0);
  const validationError = locked ? '需求已进入待验收或终态，不能再追加进展。'
    : unavailable ? '原工作项已结束或不可操作，已保留你的输入；不会自动改为需求说明。'
    : changed || needsRefresh ? '工作项已更新，请重新读取并核对；已保留你的输入。'
    : workItemId && !draftItem ? '请重新读取工作项后再提交。'
    : !workItemId && (!scope.allowRequirementNote || fixedItemId) ? '请选择可操作的工作项。'
    : decreasing ? '普通进展不能降低完成度，请核对最新完成度；降低完成度需由项目经理纠错。'
    : null;
  const refresh = useMutation({
    mutationFn: loadScope,
    onSuccess: (latest) => {
      // 找不到原项时保留ID和草稿，不重新选择其他项或转成需求说明。
      const item = latest.items.find((entry) => entry.id === workItemId);
      if (item) setDraftItem(item);
      setNeedsRefresh(false);
    },
  });
  const mutation = useMutation({
    mutationFn: async (input: { content: string; workItemId?: string; expectedVersion?: number; workItemPercent?: number }) => {await assertCleanRequirementDraft(session.accountId||'guest',requirementId);return api(`/api/requirements/${requirementId}/progress`, { method: 'POST', body: jsonBody(input) });},
    onSuccess: () => {
      invalidateRequirementViews(client, requirementId);
      onClose();
    },
    onError: async (error, input) => {
      if (requiresWriteRecheck(error)) {
        setNeedsRefresh(true);
        try {
          const latest = await refresh.mutateAsync();
          const saved = latest.updates?.some((update) => !initialUpdateIds.current.has(update.id)
            && update.content === canonicalizeContent(input.content)
            && update.workItemId === (input.workItemId || null)
            && update.eventType === (input.workItemPercent === undefined ? 'note' : 'progress')
            && update.createdByAccountId === session.accountId
            && (input.workItemPercent === undefined || update.workItemPercent === input.workItemPercent));
          if (saved) {
            invalidateRequirementViews(client, requirementId);
            toast.success('已核对最新状态：进展已记录');
            onClose();
          }
        } catch { /* 保留输入，读取失败后由用户重试。 */ }
      }
    },
    onSettled: () => { submitting.current = false; },
  });
  const pending = mutation.isPending || refresh.isPending;
  const changeItem = (id: string) => {
    if (submitting.current || fixedItemId || id === workItemId) return;
    const item = availableItems.find((entry) => entry.id === id);
    setWorkItemId(id);
    setDraftItem(item);
    setPercent(item?.progress || 0);
    setNeedsRefresh(false);
    mutation.reset();
    refresh.reset();
  };
  return <Modal title={title} closable={!pending} onClose={() => { if (!submitting.current) onClose(); }}>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (submitting.current || validationError) return;
      const content = String(new FormData(event.currentTarget).get('content') || '');
      submitting.current = true;
      mutation.mutate({ content, ...(workItemId ? {
        workItemId,
        expectedVersion: draftItem!.version,
        ...(writesPercent ? { workItemPercent: percent } : {}),
      } : {}) });
    }}>
      <fieldset className="form-grid form-fieldset" disabled={pending}>
        {fixedItemId ? <div className="progress-item-context field-full"><span>工作项</span><strong>{currentItem?.title || draftItem?.title || '原工作项不可用'}</strong><small>{contextLabel}</small></div>
          : <FormField label={`关联工作项${scope.allowRequirementNote ? '（可选）' : ''}`} full>
            <select required={!scope.allowRequirementNote} value={workItemId} onChange={(event) => changeItem(event.target.value)}>
              {scope.allowRequirementNote && <option value="">不关联</option>}
              {workItemId && !availableItems.some((item) => item.id === workItemId) && <option value={workItemId} disabled>{draftItem?.title || '原工作项'} · 不可操作</option>}
              {!workItemId && !scope.allowRequirementNote && <option value="">暂无可操作工作项</option>}
              {availableItems.map((item) => <option value={item.id} key={item.id}>{item.title} · 当前 {item.progress}%</option>)}
            </select>
          </FormField>}
        {workItemId && <p className="field-help field-full">当前完成度 {currentItem?.progress ?? draftItem?.progress ?? 0}% · {requirementStatusLabels[(currentItem?.status || draftItem?.status) as keyof typeof requirementStatusLabels] || '不可操作'}</p>}
        {writesPercent && <ProgressInput name="workItemPercent" value={percent} onChange={setPercent} max={99} />}
        {currentItem?.status === 'blocked' && <p className="field-help field-full">工作项处于阻塞状态，只能补充说明；解除阻塞后才能继续提高进度。</p>}
        {currentItem?.status === 'not_started' && <p className="field-help field-full">工作项尚未开始，只能补充说明；开始后才能填写完成度。</p>}
        <FormField label="具体进展" full><textarea name="content" rows={5} required autoFocus placeholder="描述本次实际完成的内容" /></FormField>
        <p className="field-help field-full">只有进行中的工作项可以填写0～99%的累计完成度；100%请使用“完成工作项”。{scope.allowRequirementNote && !fixedItemId && '不关联工作项时仅记录需求说明。'}</p>
        <FormError>{validationError || mutation.error?.message}</FormError>
        <FormError>{refresh.error?.message}</FormError>
        {(needsRefresh || changed || unavailable) && <div className="field-full"><button type="button" className="ghost-button" onClick={() => {
          if (submitting.current) return;
          submitting.current = true;
          refresh.mutate(undefined, { onSettled: () => { submitting.current = false; } });
        }}>重新读取工作项</button></div>}
        <FormSubmitActions submitLabel={submitLabel} onCancel={onClose} pending={pending} disabled={Boolean(validationError)} />
      </fieldset>
    </form>
  </Modal>;
}
