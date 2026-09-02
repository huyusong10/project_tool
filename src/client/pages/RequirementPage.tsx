import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CircleStop,
  Clock3,
  Edit3,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  UserPlus,
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
} from "../../shared/domain";
import { GapTimeline } from "../components/GapTimeline";
import { Chart } from "../components/Chart";
import { EmptyState, Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";

function RequirementEditForm({
  requirement,
  onClose,
}: {
  requirement: Requirement;
  onClose: () => void;
}) {
  const client = useQueryClient();
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
        mutation.mutate(Object.fromEntries(new FormData(event.currentTarget)));
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
      <label className="field">
        <span>计划开始</span>
        <input
          name="plannedStart"
          type="date"
          defaultValue={requirement.plannedStart || ""}
        />
      </label>
      <p className="field-help field-full">状态、进度、风险和计划完成均由工作项自动计算；修改计划开始不会直接覆盖现有工作项。</p>
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
  const [showCollaborators, setShowCollaborators] = useState(Boolean(item?.collaborators?.length));
  const { data: people = [] } = useQuery({
    queryKey: ["people"],
    queryFn: () => api<Person[]>("/api/people"),
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
      <label className="field">
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
      <div className="field collaborator-field">
        <span>协作人员 <small>可选</small></span>
        {!showCollaborators ? (
          <button type="button" className="collaborator-toggle" onClick={() => setShowCollaborators(true)}>
            <UserPlus size={15} />
            添加协作人员
          </button>
        ) : (
          <div className="collaborator-picker">
            {people.filter((person) => person.id !== ownerId).map((person) => (
              <label key={person.id}>
                <input
                  type="checkbox"
                  checked={collaboratorIds.includes(person.id)}
                  onChange={(event) => setCollaboratorIds((current) => event.target.checked
                    ? [...current, person.id]
                    : current.filter((id) => id !== person.id))}
                />
                <span>{person.name}</span>
                <small>{person.jobTitle || "岗位未设置"}</small>
              </label>
            ))}
            {!people.some((person) => person.id !== ownerId) && <p>暂无其他可选人员</p>}
          </div>
        )}
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
  onClose,
}: {
  requirement: Requirement;
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
        <span>关联工作项（可选）</span>
        <select name="workItemId">
          <option value="">不关联</option>
          {requirement.workItems.map((item) => (
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
  const [templateId, setTemplateId] = useState(templates[0]?.id || "");
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
        <label className="field"><span>工作项模板</span><select value={templateId} onChange={(event) => { setTemplateId(event.target.value); setPreview(undefined); }}>{templates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}</select></label>
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
    () => ({
      tooltip: { trigger: "axis" },
      grid: { left: 38, right: 18, top: 18, bottom: 34 },
      xAxis: {
        type: "category",
        data: [...(requirement?.progressUpdates || [])]
          .reverse()
          .map((item) =>
            new Date(item.createdAt).toLocaleDateString("zh-CN", {
              month: "2-digit",
              day: "2-digit",
            }),
          ),
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
          type: "line",
          smooth: true,
          symbolSize: 8,
          data: [...(requirement?.progressUpdates || [])]
            .reverse()
            .map((item) => item.percent),
          lineStyle: { color: "#2d6cdf", width: 3 },
          itemStyle: { color: "#2d6cdf" },
          areaStyle: { color: "rgba(45,108,223,.12)" },
        },
      ],
    }),
    [requirement],
  );
  if (isLoading)
    return (
      <>
        <PageHeader title="需求详情" onBack={() => navigate("/")} />
        <div className="page-content">
          <div className="loading-block">加载需求详情…</div>
        </div>
      </>
    );
  if (error || !requirement)
    return (
      <>
        <PageHeader title="需求详情" onBack={() => navigate("/")} />
        <div className="page-content">
          <EmptyState
            title="需求无法打开"
            detail={error?.message || "需求不存在或已归档。"}
            action={
              <button className="ghost-button" onClick={() => navigate("/")}>
                返回项目进展
              </button>
            }
          />
        </div>
      </>
    );
  return (
    <>
      <PageHeader
        title={requirement.title}
        onBack={() => navigate("/")}
        actions={session.authenticated ? (
          <>
            <button className="ghost-button" onClick={() => setModal("edit")}>
              <Edit3 size={15} />
              编辑
            </button>
            <button
              className="primary-button"
              onClick={() => setModal("progress")}
            >
              <Plus size={15} />
              增加进展
            </button>
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
      <section className="panel detail-panel">
        <header>
          <div>
            <h2>计划与实际Gap</h2>
            <p>计划与实际使用上下独立泳道，时间偏差一眼可见</p>
          </div>
          {session.authenticated && (
            <div className="panel-actions">
              <button
                className="ghost-button"
                onClick={() => setModal("template")}
              >
                补全计划
              </button>
              <button
                className="ghost-button"
                onClick={() => {
                  setEditingItem(undefined);
                  setModal("work");
                }}
              >
                <Plus size={15} />
                工作项
              </button>
            </div>
          )}
        </header>
        <GapTimeline items={requirement.workItems} />
      </section>
      <section className="detail-grid">
        <article className="panel">
          <header>
            <div>
              <h2>进度趋势</h2>
              <p>根据每次进展记录生成</p>
            </div>
          </header>
          {requirement.progressUpdates?.length ? (
            <Chart
              option={progressOption}
              height={250}
              ariaLabel="需求进度趋势"
            />
          ) : (
            <EmptyState
              title="暂无进展记录"
              detail="增加第一条进展后自动生成趋势图。"
            />
          )}
        </article>
        <article className="panel">
          <header>
            <div>
              <h2>工作项明细</h2>
              <p>状态由实际日期和阻塞标记自动推导</p>
            </div>
          </header>
          <div className="work-list">
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
                  {session.authenticated && (
                    <div className="row-actions">
                      {item.status === "not_started" && <button title="开始工作" aria-label="开始工作" onClick={() => itemAction.mutate({ itemId: item.id, action: "start" })}><Play size={14} /></button>}
                      {item.status === "in_progress" && <>
                        <button title="完成工作" aria-label="完成工作" onClick={() => itemAction.mutate({ itemId: item.id, action: "complete" })}><Check size={14} /></button>
                        <button title="标记阻塞" aria-label="标记阻塞" onClick={() => { const reason = prompt("请输入阻塞原因"); if (reason?.trim()) itemAction.mutate({ itemId: item.id, action: "block", reason }); }}><CircleStop size={14} /></button>
                      </>}
                      {item.status === "blocked" && <button title="解除阻塞" aria-label="解除阻塞" onClick={() => itemAction.mutate({ itemId: item.id, action: "unblock" })}><RotateCcw size={14} /></button>}
                      <button
                        aria-label="编辑工作项"
                        onClick={() => {
                          setEditingItem(item);
                          setModal("work");
                        }}
                      >
                        <Edit3 size={14} />
                      </button>
                      {!['completed', 'cancelled'].includes(item.status) && <button title="取消工作项" aria-label="取消工作项" onClick={() => confirm(`取消工作项“${item.title}”？`) && itemAction.mutate({ itemId: item.id, action: "cancel" })}><CircleStop size={14} /></button>}
                      <button
                        aria-label="删除工作项"
                        onClick={() =>
                          confirm(`删除工作项“${item.title}”？`) &&
                          removeItem.mutate(item.id)
                        }
                      >
                        <Trash2 size={14} />
                      </button>
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
          </div>
        </article>
      </section>
      <section className="panel detail-panel">
        <header>
          <div>
            <h2>进展记录</h2>
            <p>按时间倒序展示具体完成内容</p>
          </div>
        </header>
        <div className="progress-feed">
          {requirement.progressUpdates?.map((item) => (
            <article key={item.id}>
              <div className="progress-marker">{item.percent}%</div>
              <div>
                <header>
                  <strong>
                    {new Date(item.createdAt).toLocaleString("zh-CN")}
                  </strong>
                  {item.workItemTitle && <span>{item.workItemTitle}</span>}
                </header>
                <p>{item.content}</p>
              </div>
              {session.authenticated && (
                <button
                  aria-label="删除进展"
                  onClick={() =>
                    confirm("确认删除这条进展？") &&
                    removeProgress.mutate(item.id)
                  }
                >
                  <Trash2 size={14} />
                </button>
              )}
            </article>
          ))}
          {!requirement.progressUpdates?.length && (
            <EmptyState
              title="暂无进展"
              detail="只需填写具体进展，系统会自动记录当时的需求进度。"
            />
          )}
        </div>
      </section>
      {session.authenticated && (
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
          onClose={() => setModal(null)}
        >
          <WorkItemForm
            requirement={requirement}
            item={editingItem}
            onClose={() => setModal(null)}
          />
        </Modal>
      )}
      {modal === "progress" && (
        <Modal title="增加进展" onClose={() => setModal(null)}>
          <ProgressForm
            requirement={requirement}
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
