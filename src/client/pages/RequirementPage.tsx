import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Clock3,
  Edit3,
  GripVertical,
  ExternalLink,
  Plus,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { api, jsonBody } from "../api";
import { useApp } from "../app-context";
import type { Person, PlanPreview, Requirement, WorkItem, WorkItemTemplate } from "../types";
import {
  calculateWorkItemGap,
  priorityLabels,
  requirementStatusLabels,
  riskLabels,
  workItemPlannedProgress,
  workItemPlannedDuration,
} from "../../shared/domain";
import { GapTimeline } from "../components/GapTimeline";
import { Chart } from "../components/Chart";
import { ConfirmDialog, EmptyState, Modal, TextPromptModal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { ProgressInput } from "../components/ProgressInput";
import { InlineDateCell, InlineMultiSelectCell, InlineSelectCell, InlineTextCell } from "../components/InlineEdit";
import { WorkItemActions } from "../components/WorkItemActions";
import { SortableList } from "../components/SortableList";
import { canManageProject } from "../permissions";
import { dailyProgressTrend } from "../progress-trend";

function RequirementInfoForm({
  requirement,
  people,
  onClose,
}: {
  requirement: Requirement;
  people: Person[];
  onClose: () => void;
}) {
  const client = useQueryClient();
  const hasExecution = requirement.workItems.some((item) => item.status !== "not_started" || item.progress > 0 || item.actualStart);
  const eligiblePeople = people.filter((person) => person.active && person.projectRole !== "viewer");
  const currentOwner = requirement.ownerId ? people.find((person) => person.id === requirement.ownerId) : undefined;
  const ownerOptions = currentOwner && !eligiblePeople.some((person) => person.id === currentOwner.id)
    ? [currentOwner, ...eligiblePeople]
    : eligiblePeople;
  const [ownerId, setOwnerId] = useState(requirement.ownerId || "");
  const mutation = useMutation({
    mutationFn: (value: object) => api(`/api/requirements/${requirement.id}`, { method: "PATCH", body: jsonBody(value) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["requirement", requirement.id] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      void client.invalidateQueries({ queryKey: ["requirements"] });
      void client.invalidateQueries({ queryKey: ["my-work"] });
      void client.invalidateQueries({ queryKey: ["action-items"] });
      onClose();
    },
  });
  return <form className="form-grid" onSubmit={(event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    mutation.mutate({
      ...values,
      ...(ownerId !== (requirement.ownerId || "") ? { ownerId: ownerId || null } : {}),
      expectedVersion: requirement.version,
    });
  }}>
    <label className="field field-full"><span>需求标题</span><input name="title" defaultValue={requirement.title} required autoFocus /></label>
    <label className="field"><span>优先级</span><select name="priority" defaultValue={requirement.priority}>
      <option value="P0">P0 · 紧急</option><option value="P1">P1 · 高</option><option value="P2">P2 · 中</option><option value="P3">P3 · 低</option>
    </select></label>
    <label className="field"><span>需求负责人</span><select name="ownerId" value={ownerId} required={hasExecution} onChange={(event) => setOwnerId(event.target.value)}>
      <option value="" disabled={hasExecution}>{hasExecution ? "负责人缺失，请选择" : "待指定"}</option>
      {requirement.ownerId && !ownerOptions.some((person) => person.id === requirement.ownerId) && <option value={requirement.ownerId}>{requirement.ownerName || "历史负责人"} · 历史负责人</option>}
      {ownerOptions.map((person) => <option value={person.id} key={person.id}>{person.name}{person.jobTitle ? ` · ${person.jobTitle}` : ""}{person === currentOwner && !eligiblePeople.includes(person) ? " · 历史负责人" : ""}</option>)}
    </select></label>
    {hasExecution && <p className="field-help field-full">需求已开始执行，负责人可以更换但不能清空。</p>}
    <label className="field field-full"><span>需求背景（可选）</span><textarea name="background" rows={3} defaultValue={requirement.background || ""} /></label>
    <label className="field field-full"><span>验收标准（可选）</span><textarea name="acceptanceCriteria" rows={3} defaultValue={requirement.acceptanceCriteria || ""} /></label>
    <label className="field field-full"><span>参考链接（可选）</span><input name="referenceUrl" type="url" defaultValue={requirement.referenceUrl || ""} placeholder="https://…" /></label>
    {mutation.error && <p className="form-error field-full">{mutation.error.message}</p>}
    <div className="form-actions field-full"><button type="button" className="ghost-button" onClick={onClose}>取消</button><button className="primary-button" disabled={mutation.isPending}>保存信息</button></div>
  </form>;
}

function RequirementScheduleForm({
  requirement,
  onClose,
}: {
  requirement: Requirement;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const { data: templates = [] } = useQuery({
    queryKey: ["templates", requirement.projectId],
    queryFn: () => api<WorkItemTemplate[]>(`/api/templates?projectId=${encodeURIComponent(requirement.projectId)}`),
  });
  const [templateId, setTemplateId] = useState(requirement.templateId || "");
  const [scheduleMode, setScheduleMode] = useState<"start" | "deadline">("start");
  const [pendingSubmit, setPendingSubmit] = useState<object | null>(null);
  const [scheduleDate, setScheduleDate] = useState(requirement.plannedStart || "");
  const templateChanged = Boolean(templateId && templateId !== requirement.templateId);
  const mutation = useMutation({
    mutationFn: (value: object) =>
      api(`/api/requirements/${requirement.id}/${templateChanged ? "reselect-template" : "reschedule"}`, {
        method: "POST",
        body: jsonBody(value),
      }),
    onSuccess: () => {
      setPendingSubmit(null);
      void client.invalidateQueries({
        queryKey: ["requirement", requirement.id],
      });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      void client.invalidateQueries({ queryKey: ["requirements"] });
      void client.invalidateQueries({ queryKey: ["my-work"] });
      void client.invalidateQueries({ queryKey: ["people-concurrency"] });
      onClose();
    },
  });
  return <>
    <form
      className="form-grid"
      onSubmit={(event) => {
        event.preventDefault();
        const input = {
          ...Object.fromEntries(new FormData(event.currentTarget)),
          scheduleMode,
          expectedVersion: requirement.version,
          ...(templateChanged ? { templateId, confirmTemplateReset: true } : {}),
        };
        if (templateChanged) { mutation.reset(); setPendingSubmit(input); return; }
        mutation.mutate(input);
      }}
    >
      <div className="field field-full">
        <span>排期方式</span>
        <div className="schedule-mode-switch" role="radiogroup" aria-label="排期方式">
          <button type="button" className={scheduleMode === "start" ? "is-active" : ""} role="radio" aria-checked={scheduleMode === "start"} onClick={() => { setScheduleMode("start"); setScheduleDate(requirement.plannedStart || ""); }}>
            <strong>按开始日期正排</strong>
            <small>{requirement.workItems.length ? "整体平移现有工作项，以选定日期开始" : "按当前流程生成工作项和计划"}</small>
          </button>
          <button type="button" className={scheduleMode === "deadline" ? "is-active" : ""} role="radio" aria-checked={scheduleMode === "deadline"} onClick={() => { setScheduleMode("deadline"); setScheduleDate(requirement.plannedEnd || ""); }}>
            <strong>按截止日期倒排</strong>
            <small>{requirement.workItems.length ? "整体平移现有工作项，以选定日期结束" : "按当前流程倒排生成工作项和计划"}</small>
          </button>
        </div>
      </div>
      <label className="field field-full schedule-date-field">
        <span>{scheduleMode === "start" ? "计划开始" : "计划完成"}</span>
        <input
          key={scheduleMode}
          name={scheduleMode === "start" ? "plannedStart" : "plannedEnd"}
          type="date"
          required
          value={scheduleDate}
          onChange={(event) => setScheduleDate(event.target.value)}
        />
      </label>
      <label className="field field-full">
        <span>绑定流程</span>
        <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
          {!requirement.templateId && <option value="">未绑定（保持现有工作项）</option>}
          {requirement.templateId && !templates.some((template) => template.id === requirement.templateId) && <option value={requirement.templateId}>{requirement.templateName || "原流程"}（已归档）</option>}
          {templates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}
        </select>
      </label>
      {templateChanged && <p className="template-reset-warning field-full"><AlertTriangle size={16} />切换后会替换未执行工作项并按新流程重新排期；需求级说明保留。</p>}
      {requirement.workItems.some((item) => item.status !== "not_started") && <label className="field field-full"><span>变更原因</span><textarea name="reason" rows={3} required placeholder="需求已开始执行，请说明调整排期的原因" /></label>}
      <p className="field-help field-full">{requirement.workItems.length
        ? "修改日期会整体平移已有工作项，保留相对间隔、人员和实际日期；每个工作项仍可单独修改自定义计划。"
        : "保存后按当前流程生成工作项；需求负责人与全部排期就绪后自动进入未开始。"} 流程设计后续变更不会同步到当前需求。</p>
      {mutation.error && (
        <p className="form-error field-full">{mutation.error.message}</p>
      )}
      <div className="form-actions field-full">
        <button type="button" className="ghost-button" onClick={onClose}>
          取消
        </button>
        <button className="primary-button">保存排期</button>
      </div>
    </form>
    {pendingSubmit && <ConfirmDialog title="切换需求流程" description="切换流程会替换当前未执行工作项、人员分配和计划，并按新流程重新生成；需求级说明将保留。" confirmLabel="确认切换" pendingLabel="切换中…" danger pending={mutation.isPending} error={mutation.error?.message} onClose={() => setPendingSubmit(null)} onConfirm={() => mutation.mutate(pendingSubmit)} />}
  </>;
}
function ProgressForm({
  requirement,
  allowedItems,
  requireAssociation,
  fixedItemId,
  onClose,
}: {
  requirement: Requirement;
  allowedItems?: WorkItem[];
  requireAssociation?: boolean;
  fixedItemId?: string | null;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const items = (allowedItems || requirement.workItems).filter((item) => !["completed", "cancelled"].includes(item.status));
  const fixedItem = fixedItemId ? items.find((item) => item.id === fixedItemId) : undefined;
  const initialWorkItemId = fixedItem?.id || (requireAssociation ? items[0]?.id || "" : "");
  const [workItemId, setWorkItemId] = useState(initialWorkItemId);
  const [workItemPercent, setWorkItemPercent] = useState(() => items.find((item) => item.id === initialWorkItemId)?.progress || 0);
  const mutation = useMutation({
    mutationFn: (value: object) =>
      api(`/api/requirements/${requirement.id}/progress`, {
        method: "POST",
        body: jsonBody(value),
      }),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["requirement", requirement.id],
      });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      void client.invalidateQueries({ queryKey: ["requirements"] });
      void client.invalidateQueries({ queryKey: ["my-work"] });
      void client.invalidateQueries({ queryKey: ["people-concurrency"] });
      onClose();
    },
  });
  return (
    <form
      className="form-grid"
      onSubmit={(event) => {
        event.preventDefault();
        const content = String(new FormData(event.currentTarget).get("content") || "");
        const selectedItem = items.find((item) => item.id === workItemId);
        mutation.mutate({
          content,
          ...(selectedItem ? {
            workItemId: selectedItem.id,
            workItemPercent,
            expectedVersion: selectedItem.version,
          } : {}),
        });
      }}
    >
      {fixedItem ? <div className="progress-item-context field-full">
        <span>工作项</span>
        <strong>{fixedItem.title}</strong>
        <small>当前完成度 {fixedItem.progress}%</small>
        <input type="hidden" name="workItemId" value={fixedItem.id} />
      </div> : <label className="field field-full">
          <span>关联工作项{requireAssociation ? "" : "（可选）"}</span>
          <select name="workItemId" required={requireAssociation} value={workItemId} onChange={(event) => {
            const nextId = event.target.value;
            setWorkItemId(nextId);
            setWorkItemPercent(items.find((item) => item.id === nextId)?.progress || 0);
          }}>
            {!requireAssociation && <option value="">不关联</option>}
            {items.map((item) => (
              <option value={item.id} key={item.id}>
                {item.title} · 当前 {item.progress}%
              </option>
            ))}
          </select>
        </label>}
      {workItemId && <><input type="hidden" name="expectedVersion" value={items.find((item) => item.id === workItemId)?.version || 1} /><ProgressInput name="workItemPercent" value={workItemPercent} onChange={setWorkItemPercent} max={99} /></>}
      <label className="field field-full">
        <span>具体进展</span>
        <textarea
          name="content"
          rows={5}
          required
          autoFocus
          placeholder="描述本次实际完成的内容"
        />
      </label>
      <p className="field-help field-full">填写0～99%的累计完成度；100%请使用“完成工作项”。不关联工作项时仅记录说明。</p>
      {mutation.error && (
        <p className="form-error field-full">{mutation.error.message}</p>
      )}
      <div className="form-actions field-full">
        <button type="button" className="ghost-button" onClick={onClose}>
          取消
        </button>
        <button className="primary-button">记录进展</button>
      </div>
    </form>
  );
}

function PlanForm({ requirement, templates, onClose }: { requirement: Requirement; templates: WorkItemTemplate[]; onClose: () => void }) {
  const client = useQueryClient();
  const [templateId, setTemplateId] = useState(requirement.templateId || templates[0]?.id || "");
  const [baseStart, setBaseStart] = useState(requirement.plannedStart || "");
  const [reason, setReason] = useState("");
  const hasExecution = requirement.workItems.some((item) => item.status !== "not_started");
  const [preview, setPreview] = useState<PlanPreview>();
  useEffect(() => {
    if (!templateId && templates[0]) setTemplateId(templates[0].id);
  }, [templateId, templates]);
  const previewMutation = useMutation({
    mutationFn: () => api<PlanPreview>(`/api/requirements/${requirement.id}/plan-preview`, {
      method: "POST", body: jsonBody({ templateId, baseStart }),
    }),
    onSuccess: setPreview,
  });
  const applyMutation = useMutation({
    mutationFn: () => api(`/api/requirements/${requirement.id}/apply-plan`, {
      method: "POST",
      body: jsonBody({ templateId, baseStart, expectedVersion: requirement.version, reason: reason.trim() || undefined, templateItemIds: preview?.entries.filter((item) => item.willChange).map((item) => item.templateItemId) }),
    }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["requirement", requirement.id] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
  });
  return (
    <div className="plan-preview-form">
      <div className="form-grid">
        <label className="field"><span>流程设计</span><select value={templateId} onChange={(event) => { setTemplateId(event.target.value); setPreview(undefined); }}>{templates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}</select></label>
        <label className="field"><span>计划开始</span><input type="date" value={baseStart} onChange={(event) => { setBaseStart(event.target.value); setPreview(undefined); }} /></label>
      </div>
      {hasExecution && <label className="field field-full"><span>变更原因</span><textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} required placeholder="需求已开始执行，请说明补排或调整原因" /></label>}
      {!preview && <div className="form-actions"><button className="primary-button" disabled={!templateId || !baseStart || previewMutation.isPending} onClick={() => previewMutation.mutate()}><WandSparkles size={15} />生成差异预览</button></div>}
      {previewMutation.error && <p className="form-error">{previewMutation.error.message}</p>}
      {preview && <>
        <div className="plan-preview-list">
          {preview.entries.map((item) => <div key={item.templateItemId} className={item.willChange ? "will-change" : "unchanged"}>
            <strong>{item.title}</strong><span>{item.currentStart || "空"} → {item.currentEnd || "空"}</span><b>→</b><span>{item.proposedStart} → {item.proposedEnd}</span><em>{item.reason === "missing_item" ? "新增" : item.reason === "missing_plan" ? "补空值" : "保持"}</em>
          </div>)}
        </div>
        <p className="field-help">仅补充空日期或缺失工作项，已有计划和实际日期不会覆盖。</p>
        {applyMutation.error && <p className="form-error">{applyMutation.error.message}</p>}
        <div className="form-actions"><button className="ghost-button" onClick={() => setPreview(undefined)}>重新预览</button><button className="primary-button" disabled={!preview.entries.some((item) => item.willChange) || hasExecution && !reason.trim() || applyMutation.isPending} onClick={() => applyMutation.mutate()}>确认补全</button></div>
      </>}
    </div>
  );
}

type NewWorkItemDraft = {
  title: string;
  milestoneLabel: string;
  ownerId: string;
  collaboratorIds: string[];
  plannedStart: string;
  plannedEnd: string;
  reason?: string;
};

type RequirementTextPrompt =
  | { kind: "reorder"; ids: string[] }
  | { kind: "accept" }
  | { kind: "new-item" }
  | { kind: "cancel" };

export function RequirementPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { session, projects, syncProjectContext } = useApp();
  const [modal, setModal] = useState<
    "info" | "schedule" | "progress" | "template" | null
  >(null);
  const [progressItemId, setProgressItemId] = useState<string | null>(null);
  const [workEditorOpen, setWorkEditorOpen] = useState(false);
  const [newItem, setNewItem] = useState<NewWorkItemDraft | null>(null);
  const [textPrompt, setTextPrompt] = useState<RequirementTextPrompt | null>(null);
  const [removeTarget, setRemoveTarget] = useState<WorkItem | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const {
    data: requirement,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["requirement", id],
    queryFn: () => api<Requirement>(`/api/requirements/${id}`),
    enabled: Boolean(id),
  });
  useEffect(() => {
    if (!requirement?.projectId) return;
    if (projects.some((project) => project.id === requirement.projectId))
      syncProjectContext(requirement.projectId);
  }, [projects, requirement?.projectId, syncProjectContext]);
  const { data: templates = [] } = useQuery({
    queryKey: ["templates", requirement?.projectId || ""],
    queryFn: () => api<WorkItemTemplate[]>(`/api/templates?projectId=${encodeURIComponent(requirement!.projectId)}`),
    enabled: Boolean(requirement?.projectId),
  });
  const { data: people = [] } = useQuery({
    queryKey: ["people", requirement?.projectId || ""],
    queryFn: () => api<Person[]>(`/api/people?projectId=${encodeURIComponent(requirement!.projectId)}`),
    enabled: Boolean(requirement?.projectId),
  });
  const removeItem = useMutation({
    mutationFn: (item: WorkItem) =>
      api(`/api/work-items/${item.id}`, { method: "DELETE", body: jsonBody({ expectedVersion: item.version }) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["requirement", id] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      void client.invalidateQueries({ queryKey: ["requirements"] });
      void client.invalidateQueries({ queryKey: ["my-work"] });
      void client.invalidateQueries({ queryKey: ["people-concurrency"] });
    },
  });
  const reorderItems = useMutation({
    mutationFn: ({ ids, reason }: { ids: string[]; reason?: string }) => api(`/api/requirements/${id}/reorder-work-items`, {
      method: "POST",
      body: jsonBody({ ids, reason, expectedVersion: requirement?.version }),
    }),
    onSuccess: () => {
      setRemoveTarget(null);
      setTextPrompt(null);
      void client.invalidateQueries({ queryKey: ["requirement", id] });
    },
  });
  const archive = useMutation({
    mutationFn: () => api(`/api/requirements/${id}`, { method: "DELETE", body: jsonBody({ expectedVersion: requirement?.version }) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      navigate("/");
    },
  });
  const requirementAction = useMutation({
    mutationFn: ({ action, text }: { action: "accept" | "cancel"; text: string }) => api<Requirement>(`/api/requirements/${id}/${action}`, {
      method: "POST",
      body: jsonBody({ expectedVersion: requirement?.version, ...(action === "accept" ? { content: text } : { reason: text }) }),
    }),
    onSuccess: () => {
      setArchiveConfirm(false);
      setTextPrompt(null);
      void client.invalidateQueries({ queryKey: ["requirement", id] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      void client.invalidateQueries({ queryKey: ["requirements"] });
      void client.invalidateQueries({ queryKey: ["my-work"] });
    },
  });
  const itemAction = useMutation({
    mutationFn: ({ item, action, content }: { item: WorkItem; action: string; content?: string }) =>
      api(`/api/work-items/${item.id}/${action}`, {
        method: "POST",
        body: jsonBody({ expectedVersion: item.version, ...(action === "complete" ? { content } : content ? { reason: content } : {}) }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["requirement", id] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      void client.invalidateQueries({ queryKey: ["requirements"] });
      void client.invalidateQueries({ queryKey: ["my-work"] });
      void client.invalidateQueries({ queryKey: ["people-concurrency"] });
    },
  });
  const createItem = useMutation({
    mutationFn: (draft: NewWorkItemDraft) => api<WorkItem>(`/api/requirements/${id}/work-items`, {
      method: "POST",
      body: jsonBody({
        title: draft.title,
        milestoneLabel: draft.milestoneLabel || null,
        ownerId: draft.ownerId || null,
        assigneeIds: [draft.ownerId, ...draft.collaboratorIds].filter(Boolean),
        plannedStart: draft.plannedStart || null,
        plannedEnd: draft.plannedEnd || null,
        expectedVersion: requirement?.version,
        ...(draft.reason ? { reason: draft.reason } : {}),
      }),
    }),
    onSuccess: () => {
      setNewItem(null);
      setTextPrompt(null);
      void client.invalidateQueries({ queryKey: ["requirement", id] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      void client.invalidateQueries({ queryKey: ["requirements"] });
      void client.invalidateQueries({ queryKey: ["people-concurrency"] });
    },
  });
  const saveWorkItem = async (item: WorkItem, input: Record<string, unknown>) => {
    const normalizedInput = { ...input };
    const key = ["requirement", id] as const;
    const previous = client.getQueryData<Requirement>(key);
    const optimistic = { ...item, ...normalizedInput } as WorkItem;
    if (Object.prototype.hasOwnProperty.call(input, "ownerId")) {
      optimistic.ownerId = typeof input.ownerId === "string" && input.ownerId ? input.ownerId : null;
      optimistic.ownerName = people.find((person) => person.id === optimistic.ownerId)?.name || null;
    }
    if (Array.isArray(input.assigneeIds)) {
      optimistic.assigneeIds = input.assigneeIds.map(String);
      optimistic.assigneeNames = people.filter((person) => optimistic.assigneeIds.includes(person.id)).map((person) => person.name);
      optimistic.collaborators = people
        .filter((person) => optimistic.assigneeIds.includes(person.id) && person.id !== optimistic.ownerId)
        .map((person) => ({ id: person.id, name: person.name, jobTitle: person.jobTitle }));
    }
    client.setQueryData<Requirement>(key, (current) => current ? {
      ...current,
      workItems: current.workItems.map((entry) => entry.id === item.id ? optimistic : entry),
    } : current);
    try {
      const isCorrection = Object.prototype.hasOwnProperty.call(normalizedInput, "actualStart") || Object.prototype.hasOwnProperty.call(normalizedInput, "actualEnd");
      const saved = await api<WorkItem>(`/api/work-items/${item.id}${isCorrection ? "/correct" : ""}`, {
        method: isCorrection ? "POST" : "PATCH", body: jsonBody({ ...normalizedInput, expectedVersion: item.version }),
      });
      client.setQueryData<Requirement>(key, (current) => current ? {
        ...current,
        workItems: current.workItems.map((entry) => entry.id === saved.id ? saved : entry),
      } : current);
      void client.invalidateQueries({ queryKey: ["requirement", id] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      void client.invalidateQueries({ queryKey: ["requirements"] });
      void client.invalidateQueries({ queryKey: ["my-work"] });
      void client.invalidateQueries({ queryKey: ["people-concurrency"] });
    } catch (error) {
      client.setQueryData(key, previous);
      throw error;
    }
  };
  const progressOption = useMemo(
    () => {
      const dailyTrend = dailyProgressTrend(requirement?.progressUpdates || []);
      const items = (requirement?.workItems || []).filter((item) => item.status !== "cancelled");
      const totalWeight = items.reduce((sum, item) => sum + workItemPlannedDuration(item), 0);
      const plannedValues = dailyTrend.map(({ date }) => {
        const plannedWeight = items.reduce((sum, item) => sum + workItemPlannedDuration(item) * workItemPlannedProgress(item, date) / 100, 0);
        return totalWeight ? Math.round((plannedWeight / totalWeight) * 100) : 0;
      });
      return ({
      tooltip: { trigger: "axis" },
      legend: { top: 4, right: 16, data: ["实际进度", "计划进度"], textStyle: { color: "#718096", fontSize: 12 } },
      grid: { left: 42, right: 18, top: 42, bottom: 34 },
      xAxis: {
        type: "category",
        data: dailyTrend.map(({ date }) => `${date.slice(5, 7)}/${date.slice(8, 10)}`),
        axisLabel: { color: "#718096" },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 100,
        axisLabel: { formatter: "{value}%", color: "#718096" },
        splitLine: { lineStyle: { color: "#eef1f5" } },
      },
      series: [
        {
          name: "实际进度",
          type: "line",
          smooth: true,
          symbolSize: 8,
          data: dailyTrend.map((item) => item.actualProgress),
          lineStyle: { color: "#2d6cdf", width: 3 },
          itemStyle: { color: "#2d6cdf" },
          areaStyle: { color: "rgba(45,108,223,.12)" },
        },
        {
          name: "计划进度",
          type: "line",
          smooth: false,
          symbolSize: 6,
          data: plannedValues,
          lineStyle: { color: "#91a3bc", width: 2, type: "dashed" },
          itemStyle: { color: "#91a3bc" },
        },
      ],
    });
    },
    [requirement],
  );
  if (isLoading)
    return (
      <>
        <PageHeader title="需求详情" onBack={() => navigate(-1)} />
        <div className="page-content">
          <div className="loading-block">加载需求详情…</div>
        </div>
      </>
    );
  if (error || !requirement)
    return (
      <>
        <PageHeader title="需求详情" onBack={() => navigate("/requirements")} backLabel="返回需求管理" />
        <div className="page-content">
          <EmptyState
            title="需求无法打开"
            detail={error?.message || "需求不存在或已归档。"}
            action={
              <button className="ghost-button" onClick={() => navigate("/requirements")}>
                返回需求管理
              </button>
            }
          />
        </div>
      </>
    );
  const canManage = canManageProject(session, requirement.projectId);
  const currentPerson = people.find((person) => person.id === session.personId);
  const canContribute = canManage || currentPerson?.projectRole === "member" || currentPerson?.projectRole === "manager";
  const isRequirementOwner = canContribute && Boolean(session.personId && requirement.ownerId === session.personId);
  const ownItems = canContribute
    ? isRequirementOwner ? requirement.workItems : requirement.workItems.filter((item) => Boolean(session.personId) && item.assigneeIds.includes(session.personId!))
    : [];
  const requirementLocked = ["pending_acceptance", "completed", "cancelled"].includes(requirement.status);
  const canManageWorkItems = (canManage || isRequirementOwner) && !requirementLocked;
  const eligiblePeople = people.filter((person) => person.active && person.projectRole !== "viewer");
  const canAddProgress = canContribute && !requirementLocked;
  const canUpdateItemProgress = (item: WorkItem) => item.status === "in_progress"
    && canContribute
    && (canManage || isRequirementOwner || Boolean(session.personId && item.assigneeIds.includes(session.personId)));
  const canOperateItem = (item: WorkItem) => requirement.status !== "cancelled"
    && (canManage || isRequirementOwner || (canContribute && Boolean(session.personId && item.assigneeIds.includes(session.personId))));
  const reorderWorkItems = (nextItems: WorkItem[]) => {
    const ids = nextItems.map((item) => item.id);
    if (requirement.workItems.some((item) => item.status !== "not_started")) {
      reorderItems.reset();
      setTextPrompt({ kind: "reorder", ids });
      return;
    }
    reorderItems.mutate({ ids });
  };
  const openProgress = (itemId: string | null = null) => {
    setProgressItemId(itemId);
    setModal("progress");
  };
  const closeProgress = () => {
    setProgressItemId(null);
    setModal(null);
  };
  const riskClosed = ["pending_acceptance", "completed", "cancelled"].includes(requirement.status);
  const riskLabel = riskClosed
    ? "风险已关闭"
    : requirement.riskEvaluated
      ? riskLabels[requirement.riskLevel as keyof typeof riskLabels]
      : "待评估";
  const riskClass = riskClosed || !requirement.riskEvaluated ? "risk-pending" : `risk-${requirement.riskLevel}`;
  return (
    <>
      <PageHeader
        title={requirement.title}
        onBack={() => navigate(-1)}
        actions={canAddProgress || canManage ? (
          <>
            {canManage && !requirementLocked && <button className="ghost-button" onClick={() => setModal("info")}>
              <Edit3 size={15} />
              编辑信息
            </button>}
            {canManage && !requirementLocked && <button className="ghost-button" onClick={() => setModal("schedule")}>
              <CalendarDays size={15} />
              调整计划
            </button>}
            {canAddProgress && <button
              className="primary-button"
              onClick={() => openProgress()}
            >
              <Plus size={15} />
              增加进展
            </button>}
          </>
        ) : null}
      />
      <div className="page-content requirement-page">
        {requirement.status === "pending_acceptance" && <section className="requirement-acceptance-banner">
          <div><Check size={18} /><span><strong>所有工作项已完成，等待项目经理验收</strong><small>验收后才会计入已完成需求和完成率</small></span></div>
          {canManage && <button className="primary-button" disabled={requirementAction.isPending} onClick={() => { requirementAction.reset(); setTextPrompt({ kind: "accept" }); }}><Check size={15} />确认验收</button>}
        </section>}
        <div className="requirement-context-strip">
          <div className="hero-badges">
            <span>{requirement.projectName}</span>
            <span className={`status-pill status-${requirement.status}`}>
              {
                requirementStatusLabels[
                  requirement.status as keyof typeof requirementStatusLabels
                ]
              }
            </span>
            <span className={`priority-badge priority-${requirement.priority.toLowerCase()}`}>{priorityLabels[requirement.priority as keyof typeof priorityLabels] || requirement.priority}</span>
            <span className={`risk-badge ${riskClass}`}>{riskLabel}</span>
          </div>
          <span>共{requirement.workItems.length}个工作项 · 最近更新 {new Date(requirement.updatedAt).toLocaleString("zh-CN")}</span>
        </div>
      <section className="panel requirement-brief">
        <div><span>需求负责人</span><strong>{requirement.ownerName || "待指定"}</strong></div>
        {requirement.background && <div><span>需求背景</span><p>{requirement.background}</p></div>}
        {requirement.acceptanceCriteria && <div><span>验收标准</span><p>{requirement.acceptanceCriteria}</p></div>}
        {requirement.referenceUrl && <div><span>参考链接</span><a href={requirement.referenceUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />打开辅助资料</a></div>}
      </section>
      <section className="detail-kpis">
        <article>
          <span>当前进度</span>
          <strong>{requirement.progress}%</strong>
          <div className="progress-row">
            <i style={{ width: `${requirement.progress}%` }} />
          </div>
          <small>计划进度 {requirement.plannedProgress}% · 自动按工期加权</small>
        </article>
        <article>
          <span>计划周期</span>
          <strong>
            {requirement.plannedStart || "待排期"} →{" "}
            {requirement.plannedEnd || "待排期"}
          </strong>
          <small>
            <CalendarDays size={14} />
            按工作日计算
          </small>
        </article>
        <article>
          <span>完成偏差</span>
          <strong
            className={
              requirement.finishVariance > 0 ? "danger-text" : "safe-text"
            }
          >
            {requirement.finishVariance > 0
              ? `+${requirement.finishVariance}`
              : requirement.finishVariance}{" "}
            工作日
          </strong>
          <small>
            <Clock3 size={14} />
            计划对比实际
          </small>
        </article>
        <article>
          <span>风险等级</span>
          <strong>{riskLabel}</strong>
          <small>
            {requirement.riskEvaluated && requirement.riskLevel !== "low" ? (
              <>
                <AlertTriangle size={14} />
                {requirement.riskReason}
              </>
            ) : (
              <>
                <Check size={14} />
                {requirement.riskReason}
              </>
            )}
          </small>
        </article>
      </section>
      <section className="panel detail-panel requirement-progress-panel">
        <header>
          <div>
            <h2>需求进展</h2>
          </div>
          {canManageWorkItems && (
            <div className="panel-actions">
              <button
                className="ghost-button"
                aria-haspopup="dialog"
                onClick={() => setWorkEditorOpen(true)}
              >
                <Edit3 size={15} />
                工作项设置
              </button>
            </div>
          )}
        </header>
        <GapTimeline
          items={requirement.workItems}
          asOfDate={requirement.asOfDate}
          updates={requirement.progressUpdates || []}
          canUpdateProgress={canUpdateItemProgress}
          onUpdateProgress={(item) => openProgress(item.id)}
          renderActions={(item) => canOperateItem(item)
            ? <WorkItemActions
                item={item}
                onAction={(action, content) => itemAction.mutateAsync({ item, action, content })}
                onSaveDates={canManage ? (dates) => saveWorkItem(item, dates) : undefined}
                onCancel={(reason) => itemAction.mutateAsync({ item, action: "cancel", content: reason })}
                canManage={canManage || isRequirementOwner}
              />
            : <span className={`work-action-state is-readonly status-${item.status}`}>
                {requirementStatusLabels[item.status as keyof typeof requirementStatusLabels] || item.status}
              </span>}
        />
      </section>
      {workEditorOpen && canManageWorkItems && <Modal title="工作项设置" width={1120} onClose={() => setWorkEditorOpen(false)}>
          <div className="work-editor-modal">
            <div className="work-editor-modal-toolbar">
              <span>配置名称、人员、计划日期和顺序；日常推进请直接在甘特图操作</span>
              <div className="panel-actions">
              {canManage && (!requirement.workItems.length || requirement.workItems.some((item) => !item.plannedStart || !item.plannedEnd)) && <button className="ghost-button" onClick={() => { setWorkEditorOpen(false); setModal("template"); }}>补全计划</button>}
              <button className="primary-button" disabled={Boolean(newItem)} onClick={() => setNewItem({ title: "", milestoneLabel: "", ownerId: "", collaboratorIds: [], plannedStart: "", plannedEnd: "" })}><Plus size={15} />添加工作项</button>
              </div>
            </div>
          {(reorderItems.error || removeItem.error) && <p className="form-error">{(reorderItems.error || removeItem.error)?.message}</p>}
          <div className="work-editor-scroll"><table className="work-inline-table">
            <thead><tr><th>工作项</th><th>主负责人</th><th>协作人员</th><th>计划开始</th><th>计划完成</th><th>状态 / 偏差</th><th>操作</th></tr></thead>
            <tbody>
            {newItem && <tr className="work-inline-new-row">
              <td><div className="work-item-name-editor"><InlineTextCell value={newItem.title} label="新工作项名称" required placeholder="填写名称" onSave={async (title) => setNewItem((current) => current && ({ ...current, title }))} /><InlineTextCell value={newItem.milestoneLabel} label="新工作项里程碑" placeholder="添加里程碑" onSave={async (milestoneLabel) => setNewItem((current) => current && ({ ...current, milestoneLabel }))} renderValue={(value) => <span className="work-item-milestone-edit">◆ {value}</span>} /></div></td>
              <td><InlineSelectCell value={newItem.ownerId} label="新工作项主负责人" options={[{ value: "", label: "未分配" }, ...eligiblePeople.map((person) => ({ value: person.id, label: person.name, description: person.jobTitle || "岗位未设置" }))]} onSave={async (ownerId) => setNewItem((current) => current && ({ ...current, ownerId, collaboratorIds: current.collaboratorIds.filter((personId) => personId !== ownerId) }))} placeholder="未分配" /></td>
              <td><InlineMultiSelectCell value={newItem.collaboratorIds} label="新工作项协作人员" options={eligiblePeople.map((person) => ({ value: person.id, label: person.name, description: person.jobTitle || "岗位未设置" }))} excludedValues={newItem.ownerId ? [newItem.ownerId] : []} onSave={async (collaboratorIds) => setNewItem((current) => current && ({ ...current, collaboratorIds }))} placeholder="选择人员" /></td>
              <td><InlineDateCell value={newItem.plannedStart} label="新工作项计划开始" onSave={async (plannedStart) => setNewItem((current) => current && ({ ...current, plannedStart: plannedStart || "" }))} /></td>
              <td><InlineDateCell value={newItem.plannedEnd} label="新工作项计划完成" onSave={async (plannedEnd) => setNewItem((current) => current && ({ ...current, plannedEnd: plannedEnd || "" }))} /></td>
              <td><span className="status-pill status-not_started">待创建</span>{createItem.error && <small className="inline-row-error">{createItem.error.message}</small>}</td>
              <td><div className="inline-row-actions"><button className="ghost-button" onClick={() => setNewItem(null)}>取消</button><button className="primary-button" disabled={!newItem.title.trim() || createItem.isPending} onClick={() => {
                if (requirement.workItems.some((item) => item.status !== "not_started")) { createItem.reset(); setTextPrompt({ kind: "new-item" }); return; }
                createItem.mutate(newItem);
              }}>保存</button></div></td>
            </tr>}
            <SortableList
              items={requirement.workItems}
              getId={(item) => item.id}
              disabled={reorderItems.isPending}
              onReorder={reorderWorkItems}
              renderItem={(item, _index, sortable) => {
              const gap = calculateWorkItemGap(item);
              const historicalPeople = [
                ...(item.ownerId && !eligiblePeople.some((person) => person.id === item.ownerId)
                  ? [{ id: item.ownerId, name: item.ownerName || "历史负责人", jobTitle: "历史负责人" }]
                  : []),
                ...item.collaborators.filter((collaborator) => !eligiblePeople.some((person) => person.id === collaborator.id)),
              ];
              const assignmentOptions = [...eligiblePeople, ...historicalPeople].map((person) => ({
                value: person.id, label: person.name, description: person.jobTitle || "岗位未设置",
              }));
              return (
                <tr ref={sortable.setNodeRef} className={`sortable-item${sortable.isDragging ? " is-dragging" : ""}${sortable.isOver ? " is-over" : ""}`}>
                  <td><div className="work-item-name-editor"><InlineTextCell value={item.title} label="工作项名称" required onSave={(title) => saveWorkItem(item, { title })} /><InlineTextCell value={item.milestoneLabel} label="里程碑名称" placeholder="添加里程碑" onSave={(milestoneLabel) => saveWorkItem(item, { milestoneLabel: milestoneLabel || null })} renderValue={(value) => <span className="work-item-milestone-edit">◆ {value}</span>} /></div></td>
                  <td><InlineSelectCell value={item.ownerId} label="主负责人" options={[{ value: "", label: "未分配" }, ...assignmentOptions]} reason={requirement.workItems.some((workItem) => workItem.status !== "not_started") ? { required: true, label: "调整原因", placeholder: "需求已开始执行，请说明切换主负责人的原因" } : undefined} onSave={(ownerId, reason) => saveWorkItem(item, { ownerId: ownerId || null, assigneeIds: [ownerId, ...item.collaborators.map((person) => person.id).filter((personId) => personId !== ownerId)].filter(Boolean), ...(reason ? { reason } : {}) })} placeholder="未分配" /></td>
                  <td><InlineMultiSelectCell value={item.collaborators.map((person) => person.id)} label="协作人员" options={assignmentOptions} excludedValues={item.ownerId ? [item.ownerId] : []} onSave={(collaboratorIds) => saveWorkItem(item, { assigneeIds: [item.ownerId, ...collaboratorIds].filter(Boolean) })} placeholder="无协作人员" renderValue={(selected) => selected.length ? <span className="inline-person-summary">{selected.slice(0, 2).map((person) => person.label).join("、")}{selected.length > 2 ? ` +${selected.length - 2}` : ""}</span> : "无协作人员"} /></td>
                  <td><InlineDateCell value={item.plannedStart} label="计划开始" reason={item.status === "not_started" ? undefined : { required: true, label: "调整原因", placeholder: "请说明计划开始日期调整原因" }} onSave={(plannedStart, reason) => saveWorkItem(item, { plannedStart, ...(reason ? { reason } : {}) })} /></td>
                  <td><InlineDateCell value={item.plannedEnd} label="计划完成" reason={item.status === "not_started" ? undefined : { required: true, label: "调整原因", placeholder: "请说明计划完成日期调整原因" }} onSave={(plannedEnd, reason) => saveWorkItem(item, { plannedEnd, ...(reason ? { reason } : {}) })} /></td>
                  <td><div className="work-inline-status"><span className={`work-item-status-badge badge-${item.status.replaceAll("_", "-")}`}>{requirementStatusLabels[item.status as keyof typeof requirementStatusLabels] || item.status}</span><b className={gap.finishVariance > 0 ? "danger-text" : "safe-text"}>{gap.finishVariance > 0 ? "+" : ""}{gap.finishVariance}天</b><span className="work-item-inline-progress"><i><b style={{ width: `${item.progress}%` }} /></i>{item.progress}%</span>{item.blockedReason && <small title={item.blockedReason}>阻塞：{item.blockedReason}</small>}</div></td>
                  <td>
                    <div className="work-setting-actions">
                      <button type="button" className="sortable-drag-handle" aria-label={`拖动${item.title}调整顺序`} title="按住拖动调整顺序" disabled={reorderItems.isPending} {...sortable.handleAttributes} {...sortable.handleListeners}><GripVertical size={16} /></button>
                      {item.status === "not_started" && item.progress === 0 && <button type="button" className="danger" aria-label={`删除${item.title}`} title="删除" disabled={removeItem.isPending} onClick={() => { removeItem.reset(); setRemoveTarget(item); }}><Trash2 size={14} /></button>}
                    </div>
                  </td>
                </tr>
              );
            }}
            />
            </tbody>
          </table>
            {!requirement.workItems.length && !newItem && (
              <EmptyState
                title="还没有工作项"
                detail="可新增工作项，或从通用研发模板补充。"
              />
            )}
          </div>
          </div>
      </Modal>}
      <section className="detail-grid progress-detail-grid">
        <article className="panel progress-detail-card">
          <header><div><h2>进展记录</h2></div></header>
          <div className="progress-feed">
            {requirement.progressUpdates?.map((item) => (
              <article key={item.id}>
                <div className="progress-marker">{item.workItemPercent ?? item.percent}%</div>
                <div><header><strong>{new Date(item.createdAt).toLocaleString("zh-CN")}</strong>{item.workItemTitle && <span>{item.workItemTitle}</span>}</header><p>{item.content}</p></div>
                <span className="progress-event-type">{{ note: "说明", progress: "进展", start: "开始", block: "阻塞", unblock: "解阻", complete: "完成", reopen: "返工", correction: "纠错", accept: "验收", cancel: "取消" }[item.eventType] || "记录"}</span>
              </article>
            ))}
            {!requirement.progressUpdates?.length && <EmptyState title="暂无进展" detail="增加进展后，这里会显示具体完成内容。" />}
          </div>
        </article>
        <article className="panel progress-detail-card">
          <header><div><h2>进度趋势</h2></div></header>
          {requirement.progressUpdates?.length ? <Chart option={progressOption} height={270} ariaLabel="需求计划与实际进度趋势" /> : <EmptyState title="暂无趋势" detail="增加第一条进展后自动生成趋势图。" />}
        </article>
      </section>
      {canManage && ['completed', 'cancelled'].includes(requirement.status) && (
        <div className="danger-zone">
          <span>不再跟踪该需求时可以归档，数据不会立即物理删除。</span>
          <button
            onClick={() => { archive.reset(); setArchiveConfirm(true); }}
          >
            归档需求
          </button>
        </div>
      )}
      {canManage && !['completed', 'cancelled'].includes(requirement.status) && <div className="danger-zone">
        <span>取消会保留已完成工作项和历史，并级联取消其余工作项。</span>
        <button onClick={() => { requirementAction.reset(); setTextPrompt({ kind: "cancel" }); }}>取消需求</button>
      </div>}
      {modal === "info" && (
        <Modal title="编辑需求信息" onClose={() => setModal(null)}>
          <RequirementInfoForm requirement={requirement} people={people} onClose={() => setModal(null)} />
        </Modal>
      )}
      {modal === "schedule" && (
        <Modal title="调整需求计划" onClose={() => setModal(null)}>
          <RequirementScheduleForm requirement={requirement} onClose={() => setModal(null)} />
        </Modal>
      )}
      {modal === "progress" && (
        <Modal title={progressItemId ? "更新工作项进度" : "增加进展"} onClose={closeProgress}>
          <ProgressForm
            requirement={requirement}
            allowedItems={progressItemId ? requirement.workItems.filter((item) => item.id === progressItemId) : canManage || isRequirementOwner ? undefined : ownItems}
            requireAssociation={Boolean(progressItemId) || !canManage && !isRequirementOwner}
            fixedItemId={progressItemId}
            onClose={closeProgress}
          />
        </Modal>
      )}
      {modal === "template" && (
        <Modal title="按模板补全计划" width={840} onClose={() => setModal(null)}>
          <PlanForm requirement={requirement} templates={templates} onClose={() => setModal(null)} />
        </Modal>
      )}
      {textPrompt && <TextPromptModal
        title={{ reorder: "调整工作项顺序", accept: "确认验收", "new-item": "新增执行中工作项", cancel: "取消需求" }[textPrompt.kind]}
        description={{
          reorder: "需求已经开始执行。调整工作项顺序会改变后续计划，请说明本次调整原因。",
          accept: "验收后需求将计入已完成需求和完成率，请填写验收结论。",
          "new-item": "需求已经开始执行。新增工作项会改变当前执行计划，请说明新增原因。",
          cancel: "取消后将保留已完成工作项和历史，其余工作项会同步取消。",
        }[textPrompt.kind]}
        label={{ reorder: "调整原因", accept: "验收说明", "new-item": "新增原因", cancel: "取消原因" }[textPrompt.kind]}
        placeholder={{ reorder: "说明为什么需要调整顺序", accept: "填写验收结果和必要说明", "new-item": "说明新增工作项的原因", cancel: "说明取消需求的原因" }[textPrompt.kind]}
        confirmLabel={{ reorder: "确认调整", accept: "确认验收", "new-item": "确认新增", cancel: "确认取消" }[textPrompt.kind]}
        danger={textPrompt.kind === "cancel"}
        pending={textPrompt.kind === "reorder" ? reorderItems.isPending : textPrompt.kind === "new-item" ? createItem.isPending : requirementAction.isPending}
        error={(textPrompt.kind === "reorder" ? reorderItems.error : textPrompt.kind === "new-item" ? createItem.error : requirementAction.error)?.message}
        onClose={() => setTextPrompt(null)}
        onConfirm={(text) => {
          if (textPrompt.kind === "reorder") reorderItems.mutate({ ids: textPrompt.ids, reason: text });
          else if (textPrompt.kind === "new-item") { if (newItem) createItem.mutate({ ...newItem, reason: text }); }
          else requirementAction.mutate({ action: textPrompt.kind, text });
        }}
      />}
      {removeTarget && <ConfirmDialog title="删除工作项" description={<>工作项“<strong>{removeTarget.title}</strong>”将从需求计划中删除。此操作仅适用于尚未开始且没有进展历史的工作项。</>} confirmLabel="确认删除" pendingLabel="删除中…" danger pending={removeItem.isPending} error={removeItem.error?.message} onClose={() => setRemoveTarget(null)} onConfirm={() => removeItem.mutate(removeTarget)} />}
      {archiveConfirm && <ConfirmDialog title="归档需求" description={<>需求“<strong>{requirement.title}</strong>”将从日常页面隐藏，历史数据仍会保留并可在归档中心恢复。</>} confirmLabel="确认归档" pendingLabel="归档中…" danger pending={archive.isPending} error={archive.error?.message} onClose={() => setArchiveConfirm(false)} onConfirm={() => archive.mutate()} />}
      </div>
    </>
  );
}
