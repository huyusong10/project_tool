import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronDown,
  CircleStop,
  Clock3,
  Edit3,
  MoreHorizontal,
  Play,
  Plus,
  RotateCcw,
  Search,
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
  workItemPlannedDuration,
} from "../../shared/domain";
import { GapTimeline } from "../components/GapTimeline";
import { Chart } from "../components/Chart";
import { EmptyState, Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { canManageProject } from "../permissions";

function RequirementEditForm({
  requirement,
  onClose,
}: {
  requirement: Requirement;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const { data: templates = [] } = useQuery({ queryKey: ["templates"], queryFn: () => api<WorkItemTemplate[]>("/api/templates") });
  const [templateId, setTemplateId] = useState(requirement.templateId || "");
  const [scheduleMode, setScheduleMode] = useState<"start" | "deadline">("start");
  const templateChanged = Boolean(templateId && templateId !== requirement.templateId);
  const mutation = useMutation({
    mutationFn: (value: object) =>
      api(`/api/requirements/${requirement.id}`, {
        method: "PATCH",
        body: jsonBody(value),
      }),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["requirement", requirement.id],
      });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
  });
  return (
    <form
      className="form-grid"
      onSubmit={(event) => {
        event.preventDefault();
        if (templateChanged && !confirm("切换流程会清空当前需求的全部工作项、人员分配、实际日期和进展记录，并按新流程重新生成计划。确认继续？")) return;
        mutation.mutate({
          ...Object.fromEntries(new FormData(event.currentTarget)),
          scheduleMode,
          ...(templateChanged ? { templateId, confirmTemplateReset: true } : {}),
        });
      }}
    >
      <label className="field field-full">
        <span>需求标题</span>
        <input name="title" defaultValue={requirement.title} required />
      </label>
      <label className="field">
        <span>优先级</span>
        <select name="priority" defaultValue={requirement.priority}>
          <option value="P0">P0 · 紧急</option>
          <option value="P1">P1 · 高</option>
          <option value="P2">P2 · 中</option>
          <option value="P3">P3 · 低</option>
        </select>
      </label>
      <div className="field field-full">
        <span>排期方式</span>
        <div className="schedule-mode-switch" role="radiogroup" aria-label="排期方式">
          <button type="button" className={scheduleMode === "start" ? "is-active" : ""} role="radio" aria-checked={scheduleMode === "start"} onClick={() => setScheduleMode("start")}>
            <strong>按开始日期正排</strong>
            <small>整体平移现有工作项，以选定日期开始</small>
          </button>
          <button type="button" className={scheduleMode === "deadline" ? "is-active" : ""} role="radio" aria-checked={scheduleMode === "deadline"} onClick={() => setScheduleMode("deadline")}>
            <strong>按截止日期倒排</strong>
            <small>整体平移现有工作项，以选定日期结束</small>
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
          defaultValue={(scheduleMode === "start" ? requirement.plannedStart : requirement.plannedEnd) || ""}
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
      {templateChanged && <p className="template-reset-warning field-full"><AlertTriangle size={16} />切换后会清空现有工作项及进展，并按新流程和所选排期方向重新生成。</p>}
      <p className="field-help field-full">修改日期会整体平移已有工作项，保留相对间隔、人员和实际日期；每个工作项仍可单独修改自定义计划。流程设计后续变更不会同步到当前需求。</p>
      {mutation.error && (
        <p className="form-error field-full">{mutation.error.message}</p>
      )}
      <div className="form-actions field-full">
        <button type="button" className="ghost-button" onClick={onClose}>
          取消
        </button>
        <button className="primary-button">保存修改</button>
      </div>
    </form>
  );
}

