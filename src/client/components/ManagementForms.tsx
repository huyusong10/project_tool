import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, jsonBody } from "../api";
import { useApp } from "../app-context";
import type { Project, WorkItemTemplate } from "../types";

export function ProjectForm({
  project,
  onClose,
}: {
  project?: Project;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const { data: templates = [] } = useQuery({
    queryKey: ["templates", project?.id || "new"],
    queryFn: () => api<WorkItemTemplate[]>(`/api/templates?projectId=${encodeURIComponent(project!.id)}`),
    enabled: Boolean(project?.id),
  });
  const mutation = useMutation({
    mutationFn: (data: object) =>
      api(project ? `/api/projects/${project.id}` : "/api/projects", {
        method: project ? "PATCH" : "POST",
        body: jsonBody(data),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["projects"] });
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
        <span>项目名称</span>
        <input name="name" defaultValue={project?.name || ""} required autoFocus placeholder="例如：DCIM平台 V1.0" />
      </label>
      <label className="field">
        <span>计划开始</span>
        <input name="plannedStart" type="date" defaultValue={project?.plannedStart || ""} />
      </label>
      <label className="field">
        <span>计划完成</span>
        <input name="plannedEnd" type="date" defaultValue={project?.plannedEnd || ""} />
      </label>
      <label className="field field-full">
        <span>默认流程</span>
        <select key={`${project?.id || "new"}-${templates.length}`} name="defaultTemplateId" defaultValue={project?.defaultTemplateId || ""}>
          <option value="">不指定</option>
          {templates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}
        </select>
      </label>
      {mutation.error && <p className="form-error field-full">{mutation.error.message}</p>}
      <div className="form-actions field-full">
        <button type="button" className="ghost-button" onClick={onClose}>取消</button>
        <button className="primary-button" disabled={mutation.isPending}>{project ? "保存修改" : "创建项目"}</button>
      </div>
    </form>
  );
}

export function RequirementForm({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [scheduleMode, setScheduleMode] = useState<"start" | "deadline">("start");
  const { projects } = useApp();
  const { data: templates = [] } = useQuery({
    queryKey: ["templates", projectId],
    queryFn: () => api<WorkItemTemplate[]>(`/api/templates?projectId=${encodeURIComponent(projectId)}`),
    enabled: Boolean(projectId),
  });
  const mutation = useMutation({
    mutationFn: (data: object) => api("/api/requirements", { method: "POST", body: jsonBody(data) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["requirements"] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
  });
  const defaultTemplateId = projects.find((project) => project.id === projectId)?.defaultTemplateId || "";
  return (
    <form
      className="form-grid"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate({ ...Object.fromEntries(new FormData(event.currentTarget)), projectId });
      }}
    >
      <label className="field field-full">
        <span>需求标题</span>
        <input name="title" required autoFocus />
      </label>
      <label className="field">
        <span>优先级</span>
        <select name="priority" defaultValue="P2">
          <option value="P0">P0 · 紧急</option>
          <option value="P1">P1 · 高</option>
          <option value="P2">P2 · 中</option>
          <option value="P3">P3 · 低</option>
        </select>
      </label>
      <label className="field">
        <span>流程设计</span>
        <select key={`${projectId}-${templates.length}`} name="templateId" required defaultValue={defaultTemplateId}>
          {!defaultTemplateId && <option value="">请选择模板</option>}
          {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
      </label>
      <div className="field field-full">
        <span>排期方式</span>
        <div className="schedule-mode-switch" role="radiogroup" aria-label="排期方式">
          <button
            type="button"
            className={scheduleMode === "start" ? "is-active" : ""}
            role="radio"
            aria-checked={scheduleMode === "start"}
            onClick={() => setScheduleMode("start")}
          >
            <strong>按开始日期排期</strong>
            <small>从选定日期按流程正向生成计划</small>
          </button>
          <button
            type="button"
            className={scheduleMode === "deadline" ? "is-active" : ""}
            role="radio"
            aria-checked={scheduleMode === "deadline"}
            onClick={() => setScheduleMode("deadline")}
          >
            <strong>按截止日期倒排</strong>
            <small>以选定日期为目标反算计划开始</small>
          </button>
        </div>
      </div>
      <label className="field field-full schedule-date-field">
        <span>{scheduleMode === "start" ? "计划开始" : "截止日期"}</span>
        <input
          key={scheduleMode}
          name={scheduleMode === "start" ? "plannedStart" : "plannedEnd"}
          type="date"
          required
        />
      </label>
      <p className="field-help field-full">
        {scheduleMode === "start"
          ? "保存后将按流程自动生成工作项，并计算计划完成日期。"
          : "保存后将按流程工期倒排工作项；截止日期需为工作日。"}
      </p>
      {mutation.error && <p className="form-error field-full">{mutation.error.message}</p>}
      <div className="form-actions field-full">
        <button type="button" className="ghost-button" onClick={onClose}>取消</button>
        <button className="primary-button" disabled={mutation.isPending}>创建需求</button>
      </div>
    </form>
  );
}
