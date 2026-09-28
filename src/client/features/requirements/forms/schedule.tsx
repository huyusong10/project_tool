import { versionedWriteOutcome } from "../../../core/write-recheck";
import { readRecheck, persistRecheck } from "../../../core/write-recheck";
import * as requirementsApi from "../api";
import * as templatesApi from "../../templates/api";

import { Button } from "../../../components/Button";
import { Select } from "../../../components/Select";

import { useDeliveryForm } from "../../../use-delivery-form";
import { migrateFeatureFields } from "../../../feature-storage-migration";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { ApiError, isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from "../../../api";
import { invalidateRequirementViews, keys } from "../../../query-keys";
import { readResourceFresh, ResourceReadInvalidatedError } from "../../../use-resource-query";
import type { Requirement, WorkItemTemplate } from "../../../types";
import { ConfirmDialog, Modal } from "../../../components/Modal";
import { FormError, FormField, FormSubmitActions } from "../../../components/Form";
import { DirectRequirementSchedulePreview, RequirementSchedulePreview } from '../RequirementSchedulePreview';
import { RequirementPlanPreview } from '../RequirementPlanPreview';
import { useAppNavigate } from '../../../use-app-navigation';
import { workspaceParams } from '../../../workspace-location';

export type ScheduleChange = {
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

export type RequirementScheduleDirtyField = "template" | "mode" | "date" | "reason";

export type RequirementScheduleDraft = {
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

export const requirementScheduleDirtyFields: RequirementScheduleDirtyField[] = ["template", "mode", "date", "reason"];

export function requirementScheduleRecheckKey(accountKey: string, requirementId: string) {
  return `project-manage:requirement-schedule-recheck:${accountKey}:${requirementId}`;
}

export function readRequirementScheduleRecheck(accountKey: string, requirementId: string): RequirementScheduleRecheck | null {
  return readRecheck(requirementScheduleRecheckKey(accountKey, requirementId), stored => {


    const value = migrateFeatureFields(stored) as Partial<RequirementScheduleRecheck>;
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

  });
}

export function persistRequirementScheduleRecheck(accountKey: string, requirementId: string, value: RequirementScheduleRecheck | null) {
  persistRecheck(requirementScheduleRecheckKey(accountKey, requirementId), value);
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
  const navigate = useAppNavigate();
  const submitting = useRef(false);
  const readingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [baseRequirement, setBaseRequirement, clearBaseRequirement] = useDeliveryForm(requirement.projectId,requirement.id+':schedule:baseRequirement',()=>(requirement),!!recheck);
  const [needsRefresh, setNeedsRefresh] = useState(recheck?.stage === "read");
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<Error | null>(null);
  const [refreshed, setRefreshed] = useState(false);
  const [storedDirty,setStoredDirty,clearDirty]=useDeliveryForm<RequirementScheduleDirtyField[]>(requirement.projectId,requirement.id+':schedule:dirty',()=>recheck?.dirtyFields||[],!!recheck);
  const dirtyFields = useRef(new Set<RequirementScheduleDirtyField>(storedDirty));
  useEffect(()=>{const next=[...dirtyFields.current];if(next.join()!==storedDirty.join())setStoredDirty(next);});
  const templatesQuery = useQuery({
    queryKey: [...keys.templates, requirement.projectId],
    queryFn: ({ signal }) => templatesApi.templatesQuery<WorkItemTemplate[]>(encodeURIComponent(requirement.projectId), { signal }),
  });
  const templates = templatesQuery.data || [];
  const knownTemplates = useRef(new Map<string, string>(requirement.templateId && requirement.templateName ? [[requirement.templateId, requirement.templateName]] : []));
  for (const template of templates) knownTemplates.current.set(template.id, template.name);
  const [templateId, setTemplateId, clearTemplateId] = useDeliveryForm(requirement.projectId,requirement.id+':schedule:templateId',()=>(recheck?.draft.templateId ?? requirement.templateId ?? ""),!!recheck);
  const [scheduleMode, setScheduleMode, clearScheduleMode] = useDeliveryForm<"start" | "deadline">(requirement.projectId,requirement.id+':schedule:scheduleMode',()=>(recheck?.draft.scheduleMode || "start"),!!recheck);
  const [pendingSubmit, setPendingSubmit] = useState<ScheduleChange | null>(null);
  const [scheduleDate, setScheduleDate, clearScheduleDate] = useDeliveryForm(requirement.projectId,requirement.id+':schedule:scheduleDate',()=>(recheck?.draft.scheduleDate ?? requirement.plannedStart ?? ""),!!recheck);
  const [reason, setReason, clearReason] = useDeliveryForm(requirement.projectId,requirement.id+':schedule:reason',()=>(recheck?.draft.reason || ""),!!recheck);
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
  }, [baseRequirement.version, changed, requirement,setBaseRequirement,setTemplateId,setScheduleMode,setScheduleDate,setReason]);
  const templateChanged = Boolean(templateId && templateId !== baseRequirement.templateId);
  const selectedTemplateUnavailable = Boolean(templateChanged && templatesQuery.data && !templates.some((template) => template.id === templateId));
  const current = requirement.version > baseRequirement.version ? requirement : baseRequirement;
  const templateResetBlocked = templateChanged && (current.workItems.some(item => item.status !== 'not_started' || item.progress > 0 || item.actualStart)
    || current.progressUpdates?.some(update => !['note', 'correction'].includes(update.eventType)));
  const locked = ["pending_acceptance", "completed", "cancelled"].includes(current.status);
  const read = async () => {
    if (readingRef.current) return null;
    readingRef.current = true; setReading(true); setNeedsRefresh(true); setReadError(null);
    try {
      const latest = await readResourceFresh<Requirement>(client, keys.requirement(requirement.id), signal => requirementsApi.requirementsById<Requirement>(requirement.id, { signal }), () => mounted.current);
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
        const requiresReview = versionedWriteOutcome(unknownVersion.current, latest.version) === 'conflict';
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
      requirementsApi.requirementsById2(requirement.id, change.endpoint, {
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
      clearDirty();clearBaseRequirement();clearTemplateId();clearScheduleMode();clearScheduleDate();clearReason();onClose();
    },
    onError:async error=>{
      if(isWriteOutcomeUnknown(error))setUnknown(true);
      else { unknownVersion.current = null; onRecheckChange(null); }
      if(requiresWriteRecheck(error)){setPendingSubmit(null);await read();}
    },
    onSettled: () => { submitting.current = false; },
  });
  const pending = mutation.isPending || reading;
  const missingScheduleAnchor = !templateChanged && baseRequirement.workItems.length > 0
    && !(scheduleMode === 'start' ? baseRequirement.plannedStart : baseRequirement.plannedEnd);
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
        if (submitting.current || unknown || pendingSubmit || changed || needsRefresh || locked || selectedTemplateUnavailable || templateResetBlocked || missingScheduleAnchor) return;
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
      {missingScheduleAnchor && !changed && !needsRefresh && !unknown && !locked && <div className="warning-banner field-full">
        缺少原计划{scheduleMode === 'start' ? '开始' : '完成'}日期，暂时不能整体平移。可按依赖生成未开始工作的计划，也可在工作项中逐项填写。
        <Button variant="secondary" type="button" className="ghost-button" onClick={() => {
          onClose();
          navigate('/?' + workspaceParams({projectId:requirement.projectId,view:'graph',scope:{kind:'requirement',id:requirement.id}},undefined,new URLSearchParams({pathPanel:'schedule',pathInspector:'closed',graphInspector:'closed'})));
        }}>按依赖预览排期</Button>
      </div>}
      <FormField label="排期方式" full asLabel={false}>
        <div className="schedule-mode-switch" role="radiogroup" aria-label="排期方式">
          <button type="button" className={scheduleMode === "start" ? "is-active" : ""} role="radio" aria-checked={scheduleMode === "start"} onClick={() => switchMode("start")}>
            <strong>按开始日期正排</strong>
            <small>{templateChanged ? "按新流程生成工作项，以选定日期开始" : baseRequirement.executionMode==='direct'?"工期已知时计算完成日期，否则保留原完成日期":baseRequirement.workItems.length ? "整体平移现有工作项，以选定日期开始" : "按当前流程生成工作项和计划"}</small>
          </button>
          <button type="button" className={scheduleMode === "deadline" ? "is-active" : ""} role="radio" aria-checked={scheduleMode === "deadline"} onClick={() => switchMode("deadline")}>
            <strong>按截止日期倒排</strong>
            <small>{templateChanged ? "按新流程生成工作项，以选定日期结束" : baseRequirement.executionMode==='direct'?"工期已知时计算开始日期，否则保留原开始日期":baseRequirement.workItems.length ? "整体平移现有工作项，以选定日期结束" : "按当前流程倒排生成工作项和计划"}</small>
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
        <Select value={templateId} disabled={!templatesQuery.data} onChange={(event) => {
          const value = event.target.value;
          if (value === (baseRequirement.templateId || "")) dirtyFields.current.delete("template"); else dirtyFields.current.add("template");
          setTemplateId(value);
          persistDraftIfLocked(currentDraft({ templateId: value }));
        }}>
          {!baseRequirement.templateId && <option value="">未绑定（保持现有工作项）</option>}
          {baseRequirement.templateId && !templates.some((template) => template.id === baseRequirement.templateId) && <option value={baseRequirement.templateId}>{baseRequirement.templateName || "原流程"}（{templatesQuery.isLoading ? "正在加载" : templatesQuery.error ? "暂不可用" : "已归档"}）</option>}
          {templateChanged && !templates.some((template) => template.id === templateId) && <option value={templateId}>{knownTemplates.current.get(templateId) || "已选择流程"}（已不可用，请重新选择）</option>}
          {templates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}
        </Select>
      </FormField>
      }{templatesQuery.error && <div className="warning-banner field-full">流程列表加载失败，当前只能调整日期，不能切换流程。<Button variant="secondary" type="button" className="ghost-button" disabled={templatesQuery.isFetching} onClick={() => void templatesQuery.refetch()}>重新加载</Button></div>}
      {templateChanged && !templateResetBlocked && <p className="template-reset-warning field-full"><AlertTriangle size={16} />切换后会替换未执行工作项并按新流程重新排期；需求级说明保留。</p>}
      {templateResetBlocked && <FormError>需求已有执行记录，不能切换流程。选择原流程后仍可调整日期。</FormError>}
      {templateChanged && !templateResetBlocked && !changed && !needsRefresh && !unknown && <RequirementPlanPreview projectId={requirement.projectId} featureId={baseRequirement.featureId || ''} phaseId={baseRequirement.phaseId || ''} template={templates.find(template => template.id === templateId)} date={scheduleDate} mode={scheduleMode} replacingWorkItems={baseRequirement.workItems.length} />}
      {!templateChanged && !changed && !needsRefresh && !unknown && baseRequirement.workItems.length > 0 && <RequirementSchedulePreview requirement={baseRequirement} date={scheduleDate} mode={scheduleMode} />}
      {!changed && !needsRefresh && !unknown && baseRequirement.executionMode === 'direct' && <DirectRequirementSchedulePreview requirement={baseRequirement} date={scheduleDate} mode={scheduleMode} />}
      {(!!baseRequirement.actualStart||baseRequirement.workItems.some((item) => item.status !== "not_started")) && <FormField label="补充说明（可选）" full><textarea name="reason" rows={2} value={reason} onChange={(event) => {
        const value = event.target.value;
        if (value) dirtyFields.current.add("reason"); else dirtyFields.current.delete("reason");
        setReason(value);
        persistDraftIfLocked(currentDraft({ reason: value }));
      }} placeholder="可补充排期调整的背景" /></FormField>}
      <></><p className="field-help field-full">{templateResetBlocked ? "现有工作、人员和执行记录保持不变。" : templateChanged ? "确认后按所选流程重新生成工作项和计划，原人员分配不保留。" : baseRequirement.executionMode==='direct'?"工期未知时，只补充所选日期，保留另一端已填写的日期。":baseRequirement.workItems.length
        ? "修改日期会整体平移已有工作项，保留相对间隔、人员和实际日期；每个工作项仍可单独修改自定义计划。"
        : "保存后按当前流程生成工作项；需求负责人与全部排期就绪后自动进入未开始。"} 流程设计后续变更不会同步到当前需求。</p>
      {unknown&&!reviewRequired&&<FormError>刚才的提交结果待核对。输入已保留，请核对当前资料与操作记录；本窗口不会重复提交。</FormError>}<FormError>{mutation.error?.message}</FormError>
      {reviewRequired && <div className="warning-banner field-full">提交结果待核对；当前版本已变化。本窗口不再提交。请核对需求与全部工作项日期，已填内容保留。<Button variant="secondary" type="button" className="ghost-button" onClick={finishReview}>已核对并关闭</Button></div>}
      <FormError>{readError?.message}</FormError>
      {changed && <FormError>需求计划已在其他位置更新，请重新加载；已修改的排期草稿会保留。</FormError>}
      {selectedTemplateUnavailable && <FormError>所选流程已不可用，请重新选择后保存。</FormError>}
      {locked && <FormError>需求已完成或取消，不能继续调整计划。</FormError>}
      {refreshed && <p className="field-help field-full">已读取最新计划；未修改字段已同步，已输入内容保持不变。</p>}
      {(changed || needsRefresh) && <div className="field-full"><Button variant="secondary" type="button" className="ghost-button" disabled={pending} onClick={() => void reload()}>重新加载当前计划</Button></div>}
      <FormSubmitActions submitLabel="保存排期" onCancel={()=>{clearDirty();clearBaseRequirement();clearTemplateId();clearScheduleMode();clearScheduleDate();clearReason();onClose();}} pending={pending} disabled={unknown || changed || needsRefresh || reviewRequired || locked || selectedTemplateUnavailable || Boolean(templateResetBlocked) || missingScheduleAnchor} />
      </fieldset>
    </form>
    </Modal>
    {pendingSubmit && <ConfirmDialog title="切换需求流程" description={<>
      <p>目标流程：{pendingSubmit.templateName}<br />{pendingSubmit.input.scheduleMode === "start" ? "计划开始" : "计划完成"}：{pendingSubmit.input.plannedStart || pendingSubmit.input.plannedEnd}</p>
      <p>切换流程会替换当前未执行工作项、人员分配和计划，并按新流程重新生成；需求级说明将保留。</p>
      {!templateResetBlocked && !changed && !needsRefresh && !unknown && <RequirementPlanPreview projectId={requirement.projectId} featureId={baseRequirement.featureId || ''} phaseId={baseRequirement.phaseId || ''} template={templates.find(template => template.id === pendingSubmit.input.templateId)} date={pendingSubmit.input.plannedStart || pendingSubmit.input.plannedEnd || ''} mode={pendingSubmit.input.scheduleMode} replacingWorkItems={baseRequirement.workItems.length} />}
    </>} confirmLabel="确认切换" pendingLabel="切换中…" danger pending={pending} disabled={unknown || changed || needsRefresh || locked || selectedTemplateUnavailable || Boolean(templateResetBlocked)} error={changed ? "需求计划已更新，请取消后重新加载当前计划。" : locked ? "需求已完成或取消，不能继续调整计划。" : templateResetBlocked ? "需求已有执行记录，不能切换流程。" : selectedTemplateUnavailable ? "所选流程已不可用，请取消后重新选择。" : mutation.error?.message} onClose={() => { if (!submitting.current) setPendingSubmit(null); }} onConfirm={() => submit(pendingSubmit)} />}
  </>;
}
