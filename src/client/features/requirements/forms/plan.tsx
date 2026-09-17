import { versionedWriteOutcome } from "../../../core/write-recheck";
import { readRecheck, persistRecheck } from "../../../core/write-recheck";
import * as requirementsApi from "../api";

import { Button } from "../../../components/Button";
import { Select } from "../../../components/Select";

import { useDeliveryForm } from "../../../use-delivery-form";
import { migrateFeatureFields } from "../../../feature-storage-migration";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { WandSparkles } from "lucide-react";
import { isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from "../../../api";
import { invalidateRequirementViews, keys } from "../../../query-keys";
import { readResourceFresh } from "../../../use-resource-query";
import type { PlanPreview, Requirement, WorkItemTemplate } from "../../../types";
import { Modal } from "../../../components/Modal";
import { FormError, FormField } from "../../../components/Form";

export type RequirementPlanDraft = { templateId: string; baseStart: string; reason: string };

export type RequirementPlanRecheck = {
  baselineVersion: number;
  draft: RequirementPlanDraft;
  stage: "read" | "review";
};

export function requirementPlanRecheckKey(accountKey: string, requirementId: string) {
  return `project-manage:requirement-plan-recheck:${accountKey}:${requirementId}`;
}

export function readRequirementPlanRecheck(accountKey: string, requirementId: string): RequirementPlanRecheck | null {
  return readRecheck(requirementPlanRecheckKey(accountKey, requirementId), stored => {
    
    
    const value = migrateFeatureFields(stored) as Partial<RequirementPlanRecheck>;
    const draft = value.draft as Partial<RequirementPlanDraft> | undefined;
    if (!Number.isSafeInteger(value.baselineVersion) || Number(value.baselineVersion) < 1
      || !draft || typeof draft.templateId !== "string" || typeof draft.baseStart !== "string" || typeof draft.reason !== "string"
      || value.stage !== "read" && value.stage !== "review") return null;
    return { baselineVersion: Number(value.baselineVersion), draft: draft as RequirementPlanDraft, stage: value.stage };
  
  });
}

export function persistRequirementPlanRecheck(accountKey: string, requirementId: string, value: RequirementPlanRecheck | null) {
  persistRecheck(requirementPlanRecheckKey(accountKey, requirementId), value);
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
  const [templateId, setTemplateId, clearTemplateId] = useDeliveryForm(requirement.projectId,requirement.id+':plan:templateId',()=>(recheck?.draft.templateId ?? requirement.templateId ?? templates[0]?.id ?? ""),!!recheck);
  const [baseStart, setBaseStart, clearBaseStart] = useDeliveryForm(requirement.projectId,requirement.id+':plan:baseStart',()=>(recheck?.draft.baseStart ?? requirement.plannedStart ?? ""),!!recheck);
  const [reason, setReason, clearReason] = useDeliveryForm(requirement.projectId,requirement.id+':plan:reason',()=>(recheck?.draft.reason || ""),!!recheck);
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
  }, [templateId, templates,setTemplateId]);
  const previewMutation = useMutation({
    mutationFn: ({ templateUpdatedAt: _templateUpdatedAt, ...input }: { templateId: string; baseStart: string; templateUpdatedAt: string | null }) => requirementsApi.requirementsPlanPreview<PlanPreview>(requirement.id, {
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
      const latest = await readResourceFresh<Requirement>(client, keys.requirement(requirement.id), signal => requirementsApi.requirementsById<Requirement>(requirement.id, { signal }), () => mounted.current);
      if (!mounted.current) return null;
      if (unknownVersion.current !== null) {
        const requiresReview = versionedWriteOutcome(unknownVersion.current, latest.version) === 'conflict';
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
    mutationFn: ({ preview: confirmed, reason: explanation }: { preview: PlanPreview; reason: string }) => requirementsApi.requirementsApplyPlan(confirmed.requirementId, {
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
      clearTemplateId();clearBaseStart();clearReason();onClose();
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
      <div className="form-actions"><Button variant="secondary" onClick={()=>{clearTemplateId();clearBaseStart();clearReason();onClose();}}>取消编辑</Button></div>
      <div className="form-grid">
        <FormField label="流程设计"><Select value={templateId} onChange={(event) => { if (submitting.current) return; const value=event.target.value;setTemplateId(value);persistDraftIfLocked(draft({templateId:value}));resetPreview(); }}>{selectedTemplateUnavailable && <option value={templateId}>{knownTemplates.current.get(templateId) || "已选择流程"}（已不可用，请重新选择）</option>}{templates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}</Select></FormField>
        <FormField label="计划开始"><input type="date" value={baseStart} onChange={(event) => { if (submitting.current) return; const value=event.target.value;setBaseStart(value);persistDraftIfLocked(draft({baseStart:value}));resetPreview(); }} /></FormField>
      </div>
      {hasExecution && <FormField label="补充说明（可选）" full><textarea rows={2} value={reason} onChange={(event) => {const value=event.target.value;setReason(value);persistDraftIfLocked(draft({reason:value}));}} placeholder="可补充排期调整的背景" /></FormField>}
      {!preview && <div className="form-actions"><Button variant="primary" className="primary-button" disabled={unknown || needsRefresh || reviewRequired || locked || !templateId || !baseStart || selectedTemplateUnavailable} onClick={() => {
        if (submitting.current) return;
        submitting.current = true;
        applyMutation.reset();
        previewMutation.mutate({ templateId, baseStart, templateUpdatedAt: selectedTemplate?.updatedAt || null });
      }}><WandSparkles size={15} />生成差异预览</Button></div>}
      {selectedTemplateUnavailable && <FormError full={false}>所选流程已不可用，请重新选择。</FormError>}
      {locked && <FormError full={false}>需求已完成或取消，不能继续补全计划。</FormError>}
      {unknown&&!reviewRequired&&<FormError full={false}>刚才的提交结果待核对，已填内容保留。请核对操作记录，本窗口不会重复提交。</FormError>}<FormError full={false}>{previewMutation.error?.message}</FormError>
      {reviewRequired && <div className="warning-banner">提交结果待核对；当前版本已变化。本窗口不再提交。请核对需求日期和全部变更项，已填内容保留。<Button variant="secondary" type="button" className="ghost-button" onClick={finishReview}>已核对并关闭</Button></div>}
      {readError && <FormError full={false}>{readError.message}</FormError>}
      {needsRefresh && !reviewRequired && <div><Button busy={(reading)} aria-label={reading ? "读取中…" : "重新读取需求"} variant="secondary" type="button" className="ghost-button" disabled={pending} onClick={() => void readLatest()}>{"重新读取需求"}</Button></div>}
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
        <div className="form-actions"><Button variant="secondary" className="ghost-button" onClick={resetPreview}>重新预览</Button><Button variant="primary" className="primary-button" disabled={unknown || previewStale || selectedTemplateUnavailable || Boolean(invalidEntry) || !preview.entries.some((item) => item.willChange)} onClick={() => {
          if (submitting.current) return;
          submitting.current = true;
          applyMutation.mutate({ preview, reason });
        }}>确认补全</Button></div>
      </>}
    </fieldset>
    </Modal>
  );
}
