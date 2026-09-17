import * as requirementsApi from '../features/requirements/api';
import { useDeliveryForm } from '../use-delivery-form';
import { useProjects } from '../app-context';
import { Button } from './Button';
import { assertCleanRequirementDraft } from '../use-graph-draft';
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from '../api';
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

type ProgressRequest = {content:string;workItemId:string;expectedVersion:number;workItemPercent?:number};
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
  const { session } = useSession(),{selectedProjectId}=useProjects();
  const [receipt,setReceipt,clearReceipt]=useDeliveryForm<ProgressRequest|null>(selectedProjectId,fixedItemId+':progress-receipt',()=>null);
  const receiptRef=useRef(receipt);
  const [local,setLocal,clearLocal]=useDeliveryForm(selectedProjectId,fixedItemId+':progress',()=>({item:scope.items.find(item=>item.id===fixedItemId),percent:scope.items.find(item=>item.id===fixedItemId)?.progress||0,content:'',unknown:null as {version:number;versioned:boolean}|null}));
  const submitting = useRef(false);
  const unknownWrite = useRef<{ version: number; versioned: boolean } | null>(receipt?{version:receipt.expectedVersion,versioned:receipt.workItemPercent!==undefined}:local.unknown);
  const [reviewRequired, setReviewRequired] = useState(!!receipt||!!local.unknown);
  const workItemId = fixedItemId;
  const draftItem=local.item;
  const setDraftItem=(item:WorkItem)=>setLocal(value=>({...value,item}));
  const editsPercent = useRef(draftItem?.status === 'in_progress').current;
  const percent=local.percent;
  const setPercent=(percent:number)=>setLocal(value=>({...value,percent}));
  const [needsRefresh, setNeedsRefresh] = useState(!!receipt);
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
      setReviewRequired(Boolean(receiptRef.current||unknown && (!unknown.versioned || item?.version !== unknown.version)));
      setNeedsRefresh(false);
    },
  });
  const mutation = useMutation({
    mutationFn: async (input: ProgressRequest) => {await assertCleanRequirementDraft(session.accountId||'guest',requirementId,{workItemId:input.workItemId,action:input.workItemPercent===undefined?'note':'progress'});receiptRef.current=input;setReceipt(input);return requirementsApi.requirementsProgress(requirementId, { method: 'POST', body: jsonBody(input) });},
    onSuccess: () => {
      invalidateRequirementViews(client,requirementId,'execution');
      receiptRef.current=null;setReceipt(null);clearReceipt();clearLocal();onClose();
    },
    onError: async (error, input) => {
      if(!isWriteOutcomeUnknown(error)){receiptRef.current=null;setReceipt(null);clearReceipt();}
      if (requiresWriteRecheck(error)) {
        if (isWriteOutcomeUnknown(error)) unknownWrite.current = {
          version: input.expectedVersion, versioned: input.workItemPercent !== undefined,
        };
        if(unknownWrite.current)setLocal(value=>({...value,unknown:unknownWrite.current}));
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
        <FormField label={writesPercent ? "说明（可选）" : "说明"} full><textarea name="content" value={local.content} onChange={event=>setLocal(value=>({...value,content:event.target.value}))} rows={3} required={!writesPercent} autoFocus placeholder={writesPercent ? '描述本次实际完成的内容' : '说明当前情况和待处理事项'} /></FormField>
        <p className="field-help field-full">{editsPercent ? '只有进行中的工作项可以填写0～99%的累计完成度；100%请使用“完成工作项”。' : '本次只保存说明，不改变完成度、状态和日期。'}</p>
        <FormError>{validationError || mutation.error?.message}</FormError>
        <FormError>{refresh.error?.message}</FormError>
        {receipt&&reviewRequired&&<details className="field-full"><summary>待核对的原提交</summary><p>{receipt.workItemPercent===undefined?"仅记录说明":`完成度 ${receipt.workItemPercent}%`}</p><p>{receipt.content||"未填写说明"}</p></details>}
        {(needsRefresh || changed || unavailable || receipt) && <div className="field-full"><Button variant="secondary" type="button" className="ghost-button" onClick={() => {
          if (submitting.current) return;
          submitting.current = true;
          refresh.mutate(undefined, { onSettled: () => { submitting.current = false; } });
        }}>重新读取工作项</Button></div>}
        {receipt&&reviewRequired&&!needsRefresh&&<Button variant="secondary" type="button" onClick={()=>{receiptRef.current=null;setReceipt(null);clearReceipt();clearLocal();onClose();}}>已核对，结束本次操作</Button>}
        <FormSubmitActions submitLabel={submitLabel} onCancel={()=>{clearLocal();onClose();}} pending={pending} disabled={Boolean(validationError)} />
      </fieldset>
    </form>
  </Modal>;
}
