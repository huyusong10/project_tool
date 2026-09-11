import {assertCleanRequirementDraft} from '../use-graph-draft';
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from '../api';
import { useSession } from '../app-context';
import { invalidateRequirementViews } from '../query-keys';
import type { ProgressUpdate, WorkItem } from '../types';
import { requirementStatusLabels } from '../../shared/domain';
import { FormError, FormField, FormSubmitActions } from './Form';
import { Modal } from './Modal';
import { ProgressInput } from './ProgressInput';

export type ProgressScope = {
  items: WorkItem[];
  updates?: ProgressUpdate[];
  requirementStatus?: string;
};

const terminal = (status: string) => ['completed', 'cancelled'].includes(status);

export function ProgressForm({
  requirementId, scope, loadScope, fixedItemId, contextLabel, title = '更新工作项进度', submitLabel = '记录进展', onClose,
}: {
  requirementId: string;
  scope: ProgressScope;
  loadScope: () => Promise<ProgressScope>;
  fixedItemId: string;
  contextLabel: string;
  title?: string;
  submitLabel?: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const { session } = useSession();
  const submitting = useRef(false);
  const unknownWrite = useRef<{ version: number; versioned: boolean } | null>(null);
  const [reviewRequired, setReviewRequired] = useState(false);
  const workItemId = fixedItemId;
  const [draftItem, setDraftItem] = useState(() => scope.items.find((item) => item.id === workItemId));
  const editsPercent = useRef(draftItem?.status === 'in_progress').current;
  const [percent, setPercent] = useState(draftItem?.progress || 0);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const currentItem = scope.items.find((item) => item.id === workItemId);
  const unavailable = Boolean(workItemId && (!currentItem || terminal(currentItem.status)));
  const changed = Boolean(currentItem && (!draftItem || currentItem.version !== draftItem.version || currentItem.status !== draftItem.status));
  const locked = scope.requirementStatus && ['pending_acceptance', 'completed', 'cancelled'].includes(scope.requirementStatus);
  const writesPercent = Boolean(workItemId && editsPercent);
  const decreasing = writesPercent && percent < (currentItem?.progress || 0);
  const validationError = reviewRequired ? '无法确认刚才的提交是否生效，请先核对进展记录；本窗口不再提交，已填内容保留，可复制后关闭。'
    : locked ? '需求已完成或取消，不能再追加进展。'
    : unavailable ? '原工作项已结束或不可操作，已保留你的输入；不会自动改为需求说明。'
    : changed || needsRefresh ? '工作项已更新，请重新读取并核对；已保留你的输入。'
    : editsPercent && draftItem?.status !== 'in_progress' ? '工作项当前不在进行中，不能更新完成度；已填说明保留，请关闭后选择对应操作。'
    : workItemId && !draftItem ? '请重新读取工作项后再提交。'
    : !workItemId ? '请选择可操作的工作项。'
    : decreasing ? '普通进展不能降低完成度，请核对最新完成度；降低完成度需由项目经理纠错。'
    : null;
  const refresh = useMutation({
    mutationFn: loadScope,
    onSuccess: (latest) => {
      // 找不到原项时保留ID和草稿，不重新选择其他项或转成需求说明。
      const item = latest.items.find((entry) => entry.id === workItemId);
      if (item) setDraftItem(item);
      const unknown = unknownWrite.current;
      // 说明不会提高工作项版本，列表中未出现说明也不能证明写入失败。
      setReviewRequired(Boolean(unknown && (!unknown.versioned || item?.version !== unknown.version)));
      setNeedsRefresh(false);
    },
  });
  const mutation = useMutation({
    mutationFn: async (input: { content: string; workItemId: string; expectedVersion: number; workItemPercent?: number }) => {await assertCleanRequirementDraft(session.accountId||'guest',requirementId,{workItemId:input.workItemId,action:input.workItemPercent===undefined?'note':'progress'});return api(`/api/requirements/${requirementId}/progress`, { method: 'POST', body: jsonBody(input) });},
    onSuccess: () => {
      invalidateRequirementViews(client, requirementId);
      onClose();
    },
    onError: async (error, input) => {
      if (requiresWriteRecheck(error)) {
        if (isWriteOutcomeUnknown(error)) unknownWrite.current = {
          version: input.expectedVersion, versioned: input.workItemPercent !== undefined,
        };
        setNeedsRefresh(true);
        try {
          await refresh.mutateAsync();
        } catch { /* 保留输入，读取失败后由用户重试。 */ }
      }
    },
    onSettled: () => { submitting.current = false; },
  });
  const pending = mutation.isPending || refresh.isPending;
  return <Modal title={title} closable={!pending} onClose={() => { if (!submitting.current) onClose(); }}>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (submitting.current || validationError) return;
      const content = String(new FormData(event.currentTarget).get('content') || '');
      submitting.current = true;
      mutation.mutate({ content,
        workItemId,
        expectedVersion: draftItem!.version,
        ...(writesPercent ? { workItemPercent: percent } : {}),
      });
    }}>
      <fieldset className="form-grid form-fieldset" disabled={pending}>
        <div className="progress-item-context field-full"><span>工作项</span><strong>{currentItem?.title || draftItem?.title || '原工作项不可用'}</strong><small>{contextLabel}</small></div>
        {workItemId && <p className="field-help field-full">当前完成度 {currentItem?.progress ?? draftItem?.progress ?? 0}% · {requirementStatusLabels[(currentItem?.status || draftItem?.status) as keyof typeof requirementStatusLabels] || '不可操作'}</p>}
        {writesPercent && <ProgressInput name="workItemPercent" value={percent} onChange={setPercent} max={99} />}
        {currentItem?.status === 'not_started' && <p className="field-help field-full">工作项尚未开始，只能补充说明；开始后才能填写完成度。</p>}
        <FormField label={writesPercent ? "说明（可选）" : "说明"} full><textarea name="content" rows={3} required={!writesPercent} autoFocus placeholder={writesPercent ? '描述本次实际完成的内容' : '说明当前情况和待处理事项'} /></FormField>
        <p className="field-help field-full">{editsPercent ? '只有进行中的工作项可以填写0～99%的累计完成度；100%请使用“完成工作项”。' : '本次只保存说明，不改变完成度、状态和日期。'}</p>
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
