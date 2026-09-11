import {OrganizationFields} from './RequirementIntake';
import {isAssignablePerson} from '../assignable-people';
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, WandSparkles } from "lucide-react";
import { api, ApiError, isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from "../api";
import { invalidateRequirementViews, keys } from "../query-keys";
import { readResourceFresh, ResourceReadInvalidatedError } from "../use-resource-query";
import type { Person, PlanPreview, Requirement, WorkItemTemplate } from "../types";
import { ConfirmDialog, Modal } from "./Modal";
import { FormError, FormField, FormSubmitActions } from "./Form";
import { useToast } from "./Toast";
import { canonicalizeContent, canonicalizeLabel } from "../../shared/search";

export type RequirementInfoDraft = {
  groupId:string;
  title: string; ownerId: string; background: string; acceptanceCriteria: string; referenceUrl: string;
};

const requirementInfoFields: Array<keyof RequirementInfoDraft> = ["groupId", "title", "ownerId", "background", "acceptanceCriteria", "referenceUrl"];
export type RequirementInfoRecheck = {
  baselineVersion: number;
  draft: RequirementInfoDraft;
  dirtyFields: Array<keyof RequirementInfoDraft>;
  stage: "read" | "review";
};

function requirementInfoRecheckKey(accountKey: string, requirementId: string) {
  return `project-manage:requirement-info-recheck:${accountKey}:${requirementId}`;
}

export function readRequirementInfoRecheck(accountKey: string, requirementId: string): RequirementInfoRecheck | null {
  try {
    const raw = sessionStorage.getItem(requirementInfoRecheckKey(accountKey, requirementId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<RequirementInfoRecheck>;
    const draft = value.draft as Partial<RequirementInfoDraft> | undefined;
    if (!Number.isSafeInteger(value.baselineVersion) || Number(value.baselineVersion) < 1
      || !draft || requirementInfoFields.some((field) => typeof draft[field] !== "string")
      || !Array.isArray(value.dirtyFields) || value.dirtyFields.some((field) => !requirementInfoFields.includes(field))
      || value.stage !== "read" && value.stage !== "review") return null;
    return {
      baselineVersion: Number(value.baselineVersion),
      draft: draft as RequirementInfoDraft,
      dirtyFields: [...new Set(value.dirtyFields)],
      stage: value.stage,
    };
  } catch { return null; }
}

export function persistRequirementInfoRecheck(accountKey: string, requirementId: string, value: RequirementInfoRecheck | null) {
  try {
    const key = requirementInfoRecheckKey(accountKey, requirementId);
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch { /* 当前页面仍保留核对锁。 */ }
}

function requirementInfoDraft(requirement: Requirement): RequirementInfoDraft {
  return {
    groupId:requirement.groupId||'',
    title: requirement.title, ownerId: requirement.ownerId || "",
    background: requirement.background || "", acceptanceCriteria: requirement.acceptanceCriteria || "",
    referenceUrl: requirement.referenceUrl || "",
  };
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
  const [unknown,setUnknown]=useState(Boolean(recheck));
  const client = useQueryClient();
  const submitting = useRef(false);
  const readingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [baseRequirement, setBaseRequirement] = useState(requirement);
  const [draft, setDraft] = useState(() => recheck?.draft || requirementInfoDraft(requirement));
  const dirtyFields = useRef(new Set<keyof RequirementInfoDraft>(recheck?.dirtyFields || []));
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
  const eligiblePeople = people.filter(isAssignablePerson);
  const currentOwner = baseRequirement.ownerId ? people.find((person) => person.id === baseRequirement.ownerId) : undefined;
  const draftOwner = draft.ownerId ? people.find((person) => person.id === draft.ownerId) : undefined;
  const ownerOptions = currentOwner && !eligiblePeople.some((person) => person.id === currentOwner.id)
    ? [currentOwner, ...eligiblePeople]
    : eligiblePeople;
  const draftOwnerUnavailable = Boolean(draft.ownerId && draft.ownerId !== baseRequirement.ownerId && !ownerOptions.some((person) => person.id === draft.ownerId));
  const change = (field: keyof RequirementInfoDraft, value: string) => {
    dirtyFields.current.add(field);
    const next = { ...draft, [field]: value };
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
      const latest = await readResourceFresh<Requirement>(client, keys.requirement(requirement.id), `/api/requirements/${requirement.id}`, () => mounted.current);
      if (!mounted.current) return null;
      const latestDraft = requirementInfoDraft(latest);
      const mergedDraft = Object.fromEntries(Object.entries(latestDraft).map(([field, value]) => [
        field, dirtyFields.current.has(field as keyof RequirementInfoDraft) ? draft[field as keyof RequirementInfoDraft] : value,
      ])) as RequirementInfoDraft;
      setDraft(mergedDraft);
      if (unknownVersion.current !== null) {
        const requiresReview = latest.version !== unknownVersion.current;
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
    mutationFn: (value: object) => api(`/api/requirements/${requirement.id}`, { method: "PATCH", body: jsonBody(value) }),
    onMutate: (value) => {
      const baselineVersion = Number((value as { expectedVersion?: number }).expectedVersion || baseRequirement.version);
      unknownVersion.current = baselineVersion;
      onRecheckChange({ baselineVersion, draft, dirtyFields: [...dirtyFields.current], stage: "read" });
    },
    onSuccess: () => {
      unknownVersion.current = null;
      onRecheckChange(null);
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
  const locked = ["completed", "cancelled"].includes(current.status);
  const blocked = unknown || changed || needsRefresh || reviewRequired || locked || draftOwnerUnavailable;
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
      ...draft,groupId:draft.groupId||null,
      ...(draft.ownerId !== (baseRequirement.ownerId || "") ? { ownerId: draft.ownerId || null } : { ownerId: undefined }),
      expectedVersion: baseRequirement.version,
    });
  }}>
    <fieldset className="form-grid form-fieldset" disabled={pending}>
    <FormField label="需求标题" full><input name="title" value={draft.title} onChange={(event) => change("title", event.target.value)} required autoFocus /></FormField>
    <OrganizationFields projectId={requirement.projectId} groupId={draft.groupId} onChange={change}/>
    <p className="field-help">处理优先级按风险和依赖自动计算。</p>
    <FormField label="需求负责人"><select value={draft.ownerId} required={hasExecution} onChange={(event) => change("ownerId", event.target.value)}>
      <option value="" disabled={hasExecution}>{hasExecution ? "负责人缺失，请选择" : "待指定"}</option>
      {baseRequirement.ownerId && !ownerOptions.some((person) => person.id === baseRequirement.ownerId) && <option value={baseRequirement.ownerId}>{baseRequirement.ownerName || "历史负责人"} · 历史负责人</option>}
      {draft.ownerId && draft.ownerId !== baseRequirement.ownerId && !ownerOptions.some((person) => person.id === draft.ownerId) && <option value={draft.ownerId}>{draftOwner?.name || knownPeople.current.get(draft.ownerId) || "已选择负责人"} · 已不可用，请重新选择</option>}
      {ownerOptions.map((person) => <option value={person.id} key={person.id} disabled={!isAssignablePerson(person)}>{person.name}{person.jobTitle ? ` · ${person.jobTitle}` : ""}{person === currentOwner && !eligiblePeople.includes(person) ? " · 历史负责人" : ""}</option>)}
    </select></FormField>
    {hasExecution && <p className="field-help field-full">需求已开始执行，负责人可以更换但不能清空。</p>}
    <FormField label="需求背景（可选）" full><textarea name="background" rows={3} value={draft.background} onChange={(event) => change("background", event.target.value)} /></FormField>
    <FormField label="完成标准（可选）" full><textarea name="acceptanceCriteria" rows={3} value={draft.acceptanceCriteria} onChange={(event) => change("acceptanceCriteria", event.target.value)} /></FormField>
    <FormField label="参考链接（可选）" full><input name="referenceUrl" type="url" value={draft.referenceUrl} onChange={(event) => change("referenceUrl", event.target.value)} placeholder="https://…" /></FormField>
    {unknown&&!reviewRequired&&<FormError>刚才的提交结果待核对。输入已保留，请核对当前资料与操作记录；本窗口不会重复提交。</FormError>}<FormError>{mutation.error?.message}</FormError>
    {reviewRequired && <div className="warning-banner field-full">提交结果待核对；当前版本已变化。本窗口不再提交。请核对当前资料与操作记录，已填内容保留。<button type="button" className="ghost-button" onClick={finishReview}>已核对并关闭</button></div>}
    <FormError>{changed ? "需求已更新，请重新读取并核对；已保留你的输入。" : undefined}</FormError>
    <FormError>{draftOwnerUnavailable ? "所选负责人已不可用，请重新选择。" : undefined}</FormError>
    <FormError>{locked ? "需求已完成或取消，不能继续编辑信息。" : undefined}</FormError>
    {refreshed && <p className="field-help field-full">已读取最新需求；未修改字段已同步，已输入内容保持不变。当前：{baseRequirement.title} · {baseRequirement.processingPriority||'待评估'} · 负责人 {baseRequirement.ownerName || "未指定"}</p>}
    {readError && <FormError>{readError.message}</FormError>}
    {(changed || needsRefresh) && <div className="field-full"><button type="button" className="ghost-button" disabled={pending} onClick={() => void read()}>重新读取需求</button></div>}
    <FormSubmitActions submitLabel="保存信息" onCancel={onClose} pending={pending} disabled={blocked} />
    </fieldset>
  </form></Modal>;
}

export type RequirementCorrectionRecheck = {
  baselineVersion: number;
  draft: RequirementInfoDraft;
  reason: string;
  supersedesId: string;
  stage: "read" | "review";
};

function requirementCorrectionRecheckKey(accountKey: string, requirementId: string) {
  return `project-manage:requirement-correction-recheck:${accountKey}:${requirementId}`;
}

export function readRequirementCorrectionRecheck(accountKey: string, requirementId: string): RequirementCorrectionRecheck | null {
  try {
    const raw = sessionStorage.getItem(requirementCorrectionRecheckKey(accountKey, requirementId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<RequirementCorrectionRecheck>;
    const draft = value.draft as Partial<RequirementInfoDraft> | undefined;
    if (!Number.isSafeInteger(value.baselineVersion) || Number(value.baselineVersion) < 1
      || !draft || requirementInfoFields.some((field) => typeof draft[field] !== "string")
      || typeof value.reason !== "string" || typeof value.supersedesId !== "string"
      || value.stage !== "read" && value.stage !== "review") return null;
    return {
      baselineVersion: Number(value.baselineVersion), draft: draft as RequirementInfoDraft,
      reason: value.reason, supersedesId: value.supersedesId, stage: value.stage,
    };
  } catch { return null; }
}

export function persistRequirementCorrectionRecheck(accountKey: string, requirementId: string, value: RequirementCorrectionRecheck | null) {
  try {
    const key = requirementCorrectionRecheckKey(accountKey, requirementId);
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch { /* 当前页面仍保留核对锁。 */ }
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
  const [baseline, setBaseline] = useState(requirement);
  const [draft, setDraft] = useState(() => recheck?.draft || requirementInfoDraft(requirement));
  const [reason, setReason] = useState(recheck?.reason || "");
  const [supersedesId, setSupersedesId] = useState(recheck?.supersedesId || "");
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
  const change = (field: keyof RequirementInfoDraft, value: string) => {
    const next = { ...draft, [field]: value };
    setDraft(next);
    persistDraftIfLocked(next);
  };
  const normalizedDraft = () => ({groupId:draft.groupId||null,
    title: canonicalizeLabel(draft.title),
    ownerId: draft.ownerId || null,
    background: canonicalizeContent(draft.background) || null,
    acceptanceCriteria: canonicalizeContent(draft.acceptanceCriteria) || null,
    referenceUrl: canonicalizeContent(draft.referenceUrl) || null,
  });
  const informationChanged = (() => {
    const value = normalizedDraft();
    return value.groupId!==(baseline.groupId||null)||value.title !== baseline.title || value.ownerId !== (baseline.ownerId || null)
      || value.background !== (baseline.background || null) || value.acceptanceCriteria !== (baseline.acceptanceCriteria || null)
      || value.referenceUrl !== (baseline.referenceUrl || null);
  })();
  const read = async () => {
    if (readingRef.current) return null;
    readingRef.current = true; setReading(true); setNeedsRefresh(true); setReadError(null);
    try {
      const latest = await readResourceFresh<Requirement>(client, keys.requirement(requirement.id), `/api/requirements/${requirement.id}`, () => mounted.current);
      if (!mounted.current) return null;
      if (unknownVersion.current !== null) {
        const requiresReview = latest.version !== unknownVersion.current;
        setReviewRequired(requiresReview);
        setUnknown(requiresReview);
        if (requiresReview) onRecheckChange({
          baselineVersion: unknownVersion.current, draft, reason, supersedesId, stage: "review",
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
    mutationFn: ({ body }: CorrectionMutation) => api<Requirement>(`/api/requirements/${requirement.id}/correct`, { method: "POST", body: jsonBody(body) }),
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
      onClose();
    },
    onError:async error=>{
      if(isWriteOutcomeUnknown(error))setUnknown(true);
      else { unknownVersion.current = null; onRecheckChange(null); }
      if(requiresWriteRecheck(error)){await read();}
    },
    onSettled: () => { submitting.current = false; },
  });
  const candidates = (baseline.progressUpdates || []).filter((update) => !update.workItemId);
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
  return <Modal title="需求受控纠错" closable={!pending} onClose={close}><form onSubmit={(event) => {
    event.preventDefault();
    if (submitting.current || blocked) return;
    submitting.current = true;
    mutation.mutate({
      body: {
        ...draft,groupId:draft.groupId||null,
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

      <OrganizationFields projectId={requirement.projectId} groupId={draft.groupId} onChange={change}/>
      <FormField label="需求负责人"><select aria-label="纠错后的需求负责人" value={draft.ownerId} required={hasExecution} onChange={(event) => change("ownerId", event.target.value)}>
        <option value="" disabled={hasExecution}>{hasExecution ? "负责人缺失，请选择" : "待指定"}</option>
        {baseline.ownerId && !ownerOptions.some((person) => person.id === baseline.ownerId) && <option value={baseline.ownerId}>{baseline.ownerName || "历史负责人"} · 历史负责人</option>}
        {ownerOptions.map((person) => <option value={person.id} key={person.id} disabled={!isAssignablePerson(person)}>{person.name}{person.jobTitle ? ` · ${person.jobTitle}` : ""}{person === currentOwner && !eligiblePeople.includes(person) ? " · 历史负责人" : ""}</option>)}
      </select></FormField>
      <FormField label="需求背景（可选）" full><textarea aria-label="纠错后的需求背景" rows={3} value={draft.background} onChange={(event) => change("background", event.target.value)} /></FormField>
      <FormField label="完成标准（可选）" full><textarea aria-label="纠错后的完成标准" rows={3} value={draft.acceptanceCriteria} onChange={(event) => change("acceptanceCriteria", event.target.value)} /></FormField>
      <FormField label="参考链接（可选）" full><input aria-label="纠错后的参考链接" type="url" value={draft.referenceUrl} onChange={(event) => change("referenceUrl", event.target.value)} placeholder="https://…" /></FormField>
      {!!candidates.length && <FormField label="关联历史记录（可选）" full><select aria-label="需求纠错关联历史记录" value={supersedesId} onChange={(event) => {const value=event.target.value;setSupersedesId(value);persistDraftIfLocked(draft,reason,value);}}><option value="">不指定</option>{candidates.map((update) => <option value={update.id} key={update.id}>{new Date(update.createdAt).toLocaleDateString("zh-CN")} · {update.content.slice(0, 36)}</option>)}</select></FormField>}
      <FormField label="纠错说明（可选）" full><textarea aria-label="需求纠错原因" rows={2} value={reason} onChange={(event) => {const value=event.target.value;setReason(value);persistDraftIfLocked(draft,value);}} placeholder="说明原信息哪里有误，以及核对依据" /></FormField>
      {unknown&&!reviewRequired&&<FormError>刚才的提交结果待核对。输入已保留，请核对当前资料与操作记录；本窗口不会重复提交。</FormError>}<FormError>{mutation.error?.message}</FormError>
      {reviewRequired && <div className="warning-banner field-full">提交结果待核对；当前版本已变化。本窗口不再提交。请核对当前资料与纠错记录，已填内容保留。<button type="button" className="ghost-button" onClick={finishReview}>已核对并关闭</button></div>}
      <FormError>{validation}</FormError>
      <FormError>{changed ? "需求已更新，请重新读取并核对；已保留你的输入。" : undefined}</FormError>
      <FormError>{!terminal ? "需求状态已变化，当前不能使用终态纠错。" : undefined}</FormError>
      {readError && <FormError>{readError.message}</FormError>}
      {refreshed && <p className="field-help field-full">已读取最新需求（版本 {baseline.version}），本次输入保持不变，请核对后重试。</p>}
      {(changed || needsRefresh) && <div className="field-full"><button type="button" className="ghost-button" disabled={pending} onClick={() => void read()}>重新读取需求</button></div>}
      <FormSubmitActions submitLabel="保存纠错" onCancel={close} pending={pending} disabled={blocked} />
    </fieldset>
  </form></Modal>;
}

type ScheduleChange = {
  endpoint: "reschedule" | "reselect-template";
  input: {
    scheduleMode: "start" | "deadline";
    plannedStart?: string;
    plannedEnd?: string;
    expectedVersion: number;
    templateId?: string;
    confirmTemplateReset?: boolean;
    reason?: string;
  };
  templateName: string;
};

type RequirementScheduleDirtyField = "template" | "mode" | "date" | "reason";
type RequirementScheduleDraft = {
  templateId: string;
  scheduleMode: "start" | "deadline";
  scheduleDate: string;
  reason: string;
};
export type RequirementScheduleRecheck = {
  baselineVersion: number;
  draft: RequirementScheduleDraft;
  dirtyFields: RequirementScheduleDirtyField[];
  stage: "read" | "review";
};
const requirementScheduleDirtyFields: RequirementScheduleDirtyField[] = ["template", "mode", "date", "reason"];

function requirementScheduleRecheckKey(accountKey: string, requirementId: string) {
  return `project-manage:requirement-schedule-recheck:${accountKey}:${requirementId}`;
}

export function readRequirementScheduleRecheck(accountKey: string, requirementId: string): RequirementScheduleRecheck | null {
  try {
    const raw = sessionStorage.getItem(requirementScheduleRecheckKey(accountKey, requirementId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<RequirementScheduleRecheck>;
    const draft = value.draft as Partial<RequirementScheduleDraft> | undefined;
    if (!Number.isSafeInteger(value.baselineVersion) || Number(value.baselineVersion) < 1
      || !draft || typeof draft.templateId !== "string" || !["start", "deadline"].includes(String(draft.scheduleMode))
      || typeof draft.scheduleDate !== "string" || typeof draft.reason !== "string"
      || !Array.isArray(value.dirtyFields) || value.dirtyFields.some((field) => !requirementScheduleDirtyFields.includes(field))
      || value.stage !== "read" && value.stage !== "review") return null;
    return {
      baselineVersion: Number(value.baselineVersion),
      draft: draft as RequirementScheduleDraft,
      dirtyFields: [...new Set(value.dirtyFields)],
      stage: value.stage,
    };
  } catch { return null; }
}

export function persistRequirementScheduleRecheck(accountKey: string, requirementId: string, value: RequirementScheduleRecheck | null) {
  try {
    const key = requirementScheduleRecheckKey(accountKey, requirementId);
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch { /* 当前页面仍保留核对锁。 */ }
}

export function RequirementScheduleForm({
  requirement,
  recheck,
  onRecheckChange,
  onClose,
}: {
  requirement: Requirement;
  recheck: RequirementScheduleRecheck | null;
  onRecheckChange: (value: RequirementScheduleRecheck | null) => void;
  onClose: () => void;
}) {
  const [unknown,setUnknown]=useState(Boolean(recheck));
  const client = useQueryClient();
  const submitting = useRef(false);
  const readingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [baseRequirement, setBaseRequirement] = useState(requirement);
  const [needsRefresh, setNeedsRefresh] = useState(recheck?.stage === "read");
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<Error | null>(null);
  const [refreshed, setRefreshed] = useState(false);
  const dirtyFields = useRef(new Set<RequirementScheduleDirtyField>(recheck?.dirtyFields || []));
  const templatesQuery = useQuery({
    queryKey: [...keys.templates, requirement.projectId],
    queryFn: ({ signal }) => api<WorkItemTemplate[]>(`/api/templates?projectId=${encodeURIComponent(requirement.projectId)}`, { signal }),
  });
  const templates = templatesQuery.data || [];
  const knownTemplates = useRef(new Map<string, string>(requirement.templateId && requirement.templateName ? [[requirement.templateId, requirement.templateName]] : []));
  for (const template of templates) knownTemplates.current.set(template.id, template.name);
  const [templateId, setTemplateId] = useState(recheck?.draft.templateId ?? requirement.templateId ?? "");
  const [scheduleMode, setScheduleMode] = useState<"start" | "deadline">(recheck?.draft.scheduleMode || "start");
  const [pendingSubmit, setPendingSubmit] = useState<ScheduleChange | null>(null);
  const [scheduleDate, setScheduleDate] = useState(recheck?.draft.scheduleDate ?? requirement.plannedStart ?? "");
  const [reason, setReason] = useState(recheck?.draft.reason || "");
  const unknownVersion = useRef<number | null>(recheck?.baselineVersion ?? null);
  const [reviewRequired, setReviewRequired] = useState(recheck?.stage === "review");
  const currentDraft = (overrides: Partial<RequirementScheduleDraft> = {}): RequirementScheduleDraft => ({
    templateId, scheduleMode, scheduleDate, reason, ...overrides,
  });
  const persistDraftIfLocked = (next: RequirementScheduleDraft) => {
    if (unknownVersion.current === null) return;
    onRecheckChange({
      baselineVersion: unknownVersion.current,
      draft: next,
      dirtyFields: [...dirtyFields.current],
      stage: reviewRequired ? "review" : "read",
    });
  };
  const changed = requirement.version > baseRequirement.version
    || (requirement.version === baseRequirement.version && requirement.status !== baseRequirement.status);
  useEffect(() => {
    if (dirtyFields.current.size || readingRef.current || requirement.version < baseRequirement.version || !changed) return;
    setBaseRequirement(requirement);
    setTemplateId(requirement.templateId || "");
    setScheduleMode("start");
    setScheduleDate(requirement.plannedStart || "");
    setReason("");
    setNeedsRefresh(false);
    setReadError(null);
  }, [baseRequirement.version, changed, requirement]);
  const templateChanged = Boolean(templateId && templateId !== baseRequirement.templateId);
  const selectedTemplateUnavailable = Boolean(templateChanged && templatesQuery.data && !templates.some((template) => template.id === templateId));
  const current = requirement.version > baseRequirement.version ? requirement : baseRequirement;
  const locked = ["pending_acceptance", "completed", "cancelled"].includes(current.status);
  const read = async () => {
    if (readingRef.current) return null;
    readingRef.current = true; setReading(true); setNeedsRefresh(true); setReadError(null);
    try {
      const latest = await readResourceFresh<Requirement>(client, keys.requirement(requirement.id), `/api/requirements/${requirement.id}`, () => mounted.current);
      if (!mounted.current) return null;
      const fields = dirtyFields.current;
      const nextMode = fields.has("mode") ? scheduleMode : "start";
      const nextTemplateId = fields.has("template") ? templateId : latest.templateId || "";
      const nextDate = fields.has("date") ? scheduleDate : (nextMode === "start" ? latest.plannedStart : latest.plannedEnd) || "";
      const nextReason = fields.has("reason") ? reason : "";
      const nextDraft = { templateId: nextTemplateId, scheduleMode: nextMode, scheduleDate: nextDate, reason: nextReason };
      setTemplateId(nextTemplateId);
      setScheduleDate(nextDate);
      setReason(nextReason);
      setScheduleMode(nextMode);
      if (unknownVersion.current !== null) {
        const requiresReview = latest.version !== unknownVersion.current;
        setReviewRequired(requiresReview);
        setUnknown(requiresReview);
        if (requiresReview) onRecheckChange({
          baselineVersion: unknownVersion.current,
          draft: nextDraft,
          dirtyFields: [...dirtyFields.current],
          stage: "review",
        });
        else {
          unknownVersion.current = null;
          onRecheckChange(null);
        }
      }
      setBaseRequirement(latest);
      setNeedsRefresh(false);
      setRefreshed(true);
      return latest;
    } catch (caught) {
      if (!mounted.current) return;
      const failure = caught instanceof Error ? caught : new Error("当前计划加载失败");
      setReadError(failure);
      if (failure instanceof ResourceReadInvalidatedError) setNeedsRefresh(true);
      if (failure instanceof ApiError && [401, 403, 404].includes(failure.status)) client.setQueryData(keys.requirement(requirement.id), null);
      return null;
    } finally {
      readingRef.current = false;
      if (mounted.current) setReading(false);
    }
  };
  const reload = async () => {
    if (submitting.current || readingRef.current) return;
    submitting.current = true;
    try { await read(); }
    finally { submitting.current = false; }
  };
  const mutation = useMutation({
    mutationFn: (change: ScheduleChange) =>
      api(`/api/requirements/${requirement.id}/${change.endpoint}`, {
        method: "POST",
        body: jsonBody(change.input),
      }),
    onMutate: (change) => {
      unknownVersion.current = change.input.expectedVersion;
      onRecheckChange({
        baselineVersion: change.input.expectedVersion,
        draft: currentDraft(),
        dirtyFields: [...dirtyFields.current],
        stage: "read",
      });
    },
    onSuccess: () => {
      unknownVersion.current = null;
      onRecheckChange(null);
      setPendingSubmit(null);
      invalidateRequirementViews(client, requirement.id);
      onClose();
    },
    onError:async error=>{
      if(isWriteOutcomeUnknown(error))setUnknown(true);
      else { unknownVersion.current = null; onRecheckChange(null); }
      if(requiresWriteRecheck(error)){setPendingSubmit(null);await read();}
    },
    onSettled: () => { submitting.current = false; },
  });
  const pending = mutation.isPending || reading;
  const submit = (change: ScheduleChange) => {
    if (submitting.current || unknown || changed || needsRefresh || locked || selectedTemplateUnavailable) return;
    submitting.current = true;
    mutation.mutate(change);
  };
  const switchMode = (mode: "start" | "deadline") => {
    if (submitting.current || unknown || pendingSubmit || mode === scheduleMode) return;
    if (mode === "start") dirtyFields.current.delete("mode");
    else dirtyFields.current.add("mode");
    dirtyFields.current.delete("date");
    const nextDate = (mode === "start" ? baseRequirement.plannedStart : baseRequirement.plannedEnd) || "";
    setScheduleMode(mode);
    setScheduleDate(nextDate);
    persistDraftIfLocked(currentDraft({ scheduleMode: mode, scheduleDate: nextDate }));
  };
  const finishReview = () => {
    unknownVersion.current = null;
    onRecheckChange(null);
    setUnknown(false);
    setReviewRequired(false);
    onClose();
  };
  return <>
    <Modal title="调整需求计划" closable={!pending && !pendingSubmit} onClose={() => { if (!submitting.current && !pendingSubmit) onClose(); }}>
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (submitting.current || unknown || pendingSubmit || changed || needsRefresh || locked || selectedTemplateUnavailable) return;
        const change: ScheduleChange = {
          endpoint: templateChanged ? "reselect-template" : "reschedule",
          templateName: templates.find((template) => template.id === templateId)?.name || baseRequirement.templateName || "未绑定",
          input: {
            scheduleMode,
            ...(scheduleMode === "start" ? { plannedStart: scheduleDate } : { plannedEnd: scheduleDate }),
            expectedVersion: baseRequirement.version,
            ...((!!baseRequirement.actualStart||baseRequirement.workItems.some((item) => item.status !== "not_started")) ? { reason } : {}),
            ...(templateChanged ? { templateId, confirmTemplateReset: true } : {}),
          },
        };
        if (templateChanged) { mutation.reset(); setPendingSubmit(change); return; }
        submit(change);
      }}
    >
      <fieldset className="form-grid form-fieldset" disabled={pending || Boolean(pendingSubmit)}>
      <p className="field-help field-full">当前流程：{baseRequirement.templateName || "未绑定"}<br />当前计划：{baseRequirement.plannedStart || "未填写"} → {baseRequirement.plannedEnd || "未填写"}</p>
      <FormField label="排期方式" full asLabel={false}>
        <div className="schedule-mode-switch" role="radiogroup" aria-label="排期方式">
          <button type="button" className={scheduleMode === "start" ? "is-active" : ""} role="radio" aria-checked={scheduleMode === "start"} onClick={() => switchMode("start")}>
            <strong>按开始日期正排</strong>
            <small>{baseRequirement.executionMode==='direct'?"按预计工期计算需求计划，保留实际日期":baseRequirement.workItems.length ? "整体平移现有工作项，以选定日期开始" : "按当前流程生成工作项和计划"}</small>
          </button>
          <button type="button" className={scheduleMode === "deadline" ? "is-active" : ""} role="radio" aria-checked={scheduleMode === "deadline"} onClick={() => switchMode("deadline")}>
            <strong>按截止日期倒排</strong>
            <small>{baseRequirement.executionMode==='direct'?"以选定日期完成，按预计工期反推开始":baseRequirement.workItems.length ? "整体平移现有工作项，以选定日期结束" : "按当前流程倒排生成工作项和计划"}</small>
          </button>
        </div>
      </FormField>
      <FormField label={scheduleMode === "start" ? "计划开始" : "计划完成"} full className="schedule-date-field">
        <input
          key={scheduleMode}
          name={scheduleMode === "start" ? "plannedStart" : "plannedEnd"}
          type="date"
          required
          value={scheduleDate}
          onChange={(event) => {
            const value = event.target.value;
            const original = (scheduleMode === "start" ? baseRequirement.plannedStart : baseRequirement.plannedEnd) || "";
            if (value === original) dirtyFields.current.delete("date"); else dirtyFields.current.add("date");
            setScheduleDate(value);
            persistDraftIfLocked(currentDraft({ scheduleDate: value }));
          }}
        />
      </FormField>
      {baseRequirement.executionMode!=='direct'&&<FormField label="绑定流程" full>
        <select value={templateId} disabled={!templatesQuery.data} onChange={(event) => {
          const value = event.target.value;
          if (value === (baseRequirement.templateId || "")) dirtyFields.current.delete("template"); else dirtyFields.current.add("template");
          setTemplateId(value);
          persistDraftIfLocked(currentDraft({ templateId: value }));
        }}>
          {!baseRequirement.templateId && <option value="">未绑定（保持现有工作项）</option>}
          {baseRequirement.templateId && !templates.some((template) => template.id === baseRequirement.templateId) && <option value={baseRequirement.templateId}>{baseRequirement.templateName || "原流程"}（{templatesQuery.isLoading ? "正在加载" : templatesQuery.error ? "暂不可用" : "已归档"}）</option>}
          {templateChanged && !templates.some((template) => template.id === templateId) && <option value={templateId}>{knownTemplates.current.get(templateId) || "已选择流程"}（已不可用，请重新选择）</option>}
          {templates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}
        </select>
      </FormField>
      }{templatesQuery.error && <div className="warning-banner field-full">流程列表加载失败，当前只能调整日期，不能切换流程。<button type="button" className="ghost-button" disabled={templatesQuery.isFetching} onClick={() => void templatesQuery.refetch()}>重新加载</button></div>}
      {templateChanged && <p className="template-reset-warning field-full"><AlertTriangle size={16} />切换后会替换未执行工作项并按新流程重新排期；需求级说明保留。</p>}
      {(!!baseRequirement.actualStart||baseRequirement.workItems.some((item) => item.status !== "not_started")) && <FormField label="补充说明（可选）" full><textarea name="reason" rows={2} value={reason} onChange={(event) => {
        const value = event.target.value;
        if (value) dirtyFields.current.add("reason"); else dirtyFields.current.delete("reason");
        setReason(value);
        persistDraftIfLocked(currentDraft({ reason: value }));
      }} placeholder="可补充排期调整的背景" /></FormField>}
      <></><p className="field-help field-full">{baseRequirement.executionMode==='direct'?"保存需求计划日期；预计工期未知时保留未确定的一端。":baseRequirement.workItems.length
        ? "修改日期会整体平移已有工作项，保留相对间隔、人员和实际日期；每个工作项仍可单独修改自定义计划。"
        : "保存后按当前流程生成工作项；需求负责人与全部排期就绪后自动进入未开始。"} 流程设计后续变更不会同步到当前需求。</p>
      {unknown&&!reviewRequired&&<FormError>刚才的提交结果待核对。输入已保留，请核对当前资料与操作记录；本窗口不会重复提交。</FormError>}<FormError>{mutation.error?.message}</FormError>
      {reviewRequired && <div className="warning-banner field-full">提交结果待核对；当前版本已变化。本窗口不再提交。请核对需求与全部工作项日期，已填内容保留。<button type="button" className="ghost-button" onClick={finishReview}>已核对并关闭</button></div>}
      <FormError>{readError?.message}</FormError>
      {changed && <FormError>需求计划已在其他位置更新，请重新加载；已修改的排期草稿会保留。</FormError>}
      {selectedTemplateUnavailable && <FormError>所选流程已不可用，请重新选择后保存。</FormError>}
      {locked && <FormError>需求已完成或取消，不能继续调整计划。</FormError>}
      {refreshed && <p className="field-help field-full">已读取最新计划；未修改字段已同步，已输入内容保持不变。</p>}
      {(changed || needsRefresh) && <div className="field-full"><button type="button" className="ghost-button" disabled={pending} onClick={() => void reload()}>重新加载当前计划</button></div>}
      <FormSubmitActions submitLabel="保存排期" onCancel={onClose} pending={pending} disabled={unknown || changed || needsRefresh || reviewRequired || locked || selectedTemplateUnavailable} />
      </fieldset>
    </form>
    </Modal>
    {pendingSubmit && <ConfirmDialog title="切换需求流程" description={<>
      <p>目标流程：{pendingSubmit.templateName}<br />{pendingSubmit.input.scheduleMode === "start" ? "计划开始" : "计划完成"}：{pendingSubmit.input.plannedStart || pendingSubmit.input.plannedEnd}</p>
      <p>切换流程会替换当前未执行工作项、人员分配和计划，并按新流程重新生成；需求级说明将保留。</p>
    </>} confirmLabel="确认切换" pendingLabel="切换中…" danger pending={pending} disabled={unknown || changed || needsRefresh || locked || selectedTemplateUnavailable} error={changed ? "需求计划已更新，请取消后重新加载当前计划。" : locked ? "需求已完成或取消，不能继续调整计划。" : selectedTemplateUnavailable ? "所选流程已不可用，请取消后重新选择。" : mutation.error?.message} onClose={() => { if (!submitting.current) setPendingSubmit(null); }} onConfirm={() => submit(pendingSubmit)} />}
  </>;
}

type RequirementPlanDraft = { templateId: string; baseStart: string; reason: string };
export type RequirementPlanRecheck = {
  baselineVersion: number;
  draft: RequirementPlanDraft;
  stage: "read" | "review";
};

function requirementPlanRecheckKey(accountKey: string, requirementId: string) {
  return `project-manage:requirement-plan-recheck:${accountKey}:${requirementId}`;
}

export function readRequirementPlanRecheck(accountKey: string, requirementId: string): RequirementPlanRecheck | null {
  try {
    const raw = sessionStorage.getItem(requirementPlanRecheckKey(accountKey, requirementId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<RequirementPlanRecheck>;
    const draft = value.draft as Partial<RequirementPlanDraft> | undefined;
    if (!Number.isSafeInteger(value.baselineVersion) || Number(value.baselineVersion) < 1
      || !draft || typeof draft.templateId !== "string" || typeof draft.baseStart !== "string" || typeof draft.reason !== "string"
      || value.stage !== "read" && value.stage !== "review") return null;
    return { baselineVersion: Number(value.baselineVersion), draft: draft as RequirementPlanDraft, stage: value.stage };
  } catch { return null; }
}

export function persistRequirementPlanRecheck(accountKey: string, requirementId: string, value: RequirementPlanRecheck | null) {
  try {
    const key = requirementPlanRecheckKey(accountKey, requirementId);
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch { /* 当前页面仍保留核对锁。 */ }
}

export function PlanForm({ requirement, templates, recheck, onRecheckChange, onClose }: {
  requirement: Requirement;
  templates: WorkItemTemplate[];
  recheck: RequirementPlanRecheck | null;
  onRecheckChange: (value: RequirementPlanRecheck | null) => void;
  onClose: () => void;
}) {
  const [unknown,setUnknown]=useState(Boolean(recheck));
  const client = useQueryClient();
  const submitting = useRef(false);
  const readingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const knownTemplates = useRef(new Map(templates.map((template) => [template.id, template.name])));
  for (const template of templates) knownTemplates.current.set(template.id, template.name);
  const [templateId, setTemplateId] = useState(recheck?.draft.templateId ?? requirement.templateId ?? templates[0]?.id ?? "");
  const [baseStart, setBaseStart] = useState(recheck?.draft.baseStart ?? requirement.plannedStart ?? "");
  const [reason, setReason] = useState(recheck?.draft.reason || "");
  const [reading, setReading] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(recheck?.stage === "read");
  const [readError, setReadError] = useState<Error | null>(null);
  const unknownVersion = useRef<number | null>(recheck?.baselineVersion ?? null);
  const [reviewRequired, setReviewRequired] = useState(recheck?.stage === "review");
  const hasExecution = requirement.workItems.some((item) => item.status !== "not_started");
  const [preview, setPreview] = useState<PlanPreview>();
  const [previewTemplateUpdatedAt, setPreviewTemplateUpdatedAt] = useState<string | null>(null);
  useEffect(() => {
    if (!templateId && templates[0]) setTemplateId(templates[0].id);
  }, [templateId, templates]);
  const previewMutation = useMutation({
    mutationFn: ({ templateUpdatedAt: _templateUpdatedAt, ...input }: { templateId: string; baseStart: string; templateUpdatedAt: string | null }) => api<PlanPreview>(`/api/requirements/${requirement.id}/plan-preview`, {
      method: "POST", readOnly: true, body: jsonBody(input),
    }),
    onSuccess: (result, input) => {
      setPreview(result);
      setPreviewTemplateUpdatedAt(input.templateUpdatedAt);
    },
    onSettled: () => { submitting.current = false; },
  });
  const draft = (overrides: Partial<RequirementPlanDraft> = {}): RequirementPlanDraft => ({ templateId, baseStart, reason, ...overrides });
  const persistDraftIfLocked = (next: RequirementPlanDraft) => {
    if (unknownVersion.current === null) return;
    onRecheckChange({ baselineVersion: unknownVersion.current, draft: next, stage: reviewRequired ? "review" : "read" });
  };
  const readLatest = async () => {
    if (readingRef.current) return null;
    readingRef.current = true; setReading(true); setNeedsRefresh(true); setReadError(null);
    try {
      const latest = await readResourceFresh<Requirement>(client, keys.requirement(requirement.id), `/api/requirements/${requirement.id}`, () => mounted.current);
      if (!mounted.current) return null;
      if (unknownVersion.current !== null) {
        const requiresReview = latest.version !== unknownVersion.current;
        setReviewRequired(requiresReview);
        setUnknown(requiresReview);
        if (requiresReview) onRecheckChange({ baselineVersion: unknownVersion.current, draft: draft(), stage: "review" });
        else {
          unknownVersion.current = null;
          onRecheckChange(null);
        }
      }
      setNeedsRefresh(false);
      return latest;
    } catch (caught) {
      if (mounted.current) setReadError(caught instanceof Error ? caught : new Error("当前需求加载失败"));
      return null;
    } finally {
      readingRef.current = false;
      if (mounted.current) setReading(false);
    }
  };
  const applyMutation = useMutation({
    mutationFn: ({ preview: confirmed, reason: explanation }: { preview: PlanPreview; reason: string }) => api(`/api/requirements/${confirmed.requirementId}/apply-plan`, {
      method: "POST",
      body: jsonBody({ templateId: confirmed.templateId, baseStart: confirmed.baseStart, expectedVersion: confirmed.requirementVersion, previewToken: confirmed.previewToken, reason: explanation.trim() || undefined, templateItemIds: confirmed.entries.filter((item) => item.willChange).map((item) => item.templateItemId) }),
    }),
    onMutate: ({ preview: confirmed }) => {
      unknownVersion.current = confirmed.requirementVersion;
      onRecheckChange({ baselineVersion: confirmed.requirementVersion, draft: draft(), stage: "read" });
    },
    onSuccess: (_, input) => {
      unknownVersion.current = null;
      onRecheckChange(null);
      invalidateRequirementViews(client, input.preview.requirementId);
      onClose();
    },
    onError:async error=>{
      if(isWriteOutcomeUnknown(error))setUnknown(true);
      else { unknownVersion.current = null; onRecheckChange(null); }
      if(requiresWriteRecheck(error)){setPreview(undefined);await readLatest();invalidateRequirementViews(client,requirement.id);}
    },
    onSettled: () => { submitting.current = false; },
  });
  const pending = previewMutation.isPending || applyMutation.isPending || reading;
  const selectedTemplate = templates.find((template) => template.id === templateId);
  const selectedTemplateUnavailable = Boolean(templateId && !selectedTemplate);
  const locked = ["pending_acceptance", "completed", "cancelled"].includes(requirement.status);
  const requirementPreviewStale = Boolean(preview && requirement.version > preview.requirementVersion);
  const templatePreviewStale = Boolean(preview && previewTemplateUpdatedAt !== (selectedTemplate?.updatedAt || null));
  const previewStale = requirementPreviewStale || templatePreviewStale || locked;
  const invalidEntry = preview?.entries.find((item) => item.willChange && item.proposedStart > item.proposedEnd);
  const resetPreview = () => {
    if (submitting.current) return;
    setPreview(undefined);
    setPreviewTemplateUpdatedAt(null);
    previewMutation.reset();
    applyMutation.reset();
  };
  const finishReview = () => {
    unknownVersion.current = null;
    onRecheckChange(null);
    setUnknown(false);
    setReviewRequired(false);
    onClose();
  };
  return (
    <Modal title="按模板补全计划" width={840} closable={!pending} onClose={() => { if (!submitting.current) onClose(); }}>
    <fieldset className="plan-preview-form form-fieldset" disabled={pending}>
      <div className="form-grid">
        <FormField label="流程设计"><select value={templateId} onChange={(event) => { if (submitting.current) return; const value=event.target.value;setTemplateId(value);persistDraftIfLocked(draft({templateId:value}));resetPreview(); }}>{selectedTemplateUnavailable && <option value={templateId}>{knownTemplates.current.get(templateId) || "已选择流程"}（已不可用，请重新选择）</option>}{templates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}</select></FormField>
        <FormField label="计划开始"><input type="date" value={baseStart} onChange={(event) => { if (submitting.current) return; const value=event.target.value;setBaseStart(value);persistDraftIfLocked(draft({baseStart:value}));resetPreview(); }} /></FormField>
      </div>
      {hasExecution && <FormField label="补充说明（可选）" full><textarea rows={2} value={reason} onChange={(event) => {const value=event.target.value;setReason(value);persistDraftIfLocked(draft({reason:value}));}} placeholder="可补充排期调整的背景" /></FormField>}
      {!preview && <div className="form-actions"><button className="primary-button" disabled={unknown || needsRefresh || reviewRequired || locked || !templateId || !baseStart || selectedTemplateUnavailable} onClick={() => {
        if (submitting.current) return;
        submitting.current = true;
        applyMutation.reset();
        previewMutation.mutate({ templateId, baseStart, templateUpdatedAt: selectedTemplate?.updatedAt || null });
      }}><WandSparkles size={15} />生成差异预览</button></div>}
      {selectedTemplateUnavailable && <FormError full={false}>所选流程已不可用，请重新选择。</FormError>}
      {locked && <FormError full={false}>需求已完成或取消，不能继续补全计划。</FormError>}
      {unknown&&!reviewRequired&&<FormError full={false}>刚才的提交结果待核对，已填内容保留。请核对操作记录，本窗口不会重复提交。</FormError>}<FormError full={false}>{previewMutation.error?.message}</FormError>
      {reviewRequired && <div className="warning-banner">提交结果待核对；当前版本已变化。本窗口不再提交。请核对需求日期和全部变更项，已填内容保留。<button type="button" className="ghost-button" onClick={finishReview}>已核对并关闭</button></div>}
      {readError && <FormError full={false}>{readError.message}</FormError>}
      {needsRefresh && !reviewRequired && <div><button type="button" className="ghost-button" disabled={pending} onClick={() => void readLatest()}>{reading ? "读取中…" : "重新读取需求"}</button></div>}
      <FormError full={false}>{invalidEntry ? `工作项「${invalidEntry.title}」补全后的开始日期晚于完成日期，请调整计划开始或先编辑该工作项` : applyMutation.error?.message}</FormError>
      {preview && <>
        <></><div className="plan-preview-list">
          {preview.entries.map((item) => <div key={item.templateItemId} className={item.willChange ? "will-change" : "unchanged"}>
            <strong>{item.title}</strong><span>{item.currentStart || "空"} → {item.currentEnd || "空"}</span><b>→</b><span>{item.proposedStart} → {item.proposedEnd}</span><em>{item.reason === "missing_item" ? "新增" : item.reason === "missing_plan" ? "补空值" : item.reason === "terminal" ? "终态保留" : "保持"}</em>
          </div>)}
        </div>
        <p className="field-help">仅补充空日期或缺失工作项，已有计划和实际日期不会覆盖。</p>
        {requirementPreviewStale && <FormError full={false}>需求已更新，当前差异预览已失效，请重新预览。</FormError>}
        {templatePreviewStale && <FormError full={false}>流程设计已更新，当前差异预览已失效，请重新预览。</FormError>}
        <div className="form-actions"><button className="ghost-button" onClick={resetPreview}>重新预览</button><button className="primary-button" disabled={unknown || previewStale || selectedTemplateUnavailable || Boolean(invalidEntry) || !preview.entries.some((item) => item.willChange)} onClick={() => {
          if (submitting.current) return;
          submitting.current = true;
          applyMutation.mutate({ preview, reason });
        }}>确认补全</button></div>
      </>}
    </fieldset>
    </Modal>
  );
}
