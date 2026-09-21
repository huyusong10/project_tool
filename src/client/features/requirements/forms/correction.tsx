import { versionedWriteOutcome } from "../../../core/write-recheck";
import { readRecheck, persistRecheck } from "../../../core/write-recheck";
import * as requirementsApi from "../api";

import { ReferenceLinksEditor } from "../../../components/ReferenceLinks";
import { readReferenceLinks, requirementReferenceLinks, type ReferenceLink } from "../../../../shared/reference-links";
import { Button } from "../../../components/Button";
import { Select } from "../../../components/Select";

import { useDeliveryForm } from "../../../use-delivery-form";
import { migrateFeatureFields } from "../../../feature-storage-migration";
import { OrganizationFields } from '../../../components/RequirementIntake';
import { isAssignablePerson } from "../../../assignable-people";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { ApiError, isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from "../../../api";
import { invalidateRequirementViews, keys } from "../../../query-keys";
import { readResourceFresh, ResourceReadInvalidatedError } from "../../../use-resource-query";
import type { Person, Requirement } from "../../../types";
import { progressReferenceLabel } from '../../../progress-trend';
import { Modal } from "../../../components/Modal";
import { FormError, FormField, FormSubmitActions } from "../../../components/Form";
import { useToast } from "../../../components/Toast";
import { canonicalizeContent, canonicalizeLabel } from "../../../../shared/search";

import { type RequirementInfoDraft, requirementInfoFields, requirementInfoDraft } from './model';

export type RequirementCorrectionRecheck = {
  baselineVersion: number;
  draft: RequirementInfoDraft;
  reason: string;
  supersedesId: string;
  stage: "read" | "review";
};

export function requirementCorrectionRecheckKey(accountKey: string, requirementId: string) {
  return `project-manage:requirement-correction-recheck:${accountKey}:${requirementId}`;
}

export function readRequirementCorrectionRecheck(accountKey: string, requirementId: string): RequirementCorrectionRecheck | null {
  return readRecheck(requirementCorrectionRecheckKey(accountKey, requirementId), stored => {


    const value = migrateFeatureFields(stored) as Partial<RequirementCorrectionRecheck>;
    if(value.draft)value.draft.phaseId??="";
    const draft = value.draft as Partial<RequirementInfoDraft> | undefined;
    if (!Number.isSafeInteger(value.baselineVersion) || Number(value.baselineVersion) < 1
      || !draft || requirementInfoFields.some((field) => field==='referenceLinks'?draft.referenceLinks!==undefined&&!Array.isArray(draft.referenceLinks):typeof draft[field] !== "string")
      || typeof value.reason !== "string" || typeof value.supersedesId !== "string"
      || value.stage !== "read" && value.stage !== "review") return null;
    return {
      baselineVersion: Number(value.baselineVersion), draft: draft as RequirementInfoDraft,
      reason: value.reason, supersedesId: value.supersedesId, stage: value.stage,
    };

  });
}

export function persistRequirementCorrectionRecheck(accountKey: string, requirementId: string, value: RequirementCorrectionRecheck | null) {
  persistRecheck(requirementCorrectionRecheckKey(accountKey, requirementId), value);
}

export function RequirementCorrectionForm({
  requirement,
  people,
  recheck,
  onRecheckChange,
  onClose,
}: {
  requirement: Requirement;
  people: Person[];
  recheck: RequirementCorrectionRecheck | null;
  onRecheckChange: (value: RequirementCorrectionRecheck | null) => void;
  onClose: () => void;
}) {
  const [unknown,setUnknown]=useState(Boolean(recheck));
  const client = useQueryClient();
  const toast = useToast();
  const mounted = useRef(true);
  const submitting = useRef(false);
  const readingRef = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [baseline, setBaseline, clearBaseline] = useDeliveryForm(requirement.projectId,requirement.id+':correction:baseline',()=>(requirement),!!recheck);
  const [draft, setDraft, clearDraft] = useDeliveryForm(requirement.projectId,requirement.id+':correction:draft',()=>(recheck?.draft || requirementInfoDraft(requirement)),!!recheck);
  const [reason, setReason, clearReason] = useDeliveryForm(requirement.projectId,requirement.id+':correction:reason',()=>(recheck?.reason || ""),!!recheck);
  const [supersedesId, setSupersedesId, clearSupersedesId] = useDeliveryForm(requirement.projectId,requirement.id+':correction:supersedesId',()=>(recheck?.supersedesId || ""),!!recheck);
  const [reading, setReading] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(recheck?.stage === "read");
  const [refreshed, setRefreshed] = useState(false);
  const [readError, setReadError] = useState<Error | null>(null);
  const unknownVersion = useRef<number | null>(recheck?.baselineVersion ?? null);
  const [reviewRequired, setReviewRequired] = useState(recheck?.stage === "review");
  const changed = requirement.version > baseline.version
    || (requirement.version === baseline.version && requirement.status !== baseline.status);
  const terminal = ["completed", "cancelled"].includes(baseline.status);
  const hasExecution = baseline.workItems.some((item) => item.status !== "not_started" || item.progress > 0 || item.actualStart);
  const eligiblePeople = people.filter(isAssignablePerson);
  const currentOwner = baseline.ownerId ? people.find((person) => person.id === baseline.ownerId) : undefined;
  const ownerOptions = currentOwner && !eligiblePeople.some((person) => person.id === currentOwner.id)
    ? [currentOwner, ...eligiblePeople]
    : eligiblePeople;
  const ownerUnavailable = Boolean(draft.ownerId && draft.ownerId !== baseline.ownerId && !ownerOptions.some((person) => person.id === draft.ownerId));
  const persistDraftIfLocked = (nextDraft: RequirementInfoDraft, nextReason = reason, nextSupersedesId = supersedesId) => {
    if (unknownVersion.current === null) return;
    onRecheckChange({
      baselineVersion: unknownVersion.current, draft: nextDraft, reason: nextReason, supersedesId: nextSupersedesId,
      stage: reviewRequired ? "review" : "read",
    });
  };
  const change = (field: keyof RequirementInfoDraft, value: string | ReferenceLink[]) => {
    const next = { ...draft, [field]: value,...field==='featureId'?{phaseId:''}:{} };
    setDraft(next);
    persistDraftIfLocked(next);
  };
  const normalizedDraft = () => ({featureId:draft.featureId||null,phaseId:draft.phaseId||null,
    title: canonicalizeLabel(draft.title),
    ownerId: draft.ownerId || null,
    background: canonicalizeContent(draft.background) || null,
    acceptanceCriteria: canonicalizeContent(draft.acceptanceCriteria) || null,
    referenceUrl: canonicalizeContent(draft.referenceUrl) || null, ...(draft.referenceLinks!==undefined?{referenceLinks:draft.referenceLinks}:{}),
  });
  const informationChanged = (() => {
    const value = normalizedDraft();
    return value.phaseId!==(baseline.phaseId||null)||value.featureId!==(baseline.featureId||null)||value.title !== baseline.title || value.ownerId !== (baseline.ownerId || null)
      || value.background !== (baseline.background || null) || value.acceptanceCriteria !== (baseline.acceptanceCriteria || null)
      || value.referenceUrl !== (baseline.referenceUrl || null) || (value.referenceLinks!==undefined && JSON.stringify(value.referenceLinks)!==JSON.stringify(readReferenceLinks(baseline.referenceLinks,baseline.referenceUrl)));
  })();
  const read = async () => {
    if (readingRef.current) return null;
    readingRef.current = true; setReading(true); setNeedsRefresh(true); setReadError(null);
    try {
      const latest = await readResourceFresh<Requirement>(client, keys.requirement(requirement.id), signal => requirementsApi.requirementsById<Requirement>(requirement.id, { signal }), () => mounted.current);
      if (!mounted.current) return null;
      const previousDraft=requirementInfoDraft(baseline),latestDraft=requirementInfoDraft(latest);
      const changedFields=new Set(requirementInfoFields.filter(field=>draft[field]!==undefined&&JSON.stringify(draft[field])!==JSON.stringify(previousDraft[field])));
      if(changedFields.has('featureId'))changedFields.add('phaseId');
      const mergedDraft={...draft};
      for(const field of requirementInfoFields)
        if(!changedFields.has(field))Object.assign(mergedDraft,{[field]:latestDraft[field]});
      if(changedFields.has('referenceUrl')&&draft.referenceLinks===undefined)
        mergedDraft.referenceLinks=requirementReferenceLinks({referenceUrl:draft.referenceUrl},latest);
      setDraft(mergedDraft);
      if (unknownVersion.current !== null) {
        const requiresReview = versionedWriteOutcome(unknownVersion.current, latest.version) === 'conflict';
        setReviewRequired(requiresReview);
        setUnknown(requiresReview);
        if (requiresReview) onRecheckChange({
          baselineVersion: unknownVersion.current, draft:mergedDraft, reason, supersedesId, stage: "review",
        });
        else {
          unknownVersion.current = null;
          onRecheckChange(null);
        }
      }
      setBaseline(latest); setNeedsRefresh(false); setRefreshed(true);
      return latest;
    } catch (caught) {
      if (!mounted.current) return null;
      const failure = caught instanceof Error ? caught : new Error("需求读取失败");
      setReadError(failure);
      if (failure instanceof ResourceReadInvalidatedError) setNeedsRefresh(true);
      if (failure instanceof ApiError && [401, 403, 404].includes(failure.status)) client.setQueryData(keys.requirement(requirement.id), null);
      return null;
    } finally {
      readingRef.current = false;
      if (mounted.current) setReading(false);
    }
  };
  type CorrectionMutation = {
    body: Record<string, unknown>;
  };
  const mutation = useMutation({
    mutationFn: ({ body }: CorrectionMutation) => requirementsApi.requirementsCorrect<Requirement>(requirement.id, { method: "POST", body: jsonBody(body) }),
    onMutate: ({ body }) => {
      const baselineVersion = Number(body.expectedVersion || baseline.version);
      unknownVersion.current = baselineVersion;
      onRecheckChange({ baselineVersion, draft, reason, supersedesId, stage: "read" });
    },
    onSuccess: () => {
      unknownVersion.current = null;
      onRecheckChange(null);
      invalidateRequirementViews(client, requirement.id);
      toast.success("需求纠错已记录");
      clearBaseline();clearDraft();clearReason();clearSupersedesId();onClose();
    },
    onError:async error=>{
      if(isWriteOutcomeUnknown(error))setUnknown(true);
      else { unknownVersion.current = null; onRecheckChange(null); }
      if(requiresWriteRecheck(error)){await read();}
    },
    onSettled: () => { submitting.current = false; },
  });
  const historyOptions = useMemo(() => (baseline.progressUpdates || []).filter(update => !update.workItemId)
    .map(update => <option value={update.id} key={update.id}>{progressReferenceLabel(update)} · {update.content}</option>), [baseline.progressUpdates]);
  const validation = !canonicalizeLabel(draft.title) ? "需求标题不能为空。"
    : hasExecution && !draft.ownerId ? "需求已有执行记录，负责人不能清空。"
    : ownerUnavailable ? "所选负责人已不可用，请重新选择。"
    : !informationChanged && !supersedesId ? "请至少修改一项需求信息，或关联一条需要更正的历史记录。" : "";
  const pending = mutation.isPending || reading;
  const blocked = unknown || pending || changed || needsRefresh || reviewRequired || !terminal || Boolean(validation);
  const close = () => { if (!submitting.current && !readingRef.current) onClose(); };
  const finishReview = () => {
    unknownVersion.current = null;
    onRecheckChange(null);
    setUnknown(false);
    setReviewRequired(false);
    onClose();
  };
  return <Modal title="需求纠错" closable={!pending} onClose={close}><form onSubmit={(event) => {
    event.preventDefault();
    if (submitting.current || blocked) return;
    submitting.current = true;
    mutation.mutate({
      body: {
        ...draft,featureId:draft.featureId||null,phaseId:draft.phaseId||null,
        ...(draft.ownerId !== (baseline.ownerId || "") ? { ownerId: draft.ownerId || null } : { ownerId: undefined }),
        expectedVersion: baseline.version,
        reason: reason.trim(),
        supersedesId: supersedesId || null,
      },
    });
  }}>
    <fieldset className="form-grid form-fieldset" disabled={pending}>
      <p className="field-help field-full">仅修正需求基本信息，不改变状态、进度、完成记录、排期或流程；系统会追加纠错记录。</p>
      <FormField label="需求标题" full><input aria-label="纠错后的需求标题" value={draft.title} onChange={(event) => change("title", event.target.value)} required autoFocus /></FormField>

      <OrganizationFields projectId={requirement.projectId} featureId={draft.featureId} phaseId={draft.phaseId} onChange={change}/>
      <FormField label="需求负责人"><Select aria-label="纠错后的需求负责人" value={draft.ownerId} required={hasExecution} onChange={(event) => change("ownerId", event.target.value)}>
        <option value="" disabled={hasExecution}>{hasExecution ? "负责人缺失，请选择" : "待指定"}</option>
        {baseline.ownerId && !ownerOptions.some((person) => person.id === baseline.ownerId) && <option value={baseline.ownerId}>{baseline.ownerName || "历史负责人"} · 历史负责人</option>}
        {ownerOptions.map((person) => <option value={person.id} key={person.id} disabled={!isAssignablePerson(person)}>{person.name}{person.jobTitle ? ` · ${person.jobTitle}` : ""}{person === currentOwner && !eligiblePeople.includes(person) ? " · 历史负责人" : ""}</option>)}
      </Select></FormField>
      <FormField label="需求背景（可选）" full><textarea aria-label="纠错后的需求背景" rows={3} value={draft.background} onChange={(event) => change("background", event.target.value)} /></FormField>
      <FormField label="完成标准（可选）" full><textarea aria-label="纠错后的完成标准" rows={3} value={draft.acceptanceCriteria} onChange={(event) => change("acceptanceCriteria", event.target.value)} /></FormField>
      <ReferenceLinksEditor value={draft.referenceLinks??requirementReferenceLinks({referenceUrl:draft.referenceUrl},baseline)} onChange={links=>change("referenceLinks",links)}/>
      {!!historyOptions.length && <FormField label="关联历史记录（可选）" full><Select aria-label="需求纠错关联历史记录" value={supersedesId} onChange={(event) => {const value=event.target.value;setSupersedesId(value);persistDraftIfLocked(draft,reason,value);}}><option value="">不指定</option>{historyOptions}</Select></FormField>}
      <FormField label="纠错说明（可选）" full><textarea aria-label="需求纠错原因" rows={2} value={reason} onChange={(event) => {const value=event.target.value;setReason(value);persistDraftIfLocked(draft,value);}} placeholder="说明原信息哪里有误，以及核对依据" /></FormField>
      {unknown&&!reviewRequired&&<FormError>刚才的提交结果待核对。输入已保留，请核对当前资料与操作记录；本窗口不会重复提交。</FormError>}<FormError>{mutation.error?.message}</FormError>
      {reviewRequired && <div className="warning-banner field-full">提交结果待核对；当前版本已变化。本窗口不再提交。请核对当前资料与纠错记录，已填内容保留。<Button variant="secondary" type="button" className="ghost-button" onClick={finishReview}>已核对并关闭</Button></div>}
      <FormError>{validation}</FormError>
      <FormError>{changed ? "需求已更新，请重新读取并核对；已保留你的输入。" : undefined}</FormError>
      <FormError>{!terminal ? "需求状态已变化，当前不能使用终态纠错。" : undefined}</FormError>
      {readError && <FormError>{readError.message}</FormError>}
      {refreshed && <p className="field-help field-full">已读取最新需求（版本 {baseline.version}），保留已修改的输入，请核对后重试。</p>}
      {(changed || needsRefresh) && <div className="field-full"><Button variant="secondary" type="button" className="ghost-button" disabled={pending} onClick={() => void read()}>重新读取需求</Button></div>}
      <FormSubmitActions submitLabel="保存纠错" onCancel={()=>{clearBaseline();clearDraft();clearReason();clearSupersedesId();close();}} pending={pending} disabled={blocked} />
    </fieldset>
  </form></Modal>;
}