function MultiPersonSelect({
  people,
  selectedIds,
  excludedId,
  onChange,
}: {
  people: Person[];
  selectedIds: string[];
  excludedId?: string;
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const availablePeople = useMemo(
    () => people.filter((person) => person.id !== excludedId),
    [excludedId, people],
  );
  const selectedPeople = availablePeople.filter((person) => selectedIds.includes(person.id));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visiblePeople = availablePeople.filter((person) =>
    !normalizedQuery
    || person.name.toLocaleLowerCase().includes(normalizedQuery)
    || (person.jobTitle || "").toLocaleLowerCase().includes(normalizedQuery),
  );

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const togglePerson = (personId: string) => {
    onChange(selectedIds.includes(personId)
      ? selectedIds.filter((id) => id !== personId)
      : [...selectedIds, personId]);
  };

  return (
    <div className="multi-person-select" ref={rootRef}>
      <button
        type="button"
        className={`multi-person-trigger${open ? " is-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={`multi-person-value${selectedPeople.length ? "" : " is-placeholder"}`}>
          {selectedPeople.length ? (
            <>
              {selectedPeople.slice(0, 2).map((person) => (
                <span className="multi-person-chip" key={person.id}>{person.name}</span>
              ))}
              {selectedPeople.length > 2 && <span className="multi-person-count">+{selectedPeople.length - 2}</span>}
            </>
          ) : "请选择协作人员"}
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="multi-person-menu">
          <label className="multi-person-search">
            <Search size={15} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索姓名或岗位"
              autoFocus
            />
          </label>
          <div className="multi-person-options" role="listbox" aria-label="协作人员" aria-multiselectable="true">
            {visiblePeople.map((person) => {
              const selected = selectedIds.includes(person.id);
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className="multi-person-option"
                  key={person.id}
                  onClick={() => togglePerson(person.id)}
                >
                  <span className="multi-person-check">{selected && <Check size={13} />}</span>
                  <span className="multi-person-option-copy">
                    <strong>{person.name}</strong>
                    <small>{person.jobTitle || "岗位未设置"}</small>
                  </span>
                </button>
              );
            })}
            {!visiblePeople.length && <p>没有匹配人员</p>}
          </div>
          <div className="multi-person-footer">
            <span>已选 {selectedPeople.length} 人</span>
            <div>
              {!!selectedPeople.length && <button type="button" onClick={() => onChange([])}>清空</button>}
              <button type="button" className="is-primary" onClick={() => { setOpen(false); setQuery(""); }}>完成</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkItemForm({
  requirement,
  item,
  onClose,
}: {
  requirement: Requirement;
  item?: WorkItem;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [ownerId, setOwnerId] = useState(item?.ownerId || "");
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>(item?.collaborators?.map((person) => person.id) || []);
  const { data: people = [] } = useQuery({
    queryKey: ["people", requirement.projectId],
    queryFn: () => api<Person[]>(`/api/people?projectId=${encodeURIComponent(requirement.projectId)}`),
  });
  const mutation = useMutation({
    mutationFn: (value: object) =>
      api(
        item
          ? `/api/work-items/${item.id}`
          : `/api/requirements/${requirement.id}/work-items`,
        { method: item ? "PATCH" : "POST", body: jsonBody(value) },
      ),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["requirement", requirement.id],
      });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
  });
  return (
    <form
      className="form-grid"
      onSubmit={(event) => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(event.currentTarget));
        mutation.mutate({
          ...values,
          ownerId,
          assigneeIds: [ownerId, ...collaboratorIds].filter(Boolean),
        });
      }}
    >
      <label className="field field-full">
        <span>工作项名称</span>
        <input
          name="title"
          defaultValue={item?.title || ""}
          required
          autoFocus
        />
      </label>
      <label className="field work-item-assignment-field">
        <span>主负责人</span>
        <select
          value={ownerId}
          onChange={(event) => {
            const nextOwnerId = event.target.value;
            setOwnerId(nextOwnerId);
            setCollaboratorIds((current) => current.filter((id) => id !== nextOwnerId));
          }}
        >
          <option value="">未分配</option>
          {people.map((person) => (
            <option value={person.id} key={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </label>
      <div className="field collaborator-field work-item-assignment-field">
        <span>协作人员 <small>可选 · 多选</small></span>
        <MultiPersonSelect
          people={people}
          selectedIds={collaboratorIds}
          excludedId={ownerId}
          onChange={setCollaboratorIds}
        />
      </div>
      <label className="field">
        <span>计划开始</span>
        <input
          name="plannedStart"
          type="date"
          defaultValue={item?.plannedStart || ""}
        />
      </label>
      <label className="field">
        <span>计划完成</span>
        <input
          name="plannedEnd"
          type="date"
          defaultValue={item?.plannedEnd || ""}
        />
      </label>
      <details className="advanced-fields field-full">
        <summary>高级修正：补录实际日期</summary>
        <div className="form-grid">
          <label className="field"><span>实际开始</span><input name="actualStart" type="date" defaultValue={item?.actualStart || ""} /></label>
          <label className="field"><span>实际完成</span><input name="actualEnd" type="date" defaultValue={item?.actualEnd || ""} /></label>
        </div>
      </details>
      {mutation.error && (
        <p className="form-error field-full">{mutation.error.message}</p>
      )}
      <div className="form-actions field-full">
        <button type="button" className="ghost-button" onClick={onClose}>
          取消
        </button>
        <button className="primary-button">
          {item ? "保存修改" : "添加工作项"}
        </button>
      </div>
    </form>
  );
}

function ProgressForm({
  requirement,
  allowedItems,
  requireAssociation,
  onClose,
}: {
  requirement: Requirement;
  allowedItems?: WorkItem[];
  requireAssociation?: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
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
      onClose();
    },
  });
  return (
    <form
      className="form-grid"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate(Object.fromEntries(new FormData(event.currentTarget)));
      }}
    >
      <label className="field field-full">
        <span>关联工作项{requireAssociation ? "" : "（可选）"}</span>
        <select name="workItemId" required={requireAssociation}>
          {!requireAssociation && <option value="">不关联</option>}
          {(allowedItems || requirement.workItems).map((item) => (
            <option value={item.id} key={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </label>
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
      <p className="field-help field-full">保存时自动记录当前需求进度；关联未开始的工作项会自动标记实际开始。</p>
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
  const [preview, setPreview] = useState<PlanPreview>();
  const previewMutation = useMutation({
    mutationFn: () => api<PlanPreview>(`/api/requirements/${requirement.id}/plan-preview`, {
      method: "POST", body: jsonBody({ templateId, baseStart }),
    }),
    onSuccess: setPreview,
  });
  const applyMutation = useMutation({
    mutationFn: () => api(`/api/requirements/${requirement.id}/apply-plan`, {
      method: "POST",
      body: jsonBody({ templateId, baseStart, templateItemIds: preview?.entries.filter((item) => item.willChange).map((item) => item.templateItemId) }),
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
        <div className="form-actions"><button className="ghost-button" onClick={() => setPreview(undefined)}>重新预览</button><button className="primary-button" disabled={!preview.entries.some((item) => item.willChange) || applyMutation.isPending} onClick={() => applyMutation.mutate()}>确认补全</button></div>
      </>}
    </div>
  );
}

export function RequirementPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { session } = useApp();
  const [modal, setModal] = useState<
    "edit" | "work" | "progress" | "template" | null
  >(null);
  const [editingItem, setEditingItem] = useState<WorkItem>();
  const [workEditorOpen, setWorkEditorOpen] = useState(false);
  const {
    data: requirement,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["requirement", id],
    queryFn: () => api<Requirement>(`/api/requirements/${id}`),
    enabled: Boolean(id),
  });
  const { data: templates = [] } = useQuery({
    queryKey: ["templates"],
    queryFn: () => api<WorkItemTemplate[]>("/api/templates"),
  });
  const removeItem = useMutation({
    mutationFn: (itemId: string) =>
      api(`/api/work-items/${itemId}`, { method: "DELETE" }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["requirement", id] }),
  });
  const removeProgress = useMutation({
    mutationFn: (progressId: string) =>
      api(`/api/progress/${progressId}`, { method: "DELETE" }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["requirement", id] }),
  });
  const archive = useMutation({
    mutationFn: () => api(`/api/requirements/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      navigate("/");
    },
  });
  const itemAction = useMutation({
    mutationFn: ({ itemId, action, reason }: { itemId: string; action: string; reason?: string }) =>
      api(`/api/work-items/${itemId}/${action}`, { method: "POST", body: reason ? jsonBody({ reason }) : undefined }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["requirement", id] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  const progressOption = useMemo(
    () => {
      const updates = [...(requirement?.progressUpdates || [])].reverse();
      const items = (requirement?.workItems || []).filter((item) => item.status !== "cancelled");
      const totalWeight = items.reduce((sum, item) => sum + workItemPlannedDuration(item), 0);
      const plannedValues = updates.map((update) => {
        const date = update.createdAt.slice(0, 10);
        const plannedWeight = items.filter((item) => item.plannedEnd && item.plannedEnd <= date).reduce((sum, item) => sum + workItemPlannedDuration(item), 0);
        return totalWeight ? Math.round((plannedWeight / totalWeight) * 100) : 0;
      });
      return ({
      tooltip: { trigger: "axis" },
      legend: { top: 4, right: 16, data: ["实际进度", "计划进度"], textStyle: { color: "#718096", fontSize: 12 } },
      grid: { left: 42, right: 18, top: 42, bottom: 34 },
      xAxis: {
        type: "category",
        data: updates.map((item) =>
            new Date(item.createdAt).toLocaleDateString("zh-CN", {
              month: "2-digit",
              day: "2-digit",
            })),
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
          data: updates.map((item) => item.percent),
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
  const ownItems = requirement.workItems.filter((item) => Boolean(session.personId) && item.assigneeIds.includes(session.personId!));
  const canAddProgress = canManage || ownItems.length > 0;
  const closeWorkItemForm = () => {
    setModal(null);
    setEditingItem(undefined);
    setWorkEditorOpen(true);
  };
  return (
    <>
      <PageHeader
        title={requirement.title}
        onBack={() => navigate(-1)}
        actions={canAddProgress || canManage ? (
          <>
            {canManage && <button className="ghost-button" onClick={() => setModal("edit")}>
              <Edit3 size={15} />
              编辑
            </button>}
            {canAddProgress && <button
              className="primary-button"
              onClick={() => setModal("progress")}
            >
              <Plus size={15} />
              增加进展
            </button>}
          </>
        ) : null}
      />
      <div className="page-content requirement-page">
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
            <span className={`risk-badge risk-${requirement.riskLevel}`}>{riskLabels[requirement.riskLevel as keyof typeof riskLabels]}</span>
          </div>
          <span>共{requirement.workItems.length}个工作项 · 最近更新 {new Date(requirement.updatedAt).toLocaleString("zh-CN")}</span>
        </div>
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
          <strong>
            {riskLabels[requirement.riskLevel as keyof typeof riskLabels]}
          </strong>
          <small>
            {requirement.highRisk ? (
              <>
                <AlertTriangle size={14} />
                已进入高风险视图
              </>
            ) : (
              <>
                <Check size={14} />
                当前风险可控
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
          {canManage && (
            <div className="panel-actions">
              <button
                className="ghost-button"
                aria-haspopup="dialog"
                onClick={() => setWorkEditorOpen(true)}
              >
                <Edit3 size={15} />
                编辑工作项
              </button>
            </div>
          )}
        </header>
        <GapTimeline items={requirement.workItems} updates={requirement.progressUpdates || []} />
      </section>
      {workEditorOpen && canManage && <Modal title="编辑工作项" width={1120} onClose={() => setWorkEditorOpen(false)}>
          <div className="work-editor-modal">
            <div className="work-editor-modal-toolbar">
              <span>状态由实际日期和阻塞标记自动推导</span>
              <div className="panel-actions">
              {(!requirement.workItems.length || requirement.workItems.some((item) => !item.plannedStart || !item.plannedEnd)) && <button className="ghost-button" onClick={() => { setWorkEditorOpen(false); setModal("template"); }}>补全计划</button>}
              <button className="primary-button" onClick={() => { setWorkEditorOpen(false); setEditingItem(undefined); setModal("work"); }}><Plus size={15} />添加工作项</button>
              </div>
            </div>
          <div className="work-editor-scroll"><div className="work-list">
            {requirement.workItems.map((item) => {
              const gap = calculateWorkItemGap(item);
              return (
                <div className="work-row" key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>
                      {item.assigneeNames?.join("、") || item.ownerName || "未分配"} ·{" "}
                      {requirementStatusLabels[
                        item.status as keyof typeof requirementStatusLabels
                      ] || item.status}
                    </span>
                  </div>
                  <div className="work-dates">
                    <span>
                      计划 {item.plannedStart || "—"} → {item.plannedEnd || "—"}
                    </span>
                    <span>
                      实际 {item.actualStart || "—"} →{" "}
                      {item.actualEnd || "—"}
                    </span>
                    {item.blockedReason && <span className="danger-text">阻塞：{item.blockedReason}</span>}
                  </div>
                  <b
                    className={
                      gap.finishVariance > 0 ? "danger-text" : "safe-text"
                    }
                  >
                    {gap.finishVariance > 0 ? "+" : ""}
                    {gap.finishVariance}天
                  </b>
                  {canManage && (
                    <div className="work-item-actions">
                      {item.status === "not_started" && <button className="work-next-action" onClick={() => itemAction.mutate({ itemId: item.id, action: "start" })}><Play size={14} />开始</button>}
                      {item.status === "in_progress" && <button className="work-next-action" onClick={() => itemAction.mutate({ itemId: item.id, action: "complete" })}><Check size={14} />完成</button>}
                      {item.status === "blocked" && <button className="work-next-action" onClick={() => itemAction.mutate({ itemId: item.id, action: "unblock" })}><RotateCcw size={14} />解除阻塞</button>}
                      <details className="action-menu">
                        <summary aria-label="更多工作项操作" title="更多操作"><MoreHorizontal size={16} /></summary>
                        <div>
                          <button onClick={() => { setWorkEditorOpen(false); setEditingItem(item); setModal("work"); }}><Edit3 size={14} />编辑</button>
                          {item.status === "in_progress" && <button onClick={() => { const reason = prompt("请输入阻塞原因"); if (reason?.trim()) itemAction.mutate({ itemId: item.id, action: "block", reason }); }}><CircleStop size={14} />标记阻塞</button>}
                          {!['completed', 'cancelled'].includes(item.status) && <button onClick={() => confirm(`取消工作项“${item.title}”？`) && itemAction.mutate({ itemId: item.id, action: "cancel" })}><CircleStop size={14} />取消工作项</button>}
                          <button className="danger" onClick={() => confirm(`删除工作项“${item.title}”？`) && removeItem.mutate(item.id)}><Trash2 size={14} />删除</button>
                        </div>
                      </details>
                    </div>
                  )}
                </div>
              );
            })}
            {!requirement.workItems.length && (
              <EmptyState
                title="还没有工作项"
                detail="可新增工作项，或从通用研发模板补充。"
              />
            )}
          </div></div>
          </div>
      </Modal>}
      <section className="detail-grid progress-detail-grid">
        <article className="panel progress-detail-card">
          <header><div><h2>进展记录</h2></div></header>
          <div className="progress-feed">
            {requirement.progressUpdates?.map((item) => (
              <article key={item.id}>
                <div className="progress-marker">{item.percent}%</div>
                <div><header><strong>{new Date(item.createdAt).toLocaleString("zh-CN")}</strong>{item.workItemTitle && <span>{item.workItemTitle}</span>}</header><p>{item.content}</p></div>
                {(canManage || item.createdByAccountId === session.accountId) && <button aria-label="删除进展" onClick={() => confirm("确认删除这条进展？") && removeProgress.mutate(item.id)}><Trash2 size={14} /></button>}
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
      {canManage && (
        <div className="danger-zone">
          <span>不再跟踪该需求时可以归档，数据不会立即物理删除。</span>
          <button
            onClick={() => confirm("确认归档该需求？") && archive.mutate()}
          >
            归档需求
          </button>
        </div>
      )}
      {modal === "edit" && (
        <Modal title="编辑需求" onClose={() => setModal(null)}>
          <RequirementEditForm
            requirement={requirement}
            onClose={() => setModal(null)}
          />
        </Modal>
      )}
      {modal === "work" && (
        <Modal
          title={editingItem ? "编辑工作项" : "新增工作项"}
          onClose={closeWorkItemForm}
        >
          <WorkItemForm
            requirement={requirement}
            item={editingItem}
            onClose={closeWorkItemForm}
          />
        </Modal>
      )}
      {modal === "progress" && (
        <Modal title="增加进展" onClose={() => setModal(null)}>
          <ProgressForm
            requirement={requirement}
            allowedItems={canManage ? undefined : ownItems}
            requireAssociation={!canManage}
            onClose={() => setModal(null)}
          />
        </Modal>
      )}
      {modal === "template" && (
        <Modal title="按模板补全计划" width={840} onClose={() => setModal(null)}>
          <PlanForm requirement={requirement} templates={templates} onClose={() => setModal(null)} />
        </Modal>
      )}
      </div>
    </>
  );
}
