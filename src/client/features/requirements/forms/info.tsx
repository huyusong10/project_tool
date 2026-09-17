import { versionedWriteOutcome } from "../../../core/write-recheck";
import { readRecheck, persistRecheck } from "../../../core/write-recheck";
import * as requirementsApi from "../api";

import { ReferenceLinksEditor } from "../../../components/ReferenceLinks";
import { requirementReferenceLinks, type ReferenceLink } from "../../../../shared/reference-links";
import { Button } from "../../../components/Button";
import { Select } from "../../../components/Select";
import { assertCleanRequirementDraft } from "../../../use-graph-draft";
import { useSession } from "../../../app-context";
import { useDeliveryForm } from "../../../use-delivery-form";
import { migrateFeatureFields } from "../../../feature-storage-migration";
import { OrganizationFields } from '../../../components/RequirementIntake';
import { isAssignablePerson } from "../../../assignable-people";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { ApiError, isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from "../../../api";
import { invalidateRequirementViews, keys } from "../../../query-keys";
import { readResourceFresh, ResourceReadInvalidatedError } from "../../../use-resource-query";
import type { Person, Requirement } from "../../../types";
import { Modal } from "../../../components/Modal";
import { FormError, FormField, FormSubmitActions } from "../../../components/Form";

import { type RequirementInfoDraft, requirementInfoFields, requirementInfoDraft } from './model';

export type RequirementInfoRecheck = {
  baselineVersion: number;
  draft: RequirementInfoDraft;
  dirtyFields: Array<keyof RequirementInfoDraft>;
  stage: "read" | "review";
};

export function requirementInfoRecheckKey(accountKey: string, requirementId: string) {
  return `project-manage:requirement-info-recheck:${accountKey}:${requirementId}`;
}

export function readRequirementInfoRecheck(accountKey: string, requirementId: string): RequirementInfoRecheck | null {
  return readRecheck(requirementInfoRecheckKey(accountKey, requirementId), stored => {


    const value = migrateFeatureFields(stored) as Partial<RequirementInfoRecheck>;
    if(value.draft)value.draft.phaseId??="";
    const draft = value.draft as Partial<RequirementInfoDraft> | undefined;
    if (!Number.isSafeInteger(value.baselineVersion) || Number(value.baselineVersion) < 1
      || !draft || requirementInfoFields.some((field) => field==='referenceLinks'?draft.referenceLinks!==undefined&&!Array.isArray(draft.referenceLinks):typeof draft[field] !== "string")
      || !Array.isArray(value.dirtyFields) || value.dirtyFields.some((field) => !requirementInfoFields.includes(field))
      || value.stage !== "read" && value.stage !== "review") return null;
    return {
      baselineVersion: Number(value.baselineVersion),
      draft: draft as RequirementInfoDraft,
      dirtyFields: [...new Set(value.dirtyFields)],
      stage: value.stage,
    };

  });
}

export function persistRequirementInfoRecheck(accountKey: string, requirementId: string, value: RequirementInfoRecheck | null) {
  persistRecheck(requirementInfoRecheckKey(accountKey, requirementId), value);
}

export function RequirementInfoForm({
  requirement,
  people,
  recheck,
  onRecheckChange,
  onClose,
}: {
  requirement: Requirement;
  people: Person[];
  recheck: RequirementInfoRecheck | null;
  onRecheckChange: (value: RequirementInfoRecheck | null) => void;
  onClose: () => void;
}) {
  const {session}=useSession();
  const [unknown,setUnknown]=useState(Boolean(recheck));
  const client = useQueryClient();
  const submitting = useRef(false);
  const readingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [local,setLocal,clearLocal]=useDeliveryForm(requirement.projectId,requirement.id+':info',()=>({baseline:requirement,draft:recheck?.draft||requirementInfoDraft(requirement),dirty:recheck?.dirtyFields||[]}),!!recheck);
  const [baseRequirement, setBaseRequirement] = useState(local.baseline);
  const [draft, setDraft] = useState(local.draft);
  const dirtyFields = useRef(new Set<keyof RequirementInfoDraft>(local.dirty));
  useEffect(()=>setLocal({baseline:baseRequirement,draft,dirty:[...dirtyFields.current]}),[baseRequirement,draft,setLocal]);
  const [reading, setReading] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(recheck?.stage === "read");
  const [refreshed, setRefreshed] = useState(false);
  const [readError, setReadError] = useState<Error | null>(null);
  const unknownVersion = useRef<number | null>(recheck?.baselineVersion ?? null);
  const [reviewRequired, setReviewRequired] = useState(recheck?.stage === "review");
  const knownPeople = useRef(new Map(people.map((person) => [person.id, person.name])));
  for (const person of people) knownPeople.current.set(person.id, person.name);
  const changed = requirement.version > baseRequirement.version
    || (requirement.version === baseRequirement.version && requirement.status !== baseRequirement.status);
  useEffect(() => {
    if (dirtyFields.current.size || readingRef.current || requirement.version < baseRequirement.version) return;
    setBaseRequirement(requirement);
    setDraft(requirementInfoDraft(requirement));
  }, [baseRequirement.version, requirement]);
  const current = requirement.version > baseRequirement.version ? requirement : baseRequirement;
  const hasExecution = current.workItems.some((item) => item.status !== "not_started" || item.progress > 0 || item.actualStart);
  const historical = ["completed","cancelled"].includes(current.status);
  const eligiblePeople = people.filter(p=>historical?p.projectRole!=="viewer":isAssignablePerson(p));
  const currentOwner = baseRequirement.ownerId ? people.find((person) => person.id === baseRequirement.ownerId) : undefined;
  const draftOwner = draft.ownerId ? people.find((person) => person.id === draft.ownerId) : undefined;
  const ownerOptions = currentOwner && !eligiblePeople.some((person) => person.id === currentOwner.id)
    ? [currentOwner, ...eligiblePeople]
    : eligiblePeople;
  const draftOwnerUnavailable = Boolean(draft.ownerId && draft.ownerId !== baseRequirement.ownerId && !ownerOptions.some((person) => person.id === draft.ownerId));
  const change = (field: keyof RequirementInfoDraft, value: string | ReferenceLink[]) => {
    dirtyFields.current.add(field);if(field==='featureId')dirtyFields.current.add('phaseId');
    const next = { ...draft, [field]: value,...field==='featureId'?{phaseId:''}:{} };
    setDraft(next);
    if (unknownVersion.current !== null) onRecheckChange({
      baselineVersion: unknownVersion.current,
      draft: next,
      dirtyFields: [...dirtyFields.current],
      stage: reviewRequired ? "review" : "read",
    });
  };
  const read = async () => {
    if (readingRef.current) return null;
    readingRef.current = true; setReading(true); setNeedsRefresh(true); setReadError(null);
    try {
      const latest = await readResourceFresh<Requirement>(client, keys.requirement(requirement.id), signal => requirementsApi.requirementsById<Requirement>(requirement.id, { signal }), () => mounted.current);
      if (!mounted.current) return null;
      const latestDraft = requirementInfoDraft(latest);
      const mergedDraft = Object.fromEntries(Object.entries(latestDraft).map(([field, value]) => [
        field, dirtyFields.current.has(field as keyof RequirementInfoDraft) ? draft[field as keyof RequirementInfoDraft] : value,
      ])) as RequirementInfoDraft;
      if(dirtyFields.current.has('referenceUrl')&&!dirtyFields.current.has('referenceLinks'))mergedDraft.referenceLinks=requirementReferenceLinks({referenceUrl:draft.referenceUrl},latest);
      setDraft({...mergedDraft,reason:draft.reason});
      if (unknownVersion.current !== null) {
        const requiresReview = versionedWriteOutcome(unknownVersion.current, latest.version) === 'conflict';
        setReviewRequired(requiresReview);
        setUnknown(requiresReview);
        if (requiresReview) onRecheckChange({
          baselineVersion: unknownVersion.current,
          draft: mergedDraft,
          dirtyFields: [...dirtyFields.current],
          stage: "review",
        });
        else {
          unknownVersion.current = null;
          onRecheckChange(null);
        }
      }
      setBaseRequirement(latest); setNeedsRefresh(false); setRefreshed(true);
      return latest;
    } catch (caught) {
      if (!mounted.current) return;
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
  const mutation = useMutation({
    mutationFn: async (value: object) => {await assertCleanRequirementDraft(session.accountId||session.username||'guest',requirement.id,{action:draft.phaseId!==(baseRequirement.phaseId||'')||draft.featureId!==(baseRequirement.featureId||'')?'phase':'edit'});return requirementsApi.requirementsById(requirement.id, { method: "PATCH", body: jsonBody(value) });},
    onMutate: (value) => {
      const baselineVersion = Number((value as { expectedVersion?: number }).expectedVersion || baseRequirement.version);
      unknownVersion.current = baselineVersion;
      onRecheckChange({ baselineVersion, draft, dirtyFields: [...dirtyFields.current], stage: "read" });
    },
    onSuccess: () => {
      unknownVersion.current = null;
      clearLocal();onRecheckChange(null);
      invalidateRequirementViews(client, requirement.id);
      onClose();
    },
    onError:async error=>{
      if(isWriteOutcomeUnknown(error))setUnknown(true);
      else { unknownVersion.current = null; onRecheckChange(null); }
      if(requiresWriteRecheck(error)){await read();}
    },
    onSettled: () => { submitting.current = false; },
  });
  const blocked = unknown || changed || needsRefresh || reviewRequired || draftOwnerUnavailable;
  const pending = mutation.isPending || reading;
  const finishReview = () => {
    unknownVersion.current = null;
    onRecheckChange(null);
    setUnknown(false);
    setReviewRequired(false);
    onClose();
  };
  return <Modal title="编辑需求信息" closable={!pending} onClose={() => { if (!submitting.current && !readingRef.current) onClose(); }}><form onSubmit={(event) => {
    event.preventDefault();
    if (submitting.current || blocked) return;
    submitting.current = true;
    mutation.mutate({
      ...draft,featureId:draft.featureId||null,phaseId:draft.phaseId||null,
      ...(draft.ownerId !== (baseRequirement.ownerId || "") ? { ownerId: draft.ownerId || null } : { ownerId: undefined }),
      expectedVersion: baseRequirement.version,
    });
  }}>
    <fieldset className="form-grid form-fieldset" disabled={pending}>
    <FormField label="需求标题" full><input name="title" value={draft.title} onChange={(event) => change("title", event.target.value)} required autoFocus /></FormField>
    <OrganizationFields projectId={requirement.projectId} featureId={draft.featureId} phaseId={draft.phaseId} onChange={change}/>{(draft.phaseId!==(baseRequirement.phaseId||'')||draft.featureId!==(baseRequirement.featureId||''))&&<FormField label="归属调整原因" full><textarea maxLength={2000} value={draft.reason||""} onChange={e=>setDraft({...draft,reason:e.target.value})}/></FormField>}
    <p className="field-help">处理优先级按风险和依赖自动计算。</p>
    <FormField label="需求负责人"><Select value={draft.ownerId} required={hasExecution} onChange={(event) => change("ownerId", event.target.value)}>
      <option value="" disabled={hasExecution}>{hasExecution ? "负责人缺失，请选择" : "待指定"}</option>
      {baseRequirement.ownerId && !ownerOptions.some((person) => person.id === baseRequirement.ownerId) && <option value={baseRequirement.ownerId}>{baseRequirement.ownerName || "历史负责人"} · 历史负责人</option>}
      {draft.ownerId && draft.ownerId !== baseRequirement.ownerId && !ownerOptions.some((person) => person.id === draft.ownerId) && <option value={draft.ownerId}>{draftOwner?.name || knownPeople.current.get(draft.ownerId) || "已选择负责人"} · 已不可用，请重新选择</option>}
      {ownerOptions.map((person) => <option value={person.id} key={person.id} disabled={!historical&&!isAssignablePerson(person)}>{person.name}{person.jobTitle ? ` · ${person.jobTitle}` : ""}{person === currentOwner && !eligiblePeople.includes(person) ? " · 历史负责人" : ""}</option>)}
    </Select></FormField>
    {hasExecution && <p className="field-help field-full">需求已开始执行，负责人可以更换但不能清空。</p>}
    <FormField label="需求背景（可选）" full><textarea name="background" rows={3} value={draft.background} onChange={(event) => change("background", event.target.value)} /></FormField>
    <FormField label="完成标准（可选）" full><textarea name="acceptanceCriteria" rows={3} value={draft.acceptanceCriteria} onChange={(event) => change("acceptanceCriteria", event.target.value)} /></FormField>
    <ReferenceLinksEditor value={draft.referenceLinks??requirementReferenceLinks({referenceUrl:draft.referenceUrl},baseRequirement)} onChange={links=>change("referenceLinks",links)}/>
    {unknown&&!reviewRequired&&<FormError>刚才的提交结果待核对。输入已保留，请核对当前资料与操作记录；本窗口不会重复提交。</FormError>}<FormError>{mutation.error?.message}</FormError>
    {reviewRequired && <div className="warning-banner field-full">提交结果待核对；当前版本已变化。本窗口不再提交。请核对当前资料与操作记录，已填内容保留。<Button variant="secondary" type="button" className="ghost-button" onClick={finishReview}>已核对并关闭</Button></div>}
    <FormError>{changed ? "需求已更新，请重新读取并核对；已保留你的输入。" : undefined}</FormError>
    <FormError>{draftOwnerUnavailable ? "所选负责人已不可用，请重新选择。" : undefined}</FormError>

    {refreshed && <p className="field-help field-full">已读取最新需求；未修改字段已同步，已输入内容保持不变。当前：{baseRequirement.title} · {baseRequirement.processingPriority||'待评估'} · 负责人 {baseRequirement.ownerName || "未指定"}</p>}
    {readError && <FormError>{readError.message}</FormError>}
    {(changed || needsRefresh) && <div className="field-full"><Button variant="secondary" type="button" className="ghost-button" disabled={pending} onClick={() => void read()}>重新读取需求</Button></div>}
    <FormSubmitActions submitLabel="保存信息" onCancel={()=>{clearLocal();onClose();}} pending={pending} disabled={blocked} />
    </fieldset>
  </form></Modal>;
}
